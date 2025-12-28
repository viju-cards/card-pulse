// server.js - VERSION MIT LOGIN-SUPPORT UND STATISCHEM WEBSERVER
const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg"); 
const bcrypt = require("bcrypt"); // NEU
const jwt = require("jsonwebtoken"); // NEU
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY); // NEU
require("dotenv").config(); 

const app = express();
const PORT = process.env.PORT || 3000;

const API_BASE_URL = "https://api.justtcg.com";
const API_KEY = process.env.JUSTTCG_API_KEY; 
const EXTENSION_ID_SECRET = process.env.EXTENSION_ID_SECRET; 
const DATABASE_URL = process.env.DATABASE_URL; 
const JWT_SECRET = process.env.JWT_SECRET; // NEU

// ⚠️ PRÜFUNG DER KRITISCHEN ENVS
if (!DATABASE_URL || !API_KEY || !EXTENSION_ID_SECRET || !JWT_SECRET) {
    console.error("FATAL ERROR: Eine oder mehrere kritische Umgebungsvariablen fehlen. Server wird beendet.");
    process.exit(1); 
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// =========================================================
// MIDDLEWARES (DIE REIHENFOLGE IST HIER ENTSCHEIDEND)
// =========================================================

// 1. Statische Dateien (Deine Login-Webseite)
// Diese Zeile sorgt dafür, dass die index.html aus dem Ordner /public geladen wird
app.use(express.static('public'));

// 2. CORS Einstellungen
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); 
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Extension-ID, Authorization'); 
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// 3. JSON Parser (Wichtig für Login/Register Daten)
app.use(express.json());


// =========================================================
// AUTHENTIFIZIERUNG & NEUE USER-ROUTEN
// =========================================================

// Registrierung
app.post("/auth/register", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Daten unvollständig" });

    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            "INSERT INTO users (email, password_hash) VALUES ($1, $2)",
            [email, hash]
        );
        res.json({ message: "Registrierung erfolgreich" });
    } catch (err) {
        console.error("Registrierungsfehler:", err.message);
        res.status(400).json({ error: "Email bereits vergeben oder DB Fehler" });
    }
});

// Login
app.post("/auth/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        const user = result.rows[0];

        if (user && await bcrypt.compare(password, user.password_hash)) {
            // Token erstellen (1 Jahr gültig für die Extension)
            const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '365d' });
            res.json({ token, is_premium: user.is_premium });
        } else {
            res.status(401).json({ error: "Ungültige Anmeldedaten" });
        }
    } catch (err) {
        res.status(500).json({ error: "Serverfehler beim Login" });
    }
});

// Authentifizierungsfunktion für die Extension (Aktualisiert für JWT)
function authenticateExtension(req, res, next) {
    // Hier prüfen wir aktuell noch den alten Secret, 
    // wir können hier später auf JWT umstellen (req.headers.authorization)
    const extensionId = req.headers['x-extension-id']; 
    if (!EXTENSION_ID_SECRET || extensionId !== EXTENSION_ID_SECRET) {
        return res.status(401).json({ error: "REQUIRES_PREMIUM" });
    }
    next(); 
}

// =========================================================
// HILFSFUNKTIONEN FÜR PREISE (BLEIBEN GLEICH)
// =========================================================

async function fetchJustTcgData(tcgPlayerId) {
    const response = await fetch(`${API_BASE_URL}/v1/cards?tcgplayerId=${tcgPlayerId}`, {
        headers: { "X-API-KEY": API_KEY },
    });
    if (!response.ok) throw new Error(`JustTCG API Fehler (${response.status})`);
    return response.json();
}

async function getTcgPlayerIdFromDb(setSlug, cardNumber) {
    let dbCardNumber = cardNumber;
    if (cardNumber.length < 3 && /^\d+$/.test(cardNumber)) {
        dbCardNumber = cardNumber.padStart(3, '0');
    }
    const result = await pool.query(
        "SELECT tcg_player_id FROM card_mapping WHERE cardmarket_slug = $1 AND card_number = $2",
        [setSlug, dbCardNumber]
    );
    return result.rows.length > 0 ? result.rows[0].tcg_player_id : null;
}

function mapAndFilterPrices(data) {
    const cardData = data.data?.[0];
    if (!cardData?.variants) return {};
    const prices = {};
    let allPrices = [];
    let conditionPrices = {};

    cardData.variants.forEach(v => {
        if (typeof v.price === 'number') {
            const cond = v.condition.toUpperCase().trim();
            allPrices.push(v.price);
            if (!conditionPrices[cond] || v.price < conditionPrices[cond]) conditionPrices[cond] = v.price;
        }
    });

    prices['LOW'] = Math.min(...allPrices);
    prices['HIGH'] = Math.max(...allPrices);
    prices['NEAR MINT'] = conditionPrices['NEAR MINT'] || null;
    prices['MARKET PRICE'] = prices['NEAR MINT'];
    prices['LIGHTLY PLAYED'] = conditionPrices['LIGHTLY PLAYED'] || null;
    prices['MODERATELY PLAYED'] = conditionPrices['MODERATELY PLAYED'] || null;
    prices['HEAVILY PLAYED'] = conditionPrices['HEAVILY PLAYED'] || null;
    prices['DAMAGED/POOR'] = conditionPrices['DAMAGED'] || conditionPrices['POOR'] || null;
    return prices;
}

// =========================================================
// ROUTE: PREISE ABRUFEN
// =========================================================
app.get("/prices", authenticateExtension, async (req, res) => {
    const { set: setSlug, cardNumber } = req.query;
    if (!setSlug || !cardNumber) return res.status(400).json({ error: "Parameter fehlen" });
    
    try {
        const tcgPlayerId = await getTcgPlayerIdFromDb(setSlug, cardNumber);
        if (!tcgPlayerId) return res.status(404).json({ error: "Mapping fehlt" });
        
        const justTcgData = await fetchJustTcgData(tcgPlayerId);
        const mappedPrices = mapAndFilterPrices(justTcgData);
        const cardTitle = justTcgData.data?.[0]?.name || "Unbekannter Titel";

        return res.json({ 
            prices: mappedPrices, 
            fullTitle: cardTitle, 
            ebay: { psa10: { avg: null, count: 0 }, psa9: { avg: null, count: 0 }, psa8: { avg: null, count: 0 } }
        }); 
    } catch (err) {
        return res.status(500).json({ error: `SERVER_ERROR`, message: err.message });
    }
});

// =========================================================
// SERVER START
// =========================================================
app.get("/status", (req, res) => res.send("PokeCardScout API läuft."));

app.listen(PORT, async () => {
    console.log(`Server läuft auf Port ${PORT}`);
    try {
        await pool.query('SELECT NOW()');
        console.log("✅ Neon-Datenbank verbunden.");
    } catch (err) {
        console.error("❌ DB Fehler:", err.message);
    }
});
