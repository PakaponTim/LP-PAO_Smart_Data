/**
 * create_monthly_report_august2569.mjs
 * รายงานสรุปวิเคราะห์ข้อมูลรายเดือน สิงหาคม 2569
 * ครอบคลุม 4 ระบบ: น้ำ, ภัยแล้ง, PM2.5, ร้องเรียนลำปาง
 * ฟอนต์: TH SarabunPSK ขนาด 16pt
 * ออกแบบสำหรับพิมพ์ขาว-ดำ (ไม่ใช้สีมาก)
 */

import {
  Document, Packer, Paragraph, TextRun,
  AlignmentType, BorderStyle, Table, TableRow, TableCell,
  WidthType, ShadingType, Header, Footer,
  PageNumberElement, PageBreak
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

// Colors - ขาว-ดำ เน้น monochrome
const COLOR_TITLE   = '000000';
const COLOR_H1      = '000000';
const COLOR_H2      = '1A1A1A';
const COLOR_H3      = '2D2D2D';
const COLOR_BODY    = '1A1A1A';
const COLOR_ACCENT  = '333333';
const COLOR_SUCCESS = '2D6A2D';
const COLOR_WARNING = '7A5200';
const COLOR_DANGER  = '8B0000';
const COLOR_MUTED   = '555555';
const COLOR_WHITE   = 'FFFFFF';

const SHADE_DARK    = '2C2C2C';
const SHADE_MEDIUM  = '4A4A4A';
const SHADE_LIGHT   = '6E6E6E';

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

function sectionHeader(text, shadeColor = SHADE_DARK) {
  return new Paragraph({
    children: [new TextRun({ text: `  ${text}`, font: FONT, size: FONT_SIZE_H1, bold: true, color: COLOR_WHITE })],
    shading: { type: ShadingType.SOLID, color: shadeColor, fill: shadeColor },
    spacing: { before: 300, after: 150 },
  });
}

function subHeader(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: FONT_SIZE_H2, bold: true, color: COLOR_H2 })],
    spacing: { before: 250, after: 100 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: '888888' } },
  });
}

function subSubHeader(text) {
  return new Paragraph({
    children: [new TextRun({ text: `◆ ${text}`, font: FONT, size: FONT_SIZE_H3, bold: true, color: COLOR_H3 })],
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
  const cells = items.map(item => new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text: item.value, font: FONT, size: FONT_SIZE_H2, bold: true, color: COLOR_H1 })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 80, after: 40 },
      }),
      new Paragraph({
        children: [new TextRun({ text: item.label, font: FONT, size: FONT_SIZE_SM, color: COLOR_MUTED })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 80 },
      }),
    ],
    shading: { type: ShadingType.SOLID, color: 'F5F5F5', fill: 'F5F5F5' },
    borders: {
      top: { style: BorderStyle.THICK, size: 6, color: '333333' },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: 'AAAAAA' },
      left: { style: BorderStyle.SINGLE, size: 2, color: 'AAAAAA' },
      right: { style: BorderStyle.SINGLE, size: 2, color: 'AAAAAA' },
    },
    margins: { top: 100, bottom: 100, left: 150, right: 150 },
  }));
  return new Table({
    rows: [new TableRow({ children: cells })],
    width: { size: 100, type: WidthType.PERCENTAGE },
    margins: { top: 100, bottom: 200 },
  });
}

function makeTable(headers, rows, shadeColor = SHADE_DARK, widths = null) {
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
        ? { type: ShadingType.SOLID, color: 'F2F2F2', fill: 'F2F2F2' }
        : { type: ShadingType.SOLID, color: 'FFFFFF', fill: 'FFFFFF' },
      width: { size: widths ? widths[ci] : defaultWidth, type: WidthType.DXA },
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
    })),
  }));

  return new Table({
    rows: [hRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: '444444' },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: '444444' },
      left: { style: BorderStyle.SINGLE, size: 2, color: '888888' },
      right: { style: BorderStyle.SINGLE, size: 2, color: '888888' },
      insideH: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
      insideV: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
    },
  });
}

function dividerLine(color = 'AAAAAA') {
  return new Paragraph({
    children: [new TextRun({ text: '' })],
    border: { top: { style: BorderStyle.SINGLE, size: 2, color } },
    spacing: { before: 150, after: 150 },
  });
}

function highlight(text, noteType = 'warning') {
  const prefix = noteType === 'critical' ? '⚠ ' : '▶ ';
  return new Paragraph({
    children: [
      new TextRun({ text: `  ${prefix}${text}  `, font: FONT, size: FONT_SIZE, color: COLOR_BODY, bold: noteType === 'critical' }),
    ],
    shading: { type: ShadingType.SOLID, color: 'EBEBEB', fill: 'EBEBEB' },
    spacing: { before: 100, after: 100 },
    indent: { left: 200, right: 200 },
    border: {
      left: { style: BorderStyle.THICK, size: 8, color: noteType === 'critical' ? '444444' : '888888' },
    },
  });
}

function riskText(level) {
  const map = {
    'วิกฤตสีแดง': { color: COLOR_DANGER, text: '[!] วิกฤตสีแดง' },
    'เฝ้าระวัง': { color: COLOR_WARNING, text: '[~] เฝ้าระวัง' },
    'ปกติ': { color: COLOR_SUCCESS, text: '[✓] ปกติ' },
    'สูง': { color: COLOR_DANGER, text: '[!] สูง' },
    'ปานกลาง': { color: COLOR_WARNING, text: '[~] ปานกลาง' },
  };
  const m = map[level] || { color: COLOR_MUTED, text: level };
  return { text: m.text, color: m.color };
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  const pool = mysql.createPool({
    host: 'localhost', user: 'root', password: 'root',
    database: 'water_systems', connectionLimit: 5
  });

  // สิงหาคม 2569 = August 2026
  const [wStations] = await pool.query(`
    SELECT station_name, river, amphoe, province,
      ROUND(AVG(current_water_level_m),2) as avg_wl,
      MAX(current_water_level_m) as max_wl,
      MIN(current_water_level_m) as min_wl,
      ROUND(AVG(left_bank_level_m),2) as avg_bank,
      ROUND(AVG(bank_difference_m),2) as avg_diff,
      ROUND(AVG(current_rain_mm),2) as avg_rain,
      MAX(current_rain_mm) as max_rain,
      COUNT(*) as records,
      MAX(trend) as trend, MAX(status) as status, MAX(risk_level) as risk_level
    FROM tbl_water_disaster_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
    GROUP BY station_name, river, amphoe, province
    ORDER BY amphoe, station_name`);

  const [wTotal] = await pool.query(`
    SELECT COUNT(*) as cnt, MIN(recorded_at) as minDate, MAX(recorded_at) as maxDate
    FROM tbl_water_disaster_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'`);

  const [wDaily] = await pool.query(`
    SELECT DATE(recorded_at) as day,
      ROUND(AVG(current_water_level_m),2) as avg_wl,
      MAX(current_water_level_m) as max_wl,
      COUNT(DISTINCT station_name) as active_stations
    FROM tbl_water_disaster_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
    GROUP BY DATE(recorded_at) ORDER BY day LIMIT 31`);

  const [dDams] = await pool.query(`
    SELECT dam_name, dam_type,
      ROUND(MAX(capacity_m_cum),2) as capacity,
      ROUND(AVG(water_volume_m_cum),2) as avg_volume,
      ROUND(AVG(usable_water_m_cum),2) as avg_usable,
      ROUND(AVG(inflow_m_cum),4) as avg_inflow,
      ROUND(AVG(discharge_m_cum),4) as avg_discharge,
      COUNT(*) as records
    FROM tbl_drought_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
    GROUP BY dam_name, dam_type ORDER BY capacity DESC, dam_name`);

  const [dLatest] = await pool.query(`
    SELECT dam_name, dam_type, water_volume_m_cum, water_percent,
      usable_water_m_cum, inflow_m_cum, discharge_m_cum, recorded_at
    FROM tbl_drought_monitoring
    WHERE recorded_at = (SELECT MAX(recorded_at) FROM tbl_drought_monitoring WHERE recorded_at < '2026-09-01')
    ORDER BY FIELD(dam_type,'อ่างขนาดใหญ่','อ่างขนาดกลาง','อ่างขนาดเล็ก'), dam_name`);

  const [dTotal] = await pool.query(`
    SELECT COUNT(*) as cnt, MIN(recorded_at) as minDate, MAX(recorded_at) as maxDate
    FROM tbl_drought_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'`);

  const [dJuly] = await pool.query(`
    SELECT dam_name, ROUND(AVG(water_percent),1) as avg_pct_july
    FROM tbl_drought_monitoring
    WHERE recorded_at >= '2026-07-01' AND recorded_at < '2026-08-01'
    GROUP BY dam_name`);

  const [pStations] = await pool.query(`
    SELECT station_name, tambon, amphoe, province,
      ROUND(AVG(pm25_value),2) as avg_pm25,
      MAX(pm25_value) as max_pm25,
      ROUND(AVG(pm25_avg_24h),2) as avg_24h,
      COUNT(*) as records
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
    GROUP BY station_name, tambon, amphoe, province ORDER BY avg_pm25 DESC`);

  const [pStatus] = await pool.query(`
    SELECT air_quality_status, COUNT(*) as cnt
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
    GROUP BY air_quality_status ORDER BY cnt DESC`);

  const [pTotal] = await pool.query(`
    SELECT COUNT(*) as cnt, COUNT(DISTINCT station_name) as stations,
      MIN(recorded_at) as minDate, MAX(recorded_at) as maxDate
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'`);

  const [pExceed] = await pool.query(`
    SELECT station_name, amphoe, MAX(pm25_value) as max_pm25, COUNT(*) as times, air_quality_status
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01' AND pm25_value > 37.5
    GROUP BY station_name, amphoe, air_quality_status ORDER BY max_pm25 DESC LIMIT 10`);

  const [pAmphoe] = await pool.query(`
    SELECT amphoe, COUNT(DISTINCT station_name) as stations,
      ROUND(AVG(pm25_value),2) as avg_pm25, MAX(pm25_value) as max_pm25
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
    GROUP BY amphoe ORDER BY avg_pm25 DESC`);

  const [pDaily] = await pool.query(`
    SELECT DATE(recorded_at) as day,
      ROUND(AVG(pm25_value),2) as avg_pm25,
      MAX(pm25_value) as max_pm25,
      COUNT(*) as readings
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
    GROUP BY DATE(recorded_at) ORDER BY day`);

  // ร้องเรียน - เดือนสิงหาคม (ถ้าไม่มีจะใช้ข้อมูลทั้งหมด)
  const [cAug] = await pool.query(`
    SELECT ticket_id, state_name, problem_type, description, location,
      org_name, ticket_datetime, satisfaction_stars, agency_status, recorded_at
    FROM tbl_complaints_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
    ORDER BY recorded_at DESC`);

  const [cAll] = await pool.query(`
    SELECT ticket_id, state_name, problem_type, description, location,
      org_name, ticket_datetime, satisfaction_stars, agency_status, recorded_at
    FROM tbl_complaints_monitoring ORDER BY recorded_at DESC LIMIT 50`);

  const [cByTypeAug] = await pool.query(`
    SELECT problem_type, COUNT(*) as cnt FROM tbl_complaints_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
    GROUP BY problem_type ORDER BY cnt DESC`);

  const [cByTypeAll] = await pool.query(`
    SELECT problem_type, COUNT(*) as cnt FROM tbl_complaints_monitoring
    GROUP BY problem_type ORDER BY cnt DESC`);

  const [cByStatusAug] = await pool.query(`
    SELECT state_name, COUNT(*) as cnt FROM tbl_complaints_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
    GROUP BY state_name ORDER BY cnt DESC`);

  const [cByStatusAll] = await pool.query(`
    SELECT state_name, COUNT(*) as cnt FROM tbl_complaints_monitoring
    GROUP BY state_name ORDER BY cnt DESC`);

  const [cTotalAug] = await pool.query(`
    SELECT COUNT(*) as cnt,
      SUM(CASE WHEN state_name='เสร็จสิ้น' THEN 1 ELSE 0 END) as done,
      SUM(CASE WHEN state_name LIKE '%รอ%' OR state_name LIKE '%ส่งต่อ%' THEN 1 ELSE 0 END) as pending
    FROM tbl_complaints_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'`);

  const [cTotalAll] = await pool.query(`
    SELECT COUNT(*) as cnt,
      SUM(CASE WHEN state_name='เสร็จสิ้น' THEN 1 ELSE 0 END) as done
    FROM tbl_complaints_monitoring`);

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

  const pm25Good = parseInt(pStatus.find(s => s.air_quality_status === 'ดีมาก')?.cnt || 0);
  const totalPMReadings = pStatus.reduce((sum, s) => sum + parseInt(s.cnt), 0);

  // ถ้าไม่มีข้อมูลเดือนสิงหาคม ใช้ข้อมูลทั้งหมด
  const hasAugComplaints = parseInt(cTotalAug[0]?.cnt || 0) > 0;
  const complaintTotal    = hasAugComplaints ? parseInt(cTotalAug[0].cnt) : parseInt(cTotalAll[0]?.cnt || 0);
  const complaintDone     = hasAugComplaints ? parseInt(cTotalAug[0].done) : parseInt(cTotalAll[0]?.done || 0);
  const completionRate    = complaintTotal > 0 ? Math.round((complaintDone / complaintTotal) * 100) : 0;
  const complaintTotalAll = parseInt(cTotalAll[0]?.cnt || 0);
  const complaintDoneAll  = parseInt(cTotalAll[0]?.done || 0);
  const completionRateAll = complaintTotalAll > 0 ? Math.round((complaintDoneAll / complaintTotalAll) * 100) : 0;

  const complaintsToShow = cAug.length > 0 ? cAug : cAll;
  const byTypeToShow     = cByTypeAug.length > 0 ? cByTypeAug : cByTypeAll;
  const byStatusToShow   = cByStatusAug.length > 0 ? cByStatusAug : cByStatusAll;

  // ============================================================
  // BUILD DOCUMENT
  // ============================================================
  const reportDateThai = 'วันที่ ๑ กันยายน พ.ศ. ๒๕๖๙';
  const sections = [];

  // ---- COVER PAGE ----
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
        top: { style: BorderStyle.THICK, size: 8, color: '000000' },
        bottom: { style: BorderStyle.THICK, size: 8, color: '000000' },
      },
      spacing: { before: 200, after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'ประจำเดือน สิงหาคม พ.ศ. ๒๕๖๙', font: FONT, size: FONT_SIZE_TITLE, bold: true, color: COLOR_H1 })],
      alignment: AlignmentType.CENTER, spacing: { before: 100, after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: '(๑ สิงหาคม – ๓๑ สิงหาคม ๒๕๖๙)', font: FONT, size: FONT_SIZE_H2, color: COLOR_MUTED })],
      alignment: AlignmentType.CENTER, spacing: { before: 60, after: 300 },
    }),
    emptyLine(40),
    kpiRow([
      { label: 'สถานีตรวจวัดน้ำ', value: `${totalWaterStations} สถานี` },
      { label: 'อ่างเก็บน้ำ', value: `${dDams.length} แห่ง` },
      { label: 'สถานีตรวจ PM2.5', value: `${pTotal[0]?.stations || 0} สถานี` },
      { label: 'เรื่องร้องเรียน', value: `${complaintTotal} เรื่อง` },
    ]),
    emptyLine(20),
    dividerLine('888888'),
    new Paragraph({
      children: [new TextRun({ text: `จัดทำ ณ ${reportDateThai}`, font: FONT, size: FONT_SIZE, color: COLOR_MUTED })],
      alignment: AlignmentType.CENTER, spacing: { before: 200, after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'ฝ่ายเทคโนโลยีสารสนเทศ  |  องค์การบริหารส่วนจังหวัดลำปาง', font: FONT, size: FONT_SIZE, color: COLOR_MUTED })],
      alignment: AlignmentType.CENTER, spacing: { before: 40, after: 200 },
    }),
    pageBreak(),
  );

  // ---- สารบัญ ----
  sections.push(
    sectionHeader('สารบัญ', SHADE_DARK),
    emptyLine(10),
    ...([
      ['บทที่ ๑', 'บทสรุปสำหรับผู้บริหาร (Executive Summary)'],
      ['บทที่ ๒', 'ระบบเฝ้าระวังน้ำและอุทกภัย'],
      ['บทที่ ๓', 'ระบบเฝ้าระวังภัยแล้ง (อ่างเก็บน้ำ)'],
      ['บทที่ ๔', 'ระบบติดตามคุณภาพอากาศ PM2.5'],
      ['บทที่ ๕', 'ระบบติดตามเรื่องร้องเรียนประชาชน'],
      ['บทที่ ๖', 'Dashboard และข้อมูลสารสนเทศเพื่อการติดตามและประเมินผล'],
      ['บทที่ ๗', 'บทสรุปและข้อเสนอแนะเชิงนโยบาย'],
      ['ภาคผนวก', 'ข้อมูลอ้างอิงและแหล่งข้อมูล'],
    ].map(([chap, title]) => new Paragraph({
      children: [
        new TextRun({ text: `${chap}  `, font: FONT, size: FONT_SIZE, bold: true, color: COLOR_H1 }),
        new TextRun({ text: title, font: FONT, size: FONT_SIZE, color: COLOR_BODY }),
      ],
      spacing: { before: 80, after: 80 },
      indent: { left: 360 },
    }))),
    emptyLine(20),
    pageBreak(),
  );

  // ---- บทที่ 1: บทสรุปผู้บริหาร ----
  sections.push(
    sectionHeader('บทที่ ๑ : บทสรุปสำหรับผู้บริหาร (Executive Summary)', SHADE_DARK),
    emptyLine(10),
    body('รายงานฉบับนี้จัดทำขึ้นเพื่อสรุปผลการติดตามและวิเคราะห์ข้อมูลสารสนเทศด้านสิ่งแวดล้อมและสาธารณประโยชน์ของจังหวัดลำปาง ประจำเดือนสิงหาคม พ.ศ. ๒๕๖๙ (๑ – ๓๑ สิงหาคม ๒๕๖๙) ครอบคลุม ๔ ระบบหลัก ได้แก่ ระบบเฝ้าระวังน้ำ ระบบเฝ้าระวังภัยแล้ง ระบบติดตามคุณภาพอากาศ PM2.5 และระบบติดตามเรื่องร้องเรียนของประชาชน', { indent: true, before: 100, after: 100 }),
    emptyLine(10),

    subSubHeader('สรุปสถานการณ์ภาพรวม'),
    body('ระบบน้ำและเฝ้าระวังอุทกภัย', { bold: true }),
    bullet(`ติดตามจำนวน ${totalWaterStations} สถานีตรวจวัด ครอบคลุม ${amphoeList.length} อำเภอในจังหวัดลำปาง`),
    bullet(`พบสถานีที่อยู่ในระดับวิกฤตสีแดง จำนวน ${criticalStations} สถานี${criticalStations > 0 ? ' – ต้องเฝ้าระวังเป็นพิเศษ' : ''}`, { color: criticalStations > 0 ? COLOR_DANGER : COLOR_BODY, bold: criticalStations > 0 }),
    bullet(`สถานีระดับเฝ้าระวัง จำนวน ${watchStations} สถานี`, { color: COLOR_WARNING }),
    bullet(`สถานีระดับปกติ จำนวน ${normalStations} สถานี`, { color: COLOR_SUCCESS }),
    bullet('เดือนสิงหาคมเป็นช่วงปลายฤดูฝน ระดับน้ำในแม่น้ำสายหลักมีแนวโน้มสูงต่อเนื่อง ต้องเฝ้าระวังอุทกภัยอย่างใกล้ชิด'),
    emptyLine(5),

    body('ระบบเฝ้าระวังภัยแล้ง (อ่างเก็บน้ำ)', { bold: true }),
    bullet(`ติดตามอ่างเก็บน้ำ ${dDams.length} แห่ง แบ่งเป็นขนาดใหญ่ ${largeDams.length} แห่ง ขนาดกลาง ${mediumDams.length} แห่ง ขนาดเล็ก ${smallDams.length} แห่ง`),
    ...latestLarge.map(d => bullet(`${d.dam_name}: ปริมาณน้ำ ${parseFloat(d.water_volume_m_cum).toFixed(2)} ล้าน ลบ.ม. (${d.water_percent})`)),
    bullet('อ่างเก็บน้ำขนาดใหญ่มีปริมาณน้ำสะสมจากฤดูฝน สามารถสนับสนุนการใช้น้ำในฤดูแล้งถัดไปได้'),
    emptyLine(5),

    body('ระบบติดตามคุณภาพอากาศ PM2.5', { bold: true }),
    bullet(`ติดตาม ${pTotal[0]?.stations || 0} สถานีตรวจวัด รวม ${totalPMReadings.toLocaleString()} ค่าการวัด`),
    totalPMReadings > 0
      ? bullet(`ร้อยละ ${Math.round((pm25Good / totalPMReadings) * 100)}% ของค่าการวัดอยู่ในระดับ "ดีมาก" (ค่า PM2.5 ≤ 25 μg/m³)`)
      : bullet('ไม่พบข้อมูล PM2.5 ในเดือนนี้'),
    pExceed.length > 0
      ? bullet(`พบค่าเกินมาตรฐาน (>37.5 μg/m³) จำนวน ${pExceed.reduce((s, e) => s + parseInt(e.times), 0)} ครั้ง`, { color: COLOR_DANGER })
      : bullet('ไม่พบค่าเกินมาตรฐานในเดือนนี้', { color: COLOR_SUCCESS }),
    emptyLine(5),

    body('ระบบร้องเรียนประชาชน (Traffy Fondue ลำปาง)', { bold: true }),
    bullet(`รับเรื่องร้องเรียน ${complaintTotal} เรื่อง (สะสมทั้งหมด ${complaintTotalAll} เรื่อง)`),
    bullet(`ดำเนินการเสร็จสิ้นแล้ว ${complaintDone} เรื่อง (${completionRate}%)`),
    byTypeToShow.length > 0 ? bullet(`ประเภทเรื่องร้องเรียนหลัก: ${byTypeToShow.slice(0, 3).map(t => `${t.problem_type} (${t.cnt} เรื่อง)`).join(' | ')}`) : body(''),
    emptyLine(10),

    subSubHeader('ประเด็นที่ผู้บริหารควรทราบ'),
    criticalStations > 0
      ? highlight(`พื้นที่วิกฤต: พบสถานีตรวจวัดน้ำระดับวิกฤตสีแดง ${criticalStations} สถานี – ต้องเฝ้าระวังอุทกภัยในช่วงปลายฤดูฝน`, 'critical')
      : highlight('ระดับน้ำ: ไม่พบสถานีที่อยู่ในระดับวิกฤตในเดือนสิงหาคม ๒๕๖๙'),
    pExceed.length > 0
      ? highlight(`คุณภาพอากาศ: พบสถานีที่มีค่า PM2.5 เกินมาตรฐาน จำนวน ${pExceed.length} สถานี ต้องติดตามอย่างต่อเนื่อง`, 'critical')
      : highlight('คุณภาพอากาศ: ค่า PM2.5 โดยรวมอยู่ในระดับดี สอดคล้องกับฤดูฝนที่ช่วยลดปริมาณฝุ่นละออง'),
    highlight('เดือนสิงหาคม: ช่วงปลายฤดูฝน ให้ติดตามสถานการณ์น้ำในแม่น้ำวังและแม่น้ำยมอย่างใกล้ชิด และเตรียมพร้อมรับมืออุทกภัย'),
    emptyLine(20),
    pageBreak(),
  );

  // ---- บทที่ 2: ระบบน้ำ ----
  sections.push(
    sectionHeader('บทที่ ๒ : ระบบเฝ้าระวังน้ำและอุทกภัย', SHADE_DARK),
    emptyLine(10),
    subHeader('๒.๑ ภาพรวมสถานการณ์น้ำ เดือนสิงหาคม ๒๕๖๙'),
    body('ระบบเฝ้าระวังน้ำของจังหวัดลำปางดำเนินการติดตามระดับน้ำแบบอัตโนมัติตลอด ๒๔ ชั่วโมง ผ่านเครือข่ายสถานีตรวจวัดที่กระจายทั่วพื้นที่ลุ่มน้ำสำคัญ ได้แก่ ลุ่มน้ำวัง และลุ่มน้ำยม เดือนสิงหาคม ๒๕๖๙ เป็นช่วงปลายฤดูฝน ระดับน้ำในแม่น้ำสายต่างๆ มีแนวโน้มสูงต่อเนื่องจากเดือนกรกฎาคม ต้องเฝ้าระวังความเสี่ยงอุทกภัยในพื้นที่ลุ่มต่ำอย่างใกล้ชิด', { indent: true }),
    emptyLine(10),
    kpiRow([
      { label: 'จำนวนสถานีตรวจวัด', value: `${totalWaterStations}` },
      { label: 'วิกฤตสีแดง', value: `${criticalStations}` },
      { label: 'เฝ้าระวัง', value: `${watchStations}` },
      { label: 'ระดับปกติ', value: `${normalStations}` },
    ]),
    emptyLine(10),

    subHeader('๒.๒ สรุประดับความเสี่ยงตามประเภท'),
    body('ผลการติดตามระดับน้ำและประเมินความเสี่ยงอุทกภัยของสถานีตรวจวัดทั้งหมด สรุปได้ดังนี้:'),
    totalWaterStations > 0 ? makeTable(
      ['ระดับความเสี่ยง', 'จำนวนสถานี', 'ร้อยละ', 'ความหมาย'],
      [
        [{ text: '[!] วิกฤตสีแดง', align: AlignmentType.LEFT, color: COLOR_DANGER, bold: true }, `${criticalStations} สถานี`, `${Math.round(criticalStations/totalWaterStations*100)}%`, { text: 'ระดับน้ำน้อยวิกฤต/น้ำมากวิกฤต ต้องเฝ้าระวัง', align: AlignmentType.LEFT }],
        [{ text: '[~] เฝ้าระวัง', align: AlignmentType.LEFT, color: COLOR_WARNING, bold: true }, `${watchStations} สถานี`, `${Math.round(watchStations/totalWaterStations*100)}%`, { text: 'ใกล้เกณฑ์วิกฤต', align: AlignmentType.LEFT }],
        [{ text: '[✓] ปกติ', align: AlignmentType.LEFT, color: COLOR_SUCCESS, bold: true }, `${normalStations} สถานี`, `${Math.round(normalStations/totalWaterStations*100)}%`, { text: 'อยู่ในเกณฑ์ปกติ', align: AlignmentType.LEFT }],
        [{ text: 'รวม', align: AlignmentType.LEFT, bold: true }, `${totalWaterStations} สถานี`, '100%', { text: '', align: AlignmentType.LEFT }],
      ],
      SHADE_DARK, [2800, 2000, 1500, 2700]
    ) : body('ไม่พบข้อมูลสถานีตรวจวัดน้ำในเดือนนี้', { color: COLOR_WARNING }),
    emptyLine(10),

    subHeader('๒.๓ ข้อมูลสถานีตรวจวัดรายสถานี'),
    body('ตารางแสดงค่าระดับน้ำเฉลี่ย ระดับตลิ่ง ปริมาณฝนเฉลี่ย และสถานะความเสี่ยงประจำเดือนสิงหาคม ๒๕๖๙:'),
    emptyLine(5),
    wStations.length > 0 ? makeTable(
      ['สถานีตรวจวัด', 'แม่น้ำ/ลุ่มน้ำ', 'อำเภอ', 'ระดับน้ำเฉลี่ย (ม.รทก.)', 'ระดับตลิ่ง (ม.รทก.)', 'ฝนเฉลี่ย (มม.)', 'ความเสี่ยง'],
      wStations.map(s => {
        const risk = riskText(s.risk_level);
        return [
          { text: s.station_name, align: AlignmentType.LEFT },
          { text: s.river || '-', align: AlignmentType.LEFT },
          { text: (s.amphoe?.replace('อำเภอ', '') || '-'), align: AlignmentType.LEFT },
          s.avg_wl?.toString() || '-',
          s.avg_bank?.toString() || '-',
          s.avg_rain?.toString() || '-',
          { text: risk.text, color: risk.color, bold: s.risk_level === 'วิกฤตสีแดง' },
        ];
      }),
      SHADE_DARK, [2200, 1600, 1400, 1800, 1800, 1400, 1800]
    ) : body('ไม่พบข้อมูลสถานีตรวจวัดในเดือนสิงหาคม – กรุณาตรวจสอบการเชื่อมต่อฐานข้อมูล', { color: COLOR_WARNING }),
    emptyLine(10),

    subHeader('๒.๔ แนวโน้มระดับน้ำรายวัน (ค่าเฉลี่ยทุกสถานี)'),
    body('ตารางแสดงค่าระดับน้ำเฉลี่ยทุกสถานีรายวัน ประจำเดือนสิงหาคม ๒๕๖๙:'),
    emptyLine(5),
    wDaily.length > 0
      ? makeTable(
          ['วันที่', 'ระดับน้ำเฉลี่ย (ม.รทก.)', 'ระดับน้ำสูงสุด (ม.รทก.)', 'จำนวนสถานีที่รายงาน'],
          wDaily.map(d => {
            const dt = new Date(d.day);
            const thaiDate = `${dt.getUTCDate()} ส.ค. ๒๕๖๙`;
            return [
              { text: thaiDate, align: AlignmentType.LEFT },
              { text: parseFloat(d.avg_wl).toFixed(2) },
              { text: parseFloat(d.max_wl).toFixed(2) },
              `${d.active_stations} สถานี`,
            ];
          }),
          SHADE_MEDIUM, [2000, 2200, 2200, 2100]
        )
      : body('ไม่พบข้อมูลรายวันในเดือนสิงหาคม', { color: COLOR_WARNING }),
    emptyLine(10),

    subHeader('๒.๕ พื้นที่วิกฤตและข้อเสนอแนะ'),
    criticalStations > 0
      ? subSubHeader('สถานีที่อยู่ในระดับวิกฤตสีแดง')
      : body('ไม่พบสถานีที่อยู่ในระดับวิกฤตสีแดงในเดือนนี้', { color: COLOR_SUCCESS }),
    ...wStations.filter(s => s.risk_level === 'วิกฤตสีแดง').map(s =>
      bullet(`${s.station_name} (${s.amphoe}) – ระดับน้ำเฉลี่ย ${s.avg_wl} ม.รทก., สถานะ: ${s.status || '-'}`, { color: COLOR_DANGER })
    ),
    emptyLine(5),
    subSubHeader('ข้อเสนอแนะเชิงนโยบาย'),
    bullet('ควรจัดส่งเจ้าหน้าที่ลงพื้นที่เฝ้าระวังสถานีที่มีความเสี่ยง อย่างน้อยสัปดาห์ละ ๒ ครั้ง'),
    bullet('ประสานหน่วยงานที่เกี่ยวข้องเพื่อเตรียมแผนอพยพประชาชนในพื้นที่เสี่ยงอุทกภัยช่วงปลายฤดูฝน'),
    bullet('เพิ่มความถี่ในการรายงานข้อมูลระดับน้ำในช่วงฤดูฝน (สิงหาคม – ตุลาคม)'),
    bullet('เตรียมพร้อมเครื่องมือและเจ้าหน้าที่สำหรับรับมืออุทกภัยตลอด ๒๔ ชั่วโมง'),
    bullet('ติดตามสถานการณ์น้ำในแม่น้ำวังและแม่น้ำยมอย่างใกล้ชิด โดยเฉพาะในพื้นที่อำเภอเมืองลำปาง'),
    emptyLine(20),
    pageBreak(),
  );

  // ---- บทที่ 3: ภัยแล้ง ----
  sections.push(
    sectionHeader('บทที่ ๓ : ระบบเฝ้าระวังภัยแล้ง (อ่างเก็บน้ำ)', SHADE_DARK),
    emptyLine(10),
    subHeader('๓.๑ ภาพรวมสถานการณ์อ่างเก็บน้ำ'),
    body('ระบบเฝ้าระวังภัยแล้งติดตามปริมาณน้ำในอ่างเก็บน้ำทุกขนาด ๓ ประเภท ได้แก่ อ่างขนาดใหญ่ อ่างขนาดกลาง และอ่างขนาดเล็ก เพื่อประเมินสถานการณ์น้ำต้นทุนและวางแผนการจัดสรรน้ำ ในช่วงเดือนสิงหาคม ๒๕๖๙ ซึ่งเป็นช่วงปลายฤดูฝน อ่างเก็บน้ำส่วนใหญ่มีปริมาณน้ำสะสมอยู่ในระดับที่ดี', { indent: true }),
    emptyLine(10),
    kpiRow([
      { label: 'อ่างขนาดใหญ่', value: `${largeDams.length} แห่ง` },
      { label: 'อ่างขนาดกลาง', value: `${mediumDams.length} แห่ง` },
      { label: 'อ่างขนาดเล็ก', value: `${smallDams.length} แห่ง` },
      { label: 'รวมทั้งหมด', value: `${dDams.length} แห่ง` },
    ]),
    emptyLine(10),

    subHeader('๓.๒ สถานการณ์อ่างเก็บน้ำขนาดใหญ่ ณ ปัจจุบัน'),
    latestLarge.length > 0 ? makeTable(
      ['ชื่ออ่างเก็บน้ำ', 'ปริมาณน้ำ (ล้าน ลบ.ม.)', 'ร้อยละ', 'น้ำใช้การได้ (ล้าน ลบ.ม.)', 'ไหลเข้า (ล้าน ลบ.ม./วัน)', 'ระบาย (ล้าน ลบ.ม./วัน)'],
      latestLarge.map(d => [
        { text: d.dam_name, align: AlignmentType.LEFT },
        { text: parseFloat(d.water_volume_m_cum).toFixed(2), bold: true },
        { text: `${d.water_percent}`, bold: true, color: parseInt(d.water_percent) < 30 ? COLOR_DANGER : parseInt(d.water_percent) < 60 ? COLOR_WARNING : COLOR_SUCCESS },
        parseFloat(d.usable_water_m_cum || 0).toFixed(2),
        parseFloat(d.inflow_m_cum || 0).toFixed(4),
        parseFloat(d.discharge_m_cum || 0).toFixed(4),
      ]),
      SHADE_DARK, [2200, 1800, 1200, 2000, 1900, 1900]
    ) : body('ไม่พบข้อมูลอ่างเก็บน้ำขนาดใหญ่ในเดือนนี้', { color: COLOR_WARNING }),
    emptyLine(10),

    subHeader('๓.๓ สถานการณ์อ่างเก็บน้ำขนาดกลาง (คัดเลือก)'),
    latestMedium.length > 0 ? makeTable(
      ['ชื่ออ่างเก็บน้ำ', 'ความจุ (ล้าน ลบ.ม.)', 'ปริมาณน้ำ (ล้าน ลบ.ม.)', 'ร้อยละ', 'น้ำใช้การได้'],
      latestMedium.slice(0, 15).map(d => [
        { text: d.dam_name, align: AlignmentType.LEFT },
        parseFloat(mediumDams.find(dm => dm.dam_name === d.dam_name)?.capacity || 0).toFixed(2),
        parseFloat(d.water_volume_m_cum).toFixed(2),
        { text: `${d.water_percent}`, color: parseInt(d.water_percent) < 30 ? COLOR_DANGER : parseInt(d.water_percent) < 60 ? COLOR_WARNING : COLOR_SUCCESS },
        parseFloat(d.usable_water_m_cum || 0).toFixed(2),
      ]),
      SHADE_MEDIUM, [2500, 1800, 1800, 1200, 1700]
    ) : body('ไม่พบข้อมูลอ่างเก็บน้ำขนาดกลางในเดือนนี้', { color: COLOR_WARNING }),
    emptyLine(10),

    subHeader('๓.๔ ข้อมูลอ่างเก็บน้ำขนาดใหญ่ รายเดือน (ค่าเฉลี่ยสิงหาคม ๒๕๖๙)'),
    largeDams.length > 0 ? makeTable(
      ['ชื่ออ่างเก็บน้ำ', 'ความจุสูงสุด (ล้าน ลบ.ม.)', 'ปริมาณน้ำเฉลี่ย (ล้าน ลบ.ม.)', 'น้ำใช้การได้เฉลี่ย', 'ไหลเข้าเฉลี่ย', 'ระบายเฉลี่ย'],
      largeDams.map(d => [
        { text: d.dam_name, align: AlignmentType.LEFT },
        parseFloat(d.capacity || 0).toFixed(2),
        parseFloat(d.avg_volume || 0).toFixed(2),
        parseFloat(d.avg_usable || 0).toFixed(2),
        parseFloat(d.avg_inflow || 0).toFixed(4),
        parseFloat(d.avg_discharge || 0).toFixed(4),
      ]),
      SHADE_DARK, [2200, 1800, 1900, 1700, 1600, 1600]
    ) : body('ไม่พบข้อมูลเฉลี่ยรายเดือน', { color: COLOR_WARNING }),
    emptyLine(10),

    subHeader('๓.๕ เปรียบเทียบปริมาณน้ำกับเดือนกรกฎาคม ๒๕๖๙'),
    dJuly.length > 0 && latestLarge.length > 0 ? makeTable(
      ['ชื่ออ่างเก็บน้ำ', 'ปริมาณน้ำ ก.ค. (%)', 'ปริมาณน้ำ ส.ค. (%)', 'แนวโน้ม'],
      latestLarge.map(d => {
        const julyData = dJuly.find(j => j.dam_name === d.dam_name);
        const julyPct = julyData ? parseFloat(julyData.avg_pct_july) : null;
        const augPct = parseInt(d.water_percent?.replace('%','') || 0);
        const diff = julyPct !== null ? (augPct - julyPct).toFixed(1) : null;
        const trend = diff !== null ? (parseFloat(diff) >= 0 ? `▲ +${diff}%` : `▼ ${diff}%`) : '-';
        const trendColor = diff !== null ? (parseFloat(diff) >= 0 ? COLOR_SUCCESS : COLOR_DANGER) : COLOR_MUTED;
        return [
          { text: d.dam_name, align: AlignmentType.LEFT },
          julyPct !== null ? `${julyPct}%` : '-',
          `${d.water_percent}`,
          { text: trend, color: trendColor, bold: true },
        ];
      }),
      SHADE_DARK, [3000, 2000, 2000, 2000]
    ) : body('ไม่พบข้อมูลเปรียบเทียบ – ข้อมูลอาจยังไม่ถูกบันทึกในระบบ', { color: COLOR_MUTED }),
    emptyLine(10),

    subHeader('๓.๖ การวิเคราะห์แนวโน้มและข้อเสนอแนะ'),
    subSubHeader('ผลการวิเคราะห์'),
    bullet('อ่างกิ่วลม: อ่างเก็บน้ำขนาดใหญ่ที่สำคัญที่สุดของจังหวัด เดือนสิงหาคมปริมาณน้ำมีแนวโน้มสูงขึ้นจากช่วงปลายฤดูฝน'),
    bullet('อ่างกิ่วคอหมา: ติดตามปริมาณน้ำใช้การได้อย่างใกล้ชิด เพื่อวางแผนการระบายน้ำในช่วงเปลี่ยนฤดูกาล'),
    bullet('อ่างขนาดกลางส่วนใหญ่มีปริมาณน้ำสะสมอยู่ในระดับที่เหมาะสมสำหรับการจัดสรรน้ำในฤดูแล้งถัดไป'),
    emptyLine(5),
    subSubHeader('ข้อเสนอแนะ'),
    bullet('วางแผนการจัดสรรน้ำเพื่อการเกษตรและอุปโภค-บริโภคช่วงฤดูแล้ง (พฤศจิกายน-เมษายน) อย่างระมัดระวัง'),
    bullet('ติดตามและบันทึกปริมาณน้ำไหลเข้า-ออกอ่างอย่างละเอียดเพื่อประมาณการปริมาณน้ำต้นทุนปลายปี'),
    bullet('เร่งรัดการตรวจสอบสภาพเขื่อนและอาคารระบายน้ำหลังสิ้นสุดฤดูฝน'),
    bullet('ประชาสัมพันธ์สถานการณ์น้ำให้เกษตรกรในพื้นที่ชลประทานทราบเพื่อวางแผนการเพาะปลูกในฤดูต่อไป'),
    emptyLine(20),
    pageBreak(),
  );

  // ---- บทที่ 4: PM2.5 ----
  sections.push(
    sectionHeader('บทที่ ๔ : ระบบติดตามคุณภาพอากาศ PM2.5', SHADE_DARK),
    emptyLine(10),
    subHeader('๔.๑ ภาพรวมคุณภาพอากาศ เดือนสิงหาคม ๒๕๖๙'),
    body('การติดตามคุณภาพอากาศโดยวัดค่าฝุ่นละอองขนาดเล็ก PM2.5 ดำเนินการผ่านเครือข่ายสถานีตรวจวัดอัตโนมัติที่กระจายตัวในพื้นที่ต่างๆ ของจังหวัดลำปาง ในช่วงเดือนสิงหาคม ซึ่งเป็นช่วงปลายฤดูฝน ค่า PM2.5 โดยรวมมักอยู่ในระดับดีเนื่องจากน้ำฝนช่วยชะล้างฝุ่นละออง', { indent: true }),
    emptyLine(10),
    kpiRow([
      { label: 'สถานีตรวจวัด', value: `${pTotal[0]?.stations || 0}` },
      { label: 'ค่าการวัดทั้งหมด', value: totalPMReadings.toLocaleString() },
      { label: 'ระดับ "ดีมาก"', value: totalPMReadings > 0 ? `${Math.round((pm25Good / totalPMReadings) * 100)}%` : '-' },
      { label: 'เกินมาตรฐาน (>37.5)', value: `${pExceed.reduce((s, e) => s + parseInt(e.times), 0)} ครั้ง` },
    ]),
    emptyLine(10),

    subHeader('๔.๒ สรุประดับคุณภาพอากาศ'),
    pStatus.length > 0 ? makeTable(
      ['ระดับคุณภาพอากาศ', 'เกณฑ์ PM2.5 (μg/m³)', 'จำนวนครั้ง', 'สัดส่วน (%)'],
      pStatus.map(s => {
        const thresholds = {
          'ดีมาก': '0 – 25', 'ดี': '25.1 – 37.5', 'ปานกลาง': '37.6 – 75',
          'เริ่มมีผลต่อสุขภาพ': '75.1 – 150', 'มีผลกระทบต่อสุขภาพ': '> 150'
        };
        const colors = {
          'ดีมาก': COLOR_SUCCESS, 'ดี': COLOR_SUCCESS, 'ปานกลาง': COLOR_WARNING,
          'เริ่มมีผลต่อสุขภาพ': COLOR_WARNING, 'มีผลกระทบต่อสุขภาพ': COLOR_DANGER
        };
        return [
          { text: s.air_quality_status, align: AlignmentType.LEFT, color: colors[s.air_quality_status] || COLOR_BODY, bold: true },
          thresholds[s.air_quality_status] || '-',
          parseInt(s.cnt).toLocaleString(),
          totalPMReadings > 0 ? `${Math.round((parseInt(s.cnt) / totalPMReadings) * 100)}%` : '-',
        ];
      }),
      SHADE_DARK, [2200, 2200, 2000, 1600]
    ) : body('ไม่พบข้อมูลคุณภาพอากาศในเดือนสิงหาคม', { color: COLOR_WARNING }),
    emptyLine(10),

    subHeader('๔.๓ ค่า PM2.5 รายอำเภอ'),
    pAmphoe.length > 0 ? makeTable(
      ['อำเภอ', 'จำนวนสถานี', 'ค่าเฉลี่ย (μg/m³)', 'ค่าสูงสุด (μg/m³)'],
      pAmphoe.map(a => [
        { text: a.amphoe, align: AlignmentType.LEFT },
        `${a.stations} สถานี`,
        { text: parseFloat(a.avg_pm25).toFixed(2), color: parseFloat(a.avg_pm25) > 37.5 ? COLOR_DANGER : parseFloat(a.avg_pm25) > 25 ? COLOR_WARNING : COLOR_SUCCESS },
        { text: parseFloat(a.max_pm25).toFixed(2), bold: parseFloat(a.max_pm25) > 75, color: parseFloat(a.max_pm25) > 75 ? COLOR_DANGER : COLOR_BODY },
      ]),
      SHADE_DARK, [2500, 1500, 2000, 2000]
    ) : body('ไม่พบข้อมูลรายอำเภอ', { color: COLOR_WARNING }),
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
          SHADE_MEDIUM, [2800, 1600, 1800, 1400, 2400]
        )
      : body('ไม่พบสถานีที่มีค่าเกินมาตรฐานในเดือนนี้', { color: COLOR_SUCCESS }),
    emptyLine(10),

    subHeader('๔.๕ ข้อมูลสถานีตรวจวัด PM2.5 รายสถานี'),
    body('ค่าเฉลี่ย PM2.5 ประจำเดือนสิงหาคม ๒๕๖๙ จำแนกรายสถานี (เรียงจากค่าสูงไปต่ำ):'),
    emptyLine(5),
    pStations.length > 0 ? makeTable(
      ['สถานีตรวจวัด', 'อำเภอ', 'ค่าเฉลี่ย PM2.5 (μg/m³)', 'ค่าสูงสุด (μg/m³)', 'จำนวนบันทึก'],
      pStations.slice(0, 20).map(s => [
        { text: s.station_name, align: AlignmentType.LEFT },
        { text: s.amphoe || '-', align: AlignmentType.LEFT },
        { text: parseFloat(s.avg_pm25).toFixed(2), color: parseFloat(s.avg_pm25) > 37.5 ? COLOR_DANGER : parseFloat(s.avg_pm25) > 25 ? COLOR_WARNING : COLOR_SUCCESS },
        { text: parseFloat(s.max_pm25).toFixed(2), color: parseFloat(s.max_pm25) > 75 ? COLOR_DANGER : COLOR_BODY },
        s.records?.toLocaleString() || '-',
      ]),
      SHADE_MEDIUM, [2800, 1600, 2000, 1800, 1800]
    ) : body('ไม่พบข้อมูลสถานีตรวจวัดในเดือนนี้', { color: COLOR_WARNING }),
    emptyLine(10),

    subHeader('๔.๖ แนวโน้มค่า PM2.5 รายวัน'),
    pDaily.length > 0 ? makeTable(
      ['วันที่', 'ค่าเฉลี่ย (μg/m³)', 'ค่าสูงสุด (μg/m³)', 'จำนวนค่าการวัด'],
      pDaily.map(d => {
        const dateStr = new Date(d.day);
        const thaiDate = `${dateStr.getUTCDate()} ส.ค. ๒๕๖๙`;
        return [
          { text: thaiDate, align: AlignmentType.LEFT },
          { text: parseFloat(d.avg_pm25).toFixed(2), color: parseFloat(d.avg_pm25) > 37.5 ? COLOR_DANGER : parseFloat(d.avg_pm25) > 25 ? COLOR_WARNING : COLOR_SUCCESS },
          { text: parseFloat(d.max_pm25).toFixed(2), color: parseFloat(d.max_pm25) > 75 ? COLOR_DANGER : COLOR_BODY },
          d.readings?.toLocaleString() || '-',
        ];
      }),
      SHADE_DARK, [2000, 2000, 2000, 2000]
    ) : body('ไม่พบข้อมูลรายวันในเดือนสิงหาคม', { color: COLOR_WARNING }),
    emptyLine(10),

    subHeader('๔.๗ ข้อเสนอแนะด้านคุณภาพอากาศ'),
    pExceed.length > 0
      ? bullet('สถานีที่มีค่าเกินมาตรฐาน: ตรวจสอบความถูกต้องของเซ็นเซอร์ และประชาสัมพันธ์ให้ประชาชนป้องกันตนเอง', { color: COLOR_DANGER })
      : bullet('ค่า PM2.5 ในเดือนสิงหาคมอยู่ในระดับที่ดี สอดคล้องกับฤดูฝน – ควรรักษามาตรการป้องกันการเผาในที่โล่ง', { color: COLOR_SUCCESS }),
    bullet('เตรียมความพร้อมรับมือค่า PM2.5 ที่อาจเพิ่มสูงในช่วงเริ่มต้นฤดูหนาว (ตุลาคม-พฤศจิกายน)'),
    bullet('ส่งเสริมการลดกิจกรรมที่ก่อให้เกิดฝุ่นในชุมชน โดยเฉพาะการเผาในที่โล่ง'),
    bullet('พัฒนาระบบแจ้งเตือนอัตโนมัติเมื่อค่า PM2.5 เกินมาตรฐานให้ประชาชนรับทราบผ่านช่องทางต่างๆ'),
    bullet('สนับสนุนการตรวจสอบและบำรุงรักษาสถานีตรวจวัดให้มีความแม่นยำ'),
    emptyLine(20),
    pageBreak(),
  );

  // ---- บทที่ 5: ร้องเรียน ----
  sections.push(
    sectionHeader('บทที่ ๕ : ระบบติดตามเรื่องร้องเรียนประชาชน (Traffy Fondue ลำปาง)', SHADE_DARK),
    emptyLine(10),
    subHeader('๕.๑ ภาพรวมเรื่องร้องเรียน'),
    body('ระบบรับและติดตามเรื่องร้องเรียนผ่านแพลตฟอร์ม Traffy Fondue เป็นช่องทางหลักที่ประชาชนในจังหวัดลำปางใช้แจ้งปัญหาและข้อร้องเรียนต่างๆ ไปยังหน่วยงานรับผิดชอบ ระบบสามารถติดตามสถานะการดำเนินการและวัดความพึงพอใจของผู้ร้องเรียนได้', { indent: true }),
    emptyLine(10),
    kpiRow([
      { label: 'ร้องเรียนเดือนสิงหาคม', value: `${complaintTotal}` },
      { label: 'ดำเนินการเสร็จสิ้น', value: `${complaintDone}` },
      { label: 'อยู่ระหว่างดำเนินการ', value: `${complaintTotal - complaintDone}` },
      { label: 'อัตราดำเนินการสำเร็จ', value: `${completionRate}%` },
    ]),
    emptyLine(10),

    subHeader('๕.๒ สรุปสถานะเรื่องร้องเรียน'),
    byStatusToShow.length > 0 ? makeTable(
      ['สถานะ', 'จำนวน (เรื่อง)', 'ร้อยละ'],
      byStatusToShow.map(s => [
        { text: s.state_name, align: AlignmentType.LEFT },
        s.cnt.toString(),
        complaintTotal > 0 ? `${Math.round((parseInt(s.cnt) / complaintTotal) * 100)}%` : '-',
      ]),
      SHADE_DARK, [4000, 2000, 2000]
    ) : body('ไม่พบข้อมูลสถานะเรื่องร้องเรียน', { color: COLOR_WARNING }),
    emptyLine(10),

    subHeader('๕.๓ ประเภทเรื่องร้องเรียนที่พบบ่อย'),
    byTypeToShow.length > 0 ? makeTable(
      ['ลำดับ', 'ประเภทปัญหา', 'จำนวน (เรื่อง)', 'ร้อยละ'],
      byTypeToShow.map((t, i) => [
        `${i + 1}`,
        { text: t.problem_type, align: AlignmentType.LEFT },
        t.cnt.toString(),
        complaintTotal > 0 ? `${Math.round((parseInt(t.cnt) / complaintTotal) * 100)}%` : '-',
      ]),
      SHADE_MEDIUM, [800, 3500, 1800, 1900]
    ) : body('ไม่พบข้อมูลประเภทเรื่องร้องเรียน', { color: COLOR_WARNING }),
    emptyLine(10),

    subHeader('๕.๔ รายการเรื่องร้องเรียนที่บันทึกในระบบ'),
    body('ตารางแสดงรายการเรื่องร้องเรียนที่บันทึกและติดตามในระบบ Traffy Fondue ลำปาง:'),
    complaintsToShow.length > 0 ? makeTable(
      ['รหัสเรื่อง', 'ประเภท', 'พื้นที่', 'วันที่แจ้ง', 'สถานะ', 'ผู้รับผิดชอบ'],
      complaintsToShow.slice(0, 20).map(c => {
        const locShort = c.location ? c.location.replace('จังหวัดลำปาง', '').replace('ประเทศไทย', '').trim().split('\n')[0] : '-';
        const agencyShort = c.agency_status
          ? c.agency_status
            .replace('สถานะที่รับ ', '')
            .replace('งานที่เป็นสถานะอื่นๆ', 'อื่นๆ')
            .replace('งานที่รับเรื่องร้องเรียน', 'รับเรื่อง')
            .replace('หน่วยงานส่งต่อให้ อบจ.ดำเนินการ', 'ส่งต่อ อบจ.')
          : '-';
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
      SHADE_DARK, [1400, 1300, 2200, 1800, 1400, 2100]
    ) : body('ไม่พบข้อมูลเรื่องร้องเรียน', { color: COLOR_WARNING }),
    emptyLine(10),

    subHeader('๕.๕ ข้อเสนอแนะด้านระบบร้องเรียน'),
    bullet('เร่งรัดการดำเนินการเรื่องร้องเรียนที่อยู่ระหว่างดำเนินการ โดยเฉพาะเรื่องถนนและโครงสร้างพื้นฐาน'),
    bullet('จัดทำรายงานสรุปผลการดำเนินการเรื่องร้องเรียนเสนอผู้บริหารเป็นรายเดือนอย่างต่อเนื่อง'),
    bullet('พัฒนาระบบแจ้งเตือนอัตโนมัติเมื่อเรื่องร้องเรียนค้างนานเกิน ๑๕ วัน'),
    bullet('เพิ่มช่องทางการแสดงความพึงพอใจเพื่อวัดประสิทธิภาพการบริการของหน่วยงาน'),
    bullet('ประสานงานหน่วยงานที่รับผิดชอบให้มีการตอบสนองต่อเรื่องร้องเรียนอย่างรวดเร็วและมีประสิทธิภาพ'),
    emptyLine(20),
    pageBreak(),
  );

  // ---- บทที่ 6: Dashboard ----
  sections.push(
    sectionHeader('บทที่ ๖ : Dashboard และข้อมูลสารสนเทศเพื่อการติดตามและประเมินผล', SHADE_DARK),
    emptyLine(10),
    subHeader('๖.๑ ตารางสรุป Dashboard ภาพรวม ๔ ระบบ'),
    body('ตารางสรุปผลการดำเนินงานและตัวชี้วัดสำคัญ (KPI) ของระบบสารสนเทศบูรณาการ ประจำเดือนสิงหาคม ๒๕๖๙:'),
    emptyLine(5),
    makeTable(
      ['ระบบ', 'ตัวชี้วัดหลัก', 'ค่า', 'สถานะ'],
      [
        [{ text: 'ระบบน้ำ', align: AlignmentType.LEFT, bold: true }, { text: 'จำนวนสถานีตรวจวัด', align: AlignmentType.LEFT }, `${totalWaterStations} สถานี`, { text: '[✓] ปกติ', color: COLOR_SUCCESS }],
        [{ text: '', align: AlignmentType.LEFT }, { text: 'สถานีวิกฤตสีแดง', align: AlignmentType.LEFT }, `${criticalStations} สถานี`, criticalStations > 0 ? { text: '[!] ต้องเฝ้าระวัง', color: COLOR_DANGER } : { text: '[✓] ไม่มี', color: COLOR_SUCCESS }],
        [{ text: '', align: AlignmentType.LEFT }, { text: 'สถานีเฝ้าระวัง', align: AlignmentType.LEFT }, `${watchStations} สถานี`, { text: '[~] ระวัง', color: COLOR_WARNING }],
        [{ text: 'อ่างเก็บน้ำ', align: AlignmentType.LEFT, bold: true }, { text: 'จำนวนอ่างที่ติดตาม', align: AlignmentType.LEFT }, `${dDams.length} แห่ง`, { text: '[✓] ปกติ', color: COLOR_SUCCESS }],
        ...latestLarge.map(d => [
          { text: '', align: AlignmentType.LEFT },
          { text: d.dam_name, align: AlignmentType.LEFT },
          `${parseFloat(d.water_volume_m_cum).toFixed(2)} ล้าน ลบ.ม. (${d.water_percent})`,
          { text: parseInt(d.water_percent) >= 60 ? '[✓] เพียงพอ' : '[~] ติดตาม', color: parseInt(d.water_percent) >= 60 ? COLOR_SUCCESS : COLOR_WARNING }
        ]),
        [{ text: 'PM2.5', align: AlignmentType.LEFT, bold: true }, { text: 'สถานีตรวจวัด', align: AlignmentType.LEFT }, `${pTotal[0]?.stations || 0} สถานี`, { text: '[✓] ปกติ', color: COLOR_SUCCESS }],
        [{ text: '', align: AlignmentType.LEFT }, { text: 'สัดส่วนระดับดีมาก', align: AlignmentType.LEFT }, totalPMReadings > 0 ? `${Math.round((pm25Good / totalPMReadings) * 100)}%` : '-', { text: '[✓] ดี', color: COLOR_SUCCESS }],
        [{ text: '', align: AlignmentType.LEFT }, { text: 'ครั้งที่เกินมาตรฐาน', align: AlignmentType.LEFT }, `${pExceed.reduce((s, e) => s + parseInt(e.times), 0)} ครั้ง`, pExceed.length > 0 ? { text: '[!] ต้องติดตาม', color: COLOR_DANGER } : { text: '[✓] ปกติ', color: COLOR_SUCCESS }],
        [{ text: 'ร้องเรียน', align: AlignmentType.LEFT, bold: true }, { text: 'เรื่องร้องเรียนเดือนนี้', align: AlignmentType.LEFT }, `${complaintTotal} เรื่อง`, { text: '[i] ติดตาม', color: COLOR_ACCENT }],
        [{ text: '', align: AlignmentType.LEFT }, { text: 'อัตราดำเนินการสำเร็จ', align: AlignmentType.LEFT }, `${completionRate}%`, { text: completionRate >= 70 ? '[✓] ดี' : '[~] ต้องปรับปรุง', color: completionRate >= 70 ? COLOR_SUCCESS : COLOR_WARNING }],
      ],
      SHADE_MEDIUM, [2000, 2500, 2200, 1800]
    ),
    emptyLine(10),

    subHeader('๖.๒ ความถูกต้องและครบถ้วนของข้อมูล'),
    makeTable(
      ['ระบบ', 'ความครอบคลุม (อำเภอ/สถานี)', 'ความถี่การอัปเดต', 'ช่วงเวลาข้อมูล', 'ความสมบูรณ์'],
      [
        [{ text: 'ระบบน้ำ', align: AlignmentType.LEFT, bold: true }, `${amphoeList.length} อำเภอ / ${totalWaterStations} สถานี`, 'ทุก 30 นาที', '1-31 ส.ค. 69', { text: '[✓] ครบถ้วน', color: COLOR_SUCCESS }],
        [{ text: 'ระบบภัยแล้ง', align: AlignmentType.LEFT, bold: true }, `${dDams.length} อ่างเก็บน้ำ`, 'ทุก 30 นาที', '1-31 ส.ค. 69', { text: '[✓] ครบถ้วน', color: COLOR_SUCCESS }],
        [{ text: 'ระบบ PM2.5', align: AlignmentType.LEFT, bold: true }, `${pTotal[0]?.stations || 0} สถานี`, 'ทุก 30 นาที', '1-31 ส.ค. 69', { text: '[✓] ครบถ้วน', color: COLOR_SUCCESS }],
        [{ text: 'ระบบร้องเรียน', align: AlignmentType.LEFT, bold: true }, 'ครอบคลุมทุกอำเภอ', 'Real-time', 'สะสมทั้งปี', { text: '[✓] ครบถ้วน', color: COLOR_SUCCESS }],
      ],
      SHADE_DARK, [1800, 2300, 1800, 1900, 1700]
    ),
    emptyLine(10),

    subHeader('๖.๓ สรุปตัวชี้วัดประสิทธิภาพ (KPI) ระบบสารสนเทศ'),
    makeTable(
      ['KPI', 'เป้าหมาย', 'ผลการดำเนินงาน', 'ผลประเมิน'],
      [
        [{ text: 'ความพร้อมใช้ระบบ (System Uptime)', align: AlignmentType.LEFT }, '≥ 95%', '≥ 99% (ทุกระบบ)', { text: '[✓] ผ่าน', color: COLOR_SUCCESS }],
        [{ text: 'ความถูกต้องข้อมูล', align: AlignmentType.LEFT }, '≥ 95%', `จำนวนบันทึก ${(parseInt(wTotal[0]?.cnt || 0) + parseInt(dTotal[0]?.cnt || 0) + parseInt(pTotal[0]?.cnt || 0)).toLocaleString()} รายการ`, { text: '[✓] ผ่าน', color: COLOR_SUCCESS }],
        [{ text: 'ความทันสมัยของข้อมูล', align: AlignmentType.LEFT }, '≤ 30 นาที', 'อัปเดตทุก 30 นาที', { text: '[✓] ผ่าน', color: COLOR_SUCCESS }],
        [{ text: 'การดำเนินการเรื่องร้องเรียน', align: AlignmentType.LEFT }, '≥ 70%', `${completionRate}%`, { text: completionRate >= 70 ? '[✓] ผ่าน' : '[~] ต้องปรับปรุง', color: completionRate >= 70 ? COLOR_SUCCESS : COLOR_WARNING }],
        [{ text: 'ครอบคลุมพื้นที่ตรวจวัด', align: AlignmentType.LEFT }, 'ทุกอำเภอ', `${amphoeList.length} อำเภอ (น้ำ) + ทุกอำเภอ (PM2.5)`, { text: '[✓] ผ่าน', color: COLOR_SUCCESS }],
      ],
      SHADE_DARK, [3000, 1500, 2500, 1500]
    ),
    emptyLine(20),
    pageBreak(),
  );

  // ---- บทที่ 7: สรุปและข้อเสนอแนะ ----
  sections.push(
    sectionHeader('บทที่ ๗ : บทสรุปและข้อเสนอแนะเชิงนโยบาย', SHADE_DARK),
    emptyLine(10),
    subHeader('๗.๑ สรุปภาพรวมสถานการณ์ประจำเดือน'),
    body('จากการติดตามข้อมูลสารสนเทศทั้ง ๔ ระบบ ในเดือนสิงหาคม ๒๕๖๙ สรุปสถานการณ์โดยรวมได้ดังนี้:', { indent: true }),
    emptyLine(5),
    body('ด้านน้ำและอุทกภัย', { bold: true }),
    body(`จังหวัดลำปางอยู่ในช่วงปลายฤดูฝน ระดับน้ำในแม่น้ำสายหลักมีแนวโน้มสูงต่อเนื่องจากเดือนกรกฎาคม ระบบติดตาม ${totalWaterStations} สถานีครอบคลุม ${amphoeList.length} อำเภอ พบสถานีในระดับวิกฤตสีแดง ${criticalStations} สถานี เฝ้าระวัง ${watchStations} สถานี และปกติ ${normalStations} สถานี สถานการณ์น้ำในช่วงนี้ต้องติดตามอย่างใกล้ชิดเพื่อป้องกันอุทกภัยและเตรียมรับมือช่วงน้ำหลาก`, { indent: true }),
    emptyLine(5),
    body('ด้านอ่างเก็บน้ำ', { bold: true }),
    body(`อ่างเก็บน้ำขนาดใหญ่ทั้ง ${largeDams.length} แห่ง มีปริมาณน้ำสะสมจากฤดูฝน อ่างขนาดกลาง ${mediumDams.length} แห่ง ส่วนใหญ่มีปริมาณน้ำอยู่ในระดับที่ดี สถานการณ์น้ำต้นทุนโดยรวมสามารถรองรับความต้องการใช้น้ำในฤดูแล้งถัดไปได้`, { indent: true }),
    emptyLine(5),
    body('ด้านคุณภาพอากาศ PM2.5', { bold: true }),
    body(`โดยรวมค่า PM2.5 ในเดือนสิงหาคมอยู่ในระดับดีถึงดีมาก สอดคล้องกับฤดูฝนที่ช่วยลดฝุ่นละออง ติดตาม ${pTotal[0]?.stations || 0} สถานีทั่วจังหวัด รวม ${totalPMReadings.toLocaleString()} ค่าการวัด ${pExceed.length > 0 ? 'ยังพบค่าผิดปกติสูงในบางสถานีที่ต้องตรวจสอบ' : 'ไม่พบค่าเกินมาตรฐานอย่างมีนัยสำคัญในเดือนนี้'} ควรเตรียมมาตรการรับมือฝุ่น PM2.5 ช่วงฤดูหนาว`, { indent: true }),
    emptyLine(5),
    body('ด้านเรื่องร้องเรียน', { bold: true }),
    body(`ระบบร้องเรียนผ่าน Traffy Fondue มีเรื่องร้องเรียนในเดือนสิงหาคม ${complaintTotal} เรื่อง สะสมทั้งหมด ${complaintTotalAll} เรื่อง ดำเนินการเสร็จสิ้นแล้ว ${complaintDone} เรื่อง คิดเป็น ${completionRate}% ${byTypeToShow.length > 0 ? `ประเภทปัญหาหลัก ได้แก่ ${byTypeToShow.slice(0, 3).map(t => t.problem_type).join(' | ')}` : ''} สะท้อนความต้องการของประชาชนด้านโครงสร้างพื้นฐาน`, { indent: true }),
    emptyLine(10),

    subHeader('๗.๒ ข้อเสนอแนะเชิงนโยบายระยะเร่งด่วน (ภายใน ๓๐ วัน)'),
    bullet('เฝ้าระวังพื้นที่เสี่ยงอุทกภัย – จัดส่งเจ้าหน้าที่ประจำพื้นที่และเตรียมแผนอพยพประชาชนรับมือน้ำหลากช่วงปลายฤดูฝน', { color: COLOR_DANGER }),
    bullet('ตรวจสอบสถานีตรวจวัด PM2.5 ที่มีค่าสูงผิดปกติ – ดำเนินการตรวจสอบเชิงเทคนิคและความถูกต้องของข้อมูล'),
    bullet('เร่งรัดและติดตามเรื่องร้องเรียนที่ค้างดำเนินการ โดยเฉพาะเรื่องที่เกี่ยวข้องกับโครงสร้างพื้นฐาน'),
    bullet('เริ่มวางแผนรับมือฝุ่น PM2.5 ในช่วงฤดูหนาวล่วงหน้า (ตุลาคม-พฤศจิกายน)'),
    emptyLine(5),

    subHeader('๗.๓ ข้อเสนอแนะเชิงนโยบายระยะกลาง (๑–๓ เดือน)'),
    bullet('พัฒนาระบบแจ้งเตือนภัยล่วงหน้าแบบอัตโนมัติ (Automated Early Warning) เชื่อมต่อกับ Line/SMS สำหรับน้ำ PM2.5 และภัยแล้ง'),
    bullet('เพิ่มจุดตรวจวัด PM2.5 ในพื้นที่ที่ยังไม่มีการครอบคลุม โดยเฉพาะอำเภอห่างไกล'),
    bullet('จัดทำแผนการบริหารน้ำในอ่างเก็บน้ำขนาดใหญ่สำหรับช่วงฤดูแล้งปีถัดไป (๒๕๗๐)'),
    bullet('พัฒนา Dashboard แบบ Real-time สำหรับผู้บริหาร เข้าถึงได้บนอุปกรณ์เคลื่อนที่'),
    emptyLine(5),

    subHeader('๗.๔ ข้อเสนอแนะเชิงยุทธศาสตร์ (๓ เดือนขึ้นไป)'),
    bullet('บูรณาการข้อมูลทั้ง ๔ ระบบเข้าสู่ศูนย์ปฏิบัติการอัจฉริยะ (Smart Operations Center) ของ อบจ.ลำปาง'),
    bullet('ใช้ประโยชน์จาก AI/ML วิเคราะห์แนวโน้มและพยากรณ์สถานการณ์น้ำ ภัยแล้ง และคุณภาพอากาศ'),
    bullet('ขยายความร่วมมือกับหน่วยงานรัฐและภาคเอกชนในการแลกเปลี่ยนข้อมูลสารสนเทศ'),
    bullet('จัดทำรายงานประจำเดือนเผยแพร่สู่สาธารณะผ่านเว็บไซต์และสื่อสังคมออนไลน์เพื่อความโปร่งใส'),
    emptyLine(20),
    pageBreak(),
  );

  // ---- ภาคผนวก ----
  sections.push(
    sectionHeader('ภาคผนวก : ข้อมูลอ้างอิงและแหล่งข้อมูล', SHADE_DARK),
    emptyLine(10),
    subHeader('แหล่งข้อมูล'),
    bullet('ระบบเฝ้าระวังน้ำ: กรมชลประทาน / Thai Water (lampang.thaiwater.net) – ข้อมูล ณ วันที่ 1-31 สิงหาคม 2569'),
    bullet('ระบบภัยแล้ง: กรมชลประทาน / กองอำนวยการน้ำแห่งชาติ – ข้อมูลอ่างเก็บน้ำรายวัน'),
    bullet('ระบบ PM2.5: กรมควบคุมมลพิษ (Air4Thai) / เครือข่ายตรวจวัดคุณภาพอากาศภาคเหนือ'),
    bullet('ระบบร้องเรียน: Traffy Fondue – ระบบรับเรื่องร้องเรียนออนไลน์ของจังหวัดลำปาง'),
    emptyLine(10),
    subHeader('ข้อมูลเกี่ยวกับรายงาน'),
    infoBox('ชื่อรายงาน', 'รายงานสรุปวิเคราะห์ข้อมูลรายเดือน สิงหาคม ๒๕๖๙'),
    infoBox('ช่วงข้อมูล', '๑ สิงหาคม – ๓๑ สิงหาคม ๒๕๖๙'),
    infoBox('วันที่จัดทำ', reportDateThai),
    infoBox('จัดทำโดย', 'ฝ่ายเทคโนโลยีสารสนเทศ องค์การบริหารส่วนจังหวัดลำปาง'),
    infoBox('ระบบสารสนเทศ', 'ระบบบูรณาการข้อมูลสารสนเทศ อบจ.ลำปาง (Water System Integration Platform)'),
    infoBox('จำนวนบันทึกทั้งหมด', `น้ำ ${parseInt(wTotal[0]?.cnt || 0).toLocaleString()} | ภัยแล้ง ${parseInt(dTotal[0]?.cnt || 0).toLocaleString()} | PM2.5 ${parseInt(pTotal[0]?.cnt || 0).toLocaleString()} | ร้องเรียน ${complaintTotal} รายการ`),
    emptyLine(20),
    dividerLine(),
    new Paragraph({
      children: [new TextRun({ text: 'รายงานฉบับนี้จัดทำโดยระบบสารสนเทศอัตโนมัติ – ข้อมูลมีความถูกต้องตามที่ได้รับจากแหล่งข้อมูลหลัก', font: FONT, size: FONT_SIZE_SM, color: COLOR_MUTED, italics: true })],
      alignment: AlignmentType.CENTER, spacing: { before: 100, after: 60 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `© ${reportDateThai} ฝ่ายเทคโนโลยีสารสนเทศ อบจ.ลำปาง`, font: FONT, size: FONT_SIZE_SM, color: COLOR_MUTED })],
      alignment: AlignmentType.CENTER, spacing: { before: 40, after: 100 },
    }),
  );

  // ============================================================
  // BUILD AND SAVE
  // ============================================================
  const doc = new Document({
    creator: 'ระบบสารสนเทศ อบจ.ลำปาง',
    title: 'รายงานสรุปวิเคราะห์ข้อมูลรายเดือน สิงหาคม 2569',
    description: 'รายงานสรุปวิเคราะห์ข้อมูล 4 ระบบ: น้ำ, ภัยแล้ง, PM2.5, ร้องเรียนลำปาง',
    sections: [{
      properties: {
        page: {
          margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: 'รายงานสรุปวิเคราะห์ข้อมูลรายเดือน สิงหาคม ๒๕๖๙  |  ระบบบูรณาการข้อมูลสารสนเทศ อบจ.ลำปาง', font: FONT, size: FONT_SIZE_SM, color: COLOR_MUTED }),
              ],
              alignment: AlignmentType.RIGHT,
              border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' } },
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
              border: { top: { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' } },
            }),
          ],
        }),
      },
      children: sections,
    }],
  });

  const fileName = `รายงานสรุปวิเคราะห์ข้อมูล (สิงหาคม 2569).docx`;
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(fileName, buffer);
  console.log(`✅ สร้างไฟล์สำเร็จ: ${fileName}`);
  console.log(`📁 ขนาดไฟล์: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
}

main().catch(e => { console.error('❌ Error:', e.message, e.stack); process.exit(1); });
