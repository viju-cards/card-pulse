// server.js auf Ihrem Render-Server (Version mit Supabase Limit und alter PPT Logik - OHNE CORS)

const express = require("express");
const { Client } = require('pg'); // PostgreSQL Client für Supabase
const crypto = require('crypto'); // Für die temporäre Token-Generierung
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.PPT_API_KEY;

// Supabase/PostgreSQL Konfiguration
const FREE_LIMIT = 10;
// Holt den geheimen Verbindungssstring aus den Render Umgebungsvariablen
const CONNECTION_STRING = process.env.POSTGRES_CONNECTION_STRING; 

// Middleware
// app.use(cors()); <--- ENTFERNT!
app.use(express.json());


// =========================================================
// HILFSFUNKTION: API-Abfrage (Vom Nutzer übernommen)
// =========================================================
async function fetchPriceTrackerApi(apiUrl) {
    if (!API_KEY) {
        throw new Error("PPT_API_KEY fehlt in der Konfiguration!"); 
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

// =========================================================
// HILFSFUNKTION: Preise Mappen und Filtern (Vom Nutzer übernommen)
// =========================================================
function mapAndFilterPrices(prices) {
    const toFloatOrNull = (value) => {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const result = parseFloat(value);
        return isNaN(result) ? null : result; 
    };

    const getConditionPrice = (conditions, conditionName) => {
        if (conditions && conditions[conditionName] && conditions[conditionName].price) {
            return toFloatOrNull(conditions[conditionName].price);
        }
        return null;
    };

    if (!prices) {
        return { market: null }; 
    }

    const conditions = prices.conditions || {}; 
    
    const mappedPrices = {
        market: toFloatOrNull(prices.market), 
        lowNM: getConditionPrice(conditions, "Near Mint"), 
        lowLP: getConditionPrice(conditions, "Lightly Played"),
        lowMP: getConditionPrice(conditions, "Moderately Played"),
        lowHP: getConditionPrice(conditions, "Heavily Played"),
        lowPOOR: getConditionPrice(conditions, "Damaged"), 
    };
    
    return mappedPrices;
}


// -------------------------------------------------------------------
// 🎯 API ROUTE: /prices (GESICHERT & LIMITIERT)
// -------------------------------------------------------------------

app.get("/prices", async (req, res) => {
  
    // --- 1. Token extrahieren (NEUE AUTH LOGIK) ---
    const authHeader = req.headers['authorization'];
    const authToken = authHeader ? authHeader.split(' ')[1] : null;

    if (!authToken) {
        return res.status(401).json({ error: "REQUIRES_AUTH", message: "Bitte melden Sie sich an, um Preise abzurufen." });
    }

    let client;
    try {
        // --- 2. DB Verbindung und Auth/Limit Check ---
        client = new Client({ connectionString: CONNECTION_STRING });
        await client.connect();

        const userResult = await client.query('SELECT * FROM users WHERE api_token = $1', [authToken]);
        const user = userResult.rows[0];

        if (!user) {
            // Token ist ungültig
            await client.end();
            return res.status(404).json({ error: "REQUIRES_AUTH", message: "Unbekannter Token oder Benutzer." });
        }
        
        const isPro = user.plan_status === 'pro';
        const today = new Date().toISOString().split('T')[0];
        
        // Stellt sicher, dass das Datum korrekt verglichen wird
        const lastRequestDate = new Date(user.last_request_date).toISOString().split('T')[0]; 
        let dailyRequests = user.daily_requests;
        
        // --- 3. Limit-Logik durchsetzen (NUR für Free-User) ---
        if (!isPro) {
            
            // Wenn der Tag gewechselt hat: Zähler zurücksetzen
            if (lastRequestDate !== today) {
                dailyRequests = 0;
            }

            if (dailyRequests >= FREE_LIMIT) {
                await client.end();
                return res.status(403).json({ error: "LIMIT_EXCEEDED", message: "Tägliches Free Limit überschritten. Bitte aktualisieren Sie." });
            }
        }
        
        // -------------------------------------------------------------------
        // --- 4. PREISABFRAGE START (INTEGRIERTE PPT-LOGIK) ---
        // -------------------------------------------------------------------
        const { set: setSlug, cardNumber, tcgPlayerId } = req.query; 

        console.log(`\n[REQUEST START] Empfangen: Set=${setSlug}, Nummer=${cardNumber}, TCG ID: ${tcgPlayerId}`);
        
        if (!setSlug && !tcgPlayerId) {
            return res.status(400).json({ error: "set oder tcgPlayerId muss übergeben werden" });
        }

        let card;
        const ebayParam = "&includeEbay=true";

        if (tcgPlayerId) {
            // PFAD 1: Abfrage direkt per TCGPlayer ID
            const apiUrl = `https://www.pokemonpricetracker.com/api/v2/cards?tcgPlayerId=${encodeURIComponent(
                tcgPlayerId
            )}&includeBoth=true${ebayParam}`;
            
            const result = await fetchPriceTrackerApi(apiUrl);
            card = Array.isArray(result.data) ? result.data[0] : result.data;

        } else if (setSlug && cardNumber) {
            // PFAD 2: Abfrage per Set/Nummer (Zwei-Schritt-Prozess)
            
            // SCHRITT 1: Finde TCGPlayer ID über Set-Suche
            let apiUrl = `https://www.pokemonpricetracker.com/api/v2/cards?set=${encodeURIComponent(
                setSlug
            )}&fetchAllInSet=true`; 
            
            const result1 = await fetchPriceTrackerApi(apiUrl);
            const cards = result1.data;
            
            const searchNumber = String(cardNumber).trim(); 
            const filtered = cards?.filter((c) => {
                const apiNumber = String(c.cardNumber || "").replace(/\s/g, '').trim(); 
                return apiNumber.includes(searchNumber);
            }) || [];
            
            if (filtered.length === 0) {
                 card = null;
            } else {
                 const targetCard = filtered[0];
                 const targetTcgPlayerId = targetCard.tcgPlayerId;

                 console.log(`[SUCCESS SCHRITT 1] Karte gefunden: ${targetCard.name} (ID: ${targetTcgPlayerId})`);

                 // SCHRITT 2: Hole die Historie mit der TCGPlayer ID
                 if (!targetTcgPlayerId) {
                    card = null;
                 } else {
                    apiUrl = `https://www.pokemonpricetracker.com/api/v2/cards?tcgPlayerId=${encodeURIComponent(
                        targetTcgPlayerId
                    )}&includeBoth=true${ebayParam}`;
                    
                    const result2 = await fetchPriceTrackerApi(apiUrl);
                    card = Array.isArray(result2.data) ? result2.data[0] : result2.data;
                 }
            }
        }


        // --- PSA-DATEN EXTRAHIEREN (VOM NUTZER-CODE ÜBERNOMMEN) ---
        let avgPrices = {};
        const grades = [10, 9, 8];

        if (card?.ebay?.salesByGrade) {
            const salesByGrade = card.ebay.salesByGrade;
            
            grades.forEach(grade => {
                const gradeKey = `psa${grade}`;
                const gradeData = salesByGrade[gradeKey];
                
                if (gradeData?.averagePrice !== undefined) {
                     avgPrices[gradeKey] = {
                        avg: parseFloat(gradeData.averagePrice),
                        count: gradeData.count || 0
                    };
                }
            });
        } 

        // --- 5. Zähler erhöhen und in DB speichern (NEUE LOGIK) ---
        // Der Zähler wird nur bei erfolgreicher Autorisierung und Limit-Prüfung erhöht.
        if (!isPro) {
            dailyRequests++;
            await client.query(
                'UPDATE users SET daily_requests = $1, last_request_date = $2 WHERE id = $3', 
                [dailyRequests, today, user.id]
            );
        }
        
        // --- 6. Endgültige Antwort senden ---
        const mappedPrices = card?.prices ? mapAndFilterPrices(card.prices) : null;
            
        const finalResponse = { 
            prices: mappedPrices, 
            fullTitle: card?.name, 
            ebay: avgPrices, 
            error: !card && card !== undefined ? `Karte Nummer ${cardNumber} nicht im Set ${setSlug} gefunden.` : undefined
        };
        
        return res.json(finalResponse); 

    } catch (err) {
        console.error("[FATAL ERROR] Interner Serverfehler:", err);
        // ACHTUNG: KEIN ZÄHLER-UPDATE BEI FATALEM FEHLER
        return res.status(500).json({ error: `SERVER_ERROR`, message: `Interner Serverfehler: ${err.message}` });
    } finally {
        if (client) await client.end(); // Verbindung immer schließen
    }
});


// -------------------------------------------------------------------
// 🧪 NEUE ROUTE: /auth/generate-token (Temporäre Test-Route)
// -------------------------------------------------------------------
app.post('/auth/generate-token', async (req, res) => {
    let client;
    try {
        client = new Client({ connectionString: CONNECTION_STRING });
        await client.connect();
        
        // Generiert einen sicheren, zufälligen Token
        const token = crypto.randomBytes(32).toString('hex'); 
        
        // Fügt einen neuen Benutzer mit dem Status 'free' in die Datenbank ein
        const result = await client.query(
            'INSERT INTO users (api_token, plan_status, daily_requests, last_request_date) VALUES ($1, $2, $3, NOW()) RETURNING api_token', 
            [token, 'free', 0] 
        );

        res.json({ success: true, token: result.rows[0].api_token });
        
    } catch (err) {
        console.error("Fehler beim Token-Generierung:", err);
        res.status(500).json({ error: "TOKEN_ERROR", message: "Konnte keinen Token generieren." });
    } finally {
        if (client) await client.end();
    }
});


// -------------------------------------------------------------------
// ROUTE 2, 3: (Unverändert)
// -------------------------------------------------------------------
app.get("/get-meg-cards", async (req, res) => {
    return res.status(501).json({ error: "Route nur für Debugging" });
});


app.get("/psa-history", async (req, res) => {
    return res.status(501).json({ error: "PSA History Endpunkt nicht implementiert" });
});


// -------------------------------------------------------------------
// 🚀 SERVER START
// -------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Pika Poke Server läuft auf Port ${PORT}`);
  if (!API_KEY) {
    console.error("ACHTUNG: PPT_API_KEY fehlt. API-Abfragen werden fehlschlagen!");
  }
});
