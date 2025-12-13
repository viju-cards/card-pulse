// api/prices.js - Vercel Serverless Function

const fetch = require("node-fetch");
const { parse } = require('url'); // Nur falls nötig, aber Vercel unterstützt req.query

// 🛑 Umgebungsvariablen werden direkt aus process.env gelesen (muss auf Vercel gesetzt werden)
const JUSTTCG_BASE_URL = 'https://api.justtcg.com/api/v1'; 
const JUSTTCG_API_KEY = process.env.JUSTTCG_API_KEY; 
const EXTENSION_ID_SECRET = process.env.EXTENSION_ID_SECRET; 

// =========================================================
// HILFSFUNKTIONEN (ANGEPASST AN JUSTTCG)
// =========================================================

// HILFSFUNKTION: API-Abfrage (ANGEPASST für JustTCG)
async function fetchJustTcgApi(endpoint) {
    if (!JUSTTCG_API_KEY) {
        throw new Error("SERVER_CONFIG_ERROR: JUSTTCG_API_KEY fehlt in der Umgebungsvariable!");
    }
    
    const url = `${JUSTTCG_BASE_URL}${endpoint}`;
    console.log(`[DEBUG API CALL] JustTCG Abfrage URL: ${url}`);

    const response = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${JUSTTCG_API_KEY}`, // <--- JustTCG Key
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("[ERROR] JustTCG API-Antwort nicht OK:", response.status, errorText);
        throw new Error(`JustTCG API Fehler (${response.status}): ${response.status === 404 ? 'Karte nicht gefunden.' : 'Details siehe Server-Konsole.'}`);
    }

    return response.json();
}

// HILFSFUNKTION: Preise Mappen (ANGEPASST für JustTCG TCGPlayer)
function mapAndFilterPrices(tcgPlayerDetails) {
    const toFloatOrNull = (value) => {
        if (value === null || value === undefined || value === '') return null;
        const result = parseFloat(value);
        return isNaN(result) ? null : result;
    };

    const prices = tcgPlayerDetails.prices || tcgPlayerDetails;
    if (!prices || (!prices.marketPrice && !prices.market)) return {};

    const variants = prices.variants || {};

    return {
        market: toFloatOrNull(prices.marketPrice || prices.market), 
        lowNM: toFloatOrNull(variants.NearMint?.price),
        lowLP: toFloatOrNull(variants.LightlyPlayed?.price),
        lowMP: toFloatOrNull(variants.ModeratelyPlayed?.price),
        lowHP: toFloatOrNull(variants.HeavilyPlayed?.price),
        lowPOOR: toFloatOrNull(variants.Damaged?.price), 
    };
}

// HILFSFUNKTION: PSA-Durchschnittspreise mappen (ANGEPASST für JustTCG gradePrices)
function mapPsaPrices(gradePrices) {
    const aggregated = {};
    const grades = [10, 9, 8]; 

    if (!Array.isArray(gradePrices)) return {};

    grades.forEach(grade => {
        const gradeKey = `psa${grade}`;
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
// HAUPT-HANDLER für VERCEL (ersetzt app.get("/prices", ...))
// =========================================================

module.exports = async (req, res) => {
    
    // 1. CORS & METHODEN-Handling (Manuell gesetzt für die Extension)
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Extension-ID'); 
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'GET') {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    // 2. Query-Parameter und Auth-Header extrahieren
    // Vercel Serverless Functions erlauben req.query für GET-Parameter
    const { set: setSlug, cardNumber, tcgPlayerId } = req.query; 
    const extensionId = req.headers['x-extension-id']; 
    
    if (!setSlug && !cardNumber && !tcgPlayerId) {
        return res.status(400).json({ error: "Es fehlen die notwendigen Parameter (set/cardNumber oder tcgPlayerId)." });
    }

    // 3. Authentifizierung (ersetzt Middleware)
    if (!EXTENSION_ID_SECRET) {
        console.error("[AUTH ERROR] EXTENSION_ID_SECRET fehlt in der Umgebungsvariable!");
        return res.status(500).json({ error: "SERVER_CONFIG_ERROR", message: "Extension Secret fehlt." });
    }

    if (extensionId !== EXTENSION_ID_SECRET) {
        console.warn(`[AUTH] Unerlaubter Zugriff: ${extensionId}`);
        // Code 401 löst in background.js 'REQUIRES_PREMIUM' aus
        return res.status(401).json({ error: "REQUIRES_PREMIUM", message: "Premium-Zugriff erforderlich oder Erweiterungsschlüssel ungültig." });
    }

    // 4. Hauptlogik (JustTCG Abfrage)
    try {
        let cardData;
        
        if (tcgPlayerId) {
            // Option A: Abfrage direkt per TCGPlayer ID (JustTCG: /cards/{id})
            const endpoint = `/cards/${encodeURIComponent(tcgPlayerId)}`;
            cardData = await fetchJustTcgApi(endpoint);
            
        } else {
            // Option B: Abfrage per Set-Slug und Nummer (JustTCG: /cards?query=...)
            const searchQuery = `${setSlug} ${cardNumber}`; 
            const endpoint = `/cards?query=${encodeURIComponent(searchQuery)}`;
            
            const searchResult = await fetchJustTcgApi(endpoint);
            
            if (Array.isArray(searchResult.data) && searchResult.data.length > 0) {
                 cardData = searchResult.data[0]; 
                 console.log(`[SUCCESS SCHRITT 1] Karte gefunden: ${cardData.name} (ID: ${cardData.tcgPlayerId})`);
            } else {
                 return res.status(404).json({ error: "Karte konnte über die Suche nicht in der JustTCG API gefunden werden." });
            }
        }

        // 5. Daten Mappen und formatieren
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
        if (err.message.includes('SERVER_CONFIG_ERROR')) {
             return res.status(500).json({ error: "SERVER_ERROR", message: "JustTCG API Key fehlt." });
        }
        if (err.message.includes('404') || err.message.includes('Karte nicht gefunden')) {
             return res.status(404).json({ error: "Karte nicht in der JustTCG API gefunden." });
        }
        
        console.error("[FATAL ERROR] Interner Serverfehler:", err);
        return res.status(500).json({ error: `SERVER_ERROR`, message: err.message });
    }
};
