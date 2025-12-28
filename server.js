// content.js - FINAL VERSION MIT PREMIUM-HINWEISEN

function injectPriceBox(element, data) {
    // Falls schon eine Box da ist, entfernen
    const oldBox = element.querySelector('.pokecardscout-box');
    if (oldBox) oldBox.remove();

    const box = document.createElement('div');
    box.className = 'pokecardscout-box';
    box.style.border = "1px solid #ccc";
    box.style.padding = "10px";
    box.style.marginTop = "10px";
    box.style.backgroundColor = "#f9f9f9";
    box.style.borderRadius = "8px";

    if (data.error === "LOGIN_REQUIRED") {
        box.innerHTML = `
            <div style="color: #d9534f; font-weight: bold;">🔑 Login erforderlich</div>
            <div style="font-size: 12px;">Klicke auf das PokeCardScout Icon oben rechts, um dich einzuloggen.</div>
        `;
    } else if (data.error === "PAYMENT_REQUIRED") {
        box.innerHTML = `
            <div style="color: #f0ad4e; font-weight: bold;">⭐ Premium Feature</div>
            <div style="font-size: 12px;">Dieses Feature benötigt ein aktives Abo.</div>
            <a href="https://pokecardscout-api.onrender.com" target="_blank" style="color: #0070f3; font-size: 11px;">Jetzt upgraden</a>
        `;
    } else if (data.prices) {
        box.innerHTML = `
            <div style="font-weight: bold; color: #333;">TCGPlayer Preis:</div>
            <div style="font-size: 18px; color: #28a745;">$${data.prices['MARKET PRICE'] || '---'}</div>
            <div style="font-size: 10px; color: #999;">${data.fullTitle || ''}</div>
        `;
    } else {
        box.innerHTML = `<div style="color: #999;">Keine Preisdaten gefunden.</div>`;
    }

    element.appendChild(box);
}

// Beobachtet Cardmarket auf Änderungen (z.B. beim Blättern)
const observer = new MutationObserver(() => {
    const targetElement = document.querySelector('.product-description'); // Beispiel-Selector
    if (targetElement && !targetElement.querySelector('.pokecardscout-box')) {
        // Hier deine Logik zum Extrahieren von Set und Nummer
        const set = "base-set"; // Beispiel
        const cardNumber = "4";  // Beispiel

        chrome.runtime.sendMessage({
            type: "FETCH_PRICES",
            payload: { set, cardNumber }
        }, (response) => {
            if (response) injectPriceBox(targetElement, response);
        });
    }
});

observer.observe(document.body, { childList: true, subtree: true });
