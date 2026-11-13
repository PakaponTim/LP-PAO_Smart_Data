import mysql from 'mysql2/promise';

async function check() {
  const pool = mysql.createPool({ host: 'localhost', user: 'root', password: 'root', database: 'water_systems', connectionLimit: 3 });
  
  const [w] = await pool.query(`SELECT MIN(recorded_at) as minD, MAX(recorded_at) as maxD, COUNT(*) as cnt FROM tbl_water_disaster_monitoring WHERE recorded_at >= '2026-07-01' AND recorded_at < '2026-08-01'`);
  console.log('Water July:', JSON.stringify(w[0]));
  
  const [d] = await pool.query(`SELECT MIN(recorded_at) as minD, MAX(recorded_at) as maxD, COUNT(*) as cnt FROM tbl_drought_monitoring WHERE recorded_at >= '2026-07-01' AND recorded_at < '2026-08-01'`);
  console.log('Drought July:', JSON.stringify(d[0]));
  
  const [p] = await pool.query(`SELECT MIN(recorded_at) as minD, MAX(recorded_at) as maxD, COUNT(*) as cnt FROM tbl_pm25_monitoring WHERE recorded_at >= '2026-07-01' AND recorded_at < '2026-08-01'`);
  console.log('PM25 July:', JSON.stringify(p[0]));
  
  const [c] = await pool.query(`SELECT MIN(recorded_at) as minD, MAX(recorded_at) as maxD, COUNT(*) as cnt FROM tbl_complaints_monitoring WHERE recorded_at >= '2026-07-01' AND recorded_at < '2026-08-01'`);
  console.log('Complaints July:', JSON.stringify(c[0]));
  
  const [cAll] = await pool.query(`SELECT MIN(recorded_at) as minD, MAX(recorded_at) as maxD, COUNT(*) as cnt FROM tbl_complaints_monitoring`);
  console.log('Complaints All:', JSON.stringify(cAll[0]));
  
  // Check risk levels for water July
  const [wRisk] = await pool.query(`SELECT risk_level, COUNT(DISTINCT station_name) as stations FROM tbl_water_disaster_monitoring WHERE recorded_at >= '2026-07-01' AND recorded_at < '2026-08-01' GROUP BY risk_level`);
  console.log('Water Risk July:', JSON.stringify(wRisk));
  
  // Check dam type breakdown
  const [dType] = await pool.query(`SELECT dam_type, COUNT(DISTINCT dam_name) as cnt FROM tbl_drought_monitoring WHERE recorded_at >= '2026-07-01' AND recorded_at < '2026-08-01' GROUP BY dam_type`);
  console.log('Drought type July:', JSON.stringify(dType));
  
  // Check PM25 stations
  const [pSt] = await pool.query(`SELECT COUNT(DISTINCT station_name) as stations FROM tbl_pm25_monitoring WHERE recorded_at >= '2026-07-01' AND recorded_at < '2026-08-01'`);
  console.log('PM25 Stations July:', JSON.stringify(pSt[0]));
  
  await pool.end();
}

check().catch(e => { console.error(e.message); process.exit(1); });
