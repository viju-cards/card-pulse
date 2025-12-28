// server.js - VOLLSTÄNDIGE VERSION MIT AUTH, STRIPE & PREIS-LOGIK
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

// Umgebungsvariablen prüfen
const API_BASE_URL = "https://api.justtcg.com";
const API_KEY = process.env.JUSTTCG_API_KEY; 
const EXTENSION_ID_SECRET = process.env.EXTENSION_ID_SECRET; 
const DATABASE_URL = process.env.DATABASE_URL; 
const JWT_SECRET = process.env.JWT_SECRET;

if (!DATABASE_URL || !API_KEY || !EXTENSION_ID_SECRET || !JWT_SECRET) {
    console.error("FATAL ERROR: Kritische Umgebungsvariablen fehlen!");
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
        console.error("Webhook Fehler:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = session.client_reference_id;

        // User in der Datenbank auf Premium setzen
        try {
            await pool.query('UPDATE users SET is_premium = true WHERE id = $1', [userId]);
            console.log(`✅ User ${userId} wurde auf Premium hochgestuft.`);
        } catch (dbErr) {
            console.error("Fehler beim DB-Update nach Zahlung:", dbErr.message);
        }
    }
    res.json({received: true});
});

// =========================================================
// 2. MIDDLEWARES & STATISCHE DATEIEN
// =========================================================
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// CORS für die Chrome Extension
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); 
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Extension-ID, Authorization'); 
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// =========================================================
// 3. AUTH & USER ROUTEN
// =========================================================

// Startseite / Login-Formular
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Registrierung
app.post("/auth/register", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Daten unvollständig" });
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query("INSERT INTO users (email, password_hash) VALUES ($1, $2)", [email, hash]);
        res.json({ message: "Erfolg" });
    } catch (err) {
        res.status(400).json({ error: "Email vergeben" });
    }
});

// Login
app.post("/auth/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        const user = result.rows[0];
        if (user && await bcrypt.compare(password, user.password_hash)) {
            const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '365d' });
            res.json({ token, is_premium: user.is_premium });
        } else {
            res.status(401).json({ error: "Falsche Daten" });
        }
    } catch (err) {
        res.status(500).json({ error: "Serverfehler" });
    }
});

// =========================================================
// 4. STRIPE CHECKOUT
// =========================================================
app.post("/create-checkout-session", async (req, res) => {
    const { token } = req.body;
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card', 'paypal'],
            line_items: [{
                price: 'prod_TgoVTxiS889LzO', // <--- DEINE STRIPE PRICE-ID HIER EINTRAGEN
                quantity: 1,
            }],
            mode: 'subscription',
            success_url: 'https://pokecardscout-api.onrender.com?status=success',
            cancel_url: 'https://pokecardscout-api.onrender.com?status=cancel',
            client_reference_id: decoded.id.toString(),
        });
        res.json({ url: session.url });
    } catch (err) {
        res.status(500).json({ error: "Checkout fehlgeschlagen" });
    }
});

// =========================================================
// 5. PREIS ABFRAGE (KORRIGIERT)
// =========================================================

function authenticateExtension(req, res, next) {
    const extensionId = req.headers['x-extension-id']; 
    if (!EXTENSION_ID_SECRET || extensionId !== EXTENSION_ID_SECRET) {
        return res.status(401).json({ error: "REQUIRES_PREMIUM" });
    }
    next(); 
}

app.get("/prices", authenticateExtension, async (req, res) => {
    const { set: setSlug, cardNumber } = req.query;
    if (!setSlug || !cardNumber) return res.status(400).json({ error: "Parameter fehlen" });
    
    try {
        // TCGplayer ID aus DB holen
        let dbCardNumber = cardNumber.padStart(3, '0');
        const dbRes = await pool.query(
            "SELECT tcg_player_id FROM card_mapping WHERE cardmarket_slug = $1 AND card_number = $2",
            [setSlug, dbCardNumber]
        );
        const tcgPlayerId = dbRes.rows[0]?.tcg_player_id;

        if (!tcgPlayerId) return res.status(404).json({ error: "Kein Mapping gefunden" });
        
        // JustTCG API Call
        const response = await fetch(`${API_BASE_URL}/v1/cards?tcgplayerId=${tcgPlayerId}`, {
            headers: { "X-API-KEY": API_KEY },
        });
        const data = await response.json();
        const cardData = data.data?.[0];

        // Preise mappen
        const prices = {};
        if (cardData?.variants) {
            let all = [];
            let conds = {};
            cardData.variants.forEach(v => {
                if (typeof v.price === 'number') {
                    all.push(v.price);
                    let c = v.condition.toUpperCase().trim();
                    if (!conds[c] || v.price < conds[c]) conds[c] = v.price;
                }
            });
            prices['LOW'] = Math.min(...all);
            prices['HIGH'] = Math.max(...all);
            prices['NEAR MINT'] = conds['NEAR MINT'] || null;
            prices['MARKET PRICE'] = prices['NEAR MINT'];
            prices['LIGHTLY PLAYED'] = conds['LIGHTLY PLAYED'] || null;
            prices['MODERATELY PLAYED'] = conds['MODERATELY PLAYED'] || null;
            prices['HEAVILY PLAYED'] = conds['HEAVILY PLAYED'] || null;
            prices['DAMAGED/POOR'] = conds['DAMAGED'] || conds['POOR'] || null;
        }

        return res.json({ 
            prices, 
            fullTitle: cardData?.name || "Unbekannt", 
            ebay: { psa10: { avg: null, count: 0 }, psa9: { avg: null, count: 0 }, psa8: { avg: null, count: 0 } }
        }); 
    } catch (err) {
        res.status(500).json({ error: "Fehler", message: err.message });
    }
});

// =========================================================
// START
// =========================================================
app.listen(PORT, async () => {
    console.log(`Server läuft auf Port ${PORT}`);
    try {
        await pool.query('SELECT NOW()');
        console.log("✅ Datenbank bereit.");
    } catch (err) {
        console.error("❌ DB Fehler:", err.message);
    }
});
