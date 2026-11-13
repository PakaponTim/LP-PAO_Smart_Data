import { createHash, randomUUID } from 'node:crypto';

export function numeric(value) {
  if (value === null || value === undefined || value === '' || value === '-') return null;
  const normalized = String(value).replace(/,/g, '').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}
const text = (value, max = 150) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const specifications = {
  water: { table: 'tbl_water_disaster_monitoring', columns: ['station_name','river','amphoe','province','current_water_level_m','left_bank_level_m','bank_difference_m','trend','status','current_rain_mm','forecast_rain_24h_mm','risk_level'], minimum: 14, name: 0,
    values: r => [text(r[0]),text(r[1],100),text(r[2],100),text(r[3],50),numeric(r[4]),numeric(r[5]),(numeric(r[5]) === null || numeric(r[4]) === null ? null : numeric(r[5]) - numeric(r[4])),text(r[7],50),text(r[8],50),numeric(r[10]),numeric(r[11]),text(r[13],50)] },
  drought: { table: 'tbl_drought_monitoring', columns: ['record_date','dam_type','dam_name','capacity_m_cum','inflow_m_cum','water_volume_m_cum','water_percent','usable_water_m_cum','discharge_m_cum'], minimum: 10, name: 3,
    values: r => [text(r[0],100),text(r[2],100),text(r[3],100),numeric(r[4]),numeric(r[5]),numeric(r[6]),text(String(r[7] ?? ''),20),numeric(r[8]),numeric(r[9])] },
  pm25: { table: 'tbl_pm25_monitoring', columns: ['record_date','station_name','tambon','amphoe','province','time_label','pm25_value','pm25_avg_24h','air_quality_status'], minimum: 10, name: 2,
    values: r => [text(r[0],100),text(r[2]),text(r[3],100),text(r[4],100),text(r[5],100)||'ลำปาง',text(r[6],50),numeric(r[7]),numeric(r[8]),text(r[9],100)] },
  rainfall: { table: 'tbl_rainfall_monitoring', columns: ['station_name','location','river_basin','rain_mm','rain_status','measured_time','record_date'],
    values: r => [text(r.station_name),text(r.location),text(r.river_basin,100),numeric(r.rain_mm),text(r.rain_status,50),text(r.measured_time,50),new Intl.DateTimeFormat('th-TH', { timeZone:'Asia/Bangkok',dateStyle:'long' }).format(new Date())] }
};
export function validateRows(kind, rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 10000) throw Object.assign(new Error('ต้องส่งข้อมูล 1–10,000 รายการ'), { status: 400 });
  const spec = specifications[kind];
  for (const row of rows) {
    const valid = kind === 'complaints' ? row && !Array.isArray(row) && typeof row.ticket_id === 'string' && row.ticket_id.length > 0 && row.ticket_id.length <= 50
      : kind === 'rainfall' ? row && !Array.isArray(row) && !!text(row.station_name)
      : spec && Array.isArray(row) && row.length >= spec.minimum && !!text(row[spec.name]);
    if (!valid) throw Object.assign(new Error('โครงสร้างข้อมูลไม่ถูกต้อง หรือไม่มีชื่อสถานี/รหัสเรื่อง'), { status: 400 });
  }
}

export function createIngestionRepository(pool, { fetchTimeline = async () => null, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  let initialized;
  async function ensureSchema() {
    if (!initialized) initialized = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS app_ingest_batches (
        batch_id VARCHAR(128) PRIMARY KEY, kind VARCHAR(20) NOT NULL, fingerprint CHAR(64) NOT NULL,
        row_count INT NOT NULL, committed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ingest_kind_time (kind, committed_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await pool.query(`CREATE TABLE IF NOT EXISTS app_complaint_events (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, ticket_id VARCHAR(50) NOT NULL,
        state_name VARCHAR(100), org_name TEXT, observed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        batch_id VARCHAR(128) NOT NULL, INDEX idx_ticket_time (ticket_id, observed_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    })().catch(error => { initialized = undefined; throw error; });
    return initialized;
  }
  async function prepareComplaints(rows) {
    const prepared = [];
    // No transaction or checked-out connection is held during remote requests.
    for (const complaint of rows) {
      const [existing] = await pool.execute('SELECT state_name, raw_timeline FROM tbl_complaints_monitoring WHERE ticket_id = ? LIMIT 1', [complaint.ticket_id]);
      const old = existing[0];
      let timeline = old?.raw_timeline || null;
      if (!old || (old.state_name !== 'เสร็จสิ้น' && (old.state_name !== complaint.state_name || !timeline))) {
        const value = await fetchTimeline(complaint.ticket_id);
        if (value) timeline = JSON.stringify(value);
      }
      prepared.push({ ...complaint, raw_timeline: timeline });
    }
    return prepared;
  }
  async function write(kind, rows, key = randomUUID()) {
    validateRows(kind, rows);
    const batchId = `${kind}:${key}`;
    if (batchId.length > 128 || !/^[\w:.-]+$/.test(batchId)) throw Object.assign(new Error('รหัสรอบข้อมูลไม่ถูกต้อง'), { status: 400 });
    const fingerprint = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    await ensureSchema();
    const prepared = kind === 'complaints' ? await prepareComplaints(rows) : rows;
    for (let attempt = 0; attempt < 3; attempt++) {
      let connection;
      try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        // A unique ledger row is committed atomically with the data. Retrying an
        // uncertain commit cannot add the same batch twice, even after restart.
        await connection.execute('INSERT INTO app_ingest_batches (batch_id,kind,fingerprint,row_count) VALUES (?,?,?,?)', [batchId, kind, fingerprint, rows.length]);
        if (kind === 'complaints') {
          for (const row of prepared) {
            const [existing] = await connection.execute('SELECT state_name, org_name FROM tbl_complaints_monitoring WHERE ticket_id = ? FOR UPDATE', [row.ticket_id]);
            const isPao = /อบจ\.ลำปาง|องค์การบริหารส่วนจังหวัดลำปาง/.test(row.org_name || '');
            const state = row.state_name || '';
            let agency = isPao ? 'งานที่เป็นสถานะอื่นๆ' : 'สถานะอื่นๆ ของหน่วยงาน';
            if (/รอรับเรื่อง/.test(state)) agency = isPao ? 'งานที่รับเรื่องร้องเรียน' : 'อบจ.รับมอบหมายงาน';
            else if (/ส่งต่อ/.test(state)) agency = isPao ? 'งานส่งต่อ' : 'ส่งต่อให้หน่วยงานอื่นดำเนินการ';
            else if (/เสร็จสิ้น/.test(state)) agency = isPao ? 'งานที่ อบจ.ดำเนินการเสร็จ' : 'หน่วยงานอื่นดำเนินการเสร็จ';
            else if (/กำลังดำเนินการ/.test(state) || /ถูกติดตาม/.test(state)) agency = isPao ? 'งานที่ อบจ.กำลังดำเนินการ' : 'หน่วยงานอื่นกำลังดำเนินการ';
            else if (/รับมอบ/.test(state)) agency = isPao ? 'สถานะรับมอบจากหน่วยงานอื่นๆ' : 'สถานะที่หน่วยงานรับมอบจาก อบจ.ลำปาง';
            const columns = ['ticket_id','state_name','problem_type','description','photo_url','location','org_name','ticket_datetime','satisfaction_stars','raw_timeline','is_in_scope'];
            const rowWithScope = { ...row, is_in_scope: row.is_in_scope ?? 1 };
            const values = columns.map(c => rowWithScope[c] ?? null);
            await connection.execute(`INSERT INTO tbl_complaints_monitoring (${columns.join(',')},agency_status,recorded_at) VALUES (${columns.map(() => '?').join(',')},?,NOW()) ON DUPLICATE KEY UPDATE ${columns.slice(1).map(c => `${c}=VALUES(${c})`).join(',')},agency_status=VALUES(agency_status),recorded_at=NOW()`, [...values, agency]);
            if (!existing[0] || existing[0].state_name !== row.state_name || existing[0].org_name !== row.org_name) await connection.execute('INSERT INTO app_complaint_events (ticket_id,state_name,org_name,batch_id) VALUES (?,?,?,?)', [row.ticket_id, row.state_name || null, row.org_name || null, batchId]);
          }
        } else {
          const spec = specifications[kind];
          for (let offset = 0; offset < rows.length; offset += 250) {
            const batch = rows.slice(offset, offset + 250).map(spec.values);
            const placeholders = batch.map(() => `(${spec.columns.map(() => '?').join(',')},NOW())`).join(',');
            await connection.query(`INSERT INTO ${spec.table} (${spec.columns.join(',')},recorded_at) VALUES ${placeholders}`, batch.flat());
          }
        }
        await connection.commit();
        return { batchId, count: rows.length, duplicate: false };
      } catch (error) {
        if (connection) { try { await connection.rollback(); } catch {} connection.release(); connection = null; }
        if (error.code === 'ER_DUP_ENTRY') {
          const [previous] = await pool.execute('SELECT fingerprint,row_count FROM app_ingest_batches WHERE batch_id = ?', [batchId]);
          if (previous[0]?.fingerprint === fingerprint) return { batchId, count: previous[0].row_count, duplicate: true };
          if (previous[0]) throw Object.assign(new Error('รหัสรอบนี้ถูกใช้กับข้อมูลอื่นแล้ว'), { status: 409 });
        }
        if (attempt < 2 && ['ECONNREFUSED','PROTOCOL_CONNECTION_LOST','ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT','ETIMEDOUT','ECONNRESET'].includes(error.code)) { await sleep(500 * (2 ** attempt)); continue; }
        throw error;
      } finally { if (connection) connection.release(); }
    }
  }
  return { write, ensureSchema };
}
