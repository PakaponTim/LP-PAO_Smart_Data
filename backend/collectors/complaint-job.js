import { randomUUID } from 'node:crypto';

// A job completes only on a committed ingestion result, or a successful fallback.
// Client success messages alone must never count as a database commit.
export function createComplaintJob({ isConnected, send, fallback, log,
  extensionTimeoutMs = 120000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let active = null;
  let pending = null;

  function notify({ requestId, success, error, deviceId }) {
    if (!pending) return false;
    // Older paired extensions do not echo request IDs. Accept only a committed
    // HTTP ingestion from the exact device selected for this active job.
    const legacyCommit = success && deviceId && deviceId === pending.legacyDeviceId;
    if (requestId !== pending.requestId && !legacyCommit) return false;
    if (success) pending.resolve({ success: true, source: 'extension', requestId });
    else pending.reject(new Error(error || 'บันทึกข้อมูลเรื่องร้องเรียนไม่สำเร็จ'));
    return true;
  }

  function run(mode = 'db') {
    if (active) return active;
    active = Promise.resolve().then(async () => {
      if (isConnected()) {
        const requestId = randomUUID();
        let timer;
        try {
          const result = await new Promise((resolve, reject) => {
            pending = { requestId, resolve, reject };
            timer = setTimer(() => reject(new Error(`ยังไม่ได้รับผลบันทึกเรื่องร้องเรียนภายใน ${extensionTimeoutMs / 1000} วินาที`)), extensionTimeoutMs);
            log('📡 ส่งคำสั่งเก็บข้อมูลไปยัง Traffy Extension และรอผลบันทึก');
            const recipient = send({ requestId, timestamp: Date.now() });
            pending.legacyDeviceId = recipient?.legacyDeviceId;
          });
          log('✅ งานเรื่องร้องเรียนเสร็จสิ้น ยืนยันการบันทึกฐานข้อมูลแล้ว');
          return result;
        } catch (error) {
          log(`⚠️ Traffy Extension: ${error.message} กำลังตรวจช่องทางสำรอง`);
        } finally {
          clearTimer(timer);
          pending = null;
        }
      } else {
        log('ℹ️ ไม่พบ Traffy Extension ที่เชื่อมต่อ ตรวจช่องทางสำรอง (Extension ต้องจับคู่กับ Water System แม้เปิดหน้าเว็บอยู่แล้ว)');
      }
      return await fallback(mode);
    }).finally(() => { active = null; });
    return active;
  }

  return { run, notify };
}
