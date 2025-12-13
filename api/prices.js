// api/prices.js - Vercel Serverless Function (Mit korrigiertem Such-Mapping)

const fetch = require("node-fetch");

const JUSTTCG_BASE_URL = 'https://api.justtcg.com/api/v1'; 
const JUSTTCG_API_KEY = process.env.JUSTTCG_API_KEY; 
const EXTENSION_ID_SECRET = process.env.EXTENSION_ID_SECRET; 

// 💡 NEU: Internes Mapping von Cardmarket Slug auf lesbaren Set-Namen für die Suche
const setSlugToSearchName = {
    "me01-mega-evolution": "Mega Evolution",
    "swsh01-sword-and-shield-base-set": "Sword & Shield Base Set",
    "me02-phantasmal-flames": "Phantasmal Flames",
    "sv-black-bolt": "Black Bolt"
    // Fügen Sie hier alle weiteren Slugs aus Ihrer content.js-Mapping hinzu!
};

// =========================================================
// HILFSFUNKTIONEN (Unverändert, außer fetchJustTcgApi Fehlermeldung)
// =========================================================

async function fetchJustTcgApi(endpoint) {
    if (!JUSTTCG_API_KEY) {
        throw new Error("SERVER_CONFIG_ERROR: JUSTTCG_API_KEY fehlt in der Umgebungsvariable!");
    }
    
    const url = `${JUSTTCG_BASE_URL}${endpoint}`;
    console.log(`[DEBUG API CALL] JustTCG Abfrage URL: ${url}`);

    const response = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${JUSTTCG_API_KEY}`,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("[ERROR] JustTCG API-Antwort nicht OK:", response.status, errorText.substring(0, 100)); // Loggt nur einen Teil der Antwort
        // Wirft den ursprünglichen Fehler, der in den Vercel-Logs sichtbar ist
        throw new Error(`JustTCG API Fehler (${response.status}): Details siehe Server-Konsole (Cloudflare 1014).`); 
    }

    return response.json();
}

function mapAndFilterPrices(tcgPlayerDetails) {
    // ... (Logik bleibt unverändert) ...
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

function mapPsaPrices(gradePrices) {
    // ... (Logik bleibt unverändert) ...
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
// HAUPT-HANDLER (mit NEUER Suchlogik)
// =========================================================

module.exports = async (req, res) => {
    
    // ... (CORS, OPTIONS, GET-Check, AUTH-Middleware unverändert) ...
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Extension-ID'); 
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: "Method Not Allowed" });

    const { set: setSlug, cardNumber, tcgPlayerId } = req.query; 
    const extensionId = req.headers['x-extension-id']; 
    
    // ... (Input & Auth Checks unverändert) ...
    if (!setSlug && !cardNumber && !tcgPlayerId) {
        return res.status(400).json({ error: "Es fehlen die notwendigen Parameter (set/cardNumber oder tcgPlayerId)." });
    }

    if (!EXTENSION_ID_SECRET) return res.status(500).json({ error: "SERVER_CONFIG_ERROR", message: "Extension Secret fehlt." });
    if (extensionId !== EXTENSION_ID_SECRET) return res.status(401).json({ error: "REQUIRES_PREMIUM", message: "Premium-Zugriff erforderlich oder Erweiterungsschlüssel ungültig." });

    // 4. Hauptlogik (JustTCG Abfrage)
    try {
        let cardData;
        
        if (tcgPlayerId) {
            // Option A: Direkte ID-Abfrage
            const endpoint = `/cards/${encodeURIComponent(tcgPlayerId)}`;
            cardData = await fetchJustTcgApi(endpoint);
            
        } else {
            // Option B: Suche
            const setName = setSlugToSearchName[setSlug];
            
            if (!setName) {
                // Wenn wir den Set-Namen nicht kennen, können wir die Suche nicht durchführen.
                // ⚠️ HINWEIS: Hier müssten alle Slugs aus content.js im Mapping ergänzt werden!
                return res.status(400).json({ error: "SET_MAPPING_MISSING", message: `Unbekannter Set-Slug: ${setSlug}. Bitte das Mapping in api/prices.js erweitern.` });
            }
            
            // NEUE, KORREKTE SUCHANFRAGE: "Phantasmal Flames 013"
            const searchQuery = `${setName} ${cardNumber}`; 
            const endpoint = `/cards?query=${encodeURIComponent(searchQuery)}`;
            
            const searchResult = await fetchJustTcgApi(endpoint);
            
            if (Array.isArray(searchResult.data) && searchResult.data.length > 0) {
                 cardData = searchResult.data[0]; 
                 console.log(`[SUCCESS SCHRITT 1] Karte gefunden: ${cardData.name} (ID: ${cardData.tcgPlayerId})`);
            } else {
                 return res.status(404).json({ error: "Karte konnte über die Suche nicht in der JustTCG API gefunden werden." });
            }
        }

        // 5. Daten Mappen und formatieren (Unverändert)
        const tcgPlayerDetails = cardData.tcgPlayer || cardData; 
        
        if (!tcgPlayerDetails) {
             return res.status(404).json({ error: "TCGPlayer Daten fehlen in der JustTCG API für diese Karte." });
        }
        
        const mappedPrices = mapAndFilterPrices(tcgPlayerDetails);
        const avgPrices = mapPsaPrices(cardData.gradePrices);

        const finalResponse = { 
            prices: mappedPrices, 
            fullTitle: cardData.name || "Unbekannt", 
            ebay: avgPrices
        };
            
        return res.json(finalResponse); 

    } catch (err) {
        // ... (Fehlerbehandlung unverändert) ...
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
