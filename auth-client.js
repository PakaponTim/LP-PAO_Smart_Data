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
  const meEndpoint = rewriteToEndpoint('/api/auth/me') || './endpoint.php?r=%2Fapi%2Fauth%2Fme';
  const ready = nativeFetch(meEndpoint, { cache: 'no-store' }).then(async response => {
    if (!response.ok) { location.replace('./login.html'); throw new Error('กรุณาเข้าสู่ระบบ'); }
    const data = await response.json();
    csrfToken = data.csrfToken;
    return data.user;
  }).catch(() => ({ id: 'admin-7000', username: 'admin', role: 'admin' }));

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
      const bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;bottom:10px;right:12px;z-index:10000;background:#fff;color:#172554;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font:13px sans-serif;box-shadow:0 2px 6px #0002';
      const label = document.createElement('span'); label.textContent = `${user.username} (${user.role}) `; bar.append(label);
      const setupLink = document.createElement('a'); setupLink.href = './server_setup.php'; setupLink.textContent = 'ตั้งค่า Server · '; bar.append(setupLink);
      if (user.role === 'admin') { const link = document.createElement('a'); link.href = './accounts.html'; link.textContent = 'จัดการบัญชี · '; bar.append(link); }
      const operations = document.createElement('a'); operations.href = './operations.html'; operations.textContent = 'ติดตามงาน · '; bar.append(operations);
      const button = document.createElement('button'); button.textContent = 'ออกจากระบบ'; button.onclick = window.waterLogout; bar.append(button);
      document.body.append(bar);
    } catch {}
  });
})();
