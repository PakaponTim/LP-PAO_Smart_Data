// Read-only live acceptance check: no credentials, database writes or notifications.
import assert from 'node:assert/strict';
import { createCollectors } from '../backend/collectors/index.js';

let attempts = 0;
const collectors = createCollectors({
  io: {}, isExtensionConnected: () => false, isTraffyExtensionConnected: () => false,
  addLog: (source, message) => console.log(`[${source}] ${message}`),
  fetchLogToFile() {}, logTaskRun() {},
  withRetry: async fn => { attempts++; return fn(); },
  safeCloseBrowser: browser => browser.close(),
  checkInternetConnection: async () => true,
  dualWriteComplaints: async () => { throw new Error('Live acceptance check must not write data'); }
});

const start = Date.now();
await assert.rejects(collectors.triggerComplaintsDataFetch('db'), error => {
  assert.equal(error.code, 'TRAFFY_AUTH_REQUIRED');
  assert.equal(error.retryable, false);
  return true;
});
assert.equal(attempts, 1);
console.log(JSON.stringify({ passed: true, result: 'Authentication required reported immediately', attempts, elapsedMs: Date.now() - start }));
