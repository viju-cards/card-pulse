// server.js - FINALE VERSION MIT ROBUSTER DB-LOGIK

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

// ⚠️ PRÜFUNG DER KRITISCHEN ENVS (Verhindert Fehler 1)
if (!DATABASE_URL || !API_KEY || !EXTENSION_ID_SECRET) {
    console.error("FATAL ERROR: Eine oder mehrere kritische Umgebungsvariablen (DATABASE_URL, PPT_API_KEY, EXTENSION_ID_SECRET) fehlen. Server wird beendet.");
    process.exit(1); 
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json());

// =========================================================
// HILFSFUNKTIONEN (ANGEPASST)
// =========================================================

// HILFSFUNKTION: TCGplayer ID aus der Datenbank abrufen
async function getTcgPlayerIdFromDb(setSlug, cardNumber) {
    if (!pool) {
         throw new Error("DATABASE_ERROR: Datenbank-Pool ist nicht initialisiert.");
    }
    
    // Die Nummer, die von der Extension kommt (z.B. '25')
    const incomingNumber = cardNumber; 
    
    // Die Nummer mit führender Null (z.B. '025')
    let paddedNumber = incomingNumber;
    if (incomingNumber.length < 3 && !isNaN(parseInt(incomingNumber))) {
        paddedNumber = incomingNumber.padStart(3, '0');
    }
    
    // ⚠️ ROBUSTE ABFRAGE: Sucht sowohl nach '25' als auch nach '025'
    // UNABHÄNGIG davon, wie die Nummer in der Datenbank gespeichert ist.
    const query = `
        SELECT tcg_player_id
        FROM card_mapping 
        WHERE cardmarket_slug = $1 
        AND (card_number = $2 OR card_number = $3);
    `;
    
    const values = [setSlug, incomingNumber, paddedNumber]; // $2 = '25', $3 = '025'
    
    console.log(`[DB QUERY] Suche nach Slug: ${setSlug}, Nummern: ${incomingNumber} / ${paddedNumber}`);

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

// ... (Restliche Funktionen fetchPriceTrackerApi, mapAndFilterPrices etc. sind unverändert) ...

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
        // Auch hier ein Exit, falls die Verbindung fehlschlägt, 
        // um den Server in einem sauberen Zustand neu starten zu lassen.
        // process.exit(1); 
    }
});
