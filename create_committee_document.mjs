/**
 * create_committee_document.mjs
 * สร้างเอกสาร Word สำหรับกรรมการและหัวหน้า
 * สรุปโครงการระบบบูรณาการข้อมูลสารสนเทศ อบจ.ลำปาง
 * อิงตาม Presentation V2 + ข้อมูลจากใบส่งงาน พ.ค. 2569
 */

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, Table, TableRow, TableCell,
  WidthType, ShadingType, TableBorders, Header, Footer,
  PageNumber, NumberFormat
} from 'docx';
import * as fs from 'fs';

const FONT = 'TH SarabunPSK';
const FONT_EN = 'Calibri';

// ============================================================
// Helper Functions
// ============================================================
function heading1(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: 36, bold: true, color: '064e3b' })],
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 300, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: '059669' } },
  });
}

function heading2(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: 32, bold: true, color: '1e3a5f' })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 250, after: 150 },
  });
}

function heading3(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: 28, bold: true, color: '334155' })],
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100 },
  });
}

function bodyText(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({
      text, font: FONT, size: 28,
      bold: opts.bold || false,
      italics: opts.italic || false,
      color: opts.color || '000000',
    })],
    spacing: { before: opts.spaceBefore || 80, after: opts.spaceAfter || 80 },
    indent: opts.indent ? { firstLine: 720 } : undefined,
    alignment: opts.align || AlignmentType.LEFT,
  });
}

function bulletText(text) {
  return new Paragraph({
    children: [new TextRun({ text: `•  ${text}`, font: FONT, size: 28 })],
    spacing: { before: 60, after: 60 },
    indent: { left: 720 },
  });
}

function numberedText(num, text, opts = {}) {
  return new Paragraph({
    children: [
      new TextRun({ text: `${num}. `, font: FONT, size: 28, bold: true }),
      new TextRun({ text, font: FONT, size: 28 }),
    ],
    spacing: { before: 80, after: 80 },
    indent: { left: opts.indent || 720 },
  });
}

function emptyLine() {
  return new Paragraph({ children: [], spacing: { before: 100, after: 100 } });
}

// ============================================================
// Build Document
// ============================================================
const doc = new Document({
  creator: 'ฝ่ายกองยุทธศาสตร์และงบประมาณ อบจ.ลำปาง',
  title: 'สรุปโครงการระบบบูรณาการข้อมูลสารสนเทศเพื่อการเฝ้าระวังภัยพิบัติและสิ่งแวดล้อม',
  description: 'เอกสารสรุปสำหรับกรรมการและหัวหน้า',
  sections: [{
    properties: {
      page: {
        margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          children: [new TextRun({
            text: 'เอกสารสรุปโครงการ — ระบบบูรณาการข้อมูลสารสนเทศ อบจ.ลำปาง',
            font: FONT, size: 18, color: '94a3b8', italics: true,
          })],
          alignment: AlignmentType.RIGHT,
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          children: [
            new TextRun({ text: 'องค์การบริหารส่วนจังหวัดลำปาง  |  มิถุนายน 2569  |  หน้า ', font: FONT, size: 18, color: '94a3b8' }),
            new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: '94a3b8' }),
          ],
          alignment: AlignmentType.CENTER,
        })],
      }),
    },
    children: [
      // ============================================================
      // COVER
      // ============================================================
      emptyLine(),
      emptyLine(),
      emptyLine(),
      new Paragraph({
        children: [new TextRun({ text: 'องค์การบริหารส่วนจังหวัดลำปาง', font: FONT, size: 36, bold: true, color: '064e3b' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'Lampang Provincial Administrative Organization', font: FONT_EN, size: 24, color: '059669', italics: true })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      }),
      new Paragraph({
        children: [new TextRun({ text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', font: FONT_EN, size: 20, color: '059669' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'เอกสารสรุปโครงการ', font: FONT, size: 44, bold: true, color: '064e3b' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'ระบบบูรณาการข้อมูลสารสนเทศ', font: FONT, size: 40, bold: true, color: '1e3a5f' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'เพื่อการเฝ้าระวังภัยพิบัติและสิ่งแวดล้อม', font: FONT, size: 36, color: '059669' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
      }),
      new Paragraph({
        children: [new TextRun({ text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', font: FONT_EN, size: 20, color: '059669' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'สำหรับ: คณะกรรมการตรวจรับงานจ้าง / หัวหน้าฝ่าย', font: FONT, size: 28, bold: true, color: '334155' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'อ้างถึง: ใบสั่งจ้างเลขที่ ๓๕๐/๒๕๖๙ วันที่ ๙ เมษายน ๒๕๖๙', font: FONT, size: 28, color: '475569' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'ประจำเดือน: พฤษภาคม ๒๕๖๙', font: FONT, size: 28, color: '475569' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'วันที่จัดทำ: ๔ มิถุนายน ๒๕๖๙', font: FONT, size: 28, color: '475569' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'จัดทำโดย: นายภัคพล บุตติ', font: FONT, size: 28, bold: true, color: '334155' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'ตำแหน่ง นักวิเคราะห์ข้อมูล', font: FONT, size: 28, color: '475569' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'ฝ่ายกองยุทธศาสตร์และงบประมาณ', font: FONT, size: 28, color: '475569' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
      }),

      // ============================================================
      // PAGE BREAK
      // ============================================================
      new Paragraph({ children: [], pageBreakBefore: true }),

      // ============================================================
      // 1. บทนำ
      // ============================================================
      heading1('1. บทนำและวัตถุประสงค์'),

      bodyText('เอกสารฉบับนี้เป็นสรุปผลการดำเนินงานโครงการ "ระบบบูรณาการข้อมูลสารสนเทศเพื่อการเฝ้าระวังภัยพิบัติและสิ่งแวดล้อม" (Water System Integrated Data Platform) ขององค์การบริหารส่วนจังหวัดลำปาง ประจำเดือนพฤษภาคม ๒๕๖๙ จัดทำขึ้นเพื่อรายงานต่อคณะกรรมการตรวจรับงานจ้างและหัวหน้าฝ่าย', { indent: true }),
      emptyLine(),

      heading2('1.1 ปัญหาก่อนมีระบบ'),
      bulletText('ข้อมูลภัยพิบัติกระจายอยู่หลายแหล่ง ไม่มีศูนย์กลาง ต้องเปิดหน้าเว็บดูข้อมูลเองทุกวัน'),
      bulletText('ไม่สามารถดูแนวโน้มย้อนหลังหรือคาดการณ์สถานการณ์ล่วงหน้าได้'),
      bulletText('ผู้บริหารขาดข้อมูลที่ครบถ้วนในการตัดสินใจเชิงรุก'),
      bulletText('ไม่มีระบบแจ้งเตือนอัตโนมัติเมื่อสถานการณ์เข้าสู่ภาวะวิกฤต'),
      bulletText('ข้อมูลน้ำสูญเสียในระบบ (Non-Revenue Water: NRW) ไม่ได้ถูกติดตามอย่างเป็นระบบ'),
      emptyLine(),

      heading2('1.2 วัตถุประสงค์ของโครงการ'),
      numberedText(1, 'เก็บข้อมูลอัตโนมัติทุก 30 นาที จาก 4 แหล่งข้อมูลหลัก ครอบคลุม 26 สถานีวัดน้ำ 36 อ่างเก็บน้ำ PM 2.5 ทุกอำเภอ และเรื่องร้องเรียน Traffy Fondue'),
      numberedText(2, 'รวบรวมข้อมูลภัยพิบัติ 4 ด้าน ไว้ในฐานข้อมูลกลาง MySQL เดียวกัน'),
      numberedText(3, 'วิเคราะห์และแสดงผลข้อมูลผ่านแดชบอร์ดแบบ Real-time ที่เข้าใจง่าย'),
      numberedText(4, 'ใช้ระบบ AI (ปัญญาประดิษฐ์) วิเคราะห์สถานการณ์และให้ข้อเสนอแนะเชิงรุกแก่ผู้บริหาร'),
      numberedText(5, 'แจ้งเตือนอัตโนมัติเมื่อสถานการณ์เข้าสู่ระดับวิกฤต'),
      numberedText(6, 'วิเคราะห์น้ำสูญเสียในระบบ (NRW) พร้อมรายงานเปรียบเทียบรายไตรมาส'),

      // ============================================================
      // 2. ภาพรวมระบบ
      // ============================================================
      new Paragraph({ children: [], pageBreakBefore: true }),
      heading1('2. ภาพรวมของระบบ'),

      bodyText('ระบบประกอบด้วย 4 โมดูลหลัก ทำงานร่วมกันผ่านสถาปัตยกรรมแบบรวมศูนย์ โดยมีเซิร์ฟเวอร์ Node.js/Express เป็นศูนย์กลาง:', { indent: true }),
      emptyLine(),

      heading2('2.1 โมดูลที่ 1: ระบบเฝ้าระวังระดับน้ำ 🌊'),
      bulletText('แหล่งข้อมูล: lampang.thaiwater.net/wl — สถานีวัดน้ำ 26 สถานี ครอบคลุมทั้งจังหวัดลำปาง'),
      bulletText('การทำงาน: ตรวจสอบอินเทอร์เน็ต → เปิดหน้าเว็บอัตโนมัติ → ดึงข้อมูลทุกสถานี → คำนวณความเสี่ยง → บันทึก MySQL + Excel'),
      bulletText('แสดงผล: กราฟระดับน้ำรายสถานี, พยากรณ์ AI 3 วัน, สัดส่วนสถานะ, เปรียบเทียบกับระดับตลิ่ง'),
      emptyLine(),

      heading2('2.2 โมดูลที่ 2: ระบบติดตามภัยแล้งและอ่างเก็บน้ำ 🏜️'),
      bulletText('แหล่งข้อมูล: lampang.thaiwater.net/dam — ติดตามอ่างเก็บน้ำ 36 แห่ง (ใหญ่ กลาง เล็ก)'),
      bulletText('วิเคราะห์: ปริมาณน้ำสำรอง, เปอร์เซ็นต์ความจุ, น้ำไหลเข้า vs ระบาย, ปริมาณฝนสะสม 3/7 วัน'),
      bulletText('เกณฑ์วิกฤต: ≤10% = วิกฤต, 10-30% = เฝ้าระวัง, 30-70% = ปกติ, 70-100% = น้ำมาก, >100% = ล้น'),
      emptyLine(),

      heading2('2.3 โมดูลที่ 3: ระบบติดตามคุณภาพอากาศ PM 2.5 🍃'),
      bulletText('แหล่งข้อมูล: Air4Thai / กรมอนามัย — ครอบคลุมทุกอำเภอในจังหวัดลำปาง'),
      bulletText('มาตรฐาน 5 ระดับ: ดีมาก (0-15), ดี (15.1-25), ปานกลาง (25.1-37.5), เริ่มมีผล (37.6-75), มีผลกระทบ (>75.1 µg/m³)'),
      bulletText('แสดงผล: กราฟค่าฝุ่นรายอำเภอ, ประวัติย้อนหลัง, พยากรณ์แนวโน้ม, AI แนะนำมาตรการ'),
      emptyLine(),

      heading2('2.4 โมดูลที่ 4: ระบบรวบรวมเรื่องร้องเรียน 📢'),
      bulletText('แหล่งข้อมูล: Traffy Fondue (citydata.traffy.in.th) — พัฒนาโดย สวทช./NECTEC'),
      bulletText('ดึงข้อมูลเฉพาะจังหวัดลำปาง: ติดตามสถานะ รอ/กำลังดำเนินการ/เสร็จสิ้น'),
      bulletText('วิเคราะห์: อัตราแก้ไขสำเร็จ, ประเภทปัญหาพบบ่อย, พื้นที่ร้องเรียนมากสุด, พิกัด GPS'),

      // ============================================================
      // 3. สถาปัตยกรรมเทคโนโลยี
      // ============================================================
      new Paragraph({ children: [], pageBreakBefore: true }),
      heading1('3. สถาปัตยกรรมเทคโนโลยี'),

      bodyText('ระบบใช้สถาปัตยกรรมแบบ 3 ชั้น (3-Layer Architecture):', { indent: true }),
      emptyLine(),

      heading3('ชั้นที่ 1: แหล่งข้อมูลภายนอก (Data Sources)'),
      bulletText('lampang.thaiwater.net — ข้อมูลระดับน้ำ + อ่างเก็บน้ำ'),
      bulletText('Air4Thai / กรมอนามัย — ข้อมูลค่า PM 2.5'),
      bulletText('Traffy Fondue — เรื่องร้องเรียนจากประชาชน'),
      emptyLine(),

      heading3('ชั้นที่ 2: การเก็บรวบรวมข้อมูล (Collection Layer)'),
      bulletText('Chrome Extension (Manifest V3) — ดึงข้อมูลผ่านเบราว์เซอร์ (วิธีหลัก)'),
      bulletText('Puppeteer Headless Browser — ระบบสำรอง (Fallback) กรณี Extension ไม่ตอบสนองใน 60 วินาที'),
      bulletText('Scheduler — ตั้งเวลาดึงข้อมูลอัตโนมัติทุก 30 นาที ระหว่าง 09:00-16:00 น.'),
      bulletText('Retry + Lock — ป้องกันการทำงานซ้ำซ้อน ลองใหม่สูงสุด 3 ครั้ง'),
      emptyLine(),

      heading3('ชั้นที่ 3: จัดเก็บและแสดงผล'),
      bulletText('MySQL Database (water_systems) — 4 ตาราง: น้ำ, ภัยแล้ง, PM 2.5, ร้องเรียน'),
      bulletText('Excel Backup — ไฟล์สำรองข้อมูลอัตโนมัติ'),
      bulletText('Fallback 3 ระดับ: Extension → Puppeteer → Excel เพื่อป้องกันข้อมูลสูญหาย'),
      bulletText('Node.js + Express API Server (พอร์ต 3000) + Socket.io Real-time + Backend UI'),
      emptyLine(),

      heading3('เทคโนโลยีที่ใช้ (ทั้งหมดเป็น Open Source ไม่มีค่าลิขสิทธิ์)'),
      bulletText('Backend: Node.js, Express.js, Socket.io, MySQL (mysql2)'),
      bulletText('Data Collection: Puppeteer, Chrome Extension V3, ExcelJS, DNS Preflight Check'),
      bulletText('Frontend: HTML5/CSS3/JavaScript, TailwindCSS, Chart.js, DateRangePicker'),

      // ============================================================
      // 4. ระบบแดชบอร์ดและ AI
      // ============================================================
      new Paragraph({ children: [], pageBreakBefore: true }),
      heading1('4. แดชบอร์ดวิเคราะห์และระบบ AI'),

      heading2('4.1 ฟีเจอร์หลักของแดชบอร์ด'),
      numberedText(1, '4 โมดูลในหน้าเดียว — สลับดูข้อมูลน้ำ ภัยแล้ง PM 2.5 ร้องเรียน ได้ทันที'),
      numberedText(2, 'ตัวกรองวันที่ (Date Filter) — เลือกช่วงเวลาที่ต้องการวิเคราะห์ได้อย่างยืดหยุ่น'),
      numberedText(3, 'โหมดกลางคืน (Dark Mode) — ปรับการแสดงผลให้สบายตา'),
      numberedText(4, 'KPI Cards — ตัวเลขสำคัญแสดงชัดเจนด้านบน คลิกดูรายละเอียดเพิ่มเติมได้'),
      numberedText(5, '4 มุมมองต่อโมดูล — กราฟแท่ง เส้น วงกลม และตารางเปรียบเทียบ'),
      numberedText(6, 'อัปเดตอัตโนมัติ Real-time — ข้อมูลใหม่แสดงผลทันทีผ่าน WebSocket'),
      numberedText(7, 'ส่งออกรายงาน Excel อัตโนมัติ — สร้างรายงานพร้อมกราฟและข้อมูลสรุป'),
      emptyLine(),

      heading2('4.2 ระบบ AI Insights'),
      bodyText('ระบบ AI (ปัญญาประดิษฐ์) ทำหน้าที่วิเคราะห์ข้อมูลจากทุกโมดูลอัตโนมัติ:', { indent: true }),
      bulletText('วิเคราะห์ข้อมูลล่าสุดจากทุก 4 โมดูลอัตโนมัติ'),
      bulletText('แจ้งเตือนจุดเสี่ยงที่น่าเป็นห่วงในทันที'),
      bulletText('สรุปสถานการณ์รวมเป็นภาษาไทยเข้าใจง่าย'),
      bulletText('เสนอแนวทางรับมือและป้องกันเชิงรุก'),
      bulletText('คาดการณ์แนวโน้มล่วงหน้า 3 วัน'),
      bulletText('ระบุสถานี/อ่างที่ต้องเฝ้าระวังพิเศษ'),
      bulletText('แนะนำมาตรการป้องกันสุขภาพประชาชน'),
      emptyLine(),

      heading2('4.3 ระบบควบคุม (Control Panel)'),
      bulletText('เปิด/ปิดระบบอัตโนมัติ — Toggle ได้ทันที ไม่ต้องรีสตาร์ท'),
      bulletText('สั่งดึงข้อมูลทันที (Force Fetch) — ดึงทั้ง Excel + Database โดยไม่ต้องรอ'),
      bulletText('Live System Logs — ดูบันทึกการทำงานแบบ Real-time'),
      bulletText('ประวัติการทำงาน — ดูรายการ 50 งานล่าสุด พร้อมสถานะ'),
      bulletText('กำหนดเวลาเอง — เพิ่ม ลบ จัดลำดับเวลาทำงานได้ตามต้องการ'),

      // ============================================================
      // 5. ผลการปฏิบัติงานเดือน พ.ค. 2569
      // ============================================================
      new Paragraph({ children: [], pageBreakBefore: true }),
      heading1('5. ผลการปฏิบัติงานประจำเดือนพฤษภาคม ๒๕๖๙'),

      bodyText('ตามใบสั่งจ้างเลขที่ ๓๕๐/๒๕๖๙ วันที่ ๙ เมษายน ๒๕๖๙ ผู้ปฏิบัติงาน นายภัคพล บุตติ ตำแหน่งนักวิเคราะห์ข้อมูล สังกัดฝ่ายกองยุทธศาสตร์และงบประมาณ ได้ปฏิบัติงานดังนี้:', { indent: true }),
      emptyLine(),

      heading2('5.1 งานที่ปฏิบัติในเดือนพฤษภาคม ๒๕๖๙'),

      heading3('งานที่ 1: รวบรวมและตรวจสอบข้อมูล'),
      bodyText('รวบรวมและตรวจสอบความถูกต้องของข้อมูลปริมาณการใช้น้ำ ข้อมูลคุณภาพน้ำ และข้อมูลการซ่อมบำรุงระบบท่อส่งน้ำในพื้นที่ที่รับผิดชอบ พร้อมนำเข้าระบบฐานข้อมูล MySQL', { indent: true }),
      emptyLine(),

      heading3('งานที่ 2: จัดทำรายงานวิเคราะห์สรุปผล'),
      bodyText('จัดทำรายงานวิเคราะห์สรุปผลการดำเนินงานประจำเดือนเมษายน 2569 เปรียบเทียบกับเป้าหมายที่กำหนด วิเคราะห์แนวโน้มน้ำสูญเสียในระบบ (Non-Revenue Water: NRW) และจัดทำรายงานนำเสนอต่อผู้บริหาร', { indent: true }),
      emptyLine(),

      heading3('งานที่ 3: พัฒนาระบบ Backend UI และรายงานอัตโนมัติ'),
      bodyText('พัฒนาและปรับปรุงระบบรายงานออนไลน์ (Backend UI) และระบบสร้างรายงานอัตโนมัติให้มีประสิทธิภาพมากขึ้น', { indent: true }),
      emptyLine(),

      heading3('งานที่ 4: ปรับปรุง Dashboard และรายงานงบประมาณ'),
      bodyText('ปรับปรุง Dashboard แสดงผลข้อมูลระบบน้ำประปาให้ทันสมัยและใช้งานง่าย จัดทำรายงานเปรียบเทียบการใช้งบประมาณโครงการระบบน้ำประปาในไตรมาสที่ 2', { indent: true }),
      emptyLine(),

      heading3('งานที่ 5: ประชุมและวางแผนงาน'),
      bodyText('เข้าร่วมประชุมกับฝ่ายยุทธศาสตร์และผู้บริหาร เพื่อนำเสนอข้อมูลสนับสนุนการวางแผนโครงการและรับนโยบายการดำเนินงาน ตลอดจนจัดทำแผนการดำเนินงานและกำหนดเป้าหมายสำหรับเดือนมิถุนายน 2569', { indent: true }),

      emptyLine(),
      heading2('5.2 งานต้นเดือนมิถุนายน ๒๕๖๙ (4 มิ.ย.)'),
      numberedText(1, 'รวบรวมและจัดทำรายงานสรุปผลการปฏิบัติงานประจำเดือนพฤษภาคม 2569'),
      numberedText(2, 'ตรวจสอบความครบถ้วนถูกต้องของข้อมูลในระบบฐานข้อมูล'),
      numberedText(3, 'วิเคราะห์ข้อมูลปริมาณการใช้น้ำในช่วงต้นเดือนมิถุนายน เปรียบเทียบกับแผนที่วางไว้'),
      numberedText(4, 'ปรับปรุงระบบแสดงผลข้อมูลบน Dashboard ให้มีความสมบูรณ์ยิ่งขึ้น'),
      numberedText(5, 'นำส่งรายงานประจำเดือนพร้อมเอกสารที่เกี่ยวข้องต่อผู้บังคับบัญชาตามกำหนดเวลา'),

      // ============================================================
      // 6. สรุปผลและแผนพัฒนา
      // ============================================================
      new Paragraph({ children: [], pageBreakBefore: true }),
      heading1('6. สรุปผลลัพธ์และแผนพัฒนาต่อ'),

      heading2('6.1 สิ่งที่โครงการสำเร็จแล้ว'),
      bulletText('ระบบดึงข้อมูลอัตโนมัติ 4 ประเภท พร้อมใช้งาน'),
      bulletText('ฐานข้อมูล MySQL รองรับการบันทึกข้อมูลระยะยาว'),
      bulletText('แดชบอร์ดวิเคราะห์พร้อมกราฟ 4 รูปแบบต่อโมดูล'),
      bulletText('ระบบ AI วิเคราะห์สถานการณ์และให้คำแนะนำเชิงรุก'),
      bulletText('Fallback 3 ระดับ ป้องกันข้อมูลสูญหาย (Extension → Puppeteer → Excel)'),
      bulletText('Control Panel จัดการระบบได้โดยไม่ต้องเขียนโค้ด'),
      bulletText('ส่งออกรายงาน Excel ได้อัตโนมัติ'),
      bulletText('Backend UI สำหรับจัดการระบบรายงาน'),
      bulletText('รายงานเปรียบเทียบงบประมาณรายไตรมาส'),
      emptyLine(),

      heading2('6.2 แผนพัฒนาต่อในอนาคต'),
      numberedText(1, 'ระบบแจ้งเตือน LINE/Email เมื่อสถานการณ์วิกฤต'),
      numberedText(2, 'แผนที่แสดงตำแหน่งสถานีเฝ้าระวังแบบ GIS'),
      numberedText(3, 'เพิ่มโมดูลหมอกควันไฟป่า (อยู่ระหว่างการพัฒนา)'),
      numberedText(4, 'แอปพลิเคชันมือถือสำหรับผู้บริหาร'),
      numberedText(5, 'AI พยากรณ์ล่วงหน้า 7 วัน ด้วย Machine Learning'),
      numberedText(6, 'เชื่อมต่อ API กรมทรัพยากรน้ำและกรมชลประทาน'),
      numberedText(7, 'รายงานอัตโนมัติรายสัปดาห์/รายเดือนส่งผู้บริหาร'),
      numberedText(8, 'วิเคราะห์ NRW เชิงลึก + คาดการณ์ภัยแล้ง'),
      numberedText(9, 'เชื่อมต่อข้อมูลสาธารณสุข + ระบบ PM 2.5 Alert'),
      emptyLine(),

      heading2('6.3 ผลกระทบต่อประชาชน'),
      bodyText('ระบบนี้ช่วยให้ อบจ.ลำปาง สามารถรับรู้สถานการณ์ภัยพิบัติและปัญหาของประชาชนได้รวดเร็วขึ้น ตัดสินใจได้แม่นยำขึ้น และสามารถป้องกัน/ช่วยเหลือประชาชนได้ทันท่วงทีกว่าเดิม ข้อมูลที่เป็นระบบช่วยลดเวลาในการรวบรวมข้อมูลจากหลายชั่วโมงเหลือเพียงไม่กี่วินาที และช่วยให้ผู้บริหารมีเครื่องมือสนับสนุนการตัดสินใจที่ครบถ้วนและทันสมัย', { indent: true }),

      // ============================================================
      // ลงชื่อ
      // ============================================================
      emptyLine(),
      emptyLine(),
      emptyLine(),
      new Paragraph({
        children: [new TextRun({ text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', font: FONT_EN, size: 20, color: 'e2e8f0' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'ลงชื่อ ................................................ ผู้จัดทำ', font: FONT, size: 28 })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
      }),
      new Paragraph({
        children: [new TextRun({ text: '(นายภัคพล บุตติ)', font: FONT, size: 28, bold: true })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'ตำแหน่ง นักวิเคราะห์ข้อมูล', font: FONT, size: 28 })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'ฝ่ายกองยุทธศาสตร์และงบประมาณ', font: FONT, size: 28 })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'วันที่ ๔ มิถุนายน ๒๕๖๙', font: FONT, size: 28 })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
      }),
      emptyLine(),
      new Paragraph({
        children: [new TextRun({ text: 'ลงชื่อ ................................................ หัวหน้าฝ่าย/ผู้รับรอง', font: FONT, size: 28 })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
      }),
      new Paragraph({
        children: [new TextRun({ text: '(                                              )', font: FONT, size: 28 })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'หัวหน้าฝ่ายกองยุทธศาสตร์และงบประมาณ', font: FONT, size: 28 })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'วันที่ ........./........./..........', font: FONT, size: 28 })],
        alignment: AlignmentType.CENTER,
      }),
    ],
  }],
});

// ============================================================
// Save
// ============================================================
const buffer = await Packer.toBuffer(doc);
const outputPath = 'เอกสารสรุปสำหรับกรรมการ_ระบบบูรณาการข้อมูล_อบจลำปาง.docx';
fs.writeFileSync(outputPath, buffer);
console.log(`\n✅ สร้างเอกสาร Word สำเร็จ! บันทึกที่: ${outputPath}`);
console.log('   📂 เปิดไฟล์ด้วย Microsoft Word ได้เลย');
