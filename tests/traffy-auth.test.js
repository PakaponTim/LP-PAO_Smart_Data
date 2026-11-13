import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../04ext_TraffyLP/auth.js', import.meta.url), 'utf8');
function runtime(config) {
  const requests = [], errors = [];
  let connected = false;
  const context = vm.createContext({
    URL, Headers, crypto: { randomUUID: () => 'generated-batch-id' }, console,
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true }; },
    chrome: { storage: { local: { get: async () => config }, onChanged: { addListener() {} } } },
    io: () => ({ io: {}, connect() { connected = true; }, disconnect() {} })
  });
  vm.runInContext(source, context);
  return { context, requests, errors, get connected() { return connected; } };
}

test('unpaired extension reports a pairing error instead of silently remaining disconnected', async () => {
  const r = runtime({});
  r.context.waterSocket({ onAuthError: error => r.errors.push(error.message) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.connected, false);
  assert.match(r.errors[0], /ยังไม่ได้จับคู่ Extension/);
});

test('HTTP retries preserve the request batch key for the matching committed result', async () => {
  const r = runtime({ waterDeviceToken: 'test-only-token', waterServer: 'http://localhost:7000' });
  for (let n = 0; n < 2; n++) await r.context.waterApiFetch('http://localhost:7000/api/append-complaints-db', { headers: { 'X-Ingest-Key': 'scheduled-request' } });
  assert.equal(r.requests[0].options.headers.get('X-Ingest-Key'), 'scheduled-request');
  assert.equal(r.requests[1].options.headers.get('X-Ingest-Key'), 'scheduled-request');
  assert.equal(r.requests[0].options.credentials, 'omit');
});
