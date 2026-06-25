// CardPulse · Preisalarme / Merkliste (sprachbasiert, NM, rein über TCGGO RapidAPI).
//
// Einbinden in server.js (eine Zeile, nach app + pool + Auth-Middleware):
//
//   require('./watchlist')(app, {
//     pool,                                   // dein pg-Pool (pool.query(text, params) -> { rows })
//     requireAuth,                            // deine JWT-Middleware; setzt req.user = { id, plan, email }
//     resendApiKey: process.env.RESEND_API_KEY,
//     rapidApiKey:  process.env.RAPIDAPI_KEY,
//     rapidApiHost: process.env.RAPIDAPI_HOST || 'cardmarket-api-tcg.p.rapidapi.com',
//     cronSecret:   process.env.CRON_SECRET,
//   });
//
// Annahmen (ggf. an deinen Code anpassen):
//  - pool.query(text, params) gibt { rows } zurück (node-postgres). Nutzt du den Neon-
//    serverless `sql`-Tag, ersetze die query()-Aufrufe entsprechend.
//  - requireAuth legt req.user = { id, plan, email } an. Heißt es bei dir req.userId,
//    pass die drei Zugriffe unten an.
//  - users-Tabelle hat Spalten id + email.

module.exports = function registerWatchlist(app, deps) {
  const { pool, requireAuth, resendApiKey, rapidApiKey, cronSecret } = deps;
  const rapidApiHost = deps.rapidApiHost || 'cardmarket-api-tcg.p.rapidapi.com';

  // Nur diese Pläne dürfen Alarme anlegen, mit Karten-Cap. Bronze/Silver: keine Alarme.
  const CAPS = { gold: 25, platin: 100 };
  const LANGS = ['EN', 'DE', 'FR', 'ES', 'IT'];
  const LANG_WORD = { EN: 'English', DE: 'German', FR: 'French', ES: 'Spanish', IT: 'Italian' };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const TCGGO_DELAY_MS = 300; // Drossel zwischen RapidAPI-Calls

  // ── Preis je Sprache aus dem cardmarket-Block ────────────────────────────────
  // EN gibt es NICHT als eigenes Feld → Basis-Feld lowest_near_mint. DE/FR/ES/IT
  // über lowest_near_mint_<LANG>. Null-guard: fehlt der Wert, kein Alarm.
  function priceForLang(cm, lang) {
    if (!cm) return null;
    const v = lang === 'EN' ? cm.lowest_near_mint : cm['lowest_near_mint_' + lang];
    return (typeof v === 'number' && v > 0) ? v : null;
  }

  // ── TCGGO: pro (Name + Nummer) eine Liste holen (Name+Nummer ist NICHT eindeutig) ──
  async function fetchTcggoCards(name, cardNumber) {
    if (!rapidApiKey) { console.warn('[alerts] RAPIDAPI_KEY fehlt'); return []; }
    // ⚠️ Pfad/Host gegen deinen funktionierenden Playground-Call prüfen, der die Liste lieferte.
    const url = new URL(`https://${rapidApiHost}/pokemon/cards`);
    url.searchParams.set('name', name);
    url.searchParams.set('card_number', cardNumber);
    try {
      const r = await fetch(url.toString(), {
        headers: { 'x-rapidapi-key': rapidApiKey, 'x-rapidapi-host': rapidApiHost, 'accept': 'application/json' },
      });
      if (!r.ok) { console.warn(`[alerts] TCGGO HTTP ${r.status} (${name} ${cardNumber})`); return []; }
      const data = await r.json();
      return Array.isArray(data && data.data) ? data.data : [];
    } catch (e) {
      console.error('[alerts] TCGGO error:', e.message);
      return [];
    }
  }

  // ── Resend ───────────────────────────────────────────────────────────────────
  async function sendResendEmail(to, subject, text, html) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'CardPulse <info@card-pulse.com>', to: [to], subject, text, html }),
      });
      if (!r.ok) console.error('[alerts] Resend HTTP', r.status, await r.text().catch(() => ''));
    } catch (e) {
      console.error('[alerts] Resend error:', e.message);
    }
  }

  // ── Digest-Mail (1..n Treffer je Nutzer) ─────────────────────────────────────
  function buildAlertEmail(items) {
    const cardBlock = (it) => {
      const lang = LANG_WORD[it.language] || it.language;
      const cur = Number(it.currentPrice).toFixed(2);
      const tgt = Number(it.targetPrice).toFixed(2);
      const diff = Number(it.targetPrice) - Number(it.currentPrice);
      const below = diff > 0 ? `\u20ac${diff.toFixed(2)} below your target` : 'at your target';
      const img = it.imageUrl
        ? `<td width="134" valign="top" style="padding:14px 0 14px 14px"><img src="${it.imageUrl}" width="118" alt="${it.cardName}" style="width:118px;border-radius:9px;display:block;border:0;outline:0"></td>`
        : '';
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #ececf0;border-radius:12px;margin-bottom:12px">
  <tr>
    ${img}
    <td valign="top" style="padding:14px">
      <div style="font-size:16px;font-weight:bold;color:#1a1a2e;line-height:1.3">${it.cardName}</div>
      <div style="margin:8px 0 14px">
        <span style="font-size:11px;font-weight:bold;color:#3c3a52;background:#eeecfb;border-radius:6px;padding:3px 9px">${lang}</span>
        &nbsp;<span style="font-size:11px;font-weight:bold;color:#444;background:#f3f4f7;border-radius:6px;padding:3px 9px">Near Mint</span>
      </div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="padding-right:20px">
          <div style="font-size:10px;font-weight:bold;letter-spacing:.6px;text-transform:uppercase;color:#8a90a0">Current</div>
          <div style="font-size:24px;font-weight:bold;color:#16a34a;line-height:1.1">\u20ac${cur}</div>
        </td>
        <td>
          <div style="font-size:10px;font-weight:bold;letter-spacing:.6px;text-transform:uppercase;color:#8a90a0">Your target</div>
          <div style="font-size:16px;font-weight:bold;color:#5b6172;line-height:1.1">\u20ac${tgt}</div>
        </td>
      </tr></table>
      <div style="margin-top:12px;font-size:12px;font-weight:bold;color:#16a34a">${below}</div>
      <a href="${it.cardmarketUrl}" style="display:inline-block;margin-top:12px;font-size:13px;font-weight:bold;color:#7c6cff;text-decoration:none">View offers on Cardmarket &rarr;</a>
    </td>
  </tr>
</table>`;
    };

    const many = items.length > 1;
    const first = items[0];
    const lang0 = LANG_WORD[first.language] || first.language;
    const subject = many
      ? `${items.length} price targets reached`
      : `Price target reached: ${first.cardName} (${lang0})`;
    const heading = many ? `${items.length} of your price targets were reached` : 'Your target price was reached';

    const text = items.map((it) => {
      const lang = LANG_WORD[it.language] || it.language;
      return `${it.cardName} - ${lang}\nCurrent (NM): \u20ac${Number(it.currentPrice).toFixed(2)}  ·  Target: \u20ac${Number(it.targetPrice).toFixed(2)}\n${it.cardmarketUrl}`;
    }).join('\n\n');

    const html =
`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f7;margin:0;padding:24px 0;font-family:Helvetica,Arial,sans-serif">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:480px;background:#ffffff;border:1px solid #e4e6ea;border-radius:14px">
      <tr><td style="padding:18px 24px;border-bottom:1px solid #eef0f3;font-size:18px;font-weight:bold;color:#1a1a2e">card<span style="color:#7c6cff">pulse</span></td></tr>
      <tr><td style="padding:22px 24px 6px">
        <div style="font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#7c6cff">Price alert</div>
        <div style="font-size:20px;font-weight:bold;color:#1a1a2e;margin:6px 0 6px">${heading}</div>
        <div style="font-size:14px;line-height:22px;color:#5b6172;margin:0 0 18px">${many ? 'Cards on your watchlist just dropped to your target on Cardmarket.' : 'A card on your watchlist just dropped to your target on Cardmarket.'}</div>
        ${items.map(cardBlock).join('')}
      </td></tr>
      <tr><td style="padding:16px 24px 22px;border-top:1px solid #eef0f3">
        <div style="font-size:12px;line-height:18px;color:#9aa0ad">You set ${many ? 'these alerts' : 'this alert'} on CardPulse. <a href="https://www.card-pulse.com/dashboard.html" style="color:#7c6cff;text-decoration:none;font-weight:bold">Manage your alerts</a> anytime.</div>
      </td></tr>
    </table>
  </td></tr>
</table>`;

    return { subject, text, html };
  }

  // ── Endpoints ────────────────────────────────────────────────────────────────

  // Alarm anlegen / aktualisieren. Erwartet die TCGGO-Felder vom Overlay (aus /prices).
  app.post('/watchlist', requireAuth, async (req, res) => {
    try {
      const plan = (req.user.plan || 'bronze').toLowerCase();
      const cap = CAPS[plan];
      if (!cap) return res.status(403).json({ error: 'UPGRADE_REQUIRED', message: 'Price alerts require Gold or Platin.' });

      const b = req.body || {};
      const tcggoId = parseInt(b.tcggo_id, 10);
      const language = String(b.language || '').toUpperCase();
      const target = Number(b.target_eur);
      if (!tcggoId || !b.card_name || !b.card_number) return res.status(400).json({ error: 'MISSING_FIELDS' });
      if (!LANGS.includes(language)) return res.status(400).json({ error: 'BAD_LANGUAGE' });
      if (!(target > 0)) return res.status(400).json({ error: 'BAD_TARGET' });

      // Existiert dieser Alarm (selbe Karte+Sprache) schon? Dann ist es ein Update, kein neuer Slot.
      const existing = await pool.query(
        'SELECT id FROM watchlist_items WHERE user_id=$1 AND tcggo_id=$2 AND language=$3',
        [req.user.id, tcggoId, language]
      );
      if (existing.rows.length === 0) {
        const cnt = await pool.query('SELECT COUNT(*)::int AS n FROM watchlist_items WHERE user_id=$1', [req.user.id]);
        if (cnt.rows[0].n >= cap) {
          return res.status(403).json({ error: 'CAP_REACHED', cap, message: `Alarm limit reached (${cap}).` });
        }
      }

      const out = await pool.query(
        `INSERT INTO watchlist_items
           (user_id, tcggo_id, card_name, card_code, card_number, language, target_eur, image_url, cardmarket_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (user_id, tcggo_id, language)
         DO UPDATE SET target_eur=EXCLUDED.target_eur, image_url=EXCLUDED.image_url,
                       cardmarket_url=EXCLUDED.cardmarket_url, card_code=EXCLUDED.card_code,
                       last_notified_at=NULL
         RETURNING *`,
        [req.user.id, tcggoId, b.card_name, b.card_code || null, String(b.card_number),
         language, target, b.image_url || null, b.cardmarket_url || null]
      );
      res.json({ item: out.rows[0] });
    } catch (e) {
      console.error('[alerts] POST /watchlist', e.message);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // Liste des Nutzers (Dashboard + Popup).
  app.get('/watchlist', requireAuth, async (req, res) => {
    try {
      const out = await pool.query(
        'SELECT * FROM watchlist_items WHERE user_id=$1 ORDER BY created_at DESC',
        [req.user.id]
      );
      res.json({ items: out.rows });
    } catch (e) {
      console.error('[alerts] GET /watchlist', e.message);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // Löschen – POST (nicht DELETE!), weil die CORS-Config nur GET/POST/OPTIONS erlaubt.
  app.post('/watchlist/delete', requireAuth, async (req, res) => {
    try {
      const id = parseInt((req.body || {}).id, 10);
      if (!id) return res.status(400).json({ error: 'MISSING_ID' });
      await pool.query('DELETE FROM watchlist_items WHERE id=$1 AND user_id=$2', [id, req.user.id]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[alerts] POST /watchlist/delete', e.message);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // ── Cron: alle Alarme prüfen ─────────────────────────────────────────────────
  // Von einem externen Scheduler getriggert (Render Cron / cron-job.org), 1x/Tag oder /12h.
  // Geschützt per Secret-Header. Dedupliziert pro (Name+Nummer) → 1 TCGGO-Call je Kartengruppe.
  app.post('/internal/run-alerts', async (req, res) => {
    if (!cronSecret || req.get('x-cron-secret') !== cronSecret) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    try {
      const rows = (await pool.query('SELECT * FROM watchlist_items')).rows;

      // Nach (card_name|card_number) gruppieren → 1 Abfrage je Gruppe, egal wie viele Nutzer/Sprachen.
      const groups = new Map();
      for (const r of rows) {
        const key = r.card_name + '|' + r.card_number;
        if (!groups.has(key)) groups.set(key, { name: r.card_name, number: r.card_number, rows: [] });
        groups.get(key).rows.push(r);
      }

      const hitsByUser = new Map(); // user_id -> [item, ...]
      let checked = 0;

      for (const g of groups.values()) {
        const cards = await fetchTcggoCards(g.name, g.number);
        await sleep(TCGGO_DELAY_MS);
        const byId = new Map();
        for (const c of cards) byId.set(c.id, c.prices && c.prices.cardmarket);

        for (const r of g.rows) {
          const cm = byId.get(r.tcggo_id);
          const price = priceForLang(cm, r.language);
          if (price == null) continue;   // Sprache aktuell ohne Angebot → überspringen
          checked++;

          const target = Number(r.target_eur);
          const wasAbove = (r.last_price == null) || (Number(r.last_price) > target);
          const isHit = price <= target && wasAbove;   // Edge-Trigger: nur beim Unterschreiten

          if (isHit) {
            await pool.query(
              'UPDATE watchlist_items SET last_price=$1, last_price_at=now(), last_notified_at=now() WHERE id=$2',
              [price, r.id]
            );
            const item = {
              cardName: `${r.card_name} (${r.card_code || r.card_number})`,
              language: r.language,
              imageUrl: r.image_url,
              currentPrice: price,
              targetPrice: target,
              cardmarketUrl: r.cardmarket_url,
            };
            if (!hitsByUser.has(r.user_id)) hitsByUser.set(r.user_id, []);
            hitsByUser.get(r.user_id).push(item);
          } else {
            await pool.query('UPDATE watchlist_items SET last_price=$1, last_price_at=now() WHERE id=$2', [price, r.id]);
          }
        }
      }

      // Eine Digest-Mail pro Nutzer.
      let notified = 0;
      for (const [userId, items] of hitsByUser) {
        const u = await pool.query('SELECT email FROM users WHERE id=$1', [userId]);
        const email = u.rows[0] && u.rows[0].email;
        if (!email) continue;
        const { subject, text, html } = buildAlertEmail(items);
        await sendResendEmail(email, subject, text, html);
        notified++;
      }

      res.json({ ok: true, groups: groups.size, checked, notified });
    } catch (e) {
      console.error('[alerts] run-alerts', e.message);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });
};
