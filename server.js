const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg"); 
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const path = require("path");
require("dotenv").config(); 

const app = express();
const PORT = process.env.PORT || 3000;

const API_BASE_URL = "https://api.justtcg.com";
const API_KEY = process.env.JUSTTCG_API_KEY; 
const DATABASE_URL = process.env.DATABASE_URL; 
const JWT_SECRET = process.env.JWT_SECRET;

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// =========================================================
// 1. STRIPE WEBHOOK (Unverändert für Abo-Logik)
// =========================================================
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) { return res.status(400).send(`Webhook Error: ${err.message}`); }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 32); 
        await pool.query('UPDATE users SET is_premium = true, premium_until = $1, stripe_customer_id = $2 WHERE id = $3',
            [expiryDate, session.customer, session.client_reference_id]);
    }
    if (event.type === 'invoice.paid') {
        const newExpiry = new Date();
        newExpiry.setDate(newExpiry.getDate() + 32);
        await pool.query('UPDATE users SET is_premium = true, premium_until = $1 WHERE stripe_customer_id = $2', [newExpiry, event.data.object.customer]);
    }
    if (event.type === 'customer.subscription.deleted') {
        await pool.query('UPDATE users SET is_premium = false WHERE stripe_customer_id = $1', [event.data.object.customer]);
    }
    res.json({ received: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); 
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization'); 
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// AUTH MIDDLEWARE
async function authenticatePremiumUser(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "LOGIN_REQUIRED" });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = (await pool.query("SELECT is_premium, premium_until FROM users WHERE id = $1", [decoded.id])).rows[0];
        if (user?.is_premium && new Date(user.premium_until) > new Date()) {
            req.user = decoded;
            next();
        } else { res.status(403).json({ error: "PAYMENT_REQUIRED" }); }
    } catch (err) { res.status(403).json({ error: "INVALID_TOKEN" }); }
}

// =========================================================
// 2. DEINE ALTE FUNKTIONIERENDE MAPPING-LOGIK
// =========================================================
function mapAndFilterPrices(data) {
    const cardData = Array.isArray(data.data) ? data.data[0] : null; 
    if (!cardData || !cardData.variants) return {};
    
    const prices = {};
    let allPrices = []; 
    let conditionPrices = {}; 

    for (const variant of cardData.variants) {
        if (typeof variant.price === 'number') { 
            const conditionKey = variant.condition.toUpperCase().trim();
            allPrices.push(variant.price);
            if (!conditionPrices[conditionKey] || variant.price < conditionPrices[conditionKey]) {
                conditionPrices[conditionKey] = variant.price;
            }
        }
    }

    prices['LOW'] = allPrices.length > 0 ? Math.min(...allPrices) : null;
    prices['HIGH'] = allPrices.length > 0 ? Math.max(...allPrices) : null;
    prices['MARKET PRICE'] = conditionPrices['NEAR MINT'] || (allPrices.length > 0 ? allPrices[0] : null); 
    prices['NEAR MINT'] = conditionPrices['NEAR MINT'] || null;
    prices['LIGHTLY PLAYED'] = conditionPrices['LIGHTLY PLAYED'] || null;
    prices['MODERATELY PLAYED'] = conditionPrices['MODERATELY PLAYED'] || null;
    prices['HEAVILY PLAYED'] = conditionPrices['HEAVILY PLAYED'] || null;
    prices['DAMAGED/POOR'] = conditionPrices['DAMAGED'] || conditionPrices['POOR'] || null; 

    return prices;
}

// =========================================================
// 3. ROUTE: PREISE (Kombiniert mit Abo-Check)
// =========================================================
app.get("/prices", authenticateExtension, async (req, res) => {
    const { set: setSlug, cardNumber } = req.query;

    if (!setSlug || !cardNumber) {
        return res.status(400).json({ error: "Es fehlen 'set' und 'cardNumber' Parameter." });
    }
    
    try {
        // 1. NEON DB-LOOKUP
        const tcgPlayerId = await getTcgPlayerIdFromDb(setSlug, cardNumber);

        if (!tcgPlayerId) {
             console.log(`[MAPPING 404] Kein TCGplayer ID Eintrag gefunden für ${setSlug}-${cardNumber}`);
             return res.status(404).json({ error: "Mapping fehlt", message: "TCGplayer ID für diese Karte nicht in der Datenbank gefunden. Bitte hinzufügen." });
        }
        
        // 2. JUSTTCG Abfrage
        console.log(`[API CALL] Rufe JustTCG über TCGplayer ID ${tcgPlayerId} ab.`);
        
        const justTcgData = await fetchJustTcgData(tcgPlayerId);

        const mappedPrices = mapAndFilterPrices(justTcgData);
        
        const cardTitle = justTcgData.data && justTcgData.data[0]?.name || "Unbekannter Titel";
        
        const avgPrices = aggregatePsaData(null); 

        const finalResponse = { 
            prices: mappedPrices, 
            fullTitle: cardTitle, 
            ebay: avgPrices 
        };
            
        console.log("[REQUEST END] Preise und PSA-Avg erfolgreich gesendet.");
        return res.json(finalResponse); 

    } catch (err) {
        console.error("[FATAL ERROR] Interner Serverfehler bei JustTCG Abfrage:", err);
        return res.status(500).json({ error: `SERVER_ERROR`, message: err.message });
    }
});


// AUTH ROUTES (Login/Register wie zuvor...)
app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    const user = (await pool.query("SELECT * FROM users WHERE email = $1", [email])).rows[0];
    if (user && await bcrypt.compare(password, user.password_hash)) {
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '365d' });
        res.json({ token, is_premium: user.is_premium, premium_until: user.premium_until });
    } else { res.status(401).json({ error: "Falsche Daten" }); }
});

app.post("/create-checkout-session", async (req, res) => {
    const decoded = jwt.verify(req.body.token, JWT_SECRET);
    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card', 'paypal'],
        line_items: [{ price: 'price_1SjQsWFUZXbTt9dyq5MqFi06', quantity: 1 }], 
        mode: 'subscription',
        success_url: 'https://pokecardscout-api.onrender.com?status=success',
        cancel_url: 'https://pokecardscout-api.onrender.com?status=cancel',
        client_reference_id: decoded.id.toString(),
    });
    res.json({ url: session.url });
});

app.listen(PORT, () => console.log(`Server läuft auf ${PORT}`));
