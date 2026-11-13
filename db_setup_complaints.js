/**
 * db_setup_complaints.js
 * สร้างตาราง tbl_complaints_monitoring สำหรับเก็บข้อมูลเรื่องร้องเรียนจาก Traffy Fondue
 */

import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'root',
  database: 'water_system2'
});

async function run() {
  console.log('🔄 เริ่มต้นสร้างตารางข้อมูลเรื่องร้องเรียน (Traffy)...');
  let connection;
  try {
    connection = await pool.getConnection();

    console.log('🏗️ กำลังตรวจสอบและสร้างตาราง tbl_complaints_monitoring...');
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS tbl_complaints_monitoring (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ticket_id VARCHAR(50) NOT NULL UNIQUE COMMENT 'หมายเลขใบงาน เช่น 2026-EDUNC2',
        state_name VARCHAR(100) NOT NULL COMMENT 'สถานะล่าสุด เช่น รอรับเรื่อง/เสร็จสิ้น',
        problem_type VARCHAR(100) COMMENT 'ประเภทปัญหา เช่น ถนน/ไฟฟ้า/ประปา',
        description TEXT COMMENT 'รายละเอียดปัญหา',
        photo_url TEXT COMMENT 'ลิงก์รูปภาพประกอบการแจ้ง',
        location VARCHAR(255) COMMENT 'พิกัดหรือที่อยู่ของปัญหา',
        org_name VARCHAR(150) COMMENT 'หน่วยงานที่รับผิดชอบ',
        ticket_datetime VARCHAR(100) COMMENT 'วันเวลาที่แจ้งเป็นข้อความ เช่น พฤหัส 21 พ.ค. 69 11:25 น.',
        satisfaction_stars VARCHAR(20) COMMENT 'คะแนนความพึงพอใจเป็นรูปดาว เช่น ⭐⭐⭐⭐⭐',
        raw_timeline JSON COMMENT 'ข้อมูลประวัติประเด็น (Timeline) รูปแบบ JSON',
        recorded_at DATETIME NOT NULL COMMENT 'วันเวลาที่บันทึกลงฐานข้อมูล',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    
    await connection.execute(createTableQuery);
    console.log('✅ ตาราง tbl_complaints_monitoring พร้อมใช้งานแล้ว!');

  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาดในการสร้างตาราง:', err.message);
  } finally {
    if (connection) connection.release();
    await pool.end();
    console.log('🔒 ปิดการเชื่อมต่อฐานข้อมูลเรียบร้อย');
  }
}

run();
