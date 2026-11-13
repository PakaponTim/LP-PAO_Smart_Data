(() => {
  window.waterEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nativeFetch = window.fetch.bind(window);
  let csrfToken;
  const ready = nativeFetch('/api/auth/me', { cache: 'no-store' }).then(async response => {
    if (!response.ok) { location.replace('/login.html'); throw new Error('กรุณาเข้าสู่ระบบ'); }
    const data = await response.json();
    csrfToken = data.csrfToken;
    return data.user;
  });
  window.waterSession = ready;
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return nativeFetch(input, options);
    await ready;
    const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
    const method = (options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('X-CSRF-Token', csrfToken);
    const response = await nativeFetch(input, { ...options, headers });
    if (response.status === 401) location.replace('/login.html');
    return response;
  };
  window.waterLogout = async () => { await window.fetch('/api/auth/logout', { method: 'POST' }); location.replace('/login.html'); };
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const user = await ready;
      const bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;bottom:10px;right:12px;z-index:10000;background:#fff;color:#172554;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font:13px sans-serif;box-shadow:0 2px 6px #0002';
      const label = document.createElement('span'); label.textContent = `${user.username} (${user.role}) `; bar.append(label);
      if (user.role === 'admin') { const link = document.createElement('a'); link.href = '/accounts.html'; link.textContent = 'จัดการบัญชี · '; bar.append(link); }
      const operations = document.createElement('a'); operations.href = '/operations.html'; operations.textContent = 'ติดตามงาน · '; bar.append(operations);
      const button = document.createElement('button'); button.textContent = 'ออกจากระบบ'; button.onclick = window.waterLogout; bar.append(button);
      document.body.append(bar);
    } catch {}
  });
})();
