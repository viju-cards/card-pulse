// server.js – CardPulse Backend (Finale Version)
// Routes: /auth/register, /auth/login, /auth/me
//         /stripe/checkout, /stripe/portal, /webhook
//         /prices, /sets

const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// ─── ENV-Prüfung ────────────────────────────────────────────────────────────
const REQUIRED_ENVS = [
  "DATABASE_URL",
  "JUSTTCG_API_KEY",
  "JWT_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_ID",
  "FRONTEND_URL",          // https://www.card-pulse.com
];

for (const key of REQUIRED_ENVS) {
  if (!process.env[key]) {
    console.error(`FATAL: Umgebungsvariable "${key}" fehlt. Server wird beendet.`);
    process.exit(1);
  }
}

// ─── Datenbank ───────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ─── Plan Limits ─────────────────────────────────────────────────────────────
const PLAN_LIMITS = {
  bronze:     20,
  silver:     400,
  gold:       1000,
  platin:     5000,
  enterprise: 999999, // fallback – overridden by custom_request_limit
};

const STRIPE_PLANS = {
  silver: process.env.STRIPE_PRICE_SILVER,
  gold:   process.env.STRIPE_PRICE_GOLD,
  platin: process.env.STRIPE_PRICE_PLATIN,
};

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ─── Statische Dateien (Webseite aus /public Ordner) ─────────────────────────
app.use(express.static('public'));

// ─── Body Parser ─────────────────────────────────────────────────────────────
app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// ─── JWT Middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ error: "LOGIN_REQUIRED" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "LOGIN_REQUIRED" });
  }
}

function requirePremium(req, res, next) {
  if (!req.user.is_premium && req.user.plan === 'bronze') {
    // Bronze still allowed – limit checked in route
  }
  next();
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────
async function getUserById(id) {
  const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return result.rows[0] || null;
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, is_premium: user.is_premium },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
}

async function fetchJustTcg(tcgPlayerId) {
  const params = new URLSearchParams({
    tcgplayerId: tcgPlayerId,
    include_price_history: 'true',
    priceHistoryDuration: '30d',
    include_statistics: '7d,30d',
  });
  const url = `https://api.justtcg.com/v1/cards?${params}`;
  const response = await fetch(url, {
    headers: { "X-API-KEY": process.env.JUSTTCG_API_KEY },
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`JustTCG Fehler (${response.status}): ${err}`);
  }
  return response.json();
}

function mapPrices(data) {
  const cardData = Array.isArray(data.data) ? data.data[0] : null;
  if (!cardData?.variants) return {};

  const conditionPrices = {};
  const allPrices = [];

  for (const variant of cardData.variants) {
    const price = variant.marketPrice ?? variant.price;
    if (typeof price !== "number") continue;
    const key = variant.condition.toUpperCase().trim();
    allPrices.push(price);
    if (!conditionPrices[key] || price < conditionPrices[key]) {
      conditionPrices[key] = price;
    }
  }

  return {
    MARKET_PRICE:      conditionPrices["NEAR MINT"] ?? null,
    NEAR_MINT:         conditionPrices["NEAR MINT"] ?? null,
    LIGHTLY_PLAYED:    conditionPrices["LIGHTLY PLAYED"] ?? null,
    MODERATELY_PLAYED: conditionPrices["MODERATELY PLAYED"] ?? null,
    HEAVILY_PLAYED:    conditionPrices["HEAVILY PLAYED"] ?? null,
    DAMAGED:           conditionPrices["DAMAGED"] ?? conditionPrices["POOR"] ?? null,
    LOW:               allPrices.length ? Math.min(...allPrices) : null,
    HIGH:              allPrices.length ? Math.max(...allPrices) : null,
  };
}

// Extract trend + history from the best (NM Normal English) variant
function extractTrendAndHistory(data) {
  const variants = data.data?.[0]?.variants ?? [];

  // Priority: NM Normal English → NM Holofoil English → any NM → first variant
  const nmVariant =
    variants.find(v => v.condition === "Near Mint" && v.printing === "Normal"   && v.language === "English") ??
    variants.find(v => v.condition === "Near Mint" && v.printing === "Holofoil" && v.language === "English") ??
    variants.find(v => v.condition === "Near Mint") ??
    variants[0];

  if (!nmVariant) return { trend: { "7d": null, "30d": null }, history: [] };

  const trend = {
    "7d": nmVariant.priceChange7d != null ? {
      changePercent: nmVariant.priceChange7d,         // already a % value e.g. -3.86
      avg:           nmVariant.minPrice7d ?? null,
    } : null,
    "30d": nmVariant.priceChange30d != null ? {
      changePercent: nmVariant.priceChange30d,
      avg:           nmVariant.avgPrice30d ?? null,
    } : null,
  };

  // priceHistory: [{p: price, t: unix_timestamp}] → [{price, date}]
  const history = (nmVariant.priceHistory ?? [])
    .filter(h => h.p != null && h.t != null)
    .map(h => ({
      price: h.p,
      date:  new Date(h.t * 1000).toISOString().split("T")[0],
    }))
    .slice(-30);

  return { trend, history };
}


// ═══════════════════════════════════════════════════════════════════════════
// E-MAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

// HTML-Escaping für Werte, die aus User-Input stammen (z. B. Suggest-Notiz/URL)
function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Gemeinsames, e-mail-sicheres Grundgerüst (table-basiert, inline-CSS)
function emailLayout({ preheader = "", contentHtml = "", footerNote = "" }) {
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>CardPulse</title>
<style>
  @media (prefers-color-scheme: dark) {
    .cp-bg { background:#0f1115 !important; }
    .cp-card { background:#16181d !important; border-color:rgba(255,255,255,0.08) !important; }
    .cp-text { color:#e8e8f0 !important; }
    .cp-muted { color:#9a9ab0 !important; }
    .cp-wordmark { color:#e8e8f0 !important; }
  }
  @media only screen and (max-width:620px) {
    .cp-card { width:100% !important; border-radius:0 !important; }
    .cp-pad { padding-left:24px !important; padding-right:24px !important; }
  }
</style>
</head>
<body class="cp-bg" style="margin:0;padding:0;background:#f4f4f7;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="cp-bg" style="background:#f4f4f7;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="cp-card" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #e4e6ea;border-radius:14px;overflow:hidden;">
          <tr>
            <td class="cp-pad" style="padding:28px 40px 8px 40px;">
              <span class="cp-wordmark" style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;letter-spacing:-0.5px;color:#1a1a2e;">card<span style="color:#6c63ff;">pulse</span></span>
            </td>
          </tr>
          <tr>
            <td class="cp-pad cp-text" style="padding:12px 40px 24px 40px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1a1a2e;">
${contentHtml}
            </td>
          </tr>
        </table>
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
          <tr>
            <td class="cp-muted" align="center" style="padding:20px 24px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#9a9aae;">
              CardPulse · <a href="https://www.card-pulse.com" target="_blank" style="color:#9a9aae;text-decoration:underline;">card-pulse.com</a>${footerNote ? "<br>" + footerNote : ""}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Passwort-Reset ────────────────────────────────────────────────────────────
function buildResetEmailHtml(resetUrl) {
  const safeUrl = escapeHtml(resetUrl);
  const content = `              <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:inherit;">Passwort zurücksetzen</h1>
              <p style="margin:12px 0;">Hallo,</p>
              <p style="margin:12px 0;">du hast angefragt, dein CardPulse-Passwort zurückzusetzen. Klicke auf den Button, um ein neues Passwort zu vergeben:</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px 0;">
                <tr>
                  <td bgcolor="#6c63ff" style="border-radius:8px;">
                    <a href="${safeUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Passwort zurücksetzen</a>
                  </td>
                </tr>
              </table>
              <p class="cp-muted" style="margin:16px 0 8px 0;font-size:13px;color:#6b7280;">Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br><a href="${safeUrl}" target="_blank" style="color:#6c63ff;word-break:break-all;">${safeUrl}</a></p>
              <p class="cp-muted" style="margin:8px 0;font-size:13px;color:#6b7280;">Der Link ist <strong>1 Stunde</strong> gültig. Falls du das nicht angefordert hast, kannst du diese E-Mail ignorieren – dein Passwort bleibt unverändert.</p>
              <p style="margin:16px 0 0 0;">Dein CardPulse Team</p>`;
  return emailLayout({
    preheader: "Setze dein CardPulse-Passwort zurück – der Link ist 1 Stunde gültig.",
    contentHtml: content,
  });
}

function buildResetEmailText(resetUrl) {
  return `Hallo,

du hast angefragt, dein CardPulse-Passwort zurückzusetzen.

Öffne diesen Link, um ein neues Passwort zu vergeben (gültig 1 Stunde):
${resetUrl}

Falls du das nicht angefordert hast, ignoriere diese E-Mail – dein Passwort bleibt unverändert.

Dein CardPulse Team
card-pulse.com`;
}

// ── Suggest / Fehlende Karte (interne Benachrichtigung) ─────────────────────────
function buildSuggestEmailHtml(url, note) {
  const safeUrl = escapeHtml(url);
  const safeNote = note ? escapeHtml(note).replace(/\n/g, "<br>") : "(keine)";
  const content = `              <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:inherit;">Fehlende Karte gemeldet</h1>
              <p style="margin:12px 0;">Über das Meldeformular wurde ein fehlendes Produkt gemeldet:</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;background:#f7f8fa;border:1px solid #e4e6ea;border-radius:10px;">
                <tr>
                  <td style="padding:16px 18px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a2e;">
                    <strong>Cardmarket-URL</strong><br>
                    <a href="${safeUrl}" target="_blank" style="color:#6c63ff;word-break:break-all;">${safeUrl}</a>
                    <br><br>
                    <strong>Zusätzliche Infos</strong><br>
                    ${safeNote}
                  </td>
                </tr>
              </table>`;
  return emailLayout({
    preheader: "Neue Produkt-Meldung über card-pulse.com/suggest",
    contentHtml: content,
    footerNote: "Gesendet über card-pulse.com/suggest",
  });
}

function buildSuggestEmailText(url, note) {
  return `Fehlende Karte gemeldet

Cardmarket-URL: ${url}

Zusätzliche Infos:
${note || "(keine)"}

Gesendet über card-pulse.com/suggest`;
}


// ═══════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.post("/auth/register", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "E-Mail und Passwort erforderlich." });
  if (password.length < 8)
    return res.status(400).json({ error: "Passwort muss mindestens 8 Zeichen haben." });

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length > 0)
      return res.status(409).json({ error: "E-Mail bereits registriert." });

    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, is_premium, created_at)
       VALUES ($1, $2, false, NOW()) RETURNING id, email, is_premium`,
      [email.toLowerCase(), password_hash]
    );

    const user = result.rows[0];
    const token = generateToken(user);
    res.status(201).json({ token, user: { id: user.id, email: user.email, is_premium: false } });
  } catch (err) {
    console.error("[/auth/register]", err.message);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "E-Mail und Passwort erforderlich." });

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
    const user = result.rows[0];

    if (!user) return res.status(401).json({ error: "Ungültige Anmeldedaten." });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Ungültige Anmeldedaten." });

    let is_premium = user.is_premium;
    if (is_premium && user.premium_until && new Date(user.premium_until) < new Date()) {
      await pool.query("UPDATE users SET is_premium = false WHERE id = $1", [user.id]);
      is_premium = false;
    }

    const token = generateToken({ ...user, is_premium });
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        is_premium,
        premium_until: user.premium_until,
        cancel_at_period_end: user.cancel_at_period_end,
      },
    });
  } catch (err) {
    console.error("[/auth/login]", err.message);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

app.get("/auth/me", requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: "User nicht gefunden." });

    let is_premium = user.is_premium;
    if (is_premium && user.premium_until && new Date(user.premium_until) < new Date()) {
      await pool.query("UPDATE users SET is_premium = false WHERE id = $1", [user.id]);
      is_premium = false;
    }

    const userPlan = user.plan || 'bronze';
    const userLimit = user.custom_request_limit || PLAN_LIMITS[userPlan] || 20;

    // Reset if new month
    const resetAt = user.requests_reset_at ? new Date(user.requests_reset_at) : new Date();
    const now = new Date();
    if (resetAt.getFullYear() !== now.getFullYear() || resetAt.getMonth() !== now.getMonth()) {
      await pool.query("UPDATE users SET monthly_requests = 0, requests_reset_at = NOW() WHERE id = $1", [user.id]);
      user.monthly_requests = 0;
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        is_premium,
        premium_until: user.premium_until,
        cancel_at_period_end: user.cancel_at_period_end,
        plan: userPlan,
        used: user.monthly_requests || 0,
        limit: userLimit,
      },
    });
  } catch (err) {
    console.error("[/auth/me]", err.message);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// STRIPE ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.post("/stripe/checkout", requireAuth, async (req, res) => {
  try {
    const { plan } = req.body; // 'silver' | 'gold' | 'platin'
    const priceId = STRIPE_PLANS[plan] || process.env.STRIPE_PRICE_ID;
    if (!priceId) return res.status(400).json({ error: "Ungültiger Plan." });

    const user = await getUserById(req.user.id);
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email });
      customerId = customer.id;
      await pool.query("UPDATE users SET stripe_customer_id = $1 WHERE id = $2", [customerId, user.id]);
    }

    const baseUrl = process.env.FRONTEND_URL || 'https://www.card-pulse.com';
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      // No payment_method_types = Stripe shows all enabled in dashboard
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      locale: 'auto',
      success_url: `${baseUrl}/dashboard.html?success=true`,
      cancel_url: `${baseUrl}/dashboard.html?canceled=true`,
      metadata: { user_id: String(user.id), plan },
      custom_text: {
        submit: { message: 'Du kannst dein Abo jederzeit kündigen.' },
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("[/stripe/checkout]", err.message);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

app.post("/stripe/portal", requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);

    if (!user.stripe_customer_id)
      return res.status(400).json({ error: "Kein aktives Abonnement gefunden." });

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL || 'https://www.card-pulse.com'}/dashboard.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("[/stripe/portal]", err.message);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

app.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[Webhook] Signatur ungültig:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[Webhook] Event: ${event.type}`);

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const isActive = sub.status === "active" || sub.status === "trialing";
        const premiumUntil = new Date(sub.current_period_end * 1000);
        const cancelAtEnd = sub.cancel_at_period_end;

        // Determine plan from price ID
        const priceId = sub.items?.data?.[0]?.price?.id;
        let planName = 'silver'; // default paid plan
        if (priceId === process.env.STRIPE_PRICE_GOLD)   planName = 'gold';
        if (priceId === process.env.STRIPE_PRICE_PLATIN) planName = 'platin';
        if (priceId === process.env.STRIPE_PRICE_SILVER) planName = 'silver';

        await pool.query(
          `UPDATE users SET is_premium = $1, premium_until = $2, cancel_at_period_end = $3, plan = $4
           WHERE stripe_customer_id = $5`,
          [isActive, premiumUntil, cancelAtEnd, isActive ? planName : 'bronze', sub.customer]
        );
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await pool.query(
          `UPDATE users SET is_premium = false, cancel_at_period_end = false, plan = 'bronze'
           WHERE stripe_customer_id = $1`,
          [sub.customer]
        );
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        console.warn(`[Webhook] Zahlung fehlgeschlagen für Customer ${invoice.customer}`);
        break;
      }
    }
  } catch (err) {
    console.error("[Webhook] Verarbeitungsfehler:", err.message);
    return res.status(500).send("Webhook processing failed");
  }

  res.json({ received: true });
});


// ═══════════════════════════════════════════════════════════════════════════
// PREISE ROUTE
// ═══════════════════════════════════════════════════════════════════════════

app.get("/prices", requireAuth, async (req, res) => {
  const { set: setSlug, cardNumber } = req.query;

  if (!setSlug || !cardNumber)
    return res.status(400).json({ error: "Parameter 'set' und 'cardNumber' erforderlich." });

  try {
    // ── Check & increment request counter ──────────────────────────────────
    const userRow = await getUserById(req.user.id);
    const plan = userRow.plan || 'bronze';
    const limit = userRow.custom_request_limit || PLAN_LIMITS[plan] || 20;

    // Reset counter if new month
    const resetAt = userRow.requests_reset_at ? new Date(userRow.requests_reset_at) : new Date();
    const now = new Date();
    const needsReset = resetAt.getFullYear() !== now.getFullYear() ||
                       resetAt.getMonth() !== now.getMonth();

    if (needsReset) {
      await pool.query(
        "UPDATE users SET monthly_requests = 0, requests_reset_at = NOW() WHERE id = $1",
        [req.user.id]
      );
      userRow.monthly_requests = 0;
    }

    const used = userRow.monthly_requests || 0;

    if (used >= limit) {
      return res.status(429).json({
        error: "LIMIT_REACHED",
        plan,
        used,
        limit,
      });
    }

    // Increment counter
    await pool.query(
      "UPDATE users SET monthly_requests = monthly_requests + 1 WHERE id = $1",
      [req.user.id]
    );

    const dbCardNumber =
      /^\d+$/.test(cardNumber) && cardNumber.length < 3
        ? cardNumber.padStart(3, "0")
        : cardNumber;

    const dbResult = await pool.query(
      "SELECT tcg_player_id FROM card_mapping WHERE cardmarket_slug = $1 AND card_number = $2",
      [setSlug, dbCardNumber]
    );

    if (dbResult.rows.length === 0) {
      return res.status(404).json({
        error: "CARD_NOT_FOUND",
        message: `Keine TCGPlayer-ID für ${setSlug} #${dbCardNumber} gefunden.`,
      });
    }

    const tcgPlayerId = dbResult.rows[0].tcg_player_id;
    const justTcgData = await fetchJustTcg(tcgPlayerId);
    const prices = mapPrices(justTcgData);
    const cardName = justTcgData.data?.[0]?.name ?? "Unbekannt";
    const { trend, history } = extractTrendAndHistory(justTcgData);

    res.json({
      user: { plan, used: used + 1, limit },
      card: { name: cardName, tcgPlayerId },
      prices,
      trend,
      history,
    });
  } catch (err) {
    console.error("[/prices]", err.message);
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════════

// POST /enterprise-contact
app.post("/enterprise-contact", async (req, res) => {
  const { firstname, lastname, email, requests, note } = req.body;
  if (!firstname || !lastname || !email || !requests) {
    return res.status(400).json({ error: "Pflichtfelder fehlen." });
  }
  console.log(`[ENTERPRISE] ${firstname} ${lastname} <${email}> – ${requests} requests/mo`);

  if (process.env.RESEND_API_KEY) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "CardPulse <info@card-pulse.com>",
          to: ["info@card-pulse.com"],
          subject: `CardPulse Enterprise Anfrage – ${firstname} ${lastname}`,
          text: `Name: ${firstname} ${lastname}\nE-Mail: ${email}\nGewünschte Anfragen/Monat: ${requests}\n\nZusätzliche Infos:\n${note || "(keine)"}`,
          reply_to: email,
        }),
      });
      console.log("[ENTERPRISE] E-Mail gesendet.");
    } catch (err) {
      console.error("[ENTERPRISE] Fehler:", err.message);
    }
  }
  res.json({ success: true });
});

// POST /suggest – Fehlende Karte melden → E-Mail an info@card-pulse.com
app.post("/suggest", async (req, res) => {
  const { url, note } = req.body;
  if (!url || !url.includes('cardmarket.com')) {
    return res.status(400).json({ error: "Ungültige oder fehlende Cardmarket URL." });
  }
  console.log(`[SUGGEST] URL: ${url} | Note: ${note || 'none'}`);

  if (process.env.RESEND_API_KEY) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'CardPulse <info@card-pulse.com>',
          to: [process.env.SUGGEST_EMAIL || 'info@card-pulse.com'],
          subject: 'CardPulse – Fehlende Karte gemeldet',
          text: buildSuggestEmailText(url, note),
          html: buildSuggestEmailHtml(url, note),
        }),
      });
      const data = await response.json();
      if (response.ok) {
        console.log('[SUGGEST] E-Mail gesendet via Resend:', data.id);
      } else {
        console.error('[SUGGEST] Resend Fehler:', data);
      }
    } catch (err) {
      console.error('[SUGGEST] Resend Fehler:', err.message);
    }
  } else {
    console.warn('[SUGGEST] RESEND_API_KEY nicht gesetzt – E-Mail nicht gesendet.');
  }
  res.json({ success: true });
});



// ═══════════════════════════════════════════════════════════════════════════
// SEALED PRICES
// ═══════════════════════════════════════════════════════════════════════════

app.get("/prices/sealed", requireAuth, async (req, res) => {
  const { name, type } = req.query;
  if (!name) return res.status(400).json({ error: "Missing name parameter" });

  const normalizedName = name.toLowerCase().trim();

  try {
    // ── Get full user row from DB (JWT only has id/email/is_premium) ──────
    const userRow = await getUserById(req.user.id);
    if (!userRow) return res.status(401).json({ error: "LOGIN_REQUIRED" });

    const plan = userRow.plan || 'bronze';
    const limit = userRow.custom_request_limit || PLAN_LIMITS[plan] || 20;

    // Reset counter if new month
    const resetAt = userRow.requests_reset_at ? new Date(userRow.requests_reset_at) : new Date();
    const now = new Date();
    const needsReset = resetAt.getFullYear() !== now.getFullYear() ||
                       resetAt.getMonth() !== now.getMonth();
    if (needsReset) {
      await pool.query(
        "UPDATE users SET monthly_requests = 0, requests_reset_at = NOW() WHERE id = $1",
        [req.user.id]
      );
      userRow.monthly_requests = 0;
    }

    const used = userRow.monthly_requests || 0;
    if (used >= limit) {
      return res.status(429).json({ error: "LIMIT_REACHED", plan, used, limit });
    }

    // ── Mapping lookup (DB only, no auto-match) ───────────────────────────
    const cached = await pool.query(
      "SELECT tcg_player_id FROM sealed_mapping WHERE cardmarket_name_normalized=$1 LIMIT 1",
      [normalizedName]
    );
    const tcgPlayerId = cached.rows[0]?.tcg_player_id || null;

    if (!tcgPlayerId) {
      console.log(`[SEALED] Kein DB-Mapping für "${name}" – User soll Produkt melden`);
      return res.status(404).json({ error: "PRODUCT_NOT_FOUND" });
    }

    // ── Fetch from JustTCG by TCGPlayer ID ────────────────────────────────
    const url = new URL("https://api.justtcg.com/v1/cards");
    url.searchParams.set("tcgplayerId", tcgPlayerId);
    const resp = await fetch(url.toString(), {
      headers: { "X-API-KEY": process.env.JUSTTCG_API_KEY }
    });
    const justTcgData = await resp.json();
    console.log(`[SEALED] Lookup für "${name}" → ID ${tcgPlayerId}, JustTCG status ${resp.status}, data count ${justTcgData.data?.length || 0}`);
    if (justTcgData.data?.[0]) {
      console.log(`[SEALED]   Name: "${justTcgData.data[0].name}", Conditions:`,
        justTcgData.data[0].variants?.map(v => v.condition));
    }

    // ── Find sealed variant ────────────────────────────────────────────────
    const product = justTcgData.data?.find(p => p.variants?.some(v => v.condition === "Sealed"));
    if (!product) {
      console.log(`[SEALED] Keine Sealed-Variante in JustTCG-Antwort für "${name}". Available conditions:`,
        justTcgData.data?.[0]?.variants?.map(v => v.condition));
      return res.status(404).json({ error: "PRODUCT_NOT_FOUND" });
    }

    const variant = product.variants.find(v => v.condition === "Sealed");
    // JustTCG returns USD as decimal directly (consistent with /prices route)
    const usdPrice = variant.marketPrice ?? variant.price ?? 0;

    // EUR conversion
    let eurRate = 0.92;
    try {
      const fx = await fetch("https://api.frankfurter.app/latest?from=USD&to=EUR");
      const fxData = await fx.json();
      eurRate = fxData.rates?.EUR || 0.92;
    } catch (_) {}

    // History – priceHistory entries: {p: price, t: unix_timestamp}
    const history = (variant.priceHistory || [])
      .filter(p => p.p != null && p.t != null)
      .map(p => ({
        date: new Date(p.t * 1000).toISOString().split("T")[0],
        price: +Number(p.p).toFixed(2)
      }))
      .slice(-30);

    // Increment usage
    await pool.query(
      "UPDATE users SET monthly_requests = monthly_requests + 1 WHERE id = $1",
      [req.user.id]
    );

    res.json({
      name: product.name,
      set: product.set_name || product.set,
      type: type || "sealed",
      tcgPlayerId: product.tcgplayerId,
      price: { usd: +Number(usdPrice).toFixed(2), eur: +(usdPrice * eurRate).toFixed(2) },
      change7d: variant.priceChange7d,
      change30d: variant.priceChange30d,
      trendSlope7d: variant.trendSlope7d,
      history,
      plan,
      used: used + 1,
      limit
    });

  } catch (err) {
    console.error("[SEALED] Error:", err);
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});
// ═══════════════════════════════════════════════════════════════════════════
// PASSWORD RESET ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// POST /auth/forgot-password
app.post("/auth/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "E-Mail erforderlich." });

  try {
    const result = await pool.query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    // Always return success to prevent email enumeration
    if (result.rows.length === 0) {
      return res.json({ success: true });
    }

    const userId = result.rows[0].id;
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      "UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3",
      [token, expires, userId]
    );

    const resetUrl = `${process.env.FRONTEND_URL || 'https://www.card-pulse.com'}/reset-password.html?token=${token}`;

    if (process.env.RESEND_API_KEY) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "CardPulse <info@card-pulse.com>",
          to: [email.toLowerCase()],
          subject: "CardPulse – Passwort zurücksetzen",
          text: buildResetEmailText(resetUrl),
          html: buildResetEmailHtml(resetUrl),
        }),
      });
      console.log(`[RESET] E-Mail gesendet an ${email}`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[/auth/forgot-password]", err.message);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

// POST /auth/reset-password
app.post("/auth/reset-password", async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: "Token und Passwort erforderlich." });
  if (password.length < 8) return res.status(400).json({ error: "Passwort muss mindestens 8 Zeichen haben." });

  try {
    const result = await pool.query(
      "SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()",
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "INVALID_TOKEN" });
    }

    const userId = result.rows[0].id;
    const password_hash = await bcrypt.hash(password, 10);

    await pool.query(
      "UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2",
      [password_hash, userId]
    );

    console.log(`[RESET] Passwort geändert für User ${userId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("[/auth/reset-password]", err.message);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

// SETS ROUTE
// ═══════════════════════════════════════════════════════════════════════════

app.get("/sets", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT DISTINCT cardmarket_slug FROM card_mapping ORDER BY cardmarket_slug ASC"
    );
    res.json({ sets: result.rows.map((r) => r.cardmarket_slug) });
  } catch (err) {
    console.error("[/sets]", err.message);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// SERVER START
// ═══════════════════════════════════════════════════════════════════════════

app.get("/", (req, res) => res.send("CardPulse API läuft. ✅"));

app.listen(PORT, async () => {
  console.log(`✅ CardPulse Server läuft auf Port ${PORT}`);
  try {
    await pool.query("SELECT NOW()");
    console.log("✅ Neon DB verbunden.");
  } catch (err) {
    console.error("❌ Neon DB Verbindungsfehler:", err.message);
  }
});
