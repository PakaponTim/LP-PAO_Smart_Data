import test from 'node:test';
import assert from 'node:assert/strict';
import { createComplaintJob } from '../backend/collectors/complaint-job.js';

function harness({ connected = true, legacyDeviceId, fallback = async () => ({ success: true, source: 'fallback' }) } = {}) {
  const sent = [], timers = new Map();
  let fallbackCalls = 0, nextTimer = 0;
  const job = createComplaintJob({
    isConnected: () => connected,
    send: payload => { sent.push(payload); return { legacyDeviceId }; },
    fallback: async mode => { fallbackCalls++; return fallback(mode); },
    log() {},
    setTimer: fn => { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimer: id => timers.delete(id)
  });
  return { job, sent, timers, get fallbackCalls() { return fallbackCalls; } };
}

test('only the committed batch for this request completes the job; no delayed fallback remains', async () => {
  const h = harness();
  const run = h.job.run();
  await Promise.resolve();
  assert.equal(h.sent.length, 1);
  assert.equal(h.job.notify({ requestId: 'old-job', success: true }), false);
  assert.equal(h.timers.size, 1);
  assert.equal(h.job.notify({ requestId: h.sent[0].requestId, success: true }), true);
  assert.equal((await run).source, 'extension');
  assert.equal(h.timers.size, 0);
  assert.equal(h.fallbackCalls, 0);
});

test('disconnected Traffy fails immediately on login requirement without a second scheduler timeout', async () => {
  const error = Object.assign(new Error('Traffy login required'), { retryable: false });
  const h = harness({ connected: false, fallback: async () => { throw error; } });
  await assert.rejects(h.job.run(), e => e === error);
  assert.equal(h.sent.length, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.fallbackCalls, 1);
  await assert.rejects(h.job.run(), e => e === error);
  assert.equal(h.fallbackCalls, 2);
});

test('an extension save failure starts fallback and clears its timer', async () => {
  const h = harness();
  const run = h.job.run();
  await Promise.resolve();
  h.job.notify({ requestId: h.sent[0].requestId, success: false, error: 'Database unavailable' });
  assert.equal((await run).source, 'fallback');
  assert.equal(h.timers.size, 0);
  assert.equal(h.fallbackCalls, 1);
});

test('timeout invokes fallback once and concurrent triggers share the same job', async () => {
  const h = harness();
  const first = h.job.run(), second = h.job.run();
  assert.equal(first, second);
  await Promise.resolve();
  h.timers.values().next().value();
  assert.equal((await first).source, 'fallback');
  assert.equal(h.fallbackCalls, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.job.notify({ requestId: h.sent[0].requestId, success: true }), false);
});

test('legacy extension completes only on a database commit from the selected paired device', async () => {
  const h = harness({ legacyDeviceId: 'paired-traffy' });
  assert.equal(h.job.notify({ success: true, deviceId: 'paired-traffy' }), false);
  const run = h.job.run();
  await Promise.resolve();
  assert.equal(h.job.notify({ success: true, deviceId: 'another-extension' }), false);
  assert.equal(h.job.notify({ success: false, deviceId: 'paired-traffy' }), false);
  assert.equal(h.job.notify({ success: true, deviceId: 'paired-traffy', requestId: 'legacy-batch' }), true);
  assert.equal((await run).source, 'extension');
  assert.equal(h.timers.size, 0);
  assert.equal(h.fallbackCalls, 0);
});
