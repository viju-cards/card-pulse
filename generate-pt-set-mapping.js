// generate-pt-set-mapping.js
const fetch = require("node-fetch");
const fs = require("fs");
require("dotenv").config();

const PPT_API_KEY = process.env.PPT_API_KEY;
if (!PPT_API_KEY) {
  console.error("Bitte PPT_API_KEY in .env setzen!");
  process.exit(1);
}

async function fetchAllSets() {
  const url = "https://www.pokemonpricetracker.com/api/v2/sets";
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${PPT_API_KEY}` },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Fehler beim Abrufen der Sets:", res.status, text);
    process.exit(1);
  }

  const data = await res.json();
  return data.data; // array von Sets
}

async function buildMapping() {
  const sets = await fetchAllSets();

  const mapping = {};

  sets.forEach((set) => {
    mapping[set.id] = {
      ptId: set.id,
      name: set.name,
    };
  });

  return mapping;
}

async function main() {
  const mapping = await buildMapping();
  const outPath = "./pt-set-mapping-full.json";
  fs.writeFileSync(outPath, JSON.stringify(mapping, null, 2), "utf-8");
  console.log("Mapping gespeichert in", outPath);
  console.log("Einige Sets:", Object.values(mapping).slice(0, 10));
}

main().catch((e) => {
  console.error("Fehler:", e);
  process.exit(1);
});
