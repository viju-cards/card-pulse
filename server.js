(function () {

  // ─── Set Mapping ────────────────────────────────────────────────────────────
  const setMapping = {
    "MEG":"me01-mega-evolution","SSH":"swsh01-sword-and-shield-base-set",
    "PFL":"me02-phantasmal-flames","DRI":"sv10-destined-rivals",
    "JTG":"sv09-journey-together","PRE":"sv-prismatic-evolutions",
    "SSP":"sv08-surging-sparks","SCR":"sv07-stellar-crown",
    "WHT":"sv-white-flare","CP6":"cp6-expansion-pack-20th-anniversary",
    "s7R":"s7r-blue-sky-stream","s8a":"s8a-25th-anniversary-collection",
    "sm12":"sm12-alter-genesis","sv4K":"sv4k-ancient-roar",
    "BW-P":"bw-p-promotional-cards","XY7":"xy7-bandit-ring",
    "s9a":"s9a-battle-region","XY8b":"xy8-bb-blue-shock",
    "L3":"l3-clash-at-the-summit","sv2D":"sv2d-clay-burst",
    "BW6c":"bw6-cold-flare","XY1x":"xy-bx-collection-x",
    "XY1y":"xy-by-collection-y","sv5a":"sv5a-crimson-haze",
    "XY11c":"xy11-br-cruel-traitor","sv5M":"sv5m-cyber-judge",
    "s10a":"s10a-dark-phantasma","sm10":"sm10-double-blaze",
    "sm11b":"sm11b-dream-league","s6a":"s6a-eevee-heroes",
    "XY6":"xy6-emerald-break","XY11f":"xy11-bb-fever-burst-fighter",
    "BW6f":"bw6-freeze-bolt","sm9b":"sm9b-full-metal-wall",
    "sv4M":"sv4m-future-flash","sm8b":"sm8b-gx-ultra-shiny",
    "XY5g":"xy5-bg-gaia-volcano","L1HG":"l1-heartgold-collection",
    "s11a":"s11a-incandescent-arcana","s11":"s11-lost-abyss",
    "m2a":"m2a-high-class-pack-mega-dream-ex","BW9":"bw9-megalo-cannon",
    "sm11":"sm11-miracle-twin","sm9a":"sm9a-night-unison",
    "sv6a":"sv6a-night-wanderer","s12":"s12-paradigm-trigger",
    "sv7a":"sv7a-paradise-dragona","XY4":"xy4-phantom-gate",
    "BW7":"bw7-plasma-gale","sv2a":"sv2a-pokemon-card-151",
    "CP4":"cp4-premium-champion-pack","XY9":"xy9-rage-of-the-broken-heavens",
    "sv3a":"sv3a-raging-surf","XY8r":"xy8-br-red-flash",
    "XY3":"xy3-rising-fist","SV-P":"sv-p-promotional-cards",
    "sv1S":"sv1s-scarlet-ex","s4a":"s4a-shiny-star-v",
    "sv4a":"sv4a-shiny-treasure-ex","sm10b":"sm10b-sky-legend",
    "sv2P":"sv2p-snow-hazard","L1SS":"l1-soulsilver-collection",
    "s10P":"s10p-space-juggler","BW8s":"bw8-spiral-force",
    "s9":"s9-star-birth","sI100":"si-start-deck-100",
    "sv7":"sv7-stellar-miracle","sm12a":"sm12a-tag-team-gx-tag-all-stars",
    "sm9":"sm9-tag-bolt","sv8a":"sv8a-terastal-fest-ex",
    "BXY":"sm-the-best-of-xy","BW8t":"bw8-thunder-knuckle",
    "XY5t":"xy5-bt-tidal-storm","s10D":"s10d-time-gazer",
    "sv1a":"sv1a-triplet-beat","sm5m":"sm5m-ultra-moon",
    "sm5s":"sm5s-ultra-sun","s8b":"s8b-vmax-climax",
    "s12a":"s12a-vstar-universe","sv1V":"sv1v-violet-ex",
    "XY2":"xy2-wild-blaze","sv5K":"sv5k-wild-force","BLK":"sv-black-bolt"
  };

  const BASE_DOMAIN = 'https://www.card-pulse.com';
  var _minimized = false;

  // ─── Language ────────────────────────────────────────────────────────────────
  const isGerman = function() {
    var val = document.documentElement.getAttribute('data-bs-theme');
    return window.location.pathname.startsWith('/de/') ||
           document.documentElement.lang.startsWith('de');
  };

  // ─── Theme ───────────────────────────────────────────────────────────────────
  const isDark = function() {
    var val = document.documentElement.getAttribute('data-bs-theme');
    if (val === 'dark') return true;
    if (val === 'light') return false;
    var bg = window.getComputedStyle(document.body).backgroundColor;
    var rgb = bg.match(/\d+/g);
    if (rgb) {
      var brightness = (parseInt(rgb[0])*299 + parseInt(rgb[1])*587 + parseInt(rgb[2])*114) / 1000;
      return brightness < 80;
    }
    return false;
  };

  // ─── Condition colors ────────────────────────────────────────────────────────
  const CONDITIONS = [
    { key: 'NEAR_MINT',         label: 'Near Mint',         short: 'NM', color: '#107C10', bg: '#DFF6DD', darkBg: 'rgba(16,124,16,0.2)' },
    { key: 'LIGHTLY_PLAYED',    label: 'Lightly Played',    short: 'LP', color: '#2D7D1F', bg: '#E6F4E0', darkBg: 'rgba(45,125,31,0.2)' },
    { key: 'MODERATELY_PLAYED', label: 'Moderately Played', short: 'MP', color: '#8A6914', bg: '#FFF4CE', darkBg: 'rgba(138,105,20,0.2)' },
    { key: 'HEAVILY_PLAYED',    label: 'Heavily Played',    short: 'HP', color: '#C05000', bg: '#FDEDE3', darkBg: 'rgba(192,80,0,0.2)' },
    { key: 'DAMAGED',           label: 'Damaged',           short: 'D',  color: '#A4262C', bg: '#FDE7E9', darkBg: 'rgba(164,38,44,0.2)' },
  ];

  var fmt = function(v) { return v != null ? '$' + Number(v).toFixed(2) : '—'; };
  var fmtE = function(v) { return v != null ? '€' + (Number(v)*0.92).toFixed(2) : '—'; };

  // ─── Inject styles ───────────────────────────────────────────────────────────
  function injectStyles() {
    var dark = isDark();
    var accent = dark ? '#7b6fff' : '#1a4b8c';
    var bg = dark ? '#16181d' : '#ffffff';
    var surface = dark ? '#1e2028' : '#f7f8fa';
    var border = dark ? 'rgba(255,255,255,0.07)' : '#e4e6ea';
    var text = dark ? '#e8e8f0' : '#1a1a2e';
    var muted = dark ? '#7a7a9a' : '#6b7280';
    var accentBg = dark ? 'rgba(123,111,255,0.1)' : '#f0f4fa';
    var btnBg = dark ? '#7b6fff' : '#1a2e5a';
    var shadow = dark ? '0 4px 24px rgba(0,0,0,0.5)' : '0 2px 14px rgba(26,46,90,0.10)';

    var s = document.getElementById('cp-styles');
    if (!s) { s = document.createElement('style'); s.id = 'cp-styles'; document.head.appendChild(s); }
    s.textContent = [
      '#cp-overlay{position:fixed;top:76px;right:16px;z-index:99999;width:276px;border-radius:12px;overflow:hidden;',
      'font-family:Inter,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:13px;',
      'background:' + bg + ';border:1px solid ' + border + ';box-shadow:' + shadow + ';color:' + text + '}',
      '.cp-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px 9px;border-bottom:1px solid ' + border + '}',
      '.cp-logo{font-size:14px;font-weight:700;letter-spacing:-0.3px;color:' + text + '}',
      '.cp-logo span{color:' + accent + '}',
      
      '.cp-body{padding:12px 14px}',
      '.cp-card-name{font-size:11px;color:' + muted + ';margin-bottom:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cp-market-box{background:' + accentBg + ';border:1.5px solid ' + accent + ';border-radius:8px;padding:12px;text-align:center;margin-bottom:12px}',
      '.cp-market-label{font-size:10px;font-weight:600;color:' + accent + ';text-transform:uppercase;letter-spacing:1px;margin-bottom:2px}',
      '.cp-market-usd{font-size:26px;font-weight:700;color:' + text + ';line-height:1.1}',
      '.cp-market-eur{font-size:13px;font-weight:600;color:' + accent + ';margin-top:1px}',
      '.cp-conditions{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}',
      '.cp-row{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-radius:7px;background:' + surface + ';border:1px solid ' + border + '}',
      '.cp-row-left{display:flex;align-items:center;gap:8px}',
      '.cp-tag{font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;min-width:26px;text-align:center}',
      '.cp-cond-name{font-size:12px;color:' + muted + ';font-weight:500}',
      '.cp-prices{text-align:right}',
      '.cp-usd{font-size:13px;font-weight:600;color:' + text + '}',
      '.cp-eur{font-size:11px;color:' + accent + ';font-weight:500}',
      '.cp-trend-row{display:flex;gap:8px;margin-bottom:12px}',
      '.cp-trend-pill{flex:1;display:flex;flex-direction:column;align-items:center;padding:7px 6px;border-radius:7px;background:' + surface + ';border:1px solid ' + border + ';font-size:11px}',
      '.cp-trend-label{color:' + muted + ';font-weight:600;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:3px}',
      '.cp-trend-up{color:#16a34a;font-size:13px;font-weight:700}',
      '.cp-trend-down{color:#dc2626;font-size:13px;font-weight:700}',
      '.cp-trend-flat{color:' + muted + ';font-size:13px;font-weight:700}',
      '.cp-sparkline-wrap{margin-bottom:12px;background:' + surface + ';border:1px solid ' + border + ';border-radius:7px;padding:10px 10px 6px}',
      '.cp-sparkline-header{display:flex;justify-content:space-between;font-size:10px;font-weight:600;color:' + muted + ';text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px}',
      '.cp-sparkline-svg{width:100%;display:block}',
      '.cp-btn{display:block;width:100%;padding:10px;border:none;border-radius:8px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;text-align:center;margin-bottom:8px;background:' + btnBg + ';color:#fff}',
      '.cp-btn:hover{opacity:.85}',
      '.cp-btn.outline{background:' + (dark?'rgba(255,255,255,0.04)':'transparent') + ';color:' + text + ';border:1px solid ' + border + ';margin-bottom:0}',
      '.cp-footer{border-top:1px solid ' + border + ';padding:7px 14px;display:flex;align-items:center;justify-content:space-between}',
      '.cp-footer-brand{font-size:10px;font-weight:700;color:rgba(128,128,128,0.4);text-transform:uppercase;letter-spacing:1.5px}',
      '.cp-info{padding:20px 14px;text-align:center}',
      '.cp-info p{font-size:13px;color:' + muted + ';margin-bottom:14px;line-height:1.5}',
      '.cp-loading{padding:20px 14px;text-align:center;color:' + muted + ';font-size:13px}',
      '.cp-spinner{display:inline-block;width:18px;height:18px;border:2px solid ' + border + ';border-top-color:' + accent + ';border-radius:50%;animation:cp-spin .7s linear infinite;margin-bottom:8px}',
      '@keyframes cp-spin{to{transform:rotate(360deg)}}',
      '.cp-minimize{width:22px;height:22px;border-radius:5px;border:none;background:' + surface + ';color:' + muted + ';font-size:15px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;line-height:1}',
      '.cp-minimize:hover{opacity:.7}',
      '#cp-overlay.cp-minimized{width:auto!important;min-width:130px}',
      '#cp-overlay.cp-minimized .cp-body,#cp-overlay.cp-minimized .cp-footer,#cp-overlay.cp-minimized .cp-info,#cp-overlay.cp-minimized .cp-loading-body{display:none}',
      '#cp-overlay.cp-minimized .cp-header{border-bottom:none}'
    ].join('');
  }

  // ─── Sparkline ───────────────────────────────────────────────────────────────
  function buildSparkline(history) {
    if (!history || history.length < 2) return '';
    var prices = history.map(function(h) { return h.price; });
    var min = Math.min.apply(null, prices);
    var max = Math.max.apply(null, prices);
    var range = max - min || 0.01;
    var W = 240, H = 40, PAD = 4;
    var pts = prices.map(function(p, i) {
      var x = PAD + (i / (prices.length - 1)) * (W - PAD*2);
      var y = PAD + (1 - (p - min) / range) * (H - PAD*2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var latest = prices[prices.length-1];
    var first = prices[0];
    var lineColor = latest >= first ? '#16a34a' : '#dc2626';
    var label = isGerman() ? 'Preishistorie (NM, 30T)' : '30d price history (NM)';
    return '<div class="cp-sparkline-wrap">' +
      '<div class="cp-sparkline-header"><span>' + label + '</span><span>$' + first.toFixed(2) + ' → $' + latest.toFixed(2) + '</span></div>' +
      '<svg class="cp-sparkline-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" height="40">' +
      '<defs><linearGradient id="cpG" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + lineColor + '" stop-opacity="0.18"/>' +
      '<stop offset="100%" stop-color="' + lineColor + '" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      '<polygon points="' + pts.join(' ') + ' ' + (W-PAD).toFixed(1) + ',' + H + ' ' + PAD + ',' + H + '" fill="url(#cpG)"/>' +
      '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + lineColor + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + pts[pts.length-1].split(',')[0] + '" cy="' + pts[pts.length-1].split(',')[1] + '" r="2.5" fill="' + lineColor + '"/>' +
      '</svg></div>';
  }

  // ─── Trend row ───────────────────────────────────────────────────────────────
  function buildTrendRow(trend) {
    if (!trend) return '';
    var de = isGerman();
    function pill(label, stat) {
      if (!stat || stat.changePercent == null) return '<div class="cp-trend-pill"><span class="cp-trend-label">' + label + '</span><span class="cp-trend-flat">—</span></div>';
      var pct = stat.changePercent;
      var sign = pct > 0 ? '+' : '';
      var cls = pct > 0.5 ? 'cp-trend-up' : pct < -0.5 ? 'cp-trend-down' : 'cp-trend-flat';
      return '<div class="cp-trend-pill"><span class="cp-trend-label">' + label + '</span><span class="' + cls + '">' + sign + pct.toFixed(1) + '%</span></div>';
    }
    var avg30 = trend['30d'] && trend['30d'].avg != null ? '$' + trend['30d'].avg.toFixed(2) : null;
    return '<div class="cp-trend-row">' +
      pill(de ? '7T' : '7D', trend['7d']) +
      pill(de ? '30T' : '30D', trend['30d']) +
      (avg30 ? '<div class="cp-trend-pill"><span class="cp-trend-label">' + (de?'30T Ø':'30D avg') + '</span><span class="cp-trend-flat">' + avg30 + '</span></div>' : '') +
      '</div>';
  }

  // ─── Build overlay ───────────────────────────────────────────────────────────
  function buildOverlay(response) {
    injectStyles();
    var box = document.getElementById('cp-overlay');
    if (!box) { box = document.createElement('div'); box.id = 'cp-overlay'; document.body.appendChild(box); }

    var prices = response && response.prices || {};
    var cardName = response && response.card && response.card.name || null;
    var isPremium = response && response.user && response.user.plan === 'premium';
    var err = response && response.error;
    var de = isGerman();

    var header = '<div class="cp-header">' +
      '<div class="cp-logo">card<span>pulse</span></div>' +
      '<button class="cp-minimize" id="cp-min-btn">' + (_minimized ? '+' : '−') + '</button>' +
      '</div>';

    var footer = '<div class="cp-footer"><span class="cp-footer-brand">CardPulse</span></div>';

    if (err === 'LOGIN_REQUIRED' || err === 'CONNECTION_ERROR') {
      box.innerHTML = header +
        '<div class="cp-info"><p>' + (de ? 'Melde dich an, um TCGPlayer-Preise zu sehen.' : 'Sign in to see TCGPlayer prices.') + '</p>' +
        '<button class="cp-btn" id="cp-login-btn">' + (de ? 'Bei CardPulse anmelden' : 'Sign in to CardPulse') + '</button></div>' +
        footer;
      var lb = box.querySelector('#cp-login-btn');
      if (lb) lb.addEventListener('click', function() { window.open(BASE_DOMAIN + '/login.html', '_blank'); });

    } else if (err === 'PAYMENT_REQUIRED') {
      box.innerHTML = header +
        '<div class="cp-info"><p>' + (de ? 'Upgrade für live TCGPlayer-Preise.' : 'Upgrade to see live TCGPlayer prices.') + '</p>' +
        '<button class="cp-btn" id="cp-upgrade-btn">' + (de ? 'Jetzt upgraden' : 'Upgrade now') + '</button></div>' +
        footer;
      var ub = box.querySelector('#cp-upgrade-btn');
      if (ub) ub.addEventListener('click', function() { window.open(BASE_DOMAIN + '/dashboard.html', '_blank'); });

    } else if (err === 'LIMIT_REACHED') {
      var plan = (response.plan || 'bronze').charAt(0).toUpperCase() + (response.plan || 'bronze').slice(1);
      var used = response.used || 0;
      var limit = response.limit || 20;
      var limitMsg = de
        ? 'Du hast dein monatliches Limit von ' + limit + ' Anfragen (' + plan + ') erreicht.'
        : 'You have used all ' + limit + ' monthly requests on your ' + plan + ' plan.';
      var upgradeMsg = de ? 'Jetzt upgraden' : 'Upgrade plan';
      box.innerHTML = header +
        '<div class="cp-info">' +
        '<div style="font-size:28px;margin-bottom:8px">📊</div>' +
        '<p style="font-weight:600;margin-bottom:6px">' + (de ? 'Limit erreicht' : 'Limit reached') + '</p>' +
        '<p style="font-size:12px;margin-bottom:16px">' + limitMsg + '</p>' +
        '<button class="cp-btn" id="cp-limit-btn">' + upgradeMsg + '</button>' +
        '</div>' +
        footer;
      var lb2 = box.querySelector('#cp-limit-btn');
      if (lb2) lb2.addEventListener('click', function() { window.open(BASE_DOMAIN + '/dashboard.html', '_blank'); });

    } else if (err === 'CARD_NOT_FOUND') {
      box.innerHTML = header +
        '<div class="cp-info"><p>' + (de ? 'Für diese Karte sind noch keine TCGPlayer-Preise verfügbar.' : 'No TCGPlayer data available for this card yet.') + '</p>' +
        '<button class="cp-btn outline" id="cp-suggest-btn">' + (de ? 'Fehlende Karte melden' : 'Report missing card') + '</button></div>' +
        footer;
      var sb = box.querySelector('#cp-suggest-btn');
      if (sb) sb.addEventListener('click', function() { window.open(BASE_DOMAIN + '/suggest.html?url=' + encodeURIComponent(window.location.href), '_blank'); });

    } else {
      var mkt = prices.MARKET_PRICE || prices.NEAR_MINT;
      var dark = isDark();
      var condRows = CONDITIONS.map(function(c) {
        var val = prices[c.key];
        var tagBg = dark ? c.darkBg : c.bg;
        return '<div class="cp-row"><div class="cp-row-left">' +
          '<span class="cp-tag" style="background:' + tagBg + ';color:' + c.color + '">' + c.short + '</span>' +
          '<span class="cp-cond-name">' + c.label + '</span></div>' +
          '<div class="cp-prices"><div class="cp-usd">' + fmt(val) + '</div><div class="cp-eur">' + fmtE(val) + '</div></div></div>';
      }).join('');

      box.innerHTML = header +
        '<div class="cp-body">' +
        (cardName ? '<div class="cp-card-name">' + cardName + '</div>' : '') +
        '<div class="cp-market-box">' +
        '<div class="cp-market-label">' + (de ? 'Marktpreis' : 'TCGPlayer Market Price') + '</div>' +
        '<div class="cp-market-usd">' + fmt(mkt) + '</div>' +
        '<div class="cp-market-eur">' + fmtE(mkt) + '</div>' +
        '</div>' +
        buildTrendRow(response.trend) +
        buildSparkline(response.history) +
        '<div class="cp-conditions">' + condRows + '</div>' +
        '<button class="cp-btn outline" id="cp-dash-btn">' + (de ? 'Dashboard & Aboverwaltung' : 'Dashboard & Subscription') + '</button>' +
        '</div>' +
        footer;
      var db = box.querySelector('#cp-dash-btn');
      if (db) db.addEventListener('click', function() { window.open(BASE_DOMAIN + '/dashboard.html', '_blank'); });
    }

    // Apply minimized state
    if (_minimized) {
      box.classList.add('cp-minimized');
    } else {
      box.classList.remove('cp-minimized');
    }

    // Minimize button handler
    var minBtn = box.querySelector('#cp-min-btn');
    if (minBtn) {
      minBtn.addEventListener('click', function() {
        _minimized = !_minimized;
        box.classList.toggle('cp-minimized', _minimized);
        minBtn.textContent = _minimized ? '+' : '−';
      });
    }
  }

  // ─── Show loading ────────────────────────────────────────────────────────────
  function showLoading() {
    injectStyles();
    var box = document.getElementById('cp-overlay');
    if (!box) { box = document.createElement('div'); box.id = 'cp-overlay'; document.body.appendChild(box); }
    var de = isGerman();
    box.innerHTML = '<div class="cp-header">' +
      '<div class="cp-logo">card<span>pulse</span></div>' +
      '<button class="cp-minimize" id="cp-min-btn-load">' + (_minimized ? '+' : '−') + '</button>' +
      '</div>' +
      '<div class="cp-loading-body"><div class="cp-loading"><div class="cp-spinner"></div><br>' + (de ? 'Lädt...' : 'Loading...') + '</div></div>';
    if (_minimized) box.classList.add('cp-minimized');
    else box.classList.remove('cp-minimized');
    var mlb = box.querySelector('#cp-min-btn-load');
    if (mlb) mlb.addEventListener('click', function() {
      _minimized = !_minimized;
      box.classList.toggle('cp-minimized', _minimized);
      mlb.textContent = _minimized ? '+' : '−';
    });
  }

  // ─── Fetch prices ────────────────────────────────────────────────────────────
  function fetchPrices(setSlug, cardNumber) {
    showLoading();
    chrome.storage.local.remove(['cp_result'], function() {
      chrome.runtime.sendMessage(
        { type: 'FETCH_PRICES', payload: { set: setSlug, cardNumber: cardNumber } },
        function() {
          chrome.storage.local.get(['cp_result'], function(r) {
            buildOverlay(r.cp_result || { error: 'CONNECTION_ERROR' });
            chrome.storage.local.remove(['cp_result']);
          });
        }
      );
    });
  }

  // ─── Watch for theme changes ─────────────────────────────────────────────────
  var lastDark = isDark();
  var observer = new MutationObserver(function() {
    var nowDark = isDark();
    if (nowDark !== lastDark) {
      lastDark = nowDark;
      injectStyles();
    }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] });

  // ─── Detect card ─────────────────────────────────────────────────────────────
  var h1 = document.querySelector('h1');
  if (h1) {
    var match = h1.innerText.match(/\(([A-Za-z0-9-]{2,5})\s*(\d{1,3}[A-Za-z]?)\)/);
    if (match) {
      if (setMapping[match[1]]) {
        fetchPrices(setMapping[match[1]], match[2]);
      } else {
        buildOverlay({ error: 'CARD_NOT_FOUND' });
      }
    }
  }

})();
