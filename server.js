// server.js - STABILE, KORRIGIERTE VERSION (Finaler Versuch der Logik-Korrektur)

const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE_URL_PPT = "https://api.pokeprice.io/v2";

const API_KEY = process.env.PPT_API_KEY; 
const EXTENSION_ID_SECRET = process.env.EXTENSION_ID_SECRET; 
const DATABASE_URL = process.env.DATABASE_URL;

// ⚠️ PRÜFUNG DER KRITISCHEN ENVS
if (!DATABASE_URL || !API_KEY || !EXTENSION_ID_SECRET) {
    console.error("FATAL ERROR: Eine oder mehrere kritische Umgebungsvariablen (DATABASE_URL, PPT_API_KEY, EXTENSION_ID_SECRET) fehlen. Server wird beendet.");
    process.exit(1); 
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json());

// ... (mapAndFilterPrices, aggregatePsaData, CORS und Authentifizierung sind unverändert) ...

// =========================================================
// HILFSFUNKTIONEN (ANGEPASST: KORREKTUR DER KARTENNUMMER)
// =========================================================

async function fetchPriceTrackerApi(endpoint) {
    // Unverändert
    const apiUrl = `${API_BASE_URL_PPT}${endpoint}`;
    //... (Restliche Logik wie zuvor)
}

// HILFSFUNKTION: TCGplayer ID aus der Datenbank abrufen
async function getTcgPlayerIdFromDb(setSlug, cardNumber) {
    if (!pool) {
         throw new Error("DATABASE_ERROR: Datenbank-Pool ist nicht initialisiert.");
    }
    
    // ⚠️ KORREKTUR: Wir passen die Kartennummer an das Datenbankformat an.
    let dbCardNumber = cardNumber;
    
    // Wenn die Nummer numerisch aussieht und kürzer als 3 Zeichen ist, 
    // füllen wir sie mit führenden Nullen auf (z.B. '25' -> '025').
    if (cardNumber.length < 3 && !isNaN(parseInt(cardNumber))) {
        dbCardNumber = cardNumber.padStart(3, '0');
    }
    
    const query = `
        SELECT tcg_player_id
        FROM card_mapping 
        WHERE cardmarket_slug = $1 AND card_number = $2;
    `;
    
    // Wir verwenden die angepasste Nummer für die Datenbankabfrage
    const values = [setSlug, dbCardNumber]; 
    
    console.log(`[DB QUERY] Suche nach Slug: ${setSlug}, Angepasste Nummer: ${dbCardNumber}`);

    const client = await pool.connect();
    try {
        const result = await client.query(query, values);
        if (result.rows.length > 0) {
            return result.rows[0].tcg_player_id; 
        }
        return null; 
    } catch (err) {
        console.error("Datenbankabfragefehler:", err.message);
        throw new Error("DATABASE_QUERY_FAILED");
    } finally {
        client.release();
    }
}

// ... (ROUTE /prices ist unverändert) ...

// =========================================================
// SERVER START
// =========================================================

app.get("/", (req, res) => {
    res.send("PokeCardScout API läuft.");
});

app.listen(PORT, async () => {
    console.log(`Server läuft auf Port ${PORT}`);
    try {
        await pool.query('SELECT NOW()');
        console.log("✅ Neon-Datenbank erfolgreich verbunden.");
    } catch (err) {
        console.error("❌ Fehler bei der Neon-Datenbankverbindung:", err.message);
    }
});
