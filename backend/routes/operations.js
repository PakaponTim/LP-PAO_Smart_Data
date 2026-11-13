import path from 'node:path';
import { FileStore } from '../services/file-store.js';
import { recentDates, bangkokDate } from '../services/data-definitions.js';
import { createAsyncCache } from '../services/cache.js';

const domains = [
  ['water','tbl_water_disaster_monitoring','station_name'],
  ['rainfall','tbl_rainfall_monitoring','station_name'],
  ['drought','tbl_drought_monitoring','dam_name'],
  ['pm25','tbl_pm25_monitoring','station_name']
];
export function installOperations(app, { pool, directory, outbox, ingestion, recovery, excel, metrics }) {
  const incidents = new FileStore(path.join(directory,'incidents.json'),{ incidents:{} });
  const cache = createAsyncCache(60000);
  app.get('/api/operations/status', async (req,res) => {
    res.json({ backupJobs:await outbox.status(), recoveryJobs:(await recovery.read()).jobs.map(({rows,...job}) => ({...job,count:rows.length})), excel:excel.metrics, requests:metrics.snapshot() });
  });
  app.post('/api/operations/retry-backups', async (req,res) => { await outbox.flush(); res.json({success:true,jobs:await outbox.status()}); });
  app.post('/api/operations/retry-ingest/:id', async (req,res) => {
    const job = (await recovery.read()).jobs.find(job => job.id === req.params.id);
    if (!job) return res.status(404).json({error:'ไม่พบชุดข้อมูลรอกู้คืน'});
    const result = await ingestion.save(job.kind,job.rows,job.key);
    res.status(result.success ? 200 : 503).json(result);
  });
  app.get('/api/incidents', async (req,res) => {
    const [alerts] = await pool.query('SELECT id,alert_type,station_name,alert_level,alert_title,created_at FROM tbl_alert_notifications ORDER BY id DESC LIMIT 100');
    const saved = (await incidents.read()).incidents;
    res.json({ incidents:alerts.map(alert => ({...alert,status:'new',owner:'',history:[],...saved[alert.id]})) });
  });
  app.post('/api/incidents/:id', async (req,res) => {
    const id = Number(req.params.id); const { status,owner,note } = req.body;
    if (!Number.isSafeInteger(id) || id < 1 || !['acknowledged','in_progress','resolved','reopened'].includes(status) || typeof owner !== 'string' || owner.length > 100 || typeof note !== 'string' || note.length > 2000) return res.status(400).json({error:'สถานะ ผู้รับผิดชอบ หรือบันทึกไม่ถูกต้อง'});
    const [rows] = await pool.execute('SELECT id FROM tbl_alert_notifications WHERE id=?',[id]);
    if (!rows.length) return res.status(404).json({error:'ไม่พบเหตุแจ้งเตือน'});
    const entry = await incidents.update(data => {
      const previous = data.incidents[id] || {status:'new',history:[]};
      const event = {from:previous.status,to:status,owner,note,actor:req.user.username,at:new Date().toISOString()};
      data.incidents[id] = {status,owner,updatedAt:event.at,history:[...previous.history,event]};
      return data.incidents[id];
    });
    res.json({success:true,incident:entry});
  });
  app.get('/api/data-quality', async (req,res) => {
    const days = Math.max(1,Math.min(Number.parseInt(req.query.days)||7,90));
    const result = await cache.get(String(days), async () => {
      const dates = recentDates(days); const stations = [];
      for (const [kind,table,column] of domains) {
        const [latest] = await pool.query(`SELECT ${column} AS name,MAX(recorded_at) AS last_received,TIMESTAMPDIFF(MINUTE,MAX(recorded_at),NOW()) AS age_minutes FROM ${table} GROUP BY ${column}`);
        const [coverage] = await pool.execute(`SELECT ${column} AS name,DATE_FORMAT(recorded_at,'%Y-%m-%d') AS date,COUNT(*) AS count FROM ${table} WHERE recorded_at >= ? AND recorded_at < DATE_ADD(?,INTERVAL 1 DAY) GROUP BY ${column},DATE_FORMAT(recorded_at,'%Y-%m-%d')`,[`${dates[0]} 00:00:00`,`${dates.at(-1)} 00:00:00`]);
        const byStation = new Map();
        for (const row of coverage) { if (!byStation.has(row.name)) byStation.set(row.name,new Set()); byStation.get(row.name).add(row.date); }
        for (const row of latest) {
          const missingDates = dates.filter(date => !byStation.get(row.name)?.has(date));
          stations.push({kind,name:row.name,lastReceived:row.last_received,ageMinutes:row.age_minutes,stale:row.age_minutes === null || row.age_minutes > 120,missingDates:missingDates.filter(date => date !== dates.at(-1)),todayPending:missingDates.includes(dates.at(-1))});
        }
      }
      return { checkedAt:new Date().toISOString(),timezone:'Asia/Bangkok',days,staleAfterMinutes:120,stations,notes:['รายการสถานีมาจากประวัติในฐานข้อมูล สถานีที่ไม่เคยได้รับข้อมูลจะยังไม่อยู่ในรายการ','ใช้เวลารับข้อมูล ไม่ยืนยันเวลาตรวจวัดต้นทาง','วันปัจจุบันยังไม่ถือว่าเป็นวันที่ขาดทั้งวัน'] };
    });
    res.json(result);
  });
  app.get('/api/complaints/:ticket/events', async (req,res) => {
    const [rows] = await pool.execute('SELECT state_name,org_name,observed_at FROM app_complaint_events WHERE ticket_id=? ORDER BY id ASC',[req.params.ticket]);
    res.json({events:rows,note:'ประวัติเริ่มจากการเก็บข้อมูลหลังติดตั้งรุ่นนี้ ไม่ใช่ประวัติย้อนหลังทั้งหมดของต้นทาง'});
  });
  return { invalidate:() => cache.clear() };
}
