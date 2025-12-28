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

// STRIPE WEBHOOK
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
    res.json({ received: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MANUELLES CORS (Kein Modul nötig)
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

// MAPPING LOGIK
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

// FIX: ROUTE MIT KORREKTEM SQL-FILTER
app.get("/prices", authenticatePremiumUser, async (req, res) => {
    const { set: setSlug, cardNumber } = req.query;
    let dbNum = cardNumber.padStart(3, '0');

    console.log(`\n--- [DEBUG] Eindeutige Suche ---`);
    console.log(`Gesuchter Slug: ${setSlug}, Nummer: ${dbNum}`);

    try {
        // WICHTIG: Hier müssen BEIDE Werte in WHERE stehen
        const dbRes = await pool.query(
            "SELECT tcg_player_id FROM card_mapping WHERE cardmarket_slug = $1 AND card_number = $2", 
            [setSlug, dbNum]
        );
        
        const tcgId = dbRes.rows[0]?.tcg_player_id;
        console.log(`DB-Treffer für dieses Set: ${tcgId || "NICHTS GEFUNDEN"}`);

        if (!tcgId) return res.status(404).json({ error: "Mapping für dieses Set fehlt" });

        const apiRes = await fetch(`${API_BASE_URL}/v1/cards?tcgplayerId=${tcgId}`, { 
            headers: { "X-API-KEY": API_KEY } 
        });
        const justTcgData = await apiRes.json();

        const cardTitle = justTcgData.data?.[0]?.name || "Unbekannt";
        console.log(`API Resultat: "${cardTitle}" (ID: ${tcgId})`);

        const mappedPrices = mapAndFilterPrices(justTcgData);
        res.json({ prices: mappedPrices, fullTitle: cardTitle });
    } catch (err) { 
        console.error("SERVER ERROR:", err);
        res.status(500).json({ error: "SERVER_ERROR" }); 
    }
});

// AUTH ROUTES (Login/Checkout...)
app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = (await pool.query("SELECT * FROM users WHERE email = $1", [email])).rows[0];
        if (user && await bcrypt.compare(password, user.password_hash)) {
            const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '365d' });
            res.json({ token, is_premium: user.is_premium, premium_until: user.premium_until });
        } else { res.status(401).json({ error: "Falsche Daten" }); }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/create-checkout-session", async (req, res) => {
    try {
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
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`Server läuft auf ${PORT}`));
