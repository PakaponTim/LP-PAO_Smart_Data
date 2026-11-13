import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createAuth } from '../backend/services/auth.js';
import { createWriteQueue } from '../backend/services/write-queue.js';
import { createIngestionRepository, numeric } from '../backend/repositories/ingestion.js';
import { createIngestionService } from '../backend/services/ingestion.js';
import { installIngestionRoutes } from '../backend/routes/ingestion.js';

const row = ['station','river','district','province','1.2','2','-0.8','up','normal','12:00','0','4','4','normal'];
test('queue serializes writes, clears itself, and recovers after a rejected write', async () => {
  const queue = createWriteQueue(); const calls = [];
  const a = queue.enqueue('file', async () => { calls.push(1); throw new Error('locked'); });
  const b = queue.enqueue('file', async () => { calls.push(2); return 42; });
  await assert.rejects(a, /locked/); assert.equal(await b, 42); await queue.drain();
  assert.deepEqual(calls, [1,2]); assert.equal(queue.pending.size, 0);
});
test('DB failure, Excel failure, and fallback have truthful results; queue continues', async () => {
  let dbFails = true, excelFails = false, writes = 0;
  const service = createIngestionService({ repository: { async write() { if (dbFails) throw new Error('db down'); return { batchId: 'batch' }; } }, excelWriters: { water: async () => { writes++; if (excelFails) throw new Error('locked'); } } });
  assert.equal((await service.save('water', [row])).status, 'fallback');
  dbFails = false; excelFails = true;
  const partial = await service.save('water', [row]); assert.equal(partial.status, 'partial'); assert.equal(partial.database, 'saved');
  dbFails = true; assert.equal((await service.save('water', [row])).status, 'failed');
  dbFails = false; excelFails = false; assert.equal((await service.save('water', [row])).status, 'saved');
  assert.equal(writes, 4);
});
test('retry rolls back partial rows; uncertain commit uses ledger and cannot duplicate data', async () => {
  const committed = new Map(); let staged; let dataRows = 0, pendingRows = 0, rollbacks = 0, first = true;
  const connection = {
    async beginTransaction() { staged = null; pendingRows = 0; },
    async execute(sql, values) {
      if (committed.has(values[0])) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      staged = values;
    },
    async query(sql, values) { pendingRows += values.length / 12; },
    async commit() { committed.set(staged[0], { fingerprint: staged[2], row_count: staged[3] }); dataRows += pendingRows; pendingRows = 0; if (first) { first = false; throw Object.assign(new Error('connection lost after commit'), { code: 'ECONNRESET' }); } },
    async rollback() { rollbacks++; pendingRows = 0; }, release() {}
  };
  const pool = { async query() {}, async getConnection() { return connection; }, async execute(sql, [key]) { return [[committed.get(key)].filter(Boolean)]; } };
  const repository = createIngestionRepository(pool, { sleep: async () => {} });
  const result = await repository.write('water', [row], 'same-request');
  assert.equal(result.duplicate, true); assert.equal(dataRows, 1); assert.equal(rollbacks, 2);
  await assert.rejects(repository.write('water', [[...row.slice(0,4), '3', ...row.slice(5)]], 'same-request'), e => e.status === 409);
});
test('numeric parser preserves real zero, commas and missing values', () => {
  assert.equal(numeric(0), 0); assert.equal(numeric('1,234.5'),1234.5); assert.equal(numeric('-'), null); assert.equal(numeric('broken'),null);
});
test('real HTTP authentication: login, CSRF, roles, pairing scope and logout', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'water-auth-test-'));
  const auth = await createAuth({ directory });
  await auth.addUser('admin', 'test-password-at-least-12', 'admin');
  await auth.addUser('viewer', 'test-password-at-least-12', 'viewer');
  const app = express(); app.use(express.json()); auth.install(app);
  app.post('/api/schedule', (req,res) => res.json({ success:true }));
  app.post('/api/ping', (req,res) => res.json({ success:true }));
  let saved = 0;
  installIngestionRoutes(app, { async save() { saved++; return { success:false, status:'fallback', database:'failed', excel:'saved' }; } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(async () => { await new Promise(r => server.close(r)); await fs.rm(directory, { recursive:true, force:true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, method = 'GET', body, headers = {}) => fetch(base + url, { method, headers: { 'Content-Type':'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await request('/api/auth/me')).status, 401);
  assert.equal((await request('/api/auth/login','POST',{username:'admin',password:'wrong'})).status,401);
  const login = await request('/api/auth/login','POST',{username:'admin',password:'test-password-at-least-12'});
  const cookie = login.headers.get('set-cookie'); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  const { csrfToken } = await login.json(); const headers = { Cookie:cookie.split(';')[0], 'X-CSRF-Token':csrfToken };
  assert.equal((await request('/api/schedule','POST',{}, { Cookie:headers.Cookie })).status,403);
  assert.equal((await request('/api/schedule','POST',{},headers)).status,200);
  const result = await request('/api/append-data','POST',[row],headers); assert.equal(result.status,503); assert.equal((await result.json()).success,false); assert.equal(saved,1);
  const viewerLogin = await request('/api/auth/login','POST',{username:'viewer',password:'test-password-at-least-12'});
  const viewerCookie = viewerLogin.headers.get('set-cookie').split(';')[0]; const viewer = await viewerLogin.json();
  assert.equal((await request('/api/schedule','POST',{}, { Cookie:viewerCookie,'X-CSRF-Token':viewer.csrfToken })).status,403);
  assert.equal((await request('/api/auth/users','GET',null, { Cookie:viewerCookie })).status,403);
  const pair = await request('/api/auth/pair-device','POST',{username:'admin',password:'test-password-at-least-12'}); const device = await pair.json();
  const deviceHeaders = { Authorization:`Bearer ${device.token}` };
  assert.equal((await request('/api/ping','POST',{},deviceHeaders)).status,200);
  assert.equal((await request('/api/schedule','POST',{},deviceHeaders)).status,403);
  assert.equal((await request('/api/auth/me','GET',null,deviceHeaders)).status,403);
  await request(`/api/auth/devices/${device.id}`,'DELETE',{},headers);
  assert.equal((await request('/api/ping','POST',{},deviceHeaders)).status,401);
  await request('/api/auth/logout','POST',{},headers);
  assert.equal((await request('/api/auth/me','GET',null,headers)).status,401);
  const stored = await fs.readFile(path.join(directory,'accounts.json'),'utf8'); assert.ok(!stored.includes('test-password-at-least-12')); assert.ok(!stored.includes(device.token));
});
