import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWriteQueue } from '../services/write-queue.js';

const layouts = {
  water: ['Water_Database_Master.xlsx','Water Level',['ชื่อสถานี','แม่น้ำ/คลอง','อำเภอ','จังหวัด','ระดับน้ำปัจจุบัน_ม_รทก','ระดับตลิ่ง_ม_รทก','ผลต่างตลิ่ง_ม','แนวโน้ม','สถานการณ์น้ำ','เวลา','Current_Rain_mm','Rainfall_Accum_3d_mm','Rainfall_Daily_mm','Risk_Level','วันที่และเวลา']],
  drought: ['Drought_Dam_Data.xlsx','ข้อมูลอ่างเก็บน้ำ',['วันที่เก็บข้อมูล','เวลา (ISO)','ประเภทอ่าง','ชื่ออ่าง','ความจุ (ล้าน ลบ.ม.)','ปริมาณน้ำไหลลงอ่าง (ล้าน ลบ.ม.)','ปริมาณน้ำในอ่าง (ล้าน ลบ.ม.)','เปอร์เซ็นต์น้ำ (%)','ปริมาณน้ำใช้การ (ล้าน ลบ.ม.)','ปริมาณน้ำระบาย (ล้าน ลบ.ม.)']],
  pm25: ['PM25_Air_Quality_Data.xlsx','ข้อมูลคุณภาพอากาศ PM2.5',['วันที่เก็บข้อมูล','เวลา (ISO)','ชื่อสถานี','ตำบล','อำเภอ','จังหวัด','เวลาที่วัด','PM 2.5 (µg/m³)','เฉลี่ย 24 ชม. (µg/m³)','คุณภาพอากาศ']],
  rainfall: ['Rainfall_Data.xlsx','Rainfall_Data',['วันที่บันทึก','เวลาที่วัด','ชื่อสถานี','ที่ตั้ง','ลุ่มน้ำ','ปริมาณฝน (มม.)','สถานะ']],
  complaints: ['Complaints_Data.xlsx','Complaints_Data',['วันที่เก็บบันทึก','รหัสตั๋ว','สถานะ','ประเภทปัญหา','รายละเอียด','หน่วยงาน','สถานะหน่วยงาน','วันเวลาที่แจ้ง','ดาวความพึงพอใจ','รูปภาพ','พิกัด/สถานที่']]
};
export function createExcelRepository(directory) {
  const queue = createWriteQueue();
  const metrics = { writes:0, batches:0, rows:0, lastDurationMs:0 };
  async function writeJobs(kind, jobs) {
    const [filename, sheetName, headers] = layouts[kind];
    const target = path.join(directory,filename);
    return queue.enqueue(target, async () => {
      const started = performance.now();
      const workbook = new ExcelJS.Workbook();
      let exists = true;
      try { await fs.access(target); } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
      if (exists) await workbook.xlsx.readFile(target);
      let sheet = workbook.getWorksheet(sheetName);
      if (!sheet) { sheet = workbook.addWorksheet(sheetName); sheet.addRow(headers); sheet.getRow(1).font = { bold:true }; sheet.columns.forEach(c => { c.width = 22; }); }
      // Keep historical headers intact. The new meaning/version is recorded below.
      let ledger = workbook.getWorksheet('_ingest_batches');
      if (!ledger) { ledger = workbook.addWorksheet('_ingest_batches', { state:'veryHidden' }); ledger.addRow(['batch_id','written_at','definitions_version']); }
      const seen = new Set(); ledger.eachRow((row,index) => { if (index > 1) seen.add(String(row.getCell(1).value)); });
      const pending = jobs.filter(job => !seen.has(job.id));
      if (!pending.length) return;
      const tickets = new Map();
      if (kind === 'complaints') sheet.eachRow((row,index) => { if (index > 1) tickets.set(String(row.getCell(2).value), row); });
      let count = 0;
      for (const job of pending) {
        for (const source of job.rows) {
          let values;
          if (kind === 'rainfall') values = [job.createdAt,source.measured_time,source.station_name,source.location,source.river_basin,source.rain_mm,source.rain_status];
          else if (kind === 'complaints') values = [job.createdAt,source.ticket_id,source.state_name,source.problem_type,source.description,source.org_name,source.agency_status || '',source.ticket_datetime,source.satisfaction_stars,source.photo_url,source.location];
          else values = source;
          // Strings stay literal cell values; never interpret source text as formulas.
          values = values.map(value => value === undefined ? null : typeof value === 'object' && value !== null ? JSON.stringify(value) : value);
          if (kind === 'complaints' && tickets.has(String(source.ticket_id))) tickets.get(String(source.ticket_id)).values = values;
          else { const row = sheet.addRow(values); if (kind === 'complaints') tickets.set(String(source.ticket_id),row); }
          count++;
        }
        ledger.addRow([job.id,new Date().toISOString(),'2026-09-07.1']);
      }
      // The workbook and its batch ledger become visible together. If Excel has
      // the target open, rename fails and the outbox retains the pending jobs.
      const temporary = path.join(directory, `.${filename}.${randomUUID()}.tmp.xlsx`);
      try { await workbook.xlsx.writeFile(temporary); await fs.rename(temporary,target); }
      finally { await fs.rm(temporary,{force:true}).catch(() => {}); }
      metrics.writes++; metrics.batches += pending.length; metrics.rows += count; metrics.lastDurationMs = Math.round(performance.now()-started);
    });
  }
  return { writeJobs, metrics, pending:queue.pending, drain:queue.drain };
}
