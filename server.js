const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const API_KEY = process.env.JUST_TCG_API_KEY;
const API_BASE_URL = "https://api.justtcg.com";

function mapAndFilterPrices(apiData) {
    const prices = {};
    if (apiData.data && apiData.data[0] && apiData.data[0].skus) {
        apiData.data[0].skus.forEach(sku => {
            const cond = sku.condition.toUpperCase();
            if (!prices[cond]) {
                prices[cond] = sku.price;
            }
        });
        prices['LOW'] = apiData.data[0].lowPrice;
        prices['MARKET PRICE'] = apiData.data[0].marketPrice;
        prices['HIGH'] = apiData.data[0].highPrice;
    }
    return prices;
}

app.get("/prices", async (req, res) => {
    const { set: setSlug, cardNumber } = req.query;
    if (!setSlug || !cardNumber) return res.status(400).json({ error: "Parameter fehlen" });

    // Cardmarket zeigt oft "013", in der DB könnte aber "13" stehen.
    // Wir loggen beide Varianten zum Debuggen.
    let dbNum = cardNumber.padStart(3, '0');

    try {
        console.log(`--- DEBUG START ---`);
        console.log(`Suche in DB nach: Slug=${setSlug}, Nummer=${dbNum}`);

        const dbRes = await pool.query(
            "SELECT tcg_player_id FROM card_mapping WHERE cardmarket_slug = $1 AND card_number = $2",
            [setSlug, dbNum]
        );
        
        const tcgId = dbRes.rows[0]?.tcg_player_id;
        
        // HIER IST DER FEHLER-CHECK:
        console.log(`Datenbank Ergebnis: ${tcgId ? tcgId : "NICHT GEFUNDEN"}`);

        if (!tcgId) {
            return res.status(404).json({ error: "Mapping nicht in Datenbank gefunden" });
        }

        // 2. JustTCG API abfragen
        const apiRes = await fetch(`${API_BASE_URL}/v1/cards?tcgplayerId=${tcgId}`, {
            headers: { "X-API-KEY": API_KEY }
        });
        const justTcgData = await apiRes.json();

        if (!justTcgData.data || justTcgData.data.length === 0) {
            return res.status(404).json({ error: "Keine Daten von JustTCG erhalten" });
        }

        const mappedPrices = mapAndFilterPrices(justTcgData);
        const cardTitle = justTcgData.data[0].name;

        console.log(`API geladen für: ${cardTitle} (TCG-ID: ${tcgId})`);
        console.log(`--- DEBUG ENDE ---`);

        res.json({
            prices: mappedPrices,
            fullTitle: cardTitle
        });

    } catch (err) {
        console.error("Server Error:", err);
        res.status(500).json({ error: "SERVER_ERROR" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
