const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg"); 
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer"); // NEU: Für E-Mails
const crypto = require("crypto"); // NEU: Für Tokens
const path = require("path");
require("dotenv").config(); 

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// E-Mail Transporter Konfiguration (z.B. Gmail oder Outlook)
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST, 
    port: 587,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- NEU: VERIFIZIERUNGS-ROUTE ---
app.get("/verify-email", async (req, res) => {
    const { token } = req.query;
    try {
        const result = await pool.query(
            "UPDATE users SET is_verified = true, verification_token = null WHERE verification_token = $1 RETURNING email",
            [token]
        );
        if (result.rows.length > 0) {
            res.send("<h1>E-Mail erfolgreich verifiziert!</h1><p>Du kannst dich jetzt im Tool einloggen.</p>");
        } else {
            res.status(400).send("Ungültiger oder abgelaufener Verifizierungs-Link.");
        }
    } catch (err) {
        res.status(500).send("Serverfehler bei der Verifizierung.");
    }
});

// --- REGISTRIERUNG MIT DOI ---
app.post("/register", async (req, res) => {
    const { email, password } = req.body;
    try {
        const existingUser = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: "E-Mail bereits registriert." });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        const verificationToken = crypto.randomBytes(32).toString('hex'); // Token generieren

        await pool.query(
            "INSERT INTO users (email, password_hash, is_premium, created_at, is_verified, verification_token) VALUES ($1, $2, $3, NOW(), $4, $5)",
            [email, passwordHash, false, false, verificationToken]
        );

        // Bestätigungs-E-Mail senden
        const verifyUrl = `https://pokecardscout-api.onrender.com/verify-email?token=${verificationToken}`;
        await transporter.sendMail({
            from: '"PokéScout Pro" <no-reply@deinedomain.com>',
            to: email,
            subject: "Bestätige deine Registrierung",
            html: `<p>Vielen Dank für deine Registrierung! Klicke auf den Link, um dein Konto zu aktivieren:</p>
                   <a href="${verifyUrl}">${verifyUrl}</a>`
        });

        res.json({ success: true, message: "Bitte prüfe dein Postfach zur Aktivierung!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Fehler bei der Registrierung." });
    }
});

// --- LOGIN CHECK ---
app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        const user = result.rows[0];
        
        if (!user) return res.status(401).json({ error: "Kein Account gefunden." });
        
        // Prüfung: Verifiziert?
        if (!user.is_verified) {
            return res.status(403).json({ error: "Bitte bestätige erst deine E-Mail Adresse." });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (isMatch) {
            const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '365d' });
            res.json({ token, is_premium: user.is_premium });
        } else { 
            res.status(401).json({ error: "Passwort falsch." }); 
        }
    } catch (e) { res.status(500).json({ error: "Serverfehler." }); }
});

// ... (Rest der server.js wie /prices und /create-checkout-session)

app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
