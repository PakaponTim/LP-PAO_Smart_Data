// =========================================================================
// Water_System2 — Unified UX, Quick Navigation & Smooth Motion Controller
// Zero-dependency; safe on all pages (index, control, mobile, compare, etc.)
// =========================================================================
(() => {
  if (window.__ws2UxMotionLoaded) return;
  window.__ws2UxMotionLoaded = true;

  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Restore saved font-size preference
  try {
    if (localStorage.getItem('ws2_large_text') === '1') {
      document.documentElement.classList.add('ws-large-text');
    }
  } catch {}

  document.addEventListener('DOMContentLoaded', () => {
    try {
      if (localStorage.getItem('ws2_large_text') === '1') {
        document.documentElement.classList.add('ws-large-text');
      }
    } catch {}

    // 1. Top Fetch Progress Loader
    const loader = document.createElement('div');
    loader.id = 'wsTopLoader';
    loader.innerHTML = '<span></span>';
    document.body.appendChild(loader);

    let activeFetches = 0;
    const origFetch = window.fetch ? window.fetch.bind(window) : null;
    if (origFetch) {
      window.fetch = async (...args) => {
        activeFetches++;
        loader.classList.add('active');
        try {
          return await origFetch(...args);
        } finally {
          activeFetches = Math.max(0, activeFetches - 1);
          if (activeFetches === 0) {
            setTimeout(() => { if (activeFetches === 0) loader.classList.remove('active'); }, 180);
          }
        }
      };
    }

    // 2. Subtle card lift & entrance animation
    if (!REDUCED) {
      const targets = document.querySelectorAll('main > section, main > div, .card, [class*="rounded-2xl"][class*="shadow"]');
      targets.forEach((el, idx) => {
        if (idx < 10) el.classList.add('ws-reveal');
        if (el.tagName !== 'BODY' && !el.closest('#wsQuickMenu')) {
          el.classList.add('ws-card-lift');
        }
      });
    }

    // 3. Floating Quick-Navigation Dock + Font Toggle + Scroll-to-Top
    const dock = document.createElement('div');
    dock.id = 'wsQuickDock';

    const btnMenu = document.createElement('button');
    btnMenu.type = 'button';
    btnMenu.className = 'ws-dock-btn ws-pulse';
    btnMenu.innerHTML = '<span>☰</span><span>เมนูลัด</span>';

    const btnFont = document.createElement('button');
    btnFont.type = 'button';
    btnFont.className = 'ws-dock-btn';
    btnFont.title = 'ขยาย/ลดขนาดตัวอักษร';
    btnFont.textContent = document.documentElement.classList.contains('ws-large-text') ? 'ก-' : 'ก+';
    btnFont.onclick = () => {
      document.documentElement.classList.toggle('ws-large-text');
      const on = document.documentElement.classList.contains('ws-large-text');
      btnFont.textContent = on ? 'ก-' : 'ก+';
      try { localStorage.setItem('ws2_large_text', on ? '1' : '0'); } catch {}
      window.wsToast && window.wsToast(on ? 'ขยายขนาดตัวอักษร (118%)' : 'กลับขนาดตัวอักษรปกติ (100%)');
    };

    const btnTop = document.createElement('button');
    btnTop.type = 'button';
    btnTop.id = 'wsScrollTop';
    btnTop.className = 'ws-dock-btn';
    btnTop.title = 'กลับขึ้นด้านบน';
    btnTop.textContent = '↑';
    btnTop.onclick = () => window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' });

    dock.append(btnMenu, btnFont, btnTop);
    document.body.appendChild(dock);

    const menu = document.createElement('div');
    menu.id = 'wsQuickMenu';
    menu.innerHTML = `
      <div class="ws-menu-title">Water_System2 · ทางลัดทุกหน้า</div>
      <a href="./index.html">🏠 Dashboard หลัก</a>
      <a href="./public.html">🌐 Public Dashboard อบจ.ลำปาง</a>
      <a href="./mobile.html">📱 มุมมองมือถือ / iPad</a>
      <a href="./control.html">🎛️ Control Panel &amp; Log</a>
      <a href="./notification.html">🔔 ตั้งค่าแจ้งเตือน Line/Email</a>
      <a href="./db_compare.html">⚖️ เทียบ DB v1 vs v2</a>
      <a href="./emergency_cloud.html">☁️ โหมดฉุกเฉิน (Cloud)</a>
      <a href="./server_setup.php">⚙️ ตั้งค่า Server / API Keys</a>
    `;
    document.body.appendChild(menu);

    // Highlight current page inside Quick Menu
    const curFile = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    menu.querySelectorAll('a').forEach((a) => {
      const hrefFile = (a.getAttribute('href') || '').split('/').pop().toLowerCase();
      if (hrefFile === curFile) {
        a.classList.add('ws-active');
        a.setAttribute('aria-current', 'page');
      }
    });

    // 4. Unified Toast Feedback Helper for Admin Pages
    const toast = document.createElement('div');
    toast.id = 'wsToast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
    let toastTimer = null;
    window.wsToast = (msg) => {
      if (!msg) return;
      toast.textContent = String(msg);
      toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('show'), 2100);
    };

    // 5. Interactive Selected States for KPI Cards, Sub-Tabs & Data Table Rows
    document.addEventListener('click', (e) => {
      // Table row highlight on click
      const tr = e.target.closest('tbody tr');
      if (tr && !e.target.closest('a, button, input, select')) {
        const tbody = tr.parentElement;
        const wasSelected = tr.classList.contains('ws-row-selected');
        if (tbody) tbody.querySelectorAll('tr.ws-row-selected').forEach((r) => r.classList.remove('ws-row-selected'));
        if (!wasSelected) tr.classList.add('ws-row-selected');
      }

      // KPI card selected ring when clicking a KPI card or trigger inside it
      const kpiTrigger = e.target.closest('[onclick*="openKpiModal"]');
      if (kpiTrigger) {
        const card = kpiTrigger.closest('.rounded-2xl') || kpiTrigger;
        document.querySelectorAll('.ws-kpi-selected').forEach((el) => el.classList.remove('ws-kpi-selected'));
        card.classList.add('ws-kpi-selected');
      }

      // Sub-tab aria-selected sync + toast feedback
      const subBtn = e.target.closest('.subtab-btn');
      if (subBtn) {
        document.querySelectorAll('.subtab-btn').forEach((b) => b.setAttribute('aria-selected', b === subBtn ? 'true' : 'false'));
        window.wsToast('แสดงหมวด: ' + subBtn.textContent.trim());
      }
    });

    btnMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== btnMenu) {
        menu.classList.remove('open');
      }
    });

    window.addEventListener('scroll', () => {
      btnTop.classList.toggle('visible', window.scrollY > 240);
    }, { passive: true });
  });
})();
