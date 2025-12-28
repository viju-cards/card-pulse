const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();

// WICHTIG: CORS muss installiert sein!
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

    let dbNum = cardNumber.padStart(3, '0');

    try {
        // 1. Abfrage der Datenbank nach der ID
        const dbRes = await pool.query(
            "SELECT tcg_player_id FROM card_mapping WHERE cardmarket_slug = $1 AND card_number = $2",
            [setSlug, dbNum]
        );
        
        const tcgId = dbRes.rows[0]?.tcg_player_id;
        
        // DEBUG LOGS für Render/Terminal
        console.log(`[DEBUG] Suche Karte: ${setSlug} #${dbNum}`);
        console.log(`[DEBUG] DB-Ergebnis TCG-ID: ${tcgId}`);

        if (!tcgId) {
            return res.status(404).json({ error: "ID nicht in Datenbank" });
        }

        // 2. Abfrage der API
        const apiRes = await fetch(`${API_BASE_URL}/v1/cards?tcgplayerId=${tcgId}`, {
            headers: { "X-API-KEY": API_KEY }
        });
        const justTcgData = await apiRes.json();

        if (!justTcgData.data || justTcgData.data.length === 0) {
            return res.status(404).json({ error: "Keine API-Daten" });
        }

        const cardName = justTcgData.data[0].name;
        console.log(`[DEBUG] API liefert Name: ${cardName}`);

        const mappedPrices = mapAndFilterPrices(justTcgData);

        res.json({
            prices: mappedPrices,
            fullTitle: cardName
        });

    } catch (err) {
        console.error("CRITICAL ERROR:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server gestartet auf Port ${PORT}`));
