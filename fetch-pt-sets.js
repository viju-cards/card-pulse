const fetch = require("node-fetch");
const fs = require("fs");
require("dotenv").config();

const API_KEY = process.env.PPT_API_KEY;

if (!API_KEY) {
  console.error("PPT_API_KEY fehlt in .env!");
  process.exit(1);
}

async function fetchAllSets() {
  const url = "https://www.pokemonpricetracker.com/api/v2/sets";

  try {
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${API_KEY}` }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API Fehler ${res.status}: ${text}`);
    }

    const data = await res.json();

    if (!data || !Array.isArray(data.data)) {
      throw new Error("Ungültige API-Antwort");
    }

    fs.writeFileSync("pt-set-mapping-full.json", JSON.stringify(data.data, null, 2));
    console.log(`Mapping gespeichert in ./pt-set-mapping-full.json`);

    data.data.forEach(set => {
      console.log(`${set.id} -> ${set.name} (slug: ${set.slug})`);
    });

  } catch (err) {
    console.error("Fehler beim Abrufen der Sets:", err.message);
  }
}

fetchAllSets();
