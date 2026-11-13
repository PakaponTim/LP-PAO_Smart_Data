/**
 * db_setup_notifications.js
 * สร้างตาราง tbl_alert_notifications + tbl_alert_recipients
 * สำหรับระบบแจ้งเตือนวิกฤตอัตโนมัติผ่าน E-mail
 */

import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'root',
  database: 'water_system2'
});

async function run() {
  console.log('🔄 เริ่มต้นสร้างตารางระบบแจ้งเตือนวิกฤต...');
  let connection;
  try {
    connection = await pool.getConnection();

    // 1. สร้างตาราง tbl_alert_notifications — เก็บประวัติการแจ้งเตือนทุกครั้ง
    console.log('🏗️ กำลังสร้างตาราง tbl_alert_notifications...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS tbl_alert_notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        alert_type ENUM('water','rainfall','drought','pm25','complaints') NOT NULL COMMENT 'ประเภทวิกฤต',
        alert_level ENUM('info','warning','critical') NOT NULL COMMENT 'ระดับความรุนแรง',
        alert_title VARCHAR(255) NOT NULL COMMENT 'หัวข้อแจ้งเตือน',
        alert_message TEXT NOT NULL COMMENT 'รายละเอียดแจ้งเตือน',
        trigger_value VARCHAR(100) COMMENT 'ค่าที่ทำให้แจ้งเตือน เช่น 120 ม.',
        threshold_value VARCHAR(100) COMMENT 'ค่าเกณฑ์ เช่น >100 ม.',
        station_name VARCHAR(150) COMMENT 'ชื่อสถานี/อ่าง/จุด',
        recipients_sent TEXT COMMENT 'รายชื่อผู้รับ email (comma-separated)',
        email_status ENUM('sent','failed','skipped') DEFAULT 'skipped' COMMENT 'สถานะการส่ง',
        email_error TEXT COMMENT 'ข้อความ error ถ้าส่งไม่สำเร็จ',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✅ ตาราง tbl_alert_notifications พร้อมใช้งานแล้ว!');

    // 2. สร้างตาราง tbl_alert_recipients — เก็บข้อมูลผู้รับการแจ้งเตือน
    console.log('🏗️ กำลังสร้างตาราง tbl_alert_recipients...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS tbl_alert_recipients (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL COMMENT 'ชื่อ-นามสกุล',
        position VARCHAR(100) NOT NULL COMMENT 'ตำแหน่ง',
        email VARCHAR(255) NOT NULL COMMENT 'อีเมล',
        alert_level_min ENUM('info','warning','critical') DEFAULT 'warning' COMMENT 'ระดับขั้นต่ำที่รับแจ้ง',
        is_active TINYINT(1) DEFAULT 1 COMMENT 'เปิด/ปิดการรับแจ้ง',
        notify_water TINYINT(1) DEFAULT 1 COMMENT 'รับแจ้งเตือนน้ำ',
        notify_drought TINYINT(1) DEFAULT 1 COMMENT 'รับแจ้งเตือนภัยแล้ง',
        notify_pm25 TINYINT(1) DEFAULT 1 COMMENT 'รับแจ้งเตือน PM2.5',
        notify_complaints TINYINT(1) DEFAULT 1 COMMENT 'รับแจ้งเตือนร้องเรียน',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✅ ตาราง tbl_alert_recipients พร้อมใช้งานแล้ว!');

    // 3. เพิ่มผู้รับเริ่มต้น 5 คน (ถ้ายังไม่มี)
    const [existingRecipients] = await connection.execute('SELECT COUNT(*) as count FROM tbl_alert_recipients');
    if (existingRecipients[0].count === 0) {
      console.log('📧 กำลังเพิ่มผู้รับแจ้งเตือนเริ่มต้น 5 คน...');
      const defaultRecipients = [
        ['นายก อบจ.ลำปาง', 'ผู้บริหารสั่งการสูงสุด', 'nayok@example.com', 'critical', 1, 1, 1, 1],
        ['ผู้บริหาร อบจ.ลำปาง', 'ระดับผู้บริหาร', 'executive@example.com', 'critical', 1, 1, 1, 1],
        ['นักวิชาการคอม (ร้องเรียน)', 'ดูแลเรื่องร้องเรียน', 'complaint-officer@example.com', 'warning', 1, 1, 1, 1],
        ['นักวิชาการคอม (หัวหน้า)', 'หัวหน้างาน', 'head-officer@example.com', 'warning', 1, 1, 1, 1],
        ['คน Monitor (ผู้ดูแลระบบ)', 'ผู้ดูแลระบบ', 'monitor@example.com', 'info', 1, 1, 1, 1]
      ];

      for (const r of defaultRecipients) {
        await connection.execute(
          `INSERT INTO tbl_alert_recipients (name, position, email, alert_level_min, notify_water, notify_drought, notify_pm25, notify_complaints)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          r
        );
      }
      console.log('✅ เพิ่มผู้รับแจ้งเตือนเริ่มต้น 5 คนสำเร็จ!');
    } else {
      console.log(`ℹ️ มีผู้รับแจ้งเตือนอยู่แล้ว ${existingRecipients[0].count} คน ข้ามการเพิ่มเริ่มต้น`);
    }

  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาดในการสร้างตาราง:', err.message);
  } finally {
    if (connection) connection.release();
    await pool.end();
    console.log('🔒 ปิดการเชื่อมต่อฐานข้อมูลเรียบร้อย');
  }
}

run();
