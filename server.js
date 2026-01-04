const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg"); 
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const path = require("path");
require("dotenv").config(); 

const app = express();
const PORT = process.env.PORT || 10000; 

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
// 1. CORS & MIDDLEWARES (Muss GANZ OBEN stehen)
// =========================================================

app.use((req, res, next) => {
    const origin = req.headers.origin;
    // Erlaubt deine Domains und Cardmarket für die Extension
    const allowedOrigins = [
        'https://www.poke-scout.com', 
        'https://poke-scout.com', 
        'https://www.cardmarket.com'
    ];
    
    if (allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    } else {
        // Fallback für Anfragen ohne Origin-Header (z.B. einige Extension-Anfragen)
        res.header('Access-Control-Allow-Origin', '*'); 
    }

    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');

    // Beantwortet die Vorabanfrage (Preflight) des Browsers sofort
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// WICHTIG: Stripe Webhook muss VOR express.json stehen
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) { 
        console.error(`❌ Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`); 
    }

    try {
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 32); 
            
            await pool.query(
                'UPDATE users SET is_premium = true, premium_until = $1, stripe_customer_id = $2, cancel_at_period_end = false WHERE id = $3',
                [expiryDate, session.customer, session.client_reference_id]
            );
            console.log(`✅ Checkout erfolgreich für User: ${session.client_reference_id}`);
        } 
        else if (event.type === 'customer.subscription.updated') {
            const subscription = event.data.object;
            let expiryDate = subscription.current_period_end 
                ? new Date(subscription.current_period_end * 1000) 
                : null;

            if (expiryDate && !isNaN(expiryDate.getTime())) {
                await pool.query(
                    'UPDATE users SET cancel_at_period_end = $1, premium_until = $2 WHERE stripe_customer_id = $3',
                    [subscription.cancel_at_period_end, expiryDate, subscription.customer]
                );
            } else {
                await pool.query(
                    'UPDATE users SET cancel_at_period_end = $1 WHERE stripe_customer_id = $2',
                    [subscription.cancel_at_period_end, subscription.customer]
                );
            }
        }
        else if (event.type === 'customer.subscription.deleted') {
            const subscription = event.data.object;
            await pool.query(
                'UPDATE users SET is_premium = false, cancel_at_period_end = false WHERE stripe_customer_id = $1',
                [subscription.customer]
            );
        }
        res.json({ received: true });
    } catch (dbErr) {
        console.error("❌ Datenbank-Fehler im Webhook:", dbErr.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================
// 2. HEALTH CHECK & ROUTES
// =========================================================

app.get("/health", (req, res) => {
    res.send("Server ist wach und erreichbar!");
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post("/login_check", async (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: "No token provided" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const result = await pool.query("SELECT is_premium, premium_until, cancel_at_period_end FROM users WHERE id = $1", [decoded.id]);
        const user = result.rows[0];
        if (!user) return res.status(404).json({ error: "User not found" });
        res.json({
            is_premium: user.is_premium,
            premium_until: user.premium_until,
            cancel_at_period_end: user.cancel_at_period_end
        });
    } catch (err) { res.status(401).json({ error: "Invalid token" }); }
});

app.post("/register", async (req, res) => {
    const { email, password } = req.body;
    try {
        const existingUser = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
        if (existingUser.rows.length > 0) return res.status(400).json({ error: "E-Mail bereits vergeben." });

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        await pool.query(
            "INSERT INTO users (email, password_hash, is_premium, created_at, cancel_at_period_end) VALUES ($1, $2, $3, NOW(), false)",
            [email, passwordHash, false]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Serverfehler." }); }
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        const user = result.rows[0];
        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: "Logindaten ungültig." });
        }
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '365d' });
        res.json({ 
            token, is_premium: user.is_premium, premium_until: user.premium_until,
            cancel_at_period_end: user.cancel_at_period_end 
        });
    } catch (e) { res.status(500).json({ error: "Serverfehler." }); }
});

// Middleware für Premium-Check
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
        } else { res.status(403).json({ error: "PAYMENT_REQUIRED" }); }
    } catch (err) { res.status(403).json({ error: "INVALID_TOKEN" }); }
}

// =========================================================
// 3. PREIS LOGIK & STRIPE
// =========================================================

app.get("/prices", authenticatePremiumUser, async (req, res) => {
    const { set: setSlug, cardNumber } = req.query;
    try {
        const dbRes = await pool.query(
            "SELECT tcg_player_id FROM card_mapping WHERE cardmarket_slug = $1 AND card_number = $2", 
            [setSlug, cardNumber] 
        );
        const tcgId = dbRes.rows[0]?.tcg_player_id;
        if (!tcgId) return res.status(404).json({ error: "Mapping fehlt" });

        const apiRes = await fetch(`${API_BASE_URL}/v1/cards?tcgplayerId=${tcgId}`, { headers: { "X-API-KEY": API_KEY } });
        const justTcgData = await apiRes.json();
        
        res.json({ data: justTcgData });
    } catch (err) { res.status(500).json({ error: "SERVER_ERROR" }); }
});

app.post("/create-checkout-session", async (req, res) => {
    try {
        const { token } = req.body;
        const decoded = jwt.verify(token, JWT_SECRET);
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card', 'paypal'],
            line_items: [{ price: 'price_1SjQsWFUZXbTt9dyq5MqFi06', quantity: 1 }], 
            mode: 'subscription',
            success_url: 'https://poke-scout.com/index.html?status=success',
            cancel_url: 'https://poke-scout.com/index.html?status=cancel',
            client_reference_id: decoded.id.toString(),
        });
        res.json({ url: session.url });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/create-portal-session", async (req, res) => {
    try {
        const { token } = req.body;
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = (await pool.query("SELECT stripe_customer_id FROM users WHERE id = $1", [decoded.id])).rows[0];
        if (!user?.stripe_customer_id) return res.status(400).json({ error: "Keine Stripe-ID." });

        const portalSession = await stripe.billingPortal.sessions.create({
            customer: user.stripe_customer_id,
            return_url: 'https://poke-scout.com/index.html',
        });
        res.json({ url: portalSession.url });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`🚀 Server läuft auf Port ${PORT}`));
