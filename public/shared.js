(function() {

  const FLAG_EN = '<svg width="18" height="12" viewBox="0 0 60 40"><rect width="60" height="40" fill="#012169"/><path d="M0,0 L60,40 M60,0 L0,40" stroke="#fff" stroke-width="8"/><path d="M0,0 L60,40 M60,0 L0,40" stroke="#C8102E" stroke-width="5"/><path d="M30,0 V40 M0,20 H60" stroke="#fff" stroke-width="12"/><path d="M30,0 V40 M0,20 H60" stroke="#C8102E" stroke-width="7"/></svg>';
  const FLAG_DE = '<svg width="18" height="12" viewBox="0 0 60 40"><rect width="60" height="13.3" fill="#000"/><rect y="13.3" width="60" height="13.3" fill="#D00"/><rect y="26.6" width="60" height="13.4" fill="#FFCE00"/></svg>';

  function switchLang(l) {
    localStorage.setItem('cp_lang', l);
    if (window.i18n) { window.i18n.lang = l; window.i18n.apply(); }
    document.querySelectorAll('.lang-flag-btn').forEach(b => b.classList.remove('active'));
    const active = document.getElementById(l === 'en' ? 'langBtnEn' : 'langBtnDe');
    if (active) active.classList.add('active');
    document.documentElement.lang = l;
  }

  function injectLangToggle() {
    if (document.getElementById('langSwitcher')) return;
    const lang = localStorage.getItem('cp_lang') || 'en';

    const wrap = document.createElement('div');
    wrap.id = 'langSwitcher';

    const btnEn = document.createElement('button');
    btnEn.id = 'langBtnEn';
    btnEn.className = 'lang-flag-btn' + (lang === 'en' ? ' active' : '');
    btnEn.innerHTML = FLAG_EN + ' EN';
    btnEn.onclick = () => switchLang('en');

    const btnDe = document.createElement('button');
    btnDe.id = 'langBtnDe';
    btnDe.className = 'lang-flag-btn' + (lang === 'de' ? ' active' : '');
    btnDe.innerHTML = FLAG_DE + ' DE';
    btnDe.onclick = () => switchLang('de');

    wrap.appendChild(btnEn);
    wrap.appendChild(btnDe);

    const container = document.querySelector('.nav-links, .nav-right');
    if (container) container.appendChild(wrap);
  }

  function injectFooter() {
    const existing = document.querySelector('footer, .cp-footer-wrap');
    if (!existing) {
      const footer = document.createElement('div');
      footer.className = 'cp-footer-wrap';
      footer.innerHTML = `
        <a href="/" class="footer-logo">card<span>pulse</span></a>
        <div class="footer-links">
          <a href="/sets.html" data-i18n="footer_sets">Sets</a>
          <a href="/privacy.html" data-i18n="footer_privacy">Privacy Policy</a>
          <a href="/impressum.html" data-i18n="footer_imprint">Imprint</a>
          <a href="/suggest.html" data-i18n="footer_suggest">Report missing card</a>
        </div>
        <span class="footer-copy" data-i18n="footer_copy">&copy; 2026 CardPulse</span>
      `;
      document.body.appendChild(footer);
    }
  }

  function injectStyles() {
    if (document.getElementById('cp-shared-styles')) return;
    const style = document.createElement('style');
    style.id = 'cp-shared-styles';
    style.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Barlow+Condensed:wght@400;600;700;800;900&family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap');

:root {
  --bg: #09090f;
  --surface: #0f0f1c;
  --card: #13131f;
  --border: rgba(255,255,255,0.06);
  --accent: #6c63ff;
  --yellow: #ffd700;
  --red: #ff4040;
  --teal: #00d4aa;
  --green: #22c55e;
  --text: #e8e8f0;
  --muted: #5a5a78;
  --pixel: "Press Start 2P", monospace;
  --mono: "DM Mono", monospace;
  --cond: "Barlow Condensed", sans-serif;
  --sans: "DM Sans", sans-serif;
}

html { scroll-behavior: smooth; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  min-height: 100vh;
}

/* dot grid */
body::after {
  content: "";
  position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background-image: radial-gradient(rgba(108,99,255,0.1) 1px, transparent 1px);
  background-size: 28px 28px;
  mask-image: radial-gradient(ellipse 80% 80% at 50% 50%, black 20%, transparent 100%);
}

/* ── Nav ── */
nav {
  position: sticky; top: 0; z-index: 1000;
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 48px;
  background: rgba(9,9,15,0.9);
  border-bottom: 1px solid var(--border);
  backdrop-filter: blur(20px);
}
.logo {
  font-family: var(--pixel) !important;
  font-size: 11px !important;
  font-weight: 400 !important;
  color: var(--text) !important;
  text-decoration: none !important;
  letter-spacing: 1px !important;
  line-height: 1.6 !important;
}
.logo span, .logo em { color: var(--accent) !important; font-style: normal; }
.nav-links {
  display: flex; gap: 8px; align-items: center;
}

/* Nav link buttons */
.nav-links a, .nav-links button {
  font-family: var(--mono);
  font-size: 12px;
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  text-decoration: none;
  cursor: pointer;
  transition: .2s;
}
.nav-links a:hover, .nav-links button:hover {
  border-color: var(--accent);
  color: var(--text);
}
.nav-links a.btn-primary, .nav-links .btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}
.nav-links a.btn-primary:hover { opacity: .85; }
#logoutBtn {
  color: var(--muted) !important;
  border-color: var(--border) !important;
}
#logoutBtn:hover { color: var(--red) !important; border-color: rgba(255,64,64,0.4) !important; }

/* ── Footer ── */
.cp-footer-wrap {
  position: relative; z-index: 1;
  border-top: 1px solid var(--border);
  padding: 28px 48px;
  display: flex; justify-content: space-between; align-items: center;
  flex-wrap: wrap; gap: 16px;
}
.footer-logo { font-family: var(--pixel); font-size: 9px; color: var(--text); text-decoration: none; }
.footer-logo span { color: var(--accent); }
.footer-links { display: flex; gap: 20px; flex-wrap: wrap; }
.footer-links a { font-family: var(--mono); font-size: 11px; color: var(--muted); text-decoration: none; transition: .15s; }
.footer-links a:hover { color: var(--text); }
.footer-copy { font-family: var(--mono); font-size: 10px; color: var(--muted); }

/* ── Lang switcher ── */
#langSwitcher {
  display: inline-flex; align-items: center; gap: 4px;
  background: rgba(13,13,31,0.8);
  border: 1px solid rgba(108,99,255,0.2);
  border-radius: 8px; padding: 3px;
}
.lang-flag-btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 6px; padding: 5px 10px; border-radius: 6px;
  border: 1px solid transparent; background: transparent;
  color: var(--muted); font-family: var(--mono); font-size: 11px;
  font-weight: 700; cursor: pointer; transition: .18s; white-space: nowrap;
  line-height: 1;
}
.lang-flag-btn:hover { color: var(--text); background: rgba(255,255,255,0.04); }
.lang-flag-btn.active {
  color: var(--text); background: rgba(108,99,255,0.15);
  border-color: rgba(108,99,255,0.3);
}

/* ── Cards / surfaces ── */
.cp-card {
  background: var(--card); border: 1px solid var(--border);
  border-radius: 14px; padding: 28px;
}

/* ── Form inputs ── */
input, textarea, select {
  background: rgba(0,0,0,0.4) !important;
  border: 1px solid var(--border) !important;
  border-radius: 10px !important;
  color: var(--text) !important;
  font-family: var(--mono) !important;
  font-size: 14px !important;
  padding: 13px 16px !important;
  width: 100%; outline: none; transition: .2s;
  -webkit-appearance: none;
}
input:focus, textarea:focus, select:focus {
  border-color: var(--accent) !important;
  box-shadow: 0 0 0 3px rgba(108,99,255,0.1) !important;
}

/* ── Buttons ── */
.btn-main {
  display: block; width: 100%; padding: 14px;
  background: var(--accent); border: none; border-radius: 10px;
  color: white; font-family: var(--mono); font-size: 14px;
  font-weight: 500; cursor: pointer; transition: .2s;
  text-align: center; text-decoration: none;
}
.btn-main:hover { opacity: .85; }
.btn-main:disabled { opacity: .4; cursor: not-allowed; }
.btn-outline {
  display: block; width: 100%; padding: 14px;
  background: transparent; border: 1px solid var(--border); border-radius: 10px;
  color: var(--muted); font-family: var(--mono); font-size: 14px;
  cursor: pointer; transition: .2s; text-align: center; text-decoration: none;
}
.btn-outline:hover { border-color: var(--accent); color: var(--text); }

/* ── Section label ── */
.section-label {
  font-family: var(--pixel); font-size: 8px; color: var(--accent);
  letter-spacing: 2px; text-transform: uppercase; margin-bottom: 16px;
}
.section-label::before { content: "> "; color: var(--yellow); }

/* ── Msgs ── */
.msg-error { background: rgba(255,64,64,0.08); border: 1px solid rgba(255,64,64,0.25); color: var(--red); border-radius: 10px; padding: 12px 16px; font-size: 13px; font-family: var(--mono); }
.msg-success { background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.25); color: var(--green); border-radius: 10px; padding: 12px 16px; font-size: 13px; font-family: var(--mono); }

/* ── Mobile ── */
@media (max-width: 768px) {
  nav { padding: 12px 20px; }
  .nav-links a, .nav-links button { padding: 6px 12px; font-size: 11px; }
  .cp-footer-wrap { padding: 20px; flex-direction: column; align-items: flex-start; }
}
`;
    document.head.insertBefore(style, document.head.firstChild);
  }

  document.addEventListener('DOMContentLoaded', function() {
    injectStyles();
    injectLangToggle();
    injectFooter();
    if (window.i18n) {
      const lang = localStorage.getItem('cp_lang') || 'en';
      window.i18n.lang = lang;
      window.i18n.apply();
    }
  });

})();
