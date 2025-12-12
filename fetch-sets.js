// fetch-sets.js (CommonJS for easy-run)
const fetch = require('node-fetch');
require('dotenv').config();


const PPT_API_KEY = process.env.PPT_API_KEY;
if (!PPT_API_KEY) {
console.error('Bitte PPT_API_KEY in .env setzen!');
process.exit(1);
}


async function fetchAllSets() {
const url = 'https://www.pokemonpricetracker.com/api/v2/sets';
try {
const res = await fetch(url, { headers: { Authorization: `Bearer ${PPT_API_KEY}` } });
if (!res.ok) {
const text = await res.text();
throw new Error(`API Fehler ${res.status}: ${text}`);
}


const data = await res.json();
if (!data || !Array.isArray(data.data)) throw new Error('Ungültige API-Antwort');


// Drucke CSV-like lines: id,name
data.data.forEach(set => {
console.log(`${set.id}\t${set.name}`);
});


console.log(`\nInsgesamt ${data.data.length} Sets gefunden.`);
} catch (err) {
console.error('Fehler beim Abrufen der Sets:', err.message);
}
}


fetchAllSets();