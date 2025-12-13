// server.js - NEUE VERSION FÜR JUSTTCG API

const express = require("express");
const fetch = require("node-fetch");
require("dotenv").config(); 

const app = express();
const PORT = process.env.PORT || 3000;
// ⚠️ NEU: JustTCG API Key (muss in Render Environment Variables gesetzt werden!)
const API_KEY = process.env.JUSTTCG_API_KEY; 
const EXTENSION_ID_SECRET = process.env.EXTENSION_ID_SECRET; 
const JUSTTCG_BASE_URL = "https://api.justtcg.com/v1"; 

app.use(express.json());

// =========================================================
// CACHE DEFINITION (unverändert)
// =========================================================
const cache = new Map();
const CACHE_LIFETIME_MS = 1000 * 60 * 60 * 3; // 3 Stunden Cache


// =========================================================
// HILFSFUNKTIONEN (Angepasst an JustTCG)
// =========================================================

// NEUE HILFSFUNKTION: API-Abfrage für JustTCG
async function fetchJustTCGApi(endpoint) {
    if (!API_KEY) {
        throw new Error("SERVER_CONFIG_ERROR: JUSTTCG_API_KEY fehlt in der Umgebungsvariable!");
    }
    
    console.log(`[DEBUG API CALL] Abfrage URL: ${JUSTTCG_BASE_URL}${endpoint}`);

    const response = await fetch(`${JUSTTCG_BASE_URL}${endpoint}`, {
        headers: {
            'X-Api-Key': API_KEY, // ⚠️ NEUER HEADER NAME
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("[ERROR] API-Antwort nicht OK:", response.status, errorText);
        throw new Error(`JustTCG API Fehler (${response.status}): Details siehe Server-Konsole. Response: ${errorText}`);
    }

    return response.json();
}

// NEUE HILFSFUNKTION: Extrahiert TCGPlayer-Preise aus JustTCG Response
function mapJustTCGPrices(data) {
    const prices = {};
    if (data && Array.isArray(data.items) && data.items.length > 0) {
        const cardData = data.items[0]; 

        // Annahme: JustTCG liefert die Preise unter 'pricePoints' oder einem ähnlichen Feld.
        // Die genaue Struktur kann je nach JustTCG-Response variieren.
        // Wir nehmen die allgemeinen Marktpreise.
        if (cardData.pricePoints) {
             // Beispielhafte Mapping-Logik, muss ggf. nach JustTCG Doku angepasst werden:
            prices['Near Mint'] = cardData.pricePoints.nearMint?.marketPrice;
            prices['Lightly Played'] = cardData.pricePoints.lightlyPlayed?.marketPrice;
            prices['Average'] = cardData.pricePoints.marketPrice; // oder ähnliches Feld
        }

        // Falls die Struktur anders ist, müssen Sie dies anpassen.
        // Für den Übergang nutzen wir das TCGplayer Marktpreis-Feld:
        const tcgMarketPrice = cardData.marketPrice;
        if (tcgMarketPrice) {
            prices['TCG Market'] = tcgMarketPrice;
        }

        // Geben Sie hier nur die Werte zurück, die Sie in der Extension anzeigen möchten!
    }
    return prices;
}

// ⚠️ Diese Funktion ist jetzt nicht mehr relevant, da JustTCG die PSA-Daten nicht liefert!
function aggregatePsaData(history) {
    // KEINE PSA-LOGIK MEHR: Rückgabe eines leeren Objekts, um Fehler zu vermeiden.
    return { psa10: { avg: null, count: 0 }, psa9: { avg: null, count: 0 }, psa8: { avg: null, count: 0 } };
}

// =========================================================
// CORS & HEADERS / MIDDLEWARE (unverändert)
// =========================================================
app.use((req, res, next) => { /* ... CORS unverändert ... */ next(); });
function authenticateExtension(req, res, next) { /* ... Auth unverändert ... */ next(); }


// =========================================================
// ROUTE: Preise abrufen (MIT CACHE & JUSTTCG-LOGIK)
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
    
    // 2. CACHE MISS: Neue Daten von JustTCG abrufen
    try {
        console.log(`[CACHE MISS] ${cacheKey} - Rufe Daten von JustTCG ab.`);

        // ⚠️ ANNAHME: JustTCG kann über Set-Slug und Card-Number suchen.
        // Falls die Karte nicht gefunden wird, muss die Suche auf den vollen Titel erweitert werden.
        const endpoint = `/cards?game=pokemon&set=${set}&cardNumber=${cardNumber}`;
        const justTcgData = await fetchJustTCGApi(endpoint);
        
        // Die JustTCG API gibt ein Array von Karten zurück, wir nehmen die erste.
        if (!justTcgData.items || justTcgData.items.length === 0) {
             return res.status(404).json({ error: "Karte nicht in der JustTCG API gefunden." });
        }
        
        const mappedPrices = mapJustTCGPrices(justTcgData);
        const cardName = justTcgData.items[0].name;

        // ⚠️ PSA / eBay LOGIK ENTFERNT / SIMPLIFIZIERT:
        // Wir können JustTCG nicht für PSA-Averages nutzen.
        const avgPrices = aggregatePsaData([]); 

        const finalResponse = { 
            prices: mappedPrices, 
            fullTitle: cardName, 
            ebay: avgPrices // Ist jetzt immer leer/null
        };
        
        // 3. Im Cache speichern
        cache.set(cacheKey, { data: finalResponse, timestamp: Date.now() });
        console.log("[REQUEST END] Preise erfolgreich gesendet und im Cache gespeichert.");

        return res.json(finalResponse); 

    } catch (err) {
        if (err.message.includes('SERVER_CONFIG_ERROR')) {
             return res.status(500).json({ error: "SERVER_ERROR", message: "JustTCG API Key fehlt." });
        }
        if (err.message.includes('404') || err.message.includes('400')) {
             // 404/400 Fehler des Drittanbieters
             return res.status(404).json({ error: "Karte nicht in der API gefunden.", message: "Dienst hat Karte nicht gelistet." });
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
