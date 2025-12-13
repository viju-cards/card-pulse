// server.js - FINALE BEREINIGTE VERSION (Nur Premium-Header-Auth, KEIN PostgreSQL)

const express = require("express");
const fetch = require("node-fetch");
require("dotenv").config(); // Lädt Umgebungsvariablen

const app = express();
const PORT = process.env.PORT || 3000;
// Hält den PriceTracker API Key (aus Render ENV)
const API_KEY = process.env.PPT_API_KEY; 
// Hält den geheimen Schlüssel der Erweiterung (aus Render ENV)
const EXTENSION_ID_SECRET = process.env.EXTENSION_ID_SECRET; 

app.use(express.json());

// =========================================================
// HILFSFUNKTIONEN
// =========================================================

// HILFSFUNKTION: API-Abfrage (Kapselung für Wiederverwendung)
async function fetchPriceTrackerApi(apiUrl) {
    if (!API_KEY) {
        // Dieser Fehler wird ausgelöst, wenn PPT_API_KEY auf Render fehlt.
        throw new Error("SERVER_CONFIG_ERROR: PPT_API_KEY fehlt in der Umgebungsvariable!");
    }
    
    console.log(`[DEBUG API CALL] Abfrage URL: ${apiUrl}`);

    const response = await fetch(apiUrl, {
        headers: {
            // Sendet den PriceTracker API Key
            Authorization: `Bearer ${API_KEY}`,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("[ERROR] API-Antwort nicht OK:", response.status, errorText);
        // Wirf einen Fehler, der im Haupt-Try/Catch gefangen wird
        throw new Error(`PriceTracker API Fehler (${response.status}): Details siehe Server-Konsole.`);
    }

    return response.json();
}

// HILFSFUNKTION: Preise Mappen und Filtern (TCGPlayer)
function mapAndFilterPrices(data) {
    const prices = {};
    if (data && Array.isArray(data)) {
        data.forEach(p => {
            prices[p.conditionName] = p.price;
        });
    }
    return prices;
}

// HILFSFUNKTION: PSA-Durchschnittspreise aggregieren
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
    // Erlaubt Anfragen von allen Quellen und den geheimen Header
    res.header('Access-Control-Allow-Origin', '*'); 
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Extension-ID'); 
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});


// =========================================================
// MIDDLEWARE: Authentifizierung (prüft auf geheime EXTENSION_ID)
// =========================================================
function authenticateExtension(req, res, next) {
    const extensionId = req.headers['x-extension-id']; // Liest den Header
    
    // Server-Konfigurations-Check: Fehlt der geheime Schlüssel?
    if (!EXTENSION_ID_SECRET) {
        console.error("[AUTH ERROR] EXTENSION_ID_SECRET fehlt in der Umgebungsvariable!");
        return res.status(500).json({ error: "SERVER_CONFIG_ERROR" });
    }

    // Authentifizierungs-Check: Stimmt der gesendete Schlüssel überein?
    if (extensionId !== EXTENSION_ID_SECRET) {
        console.warn(`[AUTH] Unerlaubter Zugriff: ${extensionId}`);
        // Code 401: Unautorisiert (Premium erforderlich)
        return res.status(401).json({ error: "REQUIRES_PREMIUM", message: "Premium-Zugriff erforderlich oder Erweiterungsschlüssel ungültig." });
    }

    console.log(`[AUTH] Erfolgreich: Erweiterung ${extensionId.substring(0, 10)}... authentifiziert.`);
    next(); 
}


// =========================================================
// ROUTE: Preise abrufen (mit Erweiterungs-Authentifizierung)
// =========================================================
app.get("/prices", authenticateExtension, async (req, res) => {
    const { set, cardNumber, tcgPlayerId } = req.query;

    if (!set || !cardNumber) {
        return res.status(400).json({ error: "Es fehlen 'set' und 'cardNumber' Parameter." });
    }

    try {
        // 1. TCGPlayer Abfrage
        const tcgData = await fetchPriceTrackerApi(
            `https://api.pokeprice.io/v2/products/tcgplayer?set=${set}&cardNumber=${cardNumber}`
        );

        const mappedPrices = mapAndFilterPrices(tcgData.prices);
        const card = tcgData.card;

        // 2. PSA/eBay Abfrage (nur wenn TCGPlayer ID gefunden wurde)
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
            
        console.log("[REQUEST END] Preise und PSA-Avg erfolgreich gesendet.");
        return res.json(finalResponse); 

    } catch (err) {
        // Fängt Fehler von fetchPriceTrackerApi ab
        if (err.message.includes('SERVER_CONFIG_ERROR')) {
             // 500er für fehlerhafte Server-Konfiguration (API Key fehlt)
             return res.status(500).json({ error: "SERVER_ERROR", message: "PriceTracker API Key fehlt." });
        }
        if (err.message.includes('404')) {
             // 404 für Karten, die in der PriceTracker API nicht gefunden werden
             return res.status(404).json({ error: "Karte nicht in der PriceTracker API gefunden." });
        }
        
        console.error("[FATAL ERROR] Interner Serverfehler:", err);
        // Standard 500er Fehler für alle anderen Probleme
        return res.status(500).json({ error: `SERVER_ERROR`, message: err.message });
    }
});


// =========================================================
// SERVER START
// =========================================================
app.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});
