/*
 * Water Systems Database Complete Schema
 * Generated: 2026-09-02T08:56:19.521Z
 */

SET FOREIGN_KEY_CHECKS=0;

-- ----------------------------
-- Table structure for tbl_water_disaster_monitoring
-- ----------------------------
DROP TABLE IF EXISTS tbl_water_disaster_monitoring;
CREATE TABLE `tbl_water_disaster_monitoring` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `station_name` varchar(150) NOT NULL,
  `river` varchar(100) DEFAULT NULL,
  `amphoe` varchar(100) NOT NULL,
  `province` varchar(50) DEFAULT 'ลำปาง',
  `current_water_level_m` decimal(6,2) DEFAULT NULL,
  `left_bank_level_m` decimal(6,2) DEFAULT NULL,
  `bank_difference_m` decimal(6,2) DEFAULT NULL,
  `trend` varchar(50) DEFAULT NULL,
  `status` varchar(50) DEFAULT NULL,
  `current_rain_mm` decimal(5,2) DEFAULT NULL,
  `forecast_rain_24h_mm` decimal(5,2) DEFAULT NULL,
  `risk_level` varchar(50) DEFAULT NULL,
  `recorded_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_add` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `updated_add` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_amphoe` (`amphoe`),
  KEY `idx_risk_level` (`risk_level`),
  KEY `idx_station_recorded` (`station_name`,`recorded_at`),
  KEY `idx_recorded_at` (`recorded_at`)
) ENGINE=InnoDB AUTO_INCREMENT=40474 DEFAULT CHARSET=utf8mb4;

-- ----------------------------
-- Table structure for tbl_rainfall_monitoring
-- ----------------------------
DROP TABLE IF EXISTS tbl_rainfall_monitoring;
CREATE TABLE `tbl_rainfall_monitoring` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `station_name` varchar(150) NOT NULL,
  `location` varchar(150) DEFAULT NULL,
  `river_basin` varchar(100) DEFAULT NULL,
  `rain_mm` decimal(6,2) DEFAULT NULL,
  `rain_status` varchar(50) DEFAULT NULL,
  `measured_time` varchar(50) DEFAULT NULL,
  `record_date` varchar(100) DEFAULT NULL,
  `recorded_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_station` (`station_name`),
  KEY `idx_station_recorded` (`station_name`,`recorded_at`),
  KEY `idx_recorded_at` (`recorded_at`)
) ENGINE=InnoDB AUTO_INCREMENT=129064 DEFAULT CHARSET=utf8mb4;

-- ----------------------------
-- Table structure for tbl_drought_monitoring
-- ----------------------------
DROP TABLE IF EXISTS tbl_drought_monitoring;
CREATE TABLE `tbl_drought_monitoring` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `record_date` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'วันที่เก็บข้อมูลภาษาไทย',
  `recorded_at` datetime NOT NULL COMMENT 'เวลาที่เก็บบันทึก ISO',
  `dam_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'ประเภทอ่าง (ขนาดใหญ่/กลาง/เล็ก)',
  `dam_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'ชื่ออ่างเก็บน้ำ',
  `capacity_m_cum` decimal(12,4) DEFAULT NULL COMMENT 'ความจุ (ล้าน ลบ.ม.)',
  `inflow_m_cum` decimal(12,4) DEFAULT NULL COMMENT 'ปริมาณน้ำไหลลงอ่าง (ล้าน ลบ.ม.)',
  `water_volume_m_cum` decimal(12,4) DEFAULT NULL COMMENT 'ปริมาณน้ำในอ่าง (ล้าน ลบ.ม.)',
  `water_percent` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'เปอร์เซ็นต์น้ำ (%)',
  `usable_water_m_cum` decimal(12,4) DEFAULT NULL COMMENT 'ปริมาณน้ำใช้การ (ล้าน ลบ.ม.)',
  `discharge_m_cum` decimal(12,4) DEFAULT NULL COMMENT 'ปริมาณน้ำระบาย (ล้าน ลบ.ม.)',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dam_recorded` (`dam_name`,`recorded_at`),
  KEY `idx_recorded_at` (`recorded_at`)
) ENGINE=InnoDB AUTO_INCREMENT=49198 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Table structure for tbl_pm25_monitoring
-- ----------------------------
DROP TABLE IF EXISTS tbl_pm25_monitoring;
CREATE TABLE `tbl_pm25_monitoring` (
  `id` bigint(200) NOT NULL AUTO_INCREMENT,
  `record_date` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'วันที่เก็บข้อมูลภาษาไทย',
  `recorded_at` datetime NOT NULL COMMENT 'เวลาที่เก็บบันทึก ISO',
  `station_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'ชื่อสถานี',
  `tambon` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'ตำบล',
  `amphoe` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'อำเภอ',
  `province` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'ลำปาง',
  `time_label` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'เวลาในตาราง (เช่น 13:00 น.)',
  `pm25_value` decimal(6,2) DEFAULT NULL COMMENT 'ค่าฝุ่น PM 2.5 (µg/m³)',
  `pm25_avg_24h` decimal(6,2) DEFAULT NULL COMMENT 'ค่าเฉลี่ย 24 ชม. (µg/m³)',
  `air_quality_status` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'สถานะคุณภาพอากาศ',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_station_recorded` (`station_name`,`recorded_at`),
  KEY `idx_recorded_at` (`recorded_at`)
) ENGINE=InnoDB AUTO_INCREMENT=67429 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Table structure for tbl_complaints_monitoring
-- ----------------------------
DROP TABLE IF EXISTS tbl_complaints_monitoring;
CREATE TABLE `tbl_complaints_monitoring` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `ticket_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'หมายเลขใบงาน เช่น 2026-EDUNC2',
  `state_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `problem_type` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `photo_url` text COLLATE utf8mb4_unicode_ci COMMENT 'ลิงก์รูปภาพประกอบการแจ้ง',
  `location` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `org_name` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ticket_datetime` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `satisfaction_stars` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'คะแนนความพึงพอใจเป็นรูปดาว เช่น ⭐⭐⭐⭐⭐',
  `raw_timeline` json DEFAULT NULL COMMENT 'ข้อมูลประวัติประเด็น (Timeline) รูปแบบ JSON',
  `recorded_at` datetime NOT NULL COMMENT 'วันเวลาที่บันทึกลงฐานข้อมูล',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `agency_status` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ticket_id` (`ticket_id`)
) ENGINE=InnoDB AUTO_INCREMENT=673 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Table structure for tbl_alert_notifications
-- ----------------------------
DROP TABLE IF EXISTS tbl_alert_notifications;
CREATE TABLE `tbl_alert_notifications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `alert_type` enum('water','rainfall','drought','pm25','complaints') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'ประเภทวิกฤต',
  `alert_level` enum('info','warning','critical') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'ระดับความรุนแรง',
  `alert_title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'หัวข้อแจ้งเตือน',
  `alert_message` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'รายละเอียดแจ้งเตือน',
  `trigger_value` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `threshold_value` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'ค่าเกณฑ์ เช่น >100 ม.',
  `station_name` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'ชื่อสถานี/อ่าง/จุด',
  `recipients_sent` text COLLATE utf8mb4_unicode_ci COMMENT 'รายชื่อผู้รับ email (comma-separated)',
  `email_status` enum('sent','failed','skipped') COLLATE utf8mb4_unicode_ci DEFAULT 'skipped' COMMENT 'สถานะการส่ง',
  `email_error` text COLLATE utf8mb4_unicode_ci COMMENT 'ข้อความ error ถ้าส่งไม่สำเร็จ',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_alert_dedup` (`alert_type`,`station_name`,`email_status`,`created_at`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=2188 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Table structure for tbl_alert_recipients
-- ----------------------------
DROP TABLE IF EXISTS tbl_alert_recipients;
CREATE TABLE `tbl_alert_recipients` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'ชื่อ-นามสกุล',
  `position` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'ตำแหน่ง',
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'อีเมล',
  `alert_level_min` enum('info','warning','critical') COLLATE utf8mb4_unicode_ci DEFAULT 'warning' COMMENT 'ระดับขั้นต่ำที่รับแจ้ง',
  `is_active` tinyint(1) DEFAULT '1' COMMENT 'เปิด/ปิดการรับแจ้ง',
  `notify_water` tinyint(1) DEFAULT '1' COMMENT 'รับแจ้งเตือนน้ำ',
  `notify_drought` tinyint(1) DEFAULT '1' COMMENT 'รับแจ้งเตือนภัยแล้ง',
  `notify_pm25` tinyint(1) DEFAULT '1' COMMENT 'รับแจ้งเตือน PM2.5',
  `notify_complaints` tinyint(1) DEFAULT '1' COMMENT 'รับแจ้งเตือนร้องเรียน',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS=1;
