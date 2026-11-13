// Runs in the extension isolated world; never exposes device credentials to page DOM.
const resolveServer7000 = url => (!url || /:3000(?=\/|$)/.test(url)) ? 'http://localhost:7000' : url;
globalThis.waterApiFetch = async function(input, options = {}) {
  const config = await chrome.storage.local.get(['waterServer', 'waterDeviceToken']);
  if (!config.waterDeviceToken) throw new Error('กรุณาจับคู่ Extension ในหน้าตัวเลือกก่อน');
  const original = new URL(input, 'http://localhost:7000');
  const server = resolveServer7000(config.waterServer);
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${config.waterDeviceToken}`);
  if (original.pathname.startsWith('/api/append-') && !headers.has('X-Ingest-Key')) headers.set('X-Ingest-Key', crypto.randomUUID());
  return fetch(server + original.pathname + original.search, { ...options, headers, credentials: 'omit' });
};
globalThis.waterSocket = function(options = {}) {
  const { onAuthError = console.error, ...socketOptions } = options;
  const socket = io('http://localhost:7000', { ...socketOptions, autoConnect: false });
  const configure = async () => {
    const config = await chrome.storage.local.get(['waterServer', 'waterDeviceToken']);
    if (!config.waterDeviceToken) throw new Error('ยังไม่ได้จับคู่ Extension: กด “เชื่อมต่อ Water System” แล้วใช้บัญชีผู้ดูแลระบบ');
    socket.io.uri = resolveServer7000(config.waterServer);
    socket.auth = callback => chrome.storage.local.get('waterDeviceToken').then(c => callback({ token: c.waterDeviceToken }));
    socket.connect();
  };
  configure().catch(onAuthError);
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.waterServer || changes.waterDeviceToken)) { socket.disconnect(); configure().catch(onAuthError); } });
  return socket;
};
