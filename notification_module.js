/**
 * notification_module.js
 * ระบบแจ้งเตือนวิกฤตอัตโนมัติผ่าน E-mail
 * Module แยก — ไม่กระทบโครงสร้าง server.js เดิม
 * 
 * ฟังก์ชันหลัก:
 * - evaluateWaterAlerts()    → ตรวจเกณฑ์ระดับน้ำ + ปริมาณฝน
 * - evaluateDroughtAlerts()  → ตรวจเกณฑ์ภัยแล้ง/ปริมาตรน้ำกักเก็บ
 * - evaluatePM25Alerts()     → ตรวจเกณฑ์ PM 2.5
 * - evaluateComplaintAlerts()→ ตรวจเกณฑ์เรื่องร้องเรียน
 * - sendAlertEmails()        → ส่ง email ตามระดับแจ้งเตือน
 * - checkAndNotify()         → ฟังก์ชันหลักที่ query + evaluate + send + log
 */

import 'dotenv/config';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// 📊 THRESHOLD CONFIGURATIONS (เกณฑ์การแจ้งเตือน)
// ============================================================

const THRESHOLDS = {
  // ระดับน้ำ (เทียบตลิ่ง)
  water: {
    critical_high: 100,   // น้ำล้นตลิ่ง >100
    warning_high: 70,     // น้ำมาก >70-100
    normal_high: 30,      // น้ำปกติ >30-70
    warning_low: 10,      // น้ำน้อย <=10 (วิกฤตน้ำน้อย)
  },
  // ปริมาณฝน (มม.)
  rainfall: {
    critical: 90,         // หนักมาก >90
    warning: 35,          // หนัก >35-90
  },
  // ภัยแล้ง - ปริมาตรน้ำกักเก็บ (%)
  drought: {
    critical_low: 30,     // วิกฤต <=30%
    warning_low: 50,      // เฝ้าระวัง 31-50%
    critical_high: 100,   // น้ำเกิน >100%
  },
  // PM 2.5 (µg/m³)
  pm25: {
    critical: 75.1,       // มีผลกระทบต่อสุขภาพ >75.1
    warning: 37.6,        // เริ่มมีผลต่อสุขภาพ 37.6-75.0
  },
  // เรื่องร้องเรียน (จำนวน/วัน)
  complaints: {
    critical_per_day: 20, // วิกฤต >=20 เรื่อง/วัน
    warning_per_day: 10,  // เฝ้าระวัง >=10 เรื่อง/วัน
    overdue_days: 30,     // ค้างนานเกิน 30 วัน
  }
};

// Alert level hierarchy for comparison
const LEVEL_PRIORITY = { 'info': 1, 'warning': 2, 'critical': 3 };

// Cooldown tracking (prevent duplicate alerts)
const DEFAULT_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours


// ============================================================
// 🔍 ALERT EVALUATION FUNCTIONS
// ============================================================

/**
 * ตรวจเกณฑ์ระดับน้ำ
 * @param {Array} waterRows - ข้อมูลล่าสุดจาก tbl_water_disaster_monitoring
 * @returns {Array} alerts
 */
export function evaluateWaterAlerts(waterRows) {
  const alerts = [];
  
  for (const row of waterRows) {
    const stationName = row.station_name || 'ไม่ทราบสถานี';
    const waterLevel = parseFloat(row.current_water_level_m);
    const leftBank = parseFloat(row.left_bank_level_m);
    const bankDiff = parseFloat(row.bank_difference_m);
    const status = (row.status || '').trim();

    // ข้ามสถานีที่เป็น 'น้ำปกติ', 'น้ำน้อย', 'ไม่มีข้อมูล' หรือไม่มีสถานะ
    if (!status || status === 'น้ำปกติ' || status === 'น้ำน้อย' || status === 'ไม่มีข้อมูล') {
      continue;
    }

    // แปลงความหมายให้เข้าใจง่ายขึ้น แทนที่จะใช้ ม.รทก.
    let diffText = `${waterLevel || '-'} ม.รทก.`;
    const hasValidBankInfo = Number.isFinite(leftBank) && leftBank > 0 && Number.isFinite(bankDiff);
    if (hasValidBankInfo) {
      if (bankDiff < 0) {
        diffText = `ล้นตลิ่ง`;
      } else if (bankDiff === 0) {
        diffText = `ปริ่มตลิ่งพอดี`;
      } else {
        diffText = `ต่ำกว่าตลิ่ง`;
      }
    }

    // 1. ระดับวิกฤต (🚨 CRITICAL) — น้ำล้นตลิ่ง (>100%) หรือ น้ำน้อยวิกฤต (<=10%)
    // ป้องกัน False Alarm: เช็ค bankDiff <= 0 เฉพาะเมื่อมีข้อมูลระดับตลิ่งที่ถูกต้องจริง (leftBank > 0)
    const isOverflowByDiff = hasValidBankInfo && bankDiff <= 0;
    const isCriticalStatus = status.includes('ล้นตลิ่ง') || status.includes('น้ำน้อยวิกฤต');

    if (isCriticalStatus || isOverflowByDiff) {
      const isLow = status.includes('น้ำน้อย');
      alerts.push({
        type: 'water',
        level: 'critical',
        title: isLow ? `🚨 น้ำน้อยวิกฤต (≤10% ความจุลำน้ำ): ${stationName}` : `🚨 น้ำล้นตลิ่ง (>100% ความจุลำน้ำ): ${stationName}`,
        message: `ระดับน้ำ ${waterLevel || '-'} ม.รทก. (${isLow ? 'น้ำน้อยวิกฤต' : 'ล้นตลิ่ง'} - ${hasValidBankInfo ? `ต่ำกว่าตลิ่ง ${bankDiff} ม.` : 'ไม่มีข้อมูลระดับตลิ่ง'})`,
        triggerValue: isLow ? `🚨 น้ำน้อยวิกฤต (${diffText})` : `🚨 น้ำล้นตลิ่ง (${diffText})`,
        thresholdValue: isLow ? `≤10% ความจุลำน้ำ` : `>100% ความจุลำน้ำ`,
        stationName
      });
    } 
    // 2. ระดับเฝ้าระวัง (⚠️ WARNING) — น้ำมาก (>70-100% ความจุลำน้ำ เสี่ยงน้ำท่วม)
    else if (status.includes('น้ำมาก') || status.includes('เฝ้าระวัง') || status.includes('เตือนภัย')) {
      alerts.push({
        type: 'water',
        level: 'warning',
        title: `⚠️ น้ำมาก (>70-100% ความจุลำน้ำ): ${stationName}`,
        message: `ระดับน้ำ ${waterLevel || '-'} ม.รทก. (เกณฑ์น้ำมากเฝ้าระวัง - ${hasValidBankInfo ? `ต่ำกว่าตลิ่ง ${bankDiff} ม.` : 'ไม่มีข้อมูลระดับตลิ่ง'})`,
        triggerValue: `⚠️ น้ำมากเฝ้าระวัง (${diffText})`,
        thresholdValue: `>70-100% ความจุลำน้ำ`,
        stationName
      });
    }
  }
  
  return alerts;
}

/**
 * ตรวจเกณฑ์น้ำฝน
 * @param {Array} rainfallRows - ข้อมูลล่าสุดจาก tbl_rainfall_monitoring
 * @returns {Array} alerts
 */
export function evaluateRainfallAlerts(rainfallRows) {
  const alerts = [];
  
  for (const row of rainfallRows) {
    const stationName = row.station_name || 'ไม่ทราบสถานี';
    const rainMM = parseFloat(row.rain_mm);
    
    if (isNaN(rainMM)) continue;
    
    if (rainMM > THRESHOLDS.rainfall.critical) {
      alerts.push({
        type: 'rainfall',
        level: 'critical',
        title: `🚨 ฝนตกหนักมาก: ${stationName}`,
        message: `ปริมาณฝนสะสม ${rainMM.toFixed(1)} มม. เกินเกณฑ์ฝนหนักมาก (>${THRESHOLDS.rainfall.critical} มม.)`,
        triggerValue: `🚨 ฝนตกหนักมาก (${rainMM.toFixed(1)} มม.)`,
        thresholdValue: `อันตราย / >${THRESHOLDS.rainfall.critical} มม.`,
        stationName
      });
    } else if (rainMM > THRESHOLDS.rainfall.warning) {
      alerts.push({
        type: 'rainfall',
        level: 'warning',
        title: `⚠️ ฝนตกหนัก: ${stationName}`,
        message: `ปริมาณฝนสะสม ${rainMM.toFixed(1)} มม. อยู่ในเกณฑ์ฝนหนัก (>${THRESHOLDS.rainfall.warning}–${THRESHOLDS.rainfall.critical} มม.)`,
        triggerValue: `⚠️ ฝนตกหนัก (${rainMM.toFixed(1)} มม.)`,
        thresholdValue: `เฝ้าระวัง / >${THRESHOLDS.rainfall.warning} มม.`,
        stationName
      });
    }
  }
  
  return alerts;
}

/**
 * ตรวจเกณฑ์ภัยแล้ง
 * @param {Array} droughtRows - ข้อมูลล่าสุดจาก tbl_drought_monitoring
 * @returns {Array} alerts
 */
export function evaluateDroughtAlerts(droughtRows) {
  const alerts = [];
  
  for (const row of droughtRows) {
    const damName = row.dam_name || 'ไม่ทราบอ่าง';
    const percentStr = (row.water_percent || '').replace('%', '').trim();
    const percent = parseFloat(percentStr);
    
    if (isNaN(percent)) continue;
    
    if (percent > THRESHOLDS.drought.critical_high) {
      alerts.push({
        type: 'drought',
        level: 'critical',
        title: `🚨 น้ำเกินความจุ: ${damName}`,
        message: `ปริมาตรน้ำกักเก็บ ${percent}% เกินความจุอ่าง (>${THRESHOLDS.drought.critical_high}%) อาจเกิดน้ำล้นสันเขื่อน`,
        triggerValue: `🚨 น้ำล้นสันเขื่อน (กักเก็บ ${percent}%)`,
        thresholdValue: `เกินความจุ / >${THRESHOLDS.drought.critical_high}%`,
        stationName: damName
      });
    } else if (percent <= THRESHOLDS.drought.critical_low) {
      alerts.push({
        type: 'drought',
        level: 'critical',
        title: `🚨 ภัยแล้งวิกฤต: ${damName}`,
        message: `ปริมาตรน้ำกักเก็บเหลือเพียง ${percent}% ต่ำกว่าเกณฑ์วิกฤต (≤${THRESHOLDS.drought.critical_low}%)`,
        triggerValue: `🚨 น้ำกักเก็บน้อยวิกฤต (เหลือ ${percent}%)`,
        thresholdValue: `แห้งวิกฤต / ≤${THRESHOLDS.drought.critical_low}%`,
        stationName: damName
      });
    } else if (percent <= THRESHOLDS.drought.warning_low) {
      alerts.push({
        type: 'drought',
        level: 'warning',
        title: `⚠️ ภัยแล้งเฝ้าระวัง: ${damName}`,
        message: `ปริมาตรน้ำกักเก็บ ${percent}% อยู่ในเกณฑ์เฝ้าระวัง (${THRESHOLDS.drought.critical_low + 1}–${THRESHOLDS.drought.warning_low}%)`,
        triggerValue: `⚠️ น้ำกักเก็บอยู่ในเกณฑ์ต่ำ (เหลือ ${percent}%)`,
        thresholdValue: `เฝ้าระวัง / ≤${THRESHOLDS.drought.warning_low}%`,
        stationName: damName
      });
    }
  }
  
  return alerts;
}

/**
 * ตรวจเกณฑ์ PM 2.5
 * @param {Array} pm25Rows - ข้อมูลล่าสุดจาก tbl_pm25_monitoring
 * @returns {Array} alerts
 */
export function evaluatePM25Alerts(pm25Rows) {
  const alerts = [];
  
  for (const row of pm25Rows) {
    const stationName = row.station_name || 'ไม่ทราบสถานี';
    const amphoe = row.amphoe || '';
    const rawVal = row.pm25_value !== null && row.pm25_value !== undefined ? parseFloat(row.pm25_value) : NaN;
    const rawAvg = row.pm25_avg_24h !== null && row.pm25_avg_24h !== undefined ? parseFloat(row.pm25_avg_24h) : NaN;
    const pm25Val = Number.isFinite(rawVal) ? rawVal : rawAvg;
    
    if (isNaN(pm25Val)) continue;
    
    const displayName = amphoe ? `${stationName} (${amphoe})` : stationName;
    
    if (pm25Val >= THRESHOLDS.pm25.critical) {
      alerts.push({
        type: 'pm25',
        level: 'critical',
        title: `🚨 PM 2.5 มีผลกระทบต่อสุขภาพ: ${displayName}`,
        message: `ค่า PM 2.5 = ${pm25Val.toFixed(1)} µg/m³ เกินเกณฑ์อันตราย (≥${THRESHOLDS.pm25.critical} µg/m³) ที่ ${displayName}`,
        triggerValue: `🚨 มีผลกระทบต่อสุขภาพ (${pm25Val.toFixed(1)} µg/m³)`,
        thresholdValue: `เกณฑ์อันตราย / ≥${THRESHOLDS.pm25.critical} µg/m³`,
        stationName: displayName
      });
    } else if (pm25Val >= THRESHOLDS.pm25.warning) {
      alerts.push({
        type: 'pm25',
        level: 'warning',
        title: `⚠️ PM 2.5 เริ่มมีผลต่อสุขภาพ: ${displayName}`,
        message: `ค่า PM 2.5 = ${pm25Val.toFixed(1)} µg/m³ อยู่ในเกณฑ์เฝ้าระวัง (${THRESHOLDS.pm25.warning}–${THRESHOLDS.pm25.critical} µg/m³) ที่ ${displayName}`,
        triggerValue: `⚠️ เริ่มมีผลต่อสุขภาพ (${pm25Val.toFixed(1)} µg/m³)`,
        thresholdValue: `เริ่มมีผล / ≥${THRESHOLDS.pm25.warning} µg/m³`,
        stationName: displayName
      });
    }
  }
  
  return alerts;
}

/**
 * ตรวจสถานะรายเรื่องร้องเรียน (Traffy Fondue)
 * @param {Array} complaintRows - ข้อมูลล่าสุดจาก tbl_complaints_monitoring
 * @returns {Array} alerts
 */
export function evaluateIndividualComplaints(complaintRows) {
  const alerts = [];
  
  for (const row of complaintRows) {
    const ticketId = row.ticket_id || 'ไม่ทราบเลขรับแจ้ง';
    const stateName = (row.state_name || 'รอรับเรื่อง').trim();
    const problemType = row.problem_type || 'ทั่วไป';
    let orgName = (row.org_name || 'ไม่มีหน่วยงานรับผิดชอบ').trim();
    if (orgName.length > 40) orgName = orgName.substring(0, 40) + '...';
    
    const desc = row.description ? (row.description.length > 60 ? row.description.substring(0, 60) + '...' : row.description) : 'ไม่มีรายละเอียด';
    
    let level = 'info';
    let titlePrefix = 'ℹ️ อัปเดตเรื่องร้องเรียน';
    
    if (stateName === 'เสร็จสิ้น' || stateName === 'ปิดงาน') {
      level = 'info'; // Use info or success (mapped to info for now)
      titlePrefix = '✅ แก้ไขเสร็จสิ้น';
    } else if (stateName === 'ติดตามเรื่อง') {
      level = 'warning';
      titlePrefix = '🔄 ส่งต่อ/ติดตามเรื่อง';
    } else if (stateName === 'รับเรื่อง') {
      level = 'warning';
      titlePrefix = '📢 รับเรื่องร้องเรียน';
    } else {
      level = 'critical'; // New or unhandled (รอรับเรื่อง)
      titlePrefix = '🚨 เรื่องร้องเรียนใหม่';
    }

    alerts.push({
      type: 'complaints',
      level: level,
      title: `${titlePrefix}: ${problemType}`,
      message: `เลขที่: ${ticketId}<br>สถานะ: ${stateName}<br>หน่วยงาน: ${orgName}<br>รายละเอียด: ${desc}`,
      triggerValue: `${stateName}|${orgName}`, // Deduplication Key: state + agency
      thresholdValue: `แจ้งเตือนเมื่อเปลี่ยนสถานะ/ส่งต่อ`,
      stationName: ticketId // Use ticket ID as the unique key
    });
  }
  
  return alerts;
}


// ============================================================
// 📧 EMAIL FUNCTIONS
// ============================================================

/**
 * สร้าง Transporter ตาม SMTP config
 */
function createTransporter(smtpConfig) {
  const cleanUser = (smtpConfig?.user || process.env.SMTP_USER || '').trim();
  const cleanPass = (smtpConfig?.pass || process.env.SMTP_PASS || '').replace(/\s+/g, '');

  return nodemailer.createTransport({
    host: smtpConfig?.host || process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(smtpConfig?.port || process.env.SMTP_PORT) || 587,
    secure: (smtpConfig?.port || process.env.SMTP_PORT) == 465, // true for 465, false for 587/other
    auth: {
      user: cleanUser,
      pass: cleanPass
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    tls: {
      rejectUnauthorized: true
    }
  });
}


/**
 * สร้าง HTML Email Template
 */
function buildEmailHTML(alert) {
  const levelColors = {
    critical: { bg: '#DC2626', badge: '🚨 วิกฤต (CRITICAL)', headerBg: '#7F1D1D' },
    warning: { bg: '#F59E0B', badge: '⚠️ เฝ้าระวัง (WARNING)', headerBg: '#78350F' },
    info: { bg: '#3B82F6', badge: 'ℹ️ แจ้งทราบ (INFO)', headerBg: '#1E3A5F' }
  };
  
  const typeLabels = {
    water: '🌊 ระดับน้ำ',
    rainfall: '🌧️ ปริมาณฝน',
    drought: '🏜️ ภัยแล้ง',
    pm25: '💨 PM 2.5',
    complaints: '📢 เรื่องร้องเรียน'
  };
  
  const lc = levelColors[alert.level] || levelColors.info;
  const typeLabel = typeLabels[alert.type] || alert.type;
  
  const now = new Date();
  const thaiDate = now.toLocaleDateString('th-TH', { 
    year: 'numeric', month: 'long', day: 'numeric', 
    hour: '2-digit', minute: '2-digit' 
  });
  
  return `
<!DOCTYPE html>
<html lang="th">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f1f5f9;">
  <div style="max-width:600px;margin:20px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    
    <!-- Header -->
    <div style="background:${lc.headerBg};padding:24px 32px;text-align:center;">
      <h1 style="color:#ffffff;font-size:18px;margin:0 0 4px 0;">🔔 ระบบแจ้งเตือนวิกฤตอัตโนมัติ</h1>
      <p style="color:#d1d5db;font-size:12px;margin:0;">องค์การบริหารส่วนจังหวัดลำปาง (อบจ.ลำปาง)</p>
    </div>
    
    <!-- Alert Badge -->
    <div style="padding:20px 32px 0;">
      <div style="display:inline-block;background:${lc.bg};color:#fff;padding:8px 20px;border-radius:20px;font-weight:bold;font-size:14px;">
        ${lc.badge}
      </div>
    </div>
    
    <!-- Content -->
    <div style="padding:20px 32px;">
      <h2 style="color:#1e293b;font-size:20px;margin:0 0 12px 0;">${alert.title}</h2>
      <p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 20px 0;">${alert.message}</p>
      
      <table style="width:100%;border-collapse:collapse;margin:0 0 20px 0;">
        <tr>
          <td style="padding:10px 16px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;color:#64748b;width:40%;font-size:13px;">ประเภท</td>
          <td style="padding:10px 16px;border:1px solid #e2e8f0;font-size:14px;">${typeLabel}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;color:#64748b;font-size:13px;">สถานี/จุดตรวจ</td>
          <td style="padding:10px 16px;border:1px solid #e2e8f0;font-size:14px;">${alert.stationName || '-'}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;color:#64748b;font-size:13px;">ค่าที่ตรวจพบ</td>
          <td style="padding:10px 16px;border:1px solid #e2e8f0;font-size:14px;font-weight:bold;color:${lc.bg};">${alert.triggerValue || '-'}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;color:#64748b;font-size:13px;">เวลาที่ตรวจพบ</td>
          <td style="padding:10px 16px;border:1px solid #e2e8f0;font-size:14px;">${thaiDate}</td>
        </tr>
      </table>
    </div>
    
    <!-- Footer -->
    <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;text-align:center;">
      <p style="color:#94a3b8;font-size:11px;margin:0;">
        แจ้งเตือนอัตโนมัติจากระบบบูรณาการข้อมูล อบจ.ลำปาง<br>
        อีเมลนี้ส่งโดยอัตโนมัติ กรุณาอย่าตอบกลับ
      </p>
    </div>
    
  </div>
</body>
</html>`;
}

// In-memory cache for tracking last values per station (especially for Drought value changes)
const lastAlertValues = new Map();
const alertCooldowns = new Map();

/**
 * ตรวจสอบความซ้ำและการเปลี่ยนแปลงของค่าจากฐานข้อมูล DB (DB-backed Deduplication)
 * @param {object} connection - MySQL connection
 * @param {object} alert - alert object
 * @param {number} cooldownMs - cooldown in milliseconds
 * @returns {Promise<boolean>} true = ซ้ำ/ยังไม่เปลี่ยนแปลง (Skip), false = มีความเปลี่ยนแปลงหรือพ้น Cooldown (Send)
 */
async function isAlertDuplicateOrUnchangedAsync(connection, alert, cooldownMs) {
  const stationName = alert.stationName || 'none';
  const stationKey = `${alert.type}_${stationName.replace(/\s/g, '_')}`;

  // 1. เช็ค RAM cache ก่อน (เร็วที่สุด)
  const cached = lastAlertValues.get(stationKey);
  if (cached) {
    if (alert.type === 'drought' && cached.triggerValue === alert.triggerValue && cached.level === alert.level) {
      return true; // ภัยแล้งค่าไม่เปลี่ยน → Skip 100%
    }
    const cooldownKey = `${stationKey}_${alert.level}`;
    const lastSentTime = alertCooldowns.get(cooldownKey);
    if (lastSentTime && (Date.now() - lastSentTime < cooldownMs) && cached.triggerValue === alert.triggerValue) {
      return true; // อยู่ใน Cooldown และค่าเดิม → Skip
    }
  }

  // 2. เช็คจาก DB ประวัติการส่งล่าสุด (กรณีพึ่ง Restart Server หรือ RAM โดนล้าง)
  if (connection) {
    try {
      const [rows] = await connection.execute(
        `SELECT trigger_value, alert_level, created_at 
         FROM tbl_alert_notifications 
         WHERE alert_type = ? AND station_name = ? AND email_status = 'sent'
         ORDER BY created_at DESC LIMIT 1`,
        [alert.type, stationName]
      );

      if (rows && rows.length > 0) {
        const lastDBRecord = rows[0];
        
        // กฎภัยแล้ง และ เรื่องร้องเรียน: ถ้าค่าที่ตรวจพบ (trigger_value) ล่าสุดใน DB ตรงกับค่าครั้งนี้เป๊ะ → ระงับการส่งซ้ำ 100%!
        if (alert.type === 'drought' || alert.type === 'complaints') {
          if (lastDBRecord.trigger_value === alert.triggerValue && lastDBRecord.alert_level === alert.level) {
            // ซิงค์ลง RAM cache
            lastAlertValues.set(stationKey, { triggerValue: alert.triggerValue, level: alert.level, updatedAt: Date.now() });
            return true; // ค่าไม่เปลี่ยนแปลง บล็อกการส่งซ้ำ!
          }
        }

        // กฎ Cooldown ตามเวลาของประเภทอื่นๆ
        const timeDiffMs = Date.now() - new Date(lastDBRecord.created_at).getTime();
        if (timeDiffMs < cooldownMs && lastDBRecord.trigger_value === alert.triggerValue) {
          lastAlertValues.set(stationKey, { triggerValue: alert.triggerValue, level: alert.level, updatedAt: Date.now() });
          return true; // อยู่ใน Cooldown และค่าเดิม → บล็อกการส่งซ้ำ!
        }
      }
    } catch (e) {
      console.error('Error checking DB deduplication:', e);
    }
  }

  return false;
}

/**
 * บันทึกค่าล่าสุดหลังส่งเตือน
 */
function updateAlertCache(alert) {
  const stationKey = `${alert.type}_${(alert.stationName || 'none').replace(/\s/g, '_')}`;
  const cooldownKey = `${stationKey}_${alert.level}`;
  
  lastAlertValues.set(stationKey, {
    triggerValue: alert.triggerValue,
    level: alert.level,
    updatedAt: Date.now()
  });
  alertCooldowns.set(cooldownKey, Date.now());
}


/**
 * สร้าง HTML Digest Email Template สรุปทุกเหตุการณ์ในฉบับเดียว (ระดับมืออาชีพ/ผู้บริหาร)
 */
function buildDigestEmailHTML(alerts) {
  const criticals = alerts.filter(a => a.level === 'critical');
  const warnings = alerts.filter(a => a.level === 'warning');

  const hasCritical = criticals.length > 0;
  const headerGradient = hasCritical 
    ? 'linear-gradient(135deg, #064e3b 0%, #047857 50%, #065f46 100%)' 
    : 'linear-gradient(135deg, #065f46 0%, #059669 50%, #047857 100%)';
    
  const badgeBg = hasCritical ? '#be123c' : '#d97706';
  const badgeText = hasCritical ? '🚨 สรุปสถานการณ์วิกฤต (CRITICAL)' : '⚠️ สรุปสถานการณ์เฝ้าระวัง (WARNING)';

  const now = new Date();
  const thaiDate = now.toLocaleDateString('th-TH', { 
    year: 'numeric', month: 'long', day: 'numeric', 
    hour: '2-digit', minute: '2-digit' 
  });

  // จัดกลุ่ม alerts ตามประเภท
  const grouped = {
    water: alerts.filter(a => a.type === 'water' || a.type === 'rainfall'),
    drought: alerts.filter(a => a.type === 'drought'),
    pm25: alerts.filter(a => a.type === 'pm25'),
    complaints: alerts.filter(a => a.type === 'complaints')
  };

  const groupConfigs = {
    water: { title: '🌊 ระดับน้ำและปริมาณน้ำฝน', bg: '#eff6ff', border: '#bfdbfe', text: '#1e40af' },
    drought: { title: '🏜️ สถานการณ์น้ำในอ่างเก็บน้ำ (ภัยแล้ง)', bg: '#fff7ed', border: '#fed7aa', text: '#c2410c' },
    pm25: { title: '💨 คุณภาพอากาศ (PM 2.5)', bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d' },
    complaints: { title: '📢 การจัดการเรื่องร้องเรียน', bg: '#faf5ff', border: '#e9d5ff', text: '#7e22ce' }
  };

  function renderGroupTable(items, config) {
    if (!items || items.length === 0) return '';
    
    const rows = items.map((item, idx) => {
      const isCritical = item.level === 'critical';
      const statusColor = isCritical ? '#be123c' : '#d97706';
      const statusBg = isCritical ? '#ffe4e6' : '#fef3c7';
      const statusLabel = isCritical ? '🚨 วิกฤต' : '⚠️ เฝ้าระวัง';
      const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      
      let displayTriggerValue = item.triggerValue || '-';
      if (item.type === 'complaints') {
        if (displayTriggerValue.includes('|')) {
          let [state, org] = displayTriggerValue.split('|');
          if (org && org.length > 25) org = org.substring(0, 25) + '...';
          displayTriggerValue = `<span style="display:block;margin-bottom:4px;font-weight:600;">${state}</span><span style="font-size:11px;color:#64748b;font-weight:normal;">🏣 ${org}</span>`;
        }
      } else {
        // Parse pattern: "🚨 น้ำล้นตลิ่ง (2.57 ม.)" -> "น้ำล้นตลิ่ง" and "2.57 ม."
        const match = displayTriggerValue.match(/^(?:🚨|⚠️|✅|ℹ️)?\s*(.*?)\s*\((.*?)\)$/);
        if (match) {
          const situation = match[1];
          const valueStr = match[2];
          displayTriggerValue = `<span style="display:block;margin-bottom:4px;font-weight:600;">${situation}</span><span style="font-size:12px;color:#64748b;font-weight:normal;background:#f1f5f9;padding:2px 6px;border-radius:6px;">${valueStr}</span>`;
        } else {
          // Fallback if it doesn't match the regex (e.g. just text without parens)
          // Strip emojis just in case
          const stripped = displayTriggerValue.replace(/^(🚨|⚠️|✅|ℹ️)\s*/, '');
          displayTriggerValue = `<span style="display:block;font-weight:600;">${stripped}</span>`;
        }
      }

      return `
        <tr style="background:${rowBg};border-bottom:1px solid #f1f5f9;">
          <td style="padding:12px 16px;font-size:13px;color:#1e293b;vertical-align:middle;">
            <strong style="color:#0f172a;font-size:14px;">${item.stationName || item.title}</strong>
            <div style="font-size:12px;color:#64748b;margin-top:2px;">${item.message || item.title}</div>
          </td>
          <td style="padding:12px 12px;font-size:12px;text-align:center;vertical-align:middle;">
            <span style="display:inline-block;background:${statusBg};color:${statusColor};padding:4px 10px;border-radius:12px;font-weight:bold;">
              ${statusLabel}
            </span>
          </td>
          <td style="padding:12px 14px;font-size:13px;font-weight:bold;color:${statusColor};text-align:center;vertical-align:middle;">
            ${displayTriggerValue}
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div style="margin-bottom:24px;border:1px solid ${config.border};border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.02);">
        <div style="background:${config.bg};padding:12px 18px;border-bottom:1px solid ${config.border};">
          <h3 style="margin:0;font-size:14px;font-weight:bold;color:${config.text};">${config.title} (${items.length} รายการ)</h3>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f1f5f9;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">
              <th style="padding:10px 16px;text-align:left;">สถานี / รายการตรวจวัด</th>
              <th style="padding:10px 10px;text-align:center;width:90px;">ระดับเตือน</th>
              <th style="padding:10px 14px;text-align:center;">ผลการตรวจวัด</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>

      </div>
    `;
  }

  return `
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Sarabun,Tahoma,Geneva,Verdana,sans-serif;background:#ecfdf5;color:#1e293b;">
  
  <div style="max-width:720px;margin:24px auto;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(4,120,87,0.12);border:1px solid #a7f3d0;">
    
    <!-- 🏛️ Header with Lampang PAO Logo (Official Green Theme) -->
    <div style="background:${headerGradient};padding:28px 32px;text-align:center;color:#ffffff;position:relative;">
      <!-- Logo PAO Lampang embedded via CID -->
      <img src="cid:lampang_pao_logo" style="width:84px;height:84px;object-fit:contain;margin-bottom:12px;filter:drop-shadow(0 4px 10px rgba(0,0,0,0.3));" alt="ตราองค์การบริหารส่วนจังหวัดลำปาง">
      
      <h2 style="margin:0 0 4px 0;font-size:13px;font-weight:600;letter-spacing:1px;color:#a7f3d0;text-transform:uppercase;">
        องค์การบริหารส่วนจังหวัดลำปาง
      </h2>
      <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:bold;color:#ffffff;line-height:1.3;">
        ศูนย์บริหารจัดการน้ำและระบบเตือนภัยบูรณาการ
      </h1>
      <p style="margin:0;font-size:13px;color:#d1fae5;opacity:0.95;">
        รายงานสรุปสถานการณ์วิกฤตและเฝ้าระวังประจำวัน
      </p>
    </div>

    <!-- 📊 Sub-Header Status Bar -->
    <div style="background:#f0fdf4;padding:12px 32px;border-bottom:1px solid #d1fae5;display:flex;align-items:center;justify-space:between;flex-wrap:wrap;gap:10px;">
      <div style="background:${badgeBg};color:#ffffff;padding:6px 16px;border-radius:20px;font-size:12px;font-weight:bold;letter-spacing:0.3px;">
        ${badgeText}
      </div>
      <div style="font-size:12px;color:#047857;font-weight:600;">
        📅 ข้อมูล ณ วันที่: <strong style="color:#064e3b;">${thaiDate}</strong>
      </div>
    </div>

    <!-- 📈 Summary Cards -->
    <div style="padding:24px 32px 16px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="width:33%;padding:4px;">
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;text-align:center;">
              <span style="font-size:11px;color:#64748b;font-weight:bold;display:block;margin-bottom:4px;">เหตุการณ์ทั้งหมด</span>
              <span style="font-size:26px;font-weight:800;color:#0f172a;">${alerts.length}</span>
              <span style="font-size:11px;color:#94a3b8;display:block;margin-top:2px;">รายการ</span>
            </div>
          </td>
          <td style="width:33%;padding:4px;">
            <div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:12px;padding:14px;text-align:center;">
              <span style="font-size:11px;color:#be123c;font-weight:bold;display:block;margin-bottom:4px;">🚨 ระดับวิกฤต</span>
              <span style="font-size:26px;font-weight:800;color:#be123c;">${criticals.length}</span>
              <span style="font-size:11px;color:#e11d48;display:block;margin-top:2px;">รายการ</span>
            </div>
          </td>
          <td style="width:33%;padding:4px;">
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:14px;text-align:center;">
              <span style="font-size:11px;color:#b45309;font-weight:bold;display:block;margin-bottom:4px;">⚠️ ระดับเฝ้าระวัง</span>
              <span style="font-size:26px;font-weight:800;color:#d97706;">${warnings.length}</span>
              <span style="font-size:11px;color:#d97706;display:block;margin-top:2px;">รายการ</span>
            </div>
          </td>
        </tr>
      </table>
    </div>

    <!-- 📋 Grouped Alert Tables -->
    <div style="padding:0 32px 8px;">
      ${renderGroupTable(grouped.water, groupConfigs.water)}
      ${renderGroupTable(grouped.drought, groupConfigs.drought)}
      ${renderGroupTable(grouped.pm25, groupConfigs.pm25)}
      ${renderGroupTable(grouped.complaints, groupConfigs.complaints)}
    </div>

    <!-- 📱 Dashboard Call-to-Action -->
    <div style="padding:0 32px 24px;text-align:center;">
      <a href="http://localhost:7000/#" style="display:inline-block;background:linear-gradient(135deg, #10b981 0%, #059669 100%);color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:30px;font-size:13px;font-weight:bold;box-shadow:0 4px 14px rgba(16,185,129,0.35);">
        📱 เปิดหน้าแดชบอร์ดเพื่อติดตามสถานการณ์ Real-time &rarr;
      </a>
    </div>

    <!-- 💡 Note Box -->
    <div style="padding:0 32px 24px;">
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 18px;font-size:12px;color:#475569;line-height:1.5;">
        💡 <strong>หมายเหตุระบบคัดกรองอัตโนมัติ:</strong> รายงานนี้จะจัดส่งเฉพาะเหตุการณ์ที่มีค่าเปลี่ยนแปลงหรือพบเหตุการณ์ใหม่เท่านั้น เพื่อป้องกันปัญหาการส่งอีเมลซ้ำรบกวนกล่องจดหมายของท่าน
      </div>
    </div>

    <!-- 🏛️ Official Footer -->
    <div style="background:#f1f5f9;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center;">
      <p style="color:#475569;font-size:12px;font-weight:bold;margin:0 0 4px 0;">
        ศูนย์บริการสารสนเทศบูรณาการ องค์การบริหารส่วนจังหวัดลำปาง
      </p>
      <p style="color:#94a3b8;font-size:11px;margin:0;line-height:1.5;">
        ระบบแจ้งเตือนอัตโนมัติ (Automated Water & Crisis Alert System)<br>
        อีเมลฉบับนี้สร้างและส่งโดยระบบอัตโนมัติ กรุณาอย่าตอบกลับอีเมลนี้
      </p>
    </div>

  </div>
</body>
</html>`;
}


/**
 * ส่ง Email รายงานสรุป Digest แบบฉบับเดียวให้แก่ผู้รับ
 */
export async function sendDigestEmail(alerts, recipients, smtpConfig) {
  if (!smtpConfig || !smtpConfig.user || !smtpConfig.pass) {
    return { sent: false, recipients: [], error: 'SMTP ยังไม่ได้ตั้งค่า (ต้องกำหนด user/pass ใน config.json)' };
  }

  if (!alerts || alerts.length === 0) {
    return { sent: false, recipients: [], error: 'ไม่มีรายการแจ้งเตือน' };
  }

  const typeFieldMap = {
    water: 'notify_water',
    rainfall: 'notify_water',
    drought: 'notify_drought',
    pm25: 'notify_pm25',
    complaints: 'notify_complaints'
  };

  // กรองผู้รับที่เปิดใช้งาน
  const activeRecipients = recipients.filter(r => r.is_active);

  if (activeRecipients.length === 0) {
    return { sent: false, recipients: [], error: 'ไม่มีผู้รับที่เปิดใช้งาน' };
  }

  // พาธโลโก้ อบจ.ลำปาง สำหรับ Inline CID Attachment
  const logoPath = path.join(__dirname, 'backend_ui', 'logo_pao.png');
  const hasLogoFile = fs.existsSync(logoPath);

  let sentCount = 0;
  const sentRecipientNames = [];
  const failedRecipientNames = [];
  let lastError = null;

  try {
    const transporter = createTransporter(smtpConfig);

    for (const recipient of activeRecipients) {
      // กรองเฉพาะ alerts ที่ผู้รับท่านนี้เปิดรับสิทธิ์ (ตามประเภทและระดับ)
      const recipientAlerts = alerts.filter(alert => {
        const typeField = typeFieldMap[alert.type] || 'notify_water';
        if (!recipient[typeField]) return false;
        
        // เปรียบเทียบความสำคัญของ level
        const alertLevelStr = (alert.level || 'info').toLowerCase().trim();
        const minLevelStr = (recipient.alert_level_min || 'info').toLowerCase().trim();
        const prioAlert = LEVEL_PRIORITY[alertLevelStr] || 1;
        const prioMin = LEVEL_PRIORITY[minLevelStr] || 1;
        
        if (prioAlert < prioMin) return false;
        return true;
      });

      if (recipientAlerts.length === 0) continue;

      const hasCritical = recipientAlerts.some(a => a.level === 'critical');
      const subject = hasCritical 
        ? `🚨 [แจ้งเตือนวิกฤต] พบ ${recipientAlerts.length} เหตุการณ์สำคัญ — อบจ.ลำปาง`
        : `⚠️ [รายงานเฝ้าระวัง] พบ ${recipientAlerts.length} เหตุการณ์สำคัญ — อบจ.ลำปาง`;

      const html = buildDigestEmailHTML(recipientAlerts);

      const mailOptions = {
        from: `"🔔 ระบบแจ้งเตือน อบจ.ลำปาง" <${smtpConfig.user}>`,
        to: `"${recipient.name}" <${recipient.email}>`,
        subject: subject,
        html: html,
        attachments: hasLogoFile ? [{
          filename: 'logo_pao.png',
          path: logoPath,
          cid: 'lampang_pao_logo'
        }] : []
      };

      try {
        await transporter.sendMail(mailOptions);
        sentCount++;
        sentRecipientNames.push(`${recipient.name} <${recipient.email}>`);
        
        // หน่วงเวลา 1 วินาที เพื่อป้องกันการส่งถี่เกินไป (Rate limit)
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        console.error(`[Notification] Failed to send email to ${recipient.email}:`, err.message);
        failedRecipientNames.push(`${recipient.name} <${recipient.email}>`);
        lastError = err.message;
      }
    }

    return { 
      sent: sentCount > 0, 
      recipients: sentRecipientNames, 
      failed: failedRecipientNames,
      error: lastError 
    };
  } catch (err) {
    return { sent: false, recipients: sentRecipientNames, error: err.message };
  }
}


// ============================================================
// 🎯 MAIN FUNCTION: checkAndNotify()
// ============================================================

/**
 * ฟังก์ชันหลัก — Query ข้อมูลล่าสุด → ตรวจเกณฑ์ → ส่ง email → บันทึก log
 * @param {object} pool - MySQL connection pool
 * @param {Function} addLog - logging function from server.js
 * @param {object} notificationConfig - config from config.json
 * @returns {object} { totalAlerts, sentEmails, skipped, errors }
 */
export async function checkAndNotify(pool, addLog, notificationConfig, forceSend = false) {
  if (!notificationConfig || !notificationConfig.enabled) {
    return { totalAlerts: 0, sentEmails: 0, skipped: 0, errors: 0, message: 'ระบบแจ้งเตือนปิดอยู่' };
  }
  
  const alertActive = notificationConfig.alertActive || {};
  const cooldownMs = (notificationConfig.cooldownMinutes || 120) * 60 * 1000;
  const smtpConfig = notificationConfig.smtp || {};
  
  let connection;
  let allAlerts = [];

  
  try {
    connection = await pool.getConnection();
    
    // 1. ดึงรายชื่อผู้รับ
    const [recipients] = await connection.execute('SELECT * FROM tbl_alert_recipients WHERE is_active = 1');
    
    if (recipients.length === 0) {
      addLog('Notification', '⚠️ ไม่มีผู้รับการแจ้งเตือนที่เปิดใช้งาน');
      return { totalAlerts: 0, sentEmails: 0, skipped: 0, errors: 0 };
    }
    
    // 2. ตรวจเกณฑ์แต่ละด้าน
    
    // 2a. ระดับน้ำ (ดึงเฉพาะแถวล่าสุดของแต่ละสถานี)
    if (alertActive.water !== false) {
      try {
        const [waterRows] = await connection.execute(
          `SELECT w.station_name, w.current_water_level_m, w.left_bank_level_m, w.bank_difference_m, w.status 
           FROM tbl_water_disaster_monitoring w
           INNER JOIN (
             SELECT station_name, MAX(recorded_at) as max_rec 
             FROM tbl_water_disaster_monitoring 
             GROUP BY station_name
           ) latest ON w.station_name = latest.station_name AND w.recorded_at = latest.max_rec`
        );

        const waterAlerts = evaluateWaterAlerts(waterRows);
        allAlerts.push(...waterAlerts);
      } catch (e) {
        addLog('Notification', `⚠️ ตรวจเกณฑ์ระดับน้ำล้มเหลว: ${e.message}`);
      }
    }
    
    // 2b. ปริมาณฝน
    if (alertActive.rainfall !== false) {
      try {
        const [rainfallRows] = await connection.execute(
          `SELECT r.station_name, r.rain_mm 
           FROM tbl_rainfall_monitoring r
           INNER JOIN (
             SELECT station_name, MAX(recorded_at) as max_rec 
             FROM tbl_rainfall_monitoring 
             GROUP BY station_name
           ) latest ON r.station_name = latest.station_name AND r.recorded_at = latest.max_rec`
        );
        const rainfallAlerts = evaluateRainfallAlerts(rainfallRows);
        allAlerts.push(...rainfallAlerts);
      } catch (e) {
        addLog('Notification', `ℹ️ ข้ามการตรวจเกณฑ์ปริมาณฝน (ตารางอาจยังไม่มี): ${e.message}`);
      }
    }
    
    // 2c. ภัยแล้ง (ดึงเฉพาะแถวล่าสุดของแต่ละอ่าง)
    if (alertActive.drought !== false) {
      try {
        const [droughtRows] = await connection.execute(
          `SELECT d.dam_name, d.water_percent 
           FROM tbl_drought_monitoring d
           INNER JOIN (
             SELECT dam_name, MAX(recorded_at) as max_rec 
             FROM tbl_drought_monitoring 
             GROUP BY dam_name
           ) latest ON d.dam_name = latest.dam_name AND d.recorded_at = latest.max_rec`
        );
        const droughtAlerts = evaluateDroughtAlerts(droughtRows);
        allAlerts.push(...droughtAlerts);
      } catch (e) {
        addLog('Notification', `⚠️ ตรวจเกณฑ์ภัยแล้งล้มเหลว: ${e.message}`);
      }
    }
    
    // 2d. PM 2.5 (ดึงเฉพาะแถวล่าสุดของแต่ละสถานี)
    if (alertActive.pm25 !== false) {
      try {
        const [pm25Rows] = await connection.execute(
          `SELECT p.station_name, p.amphoe, p.pm25_value, p.pm25_avg_24h 
           FROM tbl_pm25_monitoring p
           INNER JOIN (
             SELECT station_name, MAX(recorded_at) as max_rec 
             FROM tbl_pm25_monitoring 
             GROUP BY station_name
           ) latest ON p.station_name = latest.station_name AND p.recorded_at = latest.max_rec`
        );
        const pm25Alerts = evaluatePM25Alerts(pm25Rows);
        allAlerts.push(...pm25Alerts);
      } catch (e) {
        addLog('Notification', `⚠️ ตรวจเกณฑ์ PM 2.5 ล้มเหลว: ${e.message}`);
      }
    }

    
    // 2e. เรื่องร้องเรียน (ตรวจสอบรายเรื่องที่มีการอัปเดตในช่วง 2 วันที่ผ่านมา)
    if (alertActive.complaints !== false) {
      try {
        const [complaintRows] = await connection.execute(
          `SELECT c.ticket_id, c.state_name, c.problem_type, c.org_name, c.description, c.recorded_at 
           FROM tbl_complaints_monitoring c
           INNER JOIN (
             SELECT ticket_id, MAX(id) as max_id 
             FROM tbl_complaints_monitoring 
             WHERE recorded_at >= DATE_SUB(NOW(), INTERVAL 2 DAY)
             GROUP BY ticket_id
           ) latest ON c.id = latest.max_id`
        );
        
        const complaintAlerts = evaluateIndividualComplaints(complaintRows);
        allAlerts.push(...complaintAlerts);
      } catch (e) {
        addLog('Notification', `⚠️ ตรวจเกณฑ์เรื่องร้องเรียนล้มเหลว: ${e.message}`);
      }
    }
    
    // 3. ประมวลผล alerts — กรองเฉพาะรายการใหม่/รายการที่มีค่าเปลี่ยนแปลง
    let skipped = 0;
    const validAlerts = [];
    
    if (allAlerts.length === 0) {
      addLog('Notification', '✅ ตรวจสอบแล้ว — ไม่มีค่าใดเกินเกณฑ์แจ้งเตือน');
      return { totalAlerts: 0, sentEmails: 0, skipped: 0, errors: 0 };
    }
    
    for (const alert of allAlerts) {
      const isDup = forceSend ? false : await isAlertDuplicateOrUnchangedAsync(connection, alert, cooldownMs);
      const logSubject = alert.type === 'complaints' 
        ? `ร้องเรียน [${alert.stationName}]` 
        : `${alert.type.toUpperCase()} [${alert.stationName}]`;
        
      if (isDup) {
        addLog('Notification', `⏭️ ข้าม (ไม่มีการเปลี่ยนแปลง): ${logSubject}`);
        skipped++;
      } else {
        addLog('Notification', `📝 พบการเปลี่ยนแปลง: ${logSubject} -> ${alert.triggerValue || ''}`);
        validAlerts.push(alert);
      }
    }

    if (validAlerts.length === 0) {
      addLog('Notification', `ℹ️ สรุป: ตรวจพบ ${allAlerts.length} รายการ แต่ไม่มีการเปลี่ยนแปลง (ข้ามทั้งหมด)`);
      return { totalAlerts: allAlerts.length, sentEmails: 0, skipped, errors: 0 };
    }
    
    addLog('Notification', `🔔 พบ ${validAlerts.length} รายการที่มีความเปลี่ยนแปลง — กำลังส่งรายงานสรุป Digest Email...`);
    
    // ส่ง Digest Email รวมฉบับเดียวให้ผู้รับตามสิทธิ์
    const result = await sendDigestEmail(validAlerts, recipients, smtpConfig);
    
    // อัปเดต Cache และบันทึก Log ลง DB ทุกรายการที่รวมอยู่ใน Digest Email
    for (const alert of validAlerts) {
      updateAlertCache(alert);
      try {
        await connection.execute(
          `INSERT INTO tbl_alert_notifications 
           (alert_type, alert_level, alert_title, alert_message, trigger_value, threshold_value, station_name, recipients_sent, email_status, email_error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            alert.type,
            alert.level,
            alert.title,
            alert.message,
            alert.triggerValue || null,
            alert.thresholdValue || null,
            alert.stationName || null,
            result.recipients.join(', '),
            result.sent ? 'sent' : 'failed',
            result.error || null
          ]
        );
      } catch (logErr) {
        addLog('Notification', `⚠️ บันทึก log แจ้งเตือนลง DB ล้มเหลว: ${logErr.message}`);
      }
    }
    
    if (result.sent) {
      addLog('Notification', `📧 ส่งรายงานสรุป Digest Email สำเร็จ (${validAlerts.length} รายการใน 1 ฉบับ) → ${result.recipients.length} คน`);
    } else {
      addLog('Notification', `⚠️ ส่งรายงานสรุป Digest Email ล้มเหลว: ${result.error}`);
    }
    
    return {
      totalAlerts: allAlerts.length,
      sentEmails: result.sent ? result.recipients.length : 0,
      skipped,
      errors: result.sent ? 0 : 1
    };
  } catch (error) {
    addLog('Notification', `❌ เกิดข้อผิดพลาดในระบบแจ้งเตือน: ${error.message}`);
    return { totalAlerts: 0, sentEmails: 0, skipped: 0, errors: 1 };
  } finally {
    if (connection) connection.release();
  }
}


/**
 * ส่ง test email เพื่อทดสอบ SMTP config
 */
export async function sendTestEmail(smtpConfig, testRecipientEmail, pool) {
  const user = (smtpConfig?.user || process.env.SMTP_USER || '').trim();
  const pass = (smtpConfig?.pass || process.env.SMTP_PASS || '').replace(/\s+/g, '');
  if (!user || !pass) {
    return { success: false, error: 'SMTP ยังไม่ได้ตั้งค่า (ต้องกำหนด user/pass ใน .env หรือ config.json)' };
  }
  
  try {
    const transporter = createTransporter({ ...(smtpConfig || {}), user, pass });
    
    const testAlerts = [
      {
        type: 'drought',
        level: 'critical',
        title: '🚨 ภัยแล้งวิกฤต: อ่างเก็บน้ำแม่ต๋ำตอนล่าง',
        message: 'ปริมาตรน้ำกักเก็บเหลือเพียง 22% ต่ำกว่าเกณฑ์วิกฤต (≤30%)',
        triggerValue: '22%',
        thresholdValue: '≤30%',
        stationName: 'อ่างเก็บน้ำแม่ต๋ำตอนล่าง'
      },
      {
        type: 'pm25',
        level: 'warning',
        title: '⚠️ PM 2.5 เริ่มมีผลต่อสุขภาพ: ศาลาเอนกประสงค์บ้านหลุก',
        message: 'ตรวจพบ PM 2.5 เกินเกณฑ์เฝ้าระวัง (42 µg/m³)',
        triggerValue: '42 µg/m³',
        thresholdValue: '≥37.6 µg/m³',
        stationName: 'ศาลาเอนกประสงค์บ้านหลุก หมู่ 2 (อำเภอแจ้ห่ม)'
      }
    ];
    
    const html = buildDigestEmailHTML(testAlerts);
    
    // Determine recipients: all active in DB, or specific email, or fallback to sender
    let recipients = [];
    if (pool) {
      let conn;
      try {
        conn = await pool.getConnection();
        const [rows] = await conn.execute('SELECT email, name FROM tbl_alert_recipients WHERE is_active = 1');
        recipients = rows.map(r => ({ email: r.email, name: r.name }));
      } finally {
        if (conn) conn.release();
      }
    }
    if (testRecipientEmail) recipients = [{ email: testRecipientEmail, name: 'ผู้รับทดสอบ' }];
    if (recipients.length === 0) recipients = [{ email: smtpConfig.user, name: 'Admin' }];
    
    const toList = recipients.map(r => `"${r.name}" <${r.email}>`).join(', ');
    
    const logoPath = path.join(__dirname, 'backend_ui', 'logo_pao.png');
    const hasLogoFile = fs.existsSync(logoPath);

    await transporter.sendMail({
      from: `"🔔 ระบบแจ้งเตือน อบจ.ลำปาง" <${smtpConfig.user}>`,
      to: toList,
      subject: '🚨 [แจ้งเตือนวิกฤต] พบ 2 เหตุการณ์สำคัญ — อบจ.ลำปาง (ทดสอบระบบ)',
      html: html,
      attachments: hasLogoFile ? [{
        filename: 'logo_pao.png',
        path: logoPath,
        cid: 'lampang_pao_logo'
      }] : []
    });


    
    return { success: true, sentTo: recipients.map(r => r.email).join(', '), count: recipients.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Export thresholds for API access
export { THRESHOLDS };
