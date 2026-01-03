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

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// =========================================================
// 1. STRIPE WEBHOOK (Vor express.json!)
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
        await pool.query(
            'UPDATE users SET is_premium = true, premium_until = $1, stripe_customer_id = $2, cancel_at_period_end = false WHERE id = $3',
            [expiryDate, session.customer, session.client_reference_id]
        );
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
        const sub = event.data.object;
        await pool.query(
            'UPDATE users SET cancel_at_period_end = $1 WHERE stripe_customer_id = $2',
            [sub.cancel_at_period_end, sub.customer]
        );
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

// =========================================================
// 2. AUTH MIDDLEWARE & ROUTEN
// =========================================================

async function authenticateUser(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.split(' ')[1]) || req.body.token;
    if (!token) return res.status(401).json({ error: "LOGIN_REQUIRED" });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = (await pool.query("SELECT * FROM users WHERE id = $1", [decoded.id])).rows[0];
        if (!user) return res.status(401).json({ error: "USER_NOT_FOUND" });
        req.user = user;
        next();
    } catch (err) { res.status(403).json({ error: "INVALID_TOKEN" }); }
}

app.post("/register", async (req, res) => {
    const { email, password } = req.body;
    try {
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        await pool.query("INSERT INTO users (email, password_hash, is_premium, created_at) VALUES ($1, $2, false, NOW())", [email, passwordHash]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Registrierung fehlgeschlagen" }); }
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = (await pool.query("SELECT * FROM users WHERE email = $1", [email])).rows[0];
        if (user && await bcrypt.compare(password, user.password_hash)) {
            const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);
            res.json({ 
                token, is_premium: user.is_premium, 
                premium_until: user.premium_until,
                cancel_at_period_end: user.cancel_at_period_end 
            });
        } else { res.status(401).json({ error: "Daten falsch" }); }
    } catch (e) { res.status(500).json({ error: "Serverfehler" }); }
});

app.post("/login_check", authenticateUser, async (req, res) => {
    res.json({ 
        email: req.user.email,
        is_premium: req.user.is_premium, 
        premium_until: req.user.premium_until,
        cancel_at_period_end: req.user.cancel_at_period_end
    });
});

// =========================================================
// 3. STRIPE SESSIONS
// =========================================================

app.post("/create-portal-session", authenticateUser, async (req, res) => {
    try {
        const session = await stripe.billingPortal.sessions.create({
            customer: req.user.stripe_customer_id,
            return_url: 'https://pokecardscout-api.onrender.com/index.html',
        });
        res.json({ url: session.url });
    } catch (e) { res.status(500).json({ error: "Portal Fehler" }); }
});

app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
