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
// 1. STRIPE WEBHOOK (Muss VOR express.json stehen!)
// =========================================================
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error("Webhook Signature Error:", err.message);
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
            console.log("Premium aktiviert für User:", session.client_reference_id);
        }

        // DIESER TEIL SETZT DEIN FALSE AUF TRUE
        if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
            const subscription = event.data.object;
            const isCancelled = subscription.cancel_at_period_end;
            
            await pool.query(
                'UPDATE users SET cancel_at_period_end = $1 WHERE stripe_customer_id = $2',
                [isCancelled, subscription.customer]
            );
            console.log(`Update für Kunde ${subscription.customer}: CancelStatus = ${isCancelled}`);
        }
    } catch (dbErr) {
        console.error("Datenbankfehler im Webhook:", dbErr);
    }

    res.json({ received: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// CORS & Auth Middleware (Identisch zum vorherigen Schritt)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); 
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization'); 
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

async function authenticateUser(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: "LOGIN_REQUIRED" });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const result = await pool.query("SELECT * FROM users WHERE id = $1", [decoded.id]);
        if (result.rows.length === 0) return res.status(401).json({ error: "USER_NOT_FOUND" });
        req.user = result.rows[0];
        next();
    } catch (err) { res.status(403).json({ error: "INVALID_TOKEN" }); }
}

// ROUTEN
app.post("/login_check", authenticateUser, async (req, res) => {
    res.json({ 
        email: req.user.email,
        is_premium: req.user.is_premium, 
        premium_until: req.user.premium_until,
        cancel_at_period_end: req.user.cancel_at_period_end // Gibt den Status an das Dashboard
    });
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        const user = result.rows[0];
        if (user && await bcrypt.compare(password, user.password_hash)) {
            const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);
            res.json({ 
                token, 
                is_premium: user.is_premium, 
                premium_until: user.premium_until,
                cancel_at_period_end: user.cancel_at_period_end,
                member_since: new Date(user.created_at).toLocaleDateString('de-DE') 
            });
        } else { res.status(401).json({ error: "Login fehlgeschlagen" }); }
    } catch (e) { res.status(500).json({ error: "Serverfehler" }); }
});

app.post("/create-portal-session", authenticateUser, async (req, res) => {
    try {
        const session = await stripe.billingPortal.sessions.create({
            customer: req.user.stripe_customer_id,
            return_url: 'https://pokecardscout-api.onrender.com/index.html',
        });
        res.json({ url: session.url });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
