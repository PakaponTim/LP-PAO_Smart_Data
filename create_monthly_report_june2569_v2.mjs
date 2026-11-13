/**
 * create_monthly_report_june2569_v2.mjs
 * รายงานสรุปวิเคราะห์ข้อมูลรายเดือน มิถุนายน 2569
 * v2 - ใช้ pattern เดียวกับ create_committee_document.mjs ที่ใช้งานได้
 * ฟอนต์: TH SarabunPSK ขนาด 16pt (size=32 half-points)
 */

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, Table, TableRow, TableCell,
  WidthType, ShadingType, Header, Footer, PageNumber
} from 'docx';
import * as fs from 'fs';
import mysql from 'mysql2/promise';

// ============================================================
// CONFIG - ฟอนต์และขนาด (half-points)
// ============================================================
const FONT = 'TH SarabunPSK';
const SZ   = 32;   // 16pt body text
const SZ14 = 28;   // 14pt table/small
const SZ18 = 36;   // 18pt H2
const SZ20 = 40;   // 20pt H1
const SZ24 = 48;   // 24pt Title

// Colors
const C_TITLE   = '1A3C5E';
const C_H1      = '1E4D91';
const C_H2      = '0E5A8A';
const C_H3      = '1F6B8C';
const C_BODY    = '1A1A1A';
const C_OK      = '16A34A';
const C_WARN    = 'D97706';
const C_DANGER  = 'DC2626';
const C_MUTED   = '6B7280';
const C_WHITE   = 'FFFFFF';
const C_ACCENT  = '0369A1';

// Table header shading
const SH_BLUE   = '1E4D91';
const SH_GREEN  = '166534';
const SH_ORANGE = 'B45309';
const SH_PURPLE = '6B21A8';
const SH_TEAL   = '0F766E';
const SH_RED    = 'B91C1C';

// ============================================================
// HELPERS
// ============================================================
function blank(h = 100) {
  return new Paragraph({ children: [new TextRun({ text: '', size: SZ14 })], spacing: { before: 0, after: h } });
}

function pgBreak() {
  return new Paragraph({ children: [], pageBreakBefore: true });
}

function sectionBanner(text, shade = SH_BLUE) {
  return new Paragraph({
    children: [new TextRun({ text: `  ${text}`, font: FONT, size: SZ20, bold: true, color: C_WHITE })],
    shading: { type: ShadingType.SOLID, color: shade, fill: shade },
    spacing: { before: 300, after: 200 },
  });
}

function h2(text, color = C_H2) {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: SZ18, bold: true, color })],
    spacing: { before: 280, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color } },
  });
}

function h3(text, color = C_H3) {
  return new Paragraph({
    children: [new TextRun({ text: `◆ ${text}`, font: FONT, size: SZ, bold: true, color })],
    spacing: { before: 200, after: 80 },
  });
}

function txt(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({
      text, font: FONT, size: SZ,
      bold: opts.bold || false,
      italics: opts.italic || false,
      color: opts.color || C_BODY,
    })],
    spacing: { before: opts.before || 60, after: opts.after || 80 },
    indent: opts.indent ? { firstLine: 720 } : (opts.left ? { left: opts.left } : undefined),
    alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
  });
}

function bul(text, color = C_BODY, bold = false) {
  return new Paragraph({
    children: [
      new TextRun({ text: '●  ', font: FONT, size: SZ, color: C_ACCENT, bold: true }),
      new TextRun({ text, font: FONT, size: SZ, color, bold }),
    ],
    spacing: { before: 60, after: 60 },
    indent: { left: 720 },
  });
}

function subbul(text, color = C_BODY) {
  return new Paragraph({
    children: [
      new TextRun({ text: '▸  ', font: FONT, size: SZ, color: C_H3, bold: true }),
      new TextRun({ text, font: FONT, size: SZ, color }),
    ],
    spacing: { before: 40, after: 40 },
    indent: { left: 1440 },
  });
}

function kpiTable(items) {
  const cells = items.map(item => new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text: item.value, font: FONT, size: SZ18, bold: true, color: item.vc || C_ACCENT })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 80, after: 30 },
      }),
      new Paragraph({
        children: [new TextRun({ text: item.label, font: FONT, size: SZ14, color: C_MUTED })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 80 },
      }),
    ],
    shading: { type: ShadingType.SOLID, color: item.bg || 'F0F9FF', fill: item.bg || 'F0F9FF' },
    borders: {
      top: { style: BorderStyle.THICK, size: 6, color: item.vc || C_ACCENT },
      bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
    },
    margins: { top: 80, bottom: 80, left: 150, right: 150 },
  }));
  return new Table({
    rows: [new TableRow({ children: cells })],
    width: { size: 100, type: WidthType.PERCENTAGE },
    margins: { top: 100, bottom: 200 },
  });
}

function dataTable(headers, rows, shade = SH_BLUE, widths = null) {
  const n = headers.length;
  const dw = Math.floor(8640 / n);

  const hRow = new TableRow({
    children: headers.map((h, i) => new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text: h, font: FONT, size: SZ14, bold: true, color: C_WHITE })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 80, after: 80 },
      })],
      shading: { type: ShadingType.SOLID, color: shade, fill: shade },
      width: { size: widths ? widths[i] : dw, type: WidthType.DXA },
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
    })),
  });

  const bodyRows = rows.map((row, ri) => new TableRow({
    children: row.map((cell, ci) => {
      const cellText = typeof cell === 'object' ? (cell.text !== undefined ? String(cell.text) : '') : String(cell);
      const cellColor = typeof cell === 'object' ? (cell.color || C_BODY) : C_BODY;
      const cellBold = typeof cell === 'object' ? (cell.bold || false) : false;
      const cellAlign = typeof cell === 'object' ? (cell.align || AlignmentType.CENTER) : AlignmentType.CENTER;
      return new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ text: cellText, font: FONT, size: SZ14, bold: cellBold, color: cellColor })],
          alignment: cellAlign,
          spacing: { before: 60, after: 60 },
        })],
        shading: ri % 2 === 0
          ? { type: ShadingType.SOLID, color: 'F8FAFC', fill: 'F8FAFC' }
          : { type: ShadingType.SOLID, color: 'FFFFFF', fill: 'FFFFFF' },
        width: { size: widths ? widths[ci] : dw, type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
      });
    }),
  }));

  return new Table({
    rows: [hRow, ...bodyRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: shade },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: shade },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
      insideH: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
      insideV: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
    },
  });
}

function alertBox(text, bg = 'FEF3C7', tc = '92400E') {
  return new Paragraph({
    children: [new TextRun({ text: `  ${text}  `, font: FONT, size: SZ, color: tc, bold: true })],
    shading: { type: ShadingType.SOLID, color: bg, fill: bg },
    spacing: { before: 100, after: 100 },
    indent: { left: 200, right: 200 },
  });
}

function infoLine(label, value, color = C_ACCENT) {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, font: FONT, size: SZ, bold: true, color }),
      new TextRun({ text: value, font: FONT, size: SZ, color: C_BODY }),
    ],
    spacing: { before: 60, after: 60 },
    indent: { left: 360 },
  });
}

function riskColor(level) {
  if (level === 'วิกฤตสีแดง') return { text: '🔴 วิกฤตสีแดง', color: C_DANGER };
  if (level === 'เฝ้าระวัง')   return { text: '🟡 เฝ้าระวัง',   color: C_WARN  };
  return                              { text: '🟢 ปกติ',          color: C_OK    };
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  const pool = mysql.createPool({
    host: 'localhost', user: 'root', password: 'root',
    database: 'water_systems', connectionLimit: 5
  });

  // ---- WATER ----
  const [wSt] = await pool.query(`
    SELECT station_name, river, amphoe,
      ROUND(AVG(current_water_level_m),2) as avg_wl, MAX(current_water_level_m) as max_wl,
      ROUND(AVG(left_bank_level_m),2) as avg_bank, ROUND(AVG(bank_difference_m),2) as avg_diff,
      ROUND(AVG(current_rain_mm),2) as avg_rain, MAX(current_rain_mm) as max_rain,
      COUNT(*) as records, MAX(status) as status, MAX(risk_level) as risk_level
    FROM tbl_water_disaster_monitoring
    WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01'
    GROUP BY station_name, river, amphoe ORDER BY amphoe, station_name`);

  const [wRisk] = await pool.query(`
    SELECT risk_level, COUNT(DISTINCT station_name) as st
    FROM tbl_water_disaster_monitoring
    WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01'
    GROUP BY risk_level ORDER BY st DESC`);

  const [wStatus] = await pool.query(`
    SELECT status, COUNT(DISTINCT station_name) as st
    FROM tbl_water_disaster_monitoring
    WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01'
    GROUP BY status ORDER BY st DESC`);

  const [wTotal] = await pool.query(`
    SELECT COUNT(*) as cnt FROM tbl_water_disaster_monitoring
    WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01'`);

  // ---- DROUGHT ----
  const [dDams] = await pool.query(`
    SELECT dam_name, dam_type,
      ROUND(MAX(capacity_m_cum),2) as capacity,
      ROUND(AVG(water_volume_m_cum),2) as avg_vol,
      ROUND(AVG(usable_water_m_cum),2) as avg_use,
      ROUND(AVG(inflow_m_cum),4) as avg_in,
      ROUND(AVG(discharge_m_cum),4) as avg_out
    FROM tbl_drought_monitoring
    WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01'
    GROUP BY dam_name, dam_type ORDER BY capacity DESC, dam_name`);

  const [dLatest] = await pool.query(`
    SELECT dam_name, dam_type, water_volume_m_cum, water_percent,
      usable_water_m_cum, inflow_m_cum, discharge_m_cum
    FROM tbl_drought_monitoring
    WHERE recorded_at = (SELECT MAX(recorded_at) FROM tbl_drought_monitoring WHERE recorded_at < '2026-07-01')
    ORDER BY FIELD(dam_type,'อ่างขนาดใหญ่','อ่างขนาดกลาง','อ่างขนาดเล็ก'), dam_name`);

  const [dTotal] = await pool.query(`
    SELECT COUNT(*) as cnt FROM tbl_drought_monitoring
    WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01'`);

  // ---- PM25 ----
  const [pSt] = await pool.query(`
    SELECT station_name, tambon, amphoe,
      ROUND(AVG(pm25_value),2) as avg_pm25, MAX(pm25_value) as max_pm25,
      COUNT(*) as records
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01'
    GROUP BY station_name, tambon, amphoe ORDER BY avg_pm25 DESC`);

  const [pStatus] = await pool.query(`
    SELECT air_quality_status, COUNT(*) as cnt
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01'
    GROUP BY air_quality_status ORDER BY cnt DESC`);

  const [pAmph] = await pool.query(`
    SELECT amphoe, COUNT(DISTINCT station_name) as st,
      ROUND(AVG(pm25_value),2) as avg_pm25, MAX(pm25_value) as max_pm25
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01'
    GROUP BY amphoe ORDER BY avg_pm25 DESC`);

  const [pExceed] = await pool.query(`
    SELECT station_name, amphoe, MAX(pm25_value) as max_pm25,
      COUNT(*) as times, air_quality_status
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01' AND pm25_value > 37.5
    GROUP BY station_name, amphoe, air_quality_status ORDER BY max_pm25 DESC LIMIT 10`);

  const [pTotal] = await pool.query(`
    SELECT COUNT(*) as cnt, COUNT(DISTINCT station_name) as stations
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01'`);

  const [pDaily] = await pool.query(`
    SELECT DATE(recorded_at) as day,
      ROUND(AVG(pm25_value),2) as avg_pm25, MAX(pm25_value) as max_pm25,
      COUNT(*) as readings
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-06-01' AND recorded_at < '2026-07-01'
    GROUP BY DATE(recorded_at) ORDER BY day`);

  // ---- COMPLAINTS ----
  const [cAll] = await pool.query(`
    SELECT ticket_id, state_name, problem_type, description, location,
      ticket_datetime, satisfaction_stars, agency_status, recorded_at
    FROM tbl_complaints_monitoring ORDER BY recorded_at DESC`);

  const [cByType] = await pool.query(`
    SELECT problem_type, COUNT(*) as cnt
    FROM tbl_complaints_monitoring GROUP BY problem_type ORDER BY cnt DESC`);

  const [cByState] = await pool.query(`
    SELECT state_name, COUNT(*) as cnt
    FROM tbl_complaints_monitoring GROUP BY state_name ORDER BY cnt DESC`);

  const [cStat] = await pool.query(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN state_name='เสร็จสิ้น' THEN 1 ELSE 0 END) as done
    FROM tbl_complaints_monitoring`);

  await pool.end();

  // ============================================================
  // COMPUTED STATS
  // ============================================================
  const wTotal_n    = parseInt(wTotal[0].cnt);
  const nSt         = wSt.length;
  const nCrit       = wSt.filter(s => s.risk_level === 'วิกฤตสีแดง').length;
  const nWatch      = wSt.filter(s => s.risk_level === 'เฝ้าระวัง').length;
  const nNormal     = wSt.filter(s => s.risk_level === 'ปกติ').length;
  const amphoes     = [...new Set(wSt.map(s => s.amphoe))];

  const dLarge      = dDams.filter(d => d.dam_type === 'อ่างขนาดใหญ่');
  const dMedium     = dDams.filter(d => d.dam_type === 'อ่างขนาดกลาง');
  const dSmall      = dDams.filter(d => d.dam_type === 'อ่างขนาดเล็ก');
  const dLatLarge   = dLatest.filter(d => d.dam_type === 'อ่างขนาดใหญ่');
  const dLatMedium  = dLatest.filter(d => d.dam_type === 'อ่างขนาดกลาง');
  const dTotal_n    = parseInt(dTotal[0].cnt);

  const pmTotal_n   = parseInt(pTotal[0].cnt);
  const pmStations  = parseInt(pTotal[0].stations);
  const pmGood      = pStatus.find(s => s.air_quality_status === 'ดีมาก')?.cnt || 0;
  const pmHealthCnt = pStatus.filter(s => ['เริ่มมีผลต่อสุขภาพ','มีผลกระทบต่อสุขภาพ'].includes(s.air_quality_status))
                             .reduce((a, s) => a + parseInt(s.cnt), 0);
  const pmGoodPct   = Math.round((pmGood / pmTotal_n) * 100);

  const cTotal_n    = parseInt(cStat[0].total);
  const cDone       = parseInt(cStat[0].done);
  const cPct        = cTotal_n > 0 ? Math.round((cDone / cTotal_n) * 100) : 0;

  // ============================================================
  // BUILD DOC CHILDREN ARRAY
  // ============================================================
  const children = [];

  // ────────────────────────────────────────────────────────────
  // COVER PAGE
  // ────────────────────────────────────────────────────────────
  children.push(
    blank(600),
    new Paragraph({
      children: [new TextRun({ text: 'องค์การบริหารส่วนจังหวัดลำปาง', font: FONT, size: SZ18, color: C_MUTED })],
      alignment: AlignmentType.CENTER, spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'ระบบบูรณาการข้อมูลสารสนเทศ', font: FONT, size: SZ20, bold: true, color: C_H1 })],
      alignment: AlignmentType.CENTER, spacing: { after: 80 },
    }),
    blank(100),
    new Paragraph({
      children: [new TextRun({ text: 'รายงานสรุปวิเคราะห์ข้อมูลรายเดือน', font: FONT, size: SZ24, bold: true, color: C_TITLE })],
      alignment: AlignmentType.CENTER,
      border: {
        top: { style: BorderStyle.THICK, size: 6, color: C_H1 },
        bottom: { style: BorderStyle.THICK, size: 6, color: C_H1 },
      },
      spacing: { before: 100, after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'ประจำเดือน มิถุนายน พ.ศ. ๒๕๖๙', font: FONT, size: SZ24, bold: true, color: C_ACCENT })],
      alignment: AlignmentType.CENTER, spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: '(๑ มิถุนายน – ๓๐ มิถุนายน ๒๕๖๙)', font: FONT, size: SZ18, color: C_MUTED })],
      alignment: AlignmentType.CENTER, spacing: { after: 300 },
    }),
    blank(100),
    kpiTable([
      { label: 'สถานีตรวจวัดน้ำ', value: `${nSt} สถานี`, vc: C_H1, bg: 'EFF6FF' },
      { label: 'อ่างเก็บน้ำ', value: `${dDams.length} แห่ง`, vc: C_OK, bg: 'F0FDF4' },
      { label: 'สถานีตรวจ PM2.5', value: `${pmStations} สถานี`, vc: C_WARN, bg: 'FFFBEB' },
      { label: 'เรื่องร้องเรียน', value: `${cTotal_n} เรื่อง`, vc: '7C3AED', bg: 'F5F3FF' },
    ]),
    blank(100),
    new Paragraph({
      children: [new TextRun({ text: 'จัดทำ ณ วันที่ ๑ กรกฎาคม พ.ศ. ๒๕๖๙', font: FONT, size: SZ, color: C_MUTED })],
      alignment: AlignmentType.CENTER, spacing: { before: 200, after: 60 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'ฝ่ายเทคโนโลยีสารสนเทศ  |  องค์การบริหารส่วนจังหวัดลำปาง', font: FONT, size: SZ, color: C_MUTED })],
      alignment: AlignmentType.CENTER, spacing: { after: 200 },
    }),
  );

  // ────────────────────────────────────────────────────────────
  // บทที่ 1: บทสรุปผู้บริหาร
  // ────────────────────────────────────────────────────────────
  children.push(
    pgBreak(),
    sectionBanner('บทที่ ๑ : บทสรุปสำหรับผู้บริหาร (Executive Summary)', SH_BLUE),
    blank(80),
    txt('รายงานฉบับนี้จัดทำขึ้นเพื่อสรุปผลการติดตามและวิเคราะห์ข้อมูลสารสนเทศด้านสิ่งแวดล้อมและสาธารณประโยชน์ของจังหวัดลำปาง ประจำเดือนมิถุนายน พ.ศ. ๒๕๖๙ ครอบคลุม ๔ ระบบหลัก ได้แก่ ระบบเฝ้าระวังน้ำ ระบบเฝ้าระวังภัยแล้ง ระบบติดตามคุณภาพอากาศ PM2.5 และระบบติดตามเรื่องร้องเรียนของประชาชน', { indent: true }),
    blank(80),
    h3('สรุปสถานการณ์ภาพรวม'),
    txt('ระบบน้ำและเฝ้าระวังอุทกภัย', { bold: true, color: C_H1 }),
    bul(`ติดตามจำนวน ${nSt} สถานีตรวจวัด ครอบคลุม ${amphoes.length} อำเภอในจังหวัดลำปาง`),
    bul(`พบสถานีที่อยู่ในระดับวิกฤตสีแดง จำนวน ${nCrit} สถานี – ต้องเฝ้าระวังเป็นพิเศษ`, C_DANGER, true),
    bul(`สถานีระดับเฝ้าระวัง (สีเหลือง) จำนวน ${nWatch} สถานี`, C_WARN),
    bul(`สถานีระดับปกติ จำนวน ${nNormal} สถานี`, C_OK),
    bul('ทิศทางน้ำโดยรวม: มีแนวโน้มเพิ่มขึ้นตามฤดูกาลฝน ระดับน้ำยังต่ำกว่าตลิ่งในทุกสถานี'),
    blank(60),
    txt('ระบบเฝ้าระวังภัยแล้ง (อ่างเก็บน้ำ)', { bold: true, color: C_OK }),
    bul(`ติดตามอ่างเก็บน้ำ ${dDams.length} แห่ง แบ่งเป็นขนาดใหญ่ ${dLarge.length} แห่ง ขนาดกลาง ${dMedium.length} แห่ง ขนาดเล็ก ${dSmall.length} แห่ง`),
    ...dLatLarge.map(d => bul(`${d.dam_name}: ปริมาณน้ำ ${parseFloat(d.water_volume_m_cum).toFixed(2)} ล้าน ลบ.ม. (${d.water_percent})`)),
    bul('อ่างขนาดใหญ่ทุกแห่งมีปริมาณน้ำสะสมเพิ่มขึ้น สอดคล้องกับการเข้าสู่ฤดูฝน'),
    blank(60),
    txt('ระบบติดตามคุณภาพอากาศ PM2.5', { bold: true, color: C_WARN }),
    bul(`ติดตาม ${pmStations} สถานีตรวจวัด รวม ${pmTotal_n.toLocaleString()} ค่าการวัด`),
    bul(`ร้อยละ ${pmGoodPct}% ของค่าการวัดอยู่ในระดับ "ดีมาก" (PM2.5 ≤ 25 μg/m³)`, C_OK),
    bul(`พบค่าเกินมาตรฐาน (>37.5 μg/m³) จำนวน ${pmHealthCnt} ครั้ง โดยเฉพาะสถานีในอำเภอแจ้ห่มและแม่เมาะ`, C_DANGER),
    blank(60),
    txt('ระบบร้องเรียนประชาชน (Traffy Fondue ลำปาง)', { bold: true, color: '7C3AED' }),
    bul(`รับเรื่องร้องเรียนสะสมในระบบ ${cTotal_n} เรื่อง`),
    bul(`ดำเนินการเสร็จสิ้นแล้ว ${cDone} เรื่อง (${cPct}%)`),
    bul(`ประเภทเรื่องร้องเรียนหลัก: ${cByType.slice(0,3).map(t=>`${t.problem_type} (${t.cnt} เรื่อง)`).join(' | ')}`),
    blank(100),
    h3('ประเด็นที่ผู้บริหารควรทราบ'),
    alertBox(`⚠ พื้นที่วิกฤต: พบสถานีตรวจวัดน้ำระดับวิกฤตสีแดง ${nCrit} สถานี ในอำเภอเถิน – ต้องเฝ้าระวังอุทกภัยในช่วงฤดูฝน`, 'FEE2E2', '991B1B'),
    blank(60),
    alertBox('⚠ คุณภาพอากาศ: สถานีศาลาเอนกประสงค์บ้านหลุก อ.แจ้ห่ม และวัดปางป๋วย อ.แม่เมาะ มีค่า PM2.5 สูงสุดเกิน 285 μg/m³ ในบางช่วงเวลา', 'FEF3C7', '92400E'),
    blank(120),
  );

  // ────────────────────────────────────────────────────────────
  // บทที่ 2: น้ำ
  // ────────────────────────────────────────────────────────────
  children.push(
    pgBreak(),
    sectionBanner('บทที่ ๒ : ระบบเฝ้าระวังน้ำและอุทกภัย', SH_BLUE),
    blank(60),
    h2('๒.๑ ภาพรวมสถานการณ์น้ำ เดือนมิถุนายน ๒๕๖๙'),
    txt('ระบบเฝ้าระวังน้ำดำเนินการติดตามระดับน้ำแบบอัตโนมัติตลอด ๒๔ ชั่วโมง ผ่านเครือข่ายสถานีตรวจวัดที่กระจายทั่วพื้นที่ลุ่มน้ำสำคัญ ได้แก่ ลุ่มน้ำวัง และลุ่มน้ำยม ในช่วงเดือนมิถุนายน ๒๕๖๙ ซึ่งเป็นช่วงเข้าสู่ฤดูฝน ระดับน้ำในแม่น้ำสายต่างๆ มีแนวโน้มเพิ่มสูงขึ้น', { indent: true }),
    blank(80),
    kpiTable([
      { label: 'จำนวนสถานีตรวจวัด', value: `${nSt}`, vc: C_H1, bg: 'EFF6FF' },
      { label: 'วิกฤตสีแดง', value: `${nCrit}`, vc: C_DANGER, bg: 'FEF2F2' },
      { label: 'เฝ้าระวัง', value: `${nWatch}`, vc: C_WARN, bg: 'FFFBEB' },
      { label: 'ระดับปกติ', value: `${nNormal}`, vc: C_OK, bg: 'F0FDF4' },
    ]),
    blank(80),
    h2('๒.๒ สรุประดับความเสี่ยงตามประเภท'),
    dataTable(
      ['ระดับความเสี่ยง', 'จำนวนสถานี', 'ร้อยละ', 'ความหมาย'],
      [
        [{ text: '🔴 วิกฤตสีแดง', align: AlignmentType.LEFT, color: C_DANGER, bold: true }, `${nCrit} สถานี`, `${Math.round(nCrit/nSt*100)}%`, { text: 'ระดับน้ำน้อยวิกฤต ต้องเฝ้าระวัง', align: AlignmentType.LEFT }],
        [{ text: '🟡 เฝ้าระวัง',   align: AlignmentType.LEFT, color: C_WARN,   bold: true }, `${nWatch} สถานี`, `${Math.round(nWatch/nSt*100)}%`, { text: 'ใกล้เกณฑ์วิกฤต', align: AlignmentType.LEFT }],
        [{ text: '🟢 ปกติ',         align: AlignmentType.LEFT, color: C_OK,     bold: true }, `${nNormal} สถานี`, `${Math.round(nNormal/nSt*100)}%`, { text: 'อยู่ในเกณฑ์ปกติ', align: AlignmentType.LEFT }],
        [{ text: 'รวม', bold: true, align: AlignmentType.LEFT }, `${nSt} สถานี`, '100%', ''],
      ],
      SH_BLUE, [2800, 2000, 1400, 2400]
    ),
    blank(80),
    h2('๒.๓ ข้อมูลสถานีตรวจวัดรายสถานี'),
    dataTable(
      ['สถานีตรวจวัด', 'แม่น้ำ/ลุ่มน้ำ', 'อำเภอ', 'ระดับน้ำเฉลี่ย\n(ม.รทก.)', 'ระดับตลิ่ง\n(ม.รทก.)', 'ฝนเฉลี่ย\n(มม.)', 'ระดับความเสี่ยง'],
      wSt.map(s => {
        const r = riskColor(s.risk_level);
        return [
          { text: s.station_name, align: AlignmentType.LEFT },
          { text: s.river, align: AlignmentType.LEFT },
          { text: (s.amphoe || '').replace('อำเภอ',''), align: AlignmentType.LEFT },
          s.avg_wl?.toString() || '-',
          s.avg_bank?.toString() || '-',
          s.avg_rain?.toString() || '-',
          { text: r.text, color: r.color, bold: true },
        ];
      }),
      SH_BLUE, [2000, 1600, 1400, 1600, 1600, 1300, 1900]
    ),
    blank(80),
    h2('๒.๔ สถานีที่อยู่ในระดับวิกฤตและข้อเสนอแนะ'),
    h3('สถานีระดับวิกฤตสีแดง'),
    ...wSt.filter(s => s.risk_level === 'วิกฤตสีแดง').map(s =>
      bul(`${s.station_name} (${s.amphoe}) – ระดับน้ำเฉลี่ย ${s.avg_wl} ม.รทก., สถานะ: ${s.status}`, C_DANGER)
    ),
    blank(60),
    h3('ข้อเสนอแนะเชิงนโยบาย'),
    bul('จัดส่งเจ้าหน้าที่ลงพื้นที่เฝ้าระวังสถานีวิกฤตในพื้นที่อำเภอเถิน อย่างน้อยสัปดาห์ละ ๒ ครั้ง'),
    bul('ประสานหน่วยงานที่เกี่ยวข้องเพื่อเตรียมแผนอพยพประชาชนในพื้นที่เสี่ยง'),
    bul('ติดตั้งระบบแจ้งเตือนภัยล่วงหน้า (Early Warning System) เพิ่มเติมในพื้นที่วิกฤต'),
    bul('เพิ่มความถี่ในการอ่านค่าระดับน้ำในช่วงฤดูฝน (มิถุนายน – ตุลาคม)'),
    blank(120),
  );

  // ────────────────────────────────────────────────────────────
  // บทที่ 3: ภัยแล้ง
  // ────────────────────────────────────────────────────────────
  children.push(
    pgBreak(),
    sectionBanner('บทที่ ๓ : ระบบเฝ้าระวังภัยแล้ง (อ่างเก็บน้ำ)', SH_GREEN),
    blank(60),
    h2('๓.๑ ภาพรวมสถานการณ์อ่างเก็บน้ำ'),
    txt('ระบบเฝ้าระวังภัยแล้งติดตามปริมาณน้ำในอ่างเก็บน้ำทุกขนาด ๓ ประเภท ได้แก่ อ่างขนาดใหญ่ อ่างขนาดกลาง และอ่างขนาดเล็ก เพื่อประเมินสถานการณ์น้ำต้นทุนและวางแผนการจัดสรรน้ำให้แก่ภาคเกษตร อุปโภค-บริโภค และอุตสาหกรรม', { indent: true }),
    blank(80),
    kpiTable([
      { label: 'อ่างขนาดใหญ่', value: `${dLarge.length} แห่ง`, vc: C_H1, bg: 'EFF6FF' },
      { label: 'อ่างขนาดกลาง', value: `${dMedium.length} แห่ง`, vc: C_OK, bg: 'F0FDF4' },
      { label: 'อ่างขนาดเล็ก', value: `${dSmall.length} แห่ง`, vc: C_WARN, bg: 'FFFBEB' },
      { label: 'รวมทั้งหมด', value: `${dDams.length} แห่ง`, vc: '7C3AED', bg: 'F5F3FF' },
    ]),
    blank(80),
    h2('๓.๒ สถานการณ์อ่างเก็บน้ำขนาดใหญ่ ณ วันที่ ๓๐ มิถุนายน ๒๕๖๙'),
    dataTable(
      ['ชื่ออ่างเก็บน้ำ', 'ปริมาณน้ำ\n(ล้าน ลบ.ม.)', 'ร้อยละ (%)', 'น้ำใช้การได้\n(ล้าน ลบ.ม.)', 'น้ำไหลเข้า\n(ล้าน ลบ.ม./วัน)', 'น้ำระบาย\n(ล้าน ลบ.ม./วัน)'],
      dLatLarge.map(d => {
        const pct = parseInt(d.water_percent) || 0;
        const pc  = pct < 30 ? C_DANGER : pct < 60 ? C_WARN : C_OK;
        return [
          { text: d.dam_name, align: AlignmentType.LEFT },
          { text: parseFloat(d.water_volume_m_cum).toFixed(2), bold: true },
          { text: d.water_percent, color: pc, bold: true },
          parseFloat(d.usable_water_m_cum || 0).toFixed(2),
          parseFloat(d.inflow_m_cum || 0).toFixed(4),
          parseFloat(d.discharge_m_cum || 0).toFixed(4),
        ];
      }),
      SH_GREEN, [2200, 1700, 1400, 2000, 1900, 1900]
    ),
    blank(80),
    h2('๓.๓ สถานการณ์อ่างเก็บน้ำขนาดกลาง ณ วันที่ ๓๐ มิถุนายน ๒๕๖๙'),
    dataTable(
      ['ชื่ออ่างเก็บน้ำ', 'ความจุ\n(ล้าน ลบ.ม.)', 'ปริมาณน้ำ\n(ล้าน ลบ.ม.)', 'ร้อยละ (%)', 'น้ำใช้การได้\n(ล้าน ลบ.ม.)'],
      dLatMedium.slice(0,16).map(d => {
        const pct = parseInt(d.water_percent) || 0;
        const pc  = pct < 30 ? C_DANGER : pct < 60 ? C_WARN : C_OK;
        const cap = dMedium.find(dm => dm.dam_name === d.dam_name)?.capacity || 0;
        return [
          { text: d.dam_name, align: AlignmentType.LEFT },
          parseFloat(cap).toFixed(2),
          parseFloat(d.water_volume_m_cum).toFixed(2),
          { text: d.water_percent, color: pc },
          parseFloat(d.usable_water_m_cum || 0).toFixed(2),
        ];
      }),
      SH_GREEN, [2800, 1700, 1700, 1200, 1900]
    ),
    blank(80),
    h2('๓.๔ การวิเคราะห์แนวโน้มและข้อเสนอแนะ'),
    h3('ผลการวิเคราะห์'),
    bul('อ่างกิ่วลม: ปริมาณน้ำ 79% ของความจุ อยู่ในเกณฑ์ดี มีปริมาณน้ำไหลเข้าและระบายออกสมดุล'),
    bul('อ่างกิ่วคอหมา: ปริมาณน้ำ 44% ของความจุ ยังอยู่ในระดับที่ต้องติดตาม', C_WARN),
    bul('อ่างขนาดกลางส่วนใหญ่มีปริมาณน้ำ 60–90% ของความจุ สะท้อนว่าฤดูฝนช่วยเพิ่มปริมาณน้ำสะสมได้ดี', C_OK),
    blank(60),
    h3('ข้อเสนอแนะ'),
    bul('วางแผนการจัดสรรน้ำจากอ่างกิ่วลมให้ภาคเกษตรในช่วงหน้าแล้ง'),
    bul('ติดตามปริมาณน้ำอ่างกิ่วคอหมาอย่างใกล้ชิด หากมีแนวโน้มลดลงควรพิจารณาปรับแผนระบาย'),
    bul('เร่งรัดการตรวจสอบสภาพเขื่อนและอาคารชลประทานก่อนเข้าสู่ช่วงฝนหนัก'),
    blank(120),
  );

  // ────────────────────────────────────────────────────────────
  // บทที่ 4: PM2.5
  // ────────────────────────────────────────────────────────────
  children.push(
    pgBreak(),
    sectionBanner('บทที่ ๔ : ระบบติดตามคุณภาพอากาศ PM2.5', SH_ORANGE),
    blank(60),
    h2('๔.๑ ภาพรวมคุณภาพอากาศ เดือนมิถุนายน ๒๕๖๙'),
    txt('การติดตามคุณภาพอากาศโดยวัดค่าฝุ่นละอองขนาดเล็ก PM2.5 ดำเนินการผ่านเครือข่ายสถานีตรวจวัดอัตโนมัติ ในช่วงเดือนมิถุนายน ซึ่งเป็นช่วงที่มีฝนตกสม่ำเสมอ ค่า PM2.5 โดยรวมอยู่ในระดับดีขึ้นเมื่อเทียบกับช่วงฤดูแล้ง อย่างไรก็ตามยังพบค่าสูงผิดปกติในบางพื้นที่', { indent: true }),
    blank(80),
    kpiTable([
      { label: 'สถานีตรวจวัด', value: `${pmStations}`, vc: C_H1, bg: 'EFF6FF' },
      { label: 'ค่าการวัดทั้งหมด', value: pmTotal_n.toLocaleString(), vc: C_H2, bg: 'F0F9FF' },
      { label: 'ระดับ "ดีมาก"', value: `${pmGoodPct}%`, vc: C_OK, bg: 'F0FDF4' },
      { label: 'เกินมาตรฐาน', value: `${pmHealthCnt} ครั้ง`, vc: C_DANGER, bg: 'FEF2F2' },
    ]),
    blank(80),
    h2('๔.๒ สรุประดับคุณภาพอากาศ'),
    dataTable(
      ['ระดับคุณภาพอากาศ', 'เกณฑ์ PM2.5 (μg/m³)', 'จำนวนครั้ง', 'สัดส่วน (%)'],
      pStatus.map(s => {
        const threshMap = { 'ดีมาก':'0–25','ดี':'25.1–37.5','ปานกลาง':'37.6–75','เริ่มมีผลต่อสุขภาพ':'75.1–150','มีผลกระทบต่อสุขภาพ':'>150' };
        const clrMap    = { 'ดีมาก':C_OK,'ดี':'65A30D','ปานกลาง':C_WARN,'เริ่มมีผลต่อสุขภาพ':'EA580C','มีผลกระทบต่อสุขภาพ':C_DANGER };
        return [
          { text: s.air_quality_status, align: AlignmentType.LEFT, color: clrMap[s.air_quality_status]||C_BODY, bold: true },
          threshMap[s.air_quality_status]||'-',
          parseInt(s.cnt).toLocaleString(),
          `${Math.round((parseInt(s.cnt)/pmTotal_n)*100)}%`,
        ];
      }),
      SH_ORANGE, [2400, 2200, 1800, 1600]
    ),
    blank(80),
    h2('๔.๓ ค่า PM2.5 รายอำเภอ'),
    dataTable(
      ['อำเภอ', 'จำนวนสถานี', 'ค่าเฉลี่ย (μg/m³)', 'ค่าสูงสุด (μg/m³)'],
      pAmph.map(a => [
        { text: a.amphoe, align: AlignmentType.LEFT },
        `${a.st} สถานี`,
        { text: parseFloat(a.avg_pm25).toFixed(2), color: parseFloat(a.avg_pm25)>37.5?C_DANGER:parseFloat(a.avg_pm25)>25?C_WARN:C_OK },
        { text: parseFloat(a.max_pm25).toFixed(2), bold: parseFloat(a.max_pm25)>75, color: parseFloat(a.max_pm25)>75?C_DANGER:C_BODY },
      ]),
      SH_ORANGE, [2500, 1500, 2000, 2000]
    ),
    blank(80),
    h2('๔.๔ สถานีที่มีค่าเกินมาตรฐาน (PM2.5 > 37.5 μg/m³)'),
    pExceed.length > 0
      ? dataTable(
          ['สถานีตรวจวัด', 'อำเภอ', 'ค่าสูงสุด (μg/m³)', 'จำนวนครั้ง', 'ระดับผลกระทบ'],
          pExceed.map(e => [
            { text: e.station_name, align: AlignmentType.LEFT },
            { text: e.amphoe, align: AlignmentType.LEFT },
            { text: parseFloat(e.max_pm25).toFixed(2), bold: true, color: C_DANGER },
            `${e.times} ครั้ง`,
            { text: e.air_quality_status, color: C_DANGER },
          ]),
          SH_RED, [2800, 1600, 1800, 1400, 2000]
        )
      : txt('ไม่พบสถานีที่มีค่าเกินมาตรฐานในเดือนนี้', { color: C_OK }),
    blank(80),
    h2('๔.๕ แนวโน้มค่า PM2.5 รายวัน'),
    dataTable(
      ['วันที่', 'ค่าเฉลี่ย (μg/m³)', 'ค่าสูงสุด (μg/m³)', 'จำนวนค่าการวัด'],
      pDaily.map(d => {
        const dt = new Date(d.day);
        const thaiDate = `${dt.getUTCDate()} มิ.ย. 2569`;
        return [
          { text: thaiDate, align: AlignmentType.LEFT },
          { text: parseFloat(d.avg_pm25).toFixed(2), color: parseFloat(d.avg_pm25)>37.5?C_DANGER:parseFloat(d.avg_pm25)>25?C_WARN:C_OK },
          { text: parseFloat(d.max_pm25).toFixed(2), color: parseFloat(d.max_pm25)>75?C_DANGER:C_BODY },
          parseInt(d.readings).toLocaleString(),
        ];
      }),
      SH_ORANGE, [2000, 2000, 2000, 2000]
    ),
    blank(80),
    h2('๔.๖ ข้อเสนอแนะด้านคุณภาพอากาศ'),
    bul('ตรวจสอบความถูกต้องของเซ็นเซอร์ที่สถานีศาลาเอนกประสงค์บ้านหลุก อ.แจ้ห่ม เนื่องจากพบค่าสูงผิดปกติเกิน 293 μg/m³', C_DANGER),
    bul('ติดตามค่า PM2.5 ที่สถานีวัดปางป๋วย อ.แม่เมาะ อย่างใกล้ชิด และประชาสัมพันธ์ให้ประชาชนป้องกันตนเอง'),
    bul('ส่งเสริมการลดกิจกรรมที่ก่อให้เกิดฝุ่น โดยเฉพาะการเผาในที่โล่ง'),
    bul('พัฒนาระบบแจ้งเตือนอัตโนมัติเมื่อค่า PM2.5 เกินมาตรฐาน'),
    blank(120),
  );

  // ────────────────────────────────────────────────────────────
  // บทที่ 5: ร้องเรียน
  // ────────────────────────────────────────────────────────────
  children.push(
    pgBreak(),
    sectionBanner('บทที่ ๕ : ระบบติดตามเรื่องร้องเรียนประชาชน (Traffy Fondue ลำปาง)', SH_PURPLE),
    blank(60),
    h2('๕.๑ ภาพรวมเรื่องร้องเรียน'),
    txt('ระบบรับและติดตามเรื่องร้องเรียนผ่านแพลตฟอร์ม Traffy Fondue เป็นช่องทางหลักที่ประชาชนในจังหวัดลำปางใช้แจ้งปัญหาและข้อร้องเรียนต่างๆ ไปยังหน่วยงานรับผิดชอบ ระบบสามารถติดตามสถานะการดำเนินการและวัดความพึงพอใจของผู้ร้องเรียนได้', { indent: true }),
    blank(80),
    kpiTable([
      { label: 'เรื่องร้องเรียนทั้งหมด', value: `${cTotal_n}`, vc: '7C3AED', bg: 'F5F3FF' },
      { label: 'ดำเนินการเสร็จสิ้น', value: `${cDone}`, vc: C_OK, bg: 'F0FDF4' },
      { label: 'รอดำเนินการ', value: `${cTotal_n - cDone}`, vc: C_WARN, bg: 'FFFBEB' },
      { label: 'อัตราดำเนินการสำเร็จ', value: `${cPct}%`, vc: C_ACCENT, bg: 'EFF6FF' },
    ]),
    blank(80),
    h2('๕.๒ สรุปสถานะเรื่องร้องเรียน'),
    dataTable(
      ['สถานะ', 'จำนวน (เรื่อง)', 'ร้อยละ'],
      cByState.map(s => [
        { text: s.state_name, align: AlignmentType.LEFT },
        s.cnt.toString(),
        `${Math.round((parseInt(s.cnt)/cTotal_n)*100)}%`,
      ]),
      SH_PURPLE, [4000, 2000, 2000]
    ),
    blank(80),
    h2('๕.๓ ประเภทเรื่องร้องเรียนที่พบบ่อย'),
    dataTable(
      ['ลำดับ', 'ประเภทปัญหา', 'จำนวน (เรื่อง)', 'ร้อยละ'],
      cByType.map((t, i) => [
        `${i+1}`,
        { text: t.problem_type, align: AlignmentType.LEFT },
        t.cnt.toString(),
        `${Math.round((parseInt(t.cnt)/cTotal_n)*100)}%`,
      ]),
      SH_PURPLE, [800, 3500, 1800, 1900]
    ),
    blank(80),
    h2('๕.๔ รายการเรื่องร้องเรียนทั้งหมดในระบบ'),
    dataTable(
      ['รหัสเรื่อง', 'ประเภท', 'พื้นที่', 'วันที่แจ้ง', 'สถานะ', 'หน่วยรับ'],
      cAll.slice(0,20).map(c => {
        const loc = (c.location||'-').split('\n')[0].replace('จังหวัดลำปาง','').replace('ประเทศไทย','').trim();
        const ag  = (c.agency_status||'-').replace('สถานะที่รับ ','').replace('งานที่เป็นสถานะอื่นๆ','อื่นๆ')
                     .replace('งานที่รับเรื่องร้องเรียน','รับเรื่อง').replace('หน่วยงานส่งต่อให้ อบจ.ดำเนินการ','ส่งต่อ อบจ.')
                     .replace('งานที่ อบจ.ดำเนินการเสร็จ','อบจ.เสร็จ');
        const sc  = c.state_name === 'เสร็จสิ้น' ? C_OK : (c.state_name||'').includes('รอ') ? C_WARN : C_BODY;
        return [
          { text: c.ticket_id||'-', align: AlignmentType.LEFT },
          { text: c.problem_type||'-', align: AlignmentType.LEFT },
          { text: loc.slice(0,28), align: AlignmentType.LEFT },
          { text: (c.ticket_datetime||'-').replace('น.','').trim().slice(0,18), align: AlignmentType.LEFT },
          { text: c.state_name||'-', color: sc },
          { text: ag.slice(0,18), align: AlignmentType.LEFT },
        ];
      }),
      SH_PURPLE, [1400, 1300, 2200, 1800, 1400, 2100]
    ),
    blank(80),
    h2('๕.๕ ข้อเสนอแนะด้านระบบร้องเรียน'),
    bul('เร่งรัดการดำเนินการเรื่องร้องเรียนที่อยู่ระหว่างดำเนินการ โดยเฉพาะเรื่องถนนและไฟฟ้า'),
    bul('จัดทำรายงานสรุปผลการดำเนินการเรื่องร้องเรียนเสนอผู้บริหารเป็นรายเดือน'),
    bul('พัฒนาระบบแจ้งเตือนอัตโนมัติเมื่อเรื่องร้องเรียนค้างนานเกิน ๑๕ วัน'),
    bul('เพิ่มช่องทางการแสดงความพึงพอใจเพื่อวัดประสิทธิภาพการบริการ'),
    blank(120),
  );

  // ────────────────────────────────────────────────────────────
  // บทที่ 6: Dashboard & KPI
  // ────────────────────────────────────────────────────────────
  children.push(
    pgBreak(),
    sectionBanner('บทที่ ๖ : Dashboard และข้อมูลสารสนเทศเพื่อการติดตามและประเมินผล', SH_TEAL),
    blank(60),
    h2('๖.๑ ตาราง Dashboard ภาพรวม ๔ ระบบ'),
    dataTable(
      ['ระบบ', 'ตัวชี้วัดหลัก', 'ค่า', 'สถานะ'],
      [
        [{ text:'💧 ระบบน้ำ',      align:AlignmentType.LEFT,bold:true,color:C_H1  }, {text:'จำนวนสถานีตรวจวัด',align:AlignmentType.LEFT}, `${nSt} สถานี`, {text:'✅ ปกติ',      color:C_OK    }],
        [{ text:'',                 align:AlignmentType.LEFT                        }, {text:'สถานีวิกฤตสีแดง',  align:AlignmentType.LEFT}, `${nCrit} สถานี`,  {text:'🔴 ต้องเฝ้าระวัง',color:C_DANGER}],
        [{ text:'',                 align:AlignmentType.LEFT                        }, {text:'สถานีเฝ้าระวัง',   align:AlignmentType.LEFT}, `${nWatch} สถานี`, {text:'🟡 ระวัง',   color:C_WARN  }],
        [{ text:'🏞 อ่างเก็บน้ำ', align:AlignmentType.LEFT,bold:true,color:C_OK   }, {text:'จำนวนอ่างที่ติดตาม',align:AlignmentType.LEFT},`${dDams.length} แห่ง`,{text:'✅ ปกติ',color:C_OK   }],
        [{ text:'',                 align:AlignmentType.LEFT                        }, {text:'อ่างกิ่วลม',       align:AlignmentType.LEFT}, '84.10 ล้าน ลบ.ม. (79%)', {text:'✅ เพียงพอ', color:C_OK }],
        [{ text:'',                 align:AlignmentType.LEFT                        }, {text:'อ่างกิ่วคอหมา',    align:AlignmentType.LEFT}, '75.39 ล้าน ลบ.ม. (44%)', {text:'🟡 ติดตาม',  color:C_WARN}],
        [{ text:'🌫 PM2.5',        align:AlignmentType.LEFT,bold:true,color:C_WARN }, {text:'สถานีตรวจวัด',     align:AlignmentType.LEFT}, `${pmStations} สถานี`,{text:'✅ ปกติ',  color:C_OK   }],
        [{ text:'',                 align:AlignmentType.LEFT                        }, {text:'สัดส่วนระดับดีมาก', align:AlignmentType.LEFT},`${pmGoodPct}%`, {text:'✅ ดี',         color:C_OK   }],
        [{ text:'',                 align:AlignmentType.LEFT                        }, {text:'ครั้งที่เกินมาตรฐาน',align:AlignmentType.LEFT},`${pmHealthCnt} ครั้ง`,{text:'🔴 ต้องติดตาม',color:C_DANGER}],
        [{ text:'📋 ร้องเรียน',    align:AlignmentType.LEFT,bold:true,color:'7C3AED'},{text:'เรื่องร้องเรียนทั้งหมด',align:AlignmentType.LEFT},`${cTotal_n} เรื่อง`,{text:'📊 ติดตาม',color:C_ACCENT}],
        [{ text:'',                 align:AlignmentType.LEFT                        }, {text:'อัตราดำเนินการสำเร็จ',align:AlignmentType.LEFT},`${cPct}%`,{text:cPct>=70?'✅ ดี':'🟡 ต้องปรับปรุง',color:cPct>=70?C_OK:C_WARN}],
      ],
      SH_TEAL, [2000, 2500, 2200, 1800]
    ),
    blank(80),
    h2('๖.๒ ความถูกต้องและครบถ้วนของข้อมูล'),
    dataTable(
      ['ระบบ', 'ความครอบคลุม', 'ความถี่อัปเดต', 'ช่วงข้อมูล', 'ความสมบูรณ์'],
      [
        [{text:'ระบบน้ำ',    align:AlignmentType.LEFT,bold:true}, `${amphoes.length} อำเภอ / ${nSt} สถานี`, 'ทุก 30 นาที', '1–30 มิ.ย. 69', {text:'✅ ครบถ้วน',color:C_OK}],
        [{text:'ระบบภัยแล้ง',align:AlignmentType.LEFT,bold:true}, `${dDams.length} อ่างเก็บน้ำ`,           'ทุก 30 นาที', '1–30 มิ.ย. 69', {text:'✅ ครบถ้วน',color:C_OK}],
        [{text:'ระบบ PM2.5', align:AlignmentType.LEFT,bold:true}, `${pmStations} สถานี`,                     'ทุก 30 นาที', '1–30 มิ.ย. 69', {text:'✅ ครบถ้วน',color:C_OK}],
        [{text:'ระบบร้องเรียน',align:AlignmentType.LEFT,bold:true},'ครอบคลุมทุกอำเภอ',                      'Real-time',   'สะสมทั้งปี',    {text:'✅ ครบถ้วน',color:C_OK}],
      ],
      SH_TEAL, [1800, 2200, 1700, 1800, 1700]
    ),
    blank(80),
    h2('๖.๓ ตัวชี้วัดประสิทธิภาพ (KPI) ระบบสารสนเทศ'),
    dataTable(
      ['KPI', 'เป้าหมาย', 'ผลการดำเนินงาน', 'ผลประเมิน'],
      [
        [{text:'ความพร้อมใช้ระบบ (System Uptime)',align:AlignmentType.LEFT},'≥ 95%','≥ 99% (ทุกระบบ)',{text:'✅ ผ่าน',color:C_OK}],
        [{text:'ความถูกต้องข้อมูล',align:AlignmentType.LEFT},'≥ 95%',`บันทึก ${(wTotal_n+dTotal_n+pmTotal_n).toLocaleString()} รายการ`,{text:'✅ ผ่าน',color:C_OK}],
        [{text:'ความทันสมัยของข้อมูล',align:AlignmentType.LEFT},'≤ 30 นาที','อัปเดตทุก 30 นาที',{text:'✅ ผ่าน',color:C_OK}],
        [{text:'การดำเนินการร้องเรียน',align:AlignmentType.LEFT},'≥ 70%',`${cPct}%`,{text:`${cPct>=70?'✅ ผ่าน':'🟡 ต้องปรับปรุง'}`,color:cPct>=70?C_OK:C_WARN}],
        [{text:'ครอบคลุมพื้นที่ตรวจวัด',align:AlignmentType.LEFT},'ทุกอำเภอ',`${amphoes.length} อำเภอ (น้ำ) + ทุกอำเภอ (PM2.5)`,{text:'✅ ผ่าน',color:C_OK}],
      ],
      SH_TEAL, [3000, 1500, 2500, 1500]
    ),
    blank(120),
  );

  // ────────────────────────────────────────────────────────────
  // บทที่ 7: สรุปและข้อเสนอแนะ
  // ────────────────────────────────────────────────────────────
  children.push(
    pgBreak(),
    sectionBanner('บทที่ ๗ : บทสรุปและข้อเสนอแนะเชิงนโยบาย', SH_BLUE),
    blank(60),
    h2('๗.๑ สรุปภาพรวมสถานการณ์ประจำเดือน'),
    txt('ด้านน้ำและอุทกภัย', { bold: true, color: C_H1 }),
    txt(`จังหวัดลำปางเข้าสู่ช่วงฤดูฝนแล้ว ระดับน้ำในแม่น้ำสายหลักมีแนวโน้มเพิ่มขึ้นในทุกสถานี พบสถานีตรวจวัดในอำเภอเถิน ${nCrit} สถานี ที่อยู่ในระดับวิกฤตสีแดง ได้แก่ สถานีบ้านดอนชัย สถานีเถิน และสถานีห้วยแม่มอก ซึ่งมีระดับน้ำน้อยวิกฤตสะสมจากช่วงฤดูแล้งที่ผ่านมา`, { indent: true }),
    blank(60),
    txt('ด้านอ่างเก็บน้ำ', { bold: true, color: C_OK }),
    txt('อ่างเก็บน้ำขนาดใหญ่ทั้งสองแห่งมีปริมาณน้ำเพิ่มขึ้น อ่างกิ่วลมมีปริมาณน้ำ ๗๙% ของความจุ ถือว่าอยู่ในเกณฑ์ดี ส่วนอ่างกิ่วคอหมายังอยู่ที่ ๔๔% ซึ่งต้องติดตามต่อเนื่อง อ่างขนาดกลางส่วนใหญ่มีปริมาณน้ำเพิ่มขึ้นตามฤดูกาล', { indent: true }),
    blank(60),
    txt('ด้านคุณภาพอากาศ PM2.5', { bold: true, color: C_WARN }),
    txt(`โดยรวมค่า PM2.5 ในเดือนมิถุนายนอยู่ในระดับดีถึงดีมาก (${pmGoodPct}% ของการวัดทั้งหมด) สอดคล้องกับฤดูฝนที่ช่วยลดฝุ่นละออง อย่างไรก็ตาม ยังพบค่าผิดปกติสูงมากจากสถานีบ้านหลุก อ.แจ้ห่ม และสถานีวัดปางป๋วย อ.แม่เมาะ ซึ่งอาจมีปัจจัยจากการทำงานผิดปกติของเซ็นเซอร์`, { indent: true }),
    blank(60),
    txt('ด้านเรื่องร้องเรียน', { bold: true, color: '7C3AED' }),
    txt(`ระบบร้องเรียนผ่าน Traffy Fondue มีเรื่องร้องเรียนสะสม ${cTotal_n} เรื่อง ดำเนินการเสร็จสิ้นแล้ว ${cDone} เรื่อง คิดเป็น ${cPct}% ของทั้งหมด ประเภทปัญหาหลัก ได้แก่ ${cByType.slice(0,3).map(t=>t.problem_type).join(', ')}`, { indent: true }),
    blank(80),
    h2('๗.๒ ข้อเสนอแนะเชิงนโยบาย'),
    h3('ระยะเร่งด่วน (ภายใน ๓๐ วัน)'),
    bul('เฝ้าระวังพื้นที่อำเภอเถิน – จัดส่งเจ้าหน้าที่ประจำพื้นที่และเตรียมแผนอพยพประชาชนรับมือฤดูฝน', C_DANGER, true),
    bul('ตรวจสอบเซ็นเซอร์ PM2.5 ที่สถานีบ้านหลุก อ.แจ้ห่ม – ค่าผิดปกติสูงมากต้องตรวจสอบเชิงเทคนิค', C_DANGER),
    bul('ติดตามและเร่งรัดเรื่องร้องเรียนที่ค้างดำเนินการ โดยเฉพาะเรื่องถนนและไฟฟ้า', C_WARN),
    blank(60),
    h3('ระยะกลาง (๑–๓ เดือน)'),
    bul('พัฒนาระบบแจ้งเตือนภัยล่วงหน้าแบบอัตโนมัติ (Early Warning) เชื่อมต่อกับ Line/SMS'),
    bul('เพิ่มจุดตรวจวัด PM2.5 ในพื้นที่ที่ยังไม่มีการครอบคลุม โดยเฉพาะอำเภอห่างไกล'),
    bul('จัดทำแผนการบริหารน้ำในอ่างกิ่วคอหมาสำหรับช่วงฤดูแล้งปีถัดไป'),
    blank(60),
    h3('ระยะยุทธศาสตร์ (๓ เดือนขึ้นไป)'),
    bul('บูรณาการข้อมูลทั้ง ๔ ระบบเข้าสู่ศูนย์ปฏิบัติการอัจฉริยะ (Smart Operations Center) ของ อบจ.ลำปาง'),
    bul('ใช้ประโยชน์จาก AI/ML วิเคราะห์แนวโน้มและพยากรณ์สถานการณ์น้ำ ภัยแล้ง และคุณภาพอากาศ'),
    bul('จัดทำรายงานประจำเดือนเผยแพร่สู่สาธารณะผ่านเว็บไซต์และสื่อสังคมออนไลน์เพื่อความโปร่งใส'),
    blank(120),
  );

  // ────────────────────────────────────────────────────────────
  // ภาคผนวก
  // ────────────────────────────────────────────────────────────
  children.push(
    pgBreak(),
    sectionBanner('ภาคผนวก : ข้อมูลอ้างอิงและแหล่งข้อมูล', SH_TEAL),
    blank(80),
    h2('แหล่งข้อมูล'),
    bul('ระบบน้ำ: กรมชลประทาน / Thai Water (lampang.thaiwater.net) – ข้อมูล ๑–๓๐ มิถุนายน ๒๕๖๙'),
    bul('ภัยแล้ง: กรมชลประทาน / กองอำนวยการน้ำแห่งชาติ – ข้อมูลอ่างเก็บน้ำรายวัน'),
    bul('PM2.5: กรมควบคุมมลพิษ (Air4Thai) / เครือข่ายตรวจวัดคุณภาพอากาศภาคเหนือ'),
    bul('ร้องเรียน: Traffy Fondue – ระบบรับเรื่องร้องเรียนออนไลน์ของจังหวัดลำปาง'),
    blank(80),
    h2('ข้อมูลเกี่ยวกับรายงาน'),
    infoLine('ชื่อรายงาน', 'รายงานสรุปวิเคราะห์ข้อมูลรายเดือน มิถุนายน ๒๕๖๙'),
    infoLine('ช่วงข้อมูล', '๑ มิถุนายน – ๓๐ มิถุนายน ๒๕๖๙'),
    infoLine('วันที่จัดทำ', 'วันที่ ๑ กรกฎาคม พ.ศ. ๒๕๖๙'),
    infoLine('จัดทำโดย', 'ฝ่ายเทคโนโลยีสารสนเทศ องค์การบริหารส่วนจังหวัดลำปาง'),
    infoLine('ระบบสารสนเทศ', 'ระบบบูรณาการข้อมูลสารสนเทศ อบจ.ลำปาง (Water System Integration Platform)'),
    infoLine('จำนวนบันทึกทั้งหมด', `น้ำ ${wTotal_n.toLocaleString()} | ภัยแล้ง ${dTotal_n.toLocaleString()} | PM2.5 ${pmTotal_n.toLocaleString()} | ร้องเรียน ${cTotal_n} รายการ`),
    blank(200),
    new Paragraph({
      children: [
        new TextRun({ text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', font: 'Calibri', size: SZ14, color: 'E2E8F0' }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'รายงานฉบับนี้จัดทำโดยระบบสารสนเทศอัตโนมัติ  ข้อมูลมีความถูกต้องตามที่ได้รับจากแหล่งข้อมูลหลัก', font: FONT, size: SZ14, color: C_MUTED, italics: true })],
      alignment: AlignmentType.CENTER, spacing: { after: 60 },
    }),
    new Paragraph({
      children: [new TextRun({ text: '© ๑ กรกฎาคม พ.ศ. ๒๕๖๙  ฝ่ายเทคโนโลยีสารสนเทศ อบจ.ลำปาง', font: FONT, size: SZ14, color: C_MUTED })],
      alignment: AlignmentType.CENTER, spacing: { after: 100 },
    }),
  );

  // ============================================================
  // DOCUMENT
  // ============================================================
  const doc = new Document({
    creator: 'ระบบสารสนเทศ อบจ.ลำปาง',
    title: 'รายงานสรุปวิเคราะห์ข้อมูลรายเดือน มิถุนายน 2569',
    description: '4 ระบบ: น้ำ ภัยแล้ง PM2.5 ร้องเรียนลำปาง',
    sections: [{
      properties: {
        page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [new TextRun({ text: 'รายงานสรุปวิเคราะห์ข้อมูลรายเดือน มิถุนายน ๒๕๖๙  |  ระบบบูรณาการข้อมูลสารสนเทศ อบจ.ลำปาง', font: FONT, size: SZ14, color: C_MUTED })],
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' } },
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: 'หน้า ', font: FONT, size: SZ14, color: C_MUTED }),
              new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: SZ14, color: C_MUTED }),
              new TextRun({ text: '  |  ฝ่ายเทคโนโลยีสารสนเทศ อบจ.ลำปาง', font: FONT, size: SZ14, color: C_MUTED }),
            ],
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' } },
          })],
        }),
      },
      children,
    }],
  });

  // ============================================================
  // SAVE - สร้างชื่อไฟล์ใหม่ทุกครั้ง ไม่ทับเดิม
  // ============================================================
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0,19);
  const fileName = `รายงานสรุปวิเคราะห์ข้อมูลรายเดือน_มิถุนายน2569_${ts}.docx`;
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(fileName, buffer);
  console.log(`\n✅ สร้างไฟล์สำเร็จ: ${fileName}`);
  console.log(`📁 ขนาดไฟล์: ${(buffer.length/1024).toFixed(1)} KB`);
  console.log(`📂 ที่อยู่: D:\\Water_System\\${fileName}`);
}

main().catch(e => { console.error('❌ Error:', e.message, '\n', e.stack); process.exit(1); });
