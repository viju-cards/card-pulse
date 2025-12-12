// server.js - FINALE VERSION (Nur Premium-Zugriff per geheimem Extension-ID Header)

const express = require("express");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.PPT_API_KEY; // Ihr PriceTracker API Key (MUSS vorhanden sein!)
const EXTENSION_ID_SECRET = process.env.EXTENSION_ID_SECRET; // Geheimer Schlüssel aus Render ENV

app.use(express.json());

// =========================================================
// HILFSFUNKTIONEN (vom letzten Stand übernommen)
// =========================================================

// HILFSFUNKTION: API-Abfrage (Kapselung für Wiederverwendung)
async function fetchPriceTrackerApi(apiUrl) {
    if (!API_KEY) {
        throw new Error("PPT_API_KEY fehlt in der .env Datei!");
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
        throw new Error(`Fehler von PriceTracker API: ${response.status}. Details siehe Server-Konsole.`);
    }

    return response.json();
}

// HILFSFUNKTION: Preise Mappen und Filtern (TCGPlayer)
function mapAndFilterPrices(data) {
    const prices = {};
    if (data && Array.isArray(data)) {
        data.forEach(p => {
            // Speichert z.B. prices.lowNM = 12.34
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
    // Erlaubt Anfragen von allen Quellen und den neuen Header
    res.header('Access-Control-Allow-Origin', '*'); 
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Extension-ID'); // HIER den neuen Header erlauben
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
    
    // Server-Konfigurations-Check
    if (!EXTENSION_ID_SECRET) {
        console.error("[AUTH ERROR] EXTENSION_ID_SECRET fehlt in der Umgebungsvariable!");
        return res.status(500).json({ error: "SERVER_CONFIG_ERROR" });
    }

    // Authentifizierungs-Check
    if (extensionId !== EXTENSION_ID_SECRET) {
        console.warn(`[AUTH] Unerlaubter Zugriff: ${extensionId}`);
        // Code 401: Unautorisiert (Nicht bezahlter oder gehackter Zugriff)
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
            
        console.log("[REQUEST END] Preise und PSA-Avg erfolgreich gesendet.");
        return res.json(finalResponse); 

    } catch (err) {
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
