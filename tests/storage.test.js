import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import ExcelJS from 'exceljs';
import { createExcelRepository } from '../backend/repositories/excel.js';
import { createExcelOutbox } from '../backend/services/excel-outbox.js';
import { createAsyncCache } from '../backend/services/cache.js';
import { recentDates } from '../backend/services/data-definitions.js';

test('persistent Excel outbox survives restart, batches writes, and prevents replay duplicates', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'water-excel-test-'));
  t.after(() => fs.rm(directory,{ recursive:true,force:true }));
  const excel = createExcelRepository(directory);
  const outbox = createExcelOutbox(directory,excel,{intervalMs:0});
  const rows = [['station','river','district','province',1,2,1,'stable','normal','10:00',0,5,0,'normal','2026-09-07']];
  await outbox.enqueue('water',rows,'water:one'); await outbox.enqueue('water',rows,'water:two');
  const restarted = createExcelOutbox(directory,excel,{intervalMs:0});
  await restarted.flush();
  assert.equal(excel.metrics.writes,1); assert.equal(excel.metrics.batches,2);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(path.join(directory,'Water_Database_Master.xlsx'));
  assert.equal(workbook.getWorksheet('Water Level').rowCount,3);
  await excel.writeJobs('water',[{id:'water:one',rows,createdAt:new Date().toISOString()}]);
  assert.equal(excel.metrics.writes,1);
  assert.ok((await restarted.status()).every(job => job.status === 'saved' && job.pendingRows === 0));
});
test('failed backup is retained for retry and later completes', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'water-retry-test-'));
  t.after(() => fs.rm(directory,{recursive:true,force:true}));
  let fail = true;
  const outbox = createExcelOutbox(directory,{async writeJobs() { if (fail) throw new Error('file locked'); }},{intervalMs:0});
  await outbox.enqueue('water',[[1]],'water:failure'); await outbox.flush();
  assert.equal((await outbox.status())[0].status,'failed'); assert.equal((await outbox.status())[0].pendingRows,1);
  fail = false; await outbox.flush(); assert.equal((await outbox.status())[0].status,'saved');
});
test('cache shares concurrent reads and never repopulates invalidated stale data', async () => {
  const cache = createAsyncCache(60000); let count = 0;
  const values = await Promise.all(Array.from({length:20},() => cache.get('status',async () => { count++; return 42; })));
  assert.equal(count,1); assert.ok(values.every(x => x === 42));
  let release; const pending = cache.get('late',() => new Promise(r => { release = r; }));
  await Promise.resolve(); cache.clear(); release('stale'); await pending;
  assert.equal(await cache.get('late',async () => 'fresh'),'fresh');
});
test('missing-date calendar is Bangkok-local at midnight and month boundaries', () => {
  assert.deepEqual(recentDates(2,new Date('2026-08-31T18:00:00Z')),['2026-08-31','2026-09-01']);
});
