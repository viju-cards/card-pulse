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

// Umgebungsvariablen
const API_BASE_URL = "https://api.justtcg.com";
const API_KEY = process.env.JUSTTCG_API_KEY; 
const DATABASE_URL = process.env.DATABASE_URL; 
const JWT_SECRET = process.env.JWT_SECRET;

// Datenbank Verbindung (Neon)
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// =========================================================
// 1. STRIPE WEBHOOK (Muss vor express.json() stehen!)
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
    res.json({ received: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MANUELLES CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); 
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization'); 
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// =========================================================
// 2. AUTHENTIFIZIERUNG & REGISTRIERUNG
// =========================================================

// NEU: LOGIN CHECK (Verhindert den Logout-Loop im Dashboard)
app.post("/login_check", async (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: "No token provided" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const result = await pool.query("SELECT is_premium, premium_until FROM users WHERE id = $1", [decoded.id]);
        const user = result.rows[0];

        if (!user) return res.status(404).json({ error: "User not found" });

        res.json({
            is_premium: user.is_premium,
            premium_until: user.premium_until
        });
    } catch (err) {
        res.status(401).json({ error: "Invalid token" });
    }
});

// REGISTRIERUNG
app.post("/register", async (req, res) => {
    const { email, password } = req.body;
    try {
        const existingUser = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: "Benutzername/E-Mail bereits vergeben." });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        await pool.query(
            "INSERT INTO users (email, password_hash, is_premium, created_at) VALUES ($1, $2, $3, NOW())",
            [email, passwordHash, false]
        );

        res.json({ success: true, message: "Konto erfolgreich erstellt!" });
    } catch (err) {
        console.error("Registrierungsfehler:", err);
        res.status(500).json({ error: "Serverfehler bei der Registrierung." });
    }
});

// LOGIN
app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        const user = result.rows[0];
        
        if (!user) {
            return res.status(401).json({ error: "Kein Account mit dieser E-Mail gefunden." });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (isMatch) {
            const formattedDate = user.created_at 
                ? new Date(user.created_at).toLocaleDateString('de-DE') 
                : '--';

            // Token enthält user.id passend zum decoded.id in anderen Routen
            const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '365d' });
            
            res.json({ 
                token, 
                is_premium: user.is_premium, 
                premium_until: user.premium_until,
                member_since: formattedDate 
            });
        } else { 
            res.status(401).json({ error: "Das Passwort ist nicht korrekt." }); 
        }
    } catch (e) { 
        res.status(500).json({ error: "Serverfehler beim Login." }); 
    }
});

// AUTH MIDDLEWARE (Für Preisabfragen der Extension)
async function authenticatePremiumUser(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: "LOGIN_REQUIRED" });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = (await pool.query("SELECT is_premium, premium_until FROM users WHERE id = $1", [decoded.id])).rows[0];
        if (user?.is_premium && new Date(user.premium_until) > new Date()) {
            req.user = decoded;
            next();
        } else { 
            res.status(403).json({ error: "PAYMENT_REQUIRED" }); 
        }
    } catch (err) { 
        res.status(403).json({ error: "INVALID_TOKEN" }); 
    }
}

// =========================================================
// 3. PREIS LOGIK & MAPPING
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

    prices['LOW'] = allPrices.length > 0 ? Math.min(...allPrices).toFixed(2) : '--';
    prices['HIGH'] = allPrices.length > 0 ? Math.max(...allPrices).toFixed(2) : '--';
    prices['MARKET PRICE'] = (conditionPrices['NEAR MINT'] || (allPrices.length > 0 ? allPrices[0] : 0)).toFixed(2); 
    prices['NEAR MINT'] = conditionPrices['NEAR MINT'] ? conditionPrices['NEAR MINT'].toFixed(2) : null;
    prices['LIGHTLY PLAYED'] = conditionPrices['LIGHTLY PLAYED'] ? conditionPrices['LIGHTLY PLAYED'].toFixed(2) : null;

    return prices;
}

app.get("/prices", authenticatePremiumUser, async (req, res) => {
    const { set: setSlug, cardNumber } = req.query;
    try {
        const dbRes = await pool.query(
            "SELECT tcg_player_id FROM card_mapping WHERE cardmarket_slug = $1 AND card_number = $2", 
            [setSlug, cardNumber] 
        );
        
        const tcgId = dbRes.rows[0]?.tcg_player_id;
        if (!tcgId) {
            return res.status(404).json({ error: "Mapping fehlt" });
        }

        const apiRes = await fetch(`${API_BASE_URL}/v1/cards?tcgplayerId=${tcgId}`, { 
            headers: { "X-API-KEY": API_KEY } 
        });
        const justTcgData = await apiRes.json();

        const cardTitle = justTcgData.data?.[0]?.name || "Unbekannt";
        const mappedPrices = mapAndFilterPrices(justTcgData);
        
        res.json({ prices: mappedPrices, fullTitle: cardTitle });
    } catch (err) { 
        console.error("SERVER ERROR:", err);
        res.status(500).json({ error: "SERVER_ERROR" }); 
    }
});


// =========================================================
// 4. STRIPE CHECKOUT & PORTAL
// =========================================================

// Checkout Session erstellen
app.post("/create-checkout-session", async (req, res) => {
    try {
        const { token } = req.body;
        const decoded = jwt.verify(token, JWT_SECRET);
        
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card', 'paypal'],
            line_items: [{ price: 'price_1SjQsWFUZXbTt9dyq5MqFi06', quantity: 1 }], 
            mode: 'subscription',
            success_url: 'https://pokecardscout-api.onrender.com?status=success',
            cancel_url: 'https://pokecardscout-api.onrender.com?status=cancel',
            client_reference_id: decoded.id.toString(),
        });
        res.json({ url: session.url });
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

// NEU: Stripe Customer Portal (Abo verwalten)
app.post("/create-portal-session", async (req, res) => {
    try {
        const { token } = req.body;
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = (await pool.query("SELECT stripe_customer_id FROM users WHERE id = $1", [decoded.id])).rows[0];

        if (!user?.stripe_customer_id) {
            return res.status(400).json({ error: "Keine aktive Stripe-ID gefunden." });
        }

        const portalSession = await stripe.billingPortal.sessions.create({
            customer: user.stripe_customer_id,
            return_url: 'https://pokecardscout-api.onrender.com',
        });
        res.json({ url: portalSession.url });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
