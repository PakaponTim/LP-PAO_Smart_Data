const form = document.querySelector('#pair');
chrome.storage.local.get('waterServer').then(c => { if (c.waterServer && !/:3000(?=\/|$)/.test(c.waterServer)) form.server.value = c.waterServer; });
form.onsubmit = async event => {
  event.preventDefault(); const status = document.querySelector('#status');
  try {
    const url = new URL(form.server.value);
    if (url.port === '3000') throw new Error('ห้ามใช้พอร์ต 3000 (โปรเจกต์นี้แยกใช้พอร์ต 7000 เท่านั้น)');
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('ใช้ HTTPS หรือ HTTP บน localhost เท่านั้น');
    const granted = await chrome.permissions.request({ origins: [url.origin + '/*'] });
    if (!granted) throw new Error('ต้องอนุญาตการเชื่อมต่อเซิร์ฟเวอร์');
    const response = await fetch(url.origin + '/api/auth/pair-device', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: form.username.value, password: form.password.value, name: chrome.runtime.getManifest().name }), credentials: 'omit' });
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    await chrome.storage.local.set({ waterServer: url.origin, waterDeviceToken: result.token });
    await fetch(url.origin + '/api/ping', { method: 'POST', headers: { Authorization: `Bearer ${result.token}` }, credentials: 'omit' });
    const tabs = await chrome.tabs.query({ url: 'https://citydata.traffy.in.th/*' });
    await Promise.all(tabs.map(tab => chrome.tabs.reload(tab.id)));
    form.password.value = ''; status.textContent = 'จับคู่และเชื่อมต่อสำเร็จ';
  } catch (error) { status.textContent = error.message; }
};
