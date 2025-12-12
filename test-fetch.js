// test-fetch.js
const fetch = require("node-fetch");
require("dotenv").config();

const apiUrl = "https://www.pokemonpricetracker.com/api/v2/cards?search=Mega%20Charizard%20X-EX&includeBoth=true";

console.log("PT_API_KEY:", process.env.PT_API_KEY);

fetch(apiUrl, {
  headers: { "Authorization": `Bearer ${process.env.PT_API_KEY}` }
})
  .then(res => res.json())
  .then(console.log)
  .catch(console.error);
