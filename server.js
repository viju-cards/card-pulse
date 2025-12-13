// server.js - FINALE BEREINIGTE VERSION (Mit In-Memory-Cache)

const express = require("express");
const fetch = require("node-fetch");
require("dotenv").config(); 

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.PPT_API_KEY; 
const EXTENSION_ID_SECRET = process.env.EXTENSION_ID_SECRET; 

app.use(express.json());

// =========================================================
// NEU: CACHE DEFINITION
// =========================================================
const cache = new Map();
// Cache-Lebensdauer: 3 Stunden (1000ms * 60s * 60m * 3h)
const CACHE_LIFETIME_MS = 1000 * 60 * 60 * 3; 

// =========================================================
// HILFSFUNKTIONEN
// =========================================================

async function fetchPriceTrackerApi(apiUrl) {
    if (!API_KEY) {
        throw new Error("SERVER_CONFIG_ERROR: PPT_API_KEY fehlt in der Umgebungsvariable!");
    }
    
    console.log(`[DEBUG API CALL] Abfrage URL: ${apiUrl}`);

    const response = await fetch(apiUrl, {
        headers: {
            Authorization: `Bearer ${API_KEY}`,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("[ERROR] API-Antwort nicht OK:", response.status, errorText);
        throw new Error(`PriceTracker API Fehler (${response.status}): Details siehe Server-Konsole.`);
    }

    return response.json();
}

function mapAndFilterPrices(data) {
    const prices = {};
    if (data && Array.isArray(data)) {
        data.forEach(p => {
            prices[p.conditionName] = p.price;
        });
    }
    return prices;
}

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


// =========================================================
// CORS & HEADERS
// =========================================================
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); 
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Extension-ID'); 
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});


// =========================================================
// MIDDLEWARE: Authentifizierung
// =========================================================
function authenticateExtension(req, res, next) {
    const extensionId = req.headers['x-extension-id']; 
    
    if (!EXTENSION_ID_SECRET) {
        console.error("[AUTH ERROR] EXTENSION_ID_SECRET fehlt in der Umgebungsvariable!");
        return res.status(500).json({ error: "SERVER_CONFIG_ERROR" });
    }

    if (extensionId !== EXTENSION_ID_SECRET) {
        console.warn(`[AUTH] Unerlaubter Zugriff: ${extensionId}`);
        return res.status(401).json({ error: "REQUIRES_PREMIUM", message: "Premium-Zugriff erforderlich oder Erweiterungsschlüssel ungültig." });
    }

    console.log(`[AUTH] Erfolgreich: Erweiterung ${extensionId.substring(0, 10)}... authentifiziert.`);
    next(); 
}


// =========================================================
// ROUTE: Preise abrufen (MIT CACHE-LOGIK)
// =========================================================
app.get("/prices", authenticateExtension, async (req, res) => {
    const { set, cardNumber } = req.query;

    if (!set || !cardNumber) {
        return res.status(400).json({ error: "Es fehlen 'set' und 'cardNumber' Parameter." });
    }

    const cacheKey = `${set}-${cardNumber}`;
    const cachedData = cache.get(cacheKey);

    // 1. CACHE HIT: Prüfen, ob Cache gültig ist
    if (cachedData && Date.now() - cachedData.timestamp < CACHE_LIFETIME_MS) {
        console.log(`[CACHE HIT] ${cacheKey} - Daten aus dem Cache geladen.`);
        return res.json(cachedData.data);
    }
    
    // 2. CACHE MISS: Neue Daten abrufen
    try {
        console.log(`[CACHE MISS] ${cacheKey} - Rufe Daten von PriceTracker ab.`);

        // 1. TCGPlayer Abfrage
        const tcgData = await fetchPriceTrackerApi(
            `https://api.pokeprice.io/v2/products/tcgplayer?set=${set}&cardNumber=${cardNumber}`
        );

        const mappedPrices = mapAndFilterPrices(tcgData.prices);
        const card = tcgData.card;

        // 2. PSA/eBay Abfrage
        let avgPrices = {};
        if (card && card.tcgPlayerId) {
            const ebayData = await fetchPriceTrackerApi(
                `https://api.pokeprice.io/v2/products/psa/avg?tcgPlayerId=${card.tcgPlayerId}`
            );
            avgPrices = aggregatePsaData(ebayData.history);
        }

        const finalResponse = { 
            prices: mappedPrices, 
            fullTitle: card?.name, 
            ebay: avgPrices 
        };
        
        // 3. Im Cache speichern
        cache.set(cacheKey, { data: finalResponse, timestamp: Date.now() });
        console.log("[REQUEST END] Preise und PSA-Avg erfolgreich gesendet und im Cache gespeichert.");

        return res.json(finalResponse); 

    } catch (err) {
        if (err.message.includes('SERVER_CONFIG_ERROR')) {
             return res.status(500).json({ error: "SERVER_ERROR", message: "PriceTracker API Key fehlt." });
        }
        if (err.message.includes('404')) {
             return res.status(404).json({ error: "Karte nicht in der PriceTracker API gefunden." });
        }
        
        console.error("[FATAL ERROR] Interner Serverfehler:", err);
        return res.status(500).json({ error: `SERVER_ERROR`, message: err.message });
    }
});


// =========================================================
// SERVER START
// =========================================================
app.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});
