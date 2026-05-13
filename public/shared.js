// shared.js – injects consistent nav extras and footer on every page
// Include AFTER i18n.js

(function() {
  // ── Language toggle button (injected into nav) ─────────────────────────────
  const FLAG_EN = `<svg viewBox="0 0 20 14" xmlns="http://www.w3.org/2000/svg" style="width:20px;height:14px;border-radius:3px;flex-shrink:0;vertical-align:middle">
    <rect width="20" height="14" fill="#012169"/>
    <path d="M0,0 L20,14 M20,0 L0,14" stroke="#fff" stroke-width="2.8"/>
    <path d="M0,0 L20,14 M20,0 L0,14" stroke="#C8102E" stroke-width="1.6"/>
    <path d="M10,0 V14 M0,7 H20" stroke="#fff" stroke-width="4"/>
    <path d="M10,0 V14 M0,7 H20" stroke="#C8102E" stroke-width="2.4"/>
  </svg>`;

  const FLAG_DE = `<svg viewBox="0 0 20 14" xmlns="http://www.w3.org/2000/svg" style="width:20px;height:14px;border-radius:3px;flex-shrink:0;vertical-align:middle">
    <rect y="0"    width="20" height="4.67" fill="#000"/>
    <rect y="4.67" width="20" height="4.67" fill="#D00"/>
    <rect y="9.33" width="20" height="4.67" fill="#FFCE00"/>
  </svg>`;

  function injectLangToggle() {
    if (document.getElementById('langSwitcher')) return;
    const lang = localStorage.getItem('cp_lang') || 'en';

    const wrap = document.createElement('div');
    wrap.id = 'langSwitcher';
    wrap.style.cssText = [
      'position:fixed',
      'top:16px',
      'right:20px',
      'z-index:9999',
      'display:flex',
      'gap:5px',
      'align-items:center',
      'background:rgba(13,13,31,0.85)',
      'border:1px solid rgba(108,99,255,0.2)',
      'border-radius:10px',
      'padding:4px',
      'backdrop-filter:blur(12px)',
    ].join(';');

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
    document.body.appendChild(wrap);
  }

  function switchLang(l) {
    localStorage.setItem('cp_lang', l);
    if (window.i18n) { window.i18n.lang = l; window.i18n.apply(); }
    document.querySelectorAll('.lang-flag-btn').forEach(b => b.classList.remove('active'));
    const active = document.getElementById(l === 'en' ? 'langBtnEn' : 'langBtnDe');
    if (active) active.classList.add('active');
    document.documentElement.lang = l;
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  function injectFooter() {
    if (document.querySelector('footer')) return; // already has footer
    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML = `
      <div class="footer-logo">card<span>pulse</span></div>
      <p class="footer-copy" data-i18n="footer_copy">© 2026 CardPulse. All rights reserved.</p>
      <div class="footer-links">
        <a href="/sets.html" data-i18n="footer_sets">Sets</a>
        <a href="/privacy.html" data-i18n="footer_privacy">Privacy Policy</a>
        <a href="/impressum.html" data-i18n="footer_imprint">Imprint</a>
      </div>
    `;
    document.body.appendChild(footer);
  }

  // ── Shared styles ─────────────────────────────────────────────────────────
  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .lang-btn {
        padding: 7px 14px;
        border-radius: 8px;
        border: 1px solid rgba(108,99,255,0.3);
        background: rgba(108,99,255,0.08);
        color: #6c63ff;
        font-family: 'DM Sans', sans-serif;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        letter-spacing: 0.5px;
        transition: .2s;
      }
      .lang-btn:hover { background: rgba(108,99,255,0.18); }

      .site-footer {
        border-top: 1px solid rgba(108,99,255,0.15);
        padding: 36px 48px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 16px;
        margin-top: auto;
      }
      .footer-logo {
        font-family: 'Syne', sans-serif;
        font-weight: 800;
        font-size: 18px;
        color: #e8e8f0;
      }
      .footer-logo span { color: #6c63ff; }
      .footer-copy { font-size: 13px; color: #6b6b80; }
      .site-footer .footer-links { display: flex; gap: 24px; }
      .site-footer a {
        color: #6b6b80;
        text-decoration: none;
        font-size: 13px;
        transition: .2s;
      }
      .site-footer a:hover { color: #6c63ff; }

      /* ── Mobile nav ── */
      @media (max-width: 640px) {
        nav {
          padding: 14px 16px !important;
          gap: 8px;
        }
        .nav-links, .nav-right {
          gap: 4px !important;
          flex-wrap: wrap;
        }
        .btn-ghost { padding: 8px 12px !important; font-size: 13px !important; }
        .btn-primary { padding: 8px 14px !important; font-size: 13px !important; }
        .site-footer {
          padding: 28px 20px !important;
          flex-direction: column !important;
          text-align: center !important;
          gap: 12px !important;
        }
        .footer-links {
          justify-content: center !important;
          flex-wrap: wrap !important;
          gap: 16px !important;
        }
      }

      .lang-flag-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 11px;
        border-radius: 7px;
        border: none;
        background: transparent;
        color: #6b6b80;
        font-family: 'DM Sans', sans-serif;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        transition: all .18s ease;
        white-space: nowrap;
      }
      .lang-flag-btn:hover { color: #e8e8f0; background: rgba(255,255,255,0.05); }
      .lang-flag-btn.active {
        color: #e8e8f0;
        background: rgba(108,99,255,0.15);
        border: 1px solid rgba(108,99,255,0.25);
      }
    `;
    document.head.appendChild(style);
  }

  document.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    injectLangToggle();
    injectFooter();
    // Re-apply translations so footer gets translated too
    if (window.i18n) window.i18n.apply();
  });
})();
