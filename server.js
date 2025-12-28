// server.js - ENDGÜLTIGE VERSION MIT KORRIGIERTER JUSTTCG API-KONFIGURATION UND ULTIMATIV FLEXIBLEM MAPPING
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg"); 
require("dotenv").config(); 

const app = express();
const PORT = process.env.PORT || 3000;

const API_BASE_URL = "https://api.justtcg.com";

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
// MIDDLEWARE UND AUTHENTIFIZIERUNG (Muss vor den Routen stehen)
// =========================================================

// MIDDLEWARE: CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); 
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Extension-ID'); 
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// AUTHENTIFIZIERUNGSFUNKTION 
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
// HILFSFUNKTIONEN
// =========================================================

// HILFSFUNKTION: API-Abfrage für JustTCG
async function fetchJustTcgData(tcgPlayerId) {
    const apiUrl = `${API_BASE_URL}/v1/cards?tcgplayerId=${tcgPlayerId}`;

    console.log(`[DEBUG API CALL] JustTCG URL: ${apiUrl}`);

    const response = await fetch(apiUrl, {
        headers: {
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

// HILFSFUNKTION: TCGplayer ID aus der Datenbank abrufen
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

// 🚀 FINAL: Preise Mappen und Filtern (ULTIMATE FLEXIBLE MAPPING)
function mapAndFilterPrices(data) {
    // Zugriff auf data.data[0]
    const cardData = Array.isArray(data.data) ? data.data[0] : null; 

    if (!cardData || !cardData.variants || !Array.isArray(cardData.variants)) {
        console.warn("[MAPPING ERROR] 'variants' Array fehlt oder Struktur ist unerwartet.");
        return {};
    }
    
    const prices = {};
    let allPrices = []; 
    let conditionPrices = {}; 

    // 1. Preise pro Zustand sammeln (Filterung der Sprache/des Drucks entfernt, nur gültiger Preis zählt)
    for (const variant of cardData.variants) {
        // Wir berücksichtigen nur, dass der Price ein gültiger Number-Typ ist
        if (typeof variant.price === 'number') { 
            const conditionKey = variant.condition.toUpperCase().trim();
            const price = variant.price;
            
            allPrices.push(price);

            // Speichere den günstigsten Preis für diesen Zustand
            if (!conditionPrices[conditionKey] || price < conditionPrices[conditionKey]) {
                conditionPrices[conditionKey] = price;
            }
        }
    }

    // 2. Gesamt-Low und High berechnen
    prices['LOW'] = allPrices.length > 0 ? Math.min(...allPrices) : null;
    prices['HIGH'] = allPrices.length > 0 ? Math.max(...allPrices) : null;
    
    // 3. Mapping der Zustände (Keys müssen dem UI entsprechen)
    
    // Near Mint (NM) ist der Standard-Marktpreis
    const nearMintPrice = conditionPrices['NEAR MINT'] || null;
    prices['MARKET PRICE'] = nearMintPrice; 
    
    prices['NEAR MINT'] = nearMintPrice;
    prices['LIGHTLY PLAYED'] = conditionPrices['LIGHTLY PLAYED'] || null;
    prices['MODERATELY PLAYED'] = conditionPrices['MODERATELY PLAYED'] || null;
    prices['HEAVILY PLAYED'] = conditionPrices['HEAVILY PLAYED'] || null;
    // Deckt "DAMAGED" und als Fallback "POOR" ab
    prices['DAMAGED/POOR'] = conditionPrices['DAMAGED'] || conditionPrices['POOR'] || null; 

    console.log("[MAPPING SUCCESS] Endgültige Preise:", prices);
    
    return prices;
}

// HILFSFUNKTION: PSA/eBay Daten (Platzhalter)
function aggregatePsaData(history) {
    return { psa10: { avg: null, count: 0 }, psa9: { avg: null, count: 0 }, psa8: { avg: null, count: 0 } };
}


// =========================================================
// ROUTE: Preise abrufen
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
        
        const cardTitle = justTcgData.data && justTcgData.data[0]?.name || "Unbekannter Titel";
        
        const avgPrices = aggregatePsaData(null); 

        const finalResponse = { 
            prices: mappedPrices, 
            fullTitle: cardTitle, 
            ebay: avgPrices 
        };
            
        console.log("[REQUEST END] Preise und PSA-Avg erfolgreich gesendet.");
        return res.json(finalResponse); 

    } catch (err) {
        console.error("[FATAL ERROR] Interner Serverfehler bei JustTCG Abfrage:", err);
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
