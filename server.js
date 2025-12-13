// server.js - FINALE JustTCG VERSION

const express = require("express");
const fetch = require("node-fetch");
require("dotenv").config(); 

const app = express();
const PORT = process.env.PORT || 3000;
// 🛑 NEU: JustTCG Konfiguration
const JUSTTCG_BASE_URL = 'https://api.justtcg.com/api/v1'; 
const JUSTTCG_API_KEY = process.env.JUSTTCG_API_KEY; // <--- NEUER KEY
// Hält den geheimen Schlüssel der Erweiterung (aus Render ENV - UNVERÄNDERT)
const EXTENSION_ID_SECRET = process.env.EXTENSION_ID_SECRET; 

app.use(express.json());

// =========================================================
// HILFSFUNKTIONEN
// =========================================================

// HILFSFUNKTION: API-Abfrage (ANGEPASST für JustTCG)
// Ersetzt fetchPriceTrackerApi
async function fetchJustTcgApi(endpoint) {
    if (!JUSTTCG_API_KEY) {
        // Dieser Fehler wird ausgelöst, wenn JUSTTCG_API_KEY auf Render fehlt.
        throw new Error("SERVER_CONFIG_ERROR: JUSTTCG_API_KEY fehlt in der Umgebungsvariable!");
    }
    
    const url = `${JUSTTCG_BASE_URL}${endpoint}`;
    console.log(`[DEBUG API CALL] JustTCG Abfrage URL: ${url}`);

    const response = await fetch(url, {
        headers: {
            // Sendet den JustTCG API Key im erforderlichen Bearer-Format
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${JUSTTCG_API_KEY}`,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("[ERROR] JustTCG API-Antwort nicht OK:", response.status, errorText);
        throw new Error(`JustTCG API Fehler (${response.status}): ${response.status === 404 ? 'Karte nicht gefunden.' : 'Details siehe Server-Konsole.'}`);
    }

    return response.json();
}

// HILFSFUNKTION: Preise Mappen und Filtern (ANGEPASST für JustTCG TCGPlayer)
// Ersetzt mapAndFilterPrices
function mapAndFilterPrices(tcgPlayerDetails) {
    const toFloatOrNull = (value) => {
        if (value === null || value === undefined || value === '') return null;
        const result = parseFloat(value);
        return isNaN(result) ? null : result;
    };

    // Die TCGPlayer Daten können direkt unter tcgPlayerDetails liegen,
    // oder unter tcgPlayerDetails.prices
    const prices = tcgPlayerDetails.prices || tcgPlayerDetails;
    if (!prices || (!prices.marketPrice && !prices.market)) return {};

    // JustTCG speichert die Zustände oft unter 'variants'
    const variants = prices.variants || {};

    // Mapping von JustTCG Struktur auf die vom Client erwarteten Schlüssel (content.js)
    return {
        // JustTCG verwendet 'marketPrice' oder 'market'
        market: toFloatOrNull(prices.marketPrice || prices.market), 
        // Mapping auf die erwarteten Zustände (NM, LP, MP, HP, POOR)
        lowNM: toFloatOrNull(variants.NearMint?.price),
        lowLP: toFloatOrNull(variants.LightlyPlayed?.price),
        lowMP: toFloatOrNull(variants.ModeratelyPlayed?.price),
        lowHP: toFloatOrNull(variants.HeavilyPlayed?.price),
        lowPOOR: toFloatOrNull(variants.Damaged?.price), // JustTCG verwendet 'Damaged' für POOR
    };
}

// HILFSFUNKTION: PSA-Durchschnittspreise mappen (ANGEPASST für JustTCG gradePrices)
// Ersetzt aggregatePsaData
function mapPsaPrices(gradePrices) {
    const aggregated = {};
    const grades = [10, 9, 8]; // Die vom Client erwarteten Stufen

    if (!Array.isArray(gradePrices)) return {};

    grades.forEach(grade => {
        const gradeKey = `psa${grade}`;
        // Finde den Eintrag für die gewünschte Stufe im Array
        const gradeData = gradePrices.find(p => p.gradeLevel === grade);

        if (gradeData && gradeData.averagePrice !== undefined) {
             aggregated[gradeKey] = {
                avg: parseFloat(gradeData.averagePrice),
                count: gradeData.count || 0
            };
        } else {
             aggregated[gradeKey] = {
                avg: null,
                count: 0
            };
        }
    });
    return aggregated;
}


// =========================================================
// CORS & HEADERS (UNVERÄNDERT)
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
// MIDDLEWARE: Authentifizierung (UNVERÄNDERT)
// =========================================================
function authenticateExtension(req, res, next) {
    const extensionId = req.headers['x-extension-id']; 
    
    if (!EXTENSION_ID_SECRET) {
        console.error("[AUTH ERROR] EXTENSION_ID_SECRET fehlt in der Umgebungsvariable!");
        return res.status(500).json({ error: "SERVER_CONFIG_ERROR" });
    }

    if (extensionId !== EXTENSION_ID_SECRET) {
        console.warn(`[AUTH] Unerlaubter Zugriff: ${extensionId}`);
        // Code 401 löst in background.js 'REQUIRES_PREMIUM' aus
        return res.status(401).json({ error: "REQUIRES_PREMIUM", message: "Premium-Zugriff erforderlich oder Erweiterungsschlüssel ungültig." });
    }

    console.log(`[AUTH] Erfolgreich: Erweiterung ${extensionId.substring(0, 10)}... authentifiziert.`);
    next(); 
}


// =========================================================
// ROUTE: Preise abrufen (ANGEPASSTE JustTCG LOGIK)
// =========================================================
app.get("/prices", authenticateExtension, async (req, res) => {
    // Die Parameter set, cardNumber, tcgPlayerId kommen von content.js
    const { set: setSlug, cardNumber, tcgPlayerId } = req.query; 

    if (!setSlug && !cardNumber && !tcgPlayerId) {
        return res.status(400).json({ error: "Es fehlen die notwendigen Parameter (set/cardNumber oder tcgPlayerId)." });
    }

    try {
        let cardData;
        
        // 1. Karten-Daten abrufen
        if (tcgPlayerId) {
            // Option A: Abfrage direkt per TCGPlayer ID (JustTCG: /cards/{id})
            const endpoint = `/cards/${encodeURIComponent(tcgPlayerId)}`;
            cardData = await fetchJustTcgApi(endpoint);
            
        } else {
            // Option B: Abfrage per Set-Slug und Nummer (JustTCG: /cards?query=...)
            // 💡 BESTE STRATEGIE: Wir nutzen den übergebenen Slug (z.B. me02-phantasmal-flames) 
            // und die Kartennummer (z.B. 013) als präzisen Suchbegriff.
            const searchQuery = `${setSlug} ${cardNumber}`; 
            const endpoint = `/cards?query=${encodeURIComponent(searchQuery)}`;
            
            const searchResult = await fetchJustTcgApi(endpoint);
            
            // JustTCG gibt ein Array zurück. Wir nehmen das erste Ergebnis.
            if (Array.isArray(searchResult.data) && searchResult.data.length > 0) {
                 cardData = searchResult.data[0]; 
                 console.log(`[SUCCESS SCHRITT 1] Karte gefunden: ${cardData.name} (ID: ${cardData.tcgPlayerId})`);
            } else {
                 return res.status(404).json({ error: "Karte konnte über die Suche nicht in der JustTCG API gefunden werden." });
            }
        }

        // 2. Daten Mappen und formatieren
        // JustTCG speichert TCGPlayer Details oft unter 'tcgPlayer'
        const tcgPlayerDetails = cardData.tcgPlayer || cardData; 
        
        if (!tcgPlayerDetails) {
             return res.status(404).json({ error: "TCGPlayer Daten fehlen in der JustTCG API für diese Karte." });
        }
        
        const mappedPrices = mapAndFilterPrices(tcgPlayerDetails);
        const avgPrices = mapPsaPrices(cardData.gradePrices);

        const finalResponse = { 
            prices: mappedPrices, 
            fullTitle: cardData.name || "Unbekannt", 
            ebay: avgPrices // 'ebay' ist das erwartete Feld im Client (content.js)
        };
            
        console.log("[REQUEST END] Preise und PSA-Avg erfolgreich von JustTCG gemapped und gesendet.");
        return res.json(finalResponse); 

    } catch (err) {
        // Fängt Fehler von fetchJustTcgApi ab
        if (err.message.includes('SERVER_CONFIG_ERROR')) {
             return res.status(500).json({ error: "SERVER_ERROR", message: "JustTCG API Key fehlt." });
        }
        if (err.message.includes('404') || err.message.includes('Karte nicht gefunden')) {
             return res.status(404).json({ error: "Karte nicht in der JustTCG API gefunden." });
        }
        
        console.error("[FATAL ERROR] Interner Serverfehler:", err);
        return res.status(500).json({ error: `SERVER_ERROR`, message: err.message });
    }
});


// =========================================================
// SERVER START (UNVERÄNDERT)
// =========================================================
app.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});
