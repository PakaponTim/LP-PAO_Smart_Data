(() => {
  window.waterEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nativeFetch = window.fetch.bind(window);

  // Detect base directory URL so the folder can be dropped at ANY Server path
  // e.g. http://server/Water_System2/ or http://127.0.0.1:7000/ without Server Admin config
  const getBaseDir = () => {
    const p = location.pathname;
    const slashIdx = p.lastIndexOf('/');
    const dir = slashIdx >= 0 ? p.slice(0, slashIdx + 1) : '/';
    return location.origin + dir;
  };

  const rewriteToEndpoint = (rawUrl) => {
    const url = new URL(typeof rawUrl === 'string' ? rawUrl : rawUrl.url, location.href);
    if (url.origin !== location.origin) return null;
    if (url.pathname.endsWith('/endpoint.php')) return null;

    let routePath = null;
    const apiIdx = url.pathname.indexOf('/api/');
    const sioIdx = url.pathname.indexOf('/socket.io/');
    if (apiIdx !== -1) {
      routePath = url.pathname.slice(apiIdx) + url.search;
    } else if (sioIdx !== -1) {
      routePath = url.pathname.slice(sioIdx) + url.search;
    }
    if (!routePath) return null;
    return getBaseDir() + 'endpoint.php?r=' + encodeURIComponent(routePath);
  };

  let csrfToken;
  const pageName = location.pathname.split('/').pop() || 'index.html';
  const loginRedirectUrl = './login.html?reauth=1&next=' + encodeURIComponent(pageName);
  if (pageName !== 'login.html' && pageName !== 'public.html' && pageName !== 'setup.html') {
    document.documentElement.style.visibility = 'hidden';
  }
  const meEndpoint = rewriteToEndpoint('/api/auth/me') || './endpoint.php?r=%2Fapi%2Fauth%2Fme';
  const ready = nativeFetch(meEndpoint, { cache: 'no-store' }).then(async response => {
    if (!response.ok) { location.replace(loginRedirectUrl); throw new Error('กรุณาเข้าสู่ระบบผู้ดูแลระบบ'); }
    const data = await response.json();
    if (!data?.user || data.user.role !== 'admin') {
      location.replace(loginRedirectUrl);
      throw new Error('สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin Only)');
    }
    csrfToken = data.csrfToken;
    document.documentElement.style.visibility = 'visible';
    return data.user;
  }).catch(err => {
    location.replace(loginRedirectUrl);
    throw err;
  });

  window.waterSession = ready;
  window.fetch = async (input, options = {}) => {
    const rewritten = rewriteToEndpoint(input);
    if (!rewritten) return nativeFetch(input, options);
    await ready;
    const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
    const method = (options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) headers.set('X-CSRF-Token', csrfToken);
    const response = await nativeFetch(rewritten, { ...options, headers });
    if (response.status === 401) location.replace('./login.html');
    return response;
  };
  window.waterLogout = async () => { await window.fetch('/api/auth/logout', { method: 'POST' }); location.replace('./login.html'); };
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const user = await ready;
      if (document.getElementById('wsAdminDock')) return;

      const style = document.createElement('style');
      style.textContent = `
        #wsAdminDock {
          position: fixed;
          bottom: 12px;
          right: 12px;
          z-index: 9998;
          font-family: 'Prompt', 'Noto Sans Thai', system-ui, sans-serif;
        }
        #wsAdminToggle {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 38px;
          padding: 0 13px;
          border-radius: 9999px;
          border: 1px solid rgba(15, 23, 42, 0.14);
          background: rgba(255, 255, 255, 0.96);
          color: #0f172a;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.16);
          backdrop-filter: blur(8px);
          transition: transform 0.18s ease, box-shadow 0.2s ease;
        }
        #wsAdminToggle:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 22px rgba(15, 23, 42, 0.22);
        }
        #wsAdminDesktopBar {
          display: none;
          align-items: center;
          gap: 8px;
          height: 38px;
          padding: 0 12px;
          border-radius: 9999px;
          border: 1px solid rgba(148, 163, 184, 0.45);
          background: rgba(255, 255, 255, 0.96);
          color: #0f172a;
          font-size: 12.5px;
          font-weight: 600;
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.14);
          backdrop-filter: blur(8px);
        }
        #wsAdminDesktopBar a {
          color: #0f766e;
          text-decoration: none;
          font-weight: 700;
          padding: 3px 6px;
          border-radius: 8px;
        }
        #wsAdminDesktopBar a:hover { background: #ecfdf5; color: #065f46; }
        #wsAdminDesktopBar button {
          background: #fee2e2;
          color: #b91c1c;
          border: none;
          border-radius: 9999px;
          padding: 4px 10px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }
        #wsAdminDesktopBar button:hover { background: #fecaca; }
        #wsAdminPopover {
          position: fixed;
          bottom: 58px;
          right: 12px;
          z-index: 9999;
          width: 248px;
          background: #ffffff;
          color: #0f172a;
          border: 1px solid #cbd5e1;
          border-radius: 16px;
          padding: 10px;
          box-shadow: 0 18px 36px -8px rgba(15, 23, 42, 0.28);
          display: none;
        }
        #wsAdminPopover.open { display: block; }
        #wsAdminPopover .ws-adm-user {
          font-size: 12.5px;
          font-weight: 700;
          color: #065f46;
          padding: 6px 10px 8px;
          border-bottom: 1px solid #e2e8f0;
          margin-bottom: 6px;
          word-break: break-all;
        }
        #wsAdminPopover a, #wsAdminPopover button {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          text-align: left;
          padding: 8px 10px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          color: #1e293b;
          text-decoration: none;
          background: transparent;
          border: none;
          cursor: pointer;
        }
        #wsAdminPopover a:hover { background: #ecfdf5; color: #065f46; }
        #wsAdminPopover button.ws-adm-logout {
          margin-top: 4px;
          color: #b91c1c;
          background: #fef2f2;
        }
        #wsAdminPopover button.ws-adm-logout:hover { background: #fee2e2; }
        .dark #wsAdminToggle, .dark #wsAdminDesktopBar, .dark #wsAdminPopover {
          background: rgba(15, 23, 42, 0.96);
          color: #f8fafc;
          border-color: #334155;
        }
        .dark #wsAdminDesktopBar a { color: #34d399; }
        .dark #wsAdminPopover a { color: #e2e8f0; }
        .dark #wsAdminPopover a:hover { background: #1e293b; color: #34d399; }
        .dark #wsAdminPopover .ws-adm-user { color: #6ee7b7; border-color: #334155; }
        @media (min-width: 1024px) {
          #wsAdminToggle { display: none; }
          #wsAdminDesktopBar { display: inline-flex; }
        }
      `;
      document.head.appendChild(style);

      const dock = document.createElement('div');
      dock.id = 'wsAdminDock';

      // Compact Mobile / Tablet Toggle Pill (Zero overlap with Bottom-Left #wsQuickDock!)
      const toggleBtn = document.createElement('button');
      toggleBtn.id = 'wsAdminToggle';
      toggleBtn.type = 'button';
      toggleBtn.innerHTML = '<span>👤</span><span>ผู้ดูแล</span><span style="font-size:10px;opacity:.7">▴</span>';

      // Upward Popover Menu for Mobile / Tablet
      const popover = document.createElement('div');
      popover.id = 'wsAdminPopover';
      popover.innerHTML = `
        <div class="ws-adm-user">${window.waterEscape(user.username)} (${window.waterEscape(user.role)})</div>
        <a href="./server_setup.php">⚙️ ตั้งค่า Server</a>
        ${user.role === 'admin' ? '<a href="./accounts.html">👥 จัดการบัญชี</a>' : ''}
        <a href="./operations.html">📋 ติดตามงาน</a>
      `;
      const popLogout = document.createElement('button');
      popLogout.type = 'button';
      popLogout.className = 'ws-adm-logout';
      popLogout.textContent = '🚪 ออกจากระบบ';
      popLogout.onclick = window.waterLogout;
      popover.appendChild(popLogout);

      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        popover.classList.toggle('open');
      });
      document.addEventListener('click', (e) => {
        if (!popover.contains(e.target) && e.target !== toggleBtn) {
          popover.classList.remove('open');
        }
      });

      // Desktop Single-Row Pill (>=1024px)
      const desktopBar = document.createElement('div');
      desktopBar.id = 'wsAdminDesktopBar';
      const label = document.createElement('span');
      label.style.cssText = 'color:#64748b;font-weight:700;padding-right:4px;border-right:1px solid #cbd5e1;';
      label.textContent = `${user.username}`;
      desktopBar.append(label);
      const setupLink = document.createElement('a'); setupLink.href = './server_setup.php'; setupLink.textContent = 'ตั้งค่า Server'; desktopBar.append(setupLink);
      if (user.role === 'admin') { const link = document.createElement('a'); link.href = './accounts.html'; link.textContent = 'จัดการบัญชี'; desktopBar.append(link); }
      const operations = document.createElement('a'); operations.href = './operations.html'; operations.textContent = 'ติดตามงาน'; desktopBar.append(operations);
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'ออกจากระบบ'; button.onclick = window.waterLogout; desktopBar.append(button);

      dock.append(toggleBtn, desktopBar);
      document.body.append(dock, popover);
    } catch {}
  });
})();
