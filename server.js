// server.js - VOLLSTÄNDIGE VERSION MIT PREMIUM-SCHUTZ
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

// ⚠️ PRÜFUNG DER ENVS
if (!DATABASE_URL || !API_KEY || !JWT_SECRET || !process.env.STRIPE_SECRET_KEY) {
    console.error("FATAL ERROR: Umgebungsvariablen fehlen!");
    process.exit(1); 
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// =========================================================
// 1. STRIPE WEBHOOK (Muss VOR express.json() stehen)
// =========================================================
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = session.client_reference_id;
        await pool.query('UPDATE users SET is_premium = true WHERE id = $1', [userId]);
        console.log(`✅ User ${userId} ist nun Premium.`);
    }
    res.json({received: true});
});

// =========================================================
// 2. MIDDLEWARES
// =========================================================
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); 
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization'); 
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// PREMIUM-CHECK MIDDLEWARE
async function authenticatePremiumUser(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: "LOGIN_REQUIRED" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userRes = await pool.query("SELECT is_premium FROM users WHERE id = $1", [decoded.id]);
        if (userRes.rows[0]?.is_premium) {
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
// 3. ROUTEN (LOGIN & CHECKOUT)
// =========================================================

app.get("/", (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post("/auth/register", async (req, res) => {
    const { email, password } = req.body;
    const hash = await bcrypt.hash(password, 10);
    try {
        await pool.query("INSERT INTO users (email, password_hash) VALUES ($1, $2)", [email, hash]);
        res.json({ message: "OK" });
    } catch (err) { res.status(400).json({ error: "Existiert bereits" }); }
});

app.post("/auth/login", async (req, res) => {
    const { email, password } = req.body;
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = result.rows[0];
    if (user && await bcrypt.compare(password, user.password_hash)) {
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '365d' });
        res.json({ token, is_premium: user.is_premium });
    } else { res.status(401).json({ error: "Falsche Daten" }); }
});

app.post("/create-checkout-session", async (req, res) => {
    const { token } = req.body;
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card', 'paypal'],
            line_items: [{ price: 'prod_TgoVTxiS889LzO', quantity: 1 }],
            mode: 'subscription',
            success_url: 'https://pokecardscout-api.onrender.com?status=success',
            cancel_url: 'https://pokecardscout-api.onrender.com?status=cancel',
            client_reference_id: decoded.id.toString(),
        });
        res.json({ url: session.url });
    } catch (err) { res.status(500).json({ error: "Fehler" }); }
});

// =========================================================
// 4. PREIS-ROUTE (JETZT GESCHÜTZT)
// =========================================================
app.get("/prices", authenticatePremiumUser, async (req, res) => {
    const { set: setSlug, cardNumber } = req.query;
    try {
        const dbRes = await pool.query("SELECT tcg_player_id FROM card_mapping WHERE cardmarket_slug = $1 AND card_number = $2", [setSlug, cardNumber.padStart(3, '0')]);
        const tcgId = dbRes.rows[0]?.tcg_player_id;
        if (!tcgId) return res.status(404).json({ error: "Kein Mapping" });

        const response = await fetch(`${API_BASE_URL}/v1/cards?tcgplayerId=${tcgId}`, { headers: { "X-API-KEY": API_KEY } });
        const data = await response.json();
        const card = data.data?.[0];

        // Einfaches Mapping
        const prices = { 'MARKET PRICE': null };
        if (card?.variants) {
            const nm = card.variants.find(v => v.condition.toUpperCase().includes("NEAR MINT"));
            prices['MARKET PRICE'] = nm ? nm.price : card.variants[0]?.price;
        }

        res.json({ prices, fullTitle: card?.name || "Unbekannt" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
