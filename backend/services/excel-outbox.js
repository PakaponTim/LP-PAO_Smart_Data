import path from 'node:path';
import { FileStore } from './file-store.js';

export function createExcelOutbox(directory, excel, { intervalMs = 30000 } = {}) {
  const store = new FileStore(path.join(directory,'excel-outbox.json'), { jobs:[] });
  let running;
  async function enqueue(kind, rows, id) {
    await store.update(data => {
      if (!data.jobs.some(job => job.id === id)) data.jobs.push({ id,kind,rows,status:'queued',attempts:0,createdAt:new Date().toISOString() });
    });
  }
  function flush() {
    if (running) return running;
    running = (async () => {
      const data = await store.read();
      for (const kind of ['water','rainfall','drought','pm25','complaints']) {
        const jobs = data.jobs.filter(job => job.kind === kind && job.status !== 'saved');
        if (!jobs.length) continue;
        let error;
        try { await excel.writeJobs(kind,jobs); } catch (e) { error = e; }
        const ids = new Set(jobs.map(job => job.id));
        await store.update(current => {
          for (const job of current.jobs) if (ids.has(job.id)) {
            job.attempts++; job.updatedAt = new Date().toISOString();
            job.status = error ? 'failed' : 'saved';
            if (error) job.error = error.message.slice(0,300);
            else { delete job.rows; delete job.error; }
          }
          const completed = current.jobs.filter(job => job.status === 'saved').slice(-100);
          current.jobs = [...current.jobs.filter(job => job.status !== 'saved'), ...completed];
        });
      }
    })().finally(() => { running = null; });
    return running;
  }
  const timer = intervalMs > 0 ? setInterval(() => flush().catch(error => console.error('Excel outbox:',error.message)),intervalMs) : null;
  timer?.unref();
  async function status() { return (await store.read()).jobs.map(({ rows,...job }) => ({ ...job, pendingRows:rows?.length || 0 })); }
  return { enqueue, flush, status, async close() { if (timer) clearInterval(timer); await flush(); } };
}
