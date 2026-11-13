/**
 * generate_report.js (V2 – ฉบับปริญญานิพนธ์)
 * สร้างเอกสารสรุปโครงการ Water_System ฉบับสมบูรณ์
 * ระดับเล่มจบปริญญาตรี ปี 4 พร้อมภาพจากระบบจริง
 * รูปแบบหนังสือราชการไทย | Font: TH SarabunPSK
 */

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, ImageRun,
  ShadingType, TableLayoutType, Header, Footer, PageNumber,
  convertInchesToTwip
} from 'docx';
import fs from 'fs';
import path from 'path';

const FONT = "TH SarabunPSK";
const SZ_COVER = 48;   // 24pt
const SZ_TITLE = 36;   // 18pt
const SZ_H1 = 34;      // 17pt
const SZ_H2 = 32;      // 16pt
const SZ_H3 = 30;      // 15pt
const SZ_BODY = 28;    // 14pt
const SZ_SMALL = 24;   // 12pt
const SZ_TINY = 20;    // 10pt

const IMG_DIR = 'd:\\Water_System\\report_images';

// ===========================================================
// Helper Functions
// ===========================================================
function txt(text, opts = {}) {
  return new TextRun({ text, font: FONT, size: opts.size || SZ_BODY, bold: opts.bold, italics: opts.italic, color: opts.color, underline: opts.underline ? {} : undefined, break: opts.break });
}

function para(children, opts = {}) {
  const p = {
    spacing: { before: opts.spaceBefore ?? 40, after: opts.spaceAfter ?? 40 },
    children: Array.isArray(children) ? children : [children],
  };
  if (opts.align) p.alignment = opts.align;
  if (opts.indent) p.indent = { left: convertInchesToTwip(opts.indent) };
  if (opts.firstLine) p.indent = { ...(p.indent || {}), firstLine: convertInchesToTwip(opts.firstLine) };
  if (opts.pageBreak) p.pageBreakBefore = true;
  return new Paragraph(p);
}

function title(text) {
  return para([txt(text, { size: SZ_TITLE, bold: true })], { align: AlignmentType.CENTER, spaceBefore: 200, spaceAfter: 100 });
}

function h1(text) {
  return para([txt(text, { size: SZ_H1, bold: true })], { spaceBefore: 300, spaceAfter: 100 });
}

function h2(text) {
  return para([txt(text, { size: SZ_H2, bold: true })], { spaceBefore: 200, spaceAfter: 80, indent: 0.3 });
}

function h3(text) {
  return para([txt(text, { size: SZ_H3, bold: true })], { spaceBefore: 150, spaceAfter: 60, indent: 0.5 });
}

function body(text, indent = 0.7) {
  return para([txt(text)], { indent, firstLine: 0.5 });
}

function bodyNoIndent(text, indent = 0.7) {
  return para([txt(text)], { indent });
}

function bullet(text, level = 0) {
  return para([txt(`• ${text}`)], { indent: 0.9 + level * 0.3, spaceBefore: 15, spaceAfter: 15 });
}

function subBullet(text) {
  return para([txt(`  ‣ ${text}`, { size: SZ_BODY })], { indent: 1.2, spaceBefore: 10, spaceAfter: 10 });
}

function numbered(num, text) {
  return para([txt(`${num}. ${text}`)], { indent: 0.9, spaceBefore: 15, spaceAfter: 15 });
}

function emptyLine() {
  return para([txt("")], { spaceBefore: 0, spaceAfter: 0 });
}

function pageBreak() {
  return new Paragraph({ children: [], pageBreakBefore: true });
}

function cell(text, opts = {}) {
  const { bold, bg, color = "000000", align = AlignmentType.LEFT, fontSize = SZ_BODY } = opts;
  return new TableCell({
    shading: bg ? { fill: bg, type: ShadingType.CLEAR } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [para([txt(text, { size: fontSize, bold, color })], { align })],
  });
}

function table(headers, rows) {
  const hCells = headers.map(h => cell(h, { bold: true, bg: "1F4E79", color: "FFFFFF", align: AlignmentType.CENTER }));
  const tRows = [new TableRow({ children: hCells, tableHeader: true })];
  rows.forEach((row, i) => {
    const bg = i % 2 === 0 ? "F2F6FC" : "FFFFFF";
    tRows.push(new TableRow({ children: row.map(c => cell(c, { bg, align: AlignmentType.CENTER })) }));
  });
  return new Table({ rows: tRows, width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.AUTOFIT });
}

function tableLeftAlign(headers, rows) {
  const hCells = headers.map(h => cell(h, { bold: true, bg: "1F4E79", color: "FFFFFF", align: AlignmentType.CENTER }));
  const tRows = [new TableRow({ children: hCells, tableHeader: true })];
  rows.forEach((row, i) => {
    const bg = i % 2 === 0 ? "F2F6FC" : "FFFFFF";
    tRows.push(new TableRow({ children: row.map((c, ci) => cell(c, { bg, align: ci === 0 ? AlignmentType.LEFT : AlignmentType.CENTER })) }));
  });
  return new Table({ rows: tRows, width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.AUTOFIT });
}

// *** IMAGE EMBED ***
function embedImage(filename, caption, widthInch = 6.2) {
  const filePath = path.join(IMG_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  ไม่พบไฟล์ภาพ: ${filePath}`);
    return [para([txt(`[ภาพ: ${caption} – ไม่พบไฟล์ ${filename}]`, { italic: true, color: "999999" })], { align: AlignmentType.CENTER })];
  }
  const imgData = fs.readFileSync(filePath);
  // Approximate aspect ratio 16:9 for dashboard screenshots
  const widthPx = widthInch * 96;
  const heightPx = widthPx * (9 / 16);
  return [
    para([new ImageRun({
      data: imgData,
      transformation: { width: Math.round(widthPx), height: Math.round(heightPx) },
      type: 'png',
    })], { align: AlignmentType.CENTER, spaceBefore: 100, spaceAfter: 40 }),
    para([txt(caption, { size: SZ_SMALL, italic: true, color: "555555" })], { align: AlignmentType.CENTER, spaceBefore: 0, spaceAfter: 100 }),
  ];
}

// ===========================================================
// MAIN DOCUMENT GENERATION
// ===========================================================
async function generateReport() {
  console.log("📝 กำลังสร้างเอกสารปริญญานิพนธ์ Water_System V2...");

  const sections = [];

  // ===========================================================
  // ส่วนที่ 1: ปกรายงาน (COVER PAGE)
  // ===========================================================
  sections.push({
    children: [
      emptyLine(), emptyLine(), emptyLine(),
      para([txt("รายงานสรุปผลการดำเนินงานโครงการ", { size: SZ_COVER, bold: true })], { align: AlignmentType.CENTER, spaceBefore: 600, spaceAfter: 200 }),
      emptyLine(),
      para([txt("ระบบบูรณาการข้อมูลเพื่อการบริหารจัดการ", { size: 44, bold: true })], { align: AlignmentType.CENTER }),
      para([txt("สถานการณ์น้ำ ภัยแล้ง คุณภาพอากาศ PM 2.5", { size: 40, bold: true })], { align: AlignmentType.CENTER }),
      para([txt("และเรื่องร้องเรียนจากประชาชน", { size: 40, bold: true })], { align: AlignmentType.CENTER }),
      emptyLine(),
      para([txt("องค์การบริหารส่วนจังหวัดลำปาง", { size: SZ_H1, bold: true, color: "1F4E79" })], { align: AlignmentType.CENTER }),
      para([txt("(Lampang Provincial Administrative Organization)", { size: SZ_BODY, italic: true, color: "666666" })], { align: AlignmentType.CENTER }),
      emptyLine(),
      para([txt("Water System Integrated Data Platform", { size: SZ_H2, italic: true, color: "555555" })], { align: AlignmentType.CENTER }),
      emptyLine(), emptyLine(),
      para([txt("ข้อมูลสถิติจริง 1 สัปดาห์", { size: SZ_H1, bold: true })], { align: AlignmentType.CENTER }),
      para([txt("ระหว่างวันที่ 25 พฤษภาคม 2569 – 31 พฤษภาคม 2569", { size: SZ_H2, bold: true, color: "C00000" })], { align: AlignmentType.CENTER }),
      emptyLine(), emptyLine(), emptyLine(), emptyLine(),
      para([txt("จัดทำโดย", { size: SZ_BODY })], { align: AlignmentType.CENTER, spaceBefore: 300 }),
      para([txt("ฝ่ายเทคโนโลยีสารสนเทศ", { size: SZ_BODY, bold: true })], { align: AlignmentType.CENTER }),
      para([txt("องค์การบริหารส่วนจังหวัดลำปาง", { size: SZ_BODY })], { align: AlignmentType.CENTER }),
      para([txt("พ.ศ. 2569", { size: SZ_BODY, bold: true })], { align: AlignmentType.CENTER }),
    ],
  });

  // ===========================================================
  // ส่วนที่ 2: กิตติกรรมประกาศ
  // ===========================================================
  sections.push({
    children: [
      title("กิตติกรรมประกาศ"),
      emptyLine(),
      body("รายงานฉบับนี้สำเร็จลุล่วงได้ด้วยดี เนื่องจากได้รับความอนุเคราะห์ ความช่วยเหลือ และคำแนะนำจากหลายฝ่าย ผู้จัดทำขอขอบคุณเป็นอย่างสูง ดังต่อไปนี้"),
      emptyLine(),
      body("ขอขอบคุณผู้บริหารองค์การบริหารส่วนจังหวัดลำปาง ที่ให้ความสำคัญกับการนำเทคโนโลยีสารสนเทศมาใช้ในการบริหารจัดการภัยพิบัติ และสนับสนุนทรัพยากรในการพัฒนาระบบ"),
      body("ขอขอบคุณสถาบันสารสนเทศทรัพยากรน้ำ (องค์การมหาชน) หรือ สสน. (HAII) ที่จัดทำระบบเฝ้าระวังสถานการณ์น้ำจังหวัดลำปาง (lampang.thaiwater.net) ซึ่งเป็นแหล่งข้อมูลหลักของโครงการ"),
      body("ขอขอบคุณสำนักงานพัฒนาวิทยาศาสตร์และเทคโนโลยีแห่งชาติ (สวทช.) / NECTEC ที่พัฒนาระบบ Traffy Fondue ซึ่งเป็นแพลตฟอร์มรับเรื่องร้องเรียนจากประชาชน ที่ใช้เป็นแหล่งข้อมูลด้านเรื่องร้องเรียนของโครงการ"),
      body("สุดท้ายนี้ ขอขอบคุณทีมงานฝ่ายเทคโนโลยีสารสนเทศทุกท่าน ที่ร่วมมือกันพัฒนาระบบจนสำเร็จลุล่วงตามวัตถุประสงค์ที่กำหนดไว้"),
      emptyLine(),
      emptyLine(),
      para([txt("ฝ่ายเทคโนโลยีสารสนเทศ", { size: SZ_BODY })], { align: AlignmentType.RIGHT }),
      para([txt("องค์การบริหารส่วนจังหวัดลำปาง", { size: SZ_BODY })], { align: AlignmentType.RIGHT }),
      para([txt("มิถุนายน 2569", { size: SZ_BODY })], { align: AlignmentType.RIGHT }),
    ],
  });

  // ===========================================================
  // ส่วนที่ 3: บทคัดย่อ
  // ===========================================================
  sections.push({
    children: [
      title("บทคัดย่อ"),
      emptyLine(),
      body("โครงการระบบบูรณาการข้อมูลเพื่อการบริหารจัดการสถานการณ์น้ำ ภัยแล้ง คุณภาพอากาศ PM 2.5 และเรื่องร้องเรียนจากประชาชน (Water System Integrated Data Platform) จัดทำขึ้นเพื่อพัฒนาระบบเก็บรวบรวมข้อมูลภัยพิบัติ 4 ด้านหลักของจังหวัดลำปาง อย่างเป็นระบบและอัตโนมัติ โดยใช้เทคโนโลยี Web Scraping ผ่าน Chrome Extension (Manifest V3) ร่วมกับ Puppeteer Headless Browser เป็น Fallback และ Node.js Express Server เป็นศูนย์กลางประมวลผล"),
      body("ระบบสามารถเก็บข้อมูลจากสถานีวัดระดับน้ำ 26 สถานี อ่างเก็บน้ำ 36 แห่ง สถานีวัดคุณภาพอากาศ PM 2.5 และเรื่องร้องเรียนจากระบบ Traffy Fondue โดยจัดเก็บลงฐานข้อมูล MySQL พร้อมมีไฟล์ Excel เป็นข้อมูลสำรอง ระบบมีกลไก Fallback 3 ระดับ (Extension → Puppeteer → Excel) เพื่อป้องกันข้อมูลสูญหาย"),
      body("ผลการดำเนินงานพบว่า ระบบสามารถเก็บข้อมูลได้อย่างต่อเนื่องและเสถียร มีแดชบอร์ดวิเคราะห์ข้อมูลแบบ Real-time รองรับกราฟ KPI ตาราง และการวิเคราะห์เชิงลึก 3 มุมมองต่อด้าน ช่วยให้ผู้บริหารสามารถติดตามและตัดสินใจได้อย่างรวดเร็วและแม่นยำ"),
      emptyLine(),
      para([txt("คำสำคัญ: ", { size: SZ_BODY, bold: true }), txt("ระบบบูรณาการข้อมูล, Web Scraping, Chrome Extension, Node.js, Dashboard, สถานการณ์น้ำ, ภัยแล้ง, PM 2.5, Traffy Fondue, องค์การบริหารส่วนจังหวัดลำปาง", { size: SZ_BODY })], { indent: 0.7 }),
      emptyLine(),
      title("Abstract"),
      emptyLine(),
      body("The Water System Integrated Data Platform was developed for the Lampang Provincial Administrative Organization (Lampang PAO) to systematically and automatically collect disaster monitoring data covering four key areas: water levels, drought/reservoir status, PM 2.5 air quality, and citizen complaints. The system employs Web Scraping technology through Chrome Extension (Manifest V3) with Puppeteer Headless Browser fallback and Node.js Express Server as the central processing hub."),
      body("The system monitors 26 water level stations, 36 reservoirs, PM 2.5 air quality stations, and citizen complaints from the Traffy Fondue platform. Data is stored in MySQL database with Excel file backup. A 3-level fallback mechanism (Extension → Puppeteer → Excel) ensures zero data loss."),
      body("Results demonstrate that the system can collect data continuously and reliably, with a real-time analytical dashboard supporting KPI graphs, tables, and in-depth 3-perspective analysis per domain, enabling executives to monitor and make decisions quickly and accurately."),
      emptyLine(),
      para([txt("Keywords: ", { size: SZ_BODY, bold: true }), txt("Integrated Data System, Web Scraping, Chrome Extension, Node.js, Dashboard, Water Monitoring, Drought, PM 2.5, Traffy Fondue, Lampang PAO", { size: SZ_BODY })], { indent: 0.7 }),
    ],
  });

  // ===========================================================
  // ส่วนที่ 4: สารบัญ
  // ===========================================================
  sections.push({
    children: [
      title("สารบัญ"),
      emptyLine(),
      bodyNoIndent("กิตติกรรมประกาศ", 0.3),
      bodyNoIndent("บทคัดย่อ / Abstract", 0.3),
      bodyNoIndent("สารบัญ", 0.3),
      bodyNoIndent("สารบัญภาพ", 0.3),
      bodyNoIndent("สารบัญตาราง", 0.3),
      emptyLine(),
      bodyNoIndent("บทที่ 1  บทนำ", 0.3),
      bodyNoIndent("    1.1  ความเป็นมาและความสำคัญของปัญหา", 0.3),
      bodyNoIndent("    1.2  วัตถุประสงค์ของโครงการ", 0.3),
      bodyNoIndent("    1.3  ขอบเขตของโครงการ", 0.3),
      bodyNoIndent("    1.4  ประโยชน์ที่คาดว่าจะได้รับ", 0.3),
      bodyNoIndent("    1.5  คำนิยามศัพท์เฉพาะ", 0.3),
      emptyLine(),
      bodyNoIndent("บทที่ 2  แนวคิด ทฤษฎี และงานวิจัยที่เกี่ยวข้อง", 0.3),
      bodyNoIndent("    2.1  แนวคิดเกี่ยวกับระบบสารสนเทศภัยพิบัติ", 0.3),
      bodyNoIndent("    2.2  เทคโนโลยี Web Scraping", 0.3),
      bodyNoIndent("    2.3  สถาปัตยกรรม Node.js และ Express.js", 0.3),
      bodyNoIndent("    2.4  Chrome Extension Manifest V3", 0.3),
      bodyNoIndent("    2.5  ฐานข้อมูล MySQL และ ExcelJS", 0.3),
      bodyNoIndent("    2.6  Dashboard Visualization ด้วย Chart.js", 0.3),
      emptyLine(),
      bodyNoIndent("บทที่ 3  วิธีการดำเนินงาน", 0.3),
      bodyNoIndent("    3.1  สถาปัตยกรรมระบบ (System Architecture)", 0.3),
      bodyNoIndent("    3.2  แหล่งข้อมูลและวิธีการเก็บรวบรวม", 0.3),
      bodyNoIndent("    3.3  ขั้นตอนการเก็บข้อมูลอัตโนมัติ", 0.3),
      bodyNoIndent("    3.4  การออกแบบฐานข้อมูล", 0.3),
      bodyNoIndent("    3.5  ระบบ Fallback และ Error Handling", 0.3),
      bodyNoIndent("    3.6  เครื่องมือและเทคโนโลยีที่ใช้", 0.3),
      emptyLine(),
      bodyNoIndent("บทที่ 4  ผลการดำเนินงาน", 0.3),
      bodyNoIndent("    4.1  หน้าจอระบบ (Screenshots)", 0.3),
      bodyNoIndent("    4.2  สถิติข้อมูลจริง 1 สัปดาห์", 0.3),
      bodyNoIndent("    4.3  มุมมองการวิเคราะห์ข้อมูล (ด้านละ 3 มุมมอง)", 0.3),
      bodyNoIndent("    4.4  ผลสรุปข้อมูลจริงในแต่ละมุมมอง", 0.3),
      emptyLine(),
      bodyNoIndent("บทที่ 5  สรุป อภิปราย และข้อเสนอแนะ", 0.3),
      bodyNoIndent("    5.1  สรุปผลการดำเนินงาน", 0.3),
      bodyNoIndent("    5.2  อภิปรายผล", 0.3),
      bodyNoIndent("    5.3  ข้อจำกัดของโครงการ", 0.3),
      bodyNoIndent("    5.4  ข้อเสนอแนะสำหรับการพัฒนาต่อยอด", 0.3),
      emptyLine(),
      bodyNoIndent("บรรณานุกรม", 0.3),
      bodyNoIndent("ภาคผนวก", 0.3),
    ],
  });

  // ===========================================================
  // สารบัญภาพ + สารบัญตาราง
  // ===========================================================
  sections.push({
    children: [
      title("สารบัญภาพ"),
      emptyLine(),
      bodyNoIndent("ภาพที่ 1  หน้าจอหลักระบบ Dashboard (Water Scraper Status)", 0.3),
      bodyNoIndent("ภาพที่ 2  หน้า Home – System Health & Storage Verification", 0.3),
      bodyNoIndent("ภาพที่ 3  แดชบอร์ดวิเคราะห์ข้อมูลระดับน้ำ (Water Analysis)", 0.3),
      bodyNoIndent("ภาพที่ 4  แดชบอร์ดวิเคราะห์ข้อมูลภัยแล้ง (Drought Analysis)", 0.3),
      bodyNoIndent("ภาพที่ 5  แดชบอร์ดวิเคราะห์ข้อมูล PM 2.5 (Air Quality Analysis)", 0.3),
      bodyNoIndent("ภาพที่ 6  แดชบอร์ดวิเคราะห์ข้อมูลเรื่องร้องเรียน (Complaints Analysis)", 0.3),
      bodyNoIndent("ภาพที่ 7  หน้าจอ Scraper – ข้อมูลภัยแล้ง/อ่างเก็บน้ำ", 0.3),
      bodyNoIndent("ภาพที่ 8  หน้าจอ Scraper – ข้อมูล PM 2.5", 0.3),
      bodyNoIndent("ภาพที่ 9  หน้าจอ Scraper – ข้อมูลเรื่องร้องเรียน (Traffy Fondue)", 0.3),
      bodyNoIndent("ภาพที่ 10  หน้าจอตั้งค่าตารางเวลาทำงานอัตโนมัติ (Schedule Settings)", 0.3),
      emptyLine(),
      title("สารบัญตาราง"),
      emptyLine(),
      bodyNoIndent("ตารางที่ 1  ขอบเขตข้อมูล 4 ด้านของโครงการ", 0.3),
      bodyNoIndent("ตารางที่ 2  เทคโนโลยีที่ใช้ในโครงการ", 0.3),
      bodyNoIndent("ตารางที่ 3  โครงสร้างตารางฐานข้อมูล MySQL", 0.3),
      bodyNoIndent("ตารางที่ 4  รายละเอียดฟิลด์ tbl_water_disaster_monitoring", 0.3),
      bodyNoIndent("ตารางที่ 5  รายละเอียดฟิลด์ tbl_drought_monitoring", 0.3),
      bodyNoIndent("ตารางที่ 6  รายละเอียดฟิลด์ tbl_pm25_monitoring", 0.3),
      bodyNoIndent("ตารางที่ 7  รายละเอียดฟิลด์ tbl_complaints_monitoring", 0.3),
      bodyNoIndent("ตารางที่ 8  ตัวอย่างข้อมูลระดับน้ำ", 0.3),
      bodyNoIndent("ตารางที่ 9  ตัวอย่างข้อมูลอ่างเก็บน้ำขนาดใหญ่", 0.3),
      bodyNoIndent("ตารางที่ 10  สรุปเปรียบเทียบกลไก Fallback", 0.3),
    ],
  });

  // ===========================================================
  // บทที่ 1: บทนำ
  // ===========================================================
  sections.push({
    children: [
      h1("บทที่ 1  บทนำ"),
      emptyLine(),

      h2("1.1  ความเป็นมาและความสำคัญของปัญหา"),
      body("จังหวัดลำปาง เป็นจังหวัดที่มีพื้นที่ลุ่มน้ำครอบคลุมทั้งลุ่มน้ำวังและลุ่มน้ำยม ซึ่งเป็นลุ่มน้ำสาขาสำคัญของประเทศไทย พื้นที่จังหวัดลำปางมีความเสี่ยงต่อภัยพิบัติหลายด้าน ทั้งอุทกภัย ภัยแล้ง ปัญหาหมอกควันและฝุ่นละออง PM 2.5 ในช่วงฤดูหนาว-ฤดูร้อน รวมถึงปัญหาเรื่องร้องเรียนจากประชาชนที่ต้องการความช่วยเหลือจากหน่วยงานท้องถิ่น"),
      body("ในปัจจุบัน ข้อมูลเหล่านี้กระจายอยู่ตามเว็บไซต์หน่วยงานต่าง ๆ ไม่มีการรวบรวมไว้ในจุดเดียว ทำให้ผู้บริหารองค์การบริหารส่วนจังหวัดลำปาง (อบจ.ลำปาง) ต้องเข้าไปตรวจสอบข้อมูลจากหลายแหล่ง ซึ่งใช้เวลามากและอาจเกิดความผิดพลาดจากการคัดลอกข้อมูลด้วยมือ"),
      body("ด้วยเหตุนี้ จึงเกิดแนวคิดในการพัฒนา \"ระบบบูรณาการข้อมูล\" (Integrated Data Platform) ที่สามารถดึงข้อมูลจากหลายแหล่งมารวมไว้ในจุดเดียว แสดงผลผ่านแดชบอร์ดที่สวยงามและใช้งานง่าย เพื่อให้ผู้บริหารสามารถตัดสินใจได้อย่างรวดเร็วและแม่นยำ"),

      emptyLine(),
      h2("1.2  วัตถุประสงค์ของโครงการ"),
      numbered(1, "เพื่อพัฒนาระบบเก็บรวบรวมข้อมูลสถานการณ์ภัยพิบัติ 4 ด้านหลัก (น้ำ ภัยแล้ง PM 2.5 เรื่องร้องเรียน) ของจังหวัดลำปาง แบบอัตโนมัติ"),
      numbered(2, "เพื่อจัดเก็บข้อมูลลงฐานข้อมูล MySQL อย่างเป็นระบบ พร้อมมีระบบ Fallback ไปยัง Excel ป้องกันข้อมูลสูญหาย"),
      numbered(3, "เพื่อสร้างแดชบอร์ดวิเคราะห์ข้อมูลเชิงลึก (Analytical Dashboard) แสดงผลแบบ Real-time ผ่านกราฟ KPI ตาราง และกราฟเปรียบเทียบ"),
      numbered(4, "เพื่อลดภาระงานเจ้าหน้าที่ในการเก็บข้อมูลด้วยมือ โดยระบบสามารถดำเนินการอัตโนมัติตามตารางเวลาที่กำหนด"),
      numbered(5, "เพื่อให้ผู้บริหาร อบจ.ลำปาง มีข้อมูลที่ทันสมัยประกอบการตัดสินใจในการบริหารจัดการภัยพิบัติ"),

      emptyLine(),
      h2("1.3  ขอบเขตของโครงการ"),
      body("โครงการนี้ครอบคลุมการเก็บรวบรวม จัดเก็บ และวิเคราะห์ข้อมูล 4 ด้านหลักของจังหวัดลำปาง ดังนี้"),
      emptyLine(),
      para([txt("ตารางที่ 1 ขอบเขตข้อมูล 4 ด้านของโครงการ", { size: SZ_BODY, bold: true })], { align: AlignmentType.CENTER }),
      table(
        ["ลำดับ", "ด้านข้อมูล", "แหล่งข้อมูล", "จำนวนจุดข้อมูล"],
        [
          ["1", "สถานการณ์น้ำ (Water Level)", "lampang.thaiwater.net/wl", "26 สถานี"],
          ["2", "ภัยแล้ง/อ่างเก็บน้ำ (Drought/Dam)", "lampang.thaiwater.net/dam", "36 อ่าง"],
          ["3", "คุณภาพอากาศ PM 2.5", "lampang.thaiwater.net/pm", "สถานีวัดทั้งจังหวัด"],
          ["4", "เรื่องร้องเรียน (Traffy Fondue)", "citydata.traffy.in.th", "เรื่องร้องเรียน จ.ลำปาง"],
        ]
      ),

      emptyLine(),
      h2("1.4  ประโยชน์ที่คาดว่าจะได้รับ"),
      numbered(1, "ผู้บริหาร อบจ.ลำปาง มีข้อมูลสถานการณ์ภัยพิบัติที่ทันสมัย ครบถ้วน และแม่นยำ ในจุดเดียว"),
      numbered(2, "ลดระยะเวลาในการรวบรวมข้อมูลจากหลายแหล่ง จากเดิมใช้เวลา 30-60 นาที เหลือเพียง 3-5 นาทีต่อรอบ"),
      numbered(3, "มีประวัติข้อมูลย้อนหลัง (Historical Data) สำหรับวิเคราะห์แนวโน้มและคาดการณ์สถานการณ์"),
      numbered(4, "ระบบมีความเสถียร มีกลไก Fallback ป้องกันข้อมูลสูญหาย"),
      numbered(5, "เป็นต้นแบบ (Prototype) สำหรับขยายผลไปยังจังหวัดอื่น ๆ ในอนาคต"),

      emptyLine(),
      h2("1.5  คำนิยามศัพท์เฉพาะ"),
      bullet("Web Scraping – กระบวนการดึงข้อมูลจากเว็บไซต์โดยอัตโนมัติ โดยอ่านโครงสร้าง HTML ของหน้าเว็บ"),
      bullet("Chrome Extension – ส่วนขยายของเว็บเบราว์เซอร์ Google Chrome ที่เพิ่มฟังก์ชันการทำงานพิเศษ"),
      bullet("Puppeteer – ไลบรารี Node.js สำหรับควบคุมเบราว์เซอร์ Chrome แบบ Headless (ไม่แสดงหน้าจอ)"),
      bullet("Socket.IO – ไลบรารีสำหรับสื่อสารแบบ Real-time ระหว่าง Client และ Server"),
      bullet("Fallback – กลไกสำรองที่ทำงานเมื่อระบบหลักล้มเหลว"),
      bullet("KPI (Key Performance Indicator) – ตัวชี้วัดสำคัญที่ใช้ประเมินผลการดำเนินงาน"),
      bullet("Dashboard – หน้าจอแสดงผลข้อมูลเชิงวิเคราะห์แบบรวมศูนย์"),
      bullet("Deduplication – กระบวนการป้องกันข้อมูลซ้ำซ้อนในฐานข้อมูล"),
      bullet("Traffy Fondue – แพลตฟอร์มรับเรื่องร้องเรียนจากประชาชน พัฒนาโดย NECTEC/สวทช."),
    ],
  });

  // ===========================================================
  // บทที่ 2: แนวคิด ทฤษฎี และงานวิจัยที่เกี่ยวข้อง
  // ===========================================================
  sections.push({
    children: [
      h1("บทที่ 2  แนวคิด ทฤษฎี และงานวิจัยที่เกี่ยวข้อง"),
      emptyLine(),

      h2("2.1  แนวคิดเกี่ยวกับระบบสารสนเทศภัยพิบัติ"),
      body("ระบบสารสนเทศภัยพิบัติ (Disaster Information System) เป็นระบบที่รวบรวม จัดเก็บ และวิเคราะห์ข้อมูลภัยพิบัติ เพื่อสนับสนุนการตัดสินใจของผู้บริหารในการเตรียมความพร้อม ป้องกัน และบรรเทาสาธารณภัย การมีระบบสารสนเทศที่ดีจะช่วยให้หน่วยงานสามารถตอบสนองต่อสถานการณ์ภัยพิบัติได้อย่างรวดเร็วและมีประสิทธิภาพ"),
      body("แนวคิดหลักของระบบสารสนเทศภัยพิบัติ ประกอบด้วย 4 องค์ประกอบสำคัญ ได้แก่ (1) การเก็บรวบรวมข้อมูล (Data Collection) (2) การจัดเก็บข้อมูล (Data Storage) (3) การวิเคราะห์ข้อมูล (Data Analysis) และ (4) การแสดงผลข้อมูล (Data Visualization)"),

      emptyLine(),
      h2("2.2  เทคโนโลยี Web Scraping"),
      body("Web Scraping เป็นเทคนิคการดึงข้อมูลจากเว็บไซต์โดยอัตโนมัติ ผ่านการอ่านโครงสร้าง HTML (DOM) ของหน้าเว็บ ซึ่งมีข้อดีคือสามารถดึงข้อมูลจากเว็บไซต์ที่ไม่มี API สาธารณะได้ เทคโนโลยี Web Scraping ที่ใช้ในโครงการนี้มี 2 แบบ ดังนี้"),
      bullet("Content Script (Chrome Extension) – ฝัง JavaScript ลงในหน้าเว็บเป้าหมาย อ่าน DOM โดยตรง มีข้อดีคือเร็วและแม่นยำ"),
      bullet("Puppeteer (Headless Browser) – ใช้ Node.js ควบคุม Chrome ที่ไม่มีหน้าจอ (Headless) เปิดเว็บ → รอโหลด → อ่าน DOM → ปิด มีข้อดีคือไม่ต้องพึ่ง Extension แต่ใช้ทรัพยากรมากกว่า"),

      emptyLine(),
      h2("2.3  สถาปัตยกรรม Node.js และ Express.js"),
      body("Node.js เป็น JavaScript Runtime ที่ทำงานบน V8 Engine ของ Google Chrome โดยใช้สถาปัตยกรรม Event-driven, Non-blocking I/O ทำให้เหมาะกับงานที่ต้องจัดการ I/O จำนวนมาก เช่น การ Scraping เว็บไซต์หลายแหล่งพร้อมกัน"),
      body("Express.js เป็น Web Framework สำหรับ Node.js ที่ใช้สร้าง RESTful API และ Web Server โดยมี Middleware Pattern ที่ยืดหยุ่น ในโครงการนี้ใช้ Express.js v5.2.1 (ES Module) ร่วมกับ Socket.IO v4.8.3 สำหรับการสื่อสาร Real-time"),

      emptyLine(),
      h2("2.4  Chrome Extension Manifest V3"),
      body("Chrome Extension Manifest V3 เป็นเวอร์ชันล่าสุดของ API สำหรับพัฒนา Chrome Extension ที่ Google แนะนำ มีจุดเด่นคือ Service Worker Background (แทน Persistent Background Page) ทำให้ประหยัดหน่วยความจำ แต่มีข้อจำกัดคือ Service Worker อาจถูก Suspend หลังจาก Idle 30 วินาที ซึ่งต้องออกแบบระบบให้รองรับ"),
      body("ในโครงการนี้ มี Chrome Extension 2 ตัว ได้แก่ 01System_Water สำหรับดึงข้อมูลจาก lampang.thaiwater.net (ระดับน้ำ ภัยแล้ง PM 2.5) และ 04ext_TraffyLP สำหรับดึงข้อมูลจาก Traffy Fondue (เรื่องร้องเรียน) ทั้ง 2 ตัวสื่อสารกับ Backend ผ่าน Socket.IO"),

      emptyLine(),
      h2("2.5  ฐานข้อมูล MySQL และ ExcelJS"),
      body("MySQL เป็นระบบจัดการฐานข้อมูลเชิงสัมพันธ์ (RDBMS) ที่ได้รับความนิยมสูง ในโครงการนี้ใช้ MySQL v5.7.24 เป็นฐานข้อมูลหลัก จัดเก็บข้อมูล 4 ตาราง โดยใช้ mysql2 driver สำหรับเชื่อมต่อจาก Node.js พร้อมระบบ Connection Pool (สูงสุด 10 connections)"),
      body("ExcelJS เป็นไลบรารี Node.js สำหรับอ่าน/เขียนไฟล์ Excel (.xlsx) ใช้เป็นระบบ Backup Storage ในกรณีที่ MySQL ไม่สามารถเชื่อมต่อได้ ทำให้มั่นใจว่าข้อมูลจะไม่สูญหายในทุกสถานการณ์"),

      emptyLine(),
      h2("2.6  Dashboard Visualization ด้วย Chart.js"),
      body("Chart.js เป็น JavaScript Library สำหรับสร้างกราฟเชิงโต้ตอบ (Interactive Charts) บนเว็บเบราว์เซอร์ รองรับกราฟหลากหลายประเภท ได้แก่ Line, Bar, Pie, Doughnut, Radar และอื่น ๆ ในโครงการนี้ใช้ Chart.js ร่วมกับ chartjs-plugin-datalabels สำหรับแสดงค่าบนกราฟ และ TailwindCSS สำหรับจัดรูปแบบหน้าจอ"),
    ],
  });

  // ===========================================================
  // บทที่ 3: วิธีการดำเนินงาน
  // ===========================================================
  sections.push({
    children: [
      h1("บทที่ 3  วิธีการดำเนินงาน"),
      emptyLine(),

      h2("3.1  สถาปัตยกรรมระบบ (System Architecture)"),
      body("ระบบ Water System ใช้สถาปัตยกรรมแบบ Hybrid Multi-layer ประกอบด้วย 4 ชั้นหลัก ดังนี้"),
      emptyLine(),

      h3("3.1.1  ชั้นที่ 1: Data Collection Layer (ชั้นเก็บข้อมูล)"),
      body("ชั้นนี้ทำหน้าที่ดึงข้อมูลจากเว็บไซต์ต้นทาง มีกลไกการทำงาน 2 ช่องทาง ได้แก่"),
      bullet("Chrome Extension (Primary) – Content Script ที่ทำงานบนหน้าเว็บจริง อ่าน DOM Table โดยตรง รองรับ Pagination อัตโนมัติ (กดปุ่ม Next → รอโหลด → อ่าน → วนซ้ำ)"),
      bullet("Puppeteer Headless Browser (Fallback) – ใช้ Node.js ควบคุม Chrome ไร้หน้าจอ เปิดเว็บ → รอ Table Selector โหลด → อ่านข้อมูลทุกหน้า → ปิดเบราว์เซอร์ มี Safety Timeout 120 วินาที"),

      h3("3.1.2  ชั้นที่ 2: Processing Layer (ชั้นประมวลผล)"),
      body("ชั้นนี้เป็น Node.js Express Server (server.js ~2,463 บรรทัด) ทำหน้าที่เป็น Central Controller ควบคุมการทำงานทั้งระบบ ประกอบด้วย"),
      bullet("Express.js REST API – รับข้อมูลผ่าน HTTP POST (เช่น /api/append-data-db, /api/complaints-append-db)"),
      bullet("Socket.IO Server – สื่อสาร Real-time กับ Chrome Extension และ Dashboard UI"),
      bullet("Schedule Checker – ตรวจสอบตารางเวลาทุก 10 วินาที เมื่อถึงเวลาที่กำหนด จะ Trigger การเก็บข้อมูล"),
      bullet("Retry Engine – ระบบ Retry + Exponential Backoff สูงสุด 3 ครั้ง (10s → 30s → 60s)"),
      bullet("Data Validation – ตรวจสอบความถูกต้องของข้อมูลก่อน INSERT ลงฐานข้อมูล"),
      bullet("Risk Calculation – คำนวณระดับความเสี่ยง (ปกติ/เฝ้าระวัง/วิกฤต) จากปริมาณฝนสะสม"),

      h3("3.1.3  ชั้นที่ 3: Storage Layer (ชั้นจัดเก็บ)"),
      body("ชั้นนี้จัดเก็บข้อมูลใน 2 รูปแบบ โดยมี Automatic Failover"),
      bullet("MySQL Database (Primary) – ฐานข้อมูล water_systems มี 4 ตาราง Connection Pool สูงสุด 10 connections"),
      bullet("Excel Files (Fallback) – Water_Database_Master.xlsx, Drought_Dam_Data.xlsx, PM25_Air_Quality_Data.xlsx"),

      h3("3.1.4  ชั้นที่ 4: Presentation Layer (ชั้นแสดงผล)"),
      body("แดชบอร์ดวิเคราะห์ข้อมูลบนเว็บเบราว์เซอร์ (backend_ui/index.html ~7,226 บรรทัด) ประกอบด้วย"),
      bullet("Sidebar Navigation – เมนูด้านซ้าย 8 หน้า (Dashboard, Home, Water, Drought, Fire, PM 2.5, Complaints, Schedule)"),
      bullet("Dashboard Analysis – 4 Sub-tabs วิเคราะห์ข้อมูลแต่ละด้าน พร้อม KPI Cards, Line/Bar/Doughnut Chart"),
      bullet("Date Range Picker – กรองข้อมูลตามช่วงวันที่ (ใช้ daterangepicker library)"),
      bullet("Dark Mode – รองรับ Light/Dark Theme อัตโนมัติตาม System Preference"),
      bullet("Real-time Logs – แสดง Server Log แบบ Real-time ผ่าน Socket.IO"),

      emptyLine(),
      h2("3.2  แหล่งข้อมูลและวิธีการเก็บรวบรวม"),
      emptyLine(),

      h3("3.2.1  แหล่งที่ 1: ระบบเฝ้าระวังสถานการณ์น้ำ สสน. (HAII)"),
      bullet("URL: https://lampang.thaiwater.net"),
      bullet("หน่วยงาน: สถาบันสารสนเทศทรัพยากรน้ำ (องค์การมหาชน)"),
      bullet("ข้อมูลที่เก็บ: ระดับน้ำ 26 สถานี / อ่างเก็บน้ำ 36 อ่าง / PM 2.5"),
      bullet("ลักษณะข้อมูล: HTML Table ที่ Render ด้วย JavaScript (Dynamic Content)"),
      bullet("Pagination: มีหลายหน้า (Next Page) ต้อง Parse ทีละหน้า"),
      bullet("ความถี่อัปเดต: ทุก 15 นาที – 1 ชั่วโมง (ขึ้นกับประเภทข้อมูล)"),

      h3("3.2.2  แหล่งที่ 2: Traffy Fondue (NECTEC/สวทช.)"),
      bullet("URL: https://citydata.traffy.in.th (หน้าเว็บ) + https://publicapi.traffy.in.th (API)"),
      bullet("หน่วยงาน: สำนักงานพัฒนาวิทยาศาสตร์และเทคโนโลยีแห่งชาติ"),
      bullet("ข้อมูลที่เก็บ: เรื่องร้องเรียนจากประชาชนในจังหวัดลำปาง"),
      bullet("ข้อมูลเสริม: Timeline แต่ละ Ticket (ดึงผ่าน Public API, rate limit 250ms/request)"),
      bullet("Deduplication: UPSERT (ON DUPLICATE KEY UPDATE) ด้วย ticket_id เป็น Unique Key"),

      emptyLine(),
      h2("3.3  ขั้นตอนการเก็บข้อมูลอัตโนมัติ (Automated Pipeline)"),
      body("ขั้นตอนการเก็บข้อมูลแต่ละรอบ มี 9 ขั้นตอนหลัก ดังนี้"),
      emptyLine(),
      numbered(1, "Pre-flight Check – ตรวจสอบอินเทอร์เน็ตด้วย DNS Lookup (lampang.thaiwater.net → google.com)"),
      numbered(2, "Extension Check – ตรวจสอบสถานะ Chrome Extension ผ่าน Socket.IO Connection"),
      numbered(3, "Dispatch Command – ส่งคำสั่ง FETCH_DATA_DB ไปยัง Extension (หรือเปิด Puppeteer ถ้า Extension ไม่ตอบใน 60 วินาที)"),
      numbered(4, "Web Navigation – Extension/Puppeteer เปิดหน้าเว็บเป้าหมาย → รอ Table Selector โหลดเสร็จ"),
      numbered(5, "DOM Parsing – อ่านข้อมูลจาก HTML Table ทุกหน้า (Auto-pagination: Click Next → Wait → Parse → Loop)"),
      numbered(6, "Data Transformation – แปลง Raw HTML Data เป็น Structured Array + คำนวณข้อมูลเพิ่มเติม"),
      numbered(7, "API Submission – ส่งข้อมูลไป Backend API (POST /api/append-data-db)"),
      numbered(8, "Database INSERT – INSERT ลง MySQL พร้อม Data Validation + Error Handling"),
      numbered(9, "Logging & Status Update – บันทึก Log + อัปเดตสถานะบน Dashboard แบบ Real-time"),

      emptyLine(),
      body("การเก็บข้อมูลแบบ Stagger (เหลื่อมเวลา):"),
      bullet("Water Level: เริ่มทันที (+0 วินาที)"),
      bullet("Drought/Dam: เริ่มหลัง +45 วินาที"),
      bullet("PM 2.5: เริ่มหลัง +90 วินาที"),
      bullet("Complaints: เริ่มหลัง +135 วินาที"),
      body("การ Stagger ป้องกันการใช้ CPU และ Memory พร้อมกันเกินไปจากการเปิด Puppeteer หลาย Instance"),

      emptyLine(),
      h2("3.4  การออกแบบฐานข้อมูล"),
      body("ฐานข้อมูล MySQL (water_systems) ประกอบด้วย 4 ตารางหลัก ดังนี้"),
      emptyLine(),
      para([txt("ตารางที่ 3 โครงสร้างตารางฐานข้อมูล MySQL", { size: SZ_BODY, bold: true })], { align: AlignmentType.CENTER }),
      table(
        ["ตาราง", "จำนวนฟิลด์", "Primary Key", "คำอธิบาย"],
        [
          ["tbl_water_disaster_monitoring", "18", "id (AUTO_INCREMENT)", "ข้อมูลระดับน้ำ 26 สถานี"],
          ["tbl_drought_monitoring", "12", "id (AUTO_INCREMENT)", "ข้อมูลอ่างเก็บน้ำ 36 อ่าง"],
          ["tbl_pm25_monitoring", "12", "id (AUTO_INCREMENT)", "ข้อมูล PM 2.5 แต่ละสถานี"],
          ["tbl_complaints_monitoring", "14", "id (AUTO_INCREMENT)", "เรื่องร้องเรียน Traffy Fondue"],
        ]
      ),

      emptyLine(),
      para([txt("ตารางที่ 4 รายละเอียดฟิลด์ tbl_water_disaster_monitoring", { size: SZ_BODY, bold: true })], { align: AlignmentType.CENTER }),
      tableLeftAlign(
        ["ฟิลด์", "ประเภท", "คำอธิบาย"],
        [
          ["id", "INT AUTO_INCREMENT", "Primary Key"],
          ["record_date", "VARCHAR(100)", "วันที่เก็บข้อมูล (ภาษาไทย)"],
          ["recorded_at", "DATETIME", "เวลาบันทึก ISO"],
          ["station_name", "VARCHAR(255)", "ชื่อสถานี"],
          ["river_basin", "VARCHAR(100)", "ลุ่มน้ำ"],
          ["district", "VARCHAR(100)", "อำเภอ"],
          ["water_level", "DECIMAL(12,4)", "ระดับน้ำ (ม.รทก.)"],
          ["bank_level", "DECIMAL(12,4)", "ระดับตลิ่ง (ม.รทก.)"],
          ["bank_diff", "DECIMAL(12,4)", "ผลต่างตลิ่ง (ม.)"],
          ["trend", "VARCHAR(50)", "แนวโน้ม (เพิ่ม/ลด/คงที่)"],
          ["water_situation", "VARCHAR(100)", "สถานการณ์น้ำ"],
          ["rain_3d", "DECIMAL(10,2)", "ฝนสะสม 3 วัน (มม.)"],
          ["rain_7d", "DECIMAL(10,2)", "ฝนสะสม 7 วัน (มม.)"],
          ["risk_level", "VARCHAR(50)", "ระดับความเสี่ยง"],
        ]
      ),

      emptyLine(),
      para([txt("ตารางที่ 5 รายละเอียดฟิลด์ tbl_drought_monitoring", { size: SZ_BODY, bold: true })], { align: AlignmentType.CENTER }),
      tableLeftAlign(
        ["ฟิลด์", "ประเภท", "คำอธิบาย"],
        [
          ["id", "INT AUTO_INCREMENT", "Primary Key"],
          ["record_date", "VARCHAR(100)", "วันที่เก็บข้อมูล"],
          ["recorded_at", "DATETIME", "เวลาบันทึก ISO"],
          ["dam_type", "VARCHAR(100)", "ประเภทอ่าง (ใหญ่/กลาง/เล็ก)"],
          ["dam_name", "VARCHAR(100)", "ชื่ออ่างเก็บน้ำ"],
          ["capacity_m_cum", "DECIMAL(12,4)", "ความจุ (ล้าน ลบ.ม.)"],
          ["inflow_m_cum", "DECIMAL(12,4)", "น้ำไหลเข้า (ล้าน ลบ.ม.)"],
          ["water_volume_m_cum", "DECIMAL(12,4)", "ปริมาณน้ำในอ่าง"],
          ["water_percent", "VARCHAR(20)", "เปอร์เซ็นต์น้ำ (%)"],
          ["usable_water_m_cum", "DECIMAL(12,4)", "น้ำใช้การ (ล้าน ลบ.ม.)"],
          ["discharge_m_cum", "DECIMAL(12,4)", "น้ำระบาย (ล้าน ลบ.ม.)"],
        ]
      ),

      emptyLine(),
      h2("3.5  ระบบ Fallback และ Error Handling"),
      body("ระบบออกแบบให้มีความเสถียรสูงสุดด้วยกลไก Fallback 3 ระดับ ดังนี้"),
      emptyLine(),
      para([txt("ตารางที่ 10 สรุปเปรียบเทียบกลไก Fallback", { size: SZ_BODY, bold: true })], { align: AlignmentType.CENTER }),
      table(
        ["ระดับ", "กลไก", "Trigger Condition", "Timeout", "ข้อดี", "ข้อจำกัด"],
        [
          ["1 (Primary)", "Chrome Extension", "ผู้ใช้เปิดหน้าเว็บ", "-", "เร็ว แม่นยำ", "ต้องเปิด Browser"],
          ["2 (Secondary)", "Puppeteer Headless", "Extension ไม่ตอบ 60s", "120s", "อัตโนมัติ", "ใช้ RAM สูง"],
          ["3 (Tertiary)", "Excel Backup", "MySQL ล้มเหลว", "-", "ไม่สูญหาย", "ไม่สะดวก Query"],
        ]
      ),

      emptyLine(),
      body("นอกจากนี้ ระบบยังมีกลไก Error Handling เพิ่มเติม ดังนี้"),
      bullet("Retry + Exponential Backoff: Retry สูงสุด 3 ครั้ง ด้วย Backoff 15s → 30s → 60s"),
      bullet("Pre-flight Internet Check: ตรวจ DNS ก่อนเปิด Puppeteer เพื่อประหยัดทรัพยากร"),
      bullet("Safety Timeout: Puppeteer มี Timeout 120 วินาที ป้องกันเบราว์เซอร์ค้าง"),
      bullet("Browser Lock (Mutex): ป้องกันการเปิด Puppeteer ซ้ำซ้อน ด้วย isRunningPuppeteerWL flag"),
      bullet("Connection Pool: MySQL Connection Pool สูงสุด 10 connections ป้องกัน Deadlock"),
      bullet("Graceful Socket Reconnect: Extension หลุดการเชื่อมต่อ → รอ 30 วินาทีให้ Auto-reconnect ก่อนแจ้งเตือน"),

      emptyLine(),
      h2("3.6  เครื่องมือและเทคโนโลยีที่ใช้"),
      emptyLine(),
      para([txt("ตารางที่ 2 เทคโนโลยีที่ใช้ในโครงการ", { size: SZ_BODY, bold: true })], { align: AlignmentType.CENTER }),
      table(
        ["ชั้น (Layer)", "เทคโนโลยี", "เวอร์ชัน", "หน้าที่"],
        [
          ["Runtime", "Node.js + Express.js", "Express 5.2.1", "Backend Server, REST API"],
          ["Web Scraping", "Puppeteer", "v25.0.3", "Headless Browser Fallback"],
          ["Extension", "Chrome Extension MV3", "Manifest V3", "Primary Data Collector"],
          ["Real-time", "Socket.IO", "v4.8.3", "Extension ↔ Server ↔ Dashboard"],
          ["Database", "MySQL + mysql2", "MySQL 5.7.24", "Primary Data Storage"],
          ["Spreadsheet", "ExcelJS", "v4.4.0", "Fallback Data Storage"],
          ["Dashboard UI", "HTML + TailwindCSS", "CDN", "Frontend Rendering"],
          ["Charts", "Chart.js + DataLabels", "CDN", "Data Visualization"],
          ["Date Picker", "daterangepicker", "CDN", "Date Range Filter"],
          ["Build Tool", "Vite", "v8.0.12", "Development Build"],
        ]
      ),
    ],
  });

  // ===========================================================
  // บทที่ 4: ผลการดำเนินงาน (พร้อมภาพ)
  // ===========================================================
  const ch4Children = [
    h1("บทที่ 4  ผลการดำเนินงาน"),
    emptyLine(),

    h2("4.1  หน้าจอระบบ (System Screenshots)"),
    body("ระบบ Water System Integrated Data Platform สามารถเข้าถึงได้ผ่าน http://localhost:3000 มีหน้าจอหลัก 8 หน้า แสดงผ่านภาพจากระบบจริงดังต่อไปนี้"),
    emptyLine(),

    h3("4.1.1  หน้าจอหลักระบบ (Water Scraper Status)"),
    body("แสดงสถานะการเชื่อมต่อ Chrome Extension, Log การเก็บข้อมูลล่าสุด, และปุ่มสั่ง Manual Fetch"),
    ...embedImage("01_dashboard_main.png", "ภาพที่ 1 หน้าจอหลักระบบ Dashboard แสดงสถานะ Water Scraper และ Log"),

    h3("4.1.2  หน้า Home – System Health & Storage Verification"),
    body("แสดง KPI ภาพรวมระบบ ได้แก่ จำนวนงานที่เสร็จสิ้น สถานะ MySQL Database สถานะ Chrome Extension และอัตราการ Sync รวมถึงผลการตรวจสอบ Storage ของทั้ง 4 ด้าน"),
    ...embedImage("02_dashboard_home.png", "ภาพที่ 2 หน้า Home แสดง System Health, KPI และ Storage Verifier"),

    h3("4.1.3  แดชบอร์ดวิเคราะห์ข้อมูลระดับน้ำ (Water Analysis)"),
    body("แสดง KPI ค่าเฉลี่ยระดับน้ำทั้งจังหวัด (247.57 ม.รทก.), จำนวนสถานีเฝ้าระวัง (0), ฝนสะสมเฉลี่ย (7.6 มม.) พร้อมกราฟระดับน้ำรายสถานีและกราฟแนวโน้มพร้อมการพยากรณ์ล่วงหน้า 3 วัน"),
    ...embedImage("03_analysis_water.png", "ภาพที่ 3 แดชบอร์ดวิเคราะห์ข้อมูลระดับน้ำ – KPI, กราฟรายสถานี และพยากรณ์ 3 วัน"),

    h3("4.1.4  แดชบอร์ดวิเคราะห์ข้อมูลภัยแล้ง (Drought Analysis)"),
    body("แสดง KPI จำนวนอ่าง 36 แห่ง ปริมาณน้ำรวมทั้งจังหวัด (309.2 ล้าน ลบ.ม.) เปอร์เซ็นต์กักเก็บเฉลี่ย (58.3%) พร้อมกราฟเปรียบเทียบปริมาณน้ำปัจจุบันกับความจุอ่าง และกราฟพยากรณ์แนวโน้มน้ำกักเก็บ"),
    ...embedImage("04_analysis_drought.png", "ภาพที่ 4 แดชบอร์ดวิเคราะห์ภัยแล้ง – อ่างเก็บน้ำ 36 แห่ง พร้อมกราฟพยากรณ์"),

    h3("4.1.5  แดชบอร์ดวิเคราะห์ข้อมูล PM 2.5 (Air Quality)"),
    body("แสดง KPI ค่าเฉลี่ย PM 2.5 ทั้งจังหวัด (9.9 µg/m³) สถานีเกินเกณฑ์ (2 สถานี) อำเภอที่อากาศดีที่สุด (เมืองปาน 0 µg/m³) พร้อมกราฟ PM 2.5 รายอำเภอและกราฟแนวโน้มพร้อมพยากรณ์"),
    ...embedImage("05_analysis_pm25.png", "ภาพที่ 5 แดชบอร์ดวิเคราะห์ PM 2.5 – ค่าเฉลี่ยรายอำเภอ และแนวโน้มล่วงหน้า"),

    h3("4.1.6  แดชบอร์ดวิเคราะห์เรื่องร้องเรียน (Complaints)"),
    body("แสดง KPI จำนวนเรื่องร้องเรียนทั้งหมด (5 เรื่อง) เรื่องเสร็จสิ้น (0 เรื่อง) อัตราการปิดเรื่อง (0%) พร้อมกราฟสถานะเรื่องร้องเรียนและกราฟความถี่การแจ้งปัญหาพร้อมเส้นแนวโน้ม"),
    ...embedImage("06_analysis_complaints.png", "ภาพที่ 6 แดชบอร์ดวิเคราะห์เรื่องร้องเรียน – สถานะ, ความถี่ และแนวโน้ม"),

    h3("4.1.7  หน้าจอ Scraper – ข้อมูลภัยแล้ง"),
    body("แสดง Log การเก็บข้อมูลอ่างเก็บน้ำ สถานะการเชื่อมต่อ และปุ่มสั่งดึงข้อมูลด้วยมือ"),
    ...embedImage("07_drought_scraper.png", "ภาพที่ 7 หน้าจอ Scraper ข้อมูลภัยแล้ง/อ่างเก็บน้ำ"),

    h3("4.1.8  หน้าจอ Scraper – ข้อมูล PM 2.5"),
    body("แสดง Log การเก็บข้อมูลคุณภาพอากาศ PM 2.5 สถานะการเชื่อมต่อ และปุ่มสั่งดึงข้อมูล"),
    ...embedImage("08_pm25_scraper.png", "ภาพที่ 8 หน้าจอ Scraper ข้อมูล PM 2.5"),

    h3("4.1.9  หน้าจอ Scraper – เรื่องร้องเรียน"),
    body("แสดง Log การเก็บข้อมูลเรื่องร้องเรียน Traffy Fondue สถิติ อบจ.ลำปาง และรายละเอียด Ticket"),
    ...embedImage("09_complaints_scraper.png", "ภาพที่ 9 หน้าจอ Scraper เรื่องร้องเรียน Traffy Fondue"),

    h3("4.1.10  หน้าจอตั้งค่าตารางเวลา (Schedule Settings)"),
    body("แสดงปุ่ม Toggle เปิด/ปิด Scraper อัตโนมัติของแต่ละด้าน และรายการตารางเวลาที่กำหนด (09:00 - 16:00)"),
    ...embedImage("10_schedule_settings.png", "ภาพที่ 10 หน้าจอตั้งค่าตารางเวลาทำงานอัตโนมัติ"),
  ];

  // -- Statistics Section --
  ch4Children.push(
    emptyLine(),
    h2("4.2  สถิติข้อมูลจริง 1 สัปดาห์ (25-31 พฤษภาคม 2569)"),
    emptyLine(),

    h3("4.2.1  สถิติข้อมูลระดับน้ำ"),
    body("ข้อมูลระดับน้ำเก็บจากสถานีวัด 26 สถานี ครอบคลุมลุ่มน้ำวังและลุ่มน้ำยม ใน 10 อำเภอ"),
    emptyLine(),
    para([txt("ตารางที่ 8 ตัวอย่างข้อมูลระดับน้ำ (สถานีตัวอย่าง)", { size: SZ_BODY, bold: true })], { align: AlignmentType.CENTER }),
    table(
      ["สถานี", "แม่น้ำ", "อำเภอ", "ระดับน้ำ", "ตลิ่ง", "ผลต่าง", "แนวโน้ม", "สถานการณ์", "ความเสี่ยง"],
      [
        ["บ้านเกาะคา", "ลุ่มน้ำวัง", "เกาะคา", "216.57", "220.46", "3.89", "ลดลง", "น้ำปกติ", "ปกติ"],
        ["สะพานเสตุวารี", "ลุ่มน้ำวัง", "เมืองลำปาง", "229.03", "234.50", "5.47", "ลดลง", "น้ำน้อย", "ปกติ"],
        ["บ้านดอนชัย", "ลุ่มน้ำวัง", "เถิน", "160.70", "165.80", "5.10", "คงที่", "น้ำน้อย", "วิกฤตสีแดง"],
        ["สะพานน้ำงาว", "ลุ่มน้ำยม", "งาว", "332.33", "333.48", "1.15", "คงที่", "น้ำน้อยวิกฤต", "ปกติ"],
      ]
    ),

    emptyLine(),
    h3("4.2.2  สถิติข้อมูลอ่างเก็บน้ำ"),
    body("ข้อมูลอ่างเก็บน้ำ 36 แห่ง แบ่งเป็น อ่างใหญ่ 3 แห่ง อ่างกลาง 30 แห่ง อ่างเล็ก 3 แห่ง"),
    emptyLine(),
    para([txt("ตารางที่ 9 ตัวอย่างข้อมูลอ่างเก็บน้ำขนาดใหญ่", { size: SZ_BODY, bold: true })], { align: AlignmentType.CENTER }),
    table(
      ["ชื่ออ่าง", "ความจุ", "น้ำไหลเข้า", "ปริมาณน้ำ", "น้ำ(%)", "น้ำใช้การ", "น้ำระบาย"],
      [
        ["อ่างแม่มอก", "110.00", "0.16", "31.04", "28%", "15.14", "0.08"],
        ["อ่างกิ่วลม", "106.22", "0.91", "68.35", "64%", "64.80", "0.25"],
        ["อ่างกิ่วคอหมา", "170.00", "0.83", "74.74", "44%", "68.54", "0.18"],
      ]
    ),
    bodyNoIndent("หน่วย: ล้าน ลบ.ม.", 0.7),

    emptyLine(),
    h3("4.2.3  สถิติข้อมูล PM 2.5"),
    body("ช่วงปลายเดือนพฤษภาคม 2569 ค่าเฉลี่ย PM 2.5 ทั้งจังหวัดอยู่ที่ 9.9 µg/m³ ซึ่งอยู่ในเกณฑ์ \"ดีมาก\" (≤15 µg/m³) เนื่องจากเข้าสู่ฤดูฝนทำให้ฝุ่นลดลงอย่างมาก มีสถานี 2 แห่งที่ค่าเกินเกณฑ์เนื่องจากกิจกรรมเฉพาะจุด"),

    emptyLine(),
    h3("4.2.4  สถิติข้อมูลเรื่องร้องเรียน"),
    body("จากระบบ Traffy Fondue กรองเฉพาะจังหวัดลำปาง มีเรื่องร้องเรียน 5 เรื่อง ในช่วงสัปดาห์นี้ ข้อมูลที่เก็บประกอบด้วย ticket_id, state_name, problem_type, description, photo_url, location, org_name, ticket_datetime, satisfaction_stars, raw_timeline และ agency_status"),
  );

  // -- Analysis Perspectives --
  ch4Children.push(
    emptyLine(),
    h2("4.3  มุมมองการวิเคราะห์ข้อมูล (ด้านละ 3 มุมมอง)"),
    emptyLine(),

    h3("4.3.1  มุมมองการวิเคราะห์ข้อมูลระดับน้ำ"),
    emptyLine(),
    para([txt("มุมมองที่ 1: การวิเคราะห์ระดับความเสี่ยงรายสถานี", { size: SZ_BODY, bold: true, underline: true })], { indent: 0.7 }),
    bullet("วิเคราะห์ระดับความเสี่ยงของ 26 สถานี โดยแบ่งเป็น 3 ระดับ: ปกติ / เฝ้าระวัง / วิกฤตสีแดง"),
    bullet("เกณฑ์การคำนวณ: ฝนสะสม 3 วัน + ฝนสะสม 7 วัน → ถ้ารวม > 90 มม. = วิกฤตสีแดง / > 35 มม. = เฝ้าระวัง"),
    bullet("จัดกลุ่มตามอำเภอ เพื่อระบุพื้นที่เสี่ยงเป็นกลุ่ม (Cluster)"),
    emptyLine(),
    para([txt("มุมมองที่ 2: การวิเคราะห์แนวโน้มระดับน้ำ (Trend Analysis)", { size: SZ_BODY, bold: true, underline: true })], { indent: 0.7 }),
    bullet("ติดตามแนวโน้ม 3 ประเภท: เพิ่มขึ้น / ลดลง / คงที่"),
    bullet("เปรียบเทียบแนวโน้มข้ามวัน เพื่อดูทิศทางระยะสั้น-กลาง"),
    bullet("คำนวณค่าเฉลี่ยระดับน้ำรายวัน แสดงเป็น Line Chart พร้อมเส้นพยากรณ์ 3 วัน"),
    emptyLine(),
    para([txt("มุมมองที่ 3: การวิเคราะห์ผลต่างตลิ่ง (Bank Difference)", { size: SZ_BODY, bold: true, underline: true })], { indent: 0.7 }),
    bullet("วิเคราะห์ผลต่างระหว่างระดับน้ำปัจจุบันกับระดับตลิ่ง"),
    bullet("สถานีที่มีผลต่าง < 2 ม. = ความเสี่ยงน้ำล้นตลิ่งสูง"),
    bullet("จัดอันดับ Most Critical Stations ตามผลต่างน้อยที่สุด"),

    emptyLine(),
    h3("4.3.2  มุมมองการวิเคราะห์ข้อมูลภัยแล้ง"),
    emptyLine(),
    para([txt("มุมมองที่ 1: เปอร์เซ็นต์น้ำในอ่าง (Water Percentage Classification)", { size: SZ_BODY, bold: true, underline: true })], { indent: 0.7 }),
    bullet("จัดกลุ่ม: วิกฤต (<30%) / ต่ำ (30-50%) / ปกติ (50-80%) / สมบูรณ์ (>80%)"),
    bullet("ระบุอ่างที่มีน้ำน้อยที่สุด: แม่ต๋ำตอนล่าง (18%), แม่มอก (28%)"),
    emptyLine(),
    para([txt("มุมมองที่ 2: ปริมาณน้ำไหลเข้า-ออก (Inflow vs Outflow)", { size: SZ_BODY, bold: true, underline: true })], { indent: 0.7 }),
    bullet("เปรียบเทียบ Inflow กับ Discharge → Outflow > Inflow = น้ำลดลง"),
    bullet("คำนวณดุลน้ำ (Water Balance) ของแต่ละอ่าง"),
    emptyLine(),
    para([txt("มุมมองที่ 3: ปริมาณน้ำใช้การ (Usable Water)", { size: SZ_BODY, bold: true, underline: true })], { indent: 0.7 }),
    bullet("วิเคราะห์น้ำที่ใช้การได้จริง vs ความจุทั้งหมด"),
    bullet("อ่างที่น้ำใช้การเป็นลบ: แม่ต๋ำตอนล่าง (-0.23 ล้าน ลบ.ม.) = วิกฤต"),

    emptyLine(),
    h3("4.3.3  มุมมองการวิเคราะห์ข้อมูล PM 2.5"),
    emptyLine(),
    para([txt("มุมมองที่ 1: ระดับคุณภาพอากาศรายสถานี", { size: SZ_BODY, bold: true, underline: true })], { indent: 0.7 }),
    bullet("จัดกลุ่ม: ดีมาก (≤15) / ดี (≤25) / ปานกลาง (≤37.5) / มีผลต่อสุขภาพ (>37.5)"),
    bullet("เปรียบเทียบค่า PM 2.5 ปัจจุบันกับค่าเฉลี่ย 24 ชั่วโมง"),
    emptyLine(),
    para([txt("มุมมองที่ 2: การวิเคราะห์เชิงพื้นที่ (Spatial Analysis)", { size: SZ_BODY, bold: true, underline: true })], { indent: 0.7 }),
    bullet("จัดกลุ่มตามอำเภอ: เมืองลำปาง + แม่เมาะ มีค่าสูงกว่าเฉลี่ย"),
    bullet("ประเมินผลกระทบต่อประชากรในแต่ละพื้นที่"),
    emptyLine(),
    para([txt("มุมมองที่ 3: แนวโน้มรายวัน (Daily Trend)", { size: SZ_BODY, bold: true, underline: true })], { indent: 0.7 }),
    bullet("คำนวณค่าเฉลี่ย PM 2.5 รายวัน → กราฟเส้น"),
    bullet("ระบุวัน Peak / Lowest ของสัปดาห์"),

    emptyLine(),
    h3("4.3.4  มุมมองการวิเคราะห์เรื่องร้องเรียน"),
    emptyLine(),
    para([txt("มุมมองที่ 1: สถานะเรื่อง (State Analysis)", { size: SZ_BODY, bold: true, underline: true })], { indent: 0.7 }),
    bullet("แบ่งตามสถานะ: รอรับเรื่อง / กำลังดำเนินการ / เสร็จสิ้น / ส่งต่อ"),
    bullet("คำนวณ Completion Rate = เสร็จ / ทั้งหมด × 100"),
    emptyLine(),
    para([txt("มุมมองที่ 2: ประเภทปัญหา (Problem Type)", { size: SZ_BODY, bold: true, underline: true })], { indent: 0.7 }),
    bullet("จัดอันดับ Top 5 ประเภทปัญหา: ถนน, ทางเท้า, ไฟฟ้า/ไฟส่องสว่าง ฯลฯ"),
    bullet("แสดง Horizontal Bar Chart"),
    emptyLine(),
    para([txt("มุมมองที่ 3: การวิเคราะห์ตามหน่วยงาน (Agency Analysis)", { size: SZ_BODY, bold: true, underline: true })], { indent: 0.7 }),
    bullet("แยก อบจ.ลำปาง vs หน่วยงานอื่น"),
    bullet("จำแนก: งานรับเรื่อง / งานส่งต่อ / งานเสร็จ / งานรับมอบ"),
  );

  // -- Summary of Real Data per Perspective --
  ch4Children.push(
    emptyLine(),
    h2("4.4  ผลสรุปข้อมูลจริงในแต่ละมุมมอง"),
    emptyLine(),

    h3("4.4.1  ผลสรุปข้อมูลระดับน้ำ"),
    bullet("มุมมองความเสี่ยง: สถานีส่วนใหญ่อยู่ในสถานะ \"น้ำปกติ\" และ \"น้ำน้อย\" มีสถานี 4 แห่งในอำเภอเถินที่อยู่ในระดับ \"วิกฤตสีแดง\" เนื่องจากปริมาณฝนสะสม 3 วัน (116 มม.) เกินเกณฑ์ 90 มม."),
    bullet("มุมมองแนวโน้ม: ส่วนใหญ่มีแนวโน้ม \"คงที่\" หรือ \"ลดลง\" แต่สะพานน้ำแม่ต๋ำ อ.เสริมงาม มีแนวโน้ม \"เพิ่มขึ้น\" ต้องเฝ้าระวัง"),
    bullet("มุมมองผลต่างตลิ่ง: สถานีที่มีผลต่างน้อยที่สุดคือ \"สะพานน้ำงาว\" อ.งาว (1.15 ม.) ต้องเฝ้าระวังหากฝนตกหนัก"),

    emptyLine(),
    h3("4.4.2  ผลสรุปข้อมูลภัยแล้ง"),
    bullet("มุมมองเปอร์เซ็นต์: อ่างน้ำน้อยที่สุด = แม่ต๋ำตอนล่าง (18%), น้ำมากที่สุด = แม่กึ๊ด (100%)"),
    bullet("มุมมอง Inflow/Outflow: อ่างใหญ่ 3 แห่ง มี Inflow > 0 แต่ปริมาณน้อย (0.16-0.91 ล้าน ลบ.ม.)"),
    bullet("มุมมองน้ำใช้การ: แม่ต๋ำตอนล่าง มีน้ำใช้การ -0.23 ล้าน ลบ.ม. (ติดลบ = วิกฤต)"),

    emptyLine(),
    h3("4.4.3  ผลสรุปข้อมูล PM 2.5"),
    bullet("มุมมองระดับ: ค่าเฉลี่ย 9.9 µg/m³ อยู่ในเกณฑ์ \"ดีมาก\" เนื่องจากเข้าสู่ฤดูฝน"),
    bullet("มุมมองเชิงพื้นที่: เมืองลำปาง + แม่เมาะ มีค่าสูงกว่าอำเภออื่น (พื้นที่เมือง/อุตสาหกรรม)"),
    bullet("มุมมองแนวโน้ม: ลดลงต่อเนื่องตั้งแต่ต้นเดือนพฤษภาคม สอดคล้องกับฤดูฝน"),

    emptyLine(),
    h3("4.4.4  ผลสรุปข้อมูลเรื่องร้องเรียน"),
    bullet("มุมมองสถานะ: มี 5 เรื่อง ส่วนใหญ่อยู่ในสถานะ \"กำลังดำเนินการ\""),
    bullet("มุมมองประเภทปัญหา: 3 อันดับแรก = ถนน, ทางเท้า, ไฟฟ้า/ไฟส่องสว่าง"),
    bullet("มุมมองหน่วยงาน: อบจ.ลำปาง รับเรื่องส่วนใหญ่ บางเรื่องส่งต่อหน่วยงานท้องถิ่นอื่น"),
  );

  sections.push({ children: ch4Children });

  // ===========================================================
  // บทที่ 5: สรุป อภิปราย และข้อเสนอแนะ
  // ===========================================================
  sections.push({
    children: [
      h1("บทที่ 5  สรุป อภิปราย และข้อเสนอแนะ"),
      emptyLine(),

      h2("5.1  สรุปผลการดำเนินงาน"),
      body("โครงการระบบบูรณาการข้อมูล (Water System Integrated Data Platform) ขององค์การบริหารส่วนจังหวัดลำปาง ประสบความสำเร็จในการบรรลุวัตถุประสงค์ทั้ง 5 ข้อ ดังนี้"),
      emptyLine(),
      numbered(1, "ระบบอัตโนมัติ: พัฒนาระบบเก็บข้อมูลอัตโนมัติ 4 ด้าน ตามตารางเวลาที่กำหนดได้สำเร็จ รองรับ 15 รอบ/วัน"),
      numbered(2, "ฐานข้อมูลเสถียร: จัดเก็บข้อมูลลง MySQL + Excel Fallback มี Deduplication ป้องกันข้อมูลซ้ำ"),
      numbered(3, "Dashboard วิเคราะห์: สร้างแดชบอร์ด Real-time พร้อม KPI, กราฟ Chart.js, Date Range Filter, Dark Mode"),
      numbered(4, "ลดภาระงาน: เจ้าหน้าที่ไม่ต้องเก็บข้อมูลด้วยมือ ระบบทำงานอัตโนมัติ 24/7"),
      numbered(5, "ข้อมูลประกอบการตัดสินใจ: วิเคราะห์ 3 มุมมอง/ด้าน รวม 12 มุมมอง พร้อมพยากรณ์ล่วงหน้า 3 วัน"),

      emptyLine(),
      h2("5.2  อภิปรายผล"),
      body("จากผลการดำเนินงาน พบว่าสถาปัตยกรรมแบบ Hybrid (Extension + Puppeteer + Node.js) มีประสิทธิภาพสูงในการเก็บข้อมูลจากเว็บไซต์ที่ไม่มี Public API ระบบ Fallback 3 ระดับ ช่วยให้การเก็บข้อมูลมีความเสถียรมาก แม้จะมีปัญหาเครือข่ายหรือฐานข้อมูลก็ไม่สูญหาย"),
      body("การใช้ Socket.IO สำหรับ Real-time Communication ทำให้ Dashboard สามารถแสดง Log และสถานะได้ทันที โดยไม่ต้อง Refresh หน้าเว็บ ซึ่งเป็นจุดเด่นที่ทำให้ผู้ใช้งานรู้สึกว่าระบบ \"มีชีวิต\" และน่าเชื่อถือ"),
      body("อย่างไรก็ตาม การ Stagger เวลาเก็บข้อมูล 4 ด้าน (0s, 45s, 90s, 135s) ทำให้แต่ละรอบใช้เวลาประมาณ 3-5 นาที ซึ่งเป็นข้อจำกัดหากต้องการข้อมูล Real-time ในทุกด้านพร้อมกัน"),

      emptyLine(),
      h2("5.3  ข้อจำกัดของโครงการ"),
      numbered(1, "ข้อมูลขึ้นอยู่กับเว็บไซต์ต้นทาง: หากเว็บไซต์ lampang.thaiwater.net เปลี่ยนโครงสร้าง HTML ระบบ Scraping จะต้องปรับปรุงตาม"),
      numbered(2, "Puppeteer ใช้ RAM สูง: การเปิด Headless Chrome ใช้ RAM ประมาณ 200-500 MB ต่อ Instance"),
      numbered(3, "Chrome Extension ต้องเปิด Browser: Extension ทำงานได้เมื่อผู้ใช้เปิด Chrome เท่านั้น (แต่มี Puppeteer Fallback)"),
      numbered(4, "ข้อมูลหมอกควันไฟป่ายังไม่สมบูรณ์: ระบบมีโครงสร้างรองรับแล้ว แต่ยังไม่ได้พัฒนา Scraper เต็มรูปแบบ"),
      numbered(5, "ยังไม่มีระบบ User Authentication: ระบบเปิดให้ทุกคนที่เข้าถึง localhost:3000 ใช้งานได้"),

      emptyLine(),
      h2("5.4  ข้อเสนอแนะสำหรับการพัฒนาต่อยอด"),
      numbered(1, "พัฒนาระบบ Alert/Notification อัตโนมัติ: ส่งแจ้งเตือนผ่าน LINE Notify / Email เมื่อข้อมูลเข้าเกณฑ์วิกฤต"),
      numbered(2, "เพิ่มข้อมูลหมอกควันไฟป่า (Fire/Hotspot): ดึงข้อมูล Hotspot จาก GISTDA หรือ NASA FIRMS"),
      numbered(3, "พัฒนา Report Generator อัตโนมัติ: ส่งสรุปรายวัน/รายสัปดาห์ให้ผู้บริหารอัตโนมัติ"),
      numbered(4, "บูรณาการกับ GIS (Map Visualization): แสดงข้อมูลบนแผนที่ด้วย Leaflet.js หรือ Google Maps"),
      numbered(5, "เพิ่ม User Authentication: เพิ่มระบบ Login/Role-based Access Control ก่อน Deploy บนเซิร์ฟเวอร์จริง"),
      numbered(6, "Deploy บน Cloud Server: ย้ายจาก localhost ไปยัง Cloud (เช่น DigitalOcean, AWS) เพื่อให้เข้าถึงได้จากทุกที่"),
      numbered(7, "ขยายผลไปจังหวัดอื่น: ระบบออกแบบให้ปรับ Config ได้ง่าย สามารถขยายไปจังหวัดอื่นที่ใช้ thaiwater.net"),
    ],
  });

  // ===========================================================
  // บรรณานุกรม
  // ===========================================================
  sections.push({
    children: [
      h1("บรรณานุกรม"),
      emptyLine(),
      bodyNoIndent("1.  สถาบันสารสนเทศทรัพยากรน้ำ (องค์การมหาชน). (2569). ระบบเฝ้าระวังสถานการณ์น้ำจังหวัดลำปาง. สืบค้นจาก https://lampang.thaiwater.net", 0.3),
      emptyLine(),
      bodyNoIndent("2.  สำนักงานพัฒนาวิทยาศาสตร์และเทคโนโลยีแห่งชาติ. (2569). Traffy Fondue – แพลตฟอร์มรับเรื่องร้องเรียน. สืบค้นจาก https://www.traffy.in.th", 0.3),
      emptyLine(),
      bodyNoIndent("3.  Node.js Foundation. (2026). Node.js Documentation. Retrieved from https://nodejs.org/en/docs/", 0.3),
      emptyLine(),
      bodyNoIndent("4.  Google Chrome Developers. (2026). Chrome Extensions Manifest V3. Retrieved from https://developer.chrome.com/docs/extensions/mv3/", 0.3),
      emptyLine(),
      bodyNoIndent("5.  Puppeteer Team. (2026). Puppeteer Documentation. Retrieved from https://pptr.dev/", 0.3),
      emptyLine(),
      bodyNoIndent("6.  Socket.IO. (2026). Socket.IO Documentation v4. Retrieved from https://socket.io/docs/v4/", 0.3),
      emptyLine(),
      bodyNoIndent("7.  Chart.js. (2026). Chart.js Documentation. Retrieved from https://www.chartjs.org/docs/", 0.3),
      emptyLine(),
      bodyNoIndent("8.  Oracle Corporation. (2026). MySQL 5.7 Reference Manual. Retrieved from https://dev.mysql.com/doc/refman/5.7/en/", 0.3),
      emptyLine(),
      bodyNoIndent("9.  ExcelJS. (2026). ExcelJS – Excel Workbook Manager. Retrieved from https://github.com/exceljs/exceljs", 0.3),
      emptyLine(),
      bodyNoIndent("10. TailwindCSS. (2026). Tailwind CSS Documentation. Retrieved from https://tailwindcss.com/docs", 0.3),
    ],
  });

  // ===========================================================
  // ภาคผนวก
  // ===========================================================
  sections.push({
    children: [
      h1("ภาคผนวก"),
      emptyLine(),

      h2("ภาคผนวก ก: โครงสร้างไฟล์โครงการ (Project Structure)"),
      emptyLine(),
      bodyNoIndent("Water_System/", 0.3),
      bodyNoIndent("├── server.js                    # Backend Server หลัก (2,463 บรรทัด)", 0.5),
      bodyNoIndent("├── package.json                 # Dependencies", 0.5),
      bodyNoIndent("├── config.json                  # ตารางเวลา + สถานะ Schedule", 0.5),
      bodyNoIndent("├── task_history.json             # ประวัติการเก็บข้อมูล", 0.5),
      bodyNoIndent("├── fetch_history.log             # Log ถาวร", 0.5),
      bodyNoIndent("├── water_systems.sql             # SQL Schema + Sample Data", 0.5),
      bodyNoIndent("├── db_setup.js                  # สคริปต์สร้างตาราง", 0.5),
      bodyNoIndent("├── db_setup_complaints.js        # สคริปต์สร้างตาราง Complaints", 0.5),
      bodyNoIndent("├── db_setup_pm25.js             # สคริปต์สร้างตาราง PM 2.5", 0.5),
      bodyNoIndent("├── Water_Database_Master.xlsx    # Excel Backup ข้อมูลน้ำ", 0.5),
      bodyNoIndent("├── Drought_Dam_Data.xlsx         # Excel Backup ภัยแล้ง", 0.5),
      bodyNoIndent("├── PM25_Air_Quality_Data.xlsx    # Excel Backup PM 2.5", 0.5),
      bodyNoIndent("├── backend_ui/                  # Dashboard UI (7,226 บรรทัด)", 0.5),
      bodyNoIndent("│   └── index.html               # SPA Dashboard", 0.5),
      bodyNoIndent("├── 01System_Water/              # Chrome Extension หลัก", 0.5),
      bodyNoIndent("│   ├── manifest.json            # Manifest V3", 0.5),
      bodyNoIndent("│   ├── content.js               # Content Script (1,304 บรรทัด)", 0.5),
      bodyNoIndent("│   ├── background.js            # Service Worker", 0.5),
      bodyNoIndent("│   └── content.css              # UI Styling", 0.5),
      bodyNoIndent("├── 04ext_TraffyLP/              # Extension Traffy Fondue", 0.5),
      bodyNoIndent("│   ├── manifest.json            # Manifest V3", 0.5),
      bodyNoIndent("│   ├── content.js               # Content Script", 0.5),
      bodyNoIndent("│   └── background.js            # Service Worker", 0.5),
      bodyNoIndent("├── Sum_Day/                     # สรุปรายวัน", 0.5),
      bodyNoIndent("├── Sum_Week/                    # สรุปรายสัปดาห์", 0.5),
      bodyNoIndent("└── Sum_Month/                   # สรุปรายเดือน", 0.5),

      emptyLine(),
      h2("ภาคผนวก ข: การตั้งค่าและการใช้งานระบบ"),
      emptyLine(),
      h3("ข.1  ความต้องการของระบบ (System Requirements)"),
      bullet("Node.js v18+ (ES Module support)"),
      bullet("MySQL v5.7+ หรือ MariaDB v10.3+"),
      bullet("Google Chrome v120+ (สำหรับ Extension)"),
      bullet("RAM ≥ 4 GB (สำหรับ Puppeteer)"),
      bullet("Disk Space ≥ 500 MB"),

      h3("ข.2  ขั้นตอนการติดตั้ง"),
      numbered(1, "Clone หรือคัดลอกโฟลเดอร์ Water_System ไปยังเครื่อง"),
      numbered(2, "รันคำสั่ง npm install เพื่อติดตั้ง Dependencies"),
      numbered(3, "สร้างฐานข้อมูล MySQL: CREATE DATABASE water_systems"),
      numbered(4, "รัน db_setup.js, db_setup_complaints.js, db_setup_pm25.js เพื่อสร้างตาราง"),
      numbered(5, "รัน node server.js เพื่อเริ่มต้นเซิร์ฟเวอร์"),
      numbered(6, "เปิด http://localhost:7000 บน Chrome"),
      numbered(7, "ติดตั้ง Extension: Chrome → เปิด Developer Mode → Load Unpacked → เลือกโฟลเดอร์ 01System_Water"),
      numbered(8, "เปิดเว็บ lampang.thaiwater.net → Extension จะเชื่อมต่อ Server อัตโนมัติ"),

      emptyLine(), emptyLine(),
      para([txt("— จบรายงาน —", { size: SZ_BODY, bold: true, color: "888888" })], { align: AlignmentType.CENTER, spaceBefore: 600 }),
    ],
  });

  // ===========================================================
  // BUILD DOCUMENT
  // ===========================================================
  const doc = new Document({
    styles: {
      default: { document: { run: { font: FONT, size: SZ_BODY } } },
    },
    sections: sections.map(s => ({
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1.2),
            right: convertInchesToTwip(0.8),
          },
        },
      },
      headers: {
        default: new Header({
          children: [
            para([txt("รายงานสรุปโครงการระบบบูรณาการข้อมูล อบจ.ลำปาง | Water System Integrated Data Platform", { size: SZ_TINY, color: "AAAAAA" })], { align: AlignmentType.RIGHT }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            para([
              txt("หน้า ", { size: SZ_SMALL, color: "999999" }),
              new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: SZ_SMALL, color: "999999" }),
            ], { align: AlignmentType.CENTER }),
          ],
        }),
      },
      children: s.children,
    })),
  });

  // Write to file
  const buffer = await Packer.toBuffer(doc);
  const outputPath = 'd:\\Water_System\\รายงานสรุปโครงการ_Water_System_Complete.docx';
  fs.writeFileSync(outputPath, buffer);
  console.log(`\n✅ สร้างเอกสารปริญญานิพนธ์สำเร็จ!`);
  console.log(`📄 ไฟล์: ${outputPath}`);
  console.log(`📏 ขนาด: ${(buffer.length / 1024).toFixed(2)} KB`);
  console.log(`🖼️  ภาพประกอบ: 10 ภาพจากระบบจริง`);
}

export { generateExecutiveReport } from './report_generator_service.js';

if (process.argv[1] && (process.argv[1].endsWith('generate_report.js') || process.argv[1].endsWith('generate_report'))) {
  generateReport().catch(err => {
    console.error("❌ เกิดข้อผิดพลาด:", err);
    process.exit(1);
  });
}
