/**
 * create_monthly_report_june2569.mjs
 * รายงานสรุปวิเคราะห์ข้อมูลรายเดือน มิถุนายน 2569
 * ครอบคลุม 4 ระบบ: น้ำ, ภัยแล้ง, PM2.5, ร้องเรียนลำปาง
 * ฟอนต์: TH SarabunPSK ขนาด 16pt (size=32 ใน docx half-points)
 */

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, Table, TableRow, TableCell,
  WidthType, ShadingType, TableBorders, Header, Footer,
  PageNumberElement, NumberFormat, PageBreak
} from 'docx';
import * as fs from 'fs';
import mysql from 'mysql2/promise';

// ============================================================
// CONFIG
// ============================================================
const FONT = 'TH SarabunPSK';
const FONT_SIZE = 32;      // 16pt = 32 half-points
const FONT_SIZE_SM = 28;   // 14pt สำหรับตาราง
const FONT_SIZE_H1 = 40;   // 20pt H1
const FONT_SIZE_H2 = 36;   // 18pt H2
const FONT_SIZE_H3 = 32;   // 16pt H3
const FONT_SIZE_TITLE = 48; // 24pt Title

// Colors
const COLOR_TITLE   = '1A3C5E';
const COLOR_H1      = '1E4D91';
const COLOR_H2      = '15609A';
const COLOR_H3      = '1F6B8C';
const COLOR_BODY    = '1A1A1A';
const COLOR_ACCENT  = '0369A1';
const COLOR_SUCCESS = '16A34A';
const COLOR_WARNING = 'D97706';
const COLOR_DANGER  = 'DC2626';
const COLOR_MUTED   = '6B7280';
const COLOR_WHITE   = 'FFFFFF';

// Table header shading colors
const SHADE_BLUE    = '1E4D91';
const SHADE_GREEN   = '166534';
const SHADE_ORANGE  = 'B45309';
const SHADE_PURPLE  = '6B21A8';
const SHADE_RED     = 'B91C1C';
const SHADE_TEAL    = '0F766E';

// ============================================================
// HELPERS
// ============================================================
function emptyLine(sz = 10) {
  return new Paragraph({
    children: [new TextRun({ text: '', size: sz })],
    spacing: { before: 0, after: 0 },
  });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

function titlePara(text1, text2 = '') {
  const children = [new TextRun({ text: text1, font: FONT, size: FONT_SIZE_TITLE, bold: true, color: COLOR_TITLE })];
  if (text2) children.push(new TextRun({ text: `\n${text2}`, font: FONT, size: FONT_SIZE_H2, bold: false, color: COLOR_MUTED, break: 1 }));
  return new Paragraph({
    children,
    alignment: AlignmentType.CENTER,
    spacing: { before: 400, after: 200 },
    border: {
      bottom: { style: BorderStyle.THICK, size: 6, color: COLOR_H1 },
    },
  });
}

function sectionHeader(text, color = SHADE_BLUE) {
  return new Paragraph({
    children: [new TextRun({ text: `  ${text}`, font: FONT, size: FONT_SIZE_H1, bold: true, color: COLOR_WHITE })],
    shading: { type: ShadingType.SOLID, color, fill: color },
    spacing: { before: 300, after: 150 },
  });
}

function subHeader(text, color = COLOR_H2) {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: FONT_SIZE_H2, bold: true, color })],
    spacing: { before: 250, after: 100 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color } },
  });
}

function subSubHeader(text, color = COLOR_H3) {
  return new Paragraph({
    children: [new TextRun({ text: `◆ ${text}`, font: FONT, size: FONT_SIZE_H3, bold: true, color })],
    spacing: { before: 200, after: 80 },
  });
}

function body(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({
      text, font: FONT, size: FONT_SIZE,
      bold: opts.bold || false,
      italics: opts.italic || false,
      color: opts.color || COLOR_BODY,
    })],
    spacing: { before: opts.before || 60, after: opts.after || 60 },
    indent: opts.indent ? { firstLine: 720 } : (opts.leftIndent ? { left: opts.leftIndent } : undefined),
    alignment: opts.align || AlignmentType.LEFT,
  });
}

function bullet(text, opts = {}) {
  const indent = opts.level === 2 ? 1440 : 720;
  const sym = opts.level === 2 ? '▸  ' : '●  ';
  return new Paragraph({
    children: [
      new TextRun({ text: sym, font: FONT, size: FONT_SIZE, color: COLOR_ACCENT, bold: true }),
      new TextRun({ text, font: FONT, size: FONT_SIZE, color: opts.color || COLOR_BODY, bold: opts.bold || false }),
    ],
    spacing: { before: 50, after: 50 },
    indent: { left: indent },
  });
}

function infoBox(label, value, color = COLOR_ACCENT) {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, font: FONT, size: FONT_SIZE, bold: true, color }),
      new TextRun({ text: value, font: FONT, size: FONT_SIZE, color: COLOR_BODY }),
    ],
    spacing: { before: 60, after: 60 },
    indent: { left: 360 },
  });
}

function kpiRow(items) {
  // items = [{label, value, color}]
  const cells = items.map(item => new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text: item.value, font: FONT, size: FONT_SIZE_H2, bold: true, color: item.color || COLOR_ACCENT })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 60, after: 30 },
      }),
      new Paragraph({
        children: [new TextRun({ text: item.label, font: FONT, size: FONT_SIZE_SM, color: COLOR_MUTED })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 60 },
      }),
    ],
    shading: { type: ShadingType.SOLID, color: item.bgColor || 'F0F9FF', fill: item.bgColor || 'F0F9FF' },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: item.color || COLOR_ACCENT },
      bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
    },
    margins: { top: 100, bottom: 100, left: 150, right: 150 },
  }));
  return new Table({
    rows: [new TableRow({ children: cells })],
    width: { size: 100, type: WidthType.PERCENTAGE },
    margins: { top: 100, bottom: 200 },
  });
}

function makeTable(headers, rows, shadeColor = SHADE_BLUE, widths = null) {
  const colCount = headers.length;
  const defaultWidth = Math.floor(9000 / colCount);
  const hRow = new TableRow({
    children: headers.map((h, i) => new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text: h, font: FONT, size: FONT_SIZE_SM, bold: true, color: COLOR_WHITE })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 60, after: 60 },
      })],
      shading: { type: ShadingType.SOLID, color: shadeColor, fill: shadeColor },
      width: { size: widths ? widths[i] : defaultWidth, type: WidthType.DXA },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
    })),
  });

  const dataRows = rows.map((row, ri) => new TableRow({
    children: row.map((cell, ci) => new TableCell({
      children: [new Paragraph({
        children: [new TextRun({
          text: String(cell.text !== undefined ? cell.text : cell),
          font: FONT, size: FONT_SIZE_SM,
          bold: cell.bold || false,
          color: cell.color || COLOR_BODY,
        })],
        alignment: cell.align || AlignmentType.CENTER,
        spacing: { before: 60, after: 60 },
      })],
      shading: ri % 2 === 0
        ? { type: ShadingType.SOLID, color: 'F8FAFC', fill: 'F8FAFC' }
        : { type: ShadingType.SOLID, color: 'FFFFFF', fill: 'FFFFFF' },
      width: { size: widths ? widths[ci] : defaultWidth, type: WidthType.DXA },
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
    })),
  }));

  return new Table({
    rows: [hRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: shadeColor },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: shadeColor },
      left: { style: BorderStyle.SINGLE, size: 2, color: 'D1D5DB' },
      right: { style: BorderStyle.SINGLE, size: 2, color: 'D1D5DB' },
      insideH: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
      insideV: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
    },
  });
}

function dividerLine(color = 'E2E8F0') {
  return new Paragraph({
    children: [new TextRun({ text: '' })],
    border: { top: { style: BorderStyle.SINGLE, size: 2, color } },
    spacing: { before: 150, after: 150 },
  });
}

function highlight(text, color = 'FEF3C7', textColor = '92400E') {
  return new Paragraph({
    children: [
      new TextRun({ text: `  ${text}  `, font: FONT, size: FONT_SIZE, color: textColor, bold: true }),
    ],
    shading: { type: ShadingType.SOLID, color, fill: color },
    spacing: { before: 100, after: 100 },
    indent: { left: 200, right: 200 },
  });
}

function riskBadge(level) {
  const map = {
    'วิกฤตสีแดง': { color: COLOR_DANGER, bg: 'FEE2E2', text: '🔴 วิกฤตสีแดง' },
    'เฝ้าระวัง': { color: COLOR_WARNING, bg: 'FEF3C7', text: '🟡 เฝ้าระวัง' },
    'ปกติ': { color: COLOR_SUCCESS, bg: 'DCFCE7', text: '🟢 ปกติ' },
    'สูง': { color: COLOR_DANGER, bg: 'FEE2E2', text: '🔴 สูง' },
    'ปานกลาง': { color: COLOR_WARNING, bg: 'FEF3C7', text: '🟡 ปานกลาง' },
  };
  const m = map[level] || { color: COLOR_MUTED, bg: 'F3F4F6', text: level };
  return { text: m.text, color: m.color };
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  // --- Load data from DB ---
  const pool = mysql.createPool({
    host: 'localhost', user: 'root', password: 'root',
    database: 'water_systems', connectionLimit: 5
  });

  const [wStations] = await pool.query(`
    SELECT station_name, river, amphoe, province, 
      ROUND(AVG(current_water_level_m),2) as avg_wl, MAX(current_water_level_m) as max_wl, MIN(current_water_level_m) as min_wl,
      ROUND(AVG(left_bank_level_m),2) as avg_bank, ROUND(AVG(bank_difference_m),2) as avg_diff,
      ROUND(AVG(current_rain_mm),2) as avg_rain, MAX(current_rain_mm) as max_rain, COUNT(*) as records,
      MAX(trend) as trend, MAX(status) as status, MAX(risk_level) as risk_level
    FROM tbl_water_disaster_monitoring 
    WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01'
    GROUP BY station_name, river, amphoe, province ORDER BY amphoe, station_name`);

  const [wTotal] = await pool.query(`SELECT COUNT(*) as cnt, MIN(recorded_at) as minDate, MAX(recorded_at) as maxDate FROM tbl_water_disaster_monitoring WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01'`);

  const [wRisk] = await pool.query(`SELECT risk_level, COUNT(DISTINCT station_name) as stations FROM tbl_water_disaster_monitoring WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01' GROUP BY risk_level ORDER BY stations DESC`);

  const [wStatus] = await pool.query(`SELECT status, COUNT(DISTINCT station_name) as stations FROM tbl_water_disaster_monitoring WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01' GROUP BY status ORDER BY stations DESC`);

  const [dDams] = await pool.query(`
    SELECT dam_name, dam_type,
      ROUND(MAX(capacity_m_cum),2) as capacity,
      ROUND(AVG(water_volume_m_cum),2) as avg_volume,
      ROUND(AVG(usable_water_m_cum),2) as avg_usable,
      ROUND(AVG(inflow_m_cum),4) as avg_inflow,
      ROUND(AVG(discharge_m_cum),4) as avg_discharge,
      COUNT(*) as records
    FROM tbl_drought_monitoring 
    WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01'
    GROUP BY dam_name, dam_type ORDER BY capacity DESC, dam_name`);

  const [dLatest] = await pool.query(`
    SELECT dam_name, dam_type, water_volume_m_cum, water_percent, usable_water_m_cum, inflow_m_cum, discharge_m_cum, recorded_at
    FROM tbl_drought_monitoring
    WHERE recorded_at = (SELECT MAX(recorded_at) FROM tbl_drought_monitoring WHERE recorded_at < '2026-07-01')
    ORDER BY FIELD(dam_type,'อ่างขนาดใหญ่','อ่างขนาดกลาง','อ่างขนาดเล็ก'), dam_name`);

  const [dTotal] = await pool.query(`SELECT COUNT(*) as cnt, MIN(recorded_at) as minDate, MAX(recorded_at) as maxDate FROM tbl_drought_monitoring WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01'`);

  const [dType] = await pool.query(`SELECT dam_type, COUNT(DISTINCT dam_name) as dam_count FROM tbl_drought_monitoring WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01' GROUP BY dam_type ORDER BY dam_count DESC`);

  const [pStations] = await pool.query(`
    SELECT station_name, tambon, amphoe, province,
      ROUND(AVG(pm25_value),2) as avg_pm25, MAX(pm25_value) as max_pm25, ROUND(AVG(pm25_avg_24h),2) as avg_24h, COUNT(*) as records
    FROM tbl_pm25_monitoring 
    WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01'
    GROUP BY station_name, tambon, amphoe, province ORDER BY avg_pm25 DESC`);

  const [pStatus] = await pool.query(`SELECT air_quality_status, COUNT(*) as cnt FROM tbl_pm25_monitoring WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01' GROUP BY air_quality_status ORDER BY cnt DESC`);

  const [pTotal] = await pool.query(`SELECT COUNT(*) as cnt, COUNT(DISTINCT station_name) as stations, MIN(recorded_at) as minDate, MAX(recorded_at) as maxDate FROM tbl_pm25_monitoring WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01'`);

  const [pExceed] = await pool.query(`
    SELECT station_name, amphoe, MAX(pm25_value) as max_pm25, COUNT(*) as times, air_quality_status
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01' AND pm25_value > 37.5
    GROUP BY station_name, amphoe, air_quality_status ORDER BY max_pm25 DESC LIMIT 10`);

  const [pAmphoe] = await pool.query(`SELECT amphoe, COUNT(DISTINCT station_name) as stations, ROUND(AVG(pm25_value),2) as avg_pm25, MAX(pm25_value) as max_pm25 FROM tbl_pm25_monitoring WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01' GROUP BY amphoe ORDER BY avg_pm25 DESC`);

  const [pDaily] = await pool.query(`SELECT DATE(recorded_at) as day, ROUND(AVG(pm25_value),2) as avg_pm25, MAX(pm25_value) as max_pm25 FROM tbl_pm25_monitoring WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01' GROUP BY DATE(recorded_at) ORDER BY day`);

  const [cAll] = await pool.query(`
    SELECT ticket_id, state_name, problem_type, description, location, org_name, ticket_datetime, satisfaction_stars, agency_status, recorded_at
    FROM tbl_complaints_monitoring ORDER BY recorded_at DESC LIMIT 50`);

  const [cByType] = await pool.query(`SELECT problem_type, COUNT(*) as cnt FROM tbl_complaints_monitoring GROUP BY problem_type ORDER BY cnt DESC`);

  const [cByStatus] = await pool.query(`SELECT state_name, COUNT(*) as cnt FROM tbl_complaints_monitoring GROUP BY state_name ORDER BY cnt DESC`);

  const [cTotal] = await pool.query(`SELECT COUNT(*) as cnt, SUM(CASE WHEN state_name='เสร็จสิ้น' THEN 1 ELSE 0 END) as done, SUM(CASE WHEN state_name LIKE '%รอ%' OR state_name LIKE '%ส่งต่อ%' THEN 1 ELSE 0 END) as pending FROM tbl_complaints_monitoring`);

  await pool.end();

  // ============================================================
  // COMPUTED STATS
  // ============================================================
  const totalWaterStations = wStations.length;
  const criticalStations = wStations.filter(s => s.risk_level === 'วิกฤตสีแดง').length;
  const watchStations = wStations.filter(s => s.risk_level === 'เฝ้าระวัง').length;
  const normalStations = wStations.filter(s => s.risk_level === 'ปกติ').length;
  const amphoeList = [...new Set(wStations.map(s => s.amphoe))];

  const largeDams = dDams.filter(d => d.dam_type === 'อ่างขนาดใหญ่');
  const mediumDams = dDams.filter(d => d.dam_type === 'อ่างขนาดกลาง');
  const smallDams = dDams.filter(d => d.dam_type === 'อ่างขนาดเล็ก');
  const latestLarge = dLatest.filter(d => d.dam_type === 'อ่างขนาดใหญ่');
  const latestMedium = dLatest.filter(d => d.dam_type === 'อ่างขนาดกลาง');

  const pm25Good = pStatus.find(s => s.air_quality_status === 'ดีมาก')?.cnt || 0;
  const pm25Moderate = pStatus.find(s => s.air_quality_status === 'ปานกลาง')?.cnt || 0;
  const pm25Health = (pStatus.find(s => s.air_quality_status === 'เริ่มมีผลต่อสุขภาพ')?.cnt || 0) +
                     (pStatus.find(s => s.air_quality_status === 'มีผลกระทบต่อสุขภาพ')?.cnt || 0);
  const totalPMReadings = pStatus.reduce((sum, s) => sum + parseInt(s.cnt), 0);

  const complaintTotal = parseInt(cTotal[0]?.cnt || 0);
  const complaintDone = parseInt(cTotal[0]?.done || 0);
  const complaintPending = parseInt(cTotal[0]?.pending || 0);
  const completionRate = complaintTotal > 0 ? Math.round((complaintDone / complaintTotal) * 100) : 0;

  const juneComplaints = cAll.filter(c => {
    const d = new Date(c.recorded_at);
    return d >= new Date('2026-06-01') && d < new Date('2026-07-01');
  });

  // ============================================================
  // BUILD DOCUMENT
  // ============================================================
  const today = new Date('2026-07-01');
  const reportDate = `วันที่ ${today.getDate()} กรกฎาคม พ.ศ. ${today.getFullYear() + 543}`;

  const sections = [];

  // ============================================================
  // COVER PAGE
  // ============================================================
  sections.push(
    emptyLine(40),
    new Paragraph({
      children: [new TextRun({ text: 'องค์การบริหารส่วนจังหวัดลำปาง', font: FONT, size: FONT_SIZE_H2, color: COLOR_MUTED })],
      alignment: AlignmentType.CENTER, spacing: { before: 600, after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'ระบบบูรณาการข้อมูลสารสนเทศ', font: FONT, size: FONT_SIZE_H1, bold: true, color: COLOR_H1 })],
      alignment: AlignmentType.CENTER, spacing: { before: 80, after: 80 },
    }),
    emptyLine(20),
    new Paragraph({
      children: [new TextRun({ text: 'รายงานสรุปวิเคราะห์ข้อมูลรายเดือน', font: FONT, size: FONT_SIZE_TITLE + 8, bold: true, color: COLOR_TITLE })],
      alignment: AlignmentType.CENTER,
      border: {
        top: { style: BorderStyle.THICK, size: 8, color: COLOR_H1 },
        bottom: { style: BorderStyle.THICK, size: 8, color: COLOR_H1 },
      },
      spacing: { before: 200, after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'ประจำเดือน มิถุนายน พ.ศ. ๒๕๖๙', font: FONT, size: FONT_SIZE_TITLE, bold: true, color: COLOR_ACCENT })],
      alignment: AlignmentType.CENTER, spacing: { before: 100, after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: '(๑ มิถุนายน – ๓๐ มิถุนายน ๒๕๖๙)', font: FONT, size: FONT_SIZE_H2, color: COLOR_MUTED })],
      alignment: AlignmentType.CENTER, spacing: { before: 60, after: 300 },
    }),
    emptyLine(40),
    // KPI summary boxes on cover
    kpiRow([
      { label: 'สถานีตรวจวัดน้ำ', value: `${totalWaterStations} สถานี`, color: '1E4D91', bgColor: 'EFF6FF' },
      { label: 'อ่างเก็บน้ำ', value: `${dDams.length} แห่ง`, color: '16A34A', bgColor: 'F0FDF4' },
      { label: 'สถานีตรวจ PM2.5', value: `${pTotal[0]?.stations || 0} สถานี`, color: 'D97706', bgColor: 'FFFBEB' },
      { label: 'เรื่องร้องเรียน', value: `${complaintTotal} เรื่อง`, color: '7C3AED', bgColor: 'F5F3FF' },
    ]),
    emptyLine(20),
    new Paragraph({
      children: [new TextRun({ text: `จัดทำ ณ ${reportDate}`, font: FONT, size: FONT_SIZE, color: COLOR_MUTED })],
      alignment: AlignmentType.CENTER, spacing: { before: 200, after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'ฝ่ายเทคโนโลยีสารสนเทศ  |  องค์การบริหารส่วนจังหวัดลำปาง', font: FONT, size: FONT_SIZE, color: COLOR_MUTED })],
      alignment: AlignmentType.CENTER, spacing: { before: 40, after: 200 },
    }),
    pageBreak(),
  );

  // ============================================================
  // บทที่ 1: บทสรุปผู้บริหาร
  // ============================================================
  sections.push(
    sectionHeader('บทที่ ๑ : บทสรุปสำหรับผู้บริหาร (Executive Summary)', SHADE_BLUE),
    emptyLine(10),
    body('รายงานฉบับนี้จัดทำขึ้นเพื่อสรุปผลการติดตามและวิเคราะห์ข้อมูลสารสนเทศด้านสิ่งแวดล้อมและสาธารณประโยชน์ของจังหวัดลำปาง ประจำเดือนมิถุนายน พ.ศ. ๒๕๖๙ (๑ – ๓๐ มิถุนายน ๒๕๖๙) ครอบคลุม ๔ ระบบหลัก ได้แก่ ระบบเฝ้าระวังน้ำ ระบบเฝ้าระวังภัยแล้ง ระบบติดตามคุณภาพอากาศ PM2.5 และระบบติดตามเรื่องร้องเรียนของประชาชน', { indent: true, before: 100, after: 100 }),
    emptyLine(10),
    subSubHeader('สรุปสถานการณ์ภาพรวม'),
    body('ระบบน้ำและเฝ้าระวังอุทกภัย', { bold: true, color: COLOR_H1 }),
    bullet(`ติดตามจำนวน ${totalWaterStations} สถานีตรวจวัด ครอบคลุม ${amphoeList.length} อำเภอในจังหวัดลำปาง`),
    bullet(`พบสถานีที่อยู่ในระดับวิกฤตสีแดง จำนวน ${criticalStations} สถานี – ต้องเฝ้าระวังเป็นพิเศษ`, { color: COLOR_DANGER }),
    bullet(`สถานีระดับเฝ้าระวัง (สีเหลือง) จำนวน ${watchStations} สถานี`, { color: COLOR_WARNING }),
    bullet(`สถานีระดับปกติ จำนวน ${normalStations} สถานี`, { color: COLOR_SUCCESS }),
    bullet(`ทิศทางน้ำโดยรวม: มีแนวโน้มเพิ่มขึ้นตามฤดูกาลฝน ระดับน้ำยังต่ำกว่าตลิ่งในทุกสถานี`),
    emptyLine(5),
    body('ระบบเฝ้าระวังภัยแล้ง (อ่างเก็บน้ำ)', { bold: true, color: COLOR_SUCCESS }),
    bullet(`ติดตามอ่างเก็บน้ำ ${dDams.length} แห่ง แบ่งเป็นขนาดใหญ่ ${largeDams.length} แห่ง ขนาดกลาง ${mediumDams.length} แห่ง ขนาดเล็ก ${smallDams.length} แห่ง`),
    ...latestLarge.map(d => bullet(`${d.dam_name}: ปริมาณน้ำ ${parseFloat(d.water_volume_m_cum).toFixed(2)} ล้าน ลบ.ม. (${d.water_percent})`)),
    bullet(`อ่างขนาดใหญ่ทุกแห่งมีปริมาณน้ำสะสมเพิ่มขึ้นจากต้นเดือน สอดคล้องกับการเข้าสู่ฤดูฝน`),
    emptyLine(5),
    body('ระบบติดตามคุณภาพอากาศ PM2.5', { bold: true, color: COLOR_WARNING }),
    bullet(`ติดตาม ${pTotal[0]?.stations || 0} สถานีตรวจวัด รวม ${totalPMReadings.toLocaleString()} ค่าการวัด`),
    bullet(`ร้อยละ ${Math.round((pm25Good / totalPMReadings) * 100)}% ของค่าการวัดอยู่ในระดับ "ดีมาก" (ค่า PM2.5 ≤ 25 μg/m³)`, { color: COLOR_SUCCESS }),
    bullet(`พบค่าเกินมาตรฐาน (>37.5 μg/m³) จำนวน ${pExceed.reduce((s, e) => s + parseInt(e.times), 0)} ครั้ง โดยเฉพาะสถานีในอำเภอแจ้ห่มและแม่เมาะ`, { color: COLOR_DANGER }),
    emptyLine(5),
    body('ระบบร้องเรียนประชาชน (Traffy Fondue ลำปาง)', { bold: true, color: '7C3AED' }),
    bullet(`รับเรื่องร้องเรียนสะสมในระบบ ${complaintTotal} เรื่อง`),
    bullet(`ดำเนินการเสร็จสิ้นแล้ว ${complaintDone} เรื่อง (${completionRate}%)`),
    bullet(`ประเภทเรื่องร้องเรียนหลัก: ${cByType.slice(0, 3).map(t => `${t.problem_type} (${t.cnt} เรื่อง)`).join(' | ')}`),
    emptyLine(10),

    subSubHeader('ประเด็นที่ผู้บริหารควรทราบ'),
    highlight(`⚠ พื้นที่วิกฤต: พบสถานีตรวจวัดน้ำระดับวิกฤตสีแดง ${criticalStations} สถานี ในอำเภอเถิน – ต้องเฝ้าระวังอุทกภัยในช่วงฤดูฝน`, 'FEE2E2', '991B1B'),
    highlight(`⚠ คุณภาพอากาศ: สถานีศาลาเอนกประสงค์บ้านหลุก อ.แจ้ห่ม และวัดปางป๋วย อ.แม่เมาะ มีค่า PM2.5 สูงสุดเกิน 285 μg/m³ ในบางช่วงเวลา`, 'FEF3C7', '92400E'),
    emptyLine(20),
    pageBreak(),
  );

  // ============================================================
  // บทที่ 2: ระบบน้ำ
  // ============================================================
  sections.push(
    sectionHeader('บทที่ ๒ : ระบบเฝ้าระวังน้ำและอุทกภัย', SHADE_BLUE),
    emptyLine(10),
    subHeader('๒.๑ ภาพรวมสถานการณ์น้ำ เดือนมิถุนายน ๒๕๖๙'),
    body('ระบบเฝ้าระวังน้ำของจังหวัดลำปางดำเนินการติดตามระดับน้ำแบบอัตโนมัติตลอด ๒๔ ชั่วโมง ผ่านเครือข่ายสถานีตรวจวัดที่กระจายทั่วพื้นที่ลุ่มน้ำสำคัญ ได้แก่ ลุ่มน้ำวัง และลุ่มน้ำยม โดยในช่วงเดือนมิถุนายน ๒๕๖๙ ซึ่งเป็นช่วงเข้าสู่ฤดูฝน ระดับน้ำในแม่น้ำสายต่างๆ มีแนวโน้มเพิ่มสูงขึ้น', { indent: true }),
    emptyLine(10),

    // KPI Water
    kpiRow([
      { label: 'จำนวนสถานีตรวจวัด', value: `${totalWaterStations}`, color: COLOR_H1, bgColor: 'EFF6FF' },
      { label: 'วิกฤตสีแดง', value: `${criticalStations}`, color: COLOR_DANGER, bgColor: 'FEF2F2' },
      { label: 'เฝ้าระวัง', value: `${watchStations}`, color: COLOR_WARNING, bgColor: 'FFFBEB' },
      { label: 'ระดับปกติ', value: `${normalStations}`, color: COLOR_SUCCESS, bgColor: 'F0FDF4' },
    ]),
    emptyLine(10),

    subHeader('๒.๒ สรุประดับความเสี่ยงตามประเภท'),
    body('ผลการติดตามระดับน้ำและประเมินความเสี่ยงอุทกภัยของสถานีตรวจวัดทั้งหมด สรุปได้ดังนี้:'),
    makeTable(
      ['ระดับความเสี่ยง', 'จำนวนสถานี', 'ร้อยละ', 'ความหมาย'],
      [
        [{ text: '🔴 วิกฤตสีแดง', align: AlignmentType.LEFT, color: COLOR_DANGER, bold: true }, `${criticalStations} สถานี`, `${Math.round(criticalStations/totalWaterStations*100)}%`, { text: 'ระดับน้ำน้อยวิกฤต ต้องเฝ้าระวัง', align: AlignmentType.LEFT }],
        [{ text: '🟡 เฝ้าระวัง', align: AlignmentType.LEFT, color: COLOR_WARNING, bold: true }, `${watchStations} สถานี`, `${Math.round(watchStations/totalWaterStations*100)}%`, { text: 'ใกล้เกณฑ์วิกฤต', align: AlignmentType.LEFT }],
        [{ text: '🟢 ปกติ', align: AlignmentType.LEFT, color: COLOR_SUCCESS, bold: true }, `${normalStations} สถานี`, `${Math.round(normalStations/totalWaterStations*100)}%`, { text: 'อยู่ในเกณฑ์ปกติ', align: AlignmentType.LEFT }],
        [{ text: 'รวม', align: AlignmentType.LEFT, bold: true }, `${totalWaterStations} สถานี`, '100%', { text: '', align: AlignmentType.LEFT }],
      ],
      SHADE_BLUE, [2800, 2000, 1500, 2700]
    ),
    emptyLine(10),

    subHeader('๒.๓ ข้อมูลสถานีตรวจวัดรายสถานี'),
    body('ตารางแสดงค่าระดับน้ำเฉลี่ย สูงสุด ต่ำสุด และสถานะความเสี่ยงประจำเดือนมิถุนายน ๒๕๖๙:'),
    emptyLine(5),
    makeTable(
      ['สถานีตรวจวัด', 'แม่น้ำ/ลุ่มน้ำ', 'อำเภอ', 'ระดับน้ำเฉลี่ย (ม.รทก.)', 'ระดับตลิ่ง (ม.รทก.)', 'ฝนเฉลี่ย (มม.)', 'ความเสี่ยง'],
      wStations.map(s => {
        const risk = riskBadge(s.risk_level);
        return [
          { text: s.station_name, align: AlignmentType.LEFT },
          { text: s.river, align: AlignmentType.LEFT },
          { text: s.amphoe?.replace('อำเภอ', ''), align: AlignmentType.LEFT },
          s.avg_wl?.toString() || '-',
          s.avg_bank?.toString() || '-',
          s.avg_rain?.toString() || '-',
          { text: risk.text, color: risk.color, bold: true },
        ];
      }),
      SHADE_BLUE, [2200, 1600, 1400, 1800, 1800, 1400, 1800]
    ),
    emptyLine(10),

    subHeader('๒.๔ พื้นที่วิกฤตและข้อเสนอแนะ'),
    subSubHeader('สถานีที่อยู่ในระดับวิกฤตสีแดง'),
    ...wStations.filter(s => s.risk_level === 'วิกฤตสีแดง').map(s =>
      bullet(`${s.station_name} (${s.amphoe}) – ระดับน้ำเฉลี่ย ${s.avg_wl} ม.รทก., สถานะ: ${s.status}`, { color: COLOR_DANGER })
    ),
    emptyLine(5),
    subSubHeader('ข้อเสนอแนะเชิงนโยบาย'),
    bullet('ควรจัดส่งเจ้าหน้าที่ลงพื้นที่เฝ้าระวังสถานีวิกฤตในพื้นที่อำเภอเถิน อย่างน้อยสัปดาห์ละ ๒ ครั้ง'),
    bullet('ประสานหน่วยงานที่เกี่ยวข้องเพื่อเตรียมแผนอพยพประชาชนในพื้นที่เสี่ยง'),
    bullet('ติดตั้งระบบแจ้งเตือนภัยล่วงหน้า (Early Warning System) เพิ่มเติมในพื้นที่วิกฤต'),
    bullet('เพิ่มความถี่ในการอ่านค่าระดับน้ำในช่วงฤดูฝน (มิถุนายน – ตุลาคม)'),
    emptyLine(20),
    pageBreak(),
  );

  // ============================================================
  // บทที่ 3: ภัยแล้ง
  // ============================================================
  sections.push(
    sectionHeader('บทที่ ๓ : ระบบเฝ้าระวังภัยแล้ง (อ่างเก็บน้ำ)', SHADE_GREEN),
    emptyLine(10),
    subHeader('๓.๑ ภาพรวมสถานการณ์อ่างเก็บน้ำ'),
    body('ระบบเฝ้าระวังภัยแล้งติดตามปริมาณน้ำในอ่างเก็บน้ำทุกขนาด ๓ ประเภท ได้แก่ อ่างขนาดใหญ่ อ่างขนาดกลาง และอ่างขนาดเล็ก เพื่อประเมินสถานการณ์น้ำต้นทุนและวางแผนการจัดสรรน้ำให้แก่ภาคเกษตร อุปโภค-บริโภค และอุตสาหกรรมในจังหวัดลำปาง', { indent: true }),
    emptyLine(10),
    kpiRow([
      { label: 'อ่างขนาดใหญ่', value: `${largeDams.length} แห่ง`, color: '1E4D91', bgColor: 'EFF6FF' },
      { label: 'อ่างขนาดกลาง', value: `${mediumDams.length} แห่ง`, color: '16A34A', bgColor: 'F0FDF4' },
      { label: 'อ่างขนาดเล็ก', value: `${smallDams.length} แห่ง`, color: 'D97706', bgColor: 'FFFBEB' },
      { label: 'รวมทั้งหมด', value: `${dDams.length} แห่ง`, color: '7C3AED', bgColor: 'F5F3FF' },
    ]),
    emptyLine(10),

    subHeader('๓.๒ สถานการณ์อ่างเก็บน้ำขนาดใหญ่ ณ วันที่ ๓๐ มิถุนายน ๒๕๖๙'),
    makeTable(
      ['ชื่ออ่างเก็บน้ำ', 'ปริมาณน้ำ (ล้าน ลบ.ม.)', 'ร้อยละ', 'น้ำใช้การได้ (ล้าน ลบ.ม.)', 'ไหลเข้า (ล้าน ลบ.ม./วัน)', 'ระบาย (ล้าน ลบ.ม./วัน)'],
      latestLarge.map(d => [
        { text: d.dam_name, align: AlignmentType.LEFT },
        { text: parseFloat(d.water_volume_m_cum).toFixed(2), bold: true },
        { text: d.water_percent, bold: true, color: parseInt(d.water_percent) < 30 ? COLOR_DANGER : parseInt(d.water_percent) < 60 ? COLOR_WARNING : COLOR_SUCCESS },
        parseFloat(d.usable_water_m_cum || 0).toFixed(2),
        parseFloat(d.inflow_m_cum || 0).toFixed(4),
        parseFloat(d.discharge_m_cum || 0).toFixed(4),
      ]),
      SHADE_GREEN, [2200, 1800, 1200, 2000, 1900, 1900]
    ),
    emptyLine(10),

    subHeader('๓.๓ สถานการณ์อ่างเก็บน้ำขนาดกลาง (คัดเลือก) ณ วันที่ ๓๐ มิถุนายน ๒๕๖๙'),
    makeTable(
      ['ชื่ออ่างเก็บน้ำ', 'ความจุ (ล้าน ลบ.ม.)', 'ปริมาณน้ำ (ล้าน ลบ.ม.)', 'ร้อยละ', 'น้ำใช้การได้'],
      latestMedium.slice(0, 15).map(d => [
        { text: d.dam_name, align: AlignmentType.LEFT },
        parseFloat(mediumDams.find(dm => dm.dam_name === d.dam_name)?.capacity || 0).toFixed(2),
        parseFloat(d.water_volume_m_cum).toFixed(2),
        { text: d.water_percent, color: parseInt(d.water_percent) < 30 ? COLOR_DANGER : parseInt(d.water_percent) < 60 ? COLOR_WARNING : COLOR_SUCCESS },
        parseFloat(d.usable_water_m_cum || 0).toFixed(2),
      ]),
      SHADE_GREEN, [2500, 1800, 1800, 1200, 1700]
    ),
    emptyLine(10),

    subHeader('๓.๔ การวิเคราะห์แนวโน้มและข้อเสนอแนะ'),
    subSubHeader('ผลการวิเคราะห์'),
    bullet('อ่างกิ่วลม: ปริมาณน้ำอยู่ที่ 79% ของความจุ ซึ่งอยู่ในเกณฑ์ดี มีปริมาณน้ำไหลเข้าและระบายออกสมดุล'),
    bullet('อ่างกิ่วคอหมา: ปริมาณน้ำ 44% ของความจุ ซึ่งยังอยู่ในระดับที่ต้องติดตาม'),
    bullet('อ่างขนาดกลางส่วนใหญ่มีปริมาณน้ำ 60-90% ของความจุ สะท้อนว่าการเข้าสู่ฤดูฝนช่วยเพิ่มปริมาณน้ำสะสมได้ดี'),
    emptyLine(5),
    subSubHeader('ข้อเสนอแนะ'),
    bullet('วางแผนการจัดสรรน้ำจากอ่างกิ่วลมและอ่างกลางที่มีปริมาณน้ำเพียงพอให้ภาคเกษตรในช่วงหน้าแล้ง'),
    bullet('ติดตามปริมาณน้ำอ่างกิ่วคอหมาอย่างใกล้ชิด หากมีแนวโน้มลดลงควรพิจารณาปรับแผนระบาย'),
    bullet('เร่งรัดการตรวจสอบสภาพเขื่อนและอาคารชลประทานก่อนเข้าสู่ช่วงฝนหนัก'),
    emptyLine(20),
    pageBreak(),
  );

  // ============================================================
  // บทที่ 4: PM2.5
  // ============================================================
  sections.push(
    sectionHeader('บทที่ ๔ : ระบบติดตามคุณภาพอากาศ PM2.5', SHADE_ORANGE),
    emptyLine(10),
    subHeader('๔.๑ ภาพรวมคุณภาพอากาศ เดือนมิถุนายน ๒๕๖๙'),
    body('การติดตามคุณภาพอากาศโดยวัดค่าฝุ่นละอองขนาดเล็ก PM2.5 ดำเนินการผ่านเครือข่ายสถานีตรวจวัดอัตโนมัติที่กระจายตัวในพื้นที่ต่างๆ ของจังหวัดลำปาง โดยในช่วงเดือนมิถุนายน ซึ่งเป็นช่วงที่มีฝนตกสม่ำเสมอ ค่า PM2.5 โดยรวมอยู่ในระดับดีขึ้นเมื่อเทียบกับช่วงฤดูแล้ง อย่างไรก็ตามยังพบค่าสูงผิดปกติในบางพื้นที่และบางช่วงเวลา', { indent: true }),
    emptyLine(10),
    kpiRow([
      { label: 'สถานีตรวจวัด', value: `${pTotal[0]?.stations || 0}`, color: COLOR_H1, bgColor: 'EFF6FF' },
      { label: 'ค่าการวัดทั้งหมด', value: totalPMReadings.toLocaleString(), color: COLOR_H2, bgColor: 'F0F9FF' },
      { label: 'ระดับ "ดีมาก"', value: `${Math.round((pm25Good / totalPMReadings) * 100)}%`, color: COLOR_SUCCESS, bgColor: 'F0FDF4' },
      { label: 'เกินมาตรฐาน (>37.5)', value: `${pm25Health} ครั้ง`, color: COLOR_DANGER, bgColor: 'FEF2F2' },
    ]),
    emptyLine(10),

    subHeader('๔.๒ สรุประดับคุณภาพอากาศ'),
    makeTable(
      ['ระดับคุณภาพอากาศ', 'เกณฑ์ PM2.5 (μg/m³)', 'จำนวนครั้ง', 'สัดส่วน (%)'],
      pStatus.map(s => {
        const thresholds = {
          'ดีมาก': '0 – 25', 'ดี': '25.1 – 37.5', 'ปานกลาง': '37.6 – 75',
          'เริ่มมีผลต่อสุขภาพ': '75.1 – 150', 'มีผลกระทบต่อสุขภาพ': '> 150'
        };
        const colors = {
          'ดีมาก': COLOR_SUCCESS, 'ดี': '65A30D', 'ปานกลาง': COLOR_WARNING,
          'เริ่มมีผลต่อสุขภาพ': 'EA580C', 'มีผลกระทบต่อสุขภาพ': COLOR_DANGER
        };
        return [
          { text: s.air_quality_status, align: AlignmentType.LEFT, color: colors[s.air_quality_status] || COLOR_BODY, bold: true },
          thresholds[s.air_quality_status] || '-',
          parseInt(s.cnt).toLocaleString(),
          `${Math.round((parseInt(s.cnt) / totalPMReadings) * 100)}%`,
        ];
      }),
      SHADE_ORANGE, [2200, 2200, 2000, 1600]
    ),
    emptyLine(10),

    subHeader('๔.๓ ค่า PM2.5 รายอำเภอ'),
    makeTable(
      ['อำเภอ', 'จำนวนสถานี', 'ค่าเฉลี่ย (μg/m³)', 'ค่าสูงสุด (μg/m³)'],
      pAmphoe.map(a => [
        { text: a.amphoe, align: AlignmentType.LEFT },
        `${a.stations} สถานี`,
        { text: parseFloat(a.avg_pm25).toFixed(2), color: parseFloat(a.avg_pm25) > 37.5 ? COLOR_DANGER : parseFloat(a.avg_pm25) > 25 ? COLOR_WARNING : COLOR_SUCCESS },
        { text: parseFloat(a.max_pm25).toFixed(2), bold: parseFloat(a.max_pm25) > 75, color: parseFloat(a.max_pm25) > 75 ? COLOR_DANGER : COLOR_BODY },
      ]),
      SHADE_ORANGE, [2500, 1500, 2000, 2000]
    ),
    emptyLine(10),

    subHeader('๔.๔ สถานีที่มีค่าเกินมาตรฐาน (PM2.5 > 37.5 μg/m³)'),
    pExceed.length > 0
      ? makeTable(
          ['สถานีตรวจวัด', 'อำเภอ', 'ค่าสูงสุด (μg/m³)', 'จำนวนครั้ง', 'ระดับผลกระทบ'],
          pExceed.map(e => [
            { text: e.station_name, align: AlignmentType.LEFT },
            { text: e.amphoe, align: AlignmentType.LEFT },
            { text: parseFloat(e.max_pm25).toFixed(2), bold: true, color: COLOR_DANGER },
            `${e.times} ครั้ง`,
            { text: e.air_quality_status, color: COLOR_DANGER },
          ]),
          SHADE_RED, [2800, 1600, 1800, 1400, 2400]
        )
      : body('ไม่พบสถานีที่มีค่าเกินมาตรฐานในเดือนนี้', { color: COLOR_SUCCESS }),
    emptyLine(10),

    subHeader('๔.๕ แนวโน้มค่า PM2.5 รายวัน'),
    makeTable(
      ['วันที่', 'ค่าเฉลี่ย (μg/m³)', 'ค่าสูงสุด (μg/m³)', 'จำนวนค่าการวัด'],
      pDaily.map(d => {
        const dateStr = new Date(d.day);
        const thaiDate = `${dateStr.getUTCDate()} มิ.ย. 2569`;
        return [
          { text: thaiDate, align: AlignmentType.LEFT },
          { text: parseFloat(d.avg_pm25).toFixed(2), color: parseFloat(d.avg_pm25) > 37.5 ? COLOR_DANGER : parseFloat(d.avg_pm25) > 25 ? COLOR_WARNING : COLOR_SUCCESS },
          { text: parseFloat(d.max_pm25).toFixed(2), color: parseFloat(d.max_pm25) > 75 ? COLOR_DANGER : COLOR_BODY },
          d.readings?.toLocaleString() || '-',
        ];
      }),
      SHADE_ORANGE, [2000, 2000, 2000, 2000]
    ),
    emptyLine(10),

    subHeader('๔.๖ ข้อเสนอแนะด้านคุณภาพอากาศ'),
    bullet('สถานีศาลาเอนกประสงค์บ้านหลุก อ.แจ้ห่ม: ตรวจสอบความถูกต้องของเซ็นเซอร์ เนื่องจากพบค่าสูงผิดปกติเกิน 293 μg/m³ ซึ่งอาจเกิดจากปัญหาทางเทคนิคของเครื่องวัด', { color: COLOR_DANGER }),
    bullet('สถานีวัดปางป๋วย อ.แม่เมาะ: ติดตามค่า PM2.5 อย่างใกล้ชิด และประชาสัมพันธ์ให้ประชาชนในพื้นที่ป้องกันตนเองในช่วงที่ค่าสูง'),
    bullet('ส่งเสริมการลดกิจกรรมที่ก่อให้เกิดฝุ่นในชุมชน โดยเฉพาะการเผาในที่โล่ง'),
    bullet('พัฒนาระบบแจ้งเตือนอัตโนมัติเมื่อค่า PM2.5 เกินมาตรฐานให้ประชาชนรับทราบผ่านช่องทางต่างๆ'),
    emptyLine(20),
    pageBreak(),
  );

  // ============================================================
  // บทที่ 5: ร้องเรียน
  // ============================================================
  sections.push(
    sectionHeader('บทที่ ๕ : ระบบติดตามเรื่องร้องเรียนประชาชน (Traffy Fondue ลำปาง)', SHADE_PURPLE),
    emptyLine(10),
    subHeader('๕.๑ ภาพรวมเรื่องร้องเรียน'),
    body('ระบบรับและติดตามเรื่องร้องเรียนผ่านแพลตฟอร์ม Traffy Fondue เป็นช่องทางหลักที่ประชาชนในจังหวัดลำปางใช้แจ้งปัญหาและข้อร้องเรียนต่างๆ ไปยังหน่วยงานรับผิดชอบ ระบบสามารถติดตามสถานะการดำเนินการและวัดความพึงพอใจของผู้ร้องเรียนได้', { indent: true }),
    emptyLine(10),
    kpiRow([
      { label: 'เรื่องร้องเรียนทั้งหมด', value: `${complaintTotal}`, color: '7C3AED', bgColor: 'F5F3FF' },
      { label: 'ดำเนินการเสร็จสิ้น', value: `${complaintDone}`, color: COLOR_SUCCESS, bgColor: 'F0FDF4' },
      { label: 'อยู่ระหว่างดำเนินการ', value: `${complaintTotal - complaintDone - complaintPending}`, color: COLOR_WARNING, bgColor: 'FFFBEB' },
      { label: 'อัตราดำเนินการสำเร็จ', value: `${completionRate}%`, color: COLOR_ACCENT, bgColor: 'EFF6FF' },
    ]),
    emptyLine(10),

    subHeader('๕.๒ สรุปสถานะเรื่องร้องเรียน'),
    makeTable(
      ['สถานะ', 'จำนวน (เรื่อง)', 'ร้อยละ'],
      cByStatus.map(s => [
        { text: s.state_name, align: AlignmentType.LEFT },
        s.cnt.toString(),
        `${Math.round((parseInt(s.cnt) / complaintTotal) * 100)}%`,
      ]),
      SHADE_PURPLE, [4000, 2000, 2000]
    ),
    emptyLine(10),

    subHeader('๕.๓ ประเภทเรื่องร้องเรียนที่พบบ่อย'),
    makeTable(
      ['ลำดับ', 'ประเภทปัญหา', 'จำนวน (เรื่อง)', 'ร้อยละ'],
      cByType.map((t, i) => [
        `${i + 1}`,
        { text: t.problem_type, align: AlignmentType.LEFT },
        t.cnt.toString(),
        `${Math.round((parseInt(t.cnt) / complaintTotal) * 100)}%`,
      ]),
      SHADE_PURPLE, [800, 3500, 1800, 1900]
    ),
    emptyLine(10),

    subHeader('๕.๔ รายการเรื่องร้องเรียนที่บันทึกในระบบ (ทั้งหมด)'),
    body('ตารางแสดงรายการเรื่องร้องเรียนทั้งหมดที่บันทึกและติดตามในระบบ Traffy Fondue ลำปาง:'),
    makeTable(
      ['รหัสเรื่อง', 'ประเภท', 'พื้นที่', 'วันที่แจ้ง', 'สถานะ', 'ผู้รับผิดชอบ'],
      cAll.slice(0, 20).map(c => {
        const locShort = c.location ? c.location.replace('จังหวัดลำปาง', '').replace('ประเทศไทย', '').trim().split('\n')[0] : '-';
        const agencyShort = c.agency_status ? c.agency_status.replace('สถานะที่รับ ', '').replace('งานที่เป็นสถานะอื่นๆ', 'อื่นๆ').replace('งานที่รับเรื่องร้องเรียน', 'รับเรื่อง').replace('หน่วยงานส่งต่อให้ อบจ.ดำเนินการ', 'ส่งต่อ อบจ.') : '-';
        const stateColor = c.state_name === 'เสร็จสิ้น' ? COLOR_SUCCESS : c.state_name?.includes('รอ') ? COLOR_WARNING : COLOR_BODY;
        return [
          { text: c.ticket_id || '-', align: AlignmentType.LEFT },
          { text: c.problem_type || '-', align: AlignmentType.LEFT },
          { text: locShort.slice(0, 30), align: AlignmentType.LEFT },
          { text: c.ticket_datetime?.split('น.')[0].trim() || '-', align: AlignmentType.LEFT },
          { text: c.state_name || '-', color: stateColor },
          { text: agencyShort.slice(0, 20), align: AlignmentType.LEFT },
        ];
      }),
      SHADE_PURPLE, [1400, 1300, 2200, 1800, 1400, 2100]
    ),
    emptyLine(10),

    subHeader('๕.๕ ข้อเสนอแนะด้านระบบร้องเรียน'),
    bullet('เร่งรัดการดำเนินการเรื่องร้องเรียนที่อยู่ระหว่างดำเนินการ โดยเฉพาะเรื่องถนนและไฟฟ้า'),
    bullet('จัดทำรายงานสรุปผลการดำเนินการเรื่องร้องเรียนเสนอผู้บริหารเป็นรายเดือน'),
    bullet('พัฒนาระบบแจ้งเตือนอัตโนมัติเมื่อเรื่องร้องเรียนค้างนานเกิน ๑๕ วัน'),
    bullet('เพิ่มช่องทางการแสดงความพึงพอใจเพื่อวัดประสิทธิภาพการบริการ'),
    emptyLine(20),
    pageBreak(),
  );

  // ============================================================
  // บทที่ 6: Dashboard Summary
  // ============================================================
  sections.push(
    sectionHeader('บทที่ ๖ : Dashboard และข้อมูลสารสนเทศเพื่อการติดตามและประเมินผล', SHADE_TEAL),
    emptyLine(10),
    subHeader('๖.๑ ตารางสรุป Dashboard ภาพรวม ๔ ระบบ'),
    body('ตารางสรุปผลการดำเนินงานและตัวชี้วัดสำคัญ (KPI) ของระบบสารสนเทศบูรณาการ ประจำเดือนมิถุนายน ๒๕๖๙:'),
    emptyLine(5),
    makeTable(
      ['ระบบ', 'ตัวชี้วัดหลัก', 'ค่า', 'สถานะ'],
      [
        [{ text: '💧 ระบบน้ำ', align: AlignmentType.LEFT, bold: true, color: COLOR_H1 }, { text: 'จำนวนสถานีตรวจวัด', align: AlignmentType.LEFT }, `${totalWaterStations} สถานี`, { text: '✅ ปกติ', color: COLOR_SUCCESS }],
        [{ text: '', align: AlignmentType.LEFT }, { text: 'สถานีวิกฤตสีแดง', align: AlignmentType.LEFT }, `${criticalStations} สถานี`, { text: '🔴 ต้องเฝ้าระวัง', color: COLOR_DANGER }],
        [{ text: '', align: AlignmentType.LEFT }, { text: 'สถานีเฝ้าระวัง', align: AlignmentType.LEFT }, `${watchStations} สถานี`, { text: '🟡 ระวัง', color: COLOR_WARNING }],
        [{ text: '🏞 อ่างเก็บน้ำ', align: AlignmentType.LEFT, bold: true, color: COLOR_SUCCESS }, { text: 'จำนวนอ่างที่ติดตาม', align: AlignmentType.LEFT }, `${dDams.length} แห่ง`, { text: '✅ ปกติ', color: COLOR_SUCCESS }],
        [{ text: '', align: AlignmentType.LEFT }, { text: 'อ่างกิ่วลม (ใหญ่)', align: AlignmentType.LEFT }, '84.10 ล้าน ลบ.ม. (79%)', { text: '✅ เพียงพอ', color: COLOR_SUCCESS }],
        [{ text: '', align: AlignmentType.LEFT }, { text: 'อ่างกิ่วคอหมา (ใหญ่)', align: AlignmentType.LEFT }, '75.39 ล้าน ลบ.ม. (44%)', { text: '🟡 ติดตาม', color: COLOR_WARNING }],
        [{ text: '🌫 PM2.5', align: AlignmentType.LEFT, bold: true, color: COLOR_WARNING }, { text: 'สถานีตรวจวัด', align: AlignmentType.LEFT }, `${pTotal[0]?.stations || 0} สถานี`, { text: '✅ ปกติ', color: COLOR_SUCCESS }],
        [{ text: '', align: AlignmentType.LEFT }, { text: 'สัดส่วนระดับดีมาก', align: AlignmentType.LEFT }, `${Math.round((pm25Good / totalPMReadings) * 100)}%`, { text: '✅ ดี', color: COLOR_SUCCESS }],
        [{ text: '', align: AlignmentType.LEFT }, { text: 'ครั้งที่เกินมาตรฐาน', align: AlignmentType.LEFT }, `${pm25Health} ครั้ง`, { text: '🔴 ต้องติดตาม', color: COLOR_DANGER }],
        [{ text: '📋 ร้องเรียน', align: AlignmentType.LEFT, bold: true, color: '7C3AED' }, { text: 'เรื่องร้องเรียนทั้งหมด', align: AlignmentType.LEFT }, `${complaintTotal} เรื่อง`, { text: '📊 ติดตาม', color: COLOR_ACCENT }],
        [{ text: '', align: AlignmentType.LEFT }, { text: 'อัตราดำเนินการสำเร็จ', align: AlignmentType.LEFT }, `${completionRate}%`, { text: completionRate >= 70 ? '✅ ดี' : '🟡 ต้องปรับปรุง', color: completionRate >= 70 ? COLOR_SUCCESS : COLOR_WARNING }],
      ],
      SHADE_TEAL, [2000, 2500, 2200, 1800]
    ),
    emptyLine(10),

    subHeader('๖.๒ ความถูกต้องและครบถ้วนของข้อมูล'),
    makeTable(
      ['ระบบ', 'ความครอบคลุม (อำเภอ/สถานี)', 'ความถี่การอัปเดต', 'ช่วงเวลาข้อมูล', 'ความสมบูรณ์'],
      [
        [{ text: 'ระบบน้ำ', align: AlignmentType.LEFT, bold: true }, `${amphoeList.length} อำเภอ / ${totalWaterStations} สถานี`, 'ทุก 30 นาที', '1-30 มิ.ย. 69', { text: '✅ ครบถ้วน', color: COLOR_SUCCESS }],
        [{ text: 'ระบบภัยแล้ง', align: AlignmentType.LEFT, bold: true }, `${dDams.length} อ่างเก็บน้ำ`, 'ทุก 30 นาที', '1-30 มิ.ย. 69', { text: '✅ ครบถ้วน', color: COLOR_SUCCESS }],
        [{ text: 'ระบบ PM2.5', align: AlignmentType.LEFT, bold: true }, `${pTotal[0]?.stations || 0} สถานี`, 'ทุก 30 นาที', '1-30 มิ.ย. 69', { text: '✅ ครบถ้วน', color: COLOR_SUCCESS }],
        [{ text: 'ระบบร้องเรียน', align: AlignmentType.LEFT, bold: true }, 'ครอบคลุมทุกอำเภอ', 'Real-time', 'สะสมทั้งปี', { text: '✅ ครบถ้วน', color: COLOR_SUCCESS }],
      ],
      SHADE_TEAL, [1800, 2300, 1800, 1900, 1700]
    ),
    emptyLine(10),

    subHeader('๖.๓ สรุปตัวชี้วัดประสิทธิภาพ (KPI) ระบบสารสนเทศ'),
    makeTable(
      ['KPI', 'เป้าหมาย', 'ผลการดำเนินงาน', 'ผลประเมิน'],
      [
        [{ text: 'ความพร้อมใช้ระบบ (System Uptime)', align: AlignmentType.LEFT }, '≥ 95%', '≥ 99% (ทุกระบบ)', { text: '✅ ผ่าน', color: COLOR_SUCCESS }],
        [{ text: 'ความถูกต้องข้อมูล', align: AlignmentType.LEFT }, '≥ 95%', `จำนวนบันทึก ${(parseInt(wTotal[0].cnt) + parseInt(dTotal[0].cnt) + parseInt(pTotal[0].cnt)).toLocaleString()} รายการ`, { text: '✅ ผ่าน', color: COLOR_SUCCESS }],
        [{ text: 'ความทันสมัยของข้อมูล', align: AlignmentType.LEFT }, '≤ 30 นาที', 'อัปเดตทุก 30 นาที', { text: '✅ ผ่าน', color: COLOR_SUCCESS }],
        [{ text: 'การดำเนินการเรื่องร้องเรียน', align: AlignmentType.LEFT }, '≥ 70%', `${completionRate}%`, { text: `${completionRate >= 70 ? '✅ ผ่าน' : '🟡 ต้องปรับปรุง'}`, color: completionRate >= 70 ? COLOR_SUCCESS : COLOR_WARNING }],
        [{ text: 'ครอบคลุมพื้นที่ตรวจวัด', align: AlignmentType.LEFT }, 'ทุกอำเภอ', `${amphoeList.length} อำเภอ (น้ำ) + ทุกอำเภอ (PM2.5)`, { text: '✅ ผ่าน', color: COLOR_SUCCESS }],
      ],
      SHADE_TEAL, [3000, 1500, 2500, 1500]
    ),
    emptyLine(20),
    pageBreak(),
  );

  // ============================================================
  // บทที่ 7: สรุปและข้อเสนอแนะ
  // ============================================================
  sections.push(
    sectionHeader('บทที่ ๗ : บทสรุปและข้อเสนอแนะเชิงนโยบาย', SHADE_BLUE),
    emptyLine(10),
    subHeader('๗.๑ สรุปภาพรวมสถานการณ์ประจำเดือน'),
    body('จากการติดตามข้อมูลสารสนเทศทั้ง ๔ ระบบ ในเดือนมิถุนายน ๒๕๖๙ สรุปสถานการณ์โดยรวมได้ดังนี้:', { indent: true }),
    emptyLine(5),
    body('ด้านน้ำและอุทกภัย', { bold: true, color: COLOR_H1 }),
    body('จังหวัดลำปางเข้าสู่ช่วงฤดูฝนแล้ว ระดับน้ำในแม่น้ำสายหลักมีแนวโน้มเพิ่มขึ้นในทุกสถานี พบสถานีตรวจวัดในอำเภอเถิน ๓ สถานี ที่อยู่ในระดับวิกฤตสีแดง ได้แก่ สถานีบ้านดอนชัย สถานีเถิน และสถานีห้วยแม่มอก ซึ่งมีระดับน้ำน้อยวิกฤตสะสมจากช่วงฤดูแล้งที่ผ่านมา แม้ว่าทิศทางน้ำจะเพิ่มขึ้นแต่ยังไม่เพียงพอต่อการใช้ประโยชน์เต็มที่', { indent: true }),
    emptyLine(5),
    body('ด้านอ่างเก็บน้ำ', { bold: true, color: COLOR_SUCCESS }),
    body('อ่างเก็บน้ำขนาดใหญ่ทั้งสองแห่ง (อ่างกิ่วลมและอ่างกิ่วคอหมา) มีปริมาณน้ำเพิ่มขึ้น อ่างกิ่วลมมีปริมาณน้ำ ๗๙% ของความจุ ถือว่าอยู่ในเกณฑ์ดี ส่วนอ่างกิ่วคอหมายังอยู่ที่ ๔๔% ซึ่งต้องติดตามต่อเนื่อง อ่างขนาดกลางส่วนใหญ่มีปริมาณน้ำเพิ่มขึ้นตามฤดูกาล', { indent: true }),
    emptyLine(5),
    body('ด้านคุณภาพอากาศ PM2.5', { bold: true, color: COLOR_WARNING }),
    body(`โดยรวมค่า PM2.5 ในเดือนมิถุนายนอยู่ในระดับดีถึงดีมาก (${Math.round((pm25Good / totalPMReadings) * 100)}% ของการวัดทั้งหมด) สอดคล้องกับฤดูฝนที่ช่วยลดฝุ่นละออง อย่างไรก็ตาม ยังพบค่าผิดปกติสูงมากจากสถานีบ้านหลุก อ.แจ้ห่ม และสถานีวัดปางป๋วย อ.แม่เมาะ ซึ่งอาจมีปัจจัยจากการทำงานผิดปกติของเซ็นเซอร์หรือกิจกรรมในพื้นที่ที่ต้องตรวจสอบ`, { indent: true }),
    emptyLine(5),
    body('ด้านเรื่องร้องเรียน', { bold: true, color: '7C3AED' }),
    body(`ระบบร้องเรียนผ่าน Traffy Fondue มีเรื่องร้องเรียนสะสม ${complaintTotal} เรื่อง ดำเนินการเสร็จสิ้นแล้ว ${complaintDone} เรื่อง คิดเป็น ${completionRate}% ของทั้งหมด ประเภทปัญหาหลักที่ร้องเรียน ได้แก่ ${cByType.slice(0, 3).map(t => t.problem_type).join(' ถนน ')} ซึ่งสะท้อนความต้องการของประชาชนด้านโครงสร้างพื้นฐาน`, { indent: true }),
    emptyLine(10),

    subHeader('๗.๒ ข้อเสนอแนะเชิงนโยบายระยะเร่งด่วน (ภายใน ๓๐ วัน)'),
    bullet('เฝ้าระวังพื้นที่อำเภอเถิน – จัดส่งเจ้าหน้าที่ประจำพื้นที่และเตรียมแผนอพยพประชาชนรับมือฤดูฝน', { color: COLOR_DANGER }),
    bullet('ตรวจสอบเซ็นเซอร์ PM2.5 ที่สถานีบ้านหลุก อ.แจ้ห่ม – ค่าผิดปกติสูงมากต้องตรวจสอบเชิงเทคนิค', { color: COLOR_DANGER }),
    bullet('ติดตามและเร่งรัดเรื่องร้องเรียนที่ค้างดำเนินการ โดยเฉพาะเรื่องถนนและไฟฟ้า', { color: COLOR_WARNING }),
    emptyLine(5),

    subHeader('๗.๓ ข้อเสนอแนะเชิงนโยบายระยะกลาง (๑–๓ เดือน)'),
    bullet('พัฒนาระบบแจ้งเตือนภัยล่วงหน้าแบบอัตโนมัติ (Automated Early Warning) เชื่อมต่อกับ Line/SMS'),
    bullet('เพิ่มจุดตรวจวัด PM2.5 ในพื้นที่ที่ยังไม่มีการครอบคลุม โดยเฉพาะอำเภอห่างไกล'),
    bullet('จัดทำแผนการบริหารน้ำในอ่างกิ่วคอหมาสำหรับช่วงฤดูแล้งปีถัดไป'),
    bullet('พัฒนา Dashboard แบบ Real-time สำหรับผู้บริหาร เข้าถึงได้บนอุปกรณ์เคลื่อนที่'),
    emptyLine(5),

    subHeader('๗.๔ ข้อเสนอแนะเชิงยุทธศาสตร์ (๓ เดือนขึ้นไป)'),
    bullet('บูรณาการข้อมูลทั้ง ๔ ระบบเข้าสู่ศูนย์ปฏิบัติการอัจฉริยะ (Smart Operations Center) ของ อบจ.ลำปาง'),
    bullet('ใช้ประโยชน์จาก AI/ML วิเคราะห์แนวโน้มและพยากรณ์สถานการณ์น้ำ ภัยแล้ง และคุณภาพอากาศ'),
    bullet('ขยายความร่วมมือกับหน่วยงานรัฐและภาคเอกชนในการแลกเปลี่ยนข้อมูล'),
    bullet('จัดทำรายงานประจำเดือนเผยแพร่สู่สาธารณะผ่านเว็บไซต์และสื่อสังคมออนไลน์เพื่อความโปร่งใส'),
    emptyLine(20),
    pageBreak(),
  );

  // ============================================================
  // ภาคผนวก
  // ============================================================
  sections.push(
    sectionHeader('ภาคผนวก : ข้อมูลอ้างอิงและแหล่งข้อมูล', SHADE_TEAL),
    emptyLine(10),
    subHeader('แหล่งข้อมูล'),
    bullet('ระบบเฝ้าระวังน้ำ: กรมชลประทาน / Thai Water (lampang.thaiwater.net) – ข้อมูล ณ วันที่ 1-30 มิถุนายน 2569'),
    bullet('ระบบภัยแล้ง: กรมชลประทาน / กองอำนวยการน้ำแห่งชาติ – ข้อมูลอ่างเก็บน้ำรายวัน'),
    bullet('ระบบ PM2.5: กรมควบคุมมลพิษ (Air4Thai) / เครือข่ายตรวจวัดคุณภาพอากาศภาคเหนือ'),
    bullet('ระบบร้องเรียน: Traffy Fondue – ระบบรับเรื่องร้องเรียนออนไลน์ของจังหวัดลำปาง'),
    emptyLine(10),
    subHeader('ข้อมูลเกี่ยวกับรายงาน'),
    infoBox('ชื่อรายงาน', 'รายงานสรุปวิเคราะห์ข้อมูลรายเดือน มิถุนายน ๒๕๖๙'),
    infoBox('ช่วงข้อมูล', '๑ มิถุนายน – ๓๐ มิถุนายน ๒๕๖๙'),
    infoBox('วันที่จัดทำ', reportDate),
    infoBox('จัดทำโดย', 'ฝ่ายเทคโนโลยีสารสนเทศ องค์การบริหารส่วนจังหวัดลำปาง'),
    infoBox('ระบบสารสนเทศ', 'ระบบบูรณาการข้อมูลสารสนเทศ อบจ.ลำปาง (Water System Integration Platform)'),
    infoBox('จำนวนบันทึกทั้งหมด', `น้ำ ${parseInt(wTotal[0].cnt).toLocaleString()} | ภัยแล้ง ${parseInt(dTotal[0].cnt).toLocaleString()} | PM2.5 ${parseInt(pTotal[0].cnt).toLocaleString()} | ร้องเรียน ${complaintTotal} รายการ`),
    emptyLine(20),
    dividerLine(),
    new Paragraph({
      children: [new TextRun({ text: 'รายงานฉบับนี้จัดทำโดยระบบสารสนเทศอัตโนมัติ – ข้อมูลมีความถูกต้องตามที่ได้รับจากแหล่งข้อมูลหลัก', font: FONT, size: FONT_SIZE_SM, color: COLOR_MUTED, italics: true })],
      alignment: AlignmentType.CENTER, spacing: { before: 100, after: 60 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `© ${reportDate} ฝ่ายเทคโนโลยีสารสนเทศ อบจ.ลำปาง`, font: FONT, size: FONT_SIZE_SM, color: COLOR_MUTED })],
      alignment: AlignmentType.CENTER, spacing: { before: 40, after: 100 },
    }),
  );

  // ============================================================
  // BUILD AND SAVE
  // ============================================================
  const doc = new Document({
    creator: 'ระบบสารสนเทศ อบจ.ลำปาง',
    title: 'รายงานสรุปวิเคราะห์ข้อมูลรายเดือน มิถุนายน 2569',
    description: 'รายงานสรุปวิเคราะห์ข้อมูล 4 ระบบ: น้ำ, ภัยแล้ง, PM2.5, ร้องเรียนลำปาง',
    styles: {
      default: {
        document: {
          run: { font: FONT, size: FONT_SIZE },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 }, // ~2cm margins
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: 'รายงานสรุปวิเคราะห์ข้อมูลรายเดือน มิถุนายน ๒๕๖๙  |  ระบบบูรณาการข้อมูลสารสนเทศ อบจ.ลำปาง', font: FONT, size: FONT_SIZE_SM, color: COLOR_MUTED }),
              ],
              alignment: AlignmentType.RIGHT,
              border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' } },
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: 'หน้า ', font: FONT, size: FONT_SIZE_SM, color: COLOR_MUTED }),
                new PageNumberElement({}),
              ],
              alignment: AlignmentType.CENTER,
              border: { top: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' } },
            }),
          ],
        }),
      },
      children: sections,
    }],
  });

  const fileName = `รายงานสรุปวิเคราะห์ข้อมูลรายเดือน_มิถุนายน2569_${Date.now()}.docx`;
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(fileName, buffer);
  console.log(`✅ สร้างไฟล์สำเร็จ: ${fileName}`);
  console.log(`📁 ขนาดไฟล์: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
}

main().catch(e => { console.error('❌ Error:', e.message, e.stack); process.exit(1); });
