/**
 * db_setup.js
 * 1. ล้างข้อมูลที่บันทึกผิดประเภทใน tbl_water_disaster_monitoring
 * 2. สร้างตาราง tbl_drought_monitoring สำหรับจัดเก็บข้อมูลภัยแล้ง/อ่างเก็บน้ำโดยเฉพาะ
 */

import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'root',
  database: 'water_system2'
});

async function run() {
  console.log('🔄 เริ่มต้นปรับปรุงฐานข้อมูล...');
  let connection;
  try {
    connection = await pool.getConnection();

    // 1. ลบแถวข้อมูลระดับน้ำที่ผิดพลาด (เกิดจากการดึงข้อมูลอ่างเก็บน้ำเข้าตารางระดับน้ำ)
    // ข้อมูลที่ผิดพลาดจะมีคำว่า "พฤษภาคม" หรือปี พ.ศ. เช่น "2569" ในคอลัมน์ station_name
    console.log('🧹 กำลังทำความสะอาดข้อมูลที่ผิดพลาดใน tbl_water_disaster_monitoring...');
    const [deleteResult] = await connection.execute(`
      DELETE FROM tbl_water_disaster_monitoring 
      WHERE station_name LIKE '%พฤษภาคม%' 
         OR station_name LIKE '%2569%'
         OR station_name LIKE '%มกราคม%'
         OR station_name LIKE '%กุมภาพันธ์%'
         OR station_name LIKE '%มีนาคม%'
         OR station_name LIKE '%เมษายน%'
         OR station_name LIKE '%มิถุนายน%'
         OR station_name LIKE '%กรกฎาคม%'
         OR station_name LIKE '%สิงหาคม%'
         OR station_name LIKE '%กันยายน%'
         OR station_name LIKE '%ตุลาคม%'
         OR station_name LIKE '%พฤศจิกายน%'
         OR station_name LIKE '%ธันวาคม%'
    `);
    console.log(`✅ ทำความสะอาดสำเร็จ! ลบแถวที่ผิดพลาดทั้งหมด: ${deleteResult.affectedRows} แถว`);

    // 2. สร้างตาราง tbl_drought_monitoring
    console.log('🏗️ กำลังตรวจสอบและสร้างตาราง tbl_drought_monitoring สำหรับข้อมูลภัยแล้ง...');
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS tbl_drought_monitoring (
        id INT AUTO_INCREMENT PRIMARY KEY,
        record_date VARCHAR(100) NOT NULL COMMENT 'วันที่เก็บข้อมูลภาษาไทย',
        recorded_at DATETIME NOT NULL COMMENT 'เวลาที่เก็บบันทึก ISO',
        dam_type VARCHAR(100) COMMENT 'ประเภทอ่าง (ขนาดใหญ่/กลาง/เล็ก)',
        dam_name VARCHAR(100) NOT NULL COMMENT 'ชื่ออ่างเก็บน้ำ',
        capacity_m_cum DECIMAL(12,4) COMMENT 'ความจุ (ล้าน ลบ.ม.)',
        inflow_m_cum DECIMAL(12,4) COMMENT 'ปริมาณน้ำไหลลงอ่าง (ล้าน ลบ.ม.)',
        water_volume_m_cum DECIMAL(12,4) COMMENT 'ปริมาณน้ำในอ่าง (ล้าน ลบ.ม.)',
        water_percent VARCHAR(20) COMMENT 'เปอร์เซ็นต์น้ำ (%)',
        usable_water_m_cum DECIMAL(12,4) COMMENT 'ปริมาณน้ำใช้การ (ล้าน ลบ.ม.)',
        discharge_m_cum DECIMAL(12,4) COMMENT 'ปริมาณน้ำระบาย (ล้าน ลบ.ม.)',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    
    await connection.execute(createTableQuery);
    console.log('✅ ตาราง tbl_drought_monitoring พร้อมใช้งานแล้ว!');

  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาดในการรันสคริปต์:', err.message);
  } finally {
    if (connection) connection.release();
    await pool.end();
    console.log('🔒 ปิดการเชื่อมต่อฐานข้อมูลเรียบร้อย');
  }
}

run();
