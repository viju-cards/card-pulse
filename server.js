// server.js - FINALE VERSION MIT NEON POSTGRESQL MAPPING, KORRIGIERTER KARTENNUMMER-LOGIK UND KORRIGIERTEM API-KEY-NAMEN

const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg"); // Importiert den PostgreSQL-Client
require("dotenv").config(); // Lädt Umgebungsvariablen

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE_URL_PPT = "https://api.pokeprice.io/v2";

// ⚠️ KORRIGIERT: Verwenden des neuen, korrekten Variablennamens
const API_KEY = process.env.JUSTTCG_API_KEY; 
const EXTENSION_ID_SECRET = process.env.EXTENSION_ID_SECRET; 
const DATABASE_URL = process.env.DATABASE_URL; // Ihr Neon Connection String

// ⚠️ PRÜFUNG DER KRITISCHEN ENVS: Stellt sicher, dass alle Schlüssel vorhanden sind
if (!DATABASE_URL || !API_KEY || !EXTENSION_ID_SECRET) {
    // Die Meldung wird spezifischer
    console.error("FATAL ERROR: Eine oder mehrere kritische Umgebungsvariablen (DATABASE_URL, JUSTTCG_API_KEY, EXTENSION_ID_SECRET) fehlen. Server wird beendet.");
    process.exit(1); 
}


const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false 
    }
});

app.use(express.json());

// =========================================================
// HILFSFUNKTIONEN
// =========================================================

// HILFSFUNKTION: API-Abfrage für PriceTracker
async function fetchPriceTrackerApi(endpoint) {
    const apiUrl = `${API_BASE_URL_PPT}${endpoint}`;

    if (!API_KEY) {
        // Die Fehlermeldung wird spezifischer
        throw new Error("SERVER_CONFIG_ERROR: JUSTTCG_API_KEY fehlt in der Umgebungsvariable!");
    }
    
    console.log(`[DEBUG API CALL] Abfrage URL: ${apiUrl}`);

    const response = await fetch(apiUrl, {
        headers: {
            "Authorization": `Bearer ${API_KEY}`, // Sendet den PriceTracker API Key
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("[ERROR] API-Antwort nicht OK:", response.status, errorText);
        throw new Error(`PriceTracker API Fehler (${response.status}): Details siehe Server-Konsole.`);
    }

    return response.json();
}

// HILFSFUNKTION: TCGplayer ID aus der Datenbank abrufen (KORRIGIERT FÜR FÜHRENDE NULLEN)
async function getTcgPlayerIdFromDb(setSlug, cardNumber) {
    if (!pool) {
         throw new Error("DATABASE_ERROR: Datenbank-Pool ist nicht initialisiert.");
    }

    // KORREKTUR: Wir stellen sicher, dass die Kartennummer das DB-Format hat.
    let dbCardNumber = cardNumber;
    
    // Wenn die Extension z.B. '25' sendet, aber die DB '025' speichert:
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

// HILFSFUNKTION: Preise Mappen und Filtern (unverändert)
function mapAndFilterPrices(data) {
    const prices = {};
    if (data && Array.isArray(data)) {
        data.forEach(p => {
            prices[p.conditionName] = p.price;
        });
    }
    return prices;
}

// HILFSFUNKTION: PSA-Durchschnittspreise aggregieren (unverändert)
function aggregatePsaData(history) {
    const aggregated = { psa10: { avg: null, count: 0 }, psa9: { avg: null, count: 0 }, psa8: { avg: null, count: 0 } };

    for (const grade of [10, 9, 8]) {
        const gradeKey = `psa${grade}`;
        const filteredSales = history.filter(item => item.grade === grade);
        
        if (filteredSales.length > 0) {
            const total = filteredSales.reduce((sum, item) => sum + item.price, 0);
            aggregated[gradeKey].avg = total / filteredSales.length;
            aggregated[gradeKey].count = filteredSales.length;
        }
    }
    return aggregated;
}


// MIDDLEWARE: CORS und Authentifizierung (Unverändert)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); 
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Extension-ID'); 
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

function authenticateExtension(req, res, next) {
    const extensionId = req.headers['x-extension-id']; 
    if (!EXTENSION_ID_SECRET || extensionId !== EXTENSION_ID_SECRET) {
        console.warn(`[AUTH] Unerlaubter Zugriff: ${extensionId}`);
        return res.status(401).json({ error: "REQUIRES_PREMIUM", message: "Premium-Zugriff erforderlich oder Erweiterungsschlüssel ungültig." });
    }
    console.log(`[AUTH] Erfolgreich: Erweiterung ${extensionId.substring(0, 10)}... authentifiziert.`);
    next(); 
}


// =========================================================
// ROUTE: Preise abrufen (MIT NEON DB-LOOKUP)
// =========================================================
app.get("/prices", authenticateExtension, async (req, res) => {
    const { set: setSlug, cardNumber } = req.query;

    if (!setSlug || !cardNumber) {
        return res.status(400).json({ error: "Es fehlen 'set' und 'cardNumber' Parameter." });
    }
    
    try {
        // 1. NEON DB-LOOKUP: Holen der TCGplayer ID
        const tcgPlayerId = await getTcgPlayerIdFromDb(setSlug, cardNumber);

        if (!tcgPlayerId) {
             console.log(`[MAPPING 404] Kein TCGplayer ID Eintrag gefunden für ${setSlug}-${cardNumber}`);
             return res.status(404).json({ error: "Mapping fehlt", message: "TCGplayer ID für diese Karte nicht in der Datenbank gefunden. Bitte hinzufügen." });
        }
        
        // 2. TCGPlayer Abfrage (mit der zuverlässigen TCGplayer ID)
        console.log(`[API CALL] Rufe PriceTracker über TCGplayer ID ${tcgPlayerId} ab.`);
        
        const tcgData = await fetchPriceTrackerApi(
            `/products/tcgplayer?tcgPlayerId=${tcgPlayerId}` 
        );

        const mappedPrices = mapAndFilterPrices(tcgData.prices);
        const card = tcgData.card;
        
        // 3. PSA/eBay Abfrage
        let avgPrices = {};
        if (card && card.tcgPlayerId) {
            const ebayData = await fetchPriceTrackerApi(
                `/products/psa/avg?tcgPlayerId=${card.tcgPlayerId}`
            );
            avgPrices = aggregatePsaData(ebayData.history);
        }

        const finalResponse = { 
            prices: mappedPrices, 
            fullTitle: card?.name, 
            ebay: avgPrices 
        };
            
        console.log("[REQUEST END] Preise und PSA-Avg erfolgreich gesendet.");
        return res.json(finalResponse); 

    } catch (err) {
        if (err.message.includes('SERVER_CONFIG_ERROR')) {
             return res.status(500).json({ error: "SERVER_ERROR", message: "JUSTTCG API Key fehlt." });
        }
        if (err.message.includes('404')) {
             return res.status(404).json({ error: "Karte nicht in der PriceTracker API gefunden." });
        }
        if (err.message.includes('DATABASE_QUERY_FAILED')) {
             console.error("DB ist nicht erreichbar oder hat Fehler.");
             return res.status(500).json({ error: "SERVER_ERROR", message: "Datenbankfehler." });
        }
        
        console.error("[FATAL ERROR] Interner Serverfehler:", err);
        return res.status(500).json({ error: `SERVER_ERROR`, message: err.message });
    }
});


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
