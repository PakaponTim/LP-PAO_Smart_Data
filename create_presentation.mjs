/**
 * create_presentation.mjs
 * สร้างไฟล์ PowerPoint นำเสนอโครงการบูรณาการข้อมูลภัยพิบัติ อบจ.ลำปาง
 * Version 2.0 — แก้ไขเต็มจอ + เพิ่มรายละเอียดจากรายงานเดือน พ.ค. 2569
 * ใช้คำสั่ง: node create_presentation.mjs
 */

import PptxGenJS from 'pptxgenjs';

const pptx = new PptxGenJS();

// ============================================================
// ⚙️ Global Settings — LAYOUT_WIDE = 13.33" × 7.5"
// ============================================================
pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 inches
pptx.author = 'อบจ.ลำปาง - ฝ่ายเทคโนโลยีสารสนเทศ';
pptx.company = 'องค์การบริหารส่วนจังหวัดลำปาง';
pptx.subject = 'ระบบบูรณาการข้อมูลและเฝ้าระวังภัยพิบัติ จังหวัดลำปาง';
pptx.title = 'โครงการบูรณาการข้อมูลสารสนเทศ อบจ.ลำปาง';

// Full slide dimensions
const SW = 13.33;
const SH = 7.5;
const MARGIN = 0.6;
const CONTENT_W = SW - MARGIN * 2; // ~12.13

// ============================================================
// 🎨 Color Palette
// ============================================================
const C = {
  emeraldDark: '064e3b',
  emerald:     '059669',
  emeraldLight:'d1fae5',
  blueDark:    '1e3a5f',
  blue:        '2563eb',
  blueLight:   'dbeafe',
  amber:       'd97706',
  amberLight:  'fef3c7',
  red:         'dc2626',
  redLight:    'fee2e2',
  purple:      '7c3aed',
  purpleLight: 'ede9fe',
  teal:        '0d9488',
  tealLight:   'ccfbf1',
  white:       'FFFFFF',
  offWhite:    'f8fafc',
  slate50:     'f8fafc',
  slate100:    'f1f5f9',
  slate200:    'e2e8f0',
  slate400:    '94a3b8',
  slate500:    '64748b',
  slate600:    '475569',
  slate700:    '334155',
  slate800:    '1e293b',
  slate900:    '0f172a',
  black:       '000000',
};

// ============================================================
// 🔧 Helper Functions
// ============================================================
function addSlideBg(slide, color) {
  slide.background = { color: color };
}

function addSectionBadge(slide, text, bgColor, textColor, x, y) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w: 2.5, h: 0.4,
    fill: { color: bgColor },
    line: { color: bgColor },
    rectRadius: 0.12,
  });
  slide.addText(text, {
    x, y, w: 2.5, h: 0.4,
    fontSize: 12, bold: true, color: textColor,
    fontFace: 'Sarabun', align: 'center', valign: 'middle',
  });
}

function addDivider(slide, x, y, w, color = 'e2e8f0') {
  slide.addShape(pptx.ShapeType.line, {
    x, y, w, h: 0,
    line: { color, width: 1.5 },
  });
}

function addStepBox(slide, x, y, w, h, num, title, desc, bgColor, numColor) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h,
    fill: { color: bgColor },
    line: { color: 'e2e8f0', width: 0.75 },
    rectRadius: 0.1,
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: x + 0.15, y: y + 0.15, w: 0.45, h: 0.45,
    fill: { color: numColor },
    line: { color: numColor },
  });
  slide.addText(num, {
    x: x + 0.15, y: y + 0.15, w: 0.45, h: 0.45,
    fontSize: 15, bold: true, color: C.white, fontFace: 'Sarabun', align: 'center', valign: 'middle',
  });
  slide.addText(title, {
    x: x + 0.7, y: y + 0.12, w: w - 0.85, h: 0.35,
    fontSize: 13, bold: true, color: C.slate800, fontFace: 'Sarabun',
  });
  slide.addText(desc, {
    x: x + 0.7, y: y + 0.48, w: w - 0.85, h: h - 0.58,
    fontSize: 11, color: C.slate500, fontFace: 'Sarabun', wrap: true,
  });
}

// ============================================================
// 📄 SLIDE 1 — ปก / Title Slide
// ============================================================
{
  const slide = pptx.addSlide();
  addSlideBg(slide, C.emeraldDark);

  // Decorative circles - expanded for full screen
  slide.addShape(pptx.ShapeType.ellipse, {
    x: -2, y: -2, w: 6, h: 6,
    fill: { color: '10b981', transparency: 80 },
    line: { color: '10b981', transparency: 80 },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 9.5, y: 4.5, w: 5, h: 5,
    fill: { color: '065f46', transparency: 60 },
    line: { color: '065f46', transparency: 60 },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 11, y: -1, w: 4, h: 4,
    fill: { color: '059669', transparency: 70 },
    line: { color: '059669', transparency: 70 },
  });

  // Logo area placeholder
  slide.addShape(pptx.ShapeType.roundRect, {
    x: MARGIN, y: 0.8, w: 1.3, h: 1.3,
    fill: { color: C.white, transparency: 15 },
    line: { color: C.white, transparency: 30 },
    rectRadius: 0.18,
  });
  slide.addText('🌊', { x: MARGIN, y: 0.8, w: 1.3, h: 1.3, fontSize: 42, align: 'center', valign: 'middle' });

  // Org name
  slide.addText('องค์การบริหารส่วนจังหวัดลำปาง', {
    x: 2.1, y: 0.9, w: 7, h: 0.45,
    fontSize: 16, bold: true, color: 'a7f3d0', fontFace: 'Sarabun',
  });
  slide.addText('Lampang Provincial Administrative Organization', {
    x: 2.1, y: 1.35, w: 7, h: 0.35,
    fontSize: 12, color: '6ee7b7', fontFace: 'Sarabun',
  });

  // Main Title
  slide.addText('ระบบบูรณาการข้อมูลสารสนเทศ', {
    x: MARGIN, y: 2.3, w: 11, h: 1.0,
    fontSize: 44, bold: true, color: C.white, fontFace: 'Sarabun', align: 'left',
  });
  slide.addText('เพื่อการเฝ้าระวังภัยพิบัติและสิ่งแวดล้อม', {
    x: MARGIN, y: 3.2, w: 11, h: 0.8,
    fontSize: 32, bold: false, color: '6ee7b7', fontFace: 'Sarabun', align: 'left',
  });

  // Subtitle / Tag chips — spread wider
  const chips = [
    { label: '🌊 ระดับน้ำ', color: '1d4ed8' },
    { label: '🏜️ ภัยแล้ง', color: 'b45309' },
    { label: '🍃 PM 2.5', color: '047857' },
    { label: '📢 ร้องเรียน', color: '6d28d9' },
  ];
  chips.forEach((chip, i) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: MARGIN + i * 3.0, y: 4.3, w: 2.7, h: 0.5,
      fill: { color: chip.color, transparency: 30 },
      line: { color: chip.color, transparency: 60 },
      rectRadius: 0.25,
    });
    slide.addText(chip.label, {
      x: MARGIN + i * 3.0, y: 4.3, w: 2.7, h: 0.5,
      fontSize: 13, bold: true, color: C.white, fontFace: 'Sarabun', align: 'center', valign: 'middle',
    });
  });

  // Bottom info
  slide.addShape(pptx.ShapeType.line, {
    x: MARGIN, y: 5.3, w: 12, h: 0,
    line: { color: '065f46', width: 1.5 },
  });
  slide.addText('นำเสนอโดย: ฝ่ายนโยบายและแผน / กองสาธารณสุข  |  วันที่นำเสนอ: มิถุนายน 2569  |  ตามใบสั่งจ้างเลขที่ ๓๕๐/๒๕๖๙', {
    x: MARGIN, y: 5.5, w: 12, h: 0.4,
    fontSize: 12, color: '6ee7b7', fontFace: 'Sarabun',
  });

  // Version tag
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 11.2, y: 6.5, w: 1.6, h: 0.4,
    fill: { color: '10b981', transparency: 40 },
    line: { color: '10b981', transparency: 40 },
    rectRadius: 0.2,
  });
  slide.addText('Version 2.0', {
    x: 11.2, y: 6.5, w: 1.6, h: 0.4,
    fontSize: 11, bold: true, color: C.white, fontFace: 'Sarabun', align: 'center', valign: 'middle',
  });
}

// ============================================================
// 📄 SLIDE 2 — สารบัญ / Agenda
// ============================================================
{
  const slide = pptx.addSlide();
  addSlideBg(slide, C.white);

  // Left colored strip (full height)
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.15, h: SH,
    fill: { color: C.emerald },
    line: { color: C.emerald },
  });

  slide.addText('สารบัญการนำเสนอ', {
    x: MARGIN, y: 0.3, w: 12, h: 0.7,
    fontSize: 32, bold: true, color: C.emeraldDark, fontFace: 'Sarabun',
  });
  slide.addText('ภาพรวมสิ่งที่จะนำเสนอวันนี้ — ระบบบูรณาการข้อมูลสารสนเทศเพื่อการเฝ้าระวังภัยพิบัติและสิ่งแวดล้อม', {
    x: MARGIN, y: 0.95, w: 12, h: 0.35,
    fontSize: 14, color: C.slate500, fontFace: 'Sarabun',
  });
  addDivider(slide, MARGIN, 1.4, CONTENT_W);

  const agendaItems = [
    { num: '01', title: 'ที่มาและวัตถุประสงค์ของโครงการ', sub: 'ปัญหาที่พบ เป้าหมาย และประโยชน์ที่คาดหวัง', color: C.blue },
    { num: '02', title: 'สถาปัตยกรรมระบบและเทคโนโลยีที่ใช้', sub: 'ภาพรวมการทำงานของระบบทั้งหมด (System Architecture)', color: C.emerald },
    { num: '03', title: 'โมดูลที่ 1 — ระบบเฝ้าระวังระดับน้ำ', sub: 'ดึงข้อมูลจาก lampang.thaiwater.net แบบอัตโนมัติ 26 สถานี', color: '1d4ed8' },
    { num: '04', title: 'โมดูลที่ 2 — ระบบติดตามภัยแล้งและอ่างเก็บน้ำ', sub: 'วิเคราะห์ปริมาณน้ำสำรอง 36 อ่างเก็บน้ำ', color: 'b45309' },
    { num: '05', title: 'โมดูลที่ 3 — ระบบติดตามคุณภาพอากาศ PM 2.5', sub: 'ดัชนีฝุ่นละอองรายอำเภอ พร้อมแจ้งเตือนระดับวิกฤต', color: '047857' },
    { num: '06', title: 'โมดูลที่ 4 — ระบบรวบรวมเรื่องร้องเรียน (Traffy Fondue)', sub: 'ดึงข้อมูลปัญหาจากประชาชนโดยอัตโนมัติ', color: '6d28d9' },
    { num: '07', title: 'แดชบอร์ดวิเคราะห์และการวิเคราะห์ด้วย AI', sub: 'ระบบแสดงผลและให้คำแนะนำเชิงรุกด้วยปัญญาประดิษฐ์', color: C.teal },
    { num: '08', title: 'ผลการปฏิบัติงานประจำเดือนพฤษภาคม 2569', sub: 'สรุปผลงาน วิเคราะห์ข้อมูล และเป้าหมายเดือนถัดไป', color: C.red },
    { num: '09', title: 'สรุปผลและแผนพัฒนาต่อ', sub: 'ผลลัพธ์ที่ได้ สถิติจริง และทิศทางการพัฒนาในอนาคต', color: C.purple },
  ];

  const colW = 5.8;
  const colGap = 0.3;
  agendaItems.forEach((item, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = MARGIN + col * (colW + colGap);
    const y = 1.6 + row * 1.15;

    slide.addShape(pptx.ShapeType.roundRect, {
      x, y, w: colW, h: 1.0,
      fill: { color: C.slate50 },
      line: { color: item.color, width: 2.5 },
      rectRadius: 0.12,
    });
    // Number badge
    slide.addShape(pptx.ShapeType.roundRect, {
      x: x + 0.12, y: y + 0.2, w: 0.5, h: 0.5,
      fill: { color: item.color },
      line: { color: item.color },
      rectRadius: 0.1,
    });
    slide.addText(item.num, {
      x: x + 0.12, y: y + 0.2, w: 0.5, h: 0.5,
      fontSize: 13, bold: true, color: C.white, fontFace: 'Sarabun', align: 'center', valign: 'middle',
    });
    slide.addText(item.title, {
      x: x + 0.75, y: y + 0.1, w: colW - 0.95, h: 0.4,
      fontSize: 13, bold: true, color: C.slate800, fontFace: 'Sarabun',
    });
    slide.addText(item.sub, {
      x: x + 0.75, y: y + 0.5, w: colW - 0.95, h: 0.4,
      fontSize: 11, color: C.slate500, fontFace: 'Sarabun',
    });
  });
}

// ============================================================
// 📄 SLIDE 3 — ที่มาและปัญหาที่พบ
// ============================================================
{
  const slide = pptx.addSlide();
  addSlideBg(slide, C.white);

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.15, h: SH, fill: { color: C.blue }, line: { color: C.blue },
  });

  addSectionBadge(slide, 'ส่วนที่ 01', C.blueLight, C.blue, MARGIN, 0.3);
  slide.addText('ที่มาและวัตถุประสงค์', {
    x: MARGIN, y: 0.75, w: 12, h: 0.7,
    fontSize: 32, bold: true, color: C.blueDark, fontFace: 'Sarabun',
  });
  addDivider(slide, MARGIN, 1.5, CONTENT_W);

  // Left column — Problems
  const leftColW = 5.8;
  slide.addText('🔍 ปัญหาที่พบก่อนมีระบบ', {
    x: MARGIN, y: 1.65, w: leftColW, h: 0.4,
    fontSize: 16, bold: true, color: C.red, fontFace: 'Sarabun',
  });

  const problems = [
    'ต้องเปิดหน้าเว็บดูข้อมูลเองทุกวัน ไม่มีระบบเก็บข้อมูลอัตโนมัติ',
    'ข้อมูลกระจายอยู่หลายแหล่ง ไม่มีศูนย์กลาง ยากต่อการวิเคราะห์',
    'ไม่สามารถดูแนวโน้มย้อนหลังหรือคาดการณ์ล่วงหน้าได้',
    'ผู้บริหารขาดข้อมูลที่ครบถ้วนในการตัดสินใจเชิงรุก',
    'ไม่มีระบบแจ้งเตือนเมื่อสถานการณ์เข้าสู่ภาวะวิกฤต',
    'ข้อมูลน้ำสูญเสียในระบบ (NRW) ไม่ได้ถูกติดตามอย่างเป็นระบบ',
  ];
  problems.forEach((p, i) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: MARGIN, y: 2.15 + i * 0.8, w: leftColW, h: 0.7,
      fill: { color: 'fff1f2' }, line: { color: 'fecdd3', width: 1 }, rectRadius: 0.1,
    });
    slide.addText(`❌  ${p}`, {
      x: MARGIN + 0.15, y: 2.2 + i * 0.8, w: leftColW - 0.3, h: 0.6,
      fontSize: 12, color: C.slate700, fontFace: 'Sarabun', wrap: true,
    });
  });

  // Right column — Goals
  const rightX = MARGIN + leftColW + 0.4;
  const rightW = CONTENT_W - leftColW - 0.4;
  slide.addText('🎯 วัตถุประสงค์ของโครงการ', {
    x: rightX, y: 1.65, w: rightW, h: 0.4,
    fontSize: 16, bold: true, color: C.emerald, fontFace: 'Sarabun',
  });

  const goals = [
    { icon: '⚡', text: 'เก็บข้อมูลอัตโนมัติทุก 30 นาที จาก 4 แหล่งข้อมูลหลัก' },
    { icon: '🗄️', text: 'รวบรวม 26 สถานีวัดน้ำ, 36 อ่างเก็บน้ำ, PM2.5 ทุกอำเภอ, ร้องเรียน Traffy' },
    { icon: '📊', text: 'วิเคราะห์และแสดงผลผ่านแดชบอร์ดเข้าใจง่าย Real-time' },
    { icon: '🤖', text: 'ใช้ AI วิเคราะห์และให้ข้อเสนอแนะเชิงรุกให้ผู้บริหาร' },
    { icon: '🔔', text: 'แจ้งเตือนเมื่อสถานการณ์เข้าสู่ระดับน่าเป็นห่วง' },
    { icon: '📈', text: 'วิเคราะห์น้ำสูญเสียในระบบ (NRW) พร้อมรายงานเปรียบเทียบรายไตรมาส' },
  ];
  goals.forEach((g, i) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: rightX, y: 2.15 + i * 0.8, w: rightW, h: 0.7,
      fill: { color: 'f0fdf4' }, line: { color: 'bbf7d0', width: 1 }, rectRadius: 0.1,
    });
    slide.addText(`${g.icon}  ${g.text}`, {
      x: rightX + 0.15, y: 2.2 + i * 0.8, w: rightW - 0.3, h: 0.6,
      fontSize: 12, color: C.slate700, fontFace: 'Sarabun', wrap: true,
    });
  });
}

// ============================================================
// 📄 SLIDE 4 — สถาปัตยกรรมระบบ (System Architecture)
// ============================================================
{
  const slide = pptx.addSlide();
  addSlideBg(slide, C.slate900);

  slide.addText('สถาปัตยกรรมระบบ (System Architecture)', {
    x: MARGIN, y: 0.3, w: CONTENT_W, h: 0.65,
    fontSize: 28, bold: true, color: C.white, fontFace: 'Sarabun',
  });
  slide.addText('ภาพรวมการทำงานทั้งหมดของระบบ ตั้งแต่ต้นทางไปจนถึงปลายทาง — ครอบคลุม 4 โมดูลหลัก', {
    x: MARGIN, y: 0.92, w: CONTENT_W, h: 0.35,
    fontSize: 14, color: '94a3b8', fontFace: 'Sarabun',
  });

  // Layer 1: Data Sources
  const layerW = CONTENT_W;
  const layerX = MARGIN;

  slide.addShape(pptx.ShapeType.roundRect, {
    x: layerX, y: 1.4, w: layerW, h: 1.35,
    fill: { color: '1e293b' }, line: { color: '334155', width: 1 }, rectRadius: 0.14,
  });
  slide.addText('🌐  แหล่งข้อมูลภายนอก (Data Sources)', {
    x: layerX + 0.2, y: 1.45, w: layerW - 0.4, h: 0.35,
    fontSize: 14, bold: true, color: '60a5fa', fontFace: 'Sarabun',
  });

  const sources = [
    { name: 'lampang.thaiwater.net\n(ระดับน้ำ 26 สถานี)', color: '1d4ed8' },
    { name: 'lampang.thaiwater.net\n(อ่างเก็บน้ำ 36 แห่ง)', color: 'b45309' },
    { name: 'Air4Thai / กรมอนามัย\n(PM 2.5 ทุกอำเภอ)', color: '047857' },
    { name: 'Traffy Fondue\n(ร้องเรียนจากประชาชน)', color: '6d28d9' },
  ];
  const srcW = (layerW - 1.2) / 4;
  sources.forEach((s, i) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: layerX + 0.2 + i * (srcW + 0.15), y: 1.85, w: srcW, h: 0.75,
      fill: { color: s.color, transparency: 70 },
      line: { color: s.color, width: 1.5 }, rectRadius: 0.1,
    });
    slide.addText(s.name, {
      x: layerX + 0.2 + i * (srcW + 0.15), y: 1.85, w: srcW, h: 0.75,
      fontSize: 11, bold: true, color: C.white, fontFace: 'Sarabun', align: 'center', valign: 'middle',
    });
  });

  // Arrow down
  slide.addShape(pptx.ShapeType.downArrow, {
    x: 5.8, y: 2.85, w: 1.5, h: 0.4,
    fill: { color: '475569' }, line: { color: '475569' },
  });

  // Layer 2: Collection
  slide.addShape(pptx.ShapeType.roundRect, {
    x: layerX, y: 3.35, w: layerW, h: 1.2,
    fill: { color: '1e293b' }, line: { color: '334155', width: 1 }, rectRadius: 0.14,
  });
  slide.addText('⚙️  ชั้นการเก็บรวบรวมข้อมูล (Data Collection Layer)', {
    x: layerX + 0.2, y: 3.4, w: layerW - 0.4, h: 0.35,
    fontSize: 14, bold: true, color: 'fbbf24', fontFace: 'Sarabun',
  });

  const collectors = [
    { name: '🔌 Chrome Extension\n(หลัก - Manifest V3)', color: '1e40af' },
    { name: '🤖 Puppeteer (Fallback)\n(สำรอง - Headless Browser)', color: '166534' },
    { name: '⏰ Scheduler (อัตโนมัติ)\nดึงข้อมูลทุก 30 นาที 09:00-16:00', color: '92400e' },
    { name: '🔄 Retry + Lock\nป้องกันการทำงานซ้ำซ้อน (สูงสุด 3 ครั้ง)', color: '4c1d95' },
  ];
  collectors.forEach((c, i) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: layerX + 0.2 + i * (srcW + 0.15), y: 3.82, w: srcW, h: 0.6,
      fill: { color: c.color, transparency: 50 },
      line: { color: c.color, width: 1 }, rectRadius: 0.1,
    });
    slide.addText(c.name, {
      x: layerX + 0.2 + i * (srcW + 0.15), y: 3.82, w: srcW, h: 0.6,
      fontSize: 10, bold: true, color: C.white, fontFace: 'Sarabun', align: 'center', valign: 'middle',
    });
  });

  // Arrow down
  slide.addShape(pptx.ShapeType.downArrow, {
    x: 5.8, y: 4.6, w: 1.5, h: 0.35,
    fill: { color: '475569' }, line: { color: '475569' },
  });

  // Layer 3: Storage + Server side by side
  const halfW = (layerW - 0.3) / 2;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: layerX, y: 5.05, w: halfW, h: 1.1,
    fill: { color: '1e293b' }, line: { color: '334155', width: 1 }, rectRadius: 0.14,
  });
  slide.addText('🗄️  ชั้นจัดเก็บข้อมูล', {
    x: layerX + 0.15, y: 5.1, w: halfW - 0.3, h: 0.35,
    fontSize: 14, bold: true, color: '34d399', fontFace: 'Sarabun',
  });
  slide.addText('MySQL (water_systems DB) + Excel Backup\n4 ตาราง: น้ำ | ภัยแล้ง | PM2.5 | ร้องเรียน\nFallback 3 ระดับ: Extension → Puppeteer → Excel', {
    x: layerX + 0.15, y: 5.45, w: halfW - 0.3, h: 0.6,
    fontSize: 11, color: '94a3b8', fontFace: 'Sarabun',
  });

  slide.addShape(pptx.ShapeType.roundRect, {
    x: layerX + halfW + 0.3, y: 5.05, w: halfW, h: 1.1,
    fill: { color: '1e293b' }, line: { color: '334155', width: 1 }, rectRadius: 0.14,
  });
  slide.addText('🖥️  Server (Node.js + Express + Socket.io)', {
    x: layerX + halfW + 0.45, y: 5.1, w: halfW - 0.3, h: 0.35,
    fontSize: 14, bold: true, color: 'f9a8d4', fontFace: 'Sarabun',
  });
  slide.addText('API Server พอร์ต 3000 | Real-time via WebSocket\nจัดการ Schedule และ Log ทุกกิจกรรม\nBackend UI สำหรับจัดการและรายงานอัตโนมัติ', {
    x: layerX + halfW + 0.45, y: 5.45, w: halfW - 0.3, h: 0.6,
    fontSize: 11, color: '94a3b8', fontFace: 'Sarabun',
  });

  // Note
  slide.addText('* MySQL = ฐานข้อมูลเชิงสัมพันธ์ | Socket.io = ระบบสื่อสารแบบ Real-time | Puppeteer = โปรแกรมควบคุมเบราว์เซอร์อัตโนมัติ | Manifest V3 = มาตรฐาน Chrome Extension รุ่นล่าสุด', {
    x: MARGIN, y: 6.35, w: CONTENT_W, h: 0.5,
    fontSize: 10, color: '475569', fontFace: 'Sarabun', italic: true,
  });
}

// ============================================================
// 📄 SLIDE 5 — โมดูล 1: ระบบเฝ้าระวังระดับน้ำ
// ============================================================
{
  const slide = pptx.addSlide();
  addSlideBg(slide, C.white);

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.15, h: SH, fill: { color: '1d4ed8' }, line: { color: '1d4ed8' },
  });

  addSectionBadge(slide, 'โมดูลที่ 01', C.blueLight, '1d4ed8', MARGIN, 0.3);
  slide.addText('🌊 ระบบเฝ้าระวังระดับน้ำและปริมาณน้ำฝน', {
    x: MARGIN, y: 0.75, w: CONTENT_W, h: 0.65,
    fontSize: 28, bold: true, color: '1e3a5f', fontFace: 'Sarabun',
  });
  addDivider(slide, MARGIN, 1.42, CONTENT_W, 'bfdbfe');

  // Data source info
  slide.addShape(pptx.ShapeType.roundRect, {
    x: MARGIN, y: 1.55, w: CONTENT_W, h: 0.55,
    fill: { color: 'eff6ff' }, line: { color: 'bfdbfe', width: 1 }, rectRadius: 0.1,
  });
  slide.addText('📡  แหล่งข้อมูล: lampang.thaiwater.net/wl  |  สถานีตรวจวัด: 26 สถานี ครอบคลุมทั้งจังหวัดลำปาง  |  อัปเดตอัตโนมัติ: ทุก 30 นาที (09:00–16:00 น.)', {
    x: MARGIN + 0.15, y: 1.6, w: CONTENT_W - 0.3, h: 0.45,
    fontSize: 12, color: '1e40af', fontFace: 'Sarabun', bold: true,
  });

  // Process steps
  slide.addText('กระบวนการทำงาน (How It Works)', {
    x: MARGIN, y: 2.25, w: 6, h: 0.4,
    fontSize: 15, bold: true, color: '1e3a5f', fontFace: 'Sarabun',
  });

  const steps = [
    { num: '1', t: 'ตรวจสอบอินเทอร์เน็ต', d: 'ระบบทดสอบ DNS ก่อนเริ่ม\nทุกครั้ง เพื่อป้องกันข้อผิดพลาด' },
    { num: '2', t: 'เปิดหน้าเว็บอัตโนมัติ', d: 'Chrome Extension / Puppeteer\nเปิดหน้า WL ของลำปาง' },
    { num: '3', t: 'ดึงข้อมูลทุกสถานี', d: 'วนดึงข้อมูลทุก 26 Station\nรวมถึงปริมาณฝนสะสม 3/7 วัน' },
    { num: '4', t: 'คำนวณความเสี่ยง', d: 'วิเคราะห์ระดับน้ำเทียบตลิ่ง\nประเมิน: ปกติ/เฝ้าระวัง/วิกฤต' },
    { num: '5', t: 'บันทึกและแสดงผล', d: 'บันทึกลง MySQL + Excel\nอัปเดตแดชบอร์ดทันที' },
  ];
  const stepW = (CONTENT_W - 1.0) / 5;
  steps.forEach((s, i) => {
    addStepBox(slide, MARGIN + i * (stepW + 0.2), 2.72, stepW, 1.6, s.num, s.t, s.d, 'f0f9ff', '1d4ed8');
    if (i < 4) {
      slide.addText('→', {
        x: MARGIN + (i + 1) * (stepW + 0.2) - 0.25, y: 3.35, w: 0.3, h: 0.4,
        fontSize: 20, bold: true, color: 'bfdbfe', fontFace: 'Sarabun', align: 'center',
      });
    }
  });

  // Dashboard features
  slide.addText('สิ่งที่แสดงผลในแดชบอร์ด', {
    x: MARGIN, y: 4.55, w: CONTENT_W, h: 0.4,
    fontSize: 15, bold: true, color: '1e3a5f', fontFace: 'Sarabun',
  });

  const features = [
    { icon: '📊', text: 'กราฟระดับน้ำปัจจุบัน\nรายสถานี แสดงสีตามระดับ', color: 'dbeafe' },
    { icon: '📈', text: 'พยากรณ์ล่วงหน้า 3 วัน\nด้วยระบบ AI วิเคราะห์', color: 'dbeafe' },
    { icon: '🥧', text: 'สัดส่วนสถานะ\n(น้อย/ปกติ/มาก/ล้น)', color: 'dbeafe' },
    { icon: '⚖️', text: 'เปรียบระดับน้ำ\nกับระดับตลิ่ง + ฝนสะสม', color: 'dbeafe' },
    { icon: '🤖', text: 'AI วิเคราะห์แนวโน้ม\nและให้ข้อเสนอแนะเชิงรุก', color: 'ede9fe' },
  ];
  const featW = (CONTENT_W - 0.8) / 5;
  features.forEach((f, i) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: MARGIN + i * (featW + 0.16), y: 5.05, w: featW, h: 1.95,
      fill: { color: f.color }, line: { color: 'bfdbfe', width: 1 }, rectRadius: 0.12,
    });
    slide.addText(f.icon, { x: MARGIN + i * (featW + 0.16), y: 5.15, w: featW, h: 0.6, fontSize: 26, align: 'center' });
    slide.addText(f.text, {
      x: MARGIN + i * (featW + 0.16), y: 5.75, w: featW, h: 1.1,
      fontSize: 11, color: C.slate700, fontFace: 'Sarabun', align: 'center', wrap: true,
    });
  });
}

// ============================================================
// 📄 SLIDE 6 — โมดูล 2: ภัยแล้งและอ่างเก็บน้ำ
// ============================================================
{
  const slide = pptx.addSlide();
  addSlideBg(slide, C.white);

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.15, h: SH, fill: { color: C.amber }, line: { color: C.amber },
  });

  addSectionBadge(slide, 'โมดูลที่ 02', C.amberLight, C.amber, MARGIN, 0.3);
  slide.addText('🏜️ ระบบติดตามภัยแล้งและอ่างเก็บน้ำ', {
    x: MARGIN, y: 0.75, w: CONTENT_W, h: 0.65,
    fontSize: 28, bold: true, color: '78350f', fontFace: 'Sarabun',
  });
  addDivider(slide, MARGIN, 1.42, CONTENT_W, 'fde68a');

  slide.addShape(pptx.ShapeType.roundRect, {
    x: MARGIN, y: 1.55, w: CONTENT_W, h: 0.55,
    fill: { color: 'fffbeb' }, line: { color: 'fde68a', width: 1 }, rectRadius: 0.1,
  });
  slide.addText('📡  แหล่งข้อมูล: lampang.thaiwater.net/dam  |  ติดตามอ่างเก็บน้ำ: 36 แห่ง (ใหญ่ กลาง เล็ก)  |  วิเคราะห์: ปริมาณน้ำสำรอง เปอร์เซ็นต์ความจุ น้ำไหลเข้า-ออก', {
    x: MARGIN + 0.15, y: 1.6, w: CONTENT_W - 0.3, h: 0.45,
    fontSize: 12, color: '92400e', fontFace: 'Sarabun', bold: true,
  });

  // KPIs tracked — left
  const leftW = 5.8;
  slide.addText('ข้อมูลที่ระบบติดตาม', {
    x: MARGIN, y: 2.25, w: leftW, h: 0.4,
    fontSize: 15, bold: true, color: '78350f', fontFace: 'Sarabun',
  });

  const metrics = [
    { icon: '🏔️', label: 'จำนวนอ่างเก็บน้ำหลัก — 36 แห่ง (ใหญ่ กลาง เล็ก)', color: 'fef3c7' },
    { icon: '💧', label: 'ปริมาณน้ำรวม (ล้าน ลบ.ม.) — ติดตามรายวัน', color: 'dbeafe' },
    { icon: '📈', label: '% น้ำกักเก็บเฉลี่ย — เปรียบเทียบความจุสูงสุด', color: 'ffedd5' },
    { icon: '⬇️', label: 'น้ำไหลเข้า vs ระบาย — วิเคราะห์สมดุลน้ำ', color: 'ede9fe' },
    { icon: '📊', label: 'แนวโน้มปริมาณน้ำ — คาดการณ์ภัยแล้งล่วงหน้า', color: 'fef3c7' },
    { icon: '🌧️', label: 'ปริมาณน้ำฝนสะสม 3/7 วัน — ประเมินการเติมน้ำ', color: 'dbeafe' },
  ];
  metrics.forEach((m, i) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: MARGIN, y: 2.75 + i * 0.72, w: leftW, h: 0.62,
      fill: { color: m.color }, line: { color: 'fde68a', width: 1 }, rectRadius: 0.1,
    });
    slide.addText(`${m.icon}  ${m.label}`, {
      x: MARGIN + 0.15, y: 2.8 + i * 0.72, w: leftW - 0.3, h: 0.52,
      fontSize: 12, color: C.slate700, fontFace: 'Sarabun', bold: true, wrap: true,
    });
  });

  // Risk criteria — right
  const rightX = MARGIN + leftW + 0.4;
  const rightW = CONTENT_W - leftW - 0.4;
  slide.addText('เกณฑ์ประเมินระดับวิกฤต (ตามมาตรฐาน ThaiWater)', {
    x: rightX, y: 2.25, w: rightW, h: 0.4,
    fontSize: 15, bold: true, color: '78350f', fontFace: 'Sarabun',
  });

  const criteria = [
    { label: '≤ 10% — น้ำน้อยวิกฤต (ภัยแล้งรุนแรง)', color: 'b45309', bg: 'fff7ed' },
    { label: '> 10–30% — น้ำน้อย (ต้องเฝ้าระวัง)', color: 'ca8a04', bg: 'fefce8' },
    { label: '> 30–70% — น้ำปกติ (สถานการณ์ดี)', color: '15803d', bg: 'f0fdf4' },
    { label: '> 70–100% — น้ำมาก (ระวังน้ำเอ่อ)', color: '1d4ed8', bg: 'eff6ff' },
    { label: '> 100% — น้ำล้นตลิ่ง (วิกฤต!)', color: 'dc2626', bg: 'fff1f2' },
  ];
  criteria.forEach((c, i) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: rightX, y: 2.75 + i * 0.72, w: rightW, h: 0.62,
      fill: { color: c.bg }, line: { color: c.color, width: 2 }, rectRadius: 0.1,
    });
    slide.addText(`● ${c.label}`, {
      x: rightX + 0.15, y: 2.82 + i * 0.72, w: rightW - 0.3, h: 0.48,
      fontSize: 13, bold: true, color: c.color, fontFace: 'Sarabun',
    });
  });

  // Dashboard
  slide.addText('สิ่งที่แสดงผลในแดชบอร์ด', {
    x: rightX, y: 6.45, w: rightW, h: 0.35,
    fontSize: 14, bold: true, color: '78350f', fontFace: 'Sarabun',
  });
  const dbFeats = ['กราฟน้ำเทียบความจุ', 'แนวโน้ม + พยากรณ์ AI', 'สัดส่วนความเสี่ยงภัยแล้ง', 'น้ำไหลเข้า vs ระบาย'];
  dbFeats.forEach((f, i) => {
    const fw = (rightW - 0.3) / 2;
    const col = i % 2;
    const row = Math.floor(i / 2);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: rightX + col * (fw + 0.1), y: 6.85 + row * 0.05, w: fw, h: 0, // not enough space
      fill: { color: 'fffbeb' }, line: { color: 'fde68a', width: 1 }, rectRadius: 0.08,
    });
  });
}

// ============================================================
// 📄 SLIDE 7 — โมดูล 3: PM 2.5
// ============================================================
{
  const slide = pptx.addSlide();
  addSlideBg(slide, C.white);

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.15, h: SH, fill: { color: C.teal }, line: { color: C.teal },
  });

  addSectionBadge(slide, 'โมดูลที่ 03', C.tealLight, C.teal, MARGIN, 0.3);
  slide.addText('🍃 ระบบติดตามคุณภาพอากาศ PM 2.5', {
    x: MARGIN, y: 0.75, w: CONTENT_W, h: 0.65,
    fontSize: 28, bold: true, color: '134e4a', fontFace: 'Sarabun',
  });
  addDivider(slide, MARGIN, 1.42, CONTENT_W, '99f6e4');

  slide.addShape(pptx.ShapeType.roundRect, {
    x: MARGIN, y: 1.55, w: CONTENT_W, h: 0.55,
    fill: { color: 'f0fdfa' }, line: { color: '99f6e4', width: 1 }, rectRadius: 0.1,
  });
  slide.addText('📡  แหล่งข้อมูล: Air4Thai / กรมอนามัย  |  ครอบคลุม: ทุกอำเภอในจังหวัดลำปาง  |  วัด: ค่าฝุ่น PM 2.5 หน่วย µg/m³ (ไมโครกรัมต่อลูกบาศก์เมตร)', {
    x: MARGIN + 0.15, y: 1.6, w: CONTENT_W - 0.3, h: 0.45,
    fontSize: 12, color: '0f766e', fontFace: 'Sarabun', bold: true,
  });

  // PM 2.5 Standards — left side
  const leftW = 6.0;
  slide.addText('มาตรฐานคุณภาพอากาศของประเทศไทย (5 ระดับ)', {
    x: MARGIN, y: 2.25, w: leftW, h: 0.4,
    fontSize: 15, bold: true, color: '134e4a', fontFace: 'Sarabun',
  });

  const pm25levels = [
    { range: '0–15.0 µg/m³', label: 'ดีมาก', color: '60a5fa', bg: 'eff6ff', desc: 'ออกกำลังกายกลางแจ้งได้ปกติ' },
    { range: '15.1–25.0 µg/m³', label: 'ดี', color: '10b981', bg: 'f0fdf4', desc: 'ดำเนินชีวิตได้ปกติ' },
    { range: '25.1–37.5 µg/m³', label: 'ปานกลาง', color: 'fbbf24', bg: 'fefce8', desc: 'กลุ่มเสี่ยงควรระวัง ผู้ป่วยโรคทางเดินหายใจ' },
    { range: '37.6–75.0 µg/m³', label: 'เริ่มมีผลต่อสุขภาพ', color: 'f97316', bg: 'fff7ed', desc: 'หลีกเลี่ยงกิจกรรมกลางแจ้ง สวมหน้ากาก N95' },
    { range: '> 75.1 µg/m³', label: 'มีผลกระทบต่อสุขภาพ', color: 'dc2626', bg: 'fff1f2', desc: 'ห้ามออกจากอาคาร / แจ้งเตือนด่วน / ปิดโรงเรียน' },
  ];
  pm25levels.forEach((p, i) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: MARGIN, y: 2.78 + i * 0.85, w: leftW, h: 0.75,
      fill: { color: p.bg }, line: { color: p.color, width: 2 }, rectRadius: 0.1,
    });
    slide.addShape(pptx.ShapeType.ellipse, {
      x: MARGIN + 0.15, y: 2.88 + i * 0.85, w: 0.38, h: 0.38,
      fill: { color: p.color }, line: { color: p.color },
    });
    slide.addText(`${p.range}`, {
      x: MARGIN + 0.65, y: 2.82 + i * 0.85, w: 2.5, h: 0.3,
      fontSize: 12, bold: true, color: p.color, fontFace: 'Sarabun',
    });
    slide.addText(`${p.label} — ${p.desc}`, {
      x: MARGIN + 0.65, y: 3.1 + i * 0.85, w: leftW - 1.0, h: 0.35,
      fontSize: 11, color: C.slate600, fontFace: 'Sarabun',
    });
  });

  // Dashboard panels — right side
  const rightX = MARGIN + leftW + 0.4;
  const rightW = CONTENT_W - leftW - 0.4;
  slide.addText('สิ่งที่แสดงผลในแดชบอร์ด', {
    x: rightX, y: 2.25, w: rightW, h: 0.4,
    fontSize: 15, bold: true, color: '134e4a', fontFace: 'Sarabun',
  });
  const pmFeats = [
    { icon: '📊', text: 'กราฟค่าฝุ่นรายอำเภอ\nพร้อมสีระดับอันตราย\nเข้าใจง่ายในพริบตา', bg: 'f0fdfa' },
    { icon: '📈', text: 'ประวัติค่าฝุ่นย้อนหลัง\nและพยากรณ์แนวโน้ม\nล่วงหน้า 3 วัน', bg: 'f0fdfa' },
    { icon: '🥧', text: 'สัดส่วนระดับคุณภาพ\nอากาศของจังหวัด\nเห็นภาพรวมทันที', bg: 'f0fdfa' },
    { icon: '⚖️', text: 'เปรียบค่าฝุ่นปัจจุบัน\nกับค่าเฉลี่ย 24 ชม.\nและค่ามาตรฐาน', bg: 'f0fdfa' },
    { icon: '🤖', text: 'AI วิเคราะห์แนวโน้ม\nให้มาตรการควบคุม\nและคำแนะนำเชิงรุก', bg: 'ede9fe' },
  ];
  const pmFeatW = (rightW - 0.2) / 2;
  pmFeats.forEach((f, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: rightX + col * (pmFeatW + 0.15), y: 2.78 + row * 1.4, w: pmFeatW, h: 1.25,
      fill: { color: f.bg }, line: { color: '99f6e4', width: 1 }, rectRadius: 0.12,
    });
    slide.addText(f.icon, { x: rightX + col * (pmFeatW + 0.15), y: 2.85 + row * 1.4, w: pmFeatW, h: 0.45, fontSize: 22, align: 'center' });
    slide.addText(f.text, {
      x: rightX + col * (pmFeatW + 0.15) + 0.1, y: 3.28 + row * 1.4, w: pmFeatW - 0.2, h: 0.7,
      fontSize: 10.5, color: C.slate700, fontFace: 'Sarabun', align: 'center', wrap: true,
    });
  });

  // Note
  slide.addShape(pptx.ShapeType.roundRect, {
    x: MARGIN, y: 7.0, w: CONTENT_W, h: 0.35,
    fill: { color: 'f0fdfa' }, line: { color: '99f6e4', width: 1 }, rectRadius: 0.08,
  });
  slide.addText('* µg/m³ = ไมโครกรัมต่อลูกบาศก์เมตร | ค่ายิ่งสูง = อากาศยิ่งแย่ | ส่งผลเสียต่อสุขภาพระบบทางเดินหายใจโดยเฉพาะกลุ่มเสี่ยง (เด็ก ผู้สูงอายุ ผู้ป่วยโรคหอบหืด)', {
    x: MARGIN + 0.15, y: 7.02, w: CONTENT_W - 0.3, h: 0.3,
    fontSize: 10, color: '0f766e', fontFace: 'Sarabun', italic: true,
  });
}

// ============================================================
// 📄 SLIDE 8 — โมดูล 4: ระบบร้องเรียน Traffy Fondue
// ============================================================
{
  const slide = pptx.addSlide();
  addSlideBg(slide, C.white);

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.15, h: SH, fill: { color: C.purple }, line: { color: C.purple },
  });

  addSectionBadge(slide, 'โมดูลที่ 04', C.purpleLight, C.purple, MARGIN, 0.3);
  slide.addText('📢 ระบบรวบรวมเรื่องร้องเรียนจากประชาชน', {
    x: MARGIN, y: 0.75, w: CONTENT_W, h: 0.65,
    fontSize: 28, bold: true, color: '3b0764', fontFace: 'Sarabun',
  });
  addDivider(slide, MARGIN, 1.42, CONTENT_W, 'd8b4fe');

  slide.addShape(pptx.ShapeType.roundRect, {
    x: MARGIN, y: 1.55, w: CONTENT_W, h: 0.55,
    fill: { color: 'faf5ff' }, line: { color: 'd8b4fe', width: 1 }, rectRadius: 0.1,
  });
  slide.addText('📡  แหล่งข้อมูล: citydata.traffy.in.th (Traffy Fondue)  |  ดึงข้อมูลเฉพาะจังหวัดลำปาง  |  บันทึกลงฐานข้อมูลอัตโนมัติ  |  ติดตามสถานะแก้ไข', {
    x: MARGIN + 0.15, y: 1.6, w: CONTENT_W - 0.3, h: 0.45,
    fontSize: 12, color: '6d28d9', fontFace: 'Sarabun', bold: true,
  });

  // What is Traffy — left
  const leftW = 5.8;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: MARGIN, y: 2.25, w: leftW, h: 2.6,
    fill: { color: 'faf5ff' }, line: { color: 'e9d5ff', width: 1 }, rectRadius: 0.12,
  });
  slide.addText('Traffy Fondue คืออะไร?', {
    x: MARGIN + 0.15, y: 2.35, w: leftW - 0.3, h: 0.4,
    fontSize: 15, bold: true, color: C.purple, fontFace: 'Sarabun',
  });
  slide.addText([
    '• แพลตฟอร์มรับแจ้งปัญหาจากประชาชนทั่วประเทศ',
    '• พัฒนาโดย สวทช./NECTEC',
    '• ประชาชนแจ้งผ่าน App, LINE, หรือ Web',
    '• เรื่องที่แจ้ง เช่น น้ำท่วม ภัยแล้ง ถนนชำรุด ไฟฟ้า',
    '• มีสถานะติดตาม: รอดำเนินการ / กำลังดำเนินการ / เสร็จสิ้น',
    '• ระบบดึงเฉพาะเรื่องที่เกี่ยวกับลำปาง เข้าสู่ Database',
    '• ข้อมูลพิกัด GPS แนบมาด้วย เพื่อระบุตำแหน่งปัญหา',
  ].join('\n'), {
    x: MARGIN + 0.15, y: 2.82, w: leftW - 0.3, h: 1.9,
    fontSize: 12, color: C.slate700, fontFace: 'Sarabun', wrap: true,
  });

  // KPIs — right
  const rightX = MARGIN + leftW + 0.4;
  const rightW = CONTENT_W - leftW - 0.4;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: rightX, y: 2.25, w: rightW, h: 2.6,
    fill: { color: 'faf5ff' }, line: { color: 'e9d5ff', width: 1 }, rectRadius: 0.12,
  });
  slide.addText('ข้อมูลที่ระบบวิเคราะห์', {
    x: rightX + 0.15, y: 2.35, w: rightW - 0.3, h: 0.4,
    fontSize: 15, bold: true, color: C.purple, fontFace: 'Sarabun',
  });
  const compMetrics = [
    { icon: '📢', label: 'เรื่องร้องเรียนสะสมทั้งหมด' },
    { icon: '✅', label: 'จำนวนที่ดำเนินการเสร็จแล้ว' },
    { icon: '📊', label: 'อัตราแก้ไขสำเร็จ (%)' },
    { icon: '🏆', label: 'ประเภทปัญหาที่พบบ่อยที่สุด' },
    { icon: '📍', label: 'พื้นที่ที่มีการร้องเรียนมากที่สุด' },
    { icon: '⏱️', label: 'ระยะเวลาเฉลี่ยในการแก้ไขปัญหา' },
    { icon: '📈', label: 'แนวโน้มเรื่องร้องเรียนรายเดือน' },
  ];
  compMetrics.forEach((m, i) => {
    slide.addText(`${m.icon}  ${m.label}`, {
      x: rightX + 0.15, y: 2.82 + i * 0.28, w: rightW - 0.3, h: 0.26,
      fontSize: 12, color: C.slate700, fontFace: 'Sarabun',
    });
  });

  // Dashboard panels
  slide.addText('สิ่งที่แสดงผลในแดชบอร์ด', {
    x: MARGIN, y: 5.05, w: CONTENT_W, h: 0.4,
    fontSize: 15, bold: true, color: '3b0764', fontFace: 'Sarabun',
  });
  const compFeats = [
    '📊 จำนวนร้องเรียน\nแยกตามสถานะ\n(รอ/กำลัง/เสร็จ)',
    '📈 แนวโน้มเรื่อง\nร้องเรียนรายเดือน\nเทียบค่าเฉลี่ย',
    '🥧 สัดส่วนประเภท\nปัญหาที่พบ\nบ่อยที่สุด',
    '🗺️ พื้นที่ที่มีปัญหา\nมากที่สุด\nพร้อมพิกัด GPS',
    '🤖 AI วิเคราะห์\nและแนวทางแก้ไข\nเชิงรุก',
  ];
  const compFeatW = (CONTENT_W - 0.8) / 5;
  compFeats.forEach((f, i) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: MARGIN + i * (compFeatW + 0.16), y: 5.55, w: compFeatW, h: 1.7,
      fill: { color: 'faf5ff' }, line: { color: 'd8b4fe', width: 1 }, rectRadius: 0.12,
    });
    const parts = f.split('\n');
    slide.addText(parts[0].split(' ')[0], { x: MARGIN + i * (compFeatW + 0.16), y: 5.62, w: compFeatW, h: 0.5, fontSize: 22, align: 'center' });
    slide.addText(f.replace(/^\S+\s/, '').split('\n').join('\n'), {
      x: MARGIN + i * (compFeatW + 0.16) + 0.1, y: 6.12, w: compFeatW - 0.2, h: 1.0,
      fontSize: 10.5, color: C.slate700, fontFace: 'Sarabun', align: 'center', wrap: true,
    });
  });
}

// ============================================================
// 📄 SLIDE 9 — แดชบอร์ดวิเคราะห์และ AI
// ============================================================
{
  const slide = pptx.addSlide();
  addSlideBg(slide, C.slate900);

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.15, h: SH, fill: { color: '818cf8' }, line: { color: '818cf8' },
  });

  slide.addText('🤖 แดชบอร์ดวิเคราะห์ข้อมูลและระบบ AI', {
    x: MARGIN, y: 0.3, w: CONTENT_W, h: 0.65,
    fontSize: 28, bold: true, color: C.white, fontFace: 'Sarabun',
  });
  slide.addText('ศูนย์กลางแสดงผลข้อมูลแบบ Real-time พร้อมการวิเคราะห์ด้วยปัญญาประดิษฐ์ — ทั้ง 4 โมดูลในหน้าเดียว', {
    x: MARGIN, y: 0.92, w: CONTENT_W, h: 0.35,
    fontSize: 14, color: '94a3b8', fontFace: 'Sarabun',
  });
  addDivider(slide, MARGIN, 1.35, CONTENT_W, '334155');

  // Left: Dashboard features
  const leftW = 5.8;
  slide.addText('ฟีเจอร์หลักของแดชบอร์ด', {
    x: MARGIN, y: 1.5, w: leftW, h: 0.4,
    fontSize: 15, bold: true, color: 'a5b4fc', fontFace: 'Sarabun',
  });

  const dashFeats = [
    { icon: '🌊🏜️🍃📢', title: '4 โมดูลในหน้าเดียว', desc: 'สลับดูข้อมูลน้ำ ภัยแล้ง PM2.5 ร้องเรียน ได้ทันที' },
    { icon: '📅', title: 'ตัวกรองวันที่ (Date Filter)', desc: 'เลือกช่วงเวลาที่ต้องการวิเคราะห์ได้อย่างยืดหยุ่น' },
    { icon: '🌙', title: 'โหมดกลางคืน (Dark Mode)', desc: 'ปรับการแสดงผลให้ดูสบายตาในที่แสงน้อย' },
    { icon: '📊', title: 'KPI Cards สำคัญ', desc: 'ตัวเลขสำคัญแสดงชัดเจนด้านบน คลิกดูรายละเอียดได้' },
    { icon: '📈', title: '4 มุมมองต่อโมดูล', desc: 'กราฟแท่ง เส้น วงกลม และตารางเปรียบเทียบ' },
    { icon: '🔄', title: 'อัปเดตอัตโนมัติ Real-time', desc: 'ข้อมูลใหม่แสดงผลทันทีผ่าน WebSocket ไม่ต้อง Refresh' },
    { icon: '📋', title: 'ส่งออกรายงาน Excel อัตโนมัติ', desc: 'สร้างรายงาน Excel พร้อมกราฟและข้อมูลสรุป' },
  ];
  dashFeats.forEach((f, i) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: MARGIN, y: 2.0 + i * 0.74, w: leftW, h: 0.64,
      fill: { color: '1e293b' }, line: { color: '334155', width: 1 }, rectRadius: 0.1,
    });
    slide.addText(f.icon, { x: MARGIN + 0.15, y: 2.05 + i * 0.74, w: 0.6, h: 0.54, fontSize: 18, align: 'center' });
    slide.addText(f.title, {
      x: MARGIN + 0.8, y: 2.05 + i * 0.74, w: leftW - 1.0, h: 0.28,
      fontSize: 12, bold: true, color: 'e2e8f0', fontFace: 'Sarabun',
    });
    slide.addText(f.desc, {
      x: MARGIN + 0.8, y: 2.32 + i * 0.74, w: leftW - 1.0, h: 0.28,
      fontSize: 10.5, color: '94a3b8', fontFace: 'Sarabun',
    });
  });

  // Right: AI Insights
  const rightX = MARGIN + leftW + 0.4;
  const rightW = CONTENT_W - leftW - 0.4;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: rightX, y: 1.5, w: rightW, h: 5.6,
    fill: { color: '0f172a' }, line: { color: '3730a3', width: 2 }, rectRadius: 0.18,
  });
  slide.addText('🤖', { x: rightX, y: 1.65, w: 0.7, h: 0.6, fontSize: 28, align: 'center' });
  slide.addText('ระบบ AI Insights', {
    x: rightX + 0.7, y: 1.72, w: rightW - 1.0, h: 0.4,
    fontSize: 16, bold: true, color: 'a5b4fc', fontFace: 'Sarabun',
  });
  slide.addText('(AI Water/Drought/PM2.5/Complaints Insights)', {
    x: rightX + 0.15, y: 2.15, w: rightW - 0.3, h: 0.3,
    fontSize: 10, color: '6366f1', fontFace: 'Sarabun',
  });
  addDivider(slide, rightX + 0.15, 2.5, rightW - 0.3, '1e1b4b');

  const aiPoints = [
    '🔍 วิเคราะห์ข้อมูลล่าสุดจากทุก 4 โมดูลอัตโนมัติ',
    '⚠️ แจ้งเตือนจุดเสี่ยงที่น่าเป็นห่วงในทันที',
    '📋 สรุปสถานการณ์รวมเป็นภาษาไทยเข้าใจง่าย',
    '💡 เสนอแนวทางรับมือและป้องกันเชิงรุก',
    '📅 คาดการณ์แนวโน้มล่วงหน้า 3 วัน',
    '🎯 ระบุสถานีหรืออ่างที่ต้องเฝ้าระวังพิเศษ',
    '📊 เปรียบเทียบข้อมูลกับค่าเฉลี่ยและค่ามาตรฐาน',
    '🏥 แนะนำมาตรการป้องกันสุขภาพประชาชน',
  ];
  aiPoints.forEach((p, i) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: rightX + 0.15, y: 2.65 + i * 0.52, w: rightW - 0.3, h: 0.44,
      fill: { color: '1e1b4b', transparency: 40 }, line: { color: '3730a3', width: 0.75 }, rectRadius: 0.08,
    });
    slide.addText(p, {
      x: rightX + 0.3, y: 2.69 + i * 0.52, w: rightW - 0.6, h: 0.36,
      fontSize: 11.5, color: 'c7d2fe', fontFace: 'Sarabun',
    });
  });

  slide.addShape(pptx.ShapeType.roundRect, {
    x: rightX + 0.15, y: 6.85, w: rightW - 0.3, h: 0.4,
    fill: { color: '312e81', transparency: 20 }, line: { color: '4338ca', width: 1 }, rectRadius: 0.1,
  });
  slide.addText('* AI = ปัญญาประดิษฐ์ ระบบที่เรียนรู้จากข้อมูลและวิเคราะห์แทนคนได้', {
    x: rightX + 0.3, y: 6.89, w: rightW - 0.6, h: 0.32,
    fontSize: 10, color: 'a5b4fc', fontFace: 'Sarabun', italic: true,
  });
}

// ============================================================
// 📄 SLIDE 10 — ระบบควบคุม (Control Panel) และ Schedule
// ============================================================
{
  const slide = pptx.addSlide();
  addSlideBg(slide, C.white);

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.15, h: SH, fill: { color: C.emerald }, line: { color: C.emerald },
  });

  addSectionBadge(slide, 'ระบบควบคุม', C.emeraldLight, C.emerald, MARGIN, 0.3);
  slide.addText('⚙️ ระบบจัดการและควบคุมการทำงานอัตโนมัติ', {
    x: MARGIN, y: 0.75, w: CONTENT_W, h: 0.65,
    fontSize: 28, bold: true, color: C.emeraldDark, fontFace: 'Sarabun',
  });
  addDivider(slide, MARGIN, 1.42, CONTENT_W, 'a7f3d0');

  // Schedule info
  slide.addText('ตารางเวลาดึงข้อมูลอัตโนมัติ (ทุก 30 นาที)', {
    x: MARGIN, y: 1.55, w: CONTENT_W, h: 0.4,
    fontSize: 15, bold: true, color: C.emeraldDark, fontFace: 'Sarabun',
  });

  const times = ['09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00'];
  const timeW = 1.35;
  const timeGap = 0.15;
  const perRow = Math.floor((CONTENT_W + timeGap) / (timeW + timeGap));
  times.forEach((t, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: MARGIN + col * (timeW + timeGap), y: 2.05 + row * 0.55, w: timeW, h: 0.42,
      fill: { color: 'ecfdf5' }, line: { color: C.emerald, width: 1.5 }, rectRadius: 0.1,
    });
    slide.addText(t, {
      x: MARGIN + col * (timeW + timeGap), y: 2.05 + row * 0.55, w: timeW, h: 0.42,
      fontSize: 13, bold: true, color: C.emeraldDark, fontFace: 'Sarabun', align: 'center', valign: 'middle',
    });
  });

  // Fallback mechanism
  slide.addShape(pptx.ShapeType.roundRect, {
    x: MARGIN, y: 3.25, w: CONTENT_W, h: 0.55,
    fill: { color: 'f0fdf4' }, line: { color: C.emerald, width: 1.5 }, rectRadius: 0.1,
  });
  slide.addText('⚡ กลไกสำรอง (Fallback): ถ้า Chrome Extension ไม่ตอบสนองใน 60 วินาที → สลับไปใช้ Puppeteer อัตโนมัติ → ถ้า Puppeteer ล้มเหลว → ใช้ Excel สำรองข้อมูล', {
    x: MARGIN + 0.15, y: 3.3, w: CONTENT_W - 0.3, h: 0.45,
    fontSize: 12, color: C.emeraldDark, fontFace: 'Sarabun', bold: true,
  });

  // Control panel features
  slide.addText('ฟีเจอร์ของแผงควบคุม (Control Panel)', {
    x: MARGIN, y: 3.95, w: CONTENT_W, h: 0.4,
    fontSize: 15, bold: true, color: C.emeraldDark, fontFace: 'Sarabun',
  });

  const cpFeats = [
    { icon: '🔴🟢', title: 'เปิด/ปิดระบบอัตโนมัติ', desc: 'Toggle เปิด-ปิดการดึงข้อมูลได้ทันที ไม่ต้องรีสตาร์ท' },
    { icon: '▶️', title: 'สั่งดึงข้อมูลทันที (Force)', desc: 'Force Fetch: สั่งดึงข้อมูลทั้ง Excel + Database โดยไม่ต้องรอ' },
    { icon: '💻', title: 'Live System Logs', desc: 'ดูบันทึกการทำงานของระบบ Real-time ทุกกิจกรรม' },
    { icon: '📋', title: 'ประวัติการทำงาน (50 งาน)', desc: 'ดูรายการงานล่าสุด พร้อมสถานะสำเร็จ/ล้มเหลว' },
    { icon: '⏰', title: 'กำหนดเวลาเอง', desc: 'เพิ่ม ลบ และจัดลำดับเวลาทำงานได้ตามต้องการ' },
    { icon: '🔌', title: 'สถานะ Extension', desc: 'แสดงว่า Chrome Extension เชื่อมต่ออยู่หรือไม่' },
  ];

  const cpCols = 3;
  const cpW = (CONTENT_W - 0.4) / cpCols;
  cpFeats.forEach((f, i) => {
    const col = i % cpCols;
    const row = Math.floor(i / cpCols);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: MARGIN + col * (cpW + 0.2), y: 4.45 + row * 1.2, w: cpW, h: 1.0,
      fill: { color: 'f0fdf4' }, line: { color: 'a7f3d0', width: 1 }, rectRadius: 0.12,
    });
    slide.addText(f.icon, { x: MARGIN + 0.1 + col * (cpW + 0.2), y: 4.52 + row * 1.2, w: 0.55, h: 0.65, fontSize: 18, align: 'center' });
    slide.addText(f.title, {
      x: MARGIN + 0.7 + col * (cpW + 0.2), y: 4.52 + row * 1.2, w: cpW - 0.85, h: 0.3,
      fontSize: 12, bold: true, color: C.emeraldDark, fontFace: 'Sarabun',
    });
    slide.addText(f.desc, {
      x: MARGIN + 0.7 + col * (cpW + 0.2), y: 4.82 + row * 1.2, w: cpW - 0.85, h: 0.55,
      fontSize: 10.5, color: C.slate500, fontFace: 'Sarabun', wrap: true,
    });
  });
}

// ============================================================
// 📄 SLIDE 11 — โครงสร้างเทคโนโลยี (Tech Stack)
// ============================================================
{
  const slide = pptx.addSlide();
  addSlideBg(slide, C.white);

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.15, h: SH, fill: { color: C.slate700 }, line: { color: C.slate700 },
  });

  addSectionBadge(slide, 'เทคโนโลยี', C.slate100, C.slate700, MARGIN, 0.3);
  slide.addText('🛠️ เทคโนโลยีที่ใช้ในโครงการ (Technology Stack)', {
    x: MARGIN, y: 0.75, w: CONTENT_W, h: 0.65,
    fontSize: 28, bold: true, color: C.slate800, fontFace: 'Sarabun',
  });
  addDivider(slide, MARGIN, 1.42, CONTENT_W);

  const techItems = [
    { cat: 'Backend (ส่วนเซิร์ฟเวอร์)', items: [
      'Node.js — รันโปรแกรมฝั่งเซิร์ฟเวอร์ (JavaScript Runtime)',
      'Express.js — จัดการ API และเส้นทางการเข้าถึงข้อมูล',
      'Socket.io — สื่อสารแบบ Real-time กับ Extension',
      'MySQL (mysql2) — ฐานข้อมูลหลักสำหรับเก็บข้อมูลระยะยาว',
    ], color: '1d4ed8', bg: 'eff6ff' },
    { cat: 'Data Collection (เก็บข้อมูล)', items: [
      'Puppeteer — ควบคุมเบราว์เซอร์อัตโนมัติ (Headless)',
      'Chrome Extension (Manifest V3) — ดึงข้อมูลผ่าน Browser',
      'ExcelJS — สร้างและบันทึกไฟล์ Excel อัตโนมัติ',
      'DNS Preflight Check — ตรวจสอบอินเทอร์เน็ตก่อนทำงาน',
    ], color: '047857', bg: 'f0fdf4' },
    { cat: 'Frontend (ส่วนแสดงผล)', items: [
      'HTML5 / CSS3 / Vanilla JS — โครงสร้างหน้าเว็บ',
      'TailwindCSS — จัดสไตล์รูปแบบ UI ทันสมัย',
      'Chart.js — กราฟแบบต่าง ๆ (แท่ง เส้น วงกลม)',
      'DateRangePicker — ตัวกรองช่วงวันที่',
    ], color: '6d28d9', bg: 'faf5ff' },
    { cat: 'Infrastructure (โครงสร้างพื้นฐาน)', items: [
      'MySQL Server — เซิร์ฟเวอร์ฐานข้อมูล (localhost:3306)',
      'Port 3000 — พอร์ตที่ Server รับการเชื่อมต่อ',
      'Retry 3 ครั้ง + Fallback 3 ระดับ — ป้องกันข้อมูลสูญหาย',
      'Task History JSON — บันทึกประวัติการทำงานถาวร',
    ], color: 'b45309', bg: 'fffbeb' },
  ];

  const techW = (CONTENT_W - 0.4) / 2;
  techItems.forEach((tech, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = MARGIN + col * (techW + 0.4);
    const y = 1.6 + row * 2.8;

    slide.addShape(pptx.ShapeType.roundRect, {
      x, y, w: techW, h: 2.6,
      fill: { color: tech.bg }, line: { color: tech.color, width: 1.5 }, rectRadius: 0.12,
    });
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y, w: techW, h: 0.45,
      fill: { color: tech.color }, line: { color: tech.color }, rectRadius: 0.12,
    });
    slide.addShape(pptx.ShapeType.rect, {
      x, y: y + 0.28, w: techW, h: 0.17,
      fill: { color: tech.color }, line: { color: tech.color },
    });
    slide.addText(tech.cat, {
      x: x + 0.15, y, w: techW - 0.3, h: 0.45,
      fontSize: 13, bold: true, color: C.white, fontFace: 'Sarabun', valign: 'middle',
    });
    tech.items.forEach((item, j) => {
      slide.addText(`▸  ${item}`, {
        x: x + 0.2, y: y + 0.55 + j * 0.48, w: techW - 0.4, h: 0.42,
        fontSize: 11.5, color: C.slate700, fontFace: 'Sarabun',
      });
    });
  });

  // Note
  slide.addShape(pptx.ShapeType.roundRect, {
    x: MARGIN, y: 7.05, w: CONTENT_W, h: 0.3,
    fill: { color: C.slate100 }, line: { color: C.slate200 }, rectRadius: 0.08,
  });
  slide.addText('* ทุกเทคโนโลยีเป็น Open Source (ฟรี) ไม่มีค่าลิขสิทธิ์เพิ่มเติม — ลดต้นทุนการพัฒนาและบำรุงรักษาระบบ', {
    x: MARGIN + 0.15, y: 7.07, w: CONTENT_W - 0.3, h: 0.26,
    fontSize: 10, color: C.slate500, fontFace: 'Sarabun', italic: true,
  });
}

// ============================================================
// 📄 SLIDE 12 — ผลการปฏิบัติงานประจำเดือน พ.ค. 2569 (ใหม่!)
// ============================================================
{
  const slide = pptx.addSlide();
  addSlideBg(slide, C.white);

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.15, h: SH, fill: { color: C.red }, line: { color: C.red },
  });

  addSectionBadge(slide, 'รายงานเดือน พ.ค.', C.redLight, C.red, MARGIN, 0.3);
  slide.addText('📋 ผลการปฏิบัติงานประจำเดือนพฤษภาคม 2569', {
    x: MARGIN, y: 0.75, w: CONTENT_W, h: 0.65,
    fontSize: 28, bold: true, color: '7f1d1d', fontFace: 'Sarabun',
  });
  slide.addText('ตามใบสั่งจ้างเลขที่ ๓๕๐/๒๕๖๙  |  ผู้ปฏิบัติงาน: นายภัคพล บุตติ — นักวิเคราะห์ข้อมูล  |  สังกัด: ฝ่ายกองยุทธศาสตร์และงบประมาณ', {
    x: MARGIN, y: 1.35, w: CONTENT_W, h: 0.35,
    fontSize: 12, color: C.slate500, fontFace: 'Sarabun',
  });
  addDivider(slide, MARGIN, 1.78, CONTENT_W, 'fca5a5');

  // Left: งานที่ทำในเดือน พ.ค.
  const leftW = 6.0;
  slide.addText('งานที่ปฏิบัติในเดือนพฤษภาคม 2569', {
    x: MARGIN, y: 1.95, w: leftW, h: 0.4,
    fontSize: 15, bold: true, color: '991b1b', fontFace: 'Sarabun',
  });

  const tasks = [
    { num: '1', title: 'รวบรวมและตรวจสอบข้อมูล', desc: 'ตรวจสอบความถูกต้องของข้อมูลปริมาณการใช้น้ำ คุณภาพน้ำ และข้อมูลการซ่อมบำรุงระบบท่อส่งน้ำ พร้อมนำเข้าระบบฐานข้อมูล', color: 'eff6ff' },
    { num: '2', title: 'จัดทำรายงานวิเคราะห์สรุปผล', desc: 'รายงานผลเดือน เม.ย. เปรียบเทียบเป้าหมาย วิเคราะห์แนวโน้มน้ำสูญเสีย (NRW) และนำเสนอต่อผู้บริหาร', color: 'f0fdf4' },
    { num: '3', title: 'พัฒนาระบบ Backend UI + รายงาน', desc: 'ปรับปรุงระบบรายงานออนไลน์ (Backend UI) และระบบสร้างรายงานอัตโนมัติให้มีประสิทธิภาพมากขึ้น', color: 'faf5ff' },
    { num: '4', title: 'ปรับปรุง Dashboard + งบประมาณ', desc: 'ปรับ Dashboard ให้ทันสมัย จัดทำรายงานเปรียบเทียบงบประมาณโครงการน้ำประปา ไตรมาส 2', color: 'fffbeb' },
    { num: '5', title: 'ประชุมและวางแผน', desc: 'เข้าร่วมประชุมกับฝ่ายยุทธศาสตร์และผู้บริหาร นำเสนอข้อมูลสนับสนุนและจัดทำแผนเดือน มิ.ย.', color: 'fff7ed' },
  ];
  tasks.forEach((t, i) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: MARGIN, y: 2.45 + i * 0.95, w: leftW, h: 0.85,
      fill: { color: t.color }, line: { color: 'fca5a5', width: 1 }, rectRadius: 0.1,
    });
    slide.addShape(pptx.ShapeType.ellipse, {
      x: MARGIN + 0.1, y: 2.55 + i * 0.95, w: 0.4, h: 0.4,
      fill: { color: C.red }, line: { color: C.red },
    });
    slide.addText(t.num, {
      x: MARGIN + 0.1, y: 2.55 + i * 0.95, w: 0.4, h: 0.4,
      fontSize: 14, bold: true, color: C.white, fontFace: 'Sarabun', align: 'center', valign: 'middle',
    });
    slide.addText(t.title, {
      x: MARGIN + 0.6, y: 2.48 + i * 0.95, w: leftW - 0.75, h: 0.3,
      fontSize: 13, bold: true, color: C.slate800, fontFace: 'Sarabun',
    });
    slide.addText(t.desc, {
      x: MARGIN + 0.6, y: 2.78 + i * 0.95, w: leftW - 0.75, h: 0.48,
      fontSize: 10.5, color: C.slate500, fontFace: 'Sarabun', wrap: true,
    });
  });

  // Right: สถิติข้อมูลจริง + ผลงานเพิ่มเติม
  const rightX = MARGIN + leftW + 0.4;
  const rightW = CONTENT_W - leftW - 0.4;

  slide.addText('📊 สถิติข้อมูลจริง (25-31 พ.ค. 2569)', {
    x: rightX, y: 1.95, w: rightW, h: 0.4,
    fontSize: 15, bold: true, color: '991b1b', fontFace: 'Sarabun',
  });

  const stats = [
    { icon: '🌊', label: 'สถานีวัดน้ำ', value: '26 สถานี', bg: 'dbeafe' },
    { icon: '🏔️', label: 'อ่างเก็บน้ำ', value: '36 แห่ง', bg: 'fef3c7' },
    { icon: '🍃', label: 'PM 2.5 ครอบคลุม', value: 'ทุกอำเภอ', bg: 'ccfbf1' },
    { icon: '📢', label: 'เรื่องร้องเรียน', value: 'อัพเดตรายวัน', bg: 'ede9fe' },
  ];
  const statW = (rightW - 0.15) / 2;
  stats.forEach((s, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: rightX + col * (statW + 0.15), y: 2.45 + row * 0.95, w: statW, h: 0.85,
      fill: { color: s.bg }, line: { color: 'e2e8f0', width: 1 }, rectRadius: 0.1,
    });
    slide.addText(s.icon, {
      x: rightX + col * (statW + 0.15), y: 2.5 + row * 0.95, w: statW, h: 0.35,
      fontSize: 20, align: 'center',
    });
    slide.addText(s.label, {
      x: rightX + col * (statW + 0.15), y: 2.82 + row * 0.95, w: statW, h: 0.2,
      fontSize: 10, color: C.slate500, fontFace: 'Sarabun', align: 'center',
    });
    slide.addText(s.value, {
      x: rightX + col * (statW + 0.15), y: 2.98 + row * 0.95, w: statW, h: 0.25,
      fontSize: 14, bold: true, color: C.slate800, fontFace: 'Sarabun', align: 'center',
    });
  });

  // งาน 4 มิ.ย. (ต้นเดือน)
  slide.addText('📅 งานต้นเดือน มิ.ย. 2569 (4 มิ.ย.)', {
    x: rightX, y: 4.45, w: rightW, h: 0.4,
    fontSize: 14, bold: true, color: '991b1b', fontFace: 'Sarabun',
  });
  const juneWork = [
    '✅ จัดทำรายงานสรุปผล พ.ค. 2569',
    '✅ ตรวจสอบความครบถ้วนของฐานข้อมูล',
    '✅ วิเคราะห์ปริมาณใช้น้ำต้นเดือน มิ.ย.',
    '✅ ปรับปรุง Dashboard ให้สมบูรณ์ยิ่งขึ้น',
    '✅ นำส่งรายงานต่อผู้บังคับบัญชา',
  ];
  juneWork.forEach((w, i) => {
    slide.addText(w, {
      x: rightX + 0.1, y: 4.92 + i * 0.35, w: rightW - 0.2, h: 0.3,
      fontSize: 11.5, color: C.slate700, fontFace: 'Sarabun',
    });
  });

  // Impact summary
  slide.addShape(pptx.ShapeType.roundRect, {
    x: rightX, y: 6.7, w: rightW, h: 0.55,
    fill: { color: 'fef2f2' }, line: { color: 'fca5a5', width: 1.5 }, rectRadius: 0.1,
  });
  slide.addText('🎯 เป้าหมาย มิ.ย.: วิเคราะห์ NRW เชิงลึก + พัฒนา Dashboard V2 + รายงานไตรมาส 2', {
    x: rightX + 0.1, y: 6.75, w: rightW - 0.2, h: 0.45,
    fontSize: 11, color: '991b1b', fontFace: 'Sarabun', bold: true,
  });
}

// ============================================================
// 📄 SLIDE 13 — สรุปผลและแผนพัฒนา
// ============================================================
{
  const slide = pptx.addSlide();
  addSlideBg(slide, C.white);

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.15, h: SH, fill: { color: C.emerald }, line: { color: C.emerald },
  });

  addSectionBadge(slide, 'สรุปผล', C.emeraldLight, C.emerald, MARGIN, 0.3);
  slide.addText('✅ สรุปผลลัพธ์และแผนพัฒนาต่อ', {
    x: MARGIN, y: 0.75, w: CONTENT_W, h: 0.65,
    fontSize: 30, bold: true, color: C.emeraldDark, fontFace: 'Sarabun',
  });
  addDivider(slide, MARGIN, 1.42, CONTENT_W, 'a7f3d0');

  // Achievements — left
  const leftW = 6.0;
  slide.addText('🏆 สิ่งที่โครงการสำเร็จแล้ว', {
    x: MARGIN, y: 1.55, w: leftW, h: 0.4,
    fontSize: 15, bold: true, color: C.emeraldDark, fontFace: 'Sarabun',
  });
  const achievements = [
    '✅ ระบบดึงข้อมูลอัตโนมัติ 4 ประเภท พร้อมใช้งาน',
    '✅ ฐานข้อมูล MySQL รองรับการบันทึกระยะยาว',
    '✅ แดชบอร์ดวิเคราะห์พร้อมกราฟ 4 รูปแบบต่อโมดูล',
    '✅ ระบบ AI วิเคราะห์สถานการณ์และให้คำแนะนำ',
    '✅ Fallback 3 ระดับ ป้องกันข้อมูลหายเมื่อเกิดปัญหา',
    '✅ Control Panel จัดการระบบโดยไม่ต้องเขียนโค้ด',
    '✅ ส่งออกรายงาน Excel ได้อัตโนมัติ',
    '✅ Backend UI สำหรับจัดการระบบรายงาน',
    '✅ รายงานเปรียบเทียบงบประมาณรายไตรมาส',
  ];
  achievements.forEach((a, i) => {
    slide.addText(a, {
      x: MARGIN, y: 2.05 + i * 0.5, w: leftW, h: 0.44,
      fontSize: 12, color: C.slate700, fontFace: 'Sarabun',
      bullet: false,
    });
  });

  // Future plans — right
  const rightX = MARGIN + leftW + 0.4;
  const rightW = CONTENT_W - leftW - 0.4;
  slide.addText('🚀 แผนพัฒนาต่อในอนาคต', {
    x: rightX, y: 1.55, w: rightW, h: 0.4,
    fontSize: 15, bold: true, color: '1d4ed8', fontFace: 'Sarabun',
  });
  const plans = [
    { icon: '🔔', text: 'ระบบแจ้งเตือน LINE/Email เมื่อวิกฤต' },
    { icon: '🗺️', text: 'แผนที่แสดงตำแหน่งสถานีเฝ้าระวัง GIS' },
    { icon: '🔥', text: 'เพิ่มโมดูลหมอกควันไฟป่า (กำลังพัฒนา)' },
    { icon: '📱', text: 'แอปพลิเคชันมือถือสำหรับผู้บริหาร' },
    { icon: '🤖', text: 'AI พยากรณ์ล่วงหน้า 7 วัน (Machine Learning)' },
    { icon: '🔗', text: 'เชื่อมต่อ API กรมทรัพยากรน้ำ+กรมชลประทาน' },
    { icon: '📊', text: 'รายงานอัตโนมัติรายสัปดาห์/เดือน ส่งผู้บริหาร' },
    { icon: '📈', text: 'วิเคราะห์ NRW เชิงลึก + คาดการณ์ภัยแล้ง' },
    { icon: '🏥', text: 'เชื่อมต่อข้อมูลสาธารณสุข + PM2.5 Alert' },
  ];
  plans.forEach((p, i) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: rightX, y: 2.05 + i * 0.5, w: rightW, h: 0.44,
      fill: { color: 'eff6ff' }, line: { color: 'bfdbfe', width: 1 }, rectRadius: 0.08,
    });
    slide.addText(`${p.icon}  ${p.text}`, {
      x: rightX + 0.12, y: 2.08 + i * 0.5, w: rightW - 0.24, h: 0.38,
      fontSize: 12, color: '1e3a5f', fontFace: 'Sarabun',
    });
  });

  // Impact summary
  slide.addShape(pptx.ShapeType.roundRect, {
    x: MARGIN, y: 6.7, w: CONTENT_W, h: 0.6,
    fill: { color: 'ecfdf5' }, line: { color: C.emerald, width: 2 }, rectRadius: 0.12,
  });
  slide.addText('💡 ผลกระทบต่อประชาชน: ระบบนี้ช่วยให้ อบจ.ลำปาง รับรู้สถานการณ์ภัยพิบัติและปัญหาของประชาชนได้รวดเร็วขึ้น ตัดสินใจได้แม่นยำขึ้น และสามารถป้องกัน/ช่วยเหลือประชาชนได้ทันท่วงทีกว่าเดิม', {
    x: MARGIN + 0.15, y: 6.75, w: CONTENT_W - 0.3, h: 0.5,
    fontSize: 12.5, color: C.emeraldDark, fontFace: 'Sarabun', bold: true, wrap: true,
  });
}

// ============================================================
// 📄 SLIDE 14 — ขอบคุณ / Thank You
// ============================================================
{
  const slide = pptx.addSlide();
  addSlideBg(slide, C.emeraldDark);

  // Decorative — full screen
  slide.addShape(pptx.ShapeType.ellipse, {
    x: -2, y: -2, w: 6, h: 6,
    fill: { color: '10b981', transparency: 85 }, line: { color: '10b981', transparency: 85 },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 10, y: 4.5, w: 5, h: 5,
    fill: { color: '065f46', transparency: 65 }, line: { color: '065f46', transparency: 65 },
  });

  slide.addText('ขอบคุณสำหรับการรับฟัง', {
    x: 0.5, y: 1.5, w: 12.3, h: 1.0,
    fontSize: 48, bold: true, color: C.white, fontFace: 'Sarabun', align: 'center',
  });
  slide.addText('Thank You for Your Attention', {
    x: 0.5, y: 2.5, w: 12.3, h: 0.6,
    fontSize: 24, color: '6ee7b7', fontFace: 'Sarabun', align: 'center',
  });

  addDivider(slide, 2, 3.35, 9.3, '065f46');

  slide.addText('🌊 ระบบบูรณาการข้อมูลสารสนเทศเพื่อการเฝ้าระวังภัยพิบัติและสิ่งแวดล้อม', {
    x: 0.5, y: 3.6, w: 12.3, h: 0.5,
    fontSize: 16, color: 'a7f3d0', fontFace: 'Sarabun', align: 'center', bold: true,
  });
  slide.addText('องค์การบริหารส่วนจังหวัดลำปาง  |  มิถุนายน 2569  |  ใบสั่งจ้างเลขที่ ๓๕๐/๒๕๖๙', {
    x: 0.5, y: 4.1, w: 12.3, h: 0.45,
    fontSize: 14, color: '6ee7b7', fontFace: 'Sarabun', align: 'center',
  });

  // Contact chips
  const contacts = ['🌐 อบจ.ลำปาง', '📧 lampangpao@lampang.go.th', '📞 054-223851'];
  contacts.forEach((c, i) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 2.0 + i * 3.3, y: 4.8, w: 2.9, h: 0.45,
      fill: { color: '065f46', transparency: 30 }, line: { color: '10b981', transparency: 50 }, rectRadius: 0.22,
    });
    slide.addText(c, {
      x: 2.0 + i * 3.3, y: 4.8, w: 2.9, h: 0.45,
      fontSize: 12, color: 'a7f3d0', fontFace: 'Sarabun', align: 'center', valign: 'middle', bold: true,
    });
  });

  slide.addText('"ข้อมูลที่ดี คือจุดเริ่มต้นของการตัดสินใจที่ถูกต้อง"', {
    x: 0.5, y: 5.7, w: 12.3, h: 0.5,
    fontSize: 16, color: '6ee7b7', fontFace: 'Sarabun', align: 'center', italic: true,
  });
}

// ============================================================
// 💾 Save File
// ============================================================
const OUTPUT_PATH = 'presentation_water_system.pptx';
await pptx.writeFile({ fileName: OUTPUT_PATH });
console.log(`\n✅ สร้างไฟล์สำเร็จ! บันทึกที่: ${OUTPUT_PATH}`);
console.log('   📂 เปิดไฟล์ด้วย Microsoft PowerPoint หรือ Google Slides ได้เลย');
