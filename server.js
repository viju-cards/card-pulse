// server.js - FINALE JUSTTCG-VERSION
const express = require("express");
const fetch = require("node-fetch");
require("dotenv").config(); // Lädt Umgebungsvariablen

const app = express();
const PORT = process.env.PORT || 3000;
const JUSTTCG_BASE_URL = "https://api.justtcg.com/v1";

// Hält den JustTCG API Key (aus Render ENV). Bitte in Render 'JUSTTCG_API_KEY' nennen.
const API_KEY = process.env.JUSTTCG_API_KEY; 
// Hält den geheimen Schlüssel der Erweiterung (aus Render ENV)
const EXTENSION_ID_SECRET = process.env.EXTENSION_ID_SECRET; 

// Einfacher In-Memory Cache (Für Render ideal)
const cache = new Map();
const CACHE_LIFETIME_MS = 1000 * 60 * 60 * 6; // 6 Stunden Cache-Lebensdauer

app.use(express.json());

// =========================================================
// HILFSFUNKTIONEN & MAPPING
// =========================================================

// MAPPING: Wandelt den alten, von der Extension gesendeten Slug (links) 
// in den korrekten JustTCG Set-ID Slug (rechts) um.
const JUSTTCG_SET_MAPPING = {
    // Wenn Sie weitere Sets testen, müssen Sie das korrekte JustTCG-ID hier eintragen.
    "me01-mega-evolution": "xy-promos", // Annahme für MEG (bitte prüfen!)
    "swsh01-sword-and-shield-base-set": "sword-shield", // Korrigiert für SSH
    "me02-phantasmal-flames": "xy-promos", // Annahme für PFL (bitte prüfen!)
    "sv-black-bolt": "sv-promos", // Annahme für BLK (bitte prüfen!)
    "sv-paldea-evolved": "paldea-evolved" // Beispiel: Falls Sie einen neuen Slug testen
};


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

// HILFSFUNKTION: Wandelt JustTCG-Daten in das Format für die Extension um
function mapJustTCGPrices(justTcgData) {
    const cardData = justTcgData.data?.[0];
    if (!cardData || !cardData.variants) return { low: null, mid: null, high: null };

    // Versucht, den Preis für die 'Near Mint' (NM) und 'Normal' (non-foil) Variante zu finden
    const nmVariant = cardData.variants.find(v => 
        v.condition === 'Near Mint' && 
        v.printing === 'Normal' && 
        (v.language === 'English' || v.language === 'Japanese') // Englisch oder Japanisch
    );

    if (nmVariant) {
        const price = nmVariant.price; 
        
        // Da JustTCG oft nur einen Marktpreis (Market Price) liefert, 
        // verwenden wir diesen für Low, Mid und High, um die Extension zu befüllen.
        return {
            low: price,
            mid: price, 
            high: price
        };
    }

    // Fallback: Wenn keine Near Mint Normal-Variante gefunden, versuchen wir, den ersten Preis zu verwenden
    const firstVariant = cardData.variants[0];
     if (firstVariant) {
        const price = firstVariant.price; 
        return {
            low: price,
            mid: price, 
            high: price
        };
    }

    return { low: null, mid: null, high: null };
}

// HILFSFUNKTION: Simuliert die PSA-Datenaggregation (jetzt leer, da keine Datenquelle)
function aggregatePsaData(ebayHistory) {
    // Wir haben keine Datenquelle mehr für die PSA/eBay-Verkäufe.
    // Wir geben ein leeres Array zurück, damit die Extension korrekt dargestellt wird.
    return []; 
}

// MIDDLEWARE: Prüfung des geheimen Schlüssels (Premium-Authentifizierung)
function authenticateExtension(req, res, next) {
    const providedId = req.headers['x-extension-id'];

    if (providedId && providedId === EXTENSION_ID_SECRET) {
        next(); // Erfolgreich authentifiziert
    } else {
        console.warn(`[AUTH FAILED] Ungültige oder fehlende 'X-Extension-ID': ${providedId}`);
        // Wichtig: 401 senden, damit die Extension weiß, dass Premium fehlt
        return res.status(401).json({ error: "REQUIRES_PREMIUM", message: "Bitte die Erweiterung aktivieren." });
    }
}


// =========================================================
// ROUTE: Preise abrufen (MIT KORRIGIERTER JUSTTCG-LOGIK)
// =========================================================
app.get("/prices", authenticateExtension, async (req, res) => {
    // Wir empfangen den alten Slug im 'set'-Parameter von der Extension
    const { set: oldSlug, cardNumber } = req.query;

    if (!oldSlug || !cardNumber) {
        return res.status(400).json({ error: "Es fehlen 'set' und 'cardNumber' Parameter." });
    }
    
    // 1. NEUES MAPPING ANWENDEN
    const justTcgSetId = JUSTTCG_SET_MAPPING[oldSlug];

    if (!justTcgSetId) {
        console.error(`[MAPPING ERROR] Kein JustTCG Set-ID für den Slug: ${oldSlug} gefunden.`);
        // Senden Sie eine 404, um der Extension zu signalisieren, dass die Karte nicht unterstützt wird.
        return res.status(404).json({ error: "Karte nicht in JustTCG Set-Mapping gefunden. Bitte Mapping erweitern." });
    }

    const cacheKey = `${justTcgSetId}-${cardNumber}`;
    const cachedData = cache.get(cacheKey);

    // 2. CACHE HIT: Prüfen
    if (cachedData && Date.now() - cachedData.timestamp < CACHE_LIFETIME_MS) {
        console.log(`[CACHE HIT] ${cacheKey} - Daten aus dem Cache geladen.`);
        return res.json(cachedData.data);
    }
    
    // 3. CACHE MISS: Neue Daten von JustTCG abrufen
    try {
        console.log(`[CACHE MISS] ${cacheKey} - Rufe Daten von JustTCG ab.`);

        // ⚠️ KORREKTER JustTCG ENDPUNKT: mit 'setId' und 'number'
        const endpoint = `/cards?game=pokemon&setId=${justTcgSetId}&number=${cardNumber}`;
        const justTcgData = await fetchJustTCGApi(endpoint);
        
        // Die JustTCG API gibt ein Array von Karten zurück, wir nehmen die erste.
        if (!justTcgData.data || justTcgData.data.length === 0) {
             console.log(`[404 NOT FOUND] JustTCG fand keine Karte für ${cacheKey}`);
             return res.status(404).json({ error: "Karte nicht in der JustTCG API gefunden." });
        }
        
        const mappedPrices = mapJustTCGPrices(justTcgData);
        const cardName = justTcgData.data[0].name;

        // PSA / eBay LOGIK entfernt (AggregatePsaData liefert jetzt leere Daten)
        const avgPrices = aggregatePsaData([]); 

        const finalResponse = { 
            prices: mappedPrices, 
            fullTitle: cardName, 
            ebay: avgPrices // Ist jetzt immer leer/null
        };
        
        cache.set(cacheKey, { data: finalResponse, timestamp: Date.now() });
        console.log("[REQUEST END] Preise erfolgreich gesendet und im Cache gespeichert.");

        return res.json(finalResponse); 

    } catch (err) {
        // Fängt API-Fehler (z.B. 404 von JustTCG) ab
        if (err.message.includes('404')) {
             return res.status(404).json({ error: "Karte nicht in der API gefunden.", message: "Dienst hat Karte nicht gelistet." });
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

app.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});
