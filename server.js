// server.js (Mit Zwei-Schritt-Prozess und PSA/Aggregierter Daten-Logik)

const express = require("express");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.PPT_API_KEY;

// =========================================================
// HILFSFUNKTION: API-Abfrage (Kapselung für Wiederverwendung)
// =========================================================
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

// =========================================================
// HILFSFUNKTION: Preise Mappen und Filtern (TCGPlayer)
// =========================================================
function mapAndFilterPrices(prices) {
    const toFloatOrNull = (value) => {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const result = parseFloat(value);
        // Wir verwenden die Original-Keys aus der API, aber stellen sicher, dass sie Zahlen sind.
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
    
    // Die Keys müssen mit denen in content.js übereinstimmen: market, lowNM, lowLP, etc.
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


// =========================================================
// ROUTE 1: /prices (HAUPT-LOGIK: TCGPlayer + PSA AVG)
// =========================================================
app.get("/prices", async (req, res) => {
  // tcgPlayerId wird jetzt von der content.js mitgeschickt, wenn vorhanden
  const { set: setSlug, cardNumber, tcgPlayerId } = req.query; 

  console.log(`\n[REQUEST START] Empfangen: Set=${setSlug}, Nummer=${cardNumber}, TCG ID: ${tcgPlayerId}`);
  
  if (!setSlug && !tcgPlayerId) {
    return res.status(400).json({ error: "set oder tcgPlayerId muss übergeben werden" });
  }

  try {
    let card;
    const ebayParam = "&includeEbay=true"; // Wichtig für PSA/eBay-Daten

    // --- SCHRITT 1 & 2: KARTEN-ID FINDEN UND DATEN HOLEN ---
    if (tcgPlayerId) {
        // PFAD 1: Abfrage direkt per TCGPlayer ID (wenn von content.js mitgeliefert)
        const apiUrl = `https://www.pokemonpricetracker.com/api/v2/cards?tcgPlayerId=${encodeURIComponent(
            tcgPlayerId
        )}&includeBoth=true${ebayParam}`;
        
        const result = await fetchPriceTrackerApi(apiUrl);
        card = Array.isArray(result.data) ? result.data[0] : result.data;

    } else if (setSlug && cardNumber) {
        // PFAD 2: Abfrage per Set/Nummer (Zwei-Schritt-Prozess, wenn TCG ID fehlt)
        
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
             return res.json({ error: `Karte Nummer ${cardNumber} nicht im Set ${setSlug} gefunden.` });
        }
        
        const targetCard = filtered[0];
        const targetTcgPlayerId = targetCard.tcgPlayerId;

        console.log(`[SUCCESS SCHRITT 1] Karte gefunden: ${targetCard.name} (ID: ${targetTcgPlayerId})`);

        // SCHRITT 2: Hole die Historie mit der TCGPlayer ID
        if (!targetTcgPlayerId) {
             return res.json({ error: "Karte gefunden, aber TCGPlayer ID fehlt. Keine detaillierten Preise möglich." });
        }

        apiUrl = `https://www.pokemonpricetracker.com/api/v2/cards?tcgPlayerId=${encodeURIComponent(
            targetTcgPlayerId
        )}&includeBoth=true${ebayParam}`;
        
        const result2 = await fetchPriceTrackerApi(apiUrl);
        card = Array.isArray(result2.data) ? result2.data[0] : result2.data;
    }


    // --- PSA-DATEN EXTRAHIEREN UND AVG BERECHNEN (Defensive Logik) ---
    let avgPrices = {};
    let psaSales = [];
    let sourcePath = "Nicht gefunden";
    const grades = [10, 9, 8];

    // 1. NEUE LOGIK: AGGREGIERTE DATEN PRÜFEN (card.ebay.salesByGrade)
    if (card?.ebay?.salesByGrade) {
        const salesByGrade = card.ebay.salesByGrade;
        
        grades.forEach(grade => {
            const gradeKey = `psa${grade}`;
            const gradeData = salesByGrade[gradeKey];
            
            if (gradeData?.averagePrice !== undefined) {
                 // Aggregierte Daten direkt verwenden
                 avgPrices[gradeKey] = {
                    avg: parseFloat(gradeData.averagePrice),
                    count: gradeData.count || 0
                };
            }
        });
        
        if (Object.keys(avgPrices).length > 0) {
            sourcePath = "card.ebay.salesByGrade (Aggregated)";
        }
    }

    // 2. FALLBACK-LOGIK: RAW-VERKAUFSLISTE PRÜFEN (card.history)
    if (Object.keys(avgPrices).length === 0 && card?.history) {
        
        if (card.history.ebay) {
            psaSales = card.history.ebay;
            sourcePath = "card.history.ebay (Raw)";
        } else if (card.history.psa) {
            psaSales = card.history.psa;
            sourcePath = "card.history.psa (Raw)";
        } else if (card.history.graded) {
            psaSales = card.history.graded;
            sourcePath = "card.history.graded (Raw)";
        }
        
        // Durchschnitt aus Raw-Daten berechnen
        if (psaSales.length > 0) {
            grades.forEach(grade => {
                const salesForGrade = psaSales.filter(sale => sale.grade == grade); 
                
                if (salesForGrade.length > 0) {
                    const sum = salesForGrade.reduce((acc, sale) => acc + parseFloat(sale.price), 0);
                    const avg = sum / salesForGrade.length;
                    const count = salesForGrade.length;

                    avgPrices[`psa${grade}`] = {
                        avg: parseFloat(avg.toFixed(2)),
                        count: count
                    };
                }
            });
        }
    }
    
    console.log(`[DEBUG] PSA Sales Quelle: ${sourcePath}. PSA Averages gefunden: ${Object.keys(avgPrices).length}`);


    // Endgültige Antwort senden
    const mappedPrices = card?.prices ? mapAndFilterPrices(card.prices) : null;
        
    const finalResponse = { 
        prices: mappedPrices, 
        fullTitle: card?.name, 
        ebay: avgPrices // Die PSA Averages
    };
    
    console.log("--- FINAL RESPONSE JSON (FINAL RESPONSE) ---");
    console.log(JSON.stringify(finalResponse, null, 2)); 
    console.log("-----------------------------------");
        
    console.log("[REQUEST END] Preise und PSA-Avg erfolgreich gesendet.");
    return res.json(finalResponse); 

  } catch (err) {
    console.error("[FATAL ERROR] Interner Serverfehler:", err);
    return res.status(500).json({ error: `Interner Serverfehler: ${err.message}` });
  }
});


// =========================================================
// ROUTE 2, 3: (Unverändert)
// =========================================================
app.get("/get-meg-cards", async (req, res) => {
    // Debug-Route
    return res.status(501).json({ error: "Route nur für Debugging" });
});


app.get("/psa-history", async (req, res) => {
    // Endpunkt für die Detail-Ansicht (noch nicht implementiert)
    return res.status(501).json({ error: "PSA History Endpunkt nicht implementiert" });
});


// =========================================================
// SERVER START
// =========================================================
app.listen(PORT, () => {
  console.log(`Pika Poke Server läuft auf http://localhost:${PORT}`);
  if (!API_KEY) {
    console.error("ACHTUNG: PPT_API_KEY fehlt. API-Abfragen werden fehlschlagen!");
  }
});