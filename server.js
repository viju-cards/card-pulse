// server.js - KORRIGIERTE VERSION MIT BEREINIGUNG DER KARTENNUMMER

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

if (!DATABASE_URL) {
    console.error("FATAL ERROR: DATABASE_URL fehlt in den Umgebungsvariablen!");
    process.exit(1); 
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json());

// ... (mapAndFilterPrices, aggregatePsaData, CORS und Authentifizierung sind unverändert) ...

// =========================================================
// HILFSFUNKTIONEN (ANGEPASST)
// =========================================================

// HILFSFUNKTION: TCGplayer ID aus der Datenbank abrufen
async function getTcgPlayerIdFromDb(setSlug, cardNumber) {
    if (!pool) {
         throw new Error("DATABASE_ERROR: Datenbank-Pool ist nicht initialisiert.");
    }
    
    // ⚠️ KORREKTUR DER KARTENNUMMER: Wir entfernen führende Nullen 
    // von der Nummer, die von der Extension kommt (z.B. "025" wird zu "25").
    // ABER: Da die Extension "25" sendet und die DB "025" speichert: 
    // Wir nutzen die PostgreSQL Funktion LTRIM, um die führende 0 aus der DB zu entfernen.
    // ODER WIR SUCHEN MIT BEIDEN FORMATEN.
    
    // Einfache Lösung: Speichere ich die Kartennummer in der DB ohne führende Nullen?
    // Wenn die Extension '25' sendet, sollte die DB '25' enthalten, ODER der Code muss
    // sowohl '25' als auch '025' zulassen.

    // Wir belassen die Kartennummer in der DB mit führender Null (025) und trimmen 
    // die eingehende Nummer '25' ebenfalls nicht. Stattdessen passen wir die DB-Suche an.
    
    // Wenn die Datenbank '025' speichert, aber die Extension '25' sendet:
    // Wir müssen die 'cardNumber' auf das Format '025' bringen, falls sie nur '25' ist.
    
    let dbCardNumber = cardNumber;
    
    // Wenn die Nummer numerisch aussieht und kürzer als 3 Zeichen ist, 
    // versuchen wir, sie mit führenden Nullen aufzufüllen, 
    // um die in der DB gespeicherte '025' zu finden.
    // Wenn die Extension '25' sendet, suchen wir nach '025'.
    // Wenn die Extension '123' sendet, suchen wir nach '123'.
    if (cardNumber.length < 3 && !isNaN(parseInt(cardNumber))) {
        // Füllt mit führenden Nullen auf, z.B. '25' -> '025'
        dbCardNumber = cardNumber.padStart(3, '0');
    }

    // Wenn die DB '25' enthält, muss diese Logik wieder entfernt werden.
    // Da Sie sagen, die DB enthält '025', verwenden wir dies.
    
    const query = `
        SELECT tcg_player_id
        FROM card_mapping 
        WHERE cardmarket_slug = $1 AND card_number = $2;
    `;
    
    const values = [setSlug, dbCardNumber];
    
    console.log(`[DB QUERY] Suche nach Slug: ${setSlug}, Nummer: ${dbCardNumber}`);

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

// ... (fetchPriceTrackerApi ist unverändert) ...


// =========================================================
// ROUTE: Preise abrufen (MIT KORRIGIERTEM DB-LOOKUP)
// =========================================================
app.get("/prices", authenticateExtension, async (req, res) => {
    // set und cardNumber kommen von der Extension
    const { set: setSlug, cardNumber } = req.query;

    if (!setSlug || !cardNumber) {
        return res.status(400).json({ error: "Es fehlen 'set' und 'cardNumber' Parameter." });
    }
    
    try {
        // 1. NEON DB-LOOKUP: Holen der TCGplayer ID (mit Nummern-Anpassung)
        const tcgPlayerId = await getTcgPlayerIdFromDb(setSlug, cardNumber);
        
        // ... (Restliche Logik ist unverändert) ...
        // (API Call, PSA, Response)

    } catch (err) {
        // ... (Fehlerbehandlung unverändert) ...
    }
});


// ... (SERVER START Logik unverändert) ...

app.listen(PORT, async () => {
    console.log(`Server läuft auf Port ${PORT}`);
    try {
        await pool.query('SELECT NOW()');
        console.log("✅ Neon-Datenbank erfolgreich verbunden.");
    } catch (err) {
        console.error("❌ Fehler bei der Neon-Datenbankverbindung:", err.message);
    }
});
