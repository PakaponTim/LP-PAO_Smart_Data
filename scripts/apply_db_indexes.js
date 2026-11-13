import 'dotenv/config';
import mysql from 'mysql2/promise';

async function applyIndexes() {
  console.log('🔄 เริ่มต้นตรวจสอบและเพิ่ม Database Indexes เพื่อเพิ่มประสิทธิภาพ...');
  
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || 'root',
    database: process.env.DB_NAME || 'water_systems',
    waitForConnections: true,
    connectionLimit: 5
  });

  const connection = await pool.getConnection();

  // Helper to check if index exists
  async function indexExists(table, indexName) {
    const [rows] = await connection.execute(
      `SELECT COUNT(1) as cnt FROM information_schema.statistics 
       WHERE table_schema = ? AND table_name = ? AND index_name = ?`,
      [process.env.DB_NAME || 'water_systems', table, indexName]
    );
    return rows[0].cnt > 0;
  }

  // Helper to add index safely
  async function addIndex(table, indexName, columnsSql) {
    const exists = await indexExists(table, indexName);
    if (exists) {
      console.log(`ℹ️ [${table}] Index '${indexName}' มีอยู่แล้ว (ข้าม)`);
      return;
    }
    console.log(`⚡ [${table}] กำลังสร้าง Index '${indexName}' (${columnsSql})...`);
    const startTime = Date.now();
    await connection.execute(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` (${columnsSql})`);
    console.log(`✅ [${table}] สร้าง Index '${indexName}' สำเร็จ (ใช้เวลา ${(Date.now() - startTime) / 1000}s)`);
  }

  try {
    // 1. tbl_water_disaster_monitoring (~40,000 rows)
    await addIndex('tbl_water_disaster_monitoring', 'idx_station_recorded', '`station_name`, `recorded_at`');
    await addIndex('tbl_water_disaster_monitoring', 'idx_recorded_at', '`recorded_at`');

    // 2. tbl_rainfall_monitoring (~128,000 rows)
    await addIndex('tbl_rainfall_monitoring', 'idx_station_recorded', '`station_name`, `recorded_at`');
    await addIndex('tbl_rainfall_monitoring', 'idx_recorded_at', '`recorded_at`');

    // 3. tbl_pm25_monitoring (~67,000 rows)
    await addIndex('tbl_pm25_monitoring', 'idx_station_recorded', '`station_name`, `recorded_at`');
    await addIndex('tbl_pm25_monitoring', 'idx_recorded_at', '`recorded_at`');

    // 4. tbl_drought_monitoring (~49,000 rows)
    await addIndex('tbl_drought_monitoring', 'idx_dam_recorded', '`dam_name`, `recorded_at`');
    await addIndex('tbl_drought_monitoring', 'idx_recorded_at', '`recorded_at`');

    // 5. tbl_alert_notifications (~2,000 rows)
    await addIndex('tbl_alert_notifications', 'idx_alert_dedup', '`alert_type`, `station_name`, `email_status`, `created_at`');
    await addIndex('tbl_alert_notifications', 'idx_created_at', '`created_at`');

    console.log('\n🎉 การทำ Indexing ทั้งหมดเสร็จสิ้นเรียบร้อย! ฐานข้อมูลพร้อมทำงานด้วยความเร็วสูงสุด');
  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาดในการสร้าง Index:', err.message);
  } finally {
    connection.release();
    await pool.end();
  }
}

applyIndexes();
