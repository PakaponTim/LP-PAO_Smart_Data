/**
 * create_committee_pdf.mjs
 * สร้างเอกสาร PDF รวม:
 *   Part 1 — เอกสารสรุปสำหรับกรรมการ (committee document)
 *   Part 2 — Slides การนำเสนอ (14 slides จาก PowerPoint)
 * ใช้ Puppeteer แปลง HTML → PDF ไม่ต้องพึ่ง LibreOffice
 */

import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// HTML — ทั้งเอกสารกรรมการ + Slides presentation
// ============================================================
const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>สรุปโครงการระบบบูรณาการข้อมูลสารสนเทศ อบจ.ลำปาง</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sarabun:ital,wght@0,300;0,400;0,600;0,700;1,400&display=swap" rel="stylesheet">
<style>
/* ────────────────────────────────────────────────────────────
   GLOBAL
──────────────────────────────────────────────────────────── */
*, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }

body {
  font-family: 'Sarabun', sans-serif;
  font-size: 15pt;
  line-height: 1.75;
  color: #1e293b;
  background: #fff;
}

@page {
  size: A4;
  margin: 0;
}

.page-break { page-break-after: always; break-after: page; }

/* ────────────────────────────────────────────────────────────
   PART 1 — COMMITTEE DOCUMENT
──────────────────────────────────────────────────────────── */
.doc-page {
  width: 210mm;
  min-height: 297mm;
  padding: 22mm 20mm 28mm 20mm;
  position: relative;
}

/* running header */
.doc-header {
  position: absolute;
  top: 10mm;
  right: 20mm;
  font-size: 8pt;
  color: #94a3b8;
  font-style: italic;
}

/* running footer */
.doc-footer {
  position: absolute;
  bottom: 10mm;
  left: 0; right: 0;
  text-align: center;
  font-size: 8pt;
  color: #94a3b8;
}

/* ── Cover ── */
.cover {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 240mm;
  text-align: center;
  padding: 10mm 0;
}
.cover-org      { font-size: 20pt; font-weight:700; color:#064e3b; margin-bottom:4px; }
.cover-org-en   { font-size:11pt; color:#059669; font-style:italic; margin-bottom:20px; }
.cover-divider  { width:90%; height:3px; background:linear-gradient(90deg,transparent,#059669,transparent); margin:14px auto; }
.cover-type     { font-size:22pt; font-weight:700; color:#064e3b; margin-bottom:8px; }
.cover-title    { font-size:20pt; font-weight:700; color:#1e3a5f; margin-bottom:6px; }
.cover-sub      { font-size:17pt; color:#059669; margin-bottom:20px; }
.cover-meta     { font-size:13pt; color:#475569; line-height:2; }
.cover-meta strong { color:#334155; }
.cover-author   { margin-top:20px; border-top:2px solid #e2e8f0; border-bottom:2px solid #e2e8f0;
                  padding:14px 30px; text-align:center; }
.cover-author .name { font-size:15pt; font-weight:700; color:#334155; }
.cover-author .pos  { font-size:13pt; color:#475569; line-height:1.8; }

/* ── Headings ── */
.doc-page h1 {
  font-size:18pt; font-weight:700; color:#064e3b;
  border-bottom:2px solid #059669; padding-bottom:5px;
  margin:24px 0 12px; page-break-after:avoid;
}
.doc-page h2 {
  font-size:15pt; font-weight:700; color:#1e3a5f;
  margin:18px 0 8px; page-break-after:avoid;
}
.doc-page h3 {
  font-size:13pt; font-weight:700; color:#334155;
  margin:12px 0 6px; page-break-after:avoid;
}
.doc-page p  { margin:5px 0; text-align:justify; }
.doc-page p.indent { text-indent:2em; }

.doc-page ul { list-style:none; margin:5px 0 8px 1.5em; }
.doc-page ul li::before { content:"•  "; color:#059669; font-weight:700; }
.doc-page ul li { margin:3px 0; }

.doc-page ol { margin:5px 0 8px 2.2em; }
.doc-page ol li { margin:4px 0; }

/* ── Signature ── */
.sig-pair { display:flex; justify-content:space-around; margin-top:40px; }
.sig-block { width:45%; text-align:center; }
.sig-block .line  { font-size:14pt; margin-bottom:4px; }
.sig-block .name  { font-size:14pt; font-weight:700; }
.sig-block .detail{ font-size:13pt; color:#475569; line-height:1.8; }

/* ────────────────────────────────────────────────────────────
   PART 2 — PRESENTATION SLIDES
   Each slide = A4 landscape (297 × 210mm)
──────────────────────────────────────────────────────────── */
@page slide-page { size: A4 landscape; margin: 0; }

.slide {
  width: 297mm;
  height: 210mm;
  position: relative;
  overflow: hidden;
  page: slide-page;
  display: flex;
  flex-direction: column;
}

/* accent strip left */
.slide .strip {
  position: absolute;
  left: 0; top: 0;
  width: 5px;
  height: 100%;
}

/* ── slide layouts ── */
.slide.dark  { background:#0f172a; color:#e2e8f0; }
.slide.light { background:#ffffff; color:#1e293b; }
.slide.emerald-dark { background:#064e3b; color:#ffffff; }

/* inner content wrapper */
.s-inner {
  padding: 12mm 14mm 10mm 16mm;
  flex:1;
  display:flex;
  flex-direction:column;
}
.slide .strip + .s-inner { padding-left:17mm; }

/* slide badge */
.s-badge {
  display:inline-block;
  padding: 2px 10px;
  border-radius:6px;
  font-size:10pt;
  font-weight:700;
  margin-bottom:6px;
  width:fit-content;
}

/* slide title */
.s-title  { font-size:22pt; font-weight:700; margin-bottom:3px; line-height:1.25; }
.s-sub    { font-size:11pt; margin-bottom:8px; }
.s-divider{ height:2px; border-radius:1px; margin:6px 0 10px; }

/* info bar */
.s-infobar {
  border-radius:8px;
  padding: 5px 10px;
  font-size:10pt;
  font-weight:700;
  margin-bottom:10px;
}

/* two-column helpers */
.s-cols   { display:flex; gap:10mm; flex:1; }
.s-col    { flex:1; display:flex; flex-direction:column; }

/* card */
.s-card {
  border-radius:8px;
  padding:7px 10px;
  margin-bottom:5px;
  font-size:10.5pt;
  line-height:1.5;
}

/* numbered step card */
.s-step {
  display:flex;
  align-items:flex-start;
  gap:8px;
  border-radius:8px;
  padding:6px 10px;
  margin-bottom:4px;
  font-size:10pt;
}
.s-step .num {
  background:#1d4ed8;
  color:#fff;
  border-radius:50%;
  width:22px; height:22px;
  display:flex; align-items:center; justify-content:center;
  font-size:10pt; font-weight:700;
  flex-shrink:0;
}

/* icon box */
.s-iconbox {
  border-radius:8px;
  padding:8px 6px;
  text-align:center;
  font-size:10pt;
  line-height:1.4;
}
.s-iconbox .icon { font-size:20pt; margin-bottom:4px; }

/* row of icon boxes */
.s-iconrow { display:flex; gap:5px; }
.s-iconrow .s-iconbox { flex:1; }

/* tech cat block */
.s-tech {
  border-radius:8px;
  overflow:hidden;
  margin-bottom:6px;
}
.s-tech .cat-hd {
  font-size:11pt; font-weight:700; color:#fff;
  padding: 4px 10px;
}
.s-tech .cat-body { padding:6px 10px; font-size:10.5pt; line-height:1.8; }

/* time badge grid */
.s-timegrid { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px; }
.s-timebadge {
  background:#ecfdf5; border:1.5px solid #059669; color:#064e3b;
  border-radius:6px; font-size:10pt; font-weight:700;
  padding:2px 10px;
}

/* agenda grid */
.s-agenda-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px; flex:1; }
.s-agenda-item {
  border-radius:8px; border-left:4px solid;
  padding:7px 10px; background:#f8fafc;
  font-size:10.5pt;
}
.s-agenda-item .num-badge {
  display:inline-block;
  color:#fff; border-radius:4px;
  font-size:9pt; font-weight:700; padding:1px 7px; margin-bottom:3px;
}
.s-agenda-item .ititle { font-weight:700; font-size:11pt; color:#1e293b; }
.s-agenda-item .isub   { font-size:9.5pt; color:#64748b; }

/* stat box */
.s-stat {
  border-radius:8px; text-align:center; padding:8px 6px;
}
.s-stat .st-icon { font-size:18pt; }
.s-stat .st-val  { font-size:14pt; font-weight:700; color:#1e293b; }
.s-stat .st-lbl  { font-size:9pt; color:#64748b; }

/* AI box */
.s-ai-item {
  border-radius:6px; padding:5px 10px;
  margin-bottom:3px; font-size:11pt;
}

/* cover slide decorative circles */
.deco-circle {
  position:absolute;
  border-radius:50%;
  pointer-events:none;
}

/* chip */
.s-chip {
  display:inline-flex; align-items:center;
  border-radius:20px;
  padding:4px 14px;
  font-size:11pt; font-weight:700; color:#fff;
  margin-right:6px;
}

/* criteria bar */
.s-criteria {
  border-radius:8px; border-left:4px solid;
  padding:5px 10px; margin-bottom:4px;
  font-size:11pt; font-weight:700;
}

/* control panel card */
.s-cp-card {
  border-radius:8px; padding:8px 10px;
  display:flex; align-items:flex-start; gap:8px;
  margin-bottom:5px;
}
.s-cp-icon { font-size:16pt; flex-shrink:0; width:28px; text-align:center; }
.s-cp-body .t { font-size:11pt; font-weight:700; }
.s-cp-body .d { font-size:9.5pt; color:#64748b; }

/* footer bar on slide */
.s-footer-bar {
  position:absolute; bottom:0; left:0; right:0;
  background:#064e3b; color:#a7f3d0;
  font-size:9pt; padding:4px 14mm;
  display:flex; justify-content:space-between;
}

/* thank-you slide center */
.slide-thankyou-inner {
  display:flex; flex-direction:column; align-items:center;
  justify-content:center; height:100%;
  text-align:center; padding:12mm;
}

/* pm25 row */
.s-pm-row {
  display:flex; align-items:center; gap:8px;
  border-radius:8px; border-left:4px solid;
  padding:5px 10px; margin-bottom:4px;
}
.s-pm-dot { width:14px; height:14px; border-radius:50%; flex-shrink:0; }
.s-pm-range { font-size:10pt; font-weight:700; }
.s-pm-label { font-size:10pt; color:#475569; }
</style>
</head>
<body>

<!-- ═══════════════════════════════════════════════════════════ -->
<!--  PART 1 — COMMITTEE DOCUMENT                              -->
<!-- ═══════════════════════════════════════════════════════════ -->

<!-- PAGE: Cover -->
<div class="doc-page page-break">
  <div class="doc-footer">องค์การบริหารส่วนจังหวัดลำปาง  |  มิถุนายน ๒๕๖๙  |  หน้า 1</div>
  <div class="cover">
    <div class="cover-org">องค์การบริหารส่วนจังหวัดลำปาง</div>
    <div class="cover-org-en">Lampang Provincial Administrative Organization</div>
    <div class="cover-divider"></div>
    <div class="cover-type">เอกสารสรุปโครงการ</div>
    <div class="cover-title">ระบบบูรณาการข้อมูลสารสนเทศ</div>
    <div class="cover-sub">เพื่อการเฝ้าระวังภัยพิบัติและสิ่งแวดล้อม</div>
    <div class="cover-divider"></div>
    <div class="cover-meta">
      <strong>สำหรับ:</strong> คณะกรรมการตรวจรับงานจ้าง / หัวหน้าฝ่าย<br>
      <strong>อ้างถึง:</strong> ใบสั่งจ้างเลขที่ ๓๕๐/๒๕๖๙ วันที่ ๙ เมษายน ๒๕๖๙<br>
      <strong>ประจำเดือน:</strong> พฤษภาคม ๒๕๖๙<br>
      <strong>วันที่จัดทำ:</strong> ๔ มิถุนายน ๒๕๖๙
    </div>
    <div class="cover-author">
      <div class="name">นายภัคพล บุตติ</div>
      <div class="pos">ตำแหน่ง นักวิเคราะห์ข้อมูล<br>ฝ่ายกองยุทธศาสตร์และงบประมาณ</div>
    </div>
  </div>
</div>

<!-- PAGE: บทนำ -->
<div class="doc-page page-break">
  <div class="doc-header">เอกสารสรุปโครงการ — ระบบบูรณาการข้อมูลสารสนเทศ อบจ.ลำปาง</div>
  <div class="doc-footer">องค์การบริหารส่วนจังหวัดลำปาง  |  มิถุนายน ๒๕๖๙</div>
  <h1>1. บทนำและวัตถุประสงค์</h1>
  <p class="indent">เอกสารฉบับนี้เป็นสรุปผลการดำเนินงานโครงการ "ระบบบูรณาการข้อมูลสารสนเทศเพื่อการเฝ้าระวังภัยพิบัติและสิ่งแวดล้อม" (Water System Integrated Data Platform) ขององค์การบริหารส่วนจังหวัดลำปาง ประจำเดือนพฤษภาคม ๒๕๖๙ จัดทำขึ้นเพื่อรายงานต่อคณะกรรมการตรวจรับงานจ้างและหัวหน้าฝ่าย</p>

  <h2>1.1 ปัญหาก่อนมีระบบ</h2>
  <ul>
    <li>ข้อมูลภัยพิบัติกระจายอยู่หลายแหล่ง ไม่มีศูนย์กลาง ต้องเปิดหน้าเว็บดูข้อมูลเองทุกวัน</li>
    <li>ไม่สามารถดูแนวโน้มย้อนหลังหรือคาดการณ์สถานการณ์ล่วงหน้าได้</li>
    <li>ผู้บริหารขาดข้อมูลที่ครบถ้วนในการตัดสินใจเชิงรุก</li>
    <li>ไม่มีระบบแจ้งเตือนอัตโนมัติเมื่อสถานการณ์เข้าสู่ภาวะวิกฤต</li>
    <li>ข้อมูลน้ำสูญเสียในระบบ (Non-Revenue Water: NRW) ไม่ได้ถูกติดตามอย่างเป็นระบบ</li>
  </ul>

  <h2>1.2 วัตถุประสงค์ของโครงการ</h2>
  <ol>
    <li>เก็บข้อมูลอัตโนมัติทุก 30 นาที จาก 4 แหล่งข้อมูลหลัก ครอบคลุม 26 สถานีวัดน้ำ 36 อ่างเก็บน้ำ PM 2.5 ทุกอำเภอ และเรื่องร้องเรียน Traffy Fondue</li>
    <li>รวบรวมข้อมูลภัยพิบัติ 4 ด้าน ไว้ในฐานข้อมูลกลาง MySQL เดียวกัน</li>
    <li>วิเคราะห์และแสดงผลข้อมูลผ่านแดชบอร์ดแบบ Real-time ที่เข้าใจง่าย</li>
    <li>ใช้ระบบ AI (ปัญญาประดิษฐ์) วิเคราะห์สถานการณ์และให้ข้อเสนอแนะเชิงรุกแก่ผู้บริหาร</li>
    <li>แจ้งเตือนอัตโนมัติเมื่อสถานการณ์เข้าสู่ระดับวิกฤต</li>
    <li>วิเคราะห์น้ำสูญเสียในระบบ (NRW) พร้อมรายงานเปรียบเทียบรายไตรมาส</li>
  </ol>

  <h1>2. ภาพรวมของระบบ</h1>
  <p class="indent">ระบบประกอบด้วย 4 โมดูลหลัก ทำงานร่วมกันผ่านสถาปัตยกรรมแบบรวมศูนย์ โดยมีเซิร์ฟเวอร์ Node.js/Express เป็นศูนย์กลาง:</p>

  <h2>2.1 โมดูลที่ 1: ระบบเฝ้าระวังระดับน้ำ 🌊</h2>
  <ul>
    <li>แหล่งข้อมูล: lampang.thaiwater.net/wl — สถานีวัดน้ำ 26 สถานี ครอบคลุมทั้งจังหวัดลำปาง</li>
    <li>การทำงาน: ตรวจสอบอินเทอร์เน็ต → เปิดหน้าเว็บอัตโนมัติ → ดึงข้อมูลทุกสถานี → คำนวณความเสี่ยง → บันทึก MySQL + Excel</li>
    <li>แสดงผล: กราฟระดับน้ำรายสถานี, พยากรณ์ AI 3 วัน, สัดส่วนสถานะ, เปรียบเทียบกับระดับตลิ่ง</li>
  </ul>

  <h2>2.2 โมดูลที่ 2: ระบบติดตามภัยแล้งและอ่างเก็บน้ำ 🏜️</h2>
  <ul>
    <li>แหล่งข้อมูล: lampang.thaiwater.net/dam — ติดตามอ่างเก็บน้ำ 36 แห่ง (ใหญ่ กลาง เล็ก)</li>
    <li>วิเคราะห์: ปริมาณน้ำสำรอง, เปอร์เซ็นต์ความจุ, น้ำไหลเข้า vs ระบาย, ปริมาณฝนสะสม 3/7 วัน</li>
    <li>เกณฑ์วิกฤต: ≤10% = วิกฤต, 10–30% = เฝ้าระวัง, 30–70% = ปกติ, 70–100% = น้ำมาก, &gt;100% = ล้น</li>
  </ul>

  <h2>2.3 โมดูลที่ 3: ระบบติดตามคุณภาพอากาศ PM 2.5 🍃</h2>
  <ul>
    <li>แหล่งข้อมูล: Air4Thai / กรมอนามัย — ครอบคลุมทุกอำเภอในจังหวัดลำปาง</li>
    <li>มาตรฐาน 5 ระดับ: ดีมาก (0–15), ดี (15.1–25), ปานกลาง (25.1–37.5), เริ่มมีผล (37.6–75), มีผลกระทบ (&gt;75.1 µg/m³)</li>
    <li>แสดงผล: กราฟค่าฝุ่นรายอำเภอ, ประวัติย้อนหลัง, พยากรณ์แนวโน้ม, AI แนะนำมาตรการ</li>
  </ul>

  <h2>2.4 โมดูลที่ 4: ระบบรวบรวมเรื่องร้องเรียน 📢</h2>
  <ul>
    <li>แหล่งข้อมูล: Traffy Fondue (citydata.traffy.in.th) — พัฒนาโดย สวทช./NECTEC</li>
    <li>ดึงข้อมูลเฉพาะจังหวัดลำปาง: ติดตามสถานะ รอ/กำลังดำเนินการ/เสร็จสิ้น</li>
    <li>วิเคราะห์: อัตราแก้ไขสำเร็จ, ประเภทปัญหาพบบ่อย, พื้นที่ร้องเรียนมากสุด, พิกัด GPS</li>
  </ul>
</div>

<!-- PAGE: สถาปัตยกรรม + แดชบอร์ด -->
<div class="doc-page page-break">
  <div class="doc-header">เอกสารสรุปโครงการ — ระบบบูรณาการข้อมูลสารสนเทศ อบจ.ลำปาง</div>
  <div class="doc-footer">องค์การบริหารส่วนจังหวัดลำปาง  |  มิถุนายน ๒๕๖๙</div>

  <h1>3. สถาปัตยกรรมเทคโนโลยี</h1>
  <p class="indent">ระบบใช้สถาปัตยกรรมแบบ 3 ชั้น (3-Layer Architecture):</p>

  <h3>ชั้นที่ 1: แหล่งข้อมูลภายนอก (Data Sources)</h3>
  <ul>
    <li>lampang.thaiwater.net — ข้อมูลระดับน้ำ + อ่างเก็บน้ำ</li>
    <li>Air4Thai / กรมอนามัย — ข้อมูลค่า PM 2.5</li>
    <li>Traffy Fondue — เรื่องร้องเรียนจากประชาชน</li>
  </ul>

  <h3>ชั้นที่ 2: การเก็บรวบรวมข้อมูล (Collection Layer)</h3>
  <ul>
    <li>Chrome Extension (Manifest V3) — ดึงข้อมูลผ่านเบราว์เซอร์ (วิธีหลัก)</li>
    <li>Puppeteer Headless Browser — ระบบสำรอง (Fallback) กรณี Extension ไม่ตอบสนองใน 60 วินาที</li>
    <li>Scheduler — ตั้งเวลาดึงข้อมูลอัตโนมัติทุก 30 นาที ระหว่าง 09:00–16:00 น.</li>
    <li>Retry + Lock — ป้องกันการทำงานซ้ำซ้อน ลองใหม่สูงสุด 3 ครั้ง</li>
  </ul>

  <h3>ชั้นที่ 3: จัดเก็บและแสดงผล</h3>
  <ul>
    <li>MySQL Database (water_systems) — 4 ตาราง: น้ำ, ภัยแล้ง, PM 2.5, ร้องเรียน</li>
    <li>Excel Backup — ไฟล์สำรองข้อมูลอัตโนมัติ</li>
    <li>Fallback 3 ระดับ: Extension → Puppeteer → Excel เพื่อป้องกันข้อมูลสูญหาย</li>
    <li>Node.js + Express API Server (พอร์ต 3000) + Socket.io Real-time + Backend UI</li>
  </ul>

  <h3>เทคโนโลยีที่ใช้ (ทั้งหมดเป็น Open Source ไม่มีค่าลิขสิทธิ์)</h3>
  <ul>
    <li>Backend: Node.js, Express.js, Socket.io, MySQL (mysql2)</li>
    <li>Data Collection: Puppeteer, Chrome Extension V3, ExcelJS, DNS Preflight Check</li>
    <li>Frontend: HTML5/CSS3/JavaScript, TailwindCSS, Chart.js, DateRangePicker</li>
  </ul>

  <h1>4. แดชบอร์ดวิเคราะห์และระบบ AI</h1>

  <h2>4.1 ฟีเจอร์หลักของแดชบอร์ด</h2>
  <ol>
    <li>4 โมดูลในหน้าเดียว — สลับดูข้อมูลน้ำ ภัยแล้ง PM 2.5 ร้องเรียน ได้ทันที</li>
    <li>ตัวกรองวันที่ (Date Filter) — เลือกช่วงเวลาที่ต้องการวิเคราะห์ได้อย่างยืดหยุ่น</li>
    <li>โหมดกลางคืน (Dark Mode) — ปรับการแสดงผลให้สบายตา</li>
    <li>KPI Cards — ตัวเลขสำคัญแสดงชัดเจนด้านบน คลิกดูรายละเอียดเพิ่มเติมได้</li>
    <li>4 มุมมองต่อโมดูล — กราฟแท่ง เส้น วงกลม และตารางเปรียบเทียบ</li>
    <li>อัปเดตอัตโนมัติ Real-time — ข้อมูลใหม่แสดงผลทันทีผ่าน WebSocket</li>
    <li>ส่งออกรายงาน Excel อัตโนมัติ — สร้างรายงานพร้อมกราฟและข้อมูลสรุป</li>
  </ol>

  <h2>4.2 ระบบ AI Insights</h2>
  <p class="indent">ระบบ AI (ปัญญาประดิษฐ์) ทำหน้าที่วิเคราะห์ข้อมูลจากทุกโมดูลอัตโนมัติ:</p>
  <ul>
    <li>วิเคราะห์ข้อมูลล่าสุดจากทุก 4 โมดูลอัตโนมัติ พร้อมแจ้งเตือนจุดเสี่ยงในทันที</li>
    <li>สรุปสถานการณ์รวมเป็นภาษาไทยเข้าใจง่าย และเสนอแนวทางรับมือเชิงรุก</li>
    <li>คาดการณ์แนวโน้มล่วงหน้า 3 วัน ระบุสถานี/อ่างที่ต้องเฝ้าระวังพิเศษ</li>
    <li>แนะนำมาตรการป้องกันสุขภาพประชาชน</li>
  </ul>

  <h2>4.3 ระบบควบคุม (Control Panel)</h2>
  <ul>
    <li>เปิด/ปิดระบบอัตโนมัติ — Toggle ได้ทันที ไม่ต้องรีสตาร์ท</li>
    <li>สั่งดึงข้อมูลทันที (Force Fetch) — ดึงทั้ง Excel + Database โดยไม่ต้องรอ</li>
    <li>Live System Logs — ดูบันทึกการทำงานแบบ Real-time</li>
    <li>ประวัติการทำงาน — ดูรายการ 50 งานล่าสุด พร้อมสถานะ</li>
    <li>กำหนดเวลาเอง — เพิ่ม ลบ จัดลำดับเวลาทำงานได้ตามต้องการ</li>
  </ul>
</div>

<!-- PAGE: ผลปฏิบัติงาน พ.ค. -->
<div class="doc-page page-break">
  <div class="doc-header">เอกสารสรุปโครงการ — ระบบบูรณาการข้อมูลสารสนเทศ อบจ.ลำปาง</div>
  <div class="doc-footer">องค์การบริหารส่วนจังหวัดลำปาง  |  มิถุนายน ๒๕๖๙</div>

  <h1>5. ผลการปฏิบัติงานประจำเดือนพฤษภาคม ๒๕๖๙</h1>
  <p class="indent">ตามใบสั่งจ้างเลขที่ ๓๕๐/๒๕๖๙ วันที่ ๙ เมษายน ๒๕๖๙ ผู้ปฏิบัติงาน นายภัคพล บุตติ ตำแหน่งนักวิเคราะห์ข้อมูล สังกัดฝ่ายกองยุทธศาสตร์และงบประมาณ ได้ปฏิบัติงานดังนี้:</p>

  <h2>5.1 งานที่ปฏิบัติในเดือนพฤษภาคม ๒๕๖๙</h2>
  <h3>งานที่ 1: รวบรวมและตรวจสอบข้อมูล</h3>
  <p class="indent">รวบรวมและตรวจสอบความถูกต้องของข้อมูลปริมาณการใช้น้ำ ข้อมูลคุณภาพน้ำ และข้อมูลการซ่อมบำรุงระบบท่อส่งน้ำในพื้นที่ที่รับผิดชอบ พร้อมนำเข้าระบบฐานข้อมูล MySQL</p>

  <h3>งานที่ 2: จัดทำรายงานวิเคราะห์สรุปผล</h3>
  <p class="indent">จัดทำรายงานวิเคราะห์สรุปผลการดำเนินงานประจำเดือนเมษายน ๒๕๖๙ เปรียบเทียบกับเป้าหมายที่กำหนด วิเคราะห์แนวโน้มน้ำสูญเสียในระบบ (NRW) และจัดทำรายงานนำเสนอต่อผู้บริหาร</p>

  <h3>งานที่ 3: พัฒนาระบบ Backend UI และรายงานอัตโนมัติ</h3>
  <p class="indent">พัฒนาและปรับปรุงระบบรายงานออนไลน์ (Backend UI) และระบบสร้างรายงานอัตโนมัติให้มีประสิทธิภาพมากขึ้น</p>

  <h3>งานที่ 4: ปรับปรุง Dashboard และรายงานงบประมาณ</h3>
  <p class="indent">ปรับปรุง Dashboard แสดงผลข้อมูลระบบน้ำประปาให้ทันสมัยและใช้งานง่าย จัดทำรายงานเปรียบเทียบการใช้งบประมาณโครงการระบบน้ำประปาในไตรมาสที่ 2</p>

  <h3>งานที่ 5: ประชุมและวางแผนงาน</h3>
  <p class="indent">เข้าร่วมประชุมกับฝ่ายยุทธศาสตร์และผู้บริหาร เพื่อนำเสนอข้อมูลสนับสนุนการวางแผนโครงการและรับนโยบายการดำเนินงาน ตลอดจนจัดทำแผนการดำเนินงานและกำหนดเป้าหมายสำหรับเดือนมิถุนายน ๒๕๖๙</p>

  <h2>5.2 งานต้นเดือนมิถุนายน ๒๕๖๙ (๔ มิ.ย.)</h2>
  <ol>
    <li>รวบรวมและจัดทำรายงานสรุปผลการปฏิบัติงานประจำเดือนพฤษภาคม ๒๕๖๙</li>
    <li>ตรวจสอบความครบถ้วนถูกต้องของข้อมูลในระบบฐานข้อมูล</li>
    <li>วิเคราะห์ข้อมูลปริมาณการใช้น้ำในช่วงต้นเดือนมิถุนายน เปรียบเทียบกับแผนที่วางไว้</li>
    <li>ปรับปรุงระบบแสดงผลข้อมูลบน Dashboard ให้มีความสมบูรณ์ยิ่งขึ้น</li>
    <li>นำส่งรายงานประจำเดือนพร้อมเอกสารที่เกี่ยวข้องต่อผู้บังคับบัญชาตามกำหนดเวลา</li>
  </ol>

  <h1>6. สรุปผลลัพธ์และแผนพัฒนาต่อ</h1>

  <h2>6.1 สิ่งที่โครงการสำเร็จแล้ว</h2>
  <ul>
    <li>ระบบดึงข้อมูลอัตโนมัติ 4 ประเภท พร้อมใช้งาน</li>
    <li>ฐานข้อมูล MySQL รองรับการบันทึกข้อมูลระยะยาว</li>
    <li>แดชบอร์ดวิเคราะห์พร้อมกราฟ 4 รูปแบบต่อโมดูล</li>
    <li>ระบบ AI วิเคราะห์สถานการณ์และให้คำแนะนำเชิงรุก</li>
    <li>Fallback 3 ระดับ ป้องกันข้อมูลสูญหาย (Extension → Puppeteer → Excel)</li>
    <li>Control Panel จัดการระบบได้โดยไม่ต้องเขียนโค้ด</li>
    <li>ส่งออกรายงาน Excel ได้อัตโนมัติ + Backend UI สำหรับจัดการระบบรายงาน</li>
    <li>รายงานเปรียบเทียบงบประมาณรายไตรมาส</li>
  </ul>

  <h2>6.2 แผนพัฒนาต่อในอนาคต</h2>
  <ol>
    <li>ระบบแจ้งเตือน LINE/Email เมื่อสถานการณ์วิกฤต</li>
    <li>แผนที่แสดงตำแหน่งสถานีเฝ้าระวังแบบ GIS</li>
    <li>เพิ่มโมดูลหมอกควันไฟป่า (อยู่ระหว่างการพัฒนา)</li>
    <li>แอปพลิเคชันมือถือสำหรับผู้บริหาร</li>
    <li>AI พยากรณ์ล่วงหน้า 7 วัน ด้วย Machine Learning</li>
    <li>เชื่อมต่อ API กรมทรัพยากรน้ำและกรมชลประทาน</li>
    <li>วิเคราะห์ NRW เชิงลึก + คาดการณ์ภัยแล้ง + ระบบ PM 2.5 Alert</li>
  </ol>

  <h2>6.3 ผลกระทบต่อประชาชน</h2>
  <p class="indent">ระบบนี้ช่วยให้ อบจ.ลำปาง สามารถรับรู้สถานการณ์ภัยพิบัติและปัญหาของประชาชนได้รวดเร็วขึ้น ตัดสินใจได้แม่นยำขึ้น และสามารถป้องกัน/ช่วยเหลือประชาชนได้ทันท่วงทีกว่าเดิม ข้อมูลที่เป็นระบบช่วยลดเวลาในการรวบรวมข้อมูลจากหลายชั่วโมงเหลือเพียงไม่กี่วินาที</p>

  <!-- ── Signature ── -->
  <div style="margin-top:30px; border-top:1px solid #e2e8f0; padding-top:20px;">
    <div class="sig-pair">
      <div class="sig-block">
        <div class="line">ลงชื่อ ................................................ ผู้จัดทำ</div>
        <div class="name">(นายภัคพล บุตติ)</div>
        <div class="detail">ตำแหน่ง นักวิเคราะห์ข้อมูล<br>ฝ่ายกองยุทธศาสตร์และงบประมาณ<br>วันที่ ๔ มิถุนายน ๒๕๖๙</div>
      </div>
      <div class="sig-block">
        <div class="line">ลงชื่อ ................................................ หัวหน้าฝ่าย/ผู้รับรอง</div>
        <div class="name">(                                              )</div>
        <div class="detail">หัวหน้าฝ่ายกองยุทธศาสตร์และงบประมาณ<br>วันที่ ........./........./.........</div>
      </div>
    </div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ -->
<!--  DIVIDER — ภาคผนวก: สไลด์นำเสนอ                          -->
<!-- ═══════════════════════════════════════════════════════════ -->
<div class="doc-page page-break" style="display:flex;align-items:center;justify-content:center;background:#064e3b;">
  <div style="text-align:center;color:#fff;">
    <div style="font-size:48pt;margin-bottom:10px;">📊</div>
    <div style="font-size:26pt;font-weight:700;margin-bottom:8px;">ภาคผนวก</div>
    <div style="font-size:20pt;color:#a7f3d0;margin-bottom:6px;">สไลด์นำเสนอโครงการ</div>
    <div style="font-size:13pt;color:#6ee7b7;">ระบบบูรณาการข้อมูลสารสนเทศเพื่อการเฝ้าระวังภัยพิบัติและสิ่งแวดล้อม<br>Version 2.0  |  มิถุนายน ๒๕๖๙</div>
    <div style="width:200px;height:3px;background:linear-gradient(90deg,transparent,#059669,transparent);margin:20px auto;"></div>
    <div style="font-size:11pt;color:#6ee7b7;">14 สไลด์</div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ -->
<!--  PART 2 — PRESENTATION SLIDES (landscape)                 -->
<!-- ═══════════════════════════════════════════════════════════ -->

<!-- ─── SLIDE 1: ปก ─────────────────────────────────────────── -->
<div class="slide emerald-dark page-break">
  <div class="deco-circle" style="width:220px;height:220px;background:rgba(16,185,129,.18);top:-70px;left:-70px;"></div>
  <div class="deco-circle" style="width:180px;height:180px;background:rgba(6,95,70,.5);bottom:-60px;right:-40px;"></div>
  <div class="deco-circle" style="width:140px;height:140px;background:rgba(5,150,105,.35);top:-30px;right:50px;"></div>
  <div class="s-inner" style="justify-content:center;">
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">
      <div style="background:rgba(255,255,255,.15);border-radius:10px;padding:8px 12px;font-size:28pt;">🌊</div>
      <div>
        <div style="font-size:14pt;font-weight:700;color:#a7f3d0;">องค์การบริหารส่วนจังหวัดลำปาง</div>
        <div style="font-size:11pt;color:#6ee7b7;font-style:italic;">Lampang Provincial Administrative Organization</div>
      </div>
    </div>
    <div style="font-size:30pt;font-weight:700;color:#fff;line-height:1.2;margin-bottom:8px;">ระบบบูรณาการข้อมูลสารสนเทศ</div>
    <div style="font-size:20pt;color:#6ee7b7;margin-bottom:22px;">เพื่อการเฝ้าระวังภัยพิบัติและสิ่งแวดล้อม</div>
    <div style="display:flex;gap:8px;margin-bottom:24px;">
      <span class="s-chip" style="background:rgba(29,78,216,.7);">🌊 ระดับน้ำ</span>
      <span class="s-chip" style="background:rgba(180,83,9,.7);">🏜️ ภัยแล้ง</span>
      <span class="s-chip" style="background:rgba(4,120,87,.7);">🍃 PM 2.5</span>
      <span class="s-chip" style="background:rgba(109,40,217,.7);">📢 ร้องเรียน</span>
    </div>
    <div style="border-top:1px solid #065f46;padding-top:12px;font-size:10.5pt;color:#6ee7b7;">
      นำเสนอโดย: ฝ่ายนโยบายและแผน / กองสาธารณสุข &nbsp;|&nbsp; วันที่นำเสนอ: มิถุนายน ๒๕๖๙ &nbsp;|&nbsp; ตามใบสั่งจ้างเลขที่ ๓๕๐/๒๕๖๙
    </div>
  </div>
  <div style="position:absolute;bottom:10px;right:14mm;background:rgba(16,185,129,.4);color:#fff;font-size:9pt;font-weight:700;padding:2px 10px;border-radius:10px;">Version 2.0</div>
</div>

<!-- ─── SLIDE 2: สารบัญ ────────────────────────────────────── -->
<div class="slide light page-break">
  <div class="strip" style="background:#059669;"></div>
  <div class="s-inner">
    <div style="font-size:22pt;font-weight:700;color:#064e3b;">สารบัญการนำเสนอ</div>
    <div style="font-size:10.5pt;color:#64748b;margin-bottom:6px;">ภาพรวมสิ่งที่จะนำเสนอวันนี้ — ระบบบูรณาการข้อมูลสารสนเทศเพื่อการเฝ้าระวังภัยพิบัติและสิ่งแวดล้อม</div>
    <div style="height:2px;background:#e2e8f0;margin-bottom:10px;"></div>
    <div class="s-agenda-grid">
      ${[
        {num:'01',title:'ที่มาและวัตถุประสงค์ของโครงการ',sub:'ปัญหาที่พบ เป้าหมาย และประโยชน์ที่คาดหวัง',c:'#2563eb'},
        {num:'02',title:'สถาปัตยกรรมระบบและเทคโนโลยีที่ใช้',sub:'ภาพรวมการทำงานของระบบทั้งหมด (System Architecture)',c:'#059669'},
        {num:'03',title:'โมดูลที่ 1 — ระบบเฝ้าระวังระดับน้ำ',sub:'ดึงข้อมูลจาก lampang.thaiwater.net แบบอัตโนมัติ 26 สถานี',c:'#1d4ed8'},
        {num:'04',title:'โมดูลที่ 2 — ระบบติดตามภัยแล้งและอ่างเก็บน้ำ',sub:'วิเคราะห์ปริมาณน้ำสำรอง 36 อ่างเก็บน้ำ',c:'#b45309'},
        {num:'05',title:'โมดูลที่ 3 — ระบบติดตามคุณภาพอากาศ PM 2.5',sub:'ดัชนีฝุ่นละอองรายอำเภอ พร้อมแจ้งเตือนระดับวิกฤต',c:'#047857'},
        {num:'06',title:'โมดูลที่ 4 — ระบบรวบรวมเรื่องร้องเรียน',sub:'ดึงข้อมูลปัญหาจากประชาชนผ่าน Traffy Fondue',c:'#6d28d9'},
        {num:'07',title:'แดชบอร์ดวิเคราะห์และการวิเคราะห์ด้วย AI',sub:'ระบบแสดงผลและให้คำแนะนำเชิงรุกด้วยปัญญาประดิษฐ์',c:'#0d9488'},
        {num:'08',title:'ผลการปฏิบัติงานประจำเดือนพฤษภาคม ๒๕๖๙',sub:'สรุปผลงาน วิเคราะห์ข้อมูล และเป้าหมายเดือนถัดไป',c:'#dc2626'},
        {num:'09',title:'สรุปผลและแผนพัฒนาต่อ',sub:'ผลลัพธ์ที่ได้ สถิติจริง และทิศทางการพัฒนาในอนาคต',c:'#7c3aed'},
      ].map(a=>`
        <div class="s-agenda-item" style="border-left-color:${a.c};">
          <span class="num-badge" style="background:${a.c};">${a.num}</span>
          <div class="ititle">${a.title}</div>
          <div class="isub">${a.sub}</div>
        </div>`).join('')}
    </div>
  </div>
</div>

<!-- ─── SLIDE 3: ที่มาและวัตถุประสงค์ ───────────────────────── -->
<div class="slide light page-break">
  <div class="strip" style="background:#2563eb;"></div>
  <div class="s-inner">
    <div class="s-badge" style="background:#dbeafe;color:#2563eb;">ส่วนที่ 01</div>
    <div class="s-title" style="color:#1e3a5f;">ที่มาและวัตถุประสงค์</div>
    <div style="height:2px;background:#e2e8f0;margin-bottom:10px;"></div>
    <div class="s-cols">
      <div class="s-col">
        <div style="font-size:12pt;font-weight:700;color:#dc2626;margin-bottom:6px;">🔍 ปัญหาที่พบก่อนมีระบบ</div>
        ${['ต้องเปิดหน้าเว็บดูข้อมูลเองทุกวัน ไม่มีระบบเก็บข้อมูลอัตโนมัติ',
           'ข้อมูลกระจายอยู่หลายแหล่ง ไม่มีศูนย์กลาง ยากต่อการวิเคราะห์',
           'ไม่สามารถดูแนวโน้มย้อนหลังหรือคาดการณ์ล่วงหน้าได้',
           'ผู้บริหารขาดข้อมูลที่ครบถ้วนในการตัดสินใจเชิงรุก',
           'ไม่มีระบบแจ้งเตือนเมื่อสถานการณ์เข้าสู่ภาวะวิกฤต',
           'ข้อมูลน้ำสูญเสียในระบบ (NRW) ไม่ได้ถูกติดตามอย่างเป็นระบบ',
          ].map(p=>`<div class="s-card" style="background:#fff1f2;border:1px solid #fecdd3;">❌ ${p}</div>`).join('')}
      </div>
      <div class="s-col">
        <div style="font-size:12pt;font-weight:700;color:#059669;margin-bottom:6px;">🎯 วัตถุประสงค์ของโครงการ</div>
        ${[['⚡','เก็บข้อมูลอัตโนมัติทุก 30 นาที จาก 4 แหล่งข้อมูลหลัก'],
           ['🗄️','รวบรวม 26 สถานีวัดน้ำ, 36 อ่างเก็บน้ำ, PM2.5 ทุกอำเภอ, Traffy'],
           ['📊','วิเคราะห์และแสดงผลผ่านแดชบอร์ดเข้าใจง่าย Real-time'],
           ['🤖','ใช้ AI วิเคราะห์และให้ข้อเสนอแนะเชิงรุกให้ผู้บริหาร'],
           ['🔔','แจ้งเตือนเมื่อสถานการณ์เข้าสู่ระดับน่าเป็นห่วง'],
           ['📈','วิเคราะห์น้ำสูญเสียในระบบ (NRW) พร้อมรายงานรายไตรมาส'],
          ].map(g=>`<div class="s-card" style="background:#f0fdf4;border:1px solid #bbf7d0;">${g[0]} ${g[1]}</div>`).join('')}
      </div>
    </div>
  </div>
</div>

<!-- ─── SLIDE 4: สถาปัตยกรรมระบบ ────────────────────────────── -->
<div class="slide dark page-break">
  <div class="s-inner">
    <div class="s-title" style="color:#fff;">สถาปัตยกรรมระบบ (System Architecture)</div>
    <div class="s-sub" style="color:#94a3b8;">ภาพรวมการทำงานทั้งหมดของระบบ ตั้งแต่ต้นทางไปจนถึงปลายทาง — ครอบคลุม 4 โมดูลหลัก</div>
    <!-- Layer 1 -->
    <div style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:8px 10px;margin-bottom:6px;">
      <div style="font-size:11pt;font-weight:700;color:#60a5fa;margin-bottom:5px;">🌐 แหล่งข้อมูลภายนอก (Data Sources)</div>
      <div style="display:flex;gap:5px;">
        ${[['lampang.thaiwater.net (ระดับน้ำ 26 สถานี)','#1d4ed8'],
           ['lampang.thaiwater.net (อ่างเก็บน้ำ 36 แห่ง)','#b45309'],
           ['Air4Thai / กรมอนามัย (PM 2.5 ทุกอำเภอ)','#047857'],
           ['Traffy Fondue (ร้องเรียนจากประชาชน)','#6d28d9'],
          ].map(s=>`<div style="flex:1;background:${s[1]}44;border:1.5px solid ${s[1]};border-radius:6px;padding:5px 8px;font-size:9.5pt;font-weight:700;color:#fff;text-align:center;">${s[0]}</div>`).join('')}
      </div>
    </div>
    <div style="text-align:center;color:#475569;font-size:16pt;">▼</div>
    <!-- Layer 2 -->
    <div style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:8px 10px;margin-bottom:6px;">
      <div style="font-size:11pt;font-weight:700;color:#fbbf24;margin-bottom:5px;">⚙️ ชั้นการเก็บรวบรวมข้อมูล (Data Collection Layer)</div>
      <div style="display:flex;gap:5px;">
        ${[['🔌 Chrome Extension (Manifest V3) — วิธีหลัก','#1e40af'],
           ['🤖 Puppeteer Headless Browser — ระบบสำรอง','#166534'],
           ['⏰ Scheduler — ดึงข้อมูลทุก 30 นาที 09:00–16:00','#92400e'],
           ['🔄 Retry + Lock — ป้องกันทำงานซ้ำ (สูงสุด 3 ครั้ง)','#4c1d95'],
          ].map(c=>`<div style="flex:1;background:${c[1]}88;border:1px solid ${c[1]};border-radius:6px;padding:5px 8px;font-size:9pt;font-weight:700;color:#fff;text-align:center;">${c[0]}</div>`).join('')}
      </div>
    </div>
    <div style="text-align:center;color:#475569;font-size:16pt;">▼</div>
    <!-- Layer 3 -->
    <div style="display:flex;gap:6px;">
      <div style="flex:1;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:8px 10px;">
        <div style="font-size:11pt;font-weight:700;color:#34d399;margin-bottom:4px;">🗄️ ชั้นจัดเก็บข้อมูล</div>
        <div style="font-size:10pt;color:#94a3b8;line-height:1.7;">MySQL (water_systems DB) + Excel Backup<br>4 ตาราง: น้ำ | ภัยแล้ง | PM2.5 | ร้องเรียน<br>Fallback 3 ระดับ: Extension → Puppeteer → Excel</div>
      </div>
      <div style="flex:1;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:8px 10px;">
        <div style="font-size:11pt;font-weight:700;color:#f9a8d4;margin-bottom:4px;">🖥️ Server (Node.js + Express + Socket.io)</div>
        <div style="font-size:10pt;color:#94a3b8;line-height:1.7;">API Server พอร์ต 3000 | Real-time via WebSocket<br>จัดการ Schedule และ Log ทุกกิจกรรม<br>Backend UI สำหรับจัดการและรายงานอัตโนมัติ</div>
      </div>
    </div>
    <div style="margin-top:6px;font-size:9pt;color:#475569;font-style:italic;">* MySQL = ฐานข้อมูลเชิงสัมพันธ์ | Socket.io = ระบบสื่อสาร Real-time | Puppeteer = ควบคุมเบราว์เซอร์อัตโนมัติ | Manifest V3 = มาตรฐาน Chrome Extension รุ่นล่าสุด</div>
  </div>
</div>

<!-- ─── SLIDE 5: โมดูล 1 ระดับน้ำ ────────────────────────────── -->
<div class="slide light page-break">
  <div class="strip" style="background:#1d4ed8;"></div>
  <div class="s-inner">
    <div class="s-badge" style="background:#dbeafe;color:#1d4ed8;">โมดูลที่ 01</div>
    <div class="s-title" style="color:#1e3a5f;">🌊 ระบบเฝ้าระวังระดับน้ำและปริมาณน้ำฝน</div>
    <div class="s-infobar" style="background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af;">
      📡 แหล่งข้อมูล: lampang.thaiwater.net/wl &nbsp;|&nbsp; สถานีตรวจวัด: 26 สถานี ครอบคลุมทั้งจังหวัดลำปาง &nbsp;|&nbsp; อัปเดตอัตโนมัติ: ทุก 30 นาที (09:00–16:00 น.)
    </div>
    <div style="font-size:11.5pt;font-weight:700;color:#1e3a5f;margin-bottom:5px;">กระบวนการทำงาน (How It Works)</div>
    <div style="display:flex;gap:4px;margin-bottom:10px;">
      ${[['1','ตรวจสอบอินเทอร์เน็ต','ทดสอบ DNS ก่อนเริ่มทุกครั้ง'],
         ['2','เปิดหน้าเว็บอัตโนมัติ','Chrome Extension / Puppeteer เปิดหน้า WL ลำปาง'],
         ['3','ดึงข้อมูลทุกสถานี','วนดึงครบ 26 Station รวมถึงฝนสะสม 3/7 วัน'],
         ['4','คำนวณความเสี่ยง','วิเคราะห์ระดับน้ำเทียบตลิ่ง ประเมินสถานะ'],
         ['5','บันทึกและแสดงผล','บันทึกลง MySQL + Excel อัปเดตแดชบอร์ดทันที'],
        ].map((s,i,arr)=>`
          <div style="flex:1;background:#f0f9ff;border:1px solid #bfdbfe;border-radius:8px;padding:7px 8px;font-size:9.5pt;position:relative;">
            <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;">
              <span style="background:#1d4ed8;color:#fff;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-size:9pt;font-weight:700;flex-shrink:0;">${s[0]}</span>
              <span style="font-weight:700;color:#1e293b;">${s[1]}</span>
            </div>
            <div style="color:#64748b;font-size:9pt;">${s[2]}</div>
          </div>${i<arr.length-1?'<div style="align-self:center;color:#bfdbfe;font-size:16pt;">›</div>':''}`).join('')}
    </div>
    <div style="font-size:11.5pt;font-weight:700;color:#1e3a5f;margin-bottom:5px;">สิ่งที่แสดงผลในแดชบอร์ด</div>
    <div class="s-iconrow">
      ${[['📊','กราฟระดับน้ำรายสถานี แสดงสีตามระดับ'],
         ['📈','พยากรณ์ล่วงหน้า 3 วัน ด้วยระบบ AI'],
         ['🥧','สัดส่วนสถานะ (น้อย/ปกติ/มาก/ล้น)'],
         ['⚖️','เปรียบระดับน้ำกับระดับตลิ่ง + ฝนสะสม'],
         ['🤖','AI วิเคราะห์แนวโน้มและให้ข้อเสนอแนะ'],
        ].map(f=>`<div class="s-iconbox" style="background:#dbeafe;border:1px solid #93c5fd;"><div class="icon">${f[0]}</div><div style="font-size:9.5pt;color:#1e3a5f;">${f[1]}</div></div>`).join('')}
    </div>
  </div>
</div>

<!-- ─── SLIDE 6: โมดูล 2 ภัยแล้ง ────────────────────────────── -->
<div class="slide light page-break">
  <div class="strip" style="background:#d97706;"></div>
  <div class="s-inner">
    <div class="s-badge" style="background:#fef3c7;color:#d97706;">โมดูลที่ 02</div>
    <div class="s-title" style="color:#78350f;">🏜️ ระบบติดตามภัยแล้งและอ่างเก็บน้ำ</div>
    <div class="s-infobar" style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;">
      📡 แหล่งข้อมูล: lampang.thaiwater.net/dam &nbsp;|&nbsp; ติดตามอ่างเก็บน้ำ: 36 แห่ง (ใหญ่ กลาง เล็ก) &nbsp;|&nbsp; วิเคราะห์: ปริมาณน้ำสำรอง เปอร์เซ็นต์ความจุ น้ำไหลเข้า-ออก
    </div>
    <div class="s-cols">
      <div class="s-col">
        <div style="font-size:11pt;font-weight:700;color:#78350f;margin-bottom:5px;">ข้อมูลที่ระบบติดตาม</div>
        ${[['🏔️','จำนวนอ่างเก็บน้ำหลัก 36 แห่ง (ใหญ่ กลาง เล็ก)','#fef3c7'],
           ['💧','ปริมาณน้ำรวม (ล้าน ลบ.ม.) — ติดตามรายวัน','#dbeafe'],
           ['📈','% น้ำกักเก็บเฉลี่ย — เปรียบเทียบความจุสูงสุด','#ffedd5'],
           ['⬇️','น้ำไหลเข้า vs ระบาย — วิเคราะห์สมดุลน้ำ','#ede9fe'],
           ['📊','แนวโน้มปริมาณน้ำ — คาดการณ์ภัยแล้งล่วงหน้า','#fef3c7'],
           ['🌧️','ปริมาณน้ำฝนสะสม 3/7 วัน — ประเมินการเติมน้ำ','#dbeafe'],
          ].map(m=>`<div class="s-card" style="background:${m[2]};border:1px solid #fde68a;font-size:10.5pt;">${m[0]} ${m[1]}</div>`).join('')}
      </div>
      <div class="s-col">
        <div style="font-size:11pt;font-weight:700;color:#78350f;margin-bottom:5px;">เกณฑ์ประเมินระดับวิกฤต (มาตรฐาน ThaiWater)</div>
        ${[['≤ 10%','น้ำน้อยวิกฤต (ภัยแล้งรุนแรง)','#b45309','#fff7ed'],
           ['> 10–30%','น้ำน้อย (ต้องเฝ้าระวัง)','#ca8a04','#fefce8'],
           ['> 30–70%','น้ำปกติ (สถานการณ์ดี)','#15803d','#f0fdf4'],
           ['> 70–100%','น้ำมาก (ระวังน้ำเอ่อ)','#1d4ed8','#eff6ff'],
           ['> 100%','น้ำล้นตลิ่ง (วิกฤต!)','#dc2626','#fff1f2'],
          ].map(c=>`<div class="s-criteria" style="border-left-color:${c[2]};background:${c[3]};color:${c[2]};">● <strong>${c[0]}</strong> — ${c[1]}</div>`).join('')}
        <div style="margin-top:8px;font-size:11pt;font-weight:700;color:#78350f;margin-bottom:4px;">สิ่งที่แสดงผลในแดชบอร์ด</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">
          ${['กราฟน้ำเทียบความจุ','แนวโน้ม + พยากรณ์ AI','สัดส่วนความเสี่ยงภัยแล้ง','น้ำไหลเข้า vs ระบาย']
            .map(f=>`<span style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:6px;padding:3px 10px;font-size:10pt;">📊 ${f}</span>`).join('')}
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ─── SLIDE 7: โมดูล 3 PM2.5 ───────────────────────────────── -->
<div class="slide light page-break">
  <div class="strip" style="background:#0d9488;"></div>
  <div class="s-inner">
    <div class="s-badge" style="background:#ccfbf1;color:#0d9488;">โมดูลที่ 03</div>
    <div class="s-title" style="color:#134e4a;">🍃 ระบบติดตามคุณภาพอากาศ PM 2.5</div>
    <div class="s-infobar" style="background:#f0fdfa;border:1px solid #99f6e4;color:#0f766e;">
      📡 แหล่งข้อมูล: Air4Thai / กรมอนามัย &nbsp;|&nbsp; ครอบคลุม: ทุกอำเภอในจังหวัดลำปาง &nbsp;|&nbsp; วัด: ค่าฝุ่น PM 2.5 หน่วย µg/m³
    </div>
    <div class="s-cols">
      <div class="s-col">
        <div style="font-size:11pt;font-weight:700;color:#134e4a;margin-bottom:5px;">มาตรฐานคุณภาพอากาศของประเทศไทย (5 ระดับ)</div>
        ${[['0–15.0','ดีมาก','#60a5fa','#eff6ff','ออกกำลังกายกลางแจ้งได้ปกติ'],
           ['15.1–25.0','ดี','#10b981','#f0fdf4','ดำเนินชีวิตได้ปกติ'],
           ['25.1–37.5','ปานกลาง','#fbbf24','#fefce8','กลุ่มเสี่ยงควรระวัง'],
           ['37.6–75.0','เริ่มมีผลต่อสุขภาพ','#f97316','#fff7ed','หลีกเลี่ยงกิจกรรมกลางแจ้ง สวม N95'],
           ['>75.1','มีผลกระทบต่อสุขภาพ','#dc2626','#fff1f2','ห้ามออกจากอาคาร / แจ้งเตือนด่วน'],
          ].map(p=>`
            <div class="s-pm-row" style="border-left-color:${p[2]};background:${p[3]};">
              <div class="s-pm-dot" style="background:${p[2]};"></div>
              <div>
                <div class="s-pm-range" style="color:${p[2]};">${p[0]} µg/m³ — <strong>${p[1]}</strong></div>
                <div class="s-pm-label">${p[4]}</div>
              </div>
            </div>`).join('')}
      </div>
      <div class="s-col">
        <div style="font-size:11pt;font-weight:700;color:#134e4a;margin-bottom:5px;">สิ่งที่แสดงผลในแดชบอร์ด</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;flex:1;">
          ${[['📊','กราฟค่าฝุ่นรายอำเภอ พร้อมสีระดับอันตราย'],
             ['📈','ประวัติค่าฝุ่นย้อนหลัง พยากรณ์แนวโน้ม 3 วัน'],
             ['🥧','สัดส่วนระดับคุณภาพอากาศของจังหวัด'],
             ['⚖️','เปรียบค่าฝุ่นปัจจุบันกับค่าเฉลี่ย 24 ชม.'],
             ['🤖','AI วิเคราะห์แนวโน้ม ให้มาตรการควบคุมเชิงรุก'],
            ].map(f=>`<div class="s-iconbox" style="background:#f0fdfa;border:1px solid #99f6e4;"><div class="icon">${f[0]}</div><div style="font-size:9.5pt;color:#134e4a;">${f[1]}</div></div>`).join('')}
        </div>
        <div style="margin-top:8px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:6px;padding:6px 10px;font-size:9pt;color:#0f766e;font-style:italic;">
          * µg/m³ = ไมโครกรัมต่อลูกบาศก์เมตร | ค่ายิ่งสูง = อากาศยิ่งแย่ ส่งผลเสียต่อระบบทางเดินหายใจ โดยเฉพาะกลุ่มเสี่ยง (เด็ก ผู้สูงอายุ ผู้ป่วยโรคหอบหืด)
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ─── SLIDE 8: โมดูล 4 Traffy ─────────────────────────────── -->
<div class="slide light page-break">
  <div class="strip" style="background:#7c3aed;"></div>
  <div class="s-inner">
    <div class="s-badge" style="background:#ede9fe;color:#7c3aed;">โมดูลที่ 04</div>
    <div class="s-title" style="color:#3b0764;">📢 ระบบรวบรวมเรื่องร้องเรียนจากประชาชน</div>
    <div class="s-infobar" style="background:#faf5ff;border:1px solid #d8b4fe;color:#6d28d9;">
      📡 แหล่งข้อมูล: citydata.traffy.in.th (Traffy Fondue) &nbsp;|&nbsp; ดึงข้อมูลเฉพาะจังหวัดลำปาง &nbsp;|&nbsp; บันทึกฐานข้อมูลอัตโนมัติ
    </div>
    <div class="s-cols">
      <div class="s-col">
        <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;padding:10px;margin-bottom:8px;">
          <div style="font-size:11.5pt;font-weight:700;color:#7c3aed;margin-bottom:6px;">Traffy Fondue คืออะไร?</div>
          ${['แพลตฟอร์มรับแจ้งปัญหาจากประชาชนทั่วประเทศ',
             'พัฒนาโดย สวทช./NECTEC',
             'ประชาชนแจ้งผ่าน App, LINE, หรือ Web',
             'เรื่องที่แจ้ง เช่น น้ำท่วม ภัยแล้ง ถนนชำรุด ไฟฟ้า',
             'มีสถานะติดตาม: รอดำเนินการ / กำลังดำเนินการ / เสร็จสิ้น',
             'ระบบดึงเฉพาะเรื่องที่เกี่ยวกับลำปาง เข้าสู่ Database',
             'ข้อมูลพิกัด GPS แนบมาด้วย เพื่อระบุตำแหน่งปัญหา',
            ].map(t=>`<div style="font-size:10.5pt;color:#475569;margin-bottom:2px;">• ${t}</div>`).join('')}
        </div>
      </div>
      <div class="s-col">
        <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;padding:10px;margin-bottom:8px;">
          <div style="font-size:11.5pt;font-weight:700;color:#7c3aed;margin-bottom:6px;">ข้อมูลที่ระบบวิเคราะห์</div>
          ${[['📢','เรื่องร้องเรียนสะสมทั้งหมด'],['✅','จำนวนที่ดำเนินการเสร็จแล้ว'],
             ['📊','อัตราแก้ไขสำเร็จ (%)'],['🏆','ประเภทปัญหาที่พบบ่อยที่สุด'],
             ['📍','พื้นที่ที่มีการร้องเรียนมากที่สุด'],['⏱️','ระยะเวลาเฉลี่ยในการแก้ไขปัญหา'],
             ['📈','แนวโน้มเรื่องร้องเรียนรายเดือน'],
            ].map(m=>`<div style="font-size:10.5pt;color:#475569;margin-bottom:2px;">${m[0]} ${m[1]}</div>`).join('')}
        </div>
      </div>
    </div>
    <div style="font-size:11pt;font-weight:700;color:#3b0764;margin-bottom:6px;">สิ่งที่แสดงผลในแดชบอร์ด</div>
    <div class="s-iconrow">
      ${[['📊','จำนวนร้องเรียนแยกตามสถานะ (รอ/กำลัง/เสร็จ)'],
         ['📈','แนวโน้มเรื่องร้องเรียนรายเดือนเทียบค่าเฉลี่ย'],
         ['🥧','สัดส่วนประเภทปัญหาที่พบบ่อยที่สุด'],
         ['🗺️','พื้นที่ที่มีปัญหามากที่สุดพร้อมพิกัด GPS'],
         ['🤖','AI วิเคราะห์และแนวทางแก้ไขเชิงรุก'],
        ].map(f=>`<div class="s-iconbox" style="background:#faf5ff;border:1px solid #d8b4fe;"><div class="icon">${f[0]}</div><div style="font-size:9.5pt;color:#3b0764;">${f[1]}</div></div>`).join('')}
    </div>
  </div>
</div>

<!-- ─── SLIDE 9: แดชบอร์ดและ AI ─────────────────────────────── -->
<div class="slide dark page-break">
  <div class="strip" style="background:#818cf8;"></div>
  <div class="s-inner">
    <div class="s-title" style="color:#fff;">🤖 แดชบอร์ดวิเคราะห์ข้อมูลและระบบ AI</div>
    <div class="s-sub" style="color:#94a3b8;">ศูนย์กลางแสดงผลข้อมูลแบบ Real-time พร้อมการวิเคราะห์ด้วยปัญญาประดิษฐ์ — ทั้ง 4 โมดูลในหน้าเดียว</div>
    <div style="height:1px;background:#334155;margin-bottom:8px;"></div>
    <div class="s-cols">
      <div class="s-col">
        <div style="font-size:11pt;font-weight:700;color:#a5b4fc;margin-bottom:5px;">ฟีเจอร์หลักของแดชบอร์ด</div>
        ${[['🌊🏜️🍃📢','4 โมดูลในหน้าเดียว','สลับดูข้อมูลน้ำ ภัยแล้ง PM2.5 ร้องเรียน ได้ทันที'],
           ['📅','ตัวกรองวันที่ (Date Filter)','เลือกช่วงเวลาที่ต้องการวิเคราะห์ได้อย่างยืดหยุ่น'],
           ['🌙','โหมดกลางคืน (Dark Mode)','ปรับการแสดงผลให้ดูสบายตาในที่แสงน้อย'],
           ['📊','KPI Cards สำคัญ','ตัวเลขสำคัญแสดงชัดเจนด้านบน คลิกดูรายละเอียดได้'],
           ['📈','4 มุมมองต่อโมดูล','กราฟแท่ง เส้น วงกลม และตารางเปรียบเทียบ'],
           ['🔄','อัปเดตอัตโนมัติ Real-time','ข้อมูลใหม่แสดงผลทันทีผ่าน WebSocket'],
           ['📋','ส่งออกรายงาน Excel อัตโนมัติ','สร้างรายงาน Excel พร้อมกราฟและข้อมูลสรุป'],
          ].map(f=>`
            <div style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:5px 8px;margin-bottom:4px;display:flex;align-items:center;gap:8px;">
              <span style="font-size:14pt;width:24px;text-align:center;">${f[0]}</span>
              <div>
                <div style="font-size:10.5pt;font-weight:700;color:#e2e8f0;">${f[1]}</div>
                <div style="font-size:9.5pt;color:#94a3b8;">${f[2]}</div>
              </div>
            </div>`).join('')}
      </div>
      <div class="s-col">
        <div style="background:#0f172a;border:2px solid #3730a3;border-radius:10px;padding:10px;flex:1;display:flex;flex-direction:column;">
          <div style="font-size:13pt;font-weight:700;color:#a5b4fc;margin-bottom:2px;">🤖 ระบบ AI Insights</div>
          <div style="font-size:9pt;color:#6366f1;margin-bottom:6px;">(AI Water / Drought / PM2.5 / Complaints Insights)</div>
          <div style="height:1px;background:#1e1b4b;margin-bottom:6px;"></div>
          ${['🔍 วิเคราะห์ข้อมูลล่าสุดจากทุก 4 โมดูลอัตโนมัติ',
             '⚠️ แจ้งเตือนจุดเสี่ยงที่น่าเป็นห่วงในทันที',
             '📋 สรุปสถานการณ์รวมเป็นภาษาไทยเข้าใจง่าย',
             '💡 เสนอแนวทางรับมือและป้องกันเชิงรุก',
             '📅 คาดการณ์แนวโน้มล่วงหน้า 3 วัน',
             '🎯 ระบุสถานีหรืออ่างที่ต้องเฝ้าระวังพิเศษ',
             '📊 เปรียบเทียบข้อมูลกับค่าเฉลี่ยและค่ามาตรฐาน',
             '🏥 แนะนำมาตรการป้องกันสุขภาพประชาชน',
            ].map(p=>`<div class="s-ai-item" style="background:#1e1b4b;border:1px solid #3730a3;color:#c7d2fe;font-size:10.5pt;">${p}</div>`).join('')}
          <div style="background:#312e81;border:1px solid #4338ca;border-radius:6px;padding:5px 8px;margin-top:4px;font-size:9pt;color:#a5b4fc;font-style:italic;">* AI = ปัญญาประดิษฐ์ ระบบที่เรียนรู้จากข้อมูลและวิเคราะห์แทนคนได้</div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ─── SLIDE 10: Control Panel ──────────────────────────────── -->
<div class="slide light page-break">
  <div class="strip" style="background:#059669;"></div>
  <div class="s-inner">
    <div class="s-badge" style="background:#d1fae5;color:#059669;">ระบบควบคุม</div>
    <div class="s-title" style="color:#064e3b;">⚙️ ระบบจัดการและควบคุมการทำงานอัตโนมัติ</div>
    <div style="height:2px;background:#a7f3d0;margin-bottom:8px;"></div>
    <div style="font-size:11pt;font-weight:700;color:#064e3b;margin-bottom:5px;">ตารางเวลาดึงข้อมูลอัตโนมัติ (ทุก 30 นาที)</div>
    <div class="s-timegrid">
      ${['09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00']
        .map(t=>`<span class="s-timebadge">${t}</span>`).join('')}
    </div>
    <div style="background:#f0fdf4;border:1.5px solid #059669;border-radius:8px;padding:6px 10px;margin-bottom:8px;font-size:10.5pt;font-weight:700;color:#064e3b;">
      ⚡ กลไกสำรอง (Fallback): ถ้า Chrome Extension ไม่ตอบสนองใน 60 วินาที → สลับไปใช้ Puppeteer → ถ้าล้มเหลว → ใช้ Excel สำรองข้อมูล
    </div>
    <div style="font-size:11pt;font-weight:700;color:#064e3b;margin-bottom:5px;">ฟีเจอร์ของแผงควบคุม (Control Panel)</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">
      ${[['🔴🟢','เปิด/ปิดระบบอัตโนมัติ','Toggle เปิด-ปิดการดึงข้อมูลได้ทันที ไม่ต้องรีสตาร์ท'],
         ['▶️','สั่งดึงข้อมูลทันที (Force)','Force Fetch: สั่งดึงทั้ง Excel + Database โดยไม่ต้องรอ'],
         ['💻','Live System Logs','ดูบันทึกการทำงานของระบบ Real-time ทุกกิจกรรม'],
         ['📋','ประวัติการทำงาน (50 งาน)','ดูรายการงานล่าสุด พร้อมสถานะสำเร็จ/ล้มเหลว'],
         ['⏰','กำหนดเวลาเอง','เพิ่ม ลบ และจัดลำดับเวลาทำงานได้ตามต้องการ'],
         ['🔌','สถานะ Extension','แสดงว่า Chrome Extension เชื่อมต่ออยู่หรือไม่'],
        ].map(f=>`
          <div class="s-cp-card" style="background:#f0fdf4;border:1px solid #a7f3d0;">
            <div class="s-cp-icon">${f[0]}</div>
            <div class="s-cp-body"><div class="t" style="color:#064e3b;">${f[1]}</div><div class="d">${f[2]}</div></div>
          </div>`).join('')}
    </div>
  </div>
</div>

<!-- ─── SLIDE 11: Tech Stack ─────────────────────────────────── -->
<div class="slide light page-break">
  <div class="strip" style="background:#334155;"></div>
  <div class="s-inner">
    <div class="s-badge" style="background:#f1f5f9;color:#334155;">เทคโนโลยี</div>
    <div class="s-title" style="color:#1e293b;">🛠️ เทคโนโลยีที่ใช้ในโครงการ (Technology Stack)</div>
    <div style="height:2px;background:#e2e8f0;margin-bottom:10px;"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;flex:1;">
      ${[{cat:'Backend (ส่วนเซิร์ฟเวอร์)',items:['Node.js — รันโปรแกรมฝั่งเซิร์ฟเวอร์ (JavaScript Runtime)','Express.js — จัดการ API และเส้นทางการเข้าถึงข้อมูล','Socket.io — สื่อสารแบบ Real-time กับ Extension','MySQL (mysql2) — ฐานข้อมูลหลักสำหรับเก็บข้อมูลระยะยาว'],c:'#1d4ed8',bg:'#eff6ff'},
         {cat:'Data Collection (เก็บข้อมูล)',items:['Puppeteer — ควบคุมเบราว์เซอร์อัตโนมัติ (Headless)','Chrome Extension (Manifest V3) — ดึงข้อมูลผ่าน Browser','ExcelJS — สร้างและบันทึกไฟล์ Excel อัตโนมัติ','DNS Preflight Check — ตรวจสอบอินเทอร์เน็ตก่อนทำงาน'],c:'#047857',bg:'#f0fdf4'},
         {cat:'Frontend (ส่วนแสดงผล)',items:['HTML5 / CSS3 / Vanilla JS — โครงสร้างหน้าเว็บ','TailwindCSS — จัดสไตล์ UI ทันสมัย','Chart.js — กราฟแบบต่าง ๆ (แท่ง เส้น วงกลม)','DateRangePicker — ตัวกรองช่วงวันที่'],c:'#6d28d9',bg:'#faf5ff'},
         {cat:'Infrastructure (โครงสร้างพื้นฐาน)',items:['MySQL Server — เซิร์ฟเวอร์ฐานข้อมูล (localhost:3306)','Port 3000 — พอร์ตที่ Server รับการเชื่อมต่อ','Retry 3 ครั้ง + Fallback 3 ระดับ — ป้องกันข้อมูลสูญหาย','Task History JSON — บันทึกประวัติการทำงานถาวร'],c:'#b45309',bg:'#fffbeb'},
        ].map(t=>`
          <div class="s-tech">
            <div class="cat-hd" style="background:${t.c};">${t.cat}</div>
            <div class="cat-body" style="background:${t.bg};">
              ${t.items.map(i=>`<div>▸ ${i}</div>`).join('')}
            </div>
          </div>`).join('')}
    </div>
    <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:5px 10px;margin-top:5px;font-size:9.5pt;color:#64748b;font-style:italic;">* ทุกเทคโนโลยีเป็น Open Source (ฟรี) ไม่มีค่าลิขสิทธิ์เพิ่มเติม — ลดต้นทุนการพัฒนาและบำรุงรักษาระบบ</div>
  </div>
</div>

<!-- ─── SLIDE 12: ผลปฏิบัติงาน พ.ค. ────────────────────────── -->
<div class="slide light page-break">
  <div class="strip" style="background:#dc2626;"></div>
  <div class="s-inner">
    <div class="s-badge" style="background:#fee2e2;color:#dc2626;">รายงานเดือน พ.ค.</div>
    <div class="s-title" style="color:#7f1d1d;">📋 ผลการปฏิบัติงานประจำเดือนพฤษภาคม ๒๕๖๙</div>
    <div style="font-size:9.5pt;color:#64748b;margin-bottom:4px;">ตามใบสั่งจ้างเลขที่ ๓๕๐/๒๕๖๙ &nbsp;|&nbsp; ผู้ปฏิบัติงาน: นายภัคพล บุตติ — นักวิเคราะห์ข้อมูล &nbsp;|&nbsp; สังกัด: ฝ่ายกองยุทธศาสตร์และงบประมาณ</div>
    <div style="height:1px;background:#fca5a5;margin-bottom:8px;"></div>
    <div class="s-cols">
      <div class="s-col">
        <div style="font-size:11pt;font-weight:700;color:#991b1b;margin-bottom:5px;">งานที่ปฏิบัติในเดือนพฤษภาคม ๒๕๖๙</div>
        ${[{num:'1',t:'รวบรวมและตรวจสอบข้อมูล',d:'ตรวจสอบข้อมูลปริมาณการใช้น้ำ คุณภาพน้ำ และซ่อมบำรุงท่อส่งน้ำ นำเข้า MySQL',bg:'#eff6ff'},
           {num:'2',t:'จัดทำรายงานวิเคราะห์สรุปผล',d:'รายงานผลเดือน เม.ย. เปรียบเทียบเป้าหมาย วิเคราะห์ NRW นำเสนอผู้บริหาร',bg:'#f0fdf4'},
           {num:'3',t:'พัฒนาระบบ Backend UI + รายงาน',d:'ปรับปรุงระบบรายงานออนไลน์และระบบสร้างรายงานอัตโนมัติ',bg:'#faf5ff'},
           {num:'4',t:'ปรับปรุง Dashboard + งบประมาณ',d:'ปรับ Dashboard ให้ทันสมัย จัดทำรายงานเปรียบเทียบงบประมาณ Q2',bg:'#fffbeb'},
           {num:'5',t:'ประชุมและวางแผน',d:'ประชุมฝ่ายยุทธศาสตร์ นำเสนอข้อมูล จัดทำแผนเดือน มิ.ย.',bg:'#fff7ed'},
          ].map(t=>`
            <div style="background:${t.bg};border:1px solid #fca5a5;border-radius:8px;padding:6px 8px;margin-bottom:4px;display:flex;gap:7px;align-items:flex-start;">
              <span style="background:#dc2626;color:#fff;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:9pt;font-weight:700;flex-shrink:0;">${t.num}</span>
              <div>
                <div style="font-size:10.5pt;font-weight:700;color:#1e293b;">${t.t}</div>
                <div style="font-size:9.5pt;color:#64748b;">${t.d}</div>
              </div>
            </div>`).join('')}
      </div>
      <div class="s-col">
        <div style="font-size:11pt;font-weight:700;color:#991b1b;margin-bottom:5px;">📊 สถิติข้อมูลจริง</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:8px;">
          ${[['🌊','สถานีวัดน้ำ','26 สถานี','#dbeafe'],
             ['🏔️','อ่างเก็บน้ำ','36 แห่ง','#fef3c7'],
             ['🍃','PM 2.5 ครอบคลุม','ทุกอำเภอ','#ccfbf1'],
             ['📢','เรื่องร้องเรียน','อัพเดตรายวัน','#ede9fe'],
            ].map(s=>`
              <div class="s-stat" style="background:${s[3]};border:1px solid #e2e8f0;">
                <div class="st-icon">${s[0]}</div>
                <div class="st-lbl">${s[1]}</div>
                <div class="st-val">${s[2]}</div>
              </div>`).join('')}
        </div>
        <div style="font-size:11pt;font-weight:700;color:#991b1b;margin-bottom:4px;">📅 งานต้นเดือน มิ.ย. ๒๕๖๙ (๔ มิ.ย.)</div>
        ${['✅ จัดทำรายงานสรุปผล พ.ค. ๒๕๖๙',
           '✅ ตรวจสอบความครบถ้วนของฐานข้อมูล',
           '✅ วิเคราะห์ปริมาณใช้น้ำต้นเดือน มิ.ย.',
           '✅ ปรับปรุง Dashboard ให้สมบูรณ์ยิ่งขึ้น',
           '✅ นำส่งรายงานต่อผู้บังคับบัญชา',
          ].map(w=>`<div style="font-size:10.5pt;color:#475569;margin-bottom:2px;">${w}</div>`).join('')}
        <div style="background:#fef2f2;border:1.5px solid #fca5a5;border-radius:8px;padding:6px 10px;margin-top:8px;font-size:10pt;font-weight:700;color:#991b1b;">
          🎯 เป้าหมาย มิ.ย.: วิเคราะห์ NRW เชิงลึก + พัฒนา Dashboard V2 + รายงานไตรมาส 2
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ─── SLIDE 13: สรุปผลและแผนพัฒนา ─────────────────────────── -->
<div class="slide light page-break">
  <div class="strip" style="background:#059669;"></div>
  <div class="s-inner">
    <div class="s-badge" style="background:#d1fae5;color:#059669;">สรุปผล</div>
    <div class="s-title" style="color:#064e3b;">✅ สรุปผลลัพธ์และแผนพัฒนาต่อ</div>
    <div style="height:2px;background:#a7f3d0;margin-bottom:8px;"></div>
    <div class="s-cols">
      <div class="s-col">
        <div style="font-size:11pt;font-weight:700;color:#064e3b;margin-bottom:5px;">🏆 สิ่งที่โครงการสำเร็จแล้ว</div>
        ${['✅ ระบบดึงข้อมูลอัตโนมัติ 4 ประเภท พร้อมใช้งาน',
           '✅ ฐานข้อมูล MySQL รองรับการบันทึกระยะยาว',
           '✅ แดชบอร์ดวิเคราะห์พร้อมกราฟ 4 รูปแบบต่อโมดูล',
           '✅ ระบบ AI วิเคราะห์สถานการณ์และให้คำแนะนำ',
           '✅ Fallback 3 ระดับ ป้องกันข้อมูลหายเมื่อเกิดปัญหา',
           '✅ Control Panel จัดการระบบโดยไม่ต้องเขียนโค้ด',
           '✅ ส่งออกรายงาน Excel ได้อัตโนมัติ',
           '✅ Backend UI สำหรับจัดการระบบรายงาน',
           '✅ รายงานเปรียบเทียบงบประมาณรายไตรมาส',
          ].map(a=>`<div style="font-size:10.5pt;color:#475569;margin-bottom:2px;">${a}</div>`).join('')}
      </div>
      <div class="s-col">
        <div style="font-size:11pt;font-weight:700;color:#1d4ed8;margin-bottom:5px;">🚀 แผนพัฒนาต่อในอนาคต</div>
        ${[['🔔','ระบบแจ้งเตือน LINE/Email เมื่อวิกฤต'],
           ['🗺️','แผนที่แสดงตำแหน่งสถานีเฝ้าระวัง GIS'],
           ['🔥','เพิ่มโมดูลหมอกควันไฟป่า (กำลังพัฒนา)'],
           ['📱','แอปพลิเคชันมือถือสำหรับผู้บริหาร'],
           ['🤖','AI พยากรณ์ล่วงหน้า 7 วัน (Machine Learning)'],
           ['🔗','เชื่อมต่อ API กรมทรัพยากรน้ำ+กรมชลประทาน'],
           ['📊','รายงานอัตโนมัติรายสัปดาห์/เดือน ส่งผู้บริหาร'],
           ['📈','วิเคราะห์ NRW เชิงลึก + คาดการณ์ภัยแล้ง'],
           ['🏥','เชื่อมต่อข้อมูลสาธารณสุข + PM2.5 Alert'],
          ].map(p=>`
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:4px 10px;margin-bottom:4px;font-size:10.5pt;color:#1e3a5f;">
              ${p[0]} ${p[1]}
            </div>`).join('')}
      </div>
    </div>
    <div style="background:#ecfdf5;border:2px solid #059669;border-radius:8px;padding:7px 12px;margin-top:8px;font-size:11pt;font-weight:700;color:#064e3b;">
      💡 ผลกระทบต่อประชาชน: ระบบนี้ช่วยให้ อบจ.ลำปาง รับรู้สถานการณ์ภัยพิบัติและปัญหาของประชาชนได้รวดเร็วขึ้น ตัดสินใจได้แม่นยำขึ้น และสามารถป้องกัน/ช่วยเหลือประชาชนได้ทันท่วงทีกว่าเดิม
    </div>
  </div>
</div>

<!-- ─── SLIDE 14: ขอบคุณ ──────────────────────────────────────── -->
<div class="slide emerald-dark page-break">
  <div class="deco-circle" style="width:220px;height:220px;background:rgba(16,185,129,.15);top:-60px;left:-60px;"></div>
  <div class="deco-circle" style="width:200px;height:200px;background:rgba(6,95,70,.5);bottom:-60px;right:-40px;"></div>
  <div class="slide-thankyou-inner">
    <div style="font-size:36pt;font-weight:700;color:#fff;margin-bottom:6px;">ขอบคุณสำหรับการรับฟัง</div>
    <div style="font-size:18pt;color:#6ee7b7;margin-bottom:20px;">Thank You for Your Attention</div>
    <div style="width:280px;height:2px;background:#065f46;margin:0 auto 18px;"></div>
    <div style="font-size:13pt;color:#a7f3d0;font-weight:700;margin-bottom:4px;">🌊 ระบบบูรณาการข้อมูลสารสนเทศเพื่อการเฝ้าระวังภัยพิบัติและสิ่งแวดล้อม</div>
    <div style="font-size:11pt;color:#6ee7b7;margin-bottom:16px;">องค์การบริหารส่วนจังหวัดลำปาง &nbsp;|&nbsp; มิถุนายน ๒๕๖๙ &nbsp;|&nbsp; ใบสั่งจ้างเลขที่ ๓๕๐/๒๕๖๙</div>
    <div style="display:flex;gap:10px;justify-content:center;margin-bottom:20px;">
      ${['🌐 อบจ.ลำปาง','📧 lampangpao@lampang.go.th','📞 054-223851']
        .map(c=>`<span style="background:rgba(6,95,70,.6);border:1px solid rgba(16,185,129,.4);color:#a7f3d0;border-radius:20px;padding:5px 16px;font-size:11pt;font-weight:700;">${c}</span>`).join('')}
    </div>
    <div style="font-size:13pt;color:#6ee7b7;font-style:italic;">"ข้อมูลที่ดี คือจุดเริ่มต้นของการตัดสินใจที่ถูกต้อง"</div>
  </div>
</div>

</body>
</html>`;

// ============================================================
// Generate PDF with Puppeteer
// ============================================================
console.log('🚀 กำลังเริ่มสร้าง PDF รวม (เอกสารกรรมการ + Slides นำเสนอ)...');

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=th-TH'],
});

try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });

  // Wait extra for Google Fonts to load
  await new Promise(r => setTimeout(r, 2000));

  const outputPath = path.join(
    __dirname,
    'เอกสารสรุปสำหรับกรรมการ_ระบบบูรณาการข้อมูล_อบจลำปาง.pdf'
  );

  await page.pdf({
    path: outputPath,
    printBackground: true,
    // Let @page rules control sizes (A4 portrait for doc, A4 landscape for slides)
    preferCSSPageSize: true,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
    displayHeaderFooter: false,
  });

  const stats = fs.statSync(outputPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

  console.log(`\n✅ สร้าง PDF สำเร็จ!`);
  console.log(`   📄 บันทึกที่: ${outputPath}`);
  console.log(`   📦 ขนาดไฟล์: ${sizeMB} MB`);
  console.log(`   📑 เนื้อหา: เอกสารกรรมการ (A4 portrait) + Slides 14 หน้า (A4 landscape)`);
  console.log('   📂 เปิดไฟล์ด้วย PDF Reader ได้เลย');
} finally {
  await browser.close();
}
