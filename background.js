// background.js (Aufgeräumte Version)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  let isAsync = false; 

  // -------------------------------------------------------------
  // FETCH_PRICES (Holt jetzt alle Daten: TCGPlayer + PSA Avg)
  // -------------------------------------------------------------
  if (message.type === "FETCH_PRICES") {
    isAsync = true; 

    const { set, cardNumber, tcgPlayerId } = message.payload;

    const params = new URLSearchParams();
    if (set) params.append("set", set);
    if (cardNumber) params.append("cardNumber", cardNumber);
    if (tcgPlayerId) params.append("tcgPlayerId", tcgPlayerId);

    fetch(`http://localhost:3000/prices?${params.toString()}`)
      .then(r => r.json())
      .then(data => sendResponse({ data }))
      .catch(err => {
        // Wichtig: sendResponse MUSS im Fehlerfall aufgerufen werden
        console.error("FETCH_PRICES Error:", err);
        sendResponse({ data: { error: "Server nicht erreichbar oder JSON-Fehler" }});
      });
  }

  // -------------------------------------------------------------
  // FETCH_PSA_HISTORY (ENTFERNT)
  // -------------------------------------------------------------

  // Signalisiert, dass die Antwort asynchron gesendet wird
  return isAsync; 
});