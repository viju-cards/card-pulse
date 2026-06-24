(function () {
  // Styling now lives in /cardpulse-ui.css — shared.js only injects the
  // shared chrome (language switcher + footer) and bootstraps i18n.

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

  function injectNavToggle() {
    var nav = document.querySelector('nav');
    if (!nav || nav.querySelector('.nav-toggle')) return;
    var menu = nav.querySelector('.nav-links, .nav-right');
    if (!menu) return;
    var bar = menu.parentElement;

    var btn = document.createElement('button');
    btn.className = 'nav-toggle';
    btn.setAttribute('aria-label', 'Menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span></span><span></span><span></span>';
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('menu-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    bar.appendChild(btn);

    // Tapping a link closes the menu again
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        nav.classList.remove('menu-open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function injectFooter() {
    const existing = document.querySelector('footer, .cp-footer-wrap');
    if (existing) return;
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

  document.addEventListener('DOMContentLoaded', function () {
    injectLangToggle();
    injectNavToggle();
    injectFooter();
    if (window.i18n) {
      const lang = localStorage.getItem('cp_lang') || 'en';
      window.i18n.lang = lang;
      window.i18n.apply();
    }
  });
})();
