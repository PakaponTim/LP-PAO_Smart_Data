/**
 * db_setup_pm25.js
 * สร้างตาราง tbl_pm25_monitoring สำหรับเก็บข้อมูล PM 2.5
 */

import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'root',
  database: 'water_system2'
});

async function run() {
  console.log('🔄 เริ่มต้นสร้างตารางข้อมูล PM 2.5...');
  let connection;
  try {
    connection = await pool.getConnection();

    console.log('🏗️ กำลังตรวจสอบและสร้างตาราง tbl_pm25_monitoring...');
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS tbl_pm25_monitoring (
        id INT AUTO_INCREMENT PRIMARY KEY,
        record_date VARCHAR(100) NOT NULL COMMENT 'วันที่เก็บข้อมูลภาษาไทย',
        recorded_at DATETIME NOT NULL COMMENT 'เวลาที่เก็บบันทึก ISO',
        station_name VARCHAR(150) NOT NULL COMMENT 'ชื่อสถานี',
        tambon VARCHAR(100) COMMENT 'ตำบล',
        amphoe VARCHAR(100) NOT NULL COMMENT 'อำเภอ',
        province VARCHAR(50) DEFAULT 'ลำปาง',
        time_label VARCHAR(50) COMMENT 'เวลาในตาราง (เช่น 13:00 น.)',
        pm25_value DECIMAL(6,2) COMMENT 'ค่าฝุ่น PM 2.5 (µg/m³)',
        pm25_avg_24h DECIMAL(6,2) COMMENT 'ค่าเฉลี่ย 24 ชม. (µg/m³)',
        air_quality_status VARCHAR(100) COMMENT 'สถานะคุณภาพอากาศ',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    
    await connection.execute(createTableQuery);
    console.log('✅ ตาราง tbl_pm25_monitoring พร้อมใช้งานแล้ว!');

  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาดในการสร้างตาราง:', err.message);
  } finally {
    if (connection) connection.release();
    await pool.end();
    console.log('🔒 ปิดการเชื่อมต่อฐานข้อมูลเรียบร้อย');
  }
}

run();
