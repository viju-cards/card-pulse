// server.js - FINALE VERSION MIT KORRIGIERTER API BASIS-URL

const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg"); 
require("dotenv").config(); 

const app = express();
const PORT = process.env.PORT || 3000;

const API_BASE_URL_PPT = "https://api.justtcg.com/v1"; 

const API_KEY = process.env.JUSTTCG_API_KEY; 
const EXTENSION_ID_SECRET = process.env.EXTENSION_ID_SECRET; 
const DATABASE_URL = process.env.DATABASE_URL; 

if (!DATABASE_URL || !API_KEY || !EXTENSION_ID_SECRET) {
    console.error("FATAL ERROR: Eine oder mehrere kritische Umgebungsvariablen (DATABASE_URL, JUSTTCG_API_KEY, EXTENSION_ID_SECRET) fehlen. Server wird beendet.");
    process.exit(1); 
}


const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false 
    }
});

app.use(express.json());

// ... (Restliche Funktionen (fetchPriceTrackerApi, getTcgPlayerIdFromDb, etc.) sind aus der letzten Version unverändert und korrekt.)

// ... (ROUTE /prices und SERVER START sind unverändert.)

app.listen(PORT, async () => {
    console.log(`Server läuft auf Port ${PORT}`);
    try {
        await pool.query('SELECT NOW()');
        console.log("✅ Neon-Datenbank erfolgreich verbunden.");
    } catch (err) {
        console.error("❌ Fehler bei der Neon-Datenbankverbindung:", err.message);
    }
});
