// i18n.js – CardPulse Translation System
// Default: English. Stored in localStorage as 'cp_lang'

const TRANSLATIONS = {
  en: {
    // NAV
    nav_sets: "Supported Sets",
    nav_login: "Sign in",
    nav_register: "Get started",
    nav_dashboard: "Dashboard",
    nav_logout: "Sign out",

    // INDEX – Hero
    hero_badge: "Now available for Chrome",
    hero_h1_1: "TCGPlayer prices",
    hero_h1_2: "directly on",
    hero_h1_accent: "Cardmarket",
    hero_sub: "CardPulse shows you current US market prices in real time while you browse Cardmarket – no tab switching needed.",
    hero_cta_primary: "Start free",
    hero_cta_secondary: "View all sets",

    // INDEX – Features
    features_label: "Features",
    features_h2: "Everything you need,\nnothing you don't.",
    feat1_title: "Real-time prices",
    feat1_desc: "TCGPlayer market prices are loaded the moment you open a Cardmarket page – no manual searching.",
    feat2_title: "All conditions",
    feat2_desc: "Near Mint, Lightly Played, Moderately Played, Heavily Played and Damaged – all prices at a glance.",
    feat3_title: "USD & EUR",
    feat3_desc: "Prices are automatically converted to EUR so you can compare directly with Cardmarket.",
    feat4_title: "Secure & private",
    feat4_desc: "Your data stays yours. No tracking, no sharing. Just you and your prices.",
    feat5_title: "80+ Sets",
    feat5_desc: "From Sword & Shield to Destined Rivals – all current and many older sets are supported.",
    feat6_title: "Always up to date",
    feat6_desc: "New sets are added regularly. The extension updates automatically in the background.",

    // INDEX – Pricing
    pricing_label: "Pricing",
    pricing_h2: "Simple & transparent.",
    pricing_sub: "Start free, upgrade when you're ready.",
    plan_free: "Free",
    plan_free_period: "forever",
    plan_premium_period: "per month · cancel anytime",
    btn_start_free: "Start for free",
    btn_upgrade: "Upgrade now",

    // INDEX – Sets
    sets_label: "Supported Sets",
    sets_h2: "Already 80+ sets\navailable.",
    sets_sub: "New sets are added regularly.",
    sets_more_link: "View full list",

    // LOGIN
    login_title: "Welcome back",
    login_sub: "Sign in to view your prices.",
    login_email: "Email",
    login_password: "Password",
    login_btn: "Sign in",
    login_no_account: "No account yet?",
    login_register_link: "Register now",
    login_connecting: "Connecting...",
    login_error_fields: "Please enter email and password.",
    login_error_failed: "Sign in failed.",
    login_error_connection: "Connection error. Please try again.",
    login_success: "Signed in! Redirecting...",

    // REGISTER
    register_title: "Create account",
    register_sub: "Start free – no subscription required.",
    register_perk1: "Immediate access to the extension",
    register_perk2: "No subscription required",
    register_perk3: "Upgrade or cancel anytime",
    register_email: "Email",
    register_pw: "Password",
    register_pw_hint: "Minimum 8 characters",
    register_pw2: "Repeat password",
    register_btn: "Create account",
    register_has_account: "Already have an account?",
    register_login_link: "Sign in",
    register_error_fields: "Please fill in all fields.",
    register_error_short: "Password must be at least 8 characters.",
    register_error_match: "Passwords do not match.",
    register_error_failed: "Registration failed.",
    register_success: "Account created! Redirecting...",

    // DASHBOARD
    dash_title: "Dashboard",
    dash_sub: "Manage your account and subscription.",
    dash_plan_free_title: "Free Plan",
    dash_plan_free_desc: "Upgrade to see TCGPlayer prices on Cardmarket.",
    dash_plan_premium_title: "Premium Plan active",
    dash_plan_premium_desc: "TCGPlayer prices on all supported sets.",
    dash_plan_canceling: "Your subscription expires at the end of the period.",
    dash_badge_free: "Free",
    dash_badge_premium: "Premium",
    dash_btn_upgrade: "Upgrade now",
    dash_btn_manage: "Manage subscription",
    dash_label_email: "Email",
    dash_label_plan: "Plan",
    dash_label_until: "Valid until",
    dash_label_status: "Status",
    dash_status_active: "Active",
    dash_status_canceled: "Canceled",
    dash_ext_title: "Set up browser extension",
    dash_ext_desc: "How to install the CardPulse extension and connect it to your account:",
    dash_step1: "Open the Chrome Web Store and search for CardPulse – or click the install link directly.",
    dash_step2: "Install the extension and click the CardPulse icon in your browser toolbar.",
    dash_step3: "You're already signed in – your token is automatically passed to the extension. Just open any card on Cardmarket.",
    dash_danger_title: "Danger zone",
    dash_danger_desc: "Sign out on all devices.",
    dash_logout_all: "Sign out everywhere",
    dash_loading: "Loading dashboard...",

    // SETS
    sets_page_label: "Compatibility",
    sets_page_h1: "Supported Sets",
    sets_page_sub: "All card sets for which TCGPlayer prices are displayed.",
    sets_search: "Search sets... e.g. Surging Sparks, sv08",
    sets_filter_all: "All",
    sets_cm_link: "View on Cardmarket",
    sets_count_found: "sets found",
    sets_no_results: "No sets found for this search.",
    era_sv: "Scarlet & Violet",
    era_swsh: "Sword & Shield",
    era_sm: "Sun & Moon",
    era_xy: "XY",

    // FOOTER
    footer_privacy: "Privacy Policy",
    footer_imprint: "Imprint",
    footer_sets: "Sets",
    footer_copy: "© 2026 CardPulse. All rights reserved.",

    // PRIVACY
    privacy_title: "Privacy Policy",
    privacy_updated: "Last updated: May 2026",

    // LANGUAGE SWITCHER
    lang_label: "EN",

    // suggest.html
    suggest_eyebrow:   "Missing data",
    suggest_h1:        "Found a missing card or set?",
    suggest_sub:       "Let us know and we'll add it as soon as possible. Just share the Cardmarket link and we'll take care of the rest.",
    suggest_url_label: "Cardmarket URL",
    suggest_url_hint:  "Link to the card or set page on Cardmarket.",
    suggest_note_label:"Additional info",
    suggest_note_opt:  "(optional)",
    suggest_note_ph:   "e.g. it's a full art version, or a specific language...",
    suggest_btn:       "Send report",
    suggest_sending:   "Sending...",
    suggest_success:   "✅ Thanks! We received your report and will look into it.",
    suggest_err_url:   "Please enter a Cardmarket URL.",
    suggest_err_valid: "Please enter a valid Cardmarket URL.",
    suggest_err_send:  "Error sending. Please try again.",
  },

  de: {
    nav_sets: "Unterstützte Sets",
    nav_login: "Anmelden",
    nav_register: "Kostenlos starten",
    nav_dashboard: "Dashboard",
    nav_logout: "Abmelden",

    hero_badge: "Jetzt für Chrome verfügbar",
    hero_h1_1: "TCGPlayer-Preise",
    hero_h1_2: "direkt auf",
    hero_h1_accent: "Cardmarket",
    hero_sub: "CardPulse zeigt dir aktuelle US-Marktpreise in Echtzeit, während du auf Cardmarket surfst – ohne Tab-Wechsel.",
    hero_cta_primary: "Jetzt starten – kostenlos",
    hero_cta_secondary: "Alle Sets ansehen",

    features_label: "Features",
    features_h2: "Alles was du brauchst,\nnichts was du nicht brauchst.",
    feat1_title: "Echtzeit-Preise",
    feat1_desc: "TCGPlayer Marktpreise werden direkt beim Öffnen einer Cardmarket-Seite geladen – keine manuelle Suche.",
    feat2_title: "Alle Konditionen",
    feat2_desc: "Near Mint, Lightly Played, Moderately Played, Heavily Played und Damaged – alle Preise auf einen Blick.",
    feat3_title: "USD & EUR",
    feat3_desc: "Preise werden automatisch in Euro umgerechnet, damit du direkt mit Cardmarket vergleichen kannst.",
    feat4_title: "Sicher & privat",
    feat4_desc: "Deine Daten bleiben deine Daten. Kein Tracking, keine Weitergabe. Nur du und deine Preise.",
    feat5_title: "80+ Sets",
    feat5_desc: "Von Sword & Shield bis Destined Rivals – alle aktuellen und viele ältere Sets werden unterstützt.",
    feat6_title: "Immer aktuell",
    feat6_desc: "Neue Sets werden laufend hinzugefügt. Die Extension aktualisiert sich automatisch im Hintergrund.",

    pricing_label: "Preise",
    pricing_h2: "Einfach & transparent.",
    pricing_sub: "Starte kostenlos, upgrade wenn du bereit bist.",
    plan_free: "Kostenlos",
    plan_free_period: "für immer",
    plan_premium_period: "pro Monat · jederzeit kündbar",
    btn_start_free: "Kostenlos starten",
    btn_upgrade: "Jetzt upgraden",

    sets_label: "Unterstützte Sets",
    sets_h2: "Bereits 80+ Sets\nverfügbar.",
    sets_sub: "Und es werden regelmäßig neue hinzugefügt.",
    sets_more_link: "Vollständige Liste",

    login_title: "Willkommen zurück",
    login_sub: "Melde dich an, um deine Preise zu sehen.",
    login_email: "E-Mail",
    login_password: "Passwort",
    login_btn: "Anmelden",
    login_no_account: "Noch kein Konto?",
    login_register_link: "Jetzt registrieren",
    login_connecting: "Verbinde...",
    login_error_fields: "Bitte E-Mail und Passwort eingeben.",
    login_error_failed: "Anmeldung fehlgeschlagen.",
    login_error_connection: "Verbindungsfehler. Bitte versuche es erneut.",
    login_success: "Erfolgreich angemeldet! Weiterleitung...",

    register_title: "Konto erstellen",
    register_sub: "Kostenlos starten – kein Abo nötig.",
    register_perk1: "Sofortiger Zugang zur Extension",
    register_perk2: "Kein Abo erforderlich",
    register_perk3: "Jederzeit upgraden oder kündigen",
    register_email: "E-Mail",
    register_pw: "Passwort",
    register_pw_hint: "Mindestens 8 Zeichen",
    register_pw2: "Passwort wiederholen",
    register_btn: "Konto erstellen",
    register_has_account: "Bereits ein Konto?",
    register_login_link: "Anmelden",
    register_error_fields: "Bitte alle Felder ausfüllen.",
    register_error_short: "Passwort muss mindestens 8 Zeichen haben.",
    register_error_match: "Passwörter stimmen nicht überein.",
    register_error_failed: "Registrierung fehlgeschlagen.",
    register_success: "Konto erstellt! Weiterleitung...",

    dash_title: "Dashboard",
    dash_sub: "Verwalte dein Konto und Abonnement.",
    dash_plan_free_title: "Free Plan",
    dash_plan_free_desc: "Upgrade für TCGPlayer Preise auf Cardmarket.",
    dash_plan_premium_title: "Premium Plan aktiv",
    dash_plan_premium_desc: "TCGPlayer Preise auf allen unterstützten Sets.",
    dash_plan_canceling: "Dein Abo läuft am Ende des Zeitraums aus.",
    dash_badge_free: "Free",
    dash_badge_premium: "Premium",
    dash_btn_upgrade: "Jetzt upgraden",
    dash_btn_manage: "Abo verwalten",
    dash_label_email: "E-Mail",
    dash_label_plan: "Plan",
    dash_label_until: "Gültig bis",
    dash_label_status: "Status",
    dash_status_active: "Aktiv",
    dash_status_canceled: "Gekündigt",
    dash_ext_title: "Browser Extension einrichten",
    dash_ext_desc: "So installierst du die CardPulse Extension und verbindest sie mit deinem Konto:",
    dash_step1: "Öffne den Chrome Web Store und suche nach CardPulse – oder klicke direkt auf den Installationslink.",
    dash_step2: "Installiere die Extension und klicke auf das CardPulse-Icon in deiner Browserleiste.",
    dash_step3: "Du bist bereits eingeloggt – dein Token wird automatisch an die Extension weitergegeben. Öffne einfach eine Karte auf Cardmarket.",
    dash_danger_title: "Gefahrenzone",
    dash_danger_desc: "Hier kannst du dich auf allen Geräten abmelden.",
    dash_logout_all: "Überall abmelden",
    dash_loading: "Lade Dashboard...",

    sets_page_label: "Kompatibilität",
    sets_page_h1: "Unterstützte Sets",
    sets_page_sub: "Alle Kartensätze für die TCGPlayer-Preise angezeigt werden.",
    sets_search: "Set suchen... z.B. Surging Sparks, sv08",
    sets_filter_all: "Alle",
    sets_cm_link: "Auf Cardmarket ansehen",
    sets_count_found: "Sets gefunden",
    sets_no_results: "Keine Sets für diese Suche gefunden.",
    era_sv: "Scarlet & Violet",
    era_swsh: "Sword & Shield",
    era_sm: "Sun & Moon",
    era_xy: "XY",

    footer_privacy: "Datenschutz",
    footer_imprint: "Impressum",
    footer_sets: "Sets",
    footer_copy: "© 2026 CardPulse. Alle Rechte vorbehalten.",

    privacy_title: "Datenschutzerklärung",
    privacy_updated: "Zuletzt aktualisiert: Mai 2026",

    lang_label: "DE",

    // suggest.html
    suggest_eyebrow:   "Fehlende Daten",
    suggest_h1:        "Fehlende Karte oder Set entdeckt?",
    suggest_sub:       "Melde dich bei uns und wir ergänzen die Karte so schnell wie möglich. Schick uns einfach den Cardmarket-Link.",
    suggest_url_label: "Cardmarket URL",
    suggest_url_hint:  "Link zur Karte oder zum Set auf Cardmarket.",
    suggest_note_label:"Zusätzliche Infos",
    suggest_note_opt:  "(optional)",
    suggest_note_ph:   "z.B. es ist eine Full Art Version, oder eine bestimmte Sprache...",
    suggest_btn:       "Meldung senden",
    suggest_sending:   "Wird gesendet...",
    suggest_success:   "✅ Danke! Wir haben deine Meldung erhalten und schauen uns die Karte an.",
    suggest_err_url:   "Bitte gib einen Cardmarket-Link ein.",
    suggest_err_valid: "Bitte gib einen gültigen Cardmarket-Link ein.",
    suggest_err_send:  "Fehler beim Senden. Bitte versuche es erneut.",
  }
};

// ── Core i18n engine ──────────────────────────────────────────────────────────
window.i18n = {
  lang: localStorage.getItem('cp_lang') || 'en',

  t(key) {
    return TRANSLATIONS[this.lang][key] || TRANSLATIONS['en'][key] || key;
  },

  apply() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = this.t(key);
      if (el.tagName === 'INPUT') el.placeholder = val;
      else el.textContent = val;
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      el.innerHTML = this.t(el.getAttribute('data-i18n-html'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = this.t(el.getAttribute('data-i18n-placeholder'));
    });
    // Update html lang attr
    document.documentElement.lang = this.lang;
  },

  toggle() {
    this.lang = this.lang === 'en' ? 'de' : 'en';
    localStorage.setItem('cp_lang', this.lang);
    this.apply();
    // Sync flag buttons from shared.js
    document.querySelectorAll('.lang-flag-btn').forEach(b => b.classList.remove('active'));
    const active = document.getElementById(this.lang === 'en' ? 'langBtnEn' : 'langBtnDe');
    if (active) active.classList.add('active');
  },

  init() {
    this.apply();
  }
};

document.addEventListener('DOMContentLoaded', () => window.i18n.init());
