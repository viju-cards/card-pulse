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

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); 
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization'); 
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// --- AUTHENTIFIZIERUNG ---

// REGISTRIERUNG (Einfach & Direkt)
app.post("/register", async (req, res) => {
    const { email, password } = req.body;
    try {
        const existingUser = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: "Dieser Benutzername/E-Mail existiert bereits." });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        await pool.query(
            "INSERT INTO users (email, password_hash, is_premium, created_at) VALUES ($1, $2, $3, NOW())",
            [email, passwordHash, false]
        );

        res.json({ success: true, message: "Konto erfolgreich erstellt!" });
    } catch (err) {
        res.status(500).json({ error: "Fehler bei der Registrierung." });
    }
});

// LOGIN (Mit detaillierten Fehlermeldungen)
app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = (await pool.query("SELECT * FROM users WHERE email = $1", [email])).rows[0];
        
        if (!user) {
            return res.status(401).json({ error: "Kein Account mit dieser E-Mail gefunden." });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (isMatch) {
            const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '365d' });
            res.json({ token, is_premium: user.is_premium, premium_until: user.premium_until });
        } else { 
            res.status(401).json({ error: "Das Passwort ist falsch." }); 
        }
    } catch (e) { res.status(500).json({ error: "Serverfehler." }); }
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

// PREIS ABFRAGE
app.get("/prices", authenticatePremiumUser, async (req, res) => {
    const { set: setSlug, cardNumber } = req.query;
    let dbNum = cardNumber.padStart(3, '0');
    try {
        const dbRes = await pool.query(
            "SELECT tcg_player_id FROM card_mapping WHERE cardmarket_slug = $1 AND card_number = $2", 
            [setSlug, dbNum]
        );
        const tcgId = dbRes.rows[0]?.tcg_player_id;
        if (!tcgId) return res.status(404).json({ error: "Mapping fehlt" });

        const apiRes = await fetch(`${API_BASE_URL}/v1/cards?tcgplayerId=${tcgId}`, { 
            headers: { "X-API-KEY": API_KEY } 
        });
        const justTcgData = await apiRes.json();
        const cardTitle = justTcgData.data?.[0]?.name || "Unbekannt";

        // Hilfsfunktion mapAndFilterPrices (wie zuvor) einfügen
        const mappedPrices = (data) => {
             const cardData = data.data?.[0];
             if (!cardData?.variants) return {};
             let all = cardData.variants.map(v => v.price).filter(p => typeof p === 'number');
             return {
                 LOW: all.length ? Math.min(...all).toFixed(2) : '--',
                 MARKET: all.length ? all[0].toFixed(2) : '--',
                 HIGH: all.length ? Math.max(...all).toFixed(2) : '--'
             };
        };

        res.json({ prices: mappedPrices(justTcgData), fullTitle: cardTitle });
    } catch (err) { res.status(500).json({ error: "SERVER_
