import mysql from 'mysql2/promise';
import * as fs from 'fs';

async function exportData() {
  const pool = mysql.createPool({
    host: 'localhost', user: 'root', password: 'root',
    database: 'water_systems', connectionLimit: 5
  });

  const [wStations] = await pool.query(`
    SELECT station_name, river, amphoe,
      ROUND(AVG(current_water_level_m),2) as avg_wl,
      ROUND(AVG(left_bank_level_m),2) as avg_bank,
      ROUND(AVG(current_rain_mm),2) as avg_rain,
      MAX(status) as status, MAX(risk_level) as risk_level
    FROM tbl_water_disaster_monitoring
    WHERE recorded_at >= '2026-07-01' AND recorded_at < '2026-08-01'
    GROUP BY station_name, river, amphoe ORDER BY amphoe, station_name`);

  const [wTotal] = await pool.query(`SELECT COUNT(*) as cnt FROM tbl_water_disaster_monitoring WHERE recorded_at >= '2026-07-01' AND recorded_at < '2026-08-01'`);

  const [dLatest] = await pool.query(`
    SELECT dam_name, dam_type, CAST(water_volume_m_cum AS CHAR) as water_volume_m_cum,
      water_percent, CAST(usable_water_m_cum AS CHAR) as usable_water_m_cum,
      CAST(inflow_m_cum AS CHAR) as inflow_m_cum, CAST(discharge_m_cum AS CHAR) as discharge_m_cum
    FROM tbl_drought_monitoring
    WHERE recorded_at = (SELECT MAX(recorded_at) FROM tbl_drought_monitoring WHERE recorded_at < '2026-08-01')
    ORDER BY FIELD(dam_type,'อ่างขนาดใหญ่','อ่างขนาดกลาง','อ่างขนาดเล็ก'), dam_name`);

  const [dDams] = await pool.query(`
    SELECT dam_name, dam_type,
      ROUND(MAX(capacity_m_cum),2) as capacity,
      ROUND(AVG(water_volume_m_cum),2) as avg_volume,
      ROUND(AVG(usable_water_m_cum),2) as avg_usable
    FROM tbl_drought_monitoring
    WHERE recorded_at >= '2026-07-01' AND recorded_at < '2026-08-01'
    GROUP BY dam_name, dam_type ORDER BY capacity DESC, dam_name`);

  const [dTotal] = await pool.query(`SELECT COUNT(*) as cnt FROM tbl_drought_monitoring WHERE recorded_at >= '2026-07-01' AND recorded_at < '2026-08-01'`);

  const [pStatus] = await pool.query(`SELECT air_quality_status, COUNT(*) as cnt FROM tbl_pm25_monitoring WHERE recorded_at >= '2026-07-01' AND recorded_at < '2026-08-01' GROUP BY air_quality_status ORDER BY cnt DESC`);

  const [pTotal] = await pool.query(`SELECT COUNT(*) as cnt, COUNT(DISTINCT station_name) as stations FROM tbl_pm25_monitoring WHERE recorded_at >= '2026-07-01' AND recorded_at < '2026-08-01'`);

  const [pAmphoe] = await pool.query(`
    SELECT amphoe, COUNT(DISTINCT station_name) as stations,
      ROUND(AVG(pm25_value),2) as avg_pm25, ROUND(MAX(pm25_value),2) as max_pm25
    FROM tbl_pm25_monitoring WHERE recorded_at >= '2026-07-01' AND recorded_at < '2026-08-01'
    GROUP BY amphoe ORDER BY avg_pm25 DESC`);

  const [pExceed] = await pool.query(`
    SELECT station_name, amphoe, ROUND(MAX(pm25_value),2) as max_pm25, COUNT(*) as times, air_quality_status
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-07-01' AND recorded_at < '2026-08-01' AND pm25_value > 37.5
    GROUP BY station_name, amphoe, air_quality_status ORDER BY max_pm25 DESC LIMIT 10`);

  const [pStations] = await pool.query(`
    SELECT station_name, amphoe,
      ROUND(AVG(pm25_value),2) as avg_pm25, ROUND(MAX(pm25_value),2) as max_pm25, COUNT(*) as records
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-07-01' AND recorded_at < '2026-08-01'
    GROUP BY station_name, amphoe ORDER BY avg_pm25 DESC LIMIT 30`);

  const [pDaily] = await pool.query(`
    SELECT DATE(recorded_at) as day,
      ROUND(AVG(pm25_value),2) as avg_pm25, ROUND(MAX(pm25_value),2) as max_pm25, COUNT(*) as readings
    FROM tbl_pm25_monitoring WHERE recorded_at >= '2026-07-01' AND recorded_at < '2026-08-01'
    GROUP BY DATE(recorded_at) ORDER BY day`);

  const [cAll] = await pool.query(`
    SELECT ticket_id, state_name, problem_type, location, ticket_datetime, agency_status
    FROM tbl_complaints_monitoring ORDER BY recorded_at DESC LIMIT 20`);

  const [cByType] = await pool.query(`SELECT problem_type, COUNT(*) as cnt FROM tbl_complaints_monitoring GROUP BY problem_type ORDER BY cnt DESC`);
  const [cByStatus] = await pool.query(`SELECT state_name, COUNT(*) as cnt FROM tbl_complaints_monitoring GROUP BY state_name ORDER BY cnt DESC`);
  const [cTotal] = await pool.query(`SELECT COUNT(*) as cnt, SUM(CASE WHEN state_name='เสร็จสิ้น' THEN 1 ELSE 0 END) as done FROM tbl_complaints_monitoring`);

  const [wDaily] = await pool.query(`
    SELECT DATE(recorded_at) as day,
      ROUND(AVG(current_water_level_m),2) as avg_wl,
      ROUND(MAX(current_water_level_m),2) as max_wl,
      COUNT(DISTINCT station_name) as active_stations
    FROM tbl_water_disaster_monitoring
    WHERE recorded_at >= '2026-07-01' AND recorded_at < '2026-08-01'
    GROUP BY DATE(recorded_at) ORDER BY day`);

  await pool.end();

  // Convert dates to strings for JSON serialization
  const toStr = (arr) => arr.map(row => {
    const r = {};
    for (const [k, v] of Object.entries(row)) {
      r[k] = v instanceof Date ? v.toISOString().split('T')[0] : (v === null ? '' : String(v));
    }
    return r;
  });

  const data = {
    wStations: toStr(wStations),
    wTotal: String(wTotal[0].cnt),
    wDaily: toStr(wDaily),
    dLatest: toStr(dLatest),
    dDams: toStr(dDams),
    dTotal: String(dTotal[0].cnt),
    pStatus: toStr(pStatus),
    pTotal: { cnt: String(pTotal[0].cnt), stations: String(pTotal[0].stations) },
    pAmphoe: toStr(pAmphoe),
    pExceed: toStr(pExceed),
    pStations: toStr(pStations),
    pDaily: toStr(pDaily),
    cAll: toStr(cAll),
    cByType: toStr(cByType),
    cByStatus: toStr(cByStatus),
    cTotal: { cnt: String(cTotal[0].cnt), done: String(cTotal[0].done || 0) },
  };

  fs.writeFileSync('july2569_data.json', JSON.stringify(data, null, 2), 'utf8');
  console.log('✅ Exported july2569_data.json');
  console.log('Water stations:', wStations.length);
  console.log('Dams:', dDams.length);
  console.log('PM25 stations:', pTotal[0].stations);
}

exportData().catch(e => { console.error('❌', e.message); process.exit(1); });
