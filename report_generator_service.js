/**
 * report_generator_service.js
 * ระบบสร้างและปรับแต่งรายงานผู้บริหารอัตโนมัติ (Custom Report Builder)
 * รองรับ:
 * - กำหนดช่วงเวลาอิสระ (Custom Date Range) นอกเหนือจากรายสัปดาห์/รายเดือน
 * - เลือกติ๊กเฉพาะหัวข้อที่สนใจได้ (Selective Sections): ระดับน้ำ, อ่างเก็บน้ำ, ดัชนีความเสี่ยงรวม, PM 2.5, เรื่องร้องเรียน
 * - ส่งออกทั้งรูปแบบ Word (.docx) และ PDF (.pdf) คุณภาพสูง
 */

import 'dotenv/config';
import mysql from 'mysql2/promise';
import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  BorderStyle, Table, TableRow, TableCell, WidthType, ShadingType,
  Header, Footer, PageNumber, PageBreak, ImageRun, convertInchesToTwip
} from 'docx';
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || 'root',
  database: process.env.DB_NAME || 'water_system2',
  waitForConnections: true,
  connectionLimit: 5
});

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];

function formatThaiDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function formatThaiMonthYear(dateStr) {
  const d = new Date(dateStr);
  return `${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}

// -------------------------------------------------------------
// Helper: Render Chart.js to Image Buffer via Headless Puppeteer
// -------------------------------------------------------------
async function renderChartToImage(chartConfig, width = 750, height = 350) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setViewport({ width, height });

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>
          body { margin: 0; padding: 10px; background: #ffffff; font-family: 'Prompt', 'Sarabun', sans-serif; }
          #chart-container { width: ${width - 20}px; height: ${height - 20}px; }
        </style>
      </head>
      <body>
        <div id="chart-container">
          <canvas id="myChart"></canvas>
        </div>
        <script>
          const config = ${JSON.stringify(chartConfig)};
          new Chart(document.getElementById('myChart'), config);
        </script>
      </body>
      </html>
    `;

    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600)); // Allow chart animation/render to settle

    const element = await page.$('#chart-container');
    const imageBuffer = await element.screenshot({ type: 'png' });
    return Buffer.from(imageBuffer);
  } catch (err) {
    console.error('Error rendering chart image:', err.message);
    return null;
  } finally {
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
  }
}

// -------------------------------------------------------------
// Main Custom Report Builder Function
// -------------------------------------------------------------
export async function generateExecutiveReport({ 
  period = 'monthly', 
  targetDate = null, 
  startDate = null, 
  endDate = null, 
  sections = {}, 
  format = 'docx' 
} = {}) {
  // 1. Resolve Active Sections Filter
  const activeSections = {
    water: sections.water !== false,
    drought: sections.drought !== false,
    riskIndex: sections.riskIndex !== false,
    pm25: sections.pm25 !== false,
    complaints: sections.complaints !== false
  };

  // 2. Resolve Date Ranges & Titles
  const refDate = targetDate ? new Date(targetDate) : new Date();
  let startDateStr = '';
  let endDateStr = '';
  let reportTitle = '';
  let periodSubtitle = '';

  if (period === 'custom' || (startDate && endDate)) {
    const sD = new Date(startDate);
    const eD = new Date(endDate);
    startDateStr = startDate.includes(' ') ? startDate : startDate + ' 00:00:00';
    endDateStr = endDate.includes(' ') ? endDate : endDate + ' 23:59:59';
    reportTitle = 'รายงานสรุปสถานการณ์น้ำและภัยพิบัติ (กำหนดช่วงเวลาพิเศษ)';
    periodSubtitle = `ข้อมูลระหว่างวันที่ ${formatThaiDate(sD)} ถึง ${formatThaiDate(eD)}`;
  } else if (period === 'weekly') {
    const endD = new Date(refDate);
    const startD = new Date(refDate);
    startD.setDate(startD.getDate() - 6);
    startDateStr = startD.toISOString().split('T')[0] + ' 00:00:00';
    endDateStr = endD.toISOString().split('T')[0] + ' 23:59:59';
    reportTitle = 'รายงานสรุปสถานการณ์น้ำและภัยแล้งประจำสัปดาห์';
    periodSubtitle = `ระหว่างวันที่ ${formatThaiDate(startD)} ถึง ${formatThaiDate(endD)}`;
  } else {
    // Monthly
    const year = refDate.getFullYear();
    const month = refDate.getMonth();
    const startD = new Date(year, month, 1);
    const endD = new Date(year, month + 1, 0);
    startDateStr = startD.toISOString().split('T')[0] + ' 00:00:00';
    endDateStr = endD.toISOString().split('T')[0] + ' 23:59:59';
    reportTitle = `รายงานสรุปสถานการณ์น้ำและภัยแล้งประจำเดือน ${THAI_MONTHS[month]} ${year + 543}`;
    periodSubtitle = `ข้อมูลระหว่างวันที่ 1 ${THAI_MONTHS[month]} ถึง ${endD.getDate()} ${THAI_MONTHS[month]} ${year + 543}`;
  }

  // 3. Query Data according to Active Sections
  let waterStats = [];
  let waterKpi = [{}];
  let damStats = [];
  let pm25Kpi = [{}];
  let complaintKpi = [{}];

  if (activeSections.water || activeSections.riskIndex) {
    [waterStats] = await pool.query(`
      SELECT 
        station_name, river, amphoe,
        ROUND(AVG(current_water_level_m), 2) as avg_wl,
        ROUND(MAX(current_water_level_m), 2) as max_wl,
        ROUND(MIN(current_water_level_m), 2) as min_wl,
        ROUND(AVG(left_bank_level_m), 2) as bank_level,
        ROUND(AVG(current_rain_mm), 2) as avg_rain,
        ROUND(MAX(current_rain_mm), 2) as max_rain,
        COUNT(*) as total_records
      FROM tbl_water_disaster_monitoring
      WHERE recorded_at BETWEEN ? AND ?
      GROUP BY station_name, river, amphoe
      ORDER BY max_wl DESC
    `, [startDateStr, endDateStr]);

    [waterKpi] = await pool.query(`
      SELECT 
        COUNT(*) as total_records,
        COUNT(DISTINCT station_name) as active_stations,
        ROUND(AVG(current_water_level_m), 2) as prov_avg_wl,
        ROUND(AVG(current_rain_mm), 2) as prov_avg_rain,
        SUM(CASE WHEN bank_difference_m <= 0.5 AND left_bank_level_m > 0 THEN 1 ELSE 0 END) as warning_counts
      FROM tbl_water_disaster_monitoring
      WHERE recorded_at BETWEEN ? AND ?
    `, [startDateStr, endDateStr]);
  }

  if (activeSections.drought || activeSections.riskIndex) {
    [damStats] = await pool.query(`
      SELECT 
        dam_name, dam_type,
        ROUND(MAX(capacity_m_cum), 2) as capacity,
        ROUND(AVG(water_volume_m_cum), 2) as avg_volume,
        ROUND(AVG(water_percent), 1) as avg_pct,
        ROUND(AVG(usable_water_m_cum), 2) as avg_usable,
        ROUND(AVG(inflow_m_cum), 3) as avg_inflow,
        ROUND(AVG(discharge_m_cum), 3) as avg_discharge
      FROM tbl_drought_monitoring
      WHERE recorded_at BETWEEN ? AND ?
      GROUP BY dam_name, dam_type
      ORDER BY capacity DESC
    `, [startDateStr, endDateStr]);
  }

  if (activeSections.pm25) {
    [pm25Kpi] = await pool.query(`
      SELECT 
        ROUND(AVG(pm25_value), 1) as avg_pm25,
        MAX(pm25_value) as max_pm25,
        COUNT(DISTINCT station_name) as stations
      FROM tbl_pm25_monitoring
      WHERE recorded_at BETWEEN ? AND ?
    `, [startDateStr, endDateStr]);
  }

  if (activeSections.complaints) {
    [complaintKpi] = await pool.query(`
      SELECT 
        COUNT(*) as total_complaints,
        SUM(CASE WHEN state_name LIKE '%เสร็จสิ้น%' THEN 1 ELSE 0 END) as resolved_complaints,
        SUM(CASE WHEN state_name LIKE '%รอรับเรื่อง%' THEN 1 ELSE 0 END) as pending_complaints
      FROM tbl_complaints_monitoring
      WHERE created_at BETWEEN ? AND ?
    `, [startDateStr, endDateStr]);
  }

  const kpi = {
    totalWaterRecords: waterKpi[0]?.total_records || 0,
    activeStations: waterKpi[0]?.active_stations || 0,
    provAvgWl: waterKpi[0]?.prov_avg_wl || 0,
    provAvgRain: waterKpi[0]?.prov_avg_rain || 0,
    warningCounts: waterKpi[0]?.warning_counts || 0,
    avgPm25: pm25Kpi[0]?.avg_pm25 || 0,
    totalComplaints: complaintKpi[0]?.total_complaints || 0,
    resolvedComplaints: complaintKpi[0]?.resolved_complaints || 0
  };

  // 4. Composite Risk Index Calculation (if enabled)
  let riskSummary = {
    score: 25,
    level: 'ปกติ (Normal)',
    color: '#10b981',
    threat: 'ระดับน้ำและอ่างเก็บน้ำสมดุล'
  };
  let riskHotspots = [];

  if (activeSections.riskIndex) {
    let totalWaterScore = 0;
    waterStats.forEach(s => {
      let sc = 20;
      if (s.bank_level > 0 && s.max_wl >= s.bank_level) sc = 90;
      else if (s.bank_level > 0 && s.max_wl >= s.bank_level * 0.9) sc = 75;
      else if (s.max_rain >= 50) sc = 60;
      totalWaterScore += sc;
      if (sc >= 60) {
        riskHotspots.push({
          type: 'สถานีวัดน้ำ',
          name: s.station_name,
          amphoe: s.amphoe || 'ลำปาง',
          score: sc,
          detail: `ระดับน้ำสูงสุด ${s.max_wl} ม. (ตลิ่ง ${s.bank_level || '-'} ม.)`
        });
      }
    });

    let totalDamScore = 0;
    damStats.forEach(d => {
      let sc = 20;
      if (d.avg_pct <= 20) sc = 90;
      else if (d.avg_pct <= 30) sc = 75;
      else if (d.avg_pct <= 40) sc = 55;
      totalDamScore += sc;
      if (sc >= 55) {
        riskHotspots.push({
          type: 'อ่างเก็บน้ำ',
          name: d.dam_name,
          amphoe: 'ลำปาง',
          score: sc,
          detail: `น้ำคงเหลือเฉลี่ย ${d.avg_pct}% (${d.avg_volume} ล้าน ลบ.ม.)`
        });
      }
    });

    riskHotspots.sort((a, b) => b.score - a.score);
    riskHotspots = riskHotspots.slice(0, 5);

    const avgW = waterStats.length > 0 ? Math.round(totalWaterScore / waterStats.length) : 20;
    const avgD = damStats.length > 0 ? Math.round(totalDamScore / damStats.length) : 20;
    const compScore = Math.round(0.55 * avgW + 0.45 * avgD);
    riskSummary.score = compScore;

    if (compScore >= 75) {
      riskSummary.level = 'วิกฤต (Critical)';
      riskSummary.color = '#dc2626';
    } else if (compScore >= 55) {
      riskSummary.level = 'เสี่ยงสูง (High)';
      riskSummary.color = '#ea580c';
    } else if (compScore >= 35) {
      riskSummary.level = 'เฝ้าระวัง (Moderate)';
      riskSummary.color = '#eab308';
    } else {
      riskSummary.level = 'ปกติ (Normal)';
      riskSummary.color = '#10b981';
    }

    if (avgW > avgD + 10) riskSummary.threat = 'เฝ้าระวังน้ำหลากและฝนตกหนัก';
    else if (avgD > avgW + 10) riskSummary.threat = 'เฝ้าระวังภัยแล้ง ปริมาณน้ำในอ่างต่ำ';
    else riskSummary.threat = 'สถานการณ์น้ำและภัยแล้งสมดุล';
  }

  // 5. Generate Visual Charts (Only for selected sections)
  let chart1Buffer = null;
  const topStations = waterStats.slice(0, 7);
  if (activeSections.water && topStations.length > 0) {
    const chart1Config = {
      type: 'bar',
      data: {
        labels: topStations.map(s => s.station_name),
        datasets: [
          {
            label: 'ระดับน้ำสูงสุด (ม.รทก.)',
            data: topStations.map(s => s.max_wl),
            backgroundColor: 'rgba(59, 130, 246, 0.8)',
            borderColor: '#2563eb',
            borderWidth: 1,
            yAxisID: 'y'
          },
          {
            label: 'ระดับตลิ่งซ้าย (ม.รทก.)',
            data: topStations.map(s => s.bank_level),
            type: 'line',
            borderColor: '#ef4444',
            borderWidth: 2,
            pointBackgroundColor: '#ef4444',
            fill: false,
            yAxisID: 'y'
          },
          {
            label: 'ปริมาณฝนสะสมเฉลี่ย (มม.)',
            data: topStations.map(s => s.avg_rain),
            type: 'bar',
            backgroundColor: 'rgba(16, 185, 129, 0.6)',
            borderColor: '#059669',
            borderWidth: 1,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: 'ระดับน้ำสูงสุดและปริมาณฝนรายสถานีหลัก (ลำปาง)', font: { size: 16 } },
          legend: { position: 'bottom' }
        },
        scales: {
          y: { type: 'linear', position: 'left', title: { display: true, text: 'ระดับน้ำ (ม.รทก.)' } },
          y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'ฝนเฉลี่ย (มม.)' } }
        }
      }
    };
    chart1Buffer = await renderChartToImage(chart1Config, 760, 340);
  }

  let chart2Buffer = null;
  const majorDams = damStats.slice(0, 5);
  if (activeSections.drought && majorDams.length > 0) {
    const chart2Config = {
      type: 'bar',
      data: {
        labels: majorDams.map(d => d.dam_name),
        datasets: [
          {
            label: 'ความจุอ่างเก็บน้ำ (ล้าน ลบ.ม.)',
            data: majorDams.map(d => d.capacity),
            backgroundColor: 'rgba(148, 163, 184, 0.6)',
            borderColor: '#64748b',
            borderWidth: 1
          },
          {
            label: 'ปริมาณน้ำเฉลี่ยในอ่าง (ล้าน ลบ.ม.)',
            data: majorDams.map(d => d.avg_volume),
            backgroundColor: 'rgba(14, 165, 233, 0.8)',
            borderColor: '#0284c7',
            borderWidth: 1
          },
          {
            label: 'น้ำใช้การได้ (ล้าน ลบ.ม.)',
            data: majorDams.map(d => d.avg_usable),
            backgroundColor: 'rgba(16, 185, 129, 0.8)',
            borderColor: '#059669',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: 'ปริมาณน้ำในอ่างเก็บน้ำหลักของจังหวัดลำปาง', font: { size: 16 } },
          legend: { position: 'bottom' }
        },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'ล้าน ลบ.ม.' } }
        }
      }
    };
    chart2Buffer = await renderChartToImage(chart2Config, 760, 340);
  }

  // -----------------------------------------------------------
  // FORMAT: PDF (via Puppeteer A4 print)
  // -----------------------------------------------------------
  if (format === 'pdf') {
    const chart1Base64 = chart1Buffer ? `data:image/png;base64,${Buffer.from(chart1Buffer).toString('base64')}` : '';
    const chart2Base64 = chart2Buffer ? `data:image/png;base64,${Buffer.from(chart2Buffer).toString('base64')}` : '';

    const htmlPdf = `
      <!DOCTYPE html>
      <html lang="th">
      <head>
        <meta charset="UTF-8">
        <title>${reportTitle}</title>
        <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
          @page { size: A4; margin: 18mm 15mm 20mm 15mm; }
          body { font-family: 'Sarabun', sans-serif; font-size: 13.5pt; line-height: 1.6; color: #1e293b; }
          .header-box { text-align: center; border-bottom: 2px solid #0284c7; padding-bottom: 14px; margin-bottom: 22px; }
          .title { font-size: 19pt; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
          .subtitle { font-size: 13pt; color: #475569; }
          .kpi-grid { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 22px; }
          .kpi-card { flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; text-align: center; }
          .kpi-val { font-size: 17pt; font-weight: 700; color: #0284c7; }
          .kpi-label { font-size: 10.5pt; color: #64748b; font-weight: 500; }
          .section-title { font-size: 15pt; font-weight: 700; color: #0f172a; border-left: 5px solid #0284c7; padding-left: 10px; margin: 22px 0 12px 0; }
          .chart-img { width: 100%; max-height: 320px; object-fit: contain; margin: 12px 0; border: 1px solid #e2e8f0; border-radius: 8px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11pt; }
          th { background: #f1f5f9; color: #334155; padding: 7px; border: 1px solid #cbd5e1; font-weight: 600; text-align: center; }
          td { padding: 6px 7px; border: 1px solid #cbd5e1; text-align: center; }
          tr:nth-child(even) { background: #f8fafc; }
          .page-break { page-break-before: always; }
          .footer-note { font-size: 9.5pt; color: #94a3b8; text-align: right; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="header-box">
          <div class="title">${reportTitle}</div>
          <div class="subtitle">${periodSubtitle} | องค์การบริหารส่วนจังหวัดลำปาง</div>
        </div>

        <!-- KPI Grid for Active Sections -->
        <div class="kpi-grid">
          ${activeSections.water ? `
            <div class="kpi-card">
              <div class="kpi-val">${kpi.activeStations} สถานี</div>
              <div class="kpi-label">สถานีตรวจวัดน้ำ</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-val">${kpi.provAvgWl} ม.</div>
              <div class="kpi-label">ระดับน้ำเฉลี่ย</div>
            </div>
          ` : ''}
          ${activeSections.drought ? `
            <div class="kpi-card">
              <div class="kpi-val" style="color: ${kpi.warningCounts > 0 ? '#dc2626' : '#059669'};">${kpi.warningCounts} จุด</div>
              <div class="kpi-label">จุดเฝ้าระวังตลิ่ง</div>
            </div>
          ` : ''}
          ${activeSections.riskIndex ? `
            <div class="kpi-card">
              <div class="kpi-val" style="color: ${riskSummary.color};">${riskSummary.score} / 100</div>
              <div class="kpi-label">ดัชนีความเสี่ยงรวม</div>
            </div>
          ` : ''}
          ${activeSections.water ? `
            <div class="kpi-card">
              <div class="kpi-val">${kpi.provAvgRain} มม.</div>
              <div class="kpi-label">ฝนสะสมเฉลี่ย</div>
            </div>
          ` : ''}
        </div>

        <!-- 1. Water Section -->
        ${activeSections.water ? `
          <div class="section-title">๑. สถานการณ์ระดับน้ำและปริมาณน้ำฝนรายสถานี</div>
          ${chart1Base64 ? `<img src="${chart1Base64}" class="chart-img" />` : ''}

          <table>
            <thead>
              <tr>
                <th>สถานี</th>
                <th>แม่น้ำ/ลำน้ำ</th>
                <th>อำเภอ</th>
                <th>ระดับน้ำเฉลี่ย (ม.)</th>
                <th>ระดับน้ำสูงสุด (ม.)</th>
                <th>ระดับตลิ่ง (ม.)</th>
                <th>ฝนเฉลี่ย (มม.)</th>
              </tr>
            </thead>
            <tbody>
              ${topStations.length > 0 ? topStations.map(s => `
                <tr>
                  <td style="text-align: left; font-weight: 600;">${s.station_name}</td>
                  <td>${s.river || '-'}</td>
                  <td>${s.amphoe || '-'}</td>
                  <td>${s.avg_wl}</td>
                  <td style="font-weight: 600; color: #0284c7;">${s.max_wl}</td>
                  <td>${s.bank_level || '-'}</td>
                  <td>${s.avg_rain}</td>
                </tr>
              `).join('') : `<tr><td colspan="7">ไม่พบข้อมูลการตรวจวัดน้ำในช่วงเวลานี้</td></tr>`}
            </tbody>
          </table>
        ` : ''}

        <!-- 2. Drought & Dams Section -->
        ${activeSections.drought ? `
          <div class="${activeSections.water ? 'page-break' : ''}"></div>
          <div class="section-title">๒. สถานการณ์อ่างเก็บน้ำและภัยแล้ง</div>
          ${chart2Base64 ? `<img src="${chart2Base64}" class="chart-img" />` : ''}

          <table>
            <thead>
              <tr>
                <th>ชื่ออ่างเก็บน้ำ</th>
                <th>ประเภท</th>
                <th>ความจุ (ล้าน ลบ.ม.)</th>
                <th>ปริมาณน้ำเฉลี่ย</th>
                <th>% ปริมาณน้ำ</th>
                <th>น้ำใช้การได้ (ล้าน ลบ.ม.)</th>
              </tr>
            </thead>
            <tbody>
              ${majorDams.length > 0 ? majorDams.map(d => `
                <tr>
                  <td style="text-align: left; font-weight: 600;">${d.dam_name}</td>
                  <td>${d.dam_type || '-'}</td>
                  <td>${d.capacity}</td>
                  <td style="color: #0284c7; font-weight: 600;">${d.avg_volume}</td>
                  <td style="font-weight: 600; color: ${d.avg_pct < 30 ? '#dc2626' : '#059669'};">${d.avg_pct}%</td>
                  <td>${d.avg_usable}</td>
                </tr>
              `).join('') : `<tr><td colspan="6">ไม่พบข้อมูลอ่างเก็บน้ำในช่วงเวลานี้</td></tr>`}
            </tbody>
          </table>
        ` : ''}

        <!-- 3. Composite Risk Index Section -->
        ${activeSections.riskIndex ? `
          <div class="section-title">๓. การประเมินดัชนีความเสี่ยงภัยพิบัติรวม (Composite Risk Index)</div>
          <div class="kpi-grid">
            <div class="kpi-card" style="border-left: 4px solid ${riskSummary.color};">
              <div class="kpi-val" style="color: ${riskSummary.color};">${riskSummary.score} คะแนน</div>
              <div class="kpi-label">ระดับความเสี่ยง: <strong>${riskSummary.level}</strong></div>
            </div>
            <div class="kpi-card">
              <div class="kpi-val" style="font-size: 14pt; color: #475569;">${riskSummary.threat}</div>
              <div class="kpi-label">ภัยคุกคามหลักที่ต้องเฝ้าระวัง</div>
            </div>
          </div>

          ${riskHotspots.length > 0 ? `
            <table style="margin-top: 8px;">
              <thead>
                <tr>
                  <th>ประเภท</th>
                  <th>ชื่อจุดตรวจวัด</th>
                  <th>อำเภอ</th>
                  <th>คะแนนความเสี่ยง</th>
                  <th>สถานการณ์ / ข้อมูลวิกฤต</th>
                </tr>
              </thead>
              <tbody>
                ${riskHotspots.map(h => `
                  <tr>
                    <td>${h.type}</td>
                    <td style="text-align: left; font-weight: 600;">${h.name}</td>
                    <td>${h.amphoe}</td>
                    <td style="font-weight: 700; color: #dc2626;">${h.score}</td>
                    <td style="text-align: left;">${h.detail}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<p style="font-size: 11pt; color: #64748b;">ไม่พบจุดเฝ้าระวังวิกฤต ทุกจุดตรวจวัดอยู่ในเกณฑ์สมดุล</p>'}
        ` : ''}

        <!-- 4. PM 2.5 & Complaints Section -->
        ${(activeSections.pm25 || activeSections.complaints) ? `
          <div class="section-title">๔. สรุปภาพรวมคุณภาพอากาศ (PM 2.5) และเรื่องร้องเรียนประชาชน</div>
          <div class="kpi-grid">
            ${activeSections.pm25 ? `
              <div class="kpi-card">
                <div class="kpi-val" style="color: ${kpi.avgPm25 > 37.5 ? '#eab308' : '#059669'};">${kpi.avgPm25} µg/m³</div>
                <div class="kpi-label">PM 2.5 เฉลี่ยจังหวัด</div>
              </div>
            ` : ''}
            ${activeSections.complaints ? `
              <div class="kpi-card">
                <div class="kpi-val">${kpi.totalComplaints} เรื่อง</div>
                <div class="kpi-label">เรื่องร้องเรียนทั้งหมด</div>
              </div>
              <div class="kpi-card">
                <div class="kpi-val" style="color: #059669;">${kpi.resolvedComplaints} เรื่อง</div>
                <div class="kpi-label">ดำเนินการเสร็จสิ้น</div>
              </div>
            ` : ''}
          </div>
        ` : ''}

        <div class="footer-note">
          เอกสารสร้างโดยระบบปรับแต่งรายงานผู้บริหาร (Automated Custom Report Builder) | อัปเดต ณ วันที่ ${formatThaiDate(new Date())}
        </div>
      </body>
      </html>
    `;

    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
      const page = await browser.newPage();
      await page.setContent(htmlPdf, { waitUntil: 'networkidle0' });
      await page.evaluate(async () => {
        const images = Array.from(document.querySelectorAll('img'));
        await Promise.all(images.map(img => {
          if (img.complete && img.naturalWidth > 0) return Promise.resolve();
          return new Promise(resolve => {
            img.onload = resolve;
            img.onerror = resolve;
          });
        }));
      });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' }
      });

      const filename = period === 'custom'
        ? `Executive_Report_Custom_${startDateStr.split(' ')[0]}_to_${endDateStr.split(' ')[0]}.pdf`
        : `Executive_Report_${period}_${startDateStr.split(' ')[0]}.pdf`;

      return {
        buffer: Buffer.from(pdfBuffer),
        filename,
        contentType: 'application/pdf'
      };
    } finally {
      if (browser) await browser.close();
    }
  }

  // -----------------------------------------------------------
  // FORMAT: DOCX (via docx library)
  // -----------------------------------------------------------
  const FONT = 'TH SarabunPSK';
  const docxChildren = [
    // Title
    new Paragraph({
      children: [new TextRun({ text: reportTitle, font: FONT, size: 36, bold: true, color: '0F172A' })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 100, after: 60 }
    }),
    new Paragraph({
      children: [new TextRun({ text: `${periodSubtitle} | องค์การบริหารส่วนจังหวัดลำปาง`, font: FONT, size: 28, color: '475569' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 }
    }),

    // KPI Box
    new Paragraph({
      children: [
        ...(activeSections.water ? [
          new TextRun({ text: `• ระดับน้ำเฉลี่ย: ${kpi.provAvgWl} ม.   |   `, font: FONT, size: 26, bold: true }),
          new TextRun({ text: `• ฝนเฉลี่ย: ${kpi.provAvgRain} มม.   |   `, font: FONT, size: 26, bold: true, color: '0284C7' })
        ] : []),
        ...(activeSections.riskIndex ? [
          new TextRun({ text: `• ดัชนีความเสี่ยงรวม: ${riskSummary.score}/100 (${riskSummary.level})   |   `, font: FONT, size: 26, bold: true, color: 'DC2626' })
        ] : []),
        ...(activeSections.drought ? [
          new TextRun({ text: `• จุดเฝ้าระวังตลิ่ง: ${kpi.warningCounts} จุด`, font: FONT, size: 26 })
        ] : [])
      ],
      shading: { type: ShadingType.SOLID, color: 'F1F5F9', fill: 'F1F5F9' },
      spacing: { before: 80, after: 200 }
    })
  ];

  // Section 1: Water
  if (activeSections.water) {
    docxChildren.push(
      new Paragraph({
        children: [new TextRun({ text: '๑. สถานการณ์ระดับน้ำและปริมาณน้ำฝนรายสถานี', font: FONT, size: 32, bold: true, color: '0284C7' })],
        spacing: { before: 150, after: 100 }
      })
    );
    if (chart1Buffer && chart1Buffer.length > 0) {
      docxChildren.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: chart1Buffer,
              transformation: { width: 580, height: 260 }
            })
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 150 }
        })
      );
    }
    docxChildren.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: ['สถานี', 'ลำน้ำ', 'อำเภอ', 'ระดับน้ำเฉลี่ย', 'ระดับสูงสุด', 'ระดับตลิ่ง'].map(h => new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: h, font: FONT, size: 24, bold: true })], alignment: AlignmentType.CENTER })],
              shading: { type: ShadingType.SOLID, color: 'E2E8F0', fill: 'E2E8F0' }
            }))
          }),
          ...(topStations.length > 0 ? topStations.map(s => new TableRow({
            children: [
              s.station_name || '-', s.river || '-', s.amphoe || '-',
              String(s.avg_wl ?? '-'), String(s.max_wl ?? '-'), String(s.bank_level || '-')
            ].map(val => new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: val, font: FONT, size: 24 })], alignment: AlignmentType.CENTER })]
            }))
          })) : [
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: 'ไม่พบข้อมูลการตรวจวัดระดับน้ำในช่วงเวลานี้', font: FONT, size: 24, italics: true, color: '64748B' })], alignment: AlignmentType.CENTER })],
                  columnSpan: 6
                })
              ]
            })
          ])
        ]
      })
    );
  }

  // Section 2: Drought & Dams
  if (activeSections.drought) {
    if (activeSections.water) {
      docxChildren.push(new Paragraph({ children: [new PageBreak()] }));
    }
    docxChildren.push(
      new Paragraph({
        children: [new TextRun({ text: '๒. สถานการณ์อ่างเก็บน้ำและภัยแล้ง', font: FONT, size: 32, bold: true, color: '0284C7' })],
        spacing: { before: 150, after: 100 }
      })
    );
    if (chart2Buffer && chart2Buffer.length > 0) {
      docxChildren.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: chart2Buffer,
              transformation: { width: 580, height: 260 }
            })
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 150 }
        })
      );
    }
    docxChildren.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: ['ชื่ออ่างเก็บน้ำ', 'ประเภท', 'ความจุ (ล้าน ลบ.ม.)', 'ปริมาณน้ำเฉลี่ย', '% น้ำ', 'น้ำใช้การได้'].map(h => new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: h, font: FONT, size: 24, bold: true })], alignment: AlignmentType.CENTER })],
              shading: { type: ShadingType.SOLID, color: 'E2E8F0', fill: 'E2E8F0' }
            }))
          }),
          ...(majorDams.length > 0 ? majorDams.map(d => new TableRow({
            children: [
              d.dam_name || '-', d.dam_type || '-', String(d.capacity ?? '-'),
              String(d.avg_volume ?? '-'), `${d.avg_pct ?? 0}%`, String(d.avg_usable ?? '-')
            ].map(val => new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: val, font: FONT, size: 24 })], alignment: AlignmentType.CENTER })]
            }))
          })) : [
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: 'ไม่พบข้อมูลอ่างเก็บน้ำในช่วงเวลานี้', font: FONT, size: 24, italics: true, color: '64748B' })], alignment: AlignmentType.CENTER })],
                  columnSpan: 6
                })
              ]
            })
          ])
        ]
      })
    );
  }

  // Section 3: Risk Index
  if (activeSections.riskIndex) {
    docxChildren.push(
      new Paragraph({
        children: [new TextRun({ text: '๓. การประเมินดัชนีความเสี่ยงภัยพิบัติรวม (Composite Risk Index)', font: FONT, size: 32, bold: true, color: '0284C7' })],
        spacing: { before: 200, after: 100 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: `• คะแนนความเสี่ยงรวมทั้งจังหวัด: ${riskSummary.score}/100 ระดับ: ${riskSummary.level}\n`, font: FONT, size: 28, bold: true }),
          new TextRun({ text: `• ภัยคุกคามหลัก: ${riskSummary.threat}`, font: FONT, size: 28 })
        ],
        spacing: { after: 120 }
      })
    );
    if (riskHotspots.length > 0) {
      docxChildren.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: ['ประเภท', 'ชื่อจุดตรวจวัด', 'อำเภอ', 'คะแนนความเสี่ยง', 'สถานการณ์วิกฤต'].map(h => new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: h, font: FONT, size: 24, bold: true })], alignment: AlignmentType.CENTER })],
                shading: { type: ShadingType.SOLID, color: 'E2E8F0', fill: 'E2E8F0' }
              }))
            }),
            ...riskHotspots.map(h => new TableRow({
              children: [
                h.type, h.name, h.amphoe, String(h.score), h.detail
              ].map(val => new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: val, font: FONT, size: 24 })], alignment: AlignmentType.CENTER })]
              }))
            }))
          ]
        })
      );
    }
  }

  // Section 4: PM 2.5 and Complaints
  if (activeSections.pm25 || activeSections.complaints) {
    docxChildren.push(
      new Paragraph({
        children: [new TextRun({ text: '๔. สรุปภาพรวมคุณภาพอากาศ (PM 2.5) และเรื่องร้องเรียนประชาชน', font: FONT, size: 32, bold: true, color: '0284C7' })],
        spacing: { before: 250, after: 100 }
      })
    );
    if (activeSections.pm25) {
      docxChildren.push(
        new Paragraph({
          children: [
            new TextRun({ text: `• คุณภาพอากาศ (PM 2.5): ค่าเฉลี่ยทั้งจังหวัดอยู่ที่ ${kpi.avgPm25} µg/m³ จัดอยู่ในเกณฑ์มาตรฐานความปลอดภัย`, font: FONT, size: 28 })
          ],
          spacing: { after: 60 }
        })
      );
    }
    if (activeSections.complaints) {
      docxChildren.push(
        new Paragraph({
          children: [
            new TextRun({ text: `• เรื่องร้องเรียน Traffy Fondue: มีเรื่องร้องเรียนทั้งสิ้น ${kpi.totalComplaints} เรื่อง ดำเนินการแล้วเสร็จ ${kpi.resolvedComplaints} เรื่อง`, font: FONT, size: 28 })
          ],
          spacing: { after: 150 }
        })
      );
    }
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(0.8),
            bottom: convertInchesToTwip(0.8),
            left: convertInchesToTwip(0.8),
            right: convertInchesToTwip(0.8)
          }
        }
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              children: [new TextRun({ text: `${reportTitle} — อบจ.ลำปาง`, font: FONT, size: 22, color: '888888' })],
              alignment: AlignmentType.RIGHT
            })
          ]
        })
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: 'หน้า ', font: FONT, size: 22 }),
                new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 22 })
              ],
              alignment: AlignmentType.CENTER
            })
          ]
        })
      },
      children: docxChildren
    }]
  });

  const docxBuffer = await Packer.toBuffer(doc);
  const filename = period === 'custom'
    ? `Executive_Report_Custom_${startDateStr.split(' ')[0]}_to_${endDateStr.split(' ')[0]}.docx`
    : `Executive_Report_${period}_${startDateStr.split(' ')[0]}.docx`;

  return {
    buffer: docxBuffer,
    filename,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
}
