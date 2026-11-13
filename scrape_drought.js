/**
 * scrape_drought.js
 * ดึงข้อมูลอ่างเก็บน้ำจาก https://lampang.thaiwater.net/dam
 * แล้วบันทึกลงไฟล์ Excel แบบ Insert ต่อเนื่อง (Append)
 * 
 * วิธีใช้: node scrape_drought.js
 */

import puppeteer from 'puppeteer';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DAM_URL = 'https://lampang.thaiwater.net/dam';
const EXCEL_FILE = path.join(__dirname, 'Drought_Dam_Data.xlsx');
const SHEET_NAME = 'ข้อมูลอ่างเก็บน้ำ';

// Header columns for the Excel file
const HEADERS = [
  'วันที่เก็บข้อมูล',
  'เวลา (ISO)',
  'ประเภทอ่าง',
  'ชื่ออ่าง',
  'ความจุ (ล้าน ลบ.ม.)',
  'ปริมาณน้ำไหลลงอ่าง',
  '%ปริมาณน้ำ เทียบ รนก.',
  'เปอร์เซ็นต์น้ำ (%)',
  '%ปริมาณน้ำใช้การ เทียบ รนก.',
  'ปริมาณน้ำระบาย (ล้าน ลบ.ม.)',
];

async function scrapeDamData() {
  console.log('🚀 เริ่มต้นดึงข้อมูลอ่างเก็บน้ำจาก ThaiWater...');
  console.log(`🌐 URL: ${DAM_URL}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    console.log('⏳ กำลังโหลดหน้าเว็บ...');
    await page.goto(DAM_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for the dam data table to render
    console.log('⏳ รอตารางข้อมูลโหลด...');
    // ใช้ aria-labelledby="dam" ซึ่งเป็น attribute คงที่ แทน jss class ที่เปลี่ยนทุกครั้ง
    await page.waitForSelector('table[aria-labelledby="dam"]', { timeout: 45000 }).catch(async () => {
      // Fallback: try generic table inside card
      console.log('⚠️ ไม่พบ table[aria-labelledby], ลอง fallback selector...');
      await page.waitForSelector('#dashboard table', { timeout: 15000 });
    });

    // Wait a bit more for data to fully populate
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Click through all pages and collect data
    const allData = await page.evaluate(() => {
      const results = [];
      const table = document.querySelector('table[aria-labelledby="dam"]') || document.querySelector('#dashboard table');
      if (!table) return results;

      let currentCategory = '';

      const processRows = () => {
        const tbody = table.querySelector('tbody');
        if (!tbody) return;

        const rows = tbody.querySelectorAll('tr');
        rows.forEach(row => {
          // Check if it's a category header row (e.g. "อ่างขนาดใหญ่")
          const subtabText = row.querySelector('.subtab-text');
          if (subtabText) {
            currentCategory = subtabText.innerText.replace(/\(.*\)/, '').trim();
            return;
          }

          // Check if it's a summary row (รวม...)
          const firstCell = row.querySelector('td, th');
          if (firstCell && firstCell.innerText.includes('รวม')) {
            return; // Skip summary rows
          }

          // Data rows have th[scope="row"] for the dam name
          const nameCell = row.querySelector('th[scope="row"]');
          if (!nameCell) return;

          const cells = row.querySelectorAll('th, td');
          if (cells.length < 6) return;

          const damName = nameCell.innerText.trim();
          const capacity = cells[1]?.innerText?.trim() || '-';
          const inflow = cells[2]?.innerText?.trim() || '-';

          // %ปริมาณน้ำ cell contains both value and percentage
          const waterVolumeCell = cells[3]?.innerText?.trim() || '-';
          let waterVolume = waterVolumeCell;
          let waterPercent = '-';

          // Extract percentage from text like "31.04 (28%)"
          const percentMatch = waterVolumeCell.match(/\((\d+)%\)/);
          if (percentMatch) {
            waterPercent = percentMatch[1] + '%';
            waterVolume = waterVolumeCell.replace(/\s*\(\d+%\)/, '').trim();
          }

          const usableWater = cells[4]?.innerText?.trim() || '-';
          const discharge = cells[5]?.innerText?.trim() || '-';

          results.push({
            category: currentCategory,
            name: damName,
            capacity,
            inflow,
            waterVolume,
            waterPercent,
            usableWater,
            discharge
          });
        });
      };

      processRows();
      return results;
    });

    // Check if there are more pages and navigate through them
    let hasNextPage = true;
    while (hasNextPage) {
      const nextBtnDisabled = await page.evaluate(() => {
        const btn = document.querySelector('button[aria-label="Next Page"]');
        return !btn || btn.disabled;
      });

      if (nextBtnDisabled) {
        hasNextPage = false;
        break;
      }

      // Click next page
      await page.click('button[aria-label="Next Page"]');
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Collect data from the new page
      const pageData = await page.evaluate((existingNames) => {
        const results = [];
        const table = document.querySelector('table[aria-labelledby="dam"]') || document.querySelector('#dashboard table');
        if (!table) return results;

        let currentCategory = '';

        const tbody = table.querySelector('tbody');
        if (!tbody) return results;

        const rows = tbody.querySelectorAll('tr');
        rows.forEach(row => {
          const subtabText = row.querySelector('.subtab-text');
          if (subtabText) {
            currentCategory = subtabText.innerText.replace(/\(.*\)/, '').trim();
            return;
          }

          const firstCell = row.querySelector('td, th');
          if (firstCell && firstCell.innerText.includes('รวม')) return;

          const nameCell = row.querySelector('th[scope="row"]');
          if (!nameCell) return;

          const cells = row.querySelectorAll('th, td');
          if (cells.length < 6) return;

          const damName = nameCell.innerText.trim();
          
          // Skip duplicates
          if (existingNames.includes(damName)) return;

          const capacity = cells[1]?.innerText?.trim() || '-';
          const inflow = cells[2]?.innerText?.trim() || '-';
          const waterVolumeCell = cells[3]?.innerText?.trim() || '-';
          let waterVolume = waterVolumeCell;
          let waterPercent = '-';

          const percentMatch = waterVolumeCell.match(/\((\d+)%\)/);
          if (percentMatch) {
            waterPercent = percentMatch[1] + '%';
            waterVolume = waterVolumeCell.replace(/\s*\(\d+%\)/, '').trim();
          }

          const usableWater = cells[4]?.innerText?.trim() || '-';
          const discharge = cells[5]?.innerText?.trim() || '-';

          results.push({
            category: currentCategory,
            name: damName,
            capacity,
            inflow,
            waterVolume,
            waterPercent,
            usableWater,
            discharge
          });
        });

        return results;
      }, allData.map(d => d.name));

      allData.push(...pageData);
      console.log(`  📄 หน้าถัดไป: พบข้อมูลเพิ่ม ${pageData.length} รายการ`);
    }

    console.log(`✅ ดึงข้อมูลสำเร็จ: ${allData.length} อ่าง`);
    
    // Now save to Excel
    await saveToExcel(allData);

    return allData;
  } catch (error) {
    console.error('❌ เกิดข้อผิดพลาด:', error.message);
    throw error;
  } finally {
    await browser.close();
    console.log('🔒 ปิดเบราว์เซอร์เรียบร้อย');
  }
}

async function saveToExcel(data) {
  const now = new Date();
  const options = {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(now);
  const yyyy = parts.find(p => p.type === 'year').value;
  const mm = parts.find(p => p.type === 'month').value;
  const dd = parts.find(p => p.type === 'day').value;
  const hh = parts.find(p => p.type === 'hour').value;
  const min = parts.find(p => p.type === 'minute').value;
  const ss = parts.find(p => p.type === 'second').value;
  const cleanHour = hh === '24' ? '00' : hh;
  const isoStr = `${yyyy}-${mm}-${dd} ${cleanHour}:${min}:${ss}`;

  const dateStr = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(now);

  let workbook;
  let worksheet;

  // Load existing workbook or create new
  if (fs.existsSync(EXCEL_FILE)) {
    console.log('📂 พบไฟล์ Excel เดิม กำลัง Append ข้อมูล...');
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(EXCEL_FILE);
    worksheet = workbook.getWorksheet(SHEET_NAME);

    if (!worksheet) {
      worksheet = workbook.addWorksheet(SHEET_NAME);
      // Add headers
      const headerRow = worksheet.addRow(HEADERS);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0891B2' } };
      headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    }
  } else {
    console.log('📝 สร้างไฟล์ Excel ใหม่...');
    workbook = new ExcelJS.Workbook();
    workbook.creator = 'WaterSys Drought Monitor';
    workbook.created = new Date();

    worksheet = workbook.addWorksheet(SHEET_NAME);

    // Add headers
    const headerRow = worksheet.addRow(HEADERS);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0891B2' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

    // Set column widths
    worksheet.columns = [
      { width: 25 }, // วันที่เก็บข้อมูล
      { width: 28 }, // เวลา (ISO)
      { width: 18 }, // ประเภทอ่าง
      { width: 30 }, // ชื่ออ่าง
      { width: 22 }, // ความจุ
      { width: 22 }, // ปริมาณน้ำไหลลงอ่าง
      { width: 28 }, // %ปริมาณน้ำ
      { width: 18 }, // เปอร์เซ็นต์น้ำ
      { width: 28 }, // %ปริมาณน้ำใช้การ
      { width: 28 }, // ปริมาณน้ำระบาย
    ];
  }

  // Append data rows
  let insertCount = 0;
  for (const dam of data) {
    worksheet.addRow([
      dateStr,
      isoStr,
      dam.category,
      dam.name,
      dam.capacity,
      dam.inflow,
      dam.waterVolume,
      dam.waterPercent,
      dam.usableWater,
      dam.discharge
    ]);
    insertCount++;
  }

  // Save
  await workbook.xlsx.writeFile(EXCEL_FILE);
  console.log(`\n📊 ===== สรุปผล =====`);
  console.log(`📁 ไฟล์: ${EXCEL_FILE}`);
  console.log(`📅 วันที่: ${dateStr}`);
  console.log(`🕐 เวลา: ${isoStr}`);
  console.log(`📝 Insert ข้อมูลใหม่: ${insertCount} รายการ`);
  console.log(`✅ บันทึกสำเร็จ!`);
}

// Run
scrapeDamData().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
