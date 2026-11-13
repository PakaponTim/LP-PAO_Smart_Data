import puppeteer from 'puppeteer';
import { createComplaintJob } from './complaint-job.js';

// Collection adapters are isolated from HTTP routes and storage implementations.
export function createCollectors({ io, isExtensionConnected, isTraffyExtensionConnected = isExtensionConnected, sendComplaintsRequest, addLog, fetchLogToFile,
  logTaskRun, withRetry, safeCloseBrowser, checkInternetConnection,
  dualWriteWaterLevel, dualWriteRainfall, dualWriteDrought, dualWritePM25, dualWriteComplaints }) {
async function triggerDataFetch(mode = 'excel') {
  addLog('Node.js', `⏳ เริ่มกระบวนการเก็บข้อมูลลง ${mode === 'db' ? 'Database' : 'Excel'} (Triggered)`);
  
  if (isExtensionConnected()) {
    addLog('Node.js', `📡 ส่งคำสั่งไปยัง Chrome Extension (${mode === 'db' ? 'Database' : 'Excel'} Mode)...`);
    io.to('collectors').emit(mode === 'db' ? 'FETCH_DATA_DB' : 'FETCH_DATA', { timestamp: Date.now() });
    
    global.lastFetchTrigger = Date.now();
    
    const triggerTime = global.lastFetchTrigger;
    setTimeout(() => {
      if (!global.lastWLDataReceived || global.lastWLDataReceived <= triggerTime) {
        addLog('Node.js', '⚠️ Extension ไม่ตอบสนองใน 60 วินาที กำลังสลับไปใช้ Puppeteer...');
        runPuppeteerFallback(mode);
      }
    }, 60000);
  } else {
    addLog('Node.js', '⚠️ Extension ไม่ได้เชื่อมต่อ (หน้าเว็บอาจปิดอยู่) สั่งรัน Puppeteer ทันที!');
    runPuppeteerFallback(mode);
  }
}

let isRunningPuppeteerWL = false;
// Fallback logic using Puppeteer (with Finite Retry + Lock)
async function runPuppeteerFallback(mode = 'excel') {
  if (isRunningPuppeteerWL) {
    addLog('Puppeteer', '⚠️ มีระบบดึงข้อมูลระดับน้ำกำลังทำงานอยู่แล้ว ข้ามการทำงานซ้ำซ้อน');
    return;
  }
  isRunningPuppeteerWL = true;
  try {
    await withRetry(async () => {
      await _runPuppeteerFallbackCore(mode);
    }, { infinite: false, maxRetries: 3, backoffMs: [15000, 30000, 60000], label: 'ดึงข้อมูลระดับน้ำ (Puppeteer)' });
  } catch (err) {
    addLog('Puppeteer', `❌ ดึงข้อมูลระดับน้ำ (Puppeteer) ล้มเหลวทั้งหมด 3 ครั้ง: ${err.message}`);
    logTaskRun("ดึงข้อมูลระดับน้ำ (Puppeteer Fallback)", mode, "failed", 0, `ล้มเหลวในการดึงข้อมูลทั้งหมด 3 ครั้ง: ${err.message}`);
  } finally {
    isRunningPuppeteerWL = false;
  }
}

async function _runPuppeteerFallbackCore(mode = 'excel') {
  // Pre-flight internet check
  const isOnline = await checkInternetConnection();
  if (!isOnline) {
    addLog('Puppeteer', '⚠️ [Pre-flight] ตรวจสอบพบสัญญาณอินเทอร์เน็ตขาดหาย งดเริ่มทำงานของเบราว์เซอร์ล่องหนเพื่อประหยัดทรัพยากรเครื่อง');
    throw new Error('Internet Connection Offline');
  }

  addLog('Puppeteer', '🤖 กำลังเปิดเบราว์เซอร์ล่องหน (Headless Mode)...');
  let browser;
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(async () => {
      addLog('Puppeteer', '🚨 [Timeout] การดึงข้อมูลระดับน้ำใช้เวลาเกิน 2 นาที สั่งปิดบราวเซอร์ล่องหน...');
      if (browser) {
        try {
          await safeCloseBrowser(browser);
          browser = null;
        } catch (e) {
          console.error('Error closing browser on timeout:', e);
        }
      }
      reject(new Error('Safety Timeout Exceeded (120000ms)'));
    }, 120000);
  });

  const coreProcess = (async () => {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.setDefaultTimeout(45000);

    // Step 1: Scrape rainfall data first to build a mapping of rain values
    addLog('Puppeteer', '⏳ เริ่มดึงข้อมูลปริมาณน้ำฝน (https://lampang.thaiwater.net/rainfall)...');
    let rainMaps = { subdistrictRainAvg: {}, districtRainAvg: {} };
    try {
      await page.goto('https://lampang.thaiwater.net/rainfall', { waitUntil: 'networkidle2' });
      await page.waitForSelector('table', { timeout: 45000 });
      await page.waitForFunction(() => {
        return Array.from(document.querySelectorAll('table')).some(table => {
          const headers = Array.from(table.querySelectorAll('th')).map(th => th.innerText.trim());
          return headers.includes('ฝนสะสม (มม.)') || headers.includes('ปริมาณฝน') || table.getAttribute('aria-labelledby') === 'Rainfall';
        });
      }, { timeout: 45000 });
      
      rainMaps = await page.evaluate(async () => {
        const subdistrictRain = {};
        const districtRain = {};
        const rawStations = []; // New array to hold raw rainfall data
        const extractedStations = new Set(); // Track scraped station names to prevent duplicates
        let totalStationCount = 0;

        const parseRain = (value) => {
          const num = parseFloat((value || '').replace(/,/g, '').trim());
          return Number.isFinite(num) ? num : null;
        };

        const findRainfallTable = () => {
          return Array.from(document.querySelectorAll('table')).find(table => {
            const headers = Array.from(table.querySelectorAll('th')).map(th => th.innerText.trim());
            return headers.includes('ฝนสะสม (มม.)') || headers.includes('ปริมาณฝน') || table.getAttribute('aria-labelledby') === 'Rainfall';
          });
        };

        let targetTable = findRainfallTable();
        if (!targetTable) return { subdistrictRainAvg: {}, districtRainAvg: {}, totalStations: 0 };

        let previousStationsString = '';
        let noProgressRetries = 0;
        const MAX_NO_PROGRESS_RETRIES = 3;

        while (true) {
          targetTable = findRainfallTable() || targetTable;
          const rows = targetTable.querySelectorAll('tbody tr');

          // Build list of current page stations for stale page detection
          let currentPageStations = [];
          rows.forEach(row => {
            if (row.innerText.includes('แสดงผลหน้าละ')) return;
            const cols = row.querySelectorAll('td, th');
            if (cols.length < 6) return;
            const stationName = (cols[0]?.innerText || '').trim();
            if (stationName) currentPageStations.push(stationName);
          });

          const currentStationsString = JSON.stringify(currentPageStations);
          // Detect stale page (same data as previous page = pagination didn't work)
          if (currentPageStations.length === 0 || currentStationsString === previousStationsString) {
            noProgressRetries++;
            if (noProgressRetries >= MAX_NO_PROGRESS_RETRIES) break;
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }
          previousStationsString = currentStationsString;
          noProgressRetries = 0;

          rows.forEach(row => {
            if (row.innerText.includes('แสดงผลหน้าละ')) return;
            const cols = row.querySelectorAll('td, th');
            if (cols.length < 6) return;

            const stationName = (cols[0]?.innerText || '').trim();
            // Skip duplicate stations (already scraped from previous page)
            if (stationName && extractedStations.has(stationName)) return;
            if (stationName) extractedStations.add(stationName);
            
            const location = cols[1].innerText.trim();
            const rainText = cols[3].innerText.trim();
            const rainVal = parseRain(rainText);
            
            totalStationCount++;

            // Extract subdistrict and district
            let tambon = '';
            let amphoe = '';
            const lines = location.split('\n');
            lines.forEach(line => {
              const l = line.trim();
              if (l.startsWith('ต.')) {
                tambon = l.replace('ต.', '').trim();
              } else if (l.startsWith('อ.')) {
                amphoe = "อำเภอ" + l.replace('อ.', '').trim();
              }
            });

            // Store raw station data
            rawStations.push({
              station_name: stationName,
              location: location.replace(/\n/g, ' '),
              river_basin: (cols[2]?.innerText || '').trim(),
              rain_mm: rainVal,
              rain_status: (cols[4]?.innerText || '').trim(),
              measured_time: (cols[5]?.innerText || '').trim()
            });
            if (amphoe && rainVal !== null) {
              if (!districtRain[amphoe]) districtRain[amphoe] = [];
              districtRain[amphoe].push(rainVal);
              
              if (tambon) {
                const subKey = `${tambon}_${amphoe}`;
                if (!subdistrictRain[subKey]) subdistrictRain[subKey] = [];
                subdistrictRain[subKey].push(rainVal);
              }
            }
          });
          
          const nextBtn = document.querySelector('button[aria-label="Next Page"]') || document.querySelector('button[aria-label="Next page"]');
          if (!nextBtn || nextBtn.disabled || nextBtn.getAttribute('aria-disabled') === 'true') {
            break;
          }
          nextBtn.click();
          // Wait longer for SPA to render new page data (matching water level scraper pattern)
          await new Promise(r => setTimeout(r, 2500));
        }
        
        const subdistrictRainAvg = {};
        const districtRainAvg = {};
        for (const key in subdistrictRain) {
          const arr = subdistrictRain[key];
          subdistrictRainAvg[key] = arr.reduce((a, b) => a + b, 0) / arr.length;
        }
        for (const key in districtRain) {
          const arr = districtRain[key];
          districtRainAvg[key] = arr.reduce((a, b) => a + b, 0) / arr.length;
        }
        
        return { subdistrictRainAvg, districtRainAvg, totalStations: totalStationCount, rawStations };
      });
      addLog('Puppeteer', `✅ ดึงข้อมูลน้ำฝนเสร็จสิ้น (สถานีฝน: ${rainMaps.totalStations || 0} แห่ง, ตำบล: ${Object.keys(rainMaps.subdistrictRainAvg).length} แห่ง, อำเภอ: ${Object.keys(rainMaps.districtRainAvg).length} แห่ง)`);
    } catch (rainErr) {
      addLog('Puppeteer', '⚠️ ไม่สามารถดึงข้อมูลปริมาณน้ำฝนได้ จะใช้น้ำฝนเริ่มต้นเป็น 0.0: ' + rainErr.message);
    }

    // Step 2: Scrape water level data and map the rainfall
    addLog('Puppeteer', '⏳ รอโหลดตารางข้อมูลระดับน้ำ (https://lampang.thaiwater.net/wl)...');
    await page.goto('https://lampang.thaiwater.net/wl', { waitUntil: 'networkidle2' });
    await page.waitForSelector('table', { timeout: 45000 });
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll('table')).some(table => {
        const headers = Array.from(table.querySelectorAll('th')).map(th => th.innerText.trim());
        return headers.some(h => h.includes('ระดับน้ำ') || h.includes('เทียบตลิ่ง')) || table.getAttribute('aria-labelledby') === 'Water Level' || table.getAttribute('aria-labelledby') === 'WaterLevel';
      });
    }, { timeout: 45000 });
    
    const allData = await page.evaluate(async (rainMaps) => {
      let extractedData = [];
      const extractedStations = new Set();

      const parseNumber = (value) => {
        const num = parseFloat((value || '').replace(/,/g, '').trim());
        return Number.isFinite(num) ? num : null;
      };

      const findWaterLevelTable = () => {
        return Array.from(document.querySelectorAll('table')).find(table => {
          const headers = Array.from(table.querySelectorAll('th')).map(th => th.innerText.trim());
          return headers.some(h => h.includes('ระดับน้ำ') || h.includes('เทียบตลิ่ง')) || table.getAttribute('aria-labelledby') === 'Water Level' || table.getAttribute('aria-labelledby') === 'WaterLevel';
        });
      };
      
      const now = new Date();
      const dateStr = now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
      const timeStr = now.toLocaleTimeString('th-TH', { hour12: false });
      const timestampStr = `${dateStr} ${timeStr}`;

      // ดึงข้อมูลฝนสะสม 3 วันจาก Widget ด้านบน (ถ้ามี) สำหรับ forecast 3 วัน
      const rainMap3Days = {};
      const rainMap7Days = {};
      const smallTags = document.querySelectorAll('small');
      smallTags.forEach(small => {
        let txt = small.innerText.trim();
        if (txt === 'ฝนสะสม 3 วัน' || txt === 'ฝนสะสม 7 วัน') {
          let container = small.parentElement;
          if (container) {
            let containerText = container.innerText.replace(/\r?\n|\r/g, ' ');
            let valMatch = containerText.match(/([\d\.]+)\s*\(มม\.\)/);
            let locMatch = containerText.match(/อ\.\s*([^\s]+)/);
            if (valMatch && locMatch) {
              let val = parseFloat(valMatch[1]);
              let amphoe = "อำเภอ" + locMatch[1].trim();
              if (txt === 'ฝนสะสม 3 วัน') {
                rainMap3Days[amphoe] = Math.max(rainMap3Days[amphoe] || 0, val);
              } else {
                rainMap7Days[amphoe] = Math.max(rainMap7Days[amphoe] || 0, val);
              }
            }
          }
        }
      });

      let previousStationsString = '';
      while (true) {
        const targetTable = findWaterLevelTable();
        
        if (!targetTable) break;

        const rows = targetTable.querySelectorAll('tbody tr');
        if (rows.length === 0) break;

        let currentStations = [];
        for (const row of rows) {
          if (row.innerText.includes('แสดงผลหน้าละ')) continue;
          const cols = row.querySelectorAll('th, td');
          if (cols.length >= 9) {
            currentStations.push(cols[0].innerText.trim());
          }
        }

        const currentStationsString = JSON.stringify(currentStations);
        if (currentStations.length === 0 || currentStationsString === previousStationsString) {
          break;
        }
        previousStationsString = currentStationsString;
        rows.forEach(row => {
          if (row.innerText.includes('แสดงผลหน้าละ')) return;
          const cols = row.querySelectorAll('th, td');
          if (cols.length < 9) return;

          let stationName = cols[0].innerText.trim();
          if (extractedStations.has(stationName)) return; 
          extractedStations.add(stationName);
          
          let locationRaw = cols[1].innerText.trim();
          let amphoe = locationRaw.includes('อ.') ? "อำเภอ" + locationRaw.split('อ.')[1].trim() : locationRaw;
          
          let diffRaw = cols[6].innerText.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();
          let diff = diffRaw;

          let trendIcon = cols[7].querySelector('i');
          let trend = trendIcon ? trendIcon.getAttribute('title') || '' : cols[7].innerText.trim();
          if (trend.includes('ลดลง')) trend = 'ลดลง';
          else if (trend.includes('เพิ่มขึ้น')) trend = 'เพิ่มขึ้น';
          else if (trend.includes('ทรงตัว')) trend = 'คงที่';

          let diffMatch = diffRaw.match(/\d+(\.\d+)?/);
          let diffVal = diffMatch ? parseFloat(diffMatch[0]) : 0;
          
          // Map actual daily rainfall from the scraped rainfall data (rainMaps)
          let currentRain = null;
          if (rainMaps && rainMaps.subdistrictRainAvg) {
            let tambon = '';
            const lines = locationRaw.split('\n');
            lines.forEach(line => {
              const l = line.trim();
              if (l.startsWith('ต.')) {
                tambon = l.replace('ต.', '').trim();
              }
            });
            const subKey = `${tambon}_${amphoe}`;
            if (rainMaps.subdistrictRainAvg[subKey] !== undefined) {
              currentRain = rainMaps.subdistrictRainAvg[subKey];
            } else if (rainMaps.districtRainAvg[amphoe] !== undefined) {
              currentRain = rainMaps.districtRainAvg[amphoe];
            }
          }

          let forecastRain = rainMap3Days[amphoe] ?? null; // Legacy array slot: observed 3-day accumulation
          let totalRain = currentRain; // Do not add overlapping daily and 3-day observations

          let riskLevel = currentRain === null ? "ไม่มีข้อมูลฝน" : "ปกติ";
          if (totalRain > 90) riskLevel = "วิกฤตสีแดง";
          else if (totalRain > 35) riskLevel = "เฝ้าระวัง";
          else if (totalRain === 0) riskLevel = "ปกติ";

          extractedData.push([
            stationName, cols[2].innerText.trim(), amphoe, "ลำปาง",
            cols[3].innerText.trim(), cols[4].innerText.trim(), diff,
            trend, cols[5].innerText.trim(), cols[8].innerText.trim(),
            currentRain, forecastRain, totalRain, riskLevel, timestampStr
          ]);
        });
        
        const nextBtn = document.querySelector('button[aria-label="Next Page"]');
        if (!nextBtn || nextBtn.disabled) break;
        
        nextBtn.click();
        await new Promise(r => setTimeout(r, 800));
      }
      return extractedData;
    }, rainMaps);

    // 🛡️ Dual-Write: บันทึกทั้ง DB + Excel เสมอ (ป้องกันข้อมูลหาย)
    addLog('Puppeteer', `✅ ดึงข้อมูลสำเร็จจำนวน ${allData.length} รายการ กำลังบันทึกแบบ Dual-Write (DB + Excel)...`);
    await dualWriteWaterLevel(allData);
    if (rainMaps && rainMaps.rawStations && rainMaps.rawStations.length > 0) {
      addLog('Puppeteer', `✅ บันทึกข้อมูลฝนดิบจำนวน ${rainMaps.rawStations.length} รายการลง Database...`);
      await dualWriteRainfall(rainMaps.rawStations);
    }
  })();

  try {
    await Promise.race([coreProcess, timeoutPromise]);
    addLog('Puppeteer', '🎉 ทำงานเสร็จสมบูรณ์ ปิดเบราว์เซอร์ล่องหนแล้ว');
  } catch (error) {
    addLog('Puppeteer', '❌ เกิดข้อผิดพลาด: ' + error.message);
    throw error; // Re-throw to trigger retry mechanism
  } finally {
    clearTimeout(timeoutId);
    if (browser) {
      try {
        await safeCloseBrowser(browser);
      } catch (e) {
        // ignore
      }
    }
  }
}

let isRunningPuppeteerRainfall = false;
let lastRainfallFetchTrigger = 0;
global.lastRainfallDataReceived = 0;

async function triggerRainfallFetch(mode = 'db') {
  addLog('Node.js', `⏳ เริ่มกระบวนการดึงข้อมูลเฉพาะปริมาณน้ำฝนลง ${mode === 'db' ? 'Database' : 'Excel'} (Triggered)`);
  
  if (isExtensionConnected()) {
    addLog('Node.js', `📡 ส่งคำสั่งดึงฝนเท่านั้นไปยัง Chrome Extension...`);
    io.to('collectors').emit('FETCH_RAINFALL_DB', { timestamp: Date.now() });
    
    lastRainfallFetchTrigger = Date.now();
    
    setTimeout(() => {
      if (!global.lastRainfallDataReceived || (Date.now() - global.lastRainfallDataReceived > 90000)) {
        addLog('Node.js', '⚠️ Extension ไม่ตอบสนองใน 90 วินาที กำลังสลับไปใช้ Puppeteer (Rainfall Only)...');
        runPuppeteerRainfallOnlyFallback(mode);
      }
    }, 90000);
  } else {
    addLog('Node.js', '⚠️ Extension ไม่ได้เชื่อมต่อ สั่งรัน Puppeteer (Rainfall Only) ทันที!');
    runPuppeteerRainfallOnlyFallback(mode);
  }
}

async function runPuppeteerRainfallOnlyFallback(mode = 'db') {
  if (isRunningPuppeteerRainfall) {
    addLog('Puppeteer', '⚠️ มีระบบดึงข้อมูลปริมาณฝนกำลังทำงานอยู่แล้ว ข้ามการทำงานซ้ำซ้อน');
    return;
  }
  isRunningPuppeteerRainfall = true;
  let browser;
  try {
    const isOnline = await checkInternetConnection();
    if (!isOnline) {
      addLog('Puppeteer', '⚠️ [Pre-flight] ตรวจสอบพบสัญญาณอินเทอร์เน็ตขาดหาย งดเริ่มทำงานของเบราว์เซอร์ล่องหนเพื่อประหยัดทรัพยากรเครื่อง');
      throw new Error('Internet Connection Offline');
    }

    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.setDefaultTimeout(45000);

    addLog('Puppeteer', '⏳ เริ่มดึงข้อมูลปริมาณน้ำฝน (https://lampang.thaiwater.net/rainfall)...');
    await page.goto('https://lampang.thaiwater.net/rainfall', { waitUntil: 'networkidle2' });
    await page.waitForSelector('table', { timeout: 45000 });
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll('table')).some(table => {
        const headers = Array.from(table.querySelectorAll('th')).map(th => th.innerText.trim());
        return headers.includes('ฝนสะสม (มม.)') || headers.includes('ปริมาณฝน') || table.getAttribute('aria-labelledby') === 'Rainfall';
      });
    }, { timeout: 45000 });
    
    const rainMaps = await page.evaluate(async () => {
      const subdistrictRain = {};
      const districtRain = {};
      const rawStations = [];
      const extractedStations = new Set();
      let totalStationCount = 0;

      const parseRain = (value) => {
        const num = parseFloat((value || '').replace(/,/g, '').trim());
        return Number.isFinite(num) ? num : null;
      };

      const findRainfallTable = () => {
        return Array.from(document.querySelectorAll('table')).find(table => {
          const headers = Array.from(table.querySelectorAll('th')).map(th => th.innerText.trim());
          return headers.includes('ฝนสะสม (มม.)') || headers.includes('ปริมาณฝน') || table.getAttribute('aria-labelledby') === 'Rainfall';
        });
      };

      let targetTable = findRainfallTable();
      if (!targetTable) return { totalStations: 0, rawStations: [] };

      let previousStationsString = '';
      let noProgressRetries = 0;
      const MAX_NO_PROGRESS_RETRIES = 3;

      while (true) {
        targetTable = findRainfallTable() || targetTable;
        const rows = targetTable.querySelectorAll('tbody tr');

        let currentPageStations = [];
        rows.forEach(row => {
          if (row.innerText.includes('แสดงผลหน้าละ')) return;
          const cols = row.querySelectorAll('td, th');
          if (cols.length < 6) return;
          const stationName = (cols[0]?.innerText || '').trim();
          if (stationName) currentPageStations.push(stationName);
        });

        const currentStationsString = JSON.stringify(currentPageStations);
        if (currentPageStations.length === 0 || currentStationsString === previousStationsString) {
          noProgressRetries++;
          if (noProgressRetries >= MAX_NO_PROGRESS_RETRIES) break;
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        previousStationsString = currentStationsString;
        noProgressRetries = 0;

        rows.forEach(row => {
          if (row.innerText.includes('แสดงผลหน้าละ')) return;
          const cols = row.querySelectorAll('td, th');
          if (cols.length < 6) return;

          const stationName = (cols[0]?.innerText || '').trim();
          if (stationName && extractedStations.has(stationName)) return;
          if (stationName) extractedStations.add(stationName);

          const location = cols[1].innerText.trim();
          const rainText = cols[3].innerText.trim();
          const rainVal = parseRain(rainText);
          
          totalStationCount++;

          rawStations.push({
            station_name: stationName,
            location: location.replace(/\n/g, ' '),
            river_basin: (cols[2]?.innerText || '').trim(),
            rain_mm: rainVal,
            rain_status: (cols[4]?.innerText || '').trim(),
            measured_time: (cols[5]?.innerText || '').trim()
          });
        });
        
        const nextBtn = document.querySelector('button[aria-label="Next Page"]') || document.querySelector('button[aria-label="Next page"]');
        if (!nextBtn || nextBtn.disabled || nextBtn.getAttribute('aria-disabled') === 'true') {
          break;
        }
        nextBtn.click();
        await new Promise(r => setTimeout(r, 2500));
      }
      
      return { totalStations: totalStationCount, rawStations };
    });

    addLog('Puppeteer', `✅ ดึงข้อมูลน้ำฝนเสร็จสิ้น (สถานีฝน: ${rainMaps.totalStations || 0} แห่ง)`);
    
    if (rainMaps && rainMaps.rawStations && rainMaps.rawStations.length > 0) {
      addLog('Puppeteer', `✅ บันทึกข้อมูลฝนดิบจำนวน ${rainMaps.rawStations.length} รายการแบบ Dual-Write...`);
      await dualWriteRainfall(rainMaps.rawStations);
      global.lastRainfallDataReceived = Date.now();
      logTaskRun("ดึงข้อมูลปริมาณน้ำฝน (Puppeteer Rainfall Only)", mode, "success", rainMaps.rawStations.length, `ดึงข้อมูลปริมาณน้ำฝนสำเร็จจำนวน ${rainMaps.rawStations.length} รายการ`);
    } else {
      logTaskRun("ดึงข้อมูลปริมาณน้ำฝน (Puppeteer Rainfall Only)", mode, "success", 0, "ไม่พบข้อมูลปริมาณน้ำฝนในการดึง");
    }
  } catch (err) {
    addLog('Puppeteer', '❌ เกิดข้อผิดพลาดในการดึงข้อมูลน้ำฝน: ' + err.message);
    logTaskRun("ดึงข้อมูลปริมาณน้ำฝน (Puppeteer Rainfall Only)", mode, "failed", 0, `ล้มเหลว: ${err.message}`);
  } finally {
    if (browser) {
      await safeCloseBrowser(browser);
    }
    isRunningPuppeteerRainfall = false;
  }
}

// Start auto-fetch process for drought
async function triggerDroughtDataFetch(mode = 'excel') {
  addLog('Node.js', `⏳ เริ่มกระบวนการเก็บข้อมูลภัยแล้งลง ${mode === 'db' ? 'Database' : 'Excel'} (Triggered)`);
  
  if (isExtensionConnected()) {
    addLog('Node.js', `📡 ส่งคำสั่งเก็บข้อมูลภัยแล้งไปยัง Chrome Extension (${mode === 'db' ? 'Database' : 'Excel'} Mode)...`);
    io.to('collectors').emit(mode === 'db' ? 'FETCH_DROUGHT_DB' : 'FETCH_DROUGHT_EXCEL', { timestamp: Date.now() });
    
    global.lastFetchTrigger = Date.now();
    
    setTimeout(() => {
      if (!global.lastDroughtDataReceived || (Date.now() - global.lastDroughtDataReceived > 120000)) {
        addLog('Node.js', '⚠️ Extension ไม่ตอบสนองใน 120 วินาที กำลังสลับไปใช้ Puppeteer ดึงภัยแล้ง...');
        runDroughtPuppeteerFallback(mode);
      }
    }, 120000); // เพิ่มจาก 30s เป็น 120s เพราะ Extension ต้อง navigate+รอ SPA+pagination ใช้เวลานานขึ้น
  } else {
    addLog('Node.js', '⚠️ Extension ไม่ได้เชื่อมต่อ (หน้าเว็บอาจปิดอยู่) สั่งรัน Puppeteer ดึงภัยแล้งทันที!');
    runDroughtPuppeteerFallback(mode);
  }
}

let isRunningPuppeteerDrought = false;
// Fallback logic for drought using Puppeteer (with Finite Retry + Lock)
async function runDroughtPuppeteerFallback(mode = 'excel') {
  if (isRunningPuppeteerDrought) {
    addLog('Puppeteer', '⚠️ มีระบบดึงข้อมูลภัยแล้งกำลังทำงานอยู่แล้ว ข้ามการทำงานซ้ำซ้อน');
    return;
  }
  isRunningPuppeteerDrought = true;
  try {
    await withRetry(async () => {
      await _runDroughtPuppeteerFallbackCore(mode);
    }, { infinite: false, maxRetries: 3, backoffMs: [15000, 30000, 60000], label: 'ดึงข้อมูลภัยแล้ง (Puppeteer)' });
  } catch (err) {
    addLog('Puppeteer', `❌ ดึงข้อมูลภัยแล้ง (Puppeteer) ล้มเหลวทั้งหมด 3 ครั้ง: ${err.message}`);
    logTaskRun("ดึงข้อมูลภัยแล้ง (Puppeteer Fallback)", mode, "failed", 0, `ล้มเหลวในการดึงข้อมูลทั้งหมด 3 ครั้ง: ${err.message}`);
  } finally {
    isRunningPuppeteerDrought = false;
  }
}

async function _runDroughtPuppeteerFallbackCore(mode = 'excel') {
  // Pre-flight internet check
  const isOnline = await checkInternetConnection();
  if (!isOnline) {
    addLog('Puppeteer', '⚠️ [Pre-flight] ตรวจสอบพบสัญญาณอินเทอร์เน็ตขาดหาย งดเริ่มทำงานของเบราว์เซอร์ล่องหนเพื่อประหยัดทรัพยากรเครื่อง');
    throw new Error('Internet Connection Offline');
  }

  addLog('Puppeteer', '🤖 กำลังเปิดเบราว์เซอร์ล่องหนดึงข้อมูลภัยแล้ง (Headless Mode)...');
  let browser;
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(async () => {
      addLog('Puppeteer', '🚨 [Timeout] การดึงข้อมูลภัยแล้งใช้เวลาเกิน 2 นาที สั่งปิดบราวเซอร์ล่องหน...');
      if (browser) {
        try {
          await safeCloseBrowser(browser);
          browser = null;
        } catch (e) {
          console.error('Error closing browser on timeout:', e);
        }
      }
      reject(new Error('Safety Timeout Exceeded (120000ms)'));
    }, 120000);
  });

  const coreProcess = (async () => {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.setDefaultTimeout(45000);
    await page.goto('https://lampang.thaiwater.net/dam', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    console.log('Scraping drought/dam page via Puppeteer fallback...');
    
    addLog('Puppeteer', '⏳ รอโหลดตารางข้อมูลภัยแล้ง...');
    // รอตารางและ tbody row ปรากฏ (ไม่ใช่แค่ table ว่างเปล่า)
    await page.waitForSelector('table[aria-labelledby="dam"] tbody tr, #dashboard table tbody tr', { timeout: 45000 });
    // รอเพิ่มเติม 8 วินาที เพื่อให้ SPA โหลดข้อมูลทั้งหมดและ pagination ปุ่ม render
    await new Promise(r => setTimeout(r, 8000));
    
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

    const allRowsData = [];
    const extractedDams = new Set();
    let previousDamsString = '';

    while (true) {
      const pageDams = await page.evaluate(() => {
        const targetTable = document.querySelector('table[aria-labelledby="dam"]') || document.querySelector('#dashboard table');
        if (!targetTable) return [];

        const rows = targetTable.querySelectorAll('tbody tr');
        let currentCategory = '';
        const dams = [];

        rows.forEach(row => {
          const subtabText = row.querySelector('.subtab-text');
          if (subtabText) {
            currentCategory = subtabText.innerText.replace(/\(.*\)/, '').trim();
            return;
          }

          const firstCell = row.querySelector('td, th');
          if (firstCell && firstCell.innerText.includes('รวม')) {
            return;
          }

          const nameCell = row.querySelector('th[scope="row"]');
          if (!nameCell) return;

          const damName = nameCell.innerText.trim();
          const cells = row.querySelectorAll('th, td');
          if (cells.length < 6) return;

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

          dams.push({
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

        return dams;
      });

      if (pageDams.length === 0) {
        break;
      }

      const currentDamsString = JSON.stringify(pageDams.map(d => d.name));
      if (currentDamsString === previousDamsString) {
        break;
      }
      previousDamsString = currentDamsString;

      pageDams.forEach(dam => {
        if (extractedDams.has(dam.name)) return;
        extractedDams.add(dam.name);
        allRowsData.push([
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
      });

      const clicked = await page.evaluate(() => {
        // ลองหาปุ่ม Next Page หลายรูปแบบ (aria-label ทั้ง uppercase/lowercase)
        const btn = document.querySelector('button[aria-label="Next Page"]')
                 || document.querySelector('button[aria-label="Next page"]')
                 || Array.from(document.querySelectorAll('button')).find(b =>
                      (b.getAttribute('aria-label') || '').toLowerCase().includes('next')
                    );
        if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
          btn.click();
          return true;
        }
        return false;
      });

      if (!clicked) {
        break;
      }
      // เพิ่มจาก 2000ms เป็น 3000ms เพื่อให้ SPA render หน้าใหม่เสร็จ
      await new Promise(r => setTimeout(r, 3000));
    }

    // 🛡️ Dual-Write: บันทึกทั้ง DB + Excel เสมอ (ป้องกันข้อมูลหาย)
    addLog('Puppeteer', `✅ ดึงข้อมูลภัยแล้งสำเร็จ ${allRowsData.length} รายการ กำลังบันทึกแบบ Dual-Write (DB + Excel)...`);
    await dualWriteDrought(allRowsData);
  })();

  try {
    await Promise.race([coreProcess, timeoutPromise]);
    addLog('Puppeteer', '🎉 ทำงานดึงข้อมูลภัยแล้งเสร็จสมบูรณ์ ปิดเบราว์เซอร์ล่องหนแล้ว');
  } catch (error) {
    addLog('Puppeteer', '❌ เกิดข้อผิดพลาดในการดึงข้อมูลภัยแล้ง: ' + error.message);
    throw error; // Re-throw to trigger retry mechanism
  } finally {
    clearTimeout(timeoutId);
    if (browser) {
      try {
        await safeCloseBrowser(browser);
      } catch (e) {
        // ignore
      }
    }
  }
}

// Start auto-fetch process for PM 2.5
async function triggerPM25DataFetch(mode = 'excel') {
  addLog('Node.js', `⏳ เริ่มกระบวนการเก็บข้อมูล PM 2.5 ลง ${mode === 'db' ? 'Database' : 'Excel'} (Triggered)`);
  
  if (isExtensionConnected()) {
    addLog('Node.js', `📡 ส่งคำสั่งเก็บข้อมูล PM 2.5 ไปยัง Chrome Extension (${mode === 'db' ? 'Database' : 'Excel'} Mode)...`);
    io.to('collectors').emit(mode === 'db' ? 'FETCH_PM25_DB' : 'FETCH_PM25_EXCEL', { timestamp: Date.now() });
    
    global.lastFetchTrigger = Date.now();
    
    setTimeout(() => {
      if (!global.lastPM25DataReceived || (Date.now() - global.lastPM25DataReceived > 90000)) {
        addLog('Node.js', '⚠️ Extension ไม่ตอบสนองใน 90 วินาที กำลังสลับไปใช้ Puppeteer ดึง PM 2.5...');
        runPM25PuppeteerFallback(mode);
      }
    }, 90000); // เพิ่มจาก 30s เป็น 90s เพราะ Extension ต้อง navigate+รอโหลด+pagination
  } else {
    addLog('Node.js', '⚠️ Extension ไม่ได้เชื่อมต่อ (หน้าเว็บอาจปิดอยู่) สั่งรัน Puppeteer ดึง PM 2.5 ทันที!');
    runPM25PuppeteerFallback(mode);
  }
}

let isRunningPuppeteerPM25 = false;
// Fallback logic for PM 2.5 using Puppeteer (with Finite Retry + Lock)
async function runPM25PuppeteerFallback(mode = 'excel') {
  if (isRunningPuppeteerPM25) {
    addLog('Puppeteer', '⚠️ มีระบบดึงข้อมูล PM 2.5 กำลังทำงานอยู่แล้ว ข้ามการทำงานซ้ำซ้อน');
    return;
  }
  isRunningPuppeteerPM25 = true;
  try {
    await withRetry(async () => {
      await _runPM25PuppeteerFallbackCore(mode);
    }, { infinite: false, maxRetries: 3, backoffMs: [15000, 30000, 60000], label: 'ดึงข้อมูล PM 2.5 (Puppeteer)' });
  } catch (err) {
    addLog('Puppeteer', `❌ ดึงข้อมูล PM 2.5 (Puppeteer) ล้มเหลวทั้งหมด 3 ครั้ง: ${err.message}`);
    logTaskRun("ดึงข้อมูล PM 2.5 (Puppeteer Fallback)", mode, "failed", 0, `ล้มเหลวในการดึงข้อมูลทั้งหมด 3 ครั้ง: ${err.message}`);
  } finally {
    isRunningPuppeteerPM25 = false;
  }
}

async function _runPM25PuppeteerFallbackCore(mode = 'excel') {
  // Pre-flight internet check
  const isOnline = await checkInternetConnection();
  if (!isOnline) {
    addLog('Puppeteer', '⚠️ [Pre-flight] ตรวจสอบพบสัญญาณอินเทอร์เน็ตขาดหาย งดเริ่มทำงานของเบราว์เซอร์ล่องหนเพื่อประหยัดทรัพยากรเครื่อง');
    throw new Error('Internet Connection Offline');
  }

  addLog('Puppeteer', '🤖 กำลังเปิดเบราว์เซอร์ล่องหนดึงข้อมูล PM 2.5 (Headless Mode)...');
  let browser;
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(async () => {
      addLog('Puppeteer', '🚨 [Timeout] การดึงข้อมูล PM 2.5 ใช้เวลาเกิน 2 นาที สั่งปิดบราวเซอร์ล่องหน...');
      if (browser) {
        try {
          await safeCloseBrowser(browser);
          browser = null;
        } catch (e) {
          console.error('Error closing browser on timeout:', e);
        }
      }
      reject(new Error('Safety Timeout Exceeded (120000ms)'));
    }, 120000);
  });

  const coreProcess = (async () => {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.setDefaultTimeout(45000);
    await page.goto('https://lampang.thaiwater.net/pm', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    console.log('Scraping PM 2.5 page via Puppeteer fallback...');
    
    addLog('Puppeteer', '⏳ รอโหลดตารางข้อมูล PM 2.5...');
    await page.waitForSelector('table', { timeout: 45000 });
    await new Promise(r => setTimeout(r, 8000)); // Extra wait for full SPA data render
    
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

    const allRowsData = [];
    const extractedStations = new Set();
    let previousStationsString = '';

    while (true) {
      const pageStations = await page.evaluate(() => {
        const tables = document.querySelectorAll('table');
        let targetTable = null;
        for (const t of tables) {
          if (t.innerText.includes('สถานี') && t.innerText.includes('PM 2.5')) {
            targetTable = t;
            break;
          }
        }
        
        if (!targetTable) return [];

        const rows = targetTable.querySelectorAll('tbody tr');
        const stations = [];

        rows.forEach(row => {
          if (row.innerText.includes('แสดงผลหน้าละ')) return;

          const cells = row.querySelectorAll('th, td');
          if (cells.length < 5) return;

          const stationName = cells[0].innerText.trim();
          const locationRaw = cells[1].innerText.trim();
          const timeLabel = cells[2].innerText.trim();
          const pm25Value = cells[3].innerText.trim();
          const pm25Avg24h = cells[4].innerText.trim();

          stations.push({
            name: stationName,
            location: locationRaw,
            time: timeLabel,
            pm25: pm25Value,
            pm25Avg: pm25Avg24h
          });
        });

        return stations;
      });

      if (pageStations.length === 0) {
        break;
      }

      const currentStationsString = JSON.stringify(pageStations.map(s => s.name));
      if (currentStationsString === previousStationsString) {
        break;
      }
      previousStationsString = currentStationsString;

      let newStationsAdded = 0;
      pageStations.forEach(station => {
        if (extractedStations.has(station.name)) return;
        extractedStations.add(station.name);
        newStationsAdded++;

        // Parse tambon and amphoe
        let tambon = '';
        let amphoe = '';
        const lines = station.location.split('\n');
        lines.forEach(line => {
          const l = line.trim();
          if (l.startsWith('ต.')) {
            tambon = l.replace('ต.', '').trim();
          } else if (l.startsWith('อ.')) {
            amphoe = "อำเภอ" + l.replace('อ.', '').trim();
          }
        });

        if (!amphoe && station.location.includes('อ.')) {
          amphoe = "อำเภอ" + station.location.split('อ.')[1].trim();
        }

        // Air Quality status calculation
        const parseNum = (val) => {
          const num = parseFloat(val);
          return isNaN(num) ? 0 : num;
        };
        const pmVal = parseNum(station.pm25);
        let status = 'ไม่ทราบค่า';
        if (pmVal <= 15.0) status = 'ดีมาก';
        else if (pmVal <= 25.0) status = 'ดี';
        else if (pmVal <= 37.5) status = 'ปานกลาง';
        else if (pmVal <= 75.0) status = 'เริ่มมีผลต่อสุขภาพ';
        else if (pmVal > 75.0) status = 'มีผลกระทบต่อสุขภาพ';

        allRowsData.push([
          dateStr,
          isoStr,
          station.name,
          tambon,
          amphoe,
          'ลำปาง',
          station.time,
          station.pm25,
          station.pm25Avg,
          status
        ]);
      });

      if (newStationsAdded === 0) {
        break;
      }

      const clicked = await page.evaluate(() => {
        const ts = document.querySelectorAll('table');
        let target = null;
        for (const t of ts) {
          if (t.innerText.includes('สถานี') && t.innerText.includes('PM 2.5')) {
            target = t;
            break;
          }
        }
        if (!target) return false;
        
        const container = target.closest('.v-data-table') || target.parentElement;
        const btn = container.querySelector('button[aria-label="Next page"]') || container.querySelector('button[aria-label="Next Page"]');
        if (btn && !btn.disabled) {
          btn.click();
          return true;
        }
        return false;
      });

      if (!clicked) {
        break;
      }
      await new Promise(r => setTimeout(r, 2500));
    }

    // 🛡️ Dual-Write: บันทึกทั้ง DB + Excel เสมอ (ป้องกันข้อมูลหาย)
    addLog('Puppeteer', `✅ ดึงข้อมูล PM 2.5 สำเร็จ ${allRowsData.length} รายการ กำลังบันทึกแบบ Dual-Write (DB + Excel)...`);
    await dualWritePM25(allRowsData);
  })();

  try {
    await Promise.race([coreProcess, timeoutPromise]);
    addLog('Puppeteer', '🎉 ทำงานดึงข้อมูล PM 2.5 เสร็จสมบูรณ์ ปิดเบราว์เซอร์ล่องหนแล้ว');
  } catch (error) {
    addLog('Puppeteer', '❌ เกิดข้อผิดพลาดในการดึงข้อมูล PM 2.5: ' + error.message);
    throw error; // Re-throw to trigger retry mechanism
  } finally {
    clearTimeout(timeoutId);
    if (browser) {
      try {
        await safeCloseBrowser(browser);
      } catch (e) {
        // ignore
      }
    }
  }
}


async function fetchTicketTimeline(ticketId) {
  // 250ms delay to avoid rate limit
  await new Promise(r => setTimeout(r, 250));
  
  const url = `https://publicapi.traffy.in.th/teamchadchart-stat-api/detail-timeline/v1?ticket_id=${encodeURIComponent(ticketId)}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Origin': 'https://bangkok.traffy.in.th',
        'Referer': 'https://bangkok.traffy.in.th/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) {
      throw new Error(`API status ${res.status}`);
    }
    const json = await res.json();
    return json;
  } catch (err) {
    console.error(`Failed to fetch timeline for ticket ${ticketId}:`, err.message);
    return null;
  }
}

// Insert Complaints data into MySQL Database


// Trigger complaints data fetch via Chrome Extension (with automatic Puppeteer fallback)
let isRunningComplaintsFallback = false;

async function runComplaintsPuppeteerFallback(mode = 'db') {
  if (isRunningComplaintsFallback) {
    addLog('Puppeteer', '⚠️ ระบบดึงข้อมูลเรื่องร้องเรียนกำลังทำงานอยู่แล้ว ข้ามรอบนี้');
    return;
  }
  isRunningComplaintsFallback = true;
  try {
    await withRetry(async () => {
      await _runComplaintsPuppeteerFallbackCore(mode);
    }, { infinite: false, maxRetries: 3, backoffMs: [15000, 30000, 60000], label: 'ดึงข้อมูลเรื่องร้องเรียน (Puppeteer)' });
  } catch (err) {
    addLog('Puppeteer', `❌ ดึงข้อมูลเรื่องร้องเรียนล้มเหลว: ${err.message}`);
    logTaskRun("ดึงข้อมูลเรื่องร้องเรียน (Puppeteer Fallback)", mode, "failed", 0, `ล้มเหลว: ${err.message}`);
    throw err;
  } finally {
    isRunningComplaintsFallback = false;
  }
}

async function _runComplaintsPuppeteerFallbackCore(mode = 'db') {
  const isOnline = await checkInternetConnection();
  if (!isOnline) {
    addLog('Puppeteer', '⚠️ [Pre-flight] ตรวจสอบพบสัญญาณอินเทอร์เน็ตขาดหาย');
    throw new Error('Internet Connection Offline');
  }

  addLog('Puppeteer', '🤖 เริ่มต้นการดึงข้อมูลเรื่องร้องเรียน Traffy Fondue (Puppeteer Fallback)...');
  let browser;
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(async () => {
      addLog('Puppeteer', '🚨 [Timeout] การดึงข้อมูลเรื่องร้องเรียนใช้เวลาเกิน 2 นาที');
      if (browser) {
        try {
          await safeCloseBrowser(browser);
          browser = null;
        } catch (e) {}
      }
      reject(new Error('Safety Timeout Exceeded (120000ms)'));
    }, 120000);
  });

  const coreProcess = (async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1000 });
    await page.setDefaultTimeout(45000);

    addLog('Puppeteer', '⏳ นำทางไปยัง https://citydata.traffy.in.th/recent-post ...');
    await page.goto('https://citydata.traffy.in.th/recent-post', { waitUntil: 'networkidle2' });
    if (/\/(login|signin)(?:\/|$|\?)/i.test(page.url())) {
      throw Object.assign(new Error('Traffy ต้องเข้าสู่ระบบ: Puppeteer ถูกส่งไปหน้า login กรุณาจับคู่ Traffy Extension กับ Water System แล้วเปิดหน้า Traffy ที่เข้าสู่ระบบแล้ว'), { code: 'TRAFFY_AUTH_REQUIRED', retryable: false });
    }

    // Expand filter and set date range (05/01/2026 - 09/30/2026)
    await page.evaluate(() => {
      const toggleFilterBtn = document.querySelector('[class*="toggleFilterBtn"]') || 
                              Array.from(document.querySelectorAll('button')).find(btn => btn.innerText.includes('ตัวกรอง'));
      if (toggleFilterBtn) toggleFilterBtn.click();

      const dateInput = document.querySelector('input[placeholder="เลือกวันที่เริ่มต้น - สิ้นสุด"]');
      if (dateInput) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        nativeInputValueSetter.call(dateInput, "05/01/2026 - 09/30/2026");
        dateInput.dispatchEvent(new Event('input', { bubbles: true }));
        dateInput.dispatchEvent(new Event('change', { bubbles: true }));
        const saveFilterBtn = document.querySelector('button[class*="saveFilterBtn"]') || 
                              Array.from(document.querySelectorAll('button')).find(btn => btn.innerText.includes('บันทึกเงื่อนไข'));
        if (saveFilterBtn) saveFilterBtn.click();
      }
    });
    await new Promise(r => setTimeout(r, 2000));

    // Select Lampang in province dropdown
    const selected = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      for (const s of selects) {
        const hasOption = Array.from(s.options).some(opt => opt.value === 'ลำปาง' || (opt.text && opt.text.includes('ลำปาง')));
        if (hasOption) {
          s.value = 'ลำปาง';
          s.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      return false;
    });

    if (selected) {
      addLog('Puppeteer', "📍 เลือกจังหวัด 'ลำปาง' สำเร็จ กำลังรอโหลดข้อมูล 4 วินาที...");
      await new Promise(r => setTimeout(r, 4000));
    }

    // Scroll down to load recent cards
    for (let scroll = 0; scroll < 3; scroll++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(r => setTimeout(r, 2000));
    }

    const complaints = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[class*="PostCard_cardGrid"], [class*="cardGrid"], [class*="PostCard_postCard"], [class*="PostCard_card"]'));
      const results = [];
      const extracted = new Set();

      cards.forEach(card => {
        const ticketIdEl = card.querySelector('[class*="PostCard_ticketId"], [class*="ticketId"]') ||
                           Array.from(card.querySelectorAll('span, div, p')).find(el => el.innerText && el.innerText.trim().startsWith('#202'));
        if (!ticketIdEl) return;
        const match = ticketIdEl.innerText.trim().match(/#([A-Za-z0-9\-]+)/);
        if (!match) return;
        const ticketId = match[1];
        if (extracted.has(ticketId)) return;
        extracted.add(ticketId);

        const stateEl = card.querySelector('[class*="PostCard_stateBadge"], [class*="stateBadge"]');
        const problemTypeEl = card.querySelector('[class*="PostCard_problemTypeTag"], [class*="problemTypeTag"]');
        const descEl = card.querySelector('[class*="PostCard_descText"], [class*="descText"]');
        const imgEl = card.querySelector('img[class*="PostCard_postImgGrid"], img');
        const locationEl = card.querySelector('[class*="PostCard_locationText"], [class*="locationText"]');

        const orgDiv = Array.from(card.querySelectorAll('div, p')).find(el => el.innerText.includes('รับผิดชอบปัจจุบัน:'));
        let orgName = 'อบจ.ลำปาง';
        if (orgDiv) orgName = orgDiv.innerText.replace('รับผิดชอบปัจจุบัน:', '').trim();

        let ticketDatetime = '';
        const metaCols = card.querySelectorAll('[class*="PostCard_metaCol"]');
        metaCols.forEach(col => {
          const label = col.querySelector('[class*="PostCard_metaLabel"]');
          if (label && label.innerText.includes('แจ้งเมื่อ')) {
            const valEl = col.querySelector('[class*="PostCard_metaValue"] span');
            if (valEl) ticketDatetime = valEl.innerText.trim();
          }
        });

        let satisfactionStars = '';
        const starEl = Array.from(card.querySelectorAll('[class*="PostCard_metaValue"]')).find(el => el.innerText.includes('⭐'));
        if (starEl) satisfactionStars = starEl.innerText.trim();

        results.push({
          ticket_id: ticketId,
          state_name: stateEl ? stateEl.innerText.trim() : 'รอรับเรื่อง',
          problem_type: problemTypeEl ? problemTypeEl.innerText.trim() : 'ทั่วไป',
          description: descEl ? descEl.innerText.trim() : '',
          photo_url: imgEl ? imgEl.src : '',
          location: locationEl ? locationEl.innerText.trim() : '',
          org_name: orgName,
          ticket_datetime: ticketDatetime,
          satisfaction_stars: satisfactionStars
        });
      });

      return results;
    });

    if (complaints && complaints.length > 0) {
      addLog('Puppeteer', `✅ ดึงข้อมูลเรื่องร้องเรียนลำปางสำเร็จ ${complaints.length} รายการ กำลังบันทึกแบบ Dual-Write...`);
      await dualWriteComplaints(complaints);
      logTaskRun("ดึงข้อมูลเรื่องร้องเรียน (Puppeteer Fallback)", mode, "success", complaints.length, `บันทึกเรื่องร้องเรียน ${complaints.length} รายการสำเร็จ`);
    } else {
      throw new Error('ไม่พบการ์ดเรื่องร้องเรียนบนหน้า Traffy หรือหน้าเว็บยังโหลดไม่ครบ');
    }
  })();

  try {
    await Promise.race([coreProcess, timeoutPromise]);
    addLog('Puppeteer', '🎉 กระบวนการดึงเรื่องร้องเรียนเสร็จสมบูรณ์');
  } catch (error) {
    addLog('Puppeteer', '❌ ข้อผิดพลาดในการดึงเรื่องร้องเรียน: ' + error.message);
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (browser) {
      try {
        await safeCloseBrowser(browser);
      } catch (e) {}
    }
  }
}

const complaintJob = createComplaintJob({
  isConnected: isTraffyExtensionConnected,
  send: sendComplaintsRequest || (payload => { io.to('traffy-collectors').emit('FETCH_COMPLAINTS_DB', payload); }),
  fallback: runComplaintsPuppeteerFallback,
  log: message => addLog('Node.js', message)
});
const triggerComplaintsDataFetch = complaintJob.run;
const notifyComplaintsResult = complaintJob.notify;
  return { triggerDataFetch, triggerRainfallFetch, triggerDroughtDataFetch, triggerPM25DataFetch, triggerComplaintsDataFetch, notifyComplaintsResult, fetchTicketTimeline };
}
