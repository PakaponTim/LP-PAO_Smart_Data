import { randomUUID } from 'node:crypto';
import { createWriteQueue } from './write-queue.js';
import { validateRows } from '../repositories/ingestion.js';

export function createIngestionService({ repository, excelWriters, outbox, recovery, onResult = () => {} }) {
  const queue = createWriteQueue();
  async function save(kind, rows, key = randomUUID()) {
    validateRows(kind, rows);
    return queue.enqueue(kind, async () => {
      let database = 'failed', excel = 'failed', detail, failure;
      try { detail = await repository.write(kind, rows, key); database = 'saved'; }
      catch (error) { if (error.status) throw error; failure = error; }
      if (database === 'saved' && outbox) {
        try { await outbox.enqueue(kind, rows, detail.batchId); excel = 'queued'; }
        catch (error) { failure = error; }
      } else if (detail?.duplicate) excel = 'not_repeated';
      else {
        try { await excelWriters[kind](rows, `${kind}:${key}`); excel = 'saved'; }
        catch (error) { failure ||= error; }
      }
      const result = { success: database === 'saved', status: database === 'saved' ? (excel === 'failed' ? 'partial' : excel === 'queued' ? 'pending_backup' : 'saved') : (excel === 'saved' ? 'fallback' : 'failed'), database, excel, count: rows.length, batchId: detail?.batchId || `${kind}:${key}`, duplicate: detail?.duplicate || false };
      if (failure) result.error = 'บันทึกไม่ครบทุกปลายทาง กรุณาตรวจประวัติงาน';
      if (recovery) await recovery.update(data => {
        const id = `${kind}:${key}`;
        data.jobs = data.jobs.filter(job => job.id !== id);
        if (database !== 'saved' || excel === 'failed') data.jobs.push({ id,kind,key,rows,createdAt:new Date().toISOString(),status:result.status });
      });
      await onResult(kind, result, failure);
      return result;
    });
  }
  return { save, drain: queue.drain };
}
