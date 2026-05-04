// server.js – PokéScout Backend (Finale Version)
// Routes: /auth/register, /auth/login, /auth/me
//         /stripe/checkout, /stripe/portal, /stripe/webhook
//         /prices, /sets

const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
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
  "STRIPE_PRICE_ID",       // Deine monatliche Abo-Preis-ID aus Stripe
  "FRONTEND_URL",          // z.B. https://www.poke-scout.com
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

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ─── Body Parser ─────────────────────────────────────────────────────────────
// Stripe Webhook braucht den Raw Body → muss VOR express.json() stehen
app.use("/stripe/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// ─── JWT Middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // "Bearer <token>"

  if (!token) {
    return res.status(401).json({ error: "LOGIN_REQUIRED" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, email, is_premium }
    next();
  } catch {
    return res.status(401).json({ error: "LOGIN_REQUIRED" });
  }
}

// Premium-Prüfung (baut auf requireAuth auf)
function requirePremium(req, res, next) {
  if (!req.user.is_premium) {
    return res.status(403).json({ error: "PAYMENT_REQUIRED" });
  }
  next();
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

// Frischen User aus DB holen (für aktuellen Premium-Status)
async function getUserById(id) {
  const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return result.rows[0] || null;
}

// JWT generieren
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, is_premium: user.is_premium },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
}

// JustTCG API abfragen
async function fetchJustTcg(tcgPlayerId) {
  const url = `https://api.justtcg.com/v1/cards?tcgplayerId=${tcgPlayerId}`;
  const response = await fetch(url, {
    headers: { "X-API-KEY": process.env.JUSTTCG_API_KEY },
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`JustTCG Fehler (${response.status}): ${err}`);
  }
  return response.json();
}

// Preise aus JustTCG-Response mappen
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
    MARKET_PRICE: conditionPrices["NEAR MINT"] ?? null,
    NEAR_MINT: conditionPrices["NEAR MINT"] ?? null,
    LIGHTLY_PLAYED: conditionPrices["LIGHTLY PLAYED"] ?? null,
    MODERATELY_PLAYED: conditionPrices["MODERATELY PLAYED"] ?? null,
    HEAVILY_PLAYED: conditionPrices["HEAVILY PLAYED"] ?? null,
    DAMAGED: conditionPrices["DAMAGED"] ?? conditionPrices["POOR"] ?? null,
    LOW: allPrices.length ? Math.min(...allPrices) : null,
    HIGH: allPrices.length ? Math.max(...allPrices) : null,
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// POST /auth/register
app.post("/auth/register", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "E-Mail und Passwort erforderlich." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Passwort muss mindestens 8 Zeichen haben." });
  }

  try {
    // Existiert der User schon?
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "E-Mail bereits registriert." });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, is_premium, created_at)
       VALUES ($1, $2, false, NOW())
       RETURNING id, email, is_premium`,
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

// POST /auth/login
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "E-Mail und Passwort erforderlich." });
  }

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: "Ungültige Anmeldedaten." });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Ungültige Anmeldedaten." });
    }

    // Premium-Status live prüfen (falls premium_until abgelaufen)
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

// GET /auth/me – aktuellen User zurückgeben (Extension ruft das beim Start auf)
app.get("/auth/me", requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: "User nicht gefunden." });

    // Premium-Ablauf live prüfen
    let is_premium = user.is_premium;
    if (is_premium && user.premium_until && new Date(user.premium_until) < new Date()) {
      await pool.query("UPDATE users SET is_premium = false WHERE id = $1", [user.id]);
      is_premium = false;
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        is_premium,
        premium_until: user.premium_until,
        cancel_at_period_end: user.cancel_at_period_end,
        plan: is_premium ? "premium" : "free",
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

// POST /stripe/checkout – Startet eine neue Abo-Session
app.post("/stripe/checkout", requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);

    // Stripe Customer anlegen falls noch nicht vorhanden
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email });
      customerId = customer.id;
      await pool.query("UPDATE users SET stripe_customer_id = $1 WHERE id = $2", [customerId, user.id]);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/dashboard?success=true`,
      cancel_url: `${process.env.FRONTEND_URL}/shop?canceled=true`,
      metadata: { user_id: String(user.id) },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("[/stripe/checkout]", err.message);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

// POST /stripe/portal – Öffnet das Stripe Kundenportal (Kündigen, Zahlungsmethode etc.)
app.post("/stripe/portal", requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);

    if (!user.stripe_customer_id) {
      return res.status(400).json({ error: "Kein aktives Abonnement gefunden." });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL}/dashboard`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("[/stripe/portal]", err.message);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

// POST /stripe/webhook – Stripe Events verarbeiten
app.post("/stripe/webhook", async (req, res) => {
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

      // Abo aktiviert oder verlängert
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const customerId = sub.customer;
        const isActive = sub.status === "active" || sub.status === "trialing";
        const premiumUntil = new Date(sub.current_period_end * 1000);
        const cancelAtEnd = sub.cancel_at_period_end;

        await pool.query(
          `UPDATE users 
           SET is_premium = $1, premium_until = $2, cancel_at_period_end = $3
           WHERE stripe_customer_id = $4`,
          [isActive, premiumUntil, cancelAtEnd, customerId]
        );
        console.log(`[Webhook] Abo aktualisiert für Customer ${customerId}: premium=${isActive}`);
        break;
      }

      // Abo gekündigt / abgelaufen
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await pool.query(
          `UPDATE users 
           SET is_premium = false, cancel_at_period_end = false
           WHERE stripe_customer_id = $1`,
          [sub.customer]
        );
        console.log(`[Webhook] Abo beendet für Customer ${sub.customer}`);
        break;
      }

      // Zahlung fehlgeschlagen
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        console.warn(`[Webhook] Zahlung fehlgeschlagen für Customer ${invoice.customer}`);
        // Optional: User benachrichtigen (hier nur geloggt)
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

// GET /prices?set=<slug>&cardNumber=<nr>
app.get("/prices", requireAuth, requirePremium, async (req, res) => {
  const { set: setSlug, cardNumber } = req.query;

  if (!setSlug || !cardNumber) {
    return res.status(400).json({ error: "Parameter 'set' und 'cardNumber' erforderlich." });
  }

  try {
    // Kartennummer auf DB-Format normalisieren (z.B. "25" → "025")
    const dbCardNumber =
      /^\d+$/.test(cardNumber) && cardNumber.length < 3
        ? cardNumber.padStart(3, "0")
        : cardNumber;

    // TCGPlayer ID aus Datenbank holen
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

    // JustTCG abfragen
    const justTcgData = await fetchJustTcg(tcgPlayerId);
    const prices = mapPrices(justTcgData);
    const cardName = justTcgData.data?.[0]?.name ?? "Unbekannt";

    res.json({
      user: { plan: "premium" },
      card: { name: cardName, tcgPlayerId },
      prices,
    });
  } catch (err) {
    console.error("[/prices]", err.message);
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// SETS ROUTE – Alle unterstützten Sets für die Webseite/Desktop-App
// ═══════════════════════════════════════════════════════════════════════════

// GET /sets
app.get("/sets", async (req, res) => {
  // Distinct slugs aus der card_mapping Tabelle
  try {
    const result = await pool.query(
      "SELECT DISTINCT cardmarket_slug FROM card_mapping ORDER BY cardmarket_slug ASC"
    );
    const slugs = result.rows.map((r) => r.cardmarket_slug);
    res.json({ sets: slugs });
  } catch (err) {
    console.error("[/sets]", err.message);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// SERVER START
// ═══════════════════════════════════════════════════════════════════════════

app.get("/", (req, res) => res.send("PokéScout API läuft. ✅"));

app.listen(PORT, async () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
  try {
    await pool.query("SELECT NOW()");
    console.log("✅ Neon DB verbunden.");
  } catch (err) {
    console.error("❌ Neon DB Verbindungsfehler:", err.message);
  }
});
