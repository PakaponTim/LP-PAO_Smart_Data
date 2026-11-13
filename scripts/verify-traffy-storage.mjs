// Inspect the latest real complaint ingestion without changing production data.
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

const directory = process.env.WATER_DATA_DIR || process.cwd();
const connection = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root', password: process.env.DB_PASS || 'root',
  database: process.env.DB_NAME || 'water_systems', connectTimeout: 5000
});
try {
  const [batches] = await connection.execute(
    "SELECT batch_id,row_count,DATE_FORMAT(committed_at,'%Y-%m-%d %H:%i:%s') AS committed_at FROM app_ingest_batches WHERE kind=? ORDER BY committed_at DESC LIMIT 3", ['complaints']);
  const [counts] = await connection.query('SELECT COUNT(*) AS rows_total, COUNT(DISTINCT ticket_id) AS unique_tickets FROM tbl_complaints_monitoring');
  const outbox = JSON.parse(await fs.readFile(path.join(directory, 'runtime', 'excel-outbox.json'), 'utf8'));
  console.log(JSON.stringify({
    batches,
    counts: counts[0],
    latestBackup: batches[0] ? outbox.jobs.filter(job => job.id === batches[0].batch_id).map(({id,status,updatedAt}) => ({id,status,updatedAt})) : [],
    pendingComplaintBackups: outbox.jobs.filter(job => job.kind === 'complaints' && job.status !== 'saved').length
  }, null, 2));
} finally {
  await connection.end();
}
