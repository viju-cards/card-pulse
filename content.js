// content.js (Aktualisierte Version 3 - Einheitliches Design)

(function () {

    console.debug("[PokéScout] content.js loaded");

    // -----------------------------------------------------------
    //  SET-MAPPING
    // -----------------------------------------------------------
    const setMapping = {
        "MEG": "me01-mega-evolution",
        "SSH": "swsh01-sword-and-shield-base-set",
        "PFL": "me02-phantasmal-flames",
        "BLK": "sv-black-bolt"
    };

    // -----------------------------------------------------------
    //  EXTRACT: Titel → Set-Kürzel + Kartennummer
    // -----------------------------------------------------------
    function extractSetInfo() {
        const title = document.querySelector("h1");
        if (!title) return null;

        const text = title.innerText.trim();
        const match = text.match(/\(([A-Z]{2,3})\s*(\d{1,3}[A-Za-z]?)\)/);

        if (!match) return null;

        return {
            setCode: match[1],
            number: match[2],
            fullTitle: text
        };
    }

    // -----------------------------------------------------------
    //  Preise vom Background Script holen (holt TCGPlayer + PSA Avg)
    // -----------------------------------------------------------
    function fetchPrices(setSlug, cardNumber, cardTitle) {
        chrome.runtime.sendMessage({
            type: "FETCH_PRICES",
            payload: {
                set: setSlug,
                cardNumber: cardNumber
            }
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("[PokéScout] Fehler beim Senden der Nachricht:", chrome.runtime.lastError);
                createOverlay({ error: "Fehler: Background Service nicht erreichbar." }, cardTitle);
                return;
            }
            const data = response.data;
            
            console.log("[PokéScout DEBUG] Empfangene Daten vom Server:", data);
            
            createOverlay(data, cardTitle);
        });
    }


    // -----------------------------------------------------------
    //  Overlay erstellen (FINALES KACHEL-LAYOUT)
    // -----------------------------------------------------------
    function createOverlay(data, cardTitle) {
        const prices = data.prices || {}; 
        const ebayPrices = data.ebay || {}; // PSA Averages vom Server
        const error = data.error;

        // DEFINITION DER FOKUS-FARBE
        const focusColor = '#60a5fa'; // Himmelblau für MARKET PRICE und PSA 10

        let box = document.getElementById("price-overlay");
        if (box) box.remove();
        box = document.createElement("div");
        box.id = "price-overlay";
        
        // MODERNE STYLES
        box.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            padding: 20px; 
            background: #1e293b; 
            border-radius: 12px; 
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.7);
            color: #f1f5f9; 
            width: 350px; 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        `;

        let html = `<h3 style="margin-top:0;font-size:20px; color: ${focusColor}; border-bottom: 2px solid #334155; padding-bottom: 10px; margin-bottom: 15px;">TCGPlayer Preise</h3>`;

        if (error && Object.keys(ebayPrices).length === 0) {
            html += `<p style="color: #f44336; margin: 0;">Fehler: ${error}</p>`;
        } else {
            
            // 1. TCGPlayer-Preise in Kacheln (Listen-Layout)
            const tcgConditions = ['market', 'lowNM', 'lowLP', 'lowMP', 'lowHP', 'lowPOOR'];
            
            const conditionMap = {
                'market': 'MARKET PRICE',
                'lowNM': 'Near Mint',
                'lowLP': 'Lightly Played',
                'lowMP': 'Moderately Played',
                'lowHP': 'Heavily Played',
                'lowPOOR': 'Damaged/Poor'
            };
            
            html += `<div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 30px;">`;
            
            tcgConditions.forEach(key => {
                const priceValue = prices[key];
                
                const displayPrice = (priceValue !== null && priceValue !== undefined) 
                    ? `$${priceValue.toFixed(2)}` 
                    : "--"; 
                    
                // MARKET PRICE behält die Fokus-Farbe
                let priceColor = (key === 'market') ? focusColor : ((displayPrice === "--") ? '#94a3b8' : '#FFFFFF');
                
                const titleSize = '12px';
                const priceSize = (key === 'market') ? '28px' : '20px';
                
                html += `
                    <div style="
                        padding: 12px 15px; 
                        background: #29415c; 
                        border-radius: 8px; 
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        border-left: 4px solid ${key === 'market' ? focusColor : '#475569'};
                    ">
                        <div style="font-size: ${titleSize}; color: #94a3b8; font-weight: 500; text-transform: uppercase;">
                            ${conditionMap[key]}
                        </div>
                        <div style="font-size: ${priceSize}; color: ${priceColor}; font-weight: bold;">
                            ${displayPrice}
                        </div>
                    </div>
                `;
            });
            html += `</div>`;


            // 2. EBAY/PSA KACHELN (Jetzt Listen-Layout und blaue Fokus-Farbe)
            html += `
                <h3 style="font-size:20px;margin-bottom:15px; color: ${focusColor}; border-bottom: 2px solid #334155; padding-bottom: 10px;">eBay PSA Durchschnittspreise</h3>
                <div style="display: flex; flex-direction: column; gap: 10px;">
            `;

            const psaGrades = [10, 9, 8];
            psaGrades.forEach(grade => {
                const gradeKey = `psa${grade}`;
                const psaData = ebayPrices[gradeKey];
                
                const avgPrice = psaData && psaData.avg !== null ? psaData.avg : null;
                const salesCount = psaData && psaData.count !== null ? psaData.count : 0;

                const displayPrice = (avgPrice !== null) ? `$${avgPrice.toFixed(2)}` : "--";
                const displayCount = (salesCount > 0) ? `${salesCount} Verkäufe` : "Keine Daten";
                
                // Preis-Farbe ist jetzt Fokus-Farbe (Blau)
                const priceColor = (avgPrice !== null) ? focusColor : '#94a3b8'; 

                html += `
                    <div style="
                        padding: 12px 15px; 
                        background: #29415c; 
                        border-radius: 8px; 
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        /* PSA 10 erhält die blaue Fokus-Farbe */
                        border-left: 4px solid ${grade === 10 ? focusColor : '#475569'}; 
                    ">
                        <div>
                             <div style="font-size: 14px; color: #f1f5f9; font-weight: bold; margin-bottom: 2px;">
                                PSA ${grade}
                            </div>
                            <div style="font-size: 11px; color: #94a3b8;">
                                ${displayCount}
                            </div>
                        </div>
                        <div style="font-size: 22px; color: ${priceColor}; font-weight: bold;">
                            ${displayPrice}
                        </div>
                    </div>
                `;
            });

            html += `</div>`; // Ende eBay/PSA Container
            
        }

        box.innerHTML = html;
        document.body.appendChild(box);
    }

    // ----------------------------------------------------------
    //  INIT
    // ----------------------------------------------------------
    function init() {
        const setInfo = extractSetInfo();
        if (!setInfo) return;

        const setSlug = setMapping[setInfo.setCode];
        if (!setSlug) {
            console.error(`[PokéScout] Init: Set-Kürzel '${setInfo.setCode}' fehlt in setMapping!`);
            return;
        }

        fetchPrices(setSlug, setInfo.number, setInfo.fullTitle);
    }

    init();

})();