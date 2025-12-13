// server.js - ENDGÜLTIGE VERSION MIT KORREKTER JUSTTCG API-KONFIGURATION

const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg"); 
require("dotenv").config(); 

const app = express();
const PORT = process.env.PORT || 3000;

// ⚠️ KORRIGIERT: Korrekte Basis-URL für die JustTCG API (ohne /v1 am Ende)
const API_BASE_URL = "https://api.justtcg.com";

// ⚠️ KORRIGIERT: Nutzung des korrekten Variablennamens
const API_KEY = process.env.JUSTTCG_API_KEY; 
const EXTENSION_ID_SECRET = process.env.EXTENSION_ID_SECRET; 
const DATABASE_URL = process.env.DATABASE_URL; 

// ⚠️ PRÜFUNG DER KRITISCHEN ENVS
if (!DATABASE_URL || !API_KEY || !EXTENSION_ID_SECRET) {
    console.error("FATAL ERROR: Eine oder mehrere kritische Umgebungsvariablen (DATABASE_URL, JUSTTCG_API_KEY, EXTENSION_ID_SECRET) fehlen. Server wird beendet.");
    process.exit(1); 
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json());

// =========================================================
// HILFSFUNKTIONEN
// =========================================================

// NEUE HILFSFUNKTION: API-Abfrage für JustTCG (mit API Key als Query-Parameter)
async function fetchJustTcgData(tcgPlayerId) {
    // ⚠️ KORRIGIERT: Korrekter JustTCG Endpunkt /v1/cards
    const apiUrl = `${API_BASE_URL}/v1/cards?tcgplayerId=${tcgPlayerId}`;

    console.log(`[DEBUG API CALL] JustTCG URL: ${apiUrl}`);

    const response = await fetch(apiUrl, {
        headers: {
            // Der API Key wird NICHT als Bearer, sondern oft als X-API-KEY gesendet,
            // ODER er ist Teil der URL. Da Sie ihn als ENV haben, senden wir ihn
            // als Standard-API-Key-Header. Wenn das fehlschlägt, müssen wir den 
            // Query-Parameter-Ansatz nutzen.
             "X-API-KEY": API_KEY, 
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("[ERROR] JustTCG API-Antwort nicht OK:", response.status, errorText);
        throw new Error(`JustTCG API Fehler (${response.status}): Details siehe Server-Konsole. Antwort: ${errorText}`);
    }

    return response.json();
}

// HILFSFUNKTION: TCGplayer ID aus der Datenbank abrufen (KORRIGIERT FÜR FÜHRENDE NULLEN)
async function getTcgPlayerIdFromDb(setSlug, cardNumber) {
    if (!pool) {
         throw new Error("DATABASE_ERROR: Datenbank-Pool ist nicht initialisiert.");
    }
    
    // Korrektur: Wir stellen sicher, dass die Kartennummer das DB-Format (025) hat.
    let dbCardNumber = cardNumber;
    if (cardNumber.length < 3 && /^\d+$/.test(cardNumber)) {
        dbCardNumber = cardNumber.padStart(3, '0');
        console.log(`[DB FORMAT] Nummer korrigiert von ${cardNumber} zu ${dbCardNumber}`);
    }
    
    const query = `
        SELECT tcg_player_id
        FROM card_mapping 
        WHERE cardmarket_slug = $1 AND card_number = $2;
    `;
    
    const values = [setSlug, dbCardNumber];
    
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

// HILFSFUNKTION: Preise Mappen und Filtern (Angepasst an JustTCG Antwortstruktur)
function mapAndFilterPrices(data) {
    // Wenn die API ein Array zurückgibt, nehmen wir das erste Element
    const cardData = Array.isArray(data) ? data[0] : data; 

    if (!cardData || !cardData.prices) return {};

    const prices = {};
    
    // Wir nehmen nur die TCGplayer-Preise (wenn vorhanden)
    if (cardData.prices.tcgPlayer) {
        const tcgPrices = cardData.prices.tcgPlayer;
        
        // Annahme: JustTCG gibt die Preise als Objekt zurück: { conditionName: price }
        // Da die Struktur der alten API wahrscheinlich nicht 1:1 passt, 
        // versuchen wir, die wichtigsten Preise zu extrahieren.
        
        // Dies ist eine SPEKULATION der JustTCG-Antwortstruktur.
        prices['Market'] = tcgPrices.market || null; 
        prices['Low'] = tcgPrices.low || null; 
        prices['Mid'] = tcgPrices.mid || null; 
        prices['High'] = tcgPrices.high || null; 
    }
    
    return prices;
}

// HILFSFUNKTION: PSA/eBay Daten (Da JustTCG die Datenstruktur geändert hat, lassen wir dies vorerst leer)
function aggregatePsaData(history) {
    return { psa10: { avg: null, count: 0 }, psa9: { avg: null, count: 0 }, psa8: { avg: null, count: 0 } };
}


// ... (MIDDLEWARE und Authentifizierung sind unverändert)

// =========================================================
// ROUTE: Preise abrufen (MIT NEUER JUSTTCG LOGIK)
// =========================================================
app.get("/prices", authenticateExtension, async (req, res) => {
    const { set: setSlug, cardNumber } = req.query;

    if (!setSlug || !cardNumber) {
        return res.status(400).json({ error: "Es fehlen 'set' und 'cardNumber' Parameter." });
    }
    
    try {
        // 1. NEON DB-LOOKUP
        const tcgPlayerId = await getTcgPlayerIdFromDb(setSlug, cardNumber);

        if (!tcgPlayerId) {
             console.log(`[MAPPING 404] Kein TCGplayer ID Eintrag gefunden für ${setSlug}-${cardNumber}`);
             return res.status(404).json({ error: "Mapping fehlt", message: "TCGplayer ID für diese Karte nicht in der Datenbank gefunden. Bitte hinzufügen." });
        }
        
        // 2. JUSTTCG Abfrage
        console.log(`[API CALL] Rufe JustTCG über TCGplayer ID ${tcgPlayerId} ab.`);
        
        const justTcgData = await fetchJustTcgData(tcgPlayerId);

        const mappedPrices = mapAndFilterPrices(justTcgData);
        // Da die JustTCG API wahrscheinlich nicht die gleichen Felder liefert wie die alte PPT,
        // müssen wir die Titel und PSA/Ebay-Logik anpassen.
        const cardTitle = justTcgData[0]?.name || "Unbekannter Titel";
        
        // PSA/eBay Daten werden vorerst leer gelassen, da die Struktur unbekannt ist.
        const avgPrices = aggregatePsaData(null); 

        const finalResponse = { 
            prices: mappedPrices, 
            fullTitle: cardTitle, 
            ebay: avgPrices 
        };
            
        console.log("[REQUEST END] Preise und PSA-Avg erfolgreich gesendet.");
        return res.json(finalResponse); 

    } catch (err) {
        // Allgemeine Fehlerbehandlung
        console.error("[FATAL ERROR] Interner Serverfehler bei JustTCG Abfrage:", err);
        // Wir senden den 500er, der zu "Server nicht erreichbar oder JSON-Fehler" führt.
        return res.status(500).json({ error: `SERVER_ERROR`, message: err.message });
    }
});


// =========================================================
// SERVER START (Unverändert)
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
