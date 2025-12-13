// server.js - FINALE VERSION MIT JUSTTCG & POSTGRESQL TCGPLAYER MAPPING

const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg"); // Importiert den PostgreSQL-Client
require("dotenv").config(); // Lädt Umgebungsvariablen

const app = express();
const PORT = process.env.PORT || 3000;
const JUSTTCG_BASE_URL = "https://api.justtcg.com/v1";

const API_KEY = process.env.JUSTTCG_API_KEY; 
const EXTENSION_ID_SECRET = process.env.EXTENSION_ID_SECRET; 
const DATABASE_URL = process.env.DATABASE_URL; // Der neue DB Connection String

// ⚠️ DATENBANK CONNECTION POOL
const pool = new Pool({
    connectionString: DATABASE_URL,
    // Nur für Render Free Tier: SSL muss auf 'require' gesetzt werden
    ssl: {
        rejectUnauthorized: false 
    }
});

// Einfacher In-Memory Cache (6 Stunden)
const cache = new Map();
const CACHE_LIFETIME_MS = 1000 * 60 * 60 * 6; 

app.use(express.json());

// =========================================================
// HILFSFUNKTIONEN
// =========================================================

// HILFSFUNKTION: API-Abfrage für JustTCG
async function fetchJustTCGApi(endpoint) {
    const apiUrl = `${JUSTTCG_BASE_URL}${endpoint}`;

    if (!API_KEY) {
        throw new Error("SERVER_CONFIG_ERROR: JUSTTCG_API_KEY fehlt in der Umgebungsvariable!");
    }
    
    console.log(`[DEBUG API CALL] Abfrage URL: ${apiUrl}`);

    const response = await fetch(apiUrl, {
        headers: {
            "x-api-key": API_KEY, // Sendet den JustTCG API Key
        },
    });

    if (!response.ok) {
        throw new Error(`API-Fehler (${response.status}): ${response.statusText}`);
    }

    return response.json();
}

// HILFSFUNKTION: TCGplayer ID aus der Datenbank abrufen
async function getTcgPlayerIdFromDb(setSlug, cardNumber) {
    if (!pool) {
         throw new Error("DATABASE_ERROR: Datenbank-Pool ist nicht initialisiert.");
    }
    
    // Die Suchanfrage für die TCGplayer ID
    const query = `
        SELECT tcg_player_id
        FROM card_mapping 
        WHERE cardmarket_slug = $1 AND card_number = $2;
    `;
    
    const values = [setSlug, cardNumber];
    
    const client = await pool.connect();
    try {
        const result = await client.query(query, values);
        if (result.rows.length > 0) {
            // Gibt die ID zurück
            return result.rows[0].tcg_player_id; 
        }
        return null; // Kein Eintrag gefunden
    } catch (err) {
        console.error("Datenbankabfragefehler:", err.message);
        throw new Error("DATABASE_QUERY_FAILED");
    } finally {
        client.release(); // Verbindung freigeben
    }
}

// HILFSFUNKTION: Wandelt JustTCG-Daten in das Extension-Format um (unverändert)
function mapJustTCGPrices(justTcgData) {
    const cardData = justTcgData.data?.[0];
    if (!cardData || !cardData.variants) return { low: null, mid: null, high: null };

    const nmVariant = cardData.variants.find(v => 
        v.condition === 'Near Mint' && 
        v.printing === 'Normal' && 
        (v.language === 'English' || v.language === 'Japanese')
    );

    const price = nmVariant ? nmVariant.price : (cardData.variants[0] ? cardData.variants[0].price : null);
    
    if (price !== null) {
        return { low: price, mid: price, high: price };
    }

    return { low: null, mid: null, high: null };
}

// HILFSFUNKTION: Simuliert die PSA-Datenaggregation (leer, unverändert)
function aggregatePsaData(ebayHistory) {
    return []; 
}

// MIDDLEWARE: Authentifizierung (unverändert)
function authenticateExtension(req, res, next) {
    const providedId = req.headers['x-extension-id'];

    if (providedId && providedId === EXTENSION_ID_SECRET) {
        next(); 
    } else {
        console.warn(`[AUTH FAILED] Ungültige oder fehlende 'X-Extension-ID': ${providedId}`);
        return res.status(401).json({ error: "REQUIRES_PREMIUM", message: "Bitte die Erweiterung aktivieren." });
    }
}

// =========================================================
// ROUTE: Preise abrufen (MIT DB-LOOKUP)
// =========================================================
app.get("/prices", authenticateExtension, async (req, res) => {
    // oldSlug ist der Cardmarket-Slug (z.B. me02-phantasmal-flames)
    const { set: oldSlug, cardNumber } = req.query;

    if (!oldSlug || !cardNumber) {
        return res.status(400).json({ error: "Es fehlen 'set' und 'cardNumber' Parameter." });
    }
    
    try {
        // 1. DB-LOOKUP
        const tcgPlayerId = await getTcgPlayerIdFromDb(oldSlug, cardNumber);

        if (!tcgPlayerId) {
             console.log(`[MAPPING 404] Kein TCGplayer ID Eintrag gefunden für ${oldSlug}-${cardNumber}`);
             return res.status(404).json({ error: "Mapping fehlt", message: "TCGplayer ID für diese Karte nicht in der Datenbank gefunden." });
        }

        // 2. CACHE-PRÜFUNG (Nutzt TCGplayer ID als Schlüssel)
        const cacheKey = tcgPlayerId;
        const cachedData = cache.get(cacheKey);

        if (cachedData && Date.now() - cachedData.timestamp < CACHE_LIFETIME_MS) {
            console.log(`[CACHE HIT] ${cacheKey} - Daten aus dem Cache geladen.`);
            return res.json(cachedData.data);
        }
        
        // 3. JustTCG API-CALL (Mit TCGplayer ID)
        console.log(`[CACHE MISS] Rufe JustTCG über TCGplayer ID ${tcgPlayerId} ab.`);

        const endpoint = `/cards?game=pokemon&tcgplayerId=${tcgPlayerId}`; 
        const justTcgData = await fetchJustTCGApi(endpoint);
        
        if (!justTcgData.data || justTcgData.data.length === 0) {
             console.log(`[API 404] JustTCG fand keine Karte für ID ${tcgPlayerId}`);
             return res.status(404).json({ error: "Karte nicht in der JustTCG API gefunden." });
        }
        
        // 4. Verarbeitung und Speicherung
        const mappedPrices = mapJustTCGPrices(justTcgData);
        const cardName = justTcgData.data[0].name;

        const finalResponse = { 
            prices: mappedPrices, 
            fullTitle: cardName, 
            ebay: aggregatePsaData([]) 
        };
        
        cache.set(cacheKey, { data: finalResponse, timestamp: Date.now() });
        console.log("[REQUEST END] Preise erfolgreich gesendet und im Cache gespeichert.");

        return res.json(finalResponse); 

    } catch (err) {
        if (err.message.includes('404') || err.message.includes('DATABASE_QUERY_FAILED')) {
             return res.status(404).json({ error: "API Fehler 404", message: err.message });
        }
        
        console.error("[FATAL ERROR] Interner Serverfehler:", err);
        return res.status(500).json({ error: `SERVER_ERROR`, message: err.message });
    }
});


// =========================================================
// START DER ANWENDUNG
// =========================================================

app.get("/", (req, res) => {
    res.send("PokeCardScout API läuft.");
});

app.listen(PORT, async () => {
    console.log(`Server läuft auf Port ${PORT}`);
    // Optional: Testen der Datenbankverbindung beim Start
    try {
        await pool.query('SELECT NOW()');
        console.log("✅ Datenbank erfolgreich verbunden.");
    } catch (err) {
        console.error("❌ Fehler bei der Datenbankverbindung:", err.message);
    }
});
