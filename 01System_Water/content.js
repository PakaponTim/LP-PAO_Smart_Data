(function () {
  try { // Top-level try-catch to guarantee UI injection
    const currentPath = window.location.pathname.replace(/\/$/, '');

    let topicName = "";
    let themeColor = "";
    let topicId = "";

    // 🛡️ ป้องกันชนกับส่วนขยาย TraffyLP: ถ้าอยู่บนเว็บ Traffy ให้ยกหน้าที่ให้ส่วนขยาย 04ext_TraffyLP จัดการทั้งหมด
    if (window.location.host.includes('traffy.in.th')) {
      return;
    }

    if (currentPath === '/complaint') {
      topicName = "ข้อมูลระบบร้องเรียน";
      themeColor = "#8b5cf6"; // Purple
      topicId = "complaint";
    } else if (currentPath === '/drought' || currentPath === '/dam') {
      topicName = "ข้อมูลภัยแล้ง";
      themeColor = "#f59e0b"; // Amber
      topicId = "drought";
    } else if (currentPath === '/fire') {
      topicName = "ข้อมูลหมอกควันไฟป่า";
      themeColor = "#ef4444"; // Red
      topicId = "fire";
    } else if (currentPath === '/pm' || currentPath === '/pm25') {
      topicName = "ข้อมูล PM 2.5";
      themeColor = "#10b981"; // Emerald
      topicId = "pm25";
    } else {
      // Default fallback theme and topic (for /wl, homepage "/", and all other subpaths on the domain)
      topicName = "ข้อมูลน้ำ";
      themeColor = "#3b82f6"; // Blue
      topicId = "water";
    }

    // Inject the HTML Panel
    const panelHTML = `
  <button id="water-sys-ext-toggle" style="background-color: ${themeColor};">ดึง${topicName}</button>
  <div id="water-sys-ext-panel" class="hidden">
    <div id="water-sys-ext-header" style="background-color: ${themeColor}; display: flex; justify-content: space-between; align-items: center; padding: 10px 15px;">
      <span>ดึง${topicName}</span>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button id="btn-extract-html" style="background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.4); color: white; border-radius: 4px; padding: 2px 8px; font-size: 12px; cursor: pointer; transition: all 0.2s;">📄 ดึง DOM</button>
        <button id="water-sys-ext-close" style="background: none; border: none; color: white; font-size: 20px; cursor: pointer; line-height: 1;">&times;</button>
      </div>
    </div>

    <!-- TABS NAVIGATION (Segmented Modern Style) -->
    <div class="ext-nav-container">
       <div class="ext-nav-item ${topicId === 'water' ? 'active-water' : ''}" data-url="/wl">💧 น้ำ</div>
       <div class="ext-nav-item ${topicId === 'drought' ? 'active-drought' : ''}" data-url="/drought">☀️ ภัยแล้ง</div>
       <div class="ext-nav-item ${topicId === 'fire' ? 'active-fire' : ''}" data-url="/fire">🔥 ไฟป่า</div>
       <div class="ext-nav-item ${topicId === 'pm25' ? 'active-pm25' : ''}" data-url="/pm25">💨 PM 2.5</div>
       <div class="ext-nav-item ${topicId === 'complaint' ? 'active-complaint' : ''}" data-url="/complaint">💬 ร้องเรียน</div>
    </div>
    <div id="water-sys-ext-content">
      <p style="font-size: 14px; color: #475569;">ใช้เครื่องมือด้านล่างหรือกดปุ่ม <b>Alt+X</b> เพื่อคัดลอกข้อมูลบนหน้าเว็บและส่งให้ AI</p>
      
      <!-- ปุ่มดึงข้อมูลแยกตามหมวดหมู่ (Tabs) -->
      <div id="buttons-water" class="tab-button-group" style="display: none;">
        <button class="water-sys-btn btn-export-excel-trigger" data-topic="water" style="background-color: #10b981; color: white; border: none;">💧 ดึงข้อมูลระดับน้ำ (Excel)</button>
        <button class="water-sys-btn btn-export-db-trigger" data-topic="water" style="background-color: #3b82f6; color: white; border: none; margin-top: 5px;">💧 บันทึกระดับน้ำเข้า Database</button>
      </div>

      <div id="buttons-drought" class="tab-button-group" style="display: none;">
        <button class="water-sys-btn btn-export-excel-trigger" data-topic="drought" style="background-color: #f59e0b; color: white; border: none;">☀️ ดึงข้อมูลภัยแล้ง (Excel)</button>
        <button class="water-sys-btn btn-export-db-trigger" data-topic="drought" style="background-color: #3b82f6; color: white; border: none; margin-top: 5px;">☀️ บันทึกภัยแล้งเข้า Database</button>
      </div>

      <div id="buttons-fire" class="tab-button-group" style="display: none;">
        <button class="water-sys-btn btn-export-excel-trigger" data-topic="fire" style="background-color: #ef4444; color: white; border: none;">🔥 ดึงข้อมูลไฟป่า (Excel)</button>
        <button class="water-sys-btn btn-export-db-trigger" data-topic="fire" style="background-color: #3b82f6; color: white; border: none; margin-top: 5px;">🔥 บันทึกไฟป่าเข้า Database</button>
      </div>

      <div id="buttons-pm25" class="tab-button-group" style="display: none;">
        <button class="water-sys-btn btn-export-excel-trigger" data-topic="pm25" style="background-color: #059669; color: white; border: none;">💨 ดึงข้อมูล PM 2.5 (Excel)</button>
        <button class="water-sys-btn btn-export-db-trigger" data-topic="pm25" style="background-color: #3b82f6; color: white; border: none; margin-top: 5px;">💨 บันทึก PM 2.5 เข้า Database</button>
      </div>

      <div id="buttons-complaint" class="tab-button-group" style="display: none;">
        <button class="water-sys-btn btn-export-excel-trigger" data-topic="complaint" style="background-color: #7c3aed; color: white; border: none;">💬 ดึงข้อมูลเรื่องร้องเรียน (Excel)</button>
        <button class="water-sys-btn btn-export-db-trigger" data-topic="complaint" style="background-color: #3b82f6; color: white; border: none; margin-top: 5px;">💬 บันทึกเรื่องร้องเรียนเข้า Database</button>
      </div>

      <button id="btn-extract-text" class="water-sys-btn water-sys-btn-outline" style="margin-top: 10px;">คัดลอกเฉพาะข้อความ (Text)</button>
      
      <hr style="margin: 15px 0; border: 0; border-top: 1px solid #e2e8f0;">
      <p style="font-size: 14px; color: #475569; font-weight: bold; margin-bottom: 8px; margin-top: 0;">ระบบอัตโนมัติ (Automation)</p>
      <a href="http://localhost:7000" target="_blank" style="display: block; text-align: center; text-decoration: none; background-color: #3b82f6; color: white; padding: 10px; border-radius: 6px; font-size: 14px;">
         ⚙️ เปิดหน้าตั้งค่า Dashboard
      </a>
      <div id="node-connection-status" style="margin-top: 10px; font-size: 12px; text-align: center; color: #ef4444;">
        🔴 Node.js: ไม่ได้เชื่อมต่อ
      </div>

      <div id="water-sys-ext-status">คัดลอกเรียบร้อยแล้ว!</div>
    </div>
  </div>
`;

    const container = document.createElement('div');
    container.innerHTML = panelHTML;

    function setupPanel() {
      // Elements
      const panel = document.getElementById('water-sys-ext-panel');
      const toggleBtn = document.getElementById('water-sys-ext-toggle');
      const closeBtn = document.getElementById('water-sys-ext-close');
      const btnExtractHtml = document.getElementById('btn-extract-html');
      const btnExtractText = document.getElementById('btn-extract-text');
      const statusDiv = document.getElementById('water-sys-ext-status');

      if (!panel || !toggleBtn || !closeBtn) {
        console.error('❌ WaterSys: Panel elements not found after injection');
        return;
      }

      // Make these accessible to other functions
      window._waterSysPanel = panel;
      window._waterSysToggleBtn = toggleBtn;
      window._waterSysStatusDiv = statusDiv;
      window._waterSysBtnExtractHtml = btnExtractHtml;
      window._waterSysBtnExtractText = btnExtractText;

      // Toggle UI
      toggleBtn.addEventListener('click', () => {
        panel.classList.remove('hidden');
        toggleBtn.style.display = 'none';
        document.body.style.marginRight = '300px';
        document.body.style.transition = 'margin-right 0.3s ease-in-out';
      });

      closeBtn.addEventListener('click', () => {
        panel.classList.add('hidden');
        toggleBtn.style.display = 'block';
        document.body.style.marginRight = '0';
      });

      // Set initial visible button group
      document.querySelectorAll('.tab-button-group').forEach(group => {
        group.style.display = 'none';
      });
      const initialGroup = document.getElementById('buttons-' + topicId);
      if (initialGroup) {
        initialGroup.style.display = 'block';
      }

      // Data Topic Selection (No Navigation)
      document.querySelectorAll('.ext-nav-item').forEach(item => {
        item.addEventListener('click', () => {
          const targetUrl = item.getAttribute('data-url');

          const topicMappings = {
            '/wl': 'water',
            '/drought': 'drought',
            '/dam': 'drought',
            '/fire': 'fire',
            '/pm': 'pm25',
            '/pm25': 'pm25',
            '/complaint': 'complaint'
          };

          const newTopic = topicMappings[targetUrl];
          if (newTopic) {
            // Update the global topicId variable used by sendDataToServer
            topicId = newTopic;

            // Remove all active classes
            document.querySelectorAll('.ext-nav-item').forEach(tab => {
              tab.className = 'ext-nav-item';
            });

            // Add active class to clicked item
            item.classList.add('active-' + newTopic);

            // Switch visible button groups
            document.querySelectorAll('.tab-button-group').forEach(group => {
              group.style.display = 'none';
            });
            const activeGroup = document.getElementById('buttons-' + newTopic);
            if (activeGroup) {
              activeGroup.style.display = 'block';
            }
          }
        });
      });

      console.log('✅ WaterSys Extension panel setup complete');
    }

    // Ensure body is available before appending (SPA compatibility)
    // DO NOT inject WaterSys general UI if we are on Traffy Fondue domain to avoid UI overlapping with the specialized Traffy scraper.
    const isTraffyDomain = window.location.host.includes('traffy.in.th');
    if (!isTraffyDomain) {
      if (document.body) {
        document.body.appendChild(container);
        setupPanel();
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          document.body.appendChild(container);
          setupPanel();
        });
      }
    }

    // Extraction Logic
    function showStatus(text = "คัดลอกลงคลิปบอร์ดแล้ว!") {
      const statusDiv = window._waterSysStatusDiv || document.getElementById('water-sys-ext-status');
      if (!statusDiv) return;
      statusDiv.innerText = text;
      statusDiv.classList.add('show');
      setTimeout(() => statusDiv.classList.remove('show'), 3000);
    }

    async function copyToClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
        showStatus();
      } catch (err) {
        console.error('เกิดข้อผิดพลาดในการคัดลอก: ', err);
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showStatus();
      }
    }

    function extractHTML() {
      const bodyClone = document.body.cloneNode(true);
      const extPanel = bodyClone.querySelector('#water-sys-ext-panel');
      const extToggle = bodyClone.querySelector('#water-sys-ext-toggle');
      if (extPanel) extPanel.remove();
      if (extToggle) extToggle.remove();
      bodyClone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
      const htmlContent = bodyClone.innerHTML;
      copyToClipboard(htmlContent);
    }

    function extractText() {
      const bodyClone = document.body.cloneNode(true);
      const extPanel = bodyClone.querySelector('#water-sys-ext-panel');
      const extToggle = bodyClone.querySelector('#water-sys-ext-toggle');
      if (extPanel) extPanel.remove();
      if (extToggle) extToggle.remove();
      const textContent = bodyClone.innerText;
      copyToClipboard(textContent);
    }

    // ฟังก์ชันช่วย: รอให้ Element ปรากฏขึ้นบนหน้า (Polling)
    async function waitForElement(selector, timeoutMs = 15000) {
      const startTime = Date.now();
      while (Date.now() - startTime < timeoutMs) {
        const el = document.querySelector(selector);
        if (el) return el;
        await new Promise(r => setTimeout(r, 300));
      }
      return null;
    }

    // ฟังก์ชันช่วย: รอให้ตารางมีข้อมูลครบ (ไม่ว่างเปล่า)
    async function waitForTableRows(table, minRows = 1, timeoutMs = 20000) {
      const startTime = Date.now();
      while (Date.now() - startTime < timeoutMs) {
        const rows = table.querySelectorAll('tbody tr th[scope="row"]');
        if (rows.length >= minRows) return true;
        await new Promise(r => setTimeout(r, 400));
      }
      return false;
    }

    // ฟังก์ชันช่วย: รอให้พบบล็อกตารางจริง
    async function waitForTable(tableFinder, timeoutMs = 20000) {
      const startTime = Date.now();
      while (Date.now() - startTime < timeoutMs) {
        const table = tableFinder();
        if (table) return table;
        await new Promise(r => setTimeout(r, 400));
      }
      return null;
    }

    async function exportDroughtToExcel(isAuto = false) {
      // รอให้ตารางภัยแล้งปรากฏก่อน (SPA โหลดช้า)
      let targetTable = document.querySelector('table[aria-labelledby="dam"]') || document.querySelector('#dashboard table');
      if (!targetTable) {
        // รอไม่เกิน 20 วินาที
        targetTable = await waitForElement('table[aria-labelledby="dam"]', 20000)
                      || await waitForElement('#dashboard table', 5000);
      }
      if (!targetTable) {
        if (!isAuto) showStatus("❌ ไม่พบตารางข้อมูลอ่างเก็บน้ำบนหน้านี้ กรุณาเปิดหน้า https://lampang.thaiwater.net/dam");
        return null;
      }

      // รอให้ตารางมีข้อมูลจริง (ไม่ใช่แค่ skeleton)
      showStatus("⏳ รอข้อมูลอ่างเก็บน้ำโหลดเสร็จ...");
      await waitForTableRows(targetTable, 3, 20000);
      // รอเพิ่มเติม 2 วินาที ให้ pagination ปุ่ม render ครบ
      await new Promise(resolve => setTimeout(resolve, 2000));

      showStatus("กำลังดึงข้อมูลอ่างเก็บน้ำทุกหน้า... กรุณารอสักครู่");

      const headers = [
        'วันที่เก็บข้อมูล',
        'เวลา (ISO)',
        'ประเภทอ่าง',
        'ชื่ออ่าง',
        'ความจุ (ล้าน ลบ.ม.)',
        'ปริมาณน้ำไหลลงอ่าง',
        '%ปริมาณน้ำ เทียบ รนก.',
        'เปอร์เซ็นต์น้ำ (%)',
        '%ปริมาณน้ำใช้การ เทียบ รนก.',
        'ปริมาณน้ำระบาย (ล้าน ลบ.ม.)'
      ];
      let allRowsData = [headers];

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

      const extractedDams = new Set();
      let previousPageDamCount = 0;
      let noProgressRetries = 0;
      const MAX_NO_PROGRESS_RETRIES = 3;

      while (true) {
        const rows = targetTable.querySelectorAll('tbody tr');
        let currentCategory = '';

        rows.forEach(row => {
          // Check if it's a category header
          const subtabText = row.querySelector('.subtab-text');
          if (subtabText) {
            currentCategory = subtabText.innerText.replace(/\(.*\)/, '').trim();
            return;
          }

          // Skip summary rows
          const firstCell = row.querySelector('td, th');
          if (firstCell && firstCell.innerText.includes('รวม')) {
            return;
          }

          // Dam name cell
          const nameCell = row.querySelector('th[scope="row"]');
          if (!nameCell) return;

          const damName = nameCell.innerText.trim();
          if (extractedDams.has(damName)) return;
          extractedDams.add(damName);

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

          allRowsData.push([
            dateStr,
            isoStr,
            currentCategory,
            damName,
            capacity,
            inflow,
            waterVolume,
            waterPercent,
            usableWater,
            discharge
          ]);
        });

        // ตรวจสอบว่าหน้านี้ดึงข้อมูลใหม่ได้หรือไม่
        const currentCount = extractedDams.size;
        if (currentCount === previousPageDamCount) {
          noProgressRetries++;
          if (noProgressRetries >= MAX_NO_PROGRESS_RETRIES) break; // ไม่มีข้อมูลใหม่ 3 รอบ → หยุด
          await new Promise(r => setTimeout(r, 1000)); // รอแล้วลองอีกครั้ง
          continue;
        }
        previousPageDamCount = currentCount;
        noProgressRetries = 0;

        // หาปุ่มไปหน้าถัดไป (ลองทั้ง aria-label "Next Page" และ "Next page")
        const nextBtn = document.querySelector('button[aria-label="Next Page"]')
                     || document.querySelector('button[aria-label="Next page"]')
                     || Array.from(document.querySelectorAll('button')).find(b => 
                          (b.getAttribute('aria-label') || '').toLowerCase().includes('next')
                        );
        if (!nextBtn || nextBtn.disabled || nextBtn.getAttribute('aria-disabled') === 'true') {
          break;
        }

        nextBtn.click();
        showStatus(`📄 กำลังโหลดหน้าถัดไป... (ดึงได้ ${extractedDams.size} อ่าง)`);
        // รอนานขึ้น 2500ms เพื่อให้ SPA render หน้าใหม่เสร็จก่อนอ่านข้อมูล
        await new Promise(resolve => setTimeout(resolve, 2500));
      }

      if (isAuto) {
        return allRowsData;
      }

      // Manual call -> send directly to server
      try {
        showStatus("📡 กำลังส่งข้อมูลภัยแล้งไป Node.js...");
        const res = await waterApiFetch(`http://localhost:7000/api/append-drought-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(allRowsData)
        });

        if (res.ok) {
          showStatus("✅ บันทึกภัยแล้งลง Excel ต่อเนื่องสำเร็จ!");
          if (window._waterSysSocket) {
            window._waterSysSocket.emit('client_log', {
              source: 'Extension',
              message: `✅ ดึงข้อมูลภัยแล้ง ${allRowsData.length - 1} รายการ และบันทึกต่อเนื่องสำเร็จ`
            });
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.error || `HTTP ${res.status}`;
          throw new Error(errMsg);
        }
      } catch (e) {
        console.error(e);
        showStatus(`❌ ล้มเหลว: ${e.message}`);
      }
    }

    async function exportPM25ToExcel(isAuto = false) {
      const tables = document.querySelectorAll('table');
      let targetTable = null;
      for (const table of tables) {
        if (table.innerText.includes('สถานี') && table.innerText.includes('PM 2.5')) {
          targetTable = table;
          break;
        }
      }

      if (!targetTable) {
        if (!isAuto) showStatus("❌ ไม่พบตารางข้อมูลคุณภาพอากาศ PM 2.5 บนหน้านี้ กรุณาเปิดหน้า https://lampang.thaiwater.net/pm");
        return null;
      }

      showStatus("กำลังดึงข้อมูลคุณภาพอากาศ PM 2.5... กรุณารอสักครู่");

      const headers = [
        'วันที่เก็บข้อมูล',
        'เวลา (ISO)',
        'ชื่อสถานี',
        'ตำบล',
        'อำเภอ',
        'จังหวัด',
        'เวลาที่วัด',
        'PM 2.5 (µg/m³)',
        'เฉลี่ย 24 ชม. (µg/m³)',
        'คุณภาพอากาศ'
      ];
      let allRowsData = [headers];

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

      const extractedStations = new Set();

      while (true) {
        const rows = targetTable.querySelectorAll('tbody tr');

        rows.forEach(row => {
          if (row.innerText.includes('แสดงผลหน้าละ')) return;

          const cells = row.querySelectorAll('th, td');
          if (cells.length < 5) return;

          const stationName = cells[0].innerText.trim();
          if (extractedStations.has(stationName)) return;
          extractedStations.add(stationName);

          const locationRaw = cells[1].innerText.trim();
          const timeLabel = cells[2].innerText.trim();
          const pm25Value = cells[3].innerText.trim();
          const pm25Avg24h = cells[4].innerText.trim();

          // Parse tambon and amphoe
          let tambon = '';
          let amphoe = '';
          const lines = locationRaw.split('\n');
          lines.forEach(line => {
            const l = line.trim();
            if (l.startsWith('ต.')) {
              tambon = l.replace('ต.', '').trim();
            } else if (l.startsWith('อ.')) {
              amphoe = "อำเภอ" + l.replace('อ.', '').trim();
            }
          });

          if (!amphoe && locationRaw.includes('อ.')) {
            amphoe = "อำเภอ" + locationRaw.split('อ.')[1].trim();
          }

          // Calculate air quality status
          const parseNum = (val) => {
            const num = parseFloat(val);
            return isNaN(num) ? 0 : num;
          };
          const pmVal = parseNum(pm25Value);
          let status = 'ไม่ทราบค่า';
          if (pmVal <= 15.0) status = 'ดีมาก';
          else if (pmVal <= 25.0) status = 'ดี';
          else if (pmVal <= 37.5) status = 'ปานกลาง';
          else if (pmVal <= 75.0) status = 'เริ่มมีผลต่อสุขภาพ';
          else if (pmVal > 75.0) status = 'มีผลกระทบต่อสุขภาพ';

          allRowsData.push([
            dateStr,
            isoStr,
            stationName,
            tambon,
            amphoe,
            'ลำปาง',
            timeLabel,
            pm25Value,
            pm25Avg24h,
            status
          ]);
        });

        const nextBtn = document.querySelector('button[aria-label="Next Page"]');
        if (!nextBtn || nextBtn.disabled) {
          break;
        }

        nextBtn.click();
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      if (isAuto) {
        return allRowsData;
      }

      // Manual call -> send directly to server
      try {
        showStatus("📡 กำลังส่งข้อมูล PM 2.5 ไป Node.js...");
        const res = await waterApiFetch(`http://localhost:7000/api/append-pm25-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(allRowsData)
        });

        if (res.ok) {
          if (typeof io !== 'undefined' && window._waterSysSocket) {
            window._waterSysSocket.emit('client_log', {
              source: 'Extension',
              message: `  บันทึกข้อมูล ${topicId || 'water'} ลง Excel สำเร็จ (${allRowsData.length - 1} รายการ)`
            });
            window._waterSysSocket.emit('fetch_complete', {
              project: topicId || 'water',
              mode: 'excel',
              count: allRowsData.length - 1,
              status: 'success',
              timestamp: Date.now()
            });
          }
          showStatus(`  บันทึกข้อมูลลง Excel สำเร็จ! (${allRowsData.length - 1} รายการ)`);
        } else {
          const errText = await res.text();
          throw new Error(errText || 'ตอบกลับไม่ถูกต้อง');
        }
      } catch (e) {
        console.error(e);
        if (typeof io !== 'undefined' && window._waterSysSocket) {
          window._waterSysSocket.emit('client_log', {
            source: 'Extension',
            message: `L บันทึกข้อมูลลง Excel ล้มเหลว: ${e.message}`
          });
          window._waterSysSocket.emit('fetch_complete', {
            project: topicId || 'water',
            mode: 'excel',
            count: 0,
            status: 'failed',
            error: e.message,
            timestamp: Date.now()
          });
        }
        showStatus(`L ดึงข้อมูลลง Excel ล้มเหลว`);
      }

      return allRowsData;
    }

    async function scrapeRainfallFromPage() {
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

      let targetTable = await waitForTable(findRainfallTable, 20000);
      if (!targetTable) {
        showStatus("❌ ไม่พบตารางปริมาณน้ำฝน");
        return null;
      }

      showStatus("⏳ รอโหลดตารางปริมาณน้ำฝน...");
      await waitForTableRows(targetTable, 3, 20000);
      await new Promise(resolve => setTimeout(resolve, 1500));

      const subdistrictRain = {};
      const districtRain = {};
      const rawStations = []; // New array to hold raw rainfall data
      const extractedStations = new Set(); // Track scraped station names to prevent duplicates
      let totalStationCount = 0;

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
        showStatus(`📄 กำลังดึงข้อมูลน้ำฝนหน้าถัดไป... (${extractedStations.size} สถานี)`);
        // Wait longer for SPA to render new page data (matching server scraper pattern)
        await new Promise(resolve => setTimeout(resolve, 2500));
      }

      console.log(`✅ ดึงข้อมูลน้ำฝนเสร็จสิ้น (สถานีฝน: ${totalStationCount} แห่ง, ตำบล: ${Object.keys(subdistrictRain).length} แห่ง, อำเภอ: ${Object.keys(districtRain).length} แห่ง)`);

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

      return { subdistrictRainAvg, districtRainAvg, rawStations };
    }

    async function exportToExcel(isAuto = false) {
      if (topicId === 'drought') {
        return await exportDroughtToExcel(isAuto);
      }
      if (topicId === 'pm25') {
        return await exportPM25ToExcel(isAuto);
      }
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

      let targetTable = await waitForTable(findWaterLevelTable, 20000);

      if (!targetTable) {
        if (!isAuto) showStatus("❌ ไม่พบตารางข้อมูลระดับน้ำบนหน้านี้");
        return null;
      }

      showStatus("กำลังดึงข้อมูลทุกหน้า... กรุณารอสักครู่");

      const headers = [
        "ชื่อสถานี", "แม่น้ำ/คลอง", "อำเภอ", "จังหวัด",
        "ระดับน้ำปัจจุบัน_ม_รทก", "ระดับตลิ่ง_ม_รทก", "ผลต่างตลิ่ง_ม",
        "แนวโน้ม", "สถานการณ์น้ำ", "เวลา",
        "Current_Rain_mm", "Rainfall_Accum_3d_mm", "Rainfall_Daily_mm", "Risk_Level", "วันที่และเวลา"
      ];
      let allRowsData = [headers];

      const now = new Date();
      const dateStr = now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
      const timeStr = now.toLocaleTimeString('th-TH', { hour12: false });
      const timestampStr = `${dateStr} ${timeStr}`;

      const extractedStations = new Set();

      // ดึงข้อมูลน้ำฝนที่เซฟไว้จาก local storage (ถ้ามี)
      const rainStorage = await new Promise(resolve => {
        chrome.storage.local.get(['rainMaps', 'rainMapsTime'], resolve);
      });
      const rainMaps = (rainStorage && rainStorage.rainMaps && (Date.now() - rainStorage.rainMapsTime < 300000)) 
                        ? rainStorage.rainMaps 
                        : null;

      // ดึงข้อมูลฝนจาก Widget ด้านบน (ถ้ามี)
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

      // Loop to handle pagination
      while (true) {
        targetTable = findWaterLevelTable() || targetTable;
        const rows = targetTable.querySelectorAll('tbody tr');

        rows.forEach(row => {
          if (row.innerText.includes('แสดงผลหน้าละ')) return;

          const cols = row.querySelectorAll('th, td');
          if (cols.length < 9) return;

          let stationName = cols[0].innerText.trim();
          if (extractedStations.has(stationName)) return;
          extractedStations.add(stationName);

          let locationRaw = cols[1].innerText.trim();
          let amphoe = locationRaw;
          if (locationRaw.includes('อ.')) {
            amphoe = "อำเภอ" + locationRaw.split('อ.')[1].trim();
          }

          let province = "ลำปาง";
          let river = cols[2].innerText.trim();
          let waterLevel = cols[3].innerText.trim();
          let bankLevel = cols[4].innerText.trim();
          let status = cols[5].innerText.trim();
          let time = cols[8].innerText.trim();

          let diffRaw = cols[6].innerText.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();
          let diff = diffRaw;

          let trendIcon = cols[7].querySelector('i');
          let trend = trendIcon ? trendIcon.getAttribute('title') || '' : cols[7].innerText.trim();
          if (trend.includes('ลดลง')) trend = 'ลดลง';
          else if (trend.includes('เพิ่มขึ้น')) trend = 'เพิ่มขึ้น';
          else if (trend.includes('ทรงตัว')) trend = 'คงที่';

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

          let forecastRain = rainMap3Days[amphoe] ?? null;
          let totalRain = currentRain; // Daily rainfall excludes the overlapping 3-day total

          let riskLevel = currentRain === null ? "ไม่มีข้อมูลฝน" : "ปกติ";
          if (totalRain > 90) {
            riskLevel = "วิกฤตสีแดง";
          } else if (totalRain > 35) {
            riskLevel = "เฝ้าระวัง";
          } else if (totalRain === 0) {
            riskLevel = "ปกติ";
          }

          const rowData = [
            stationName, river, amphoe, province,
            waterLevel, bankLevel, diff,
            trend, status, time,
            currentRain, forecastRain, totalRain, riskLevel, timestampStr
          ];
          allRowsData.push(rowData);
        });

        const nextBtn = document.querySelector('button[aria-label="Next Page"]');
        if (!nextBtn || nextBtn.disabled) {
          break;
        }

        nextBtn.click();
        await new Promise(resolve => setTimeout(resolve, 800));
      }

      if (isAuto) {
        return allRowsData;
      }

      // Manual download
      try {
        const worksheet = XLSX.utils.aoa_to_sheet(allRowsData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Water Level");
        XLSX.writeFile(workbook, "WaterLevelData.xlsx");
        showStatus("ดาวน์โหลด Excel สมบูรณ์!");
      } catch (e) {
        console.error(e);
        showStatus("❌ เกิดข้อผิดพลาดในการสร้างไฟล์ Excel โปรดตรวจสอบไลบรารี");
      }
    }

    // ============================================
    // ฟังก์ชันหลัก: Refresh หน้าเว็บ แล้วเก็บข้อมูล
    // ============================================
    async function refreshAndScrape(mode, rainfallOnly = false) {
      console.log(`🔄 กำลัง Refresh หน้าเว็บก่อนเก็บข้อมูล (${mode} mode, rainfallOnly: ${rainfallOnly})...`);
      showStatus("🔄 กำลัง Refresh หน้าเว็บเพื่อข้อมูลล่าสุด...");

      // ส่งข้อความไป background.js ให้ reload แท็บนี้
      chrome.runtime.sendMessage({ action: 'reload_and_scrape', mode: mode, rainfallOnly: rainfallOnly }, (response) => {
        console.log('Background acknowledged reload:', response);
      });
    }

    // ============================================
    // ฟังก์ชัน: ส่งข้อมูลไป Node.js + รายงานสถานะ
    // ============================================
    async function sendDataToServer(extractedData, mode) {
      let endpoint = mode === 'db' ? '/api/append-data-db' : '/api/append-data';
      if (topicId === 'drought') {
        endpoint = mode === 'db' ? '/api/append-drought-db' : '/api/append-drought-data';
      } else if (topicId === 'pm25') {
        endpoint = mode === 'db' ? '/api/append-pm25-db' : '/api/append-pm25-data';
      }
      const modeLabel = mode === 'db' ? 'Database' : 'Excel';
      const dataCount = extractedData.length - 1; // ลบ header row

      try {
        showStatus(`📡 กำลังส่งข้อมูล ${dataCount} รายการไป Node.js (${modeLabel})...`);

        const res = await waterApiFetch(`http://localhost:7000${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(extractedData)
        });

        if (res.ok) {
          // ��§ҹʶҹ�����稡�Ѻ价�� Node.js
          if (typeof io !== 'undefined' && window._waterSysSocket) {
            window._waterSysSocket.emit('client_log', {
              source: 'Extension',
              message: ` �ѹ�֡������ ${topicId || 'water'} ŧ ${modeLabel} ����� (${dataCount} ��¡��)`
            });
            window._waterSysSocket.emit('fetch_complete', {
              project: topicId || 'water',
              mode: mode,
              count: dataCount,
              status: 'success',
              timestamp: Date.now()
            });
          }
          showStatus(` �ѹ�֡������ŧ ${modeLabel} �����! (${dataCount} ��¡��)`);
        } else {
          const errText = await res.text();
          throw new Error(errText || '���������ͺ��Ѻ���١��ͧ');
        }
      } catch (e) {
        console.error(e);
        if (typeof io !== 'undefined' && window._waterSysSocket) {
          window._waterSysSocket.emit('client_log', {
            source: 'Extension',
            message: `L �ѹ�֡������ŧ ${modeLabel} �������: ${e.message}`
          });
          window._waterSysSocket.emit('fetch_complete', {
            project: topicId || 'water',
            mode: mode,
            count: 0,
            status: 'failed',
            error: e.message,
            timestamp: Date.now()
          });
        }
        showStatus(`L �֧������ŧ ${modeLabel} �������`);
      }
    }

    // Button Events
    const _btnHtml = window._waterSysBtnExtractHtml || document.getElementById('btn-extract-html');
    const _btnText = window._waterSysBtnExtractText || document.getElementById('btn-extract-text');

    if (_btnHtml) _btnHtml.addEventListener('click', extractHTML);
    if (_btnText) _btnText.addEventListener('click', extractText);

    // Export Excel for all tabs dynamically
    document.querySelectorAll('.btn-export-excel-trigger').forEach(btn => {
      btn.addEventListener('click', async () => {
        const topic = btn.getAttribute('data-topic');
        topicId = topic;
        
        let targetPath = '';
        let targetHost = 'lampang.thaiwater.net';
        let isRightPage = false;
        
        if (topic === 'drought') {
            targetPath = '/dam';
            isRightPage = (window.location.pathname.includes('/dam') || window.location.pathname.includes('/drought')) && window.location.host.includes(targetHost);
        } else if (topic === 'pm25') {
            targetPath = '/pm';
            isRightPage = window.location.pathname.includes('/pm') && window.location.host.includes(targetHost);
        } else if (topic === 'complaint') {
            targetHost = 'citydata.traffy.in.th';
            targetPath = '/recent-post';
            isRightPage = window.location.pathname.includes('/recent-post') && window.location.host.includes(targetHost);
        } else {
            targetPath = '/rainfall';
            isRightPage = window.location.pathname.includes('/rainfall') && window.location.host.includes(targetHost);
        }

        if (!isRightPage) {
            showStatus(`🔄 กำลังนำทางไปหน้าข้อมูล ${topic}...`);
            chrome.runtime.sendMessage({
              action: 'navigate_and_scrape',
              url: `https://${targetHost}${targetPath}`,
              mode: 'excel'
            });
        } else {
            // บังคับให้ Refresh หน้าเว็บทุกครั้งการเก็บดึงข้อมูลเพื่อให้ข้อมูลอัปเดต
            refreshAndScrape('excel');
        }
      });
    });

    // Export Database for all tabs dynamically
    document.querySelectorAll('.btn-export-db-trigger').forEach(btn => {
      btn.addEventListener('click', async () => {
        const topic = btn.getAttribute('data-topic');
        topicId = topic;

        let targetPath = '';
        let targetHost = 'lampang.thaiwater.net';
        let isRightPage = false;
        
        if (topic === 'drought') {
            targetPath = '/dam';
            isRightPage = (window.location.pathname.includes('/dam') || window.location.pathname.includes('/drought')) && window.location.host.includes(targetHost);
        } else if (topic === 'pm25') {
            targetPath = '/pm';
            isRightPage = window.location.pathname.includes('/pm') && window.location.host.includes(targetHost);
        } else if (topic === 'complaint') {
            targetHost = 'citydata.traffy.in.th';
            targetPath = '/recent-post';
            isRightPage = window.location.pathname.includes('/recent-post') && window.location.host.includes(targetHost);
        } else {
            targetPath = '/rainfall';
            isRightPage = window.location.pathname.includes('/rainfall') && window.location.host.includes(targetHost);
        }

        if (!isRightPage) {
            showStatus(`🔄 กำลังนำทางไปหน้าข้อมูล ${topic}...`);
            chrome.runtime.sendMessage({
              action: 'navigate_and_scrape',
              url: `https://${targetHost}${targetPath}`,
              mode: 'db'
            });
        } else {
            // บังคับให้ Refresh หน้าเว็บทุกครั้งการเก็บดึงข้อมูลเพื่อให้ข้อมูลอัปเดต
            refreshAndScrape('db');
        }
      });
    });

    // Listen for Keyboard Shortcut Message from background.js
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "extract_dom_shortcut") {
        extractHTML();
      }
    });

    // ============================================
    // Socket.io Connection to Node.js Master
    // ============================================
    try {
      if (typeof io !== 'undefined') {
        const socket = waterSocket({ transports: ['websocket'] });
        window._waterSysSocket = socket; // เก็บไว้ให้ฟังก์ชันอื่นใช้

        socket.on('connect', () => {
          console.log('✅ Connected to Node.js Master Server');
          socket.emit('identify', 'extension');
          const connStatus = document.getElementById('node-connection-status');
          if (connStatus) {
            connStatus.innerHTML = '🟢 Node.js: เชื่อมต่อแล้ว';
            connStatus.style.color = '#10b981';
          }
        });

        // ส่ง Heartbeat และ Ping เป็นประจำทุก 15 วินาที เพื่อรักษาสถานะการเชื่อมต่อ
        setInterval(() => {
          if (socket && socket.connected) {
            socket.emit('heartbeat', { role: 'extension', url: window.location.href });
          }
          waterApiFetch('http://localhost:7000/api/ping', { method: 'POST' }).catch(() => {});
        }, 15000);

        socket.on('disconnect', () => {
          console.log('❌ Disconnected from Node.js Master Server');
          const connStatus = document.getElementById('node-connection-status');
          if (connStatus) {
            connStatus.innerHTML = '🔴 Node.js: ไม่ได้เชื่อมต่อ';
            connStatus.style.color = '#ef4444';
          }
        });

        // รับคำสั่ง FETCH_DATA → Refresh แล้วเก็บข้อมูลลง Excel
        socket.on('FETCH_DATA', async (data) => {
          console.log('📥 Received FETCH_DATA command from Node.js:', data);
          const currentPath = window.location.pathname.replace(/\/$/, '');
          if (currentPath !== '/rainfall') {
            chrome.runtime.sendMessage({ action: 'navigate_and_scrape', url: 'https://lampang.thaiwater.net/rainfall', mode: 'excel' });
          } else {
            refreshAndScrape('excel');
          }
        });

        // รับคำสั่ง FETCH_DATA_DB → Refresh แล้วเก็บข้อมูลลง Database
        socket.on('FETCH_DATA_DB', async (data) => {
          console.log('📥 Received FETCH_DATA_DB command from Node.js:', data);
          const currentPath = window.location.pathname.replace(/\/$/, '');
          if (currentPath !== '/rainfall') {
            chrome.runtime.sendMessage({ action: 'navigate_and_scrape', url: 'https://lampang.thaiwater.net/rainfall', mode: 'db' });
          } else {
            refreshAndScrape('db');
          }
        });

        // รับคำสั่ง FETCH_RAINFALL_DB → ดึงข้อมูลเฉพาะปริมาณน้ำฝนลง Database เท่านั้น
        socket.on('FETCH_RAINFALL_DB', async (data) => {
          console.log('📥 Received FETCH_RAINFALL_DB command from Node.js:', data);
          const currentPath = window.location.pathname.replace(/\/$/, '');
          if (currentPath !== '/rainfall') {
            chrome.runtime.sendMessage({ action: 'navigate_and_scrape', url: 'https://lampang.thaiwater.net/rainfall', mode: 'db', rainfallOnly: true });
          } else {
            refreshAndScrape('db', true);
          }
        });

        // รับคำสั่ง FETCH_DROUGHT_EXCEL → นำทางไปหน้า /dam แล้วดึงข้อมูลลง Excel
        socket.on('FETCH_DROUGHT_EXCEL', async (data) => {
          console.log('📥 Received FETCH_DROUGHT_EXCEL command from Node.js:', data);
          if (window.location.pathname.replace(/\/$/, '') !== '/dam') {
            chrome.runtime.sendMessage({ action: 'navigate_and_scrape', url: 'https://lampang.thaiwater.net/dam', mode: 'excel' });
          } else {
            refreshAndScrape('excel');
          }
        });

        // รับคำสั่ง FETCH_DROUGHT_DB → นำทางไปหน้า /dam แล้วดึงข้อมูลลง Database
        socket.on('FETCH_DROUGHT_DB', async (data) => {
          console.log('📥 Received FETCH_DROUGHT_DB command from Node.js:', data);
          if (window.location.pathname.replace(/\/$/, '') !== '/dam') {
            chrome.runtime.sendMessage({ action: 'navigate_and_scrape', url: 'https://lampang.thaiwater.net/dam', mode: 'db' });
          } else {
            refreshAndScrape('db');
          }
        });

        // รับคำสั่ง FETCH_PM25_EXCEL → นำทางไปหน้า /pm แล้วดึงข้อมูลลง Excel
        socket.on('FETCH_PM25_EXCEL', async (data) => {
          console.log('📥 Received FETCH_PM25_EXCEL command from Node.js:', data);
          const currentPath = window.location.pathname.replace(/\/$/, '');
          if (currentPath !== '/pm' && currentPath !== '/pm25') {
            chrome.runtime.sendMessage({ action: 'navigate_and_scrape', url: 'https://lampang.thaiwater.net/pm', mode: 'excel' });
          } else {
            refreshAndScrape('excel');
          }
        });

        // รับคำสั่ง FETCH_PM25_DB → นำทางไปหน้า /pm แล้วดึงข้อมูลลง Database
        socket.on('FETCH_PM25_DB', async (data) => {
          console.log('📥 Received FETCH_PM25_DB command from Node.js:', data);
          const currentPath = window.location.pathname.replace(/\/$/, '');
          if (currentPath !== '/pm' && currentPath !== '/pm25') {
            chrome.runtime.sendMessage({ action: 'navigate_and_scrape', url: 'https://lampang.thaiwater.net/pm', mode: 'db' });
          } else {
            refreshAndScrape('db');
          }
        });

        // หมายเหตุ: การดึงข้อมูลเรื่องร้องเรียน Traffy Fondue ถูกแยกไปจัดการโดยส่วนขยาย 04ext_TraffyLP โดยเฉพาะ เพื่อไม่ให้แท็บเกิดการ Reload ซ้อนทับกัน

      }
    } catch (socketErr) {
      console.warn('⚠️ Socket.io connection failed (non-critical):', socketErr);
    }

    // ============================================
    // ฟังก์ชันย่อยสำหรับระบบร้องเรียน Traffy Fondue
    // ============================================
    async function scrapeTraffyComplaints(isAuto = false) {
      showStatus("⏳ เริ่มต้นดึงข้อมูลเรื่องร้องเรียนลำปาง...");
      
      // 1. ตรวจสอบและขยายตัวกรองละเอียด
      const toggleFilterBtn = document.querySelector('[class*="toggleFilterBtn"]') || 
                              Array.from(document.querySelectorAll('button')).find(btn => btn.innerText.includes('ตัวกรอง'));
      if (toggleFilterBtn && !toggleFilterBtn.className.includes('active')) {
        toggleFilterBtn.click();
        await new Promise(r => setTimeout(r, 1500));
      }



      
      // 2. ค้นหา Select จังหวัด ลำปาง
      const select = Array.from(document.querySelectorAll('select')).find(s => {
        return Array.from(s.options).some(opt => opt.value === 'ลำปาง');
      });
      
      if (select) {
        if (select.value !== 'ลำปาง') {
          showStatus("📍 กำลังกรองข้อมูลจังหวัด 'ลำปาง'...");
          select.value = 'ลำปาง';
          select.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise(r => setTimeout(r, 4000)); // รอโหลดข้อมูลจังหวัดลำปาง
        }
      } else {
        console.warn("⚠️ ไม่พบตัวเลือกจังหวัดลำปาง กำลังดึงข้อมูลจากหน้าปัจจุบัน...");
      }
      
      async function getCardElements(timeoutMs = 8000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
          const found = document.querySelectorAll('[class*="PostCard_cardGrid"], [class*="cardGrid"], [class*="PostCard_postCard"], [class*="PostCard_card"], [class*="postCard"]');
          if (found && found.length > 0) return Array.from(found);
          
          const ticketEls = document.querySelectorAll('[class*="PostCard_ticketId"], [class*="ticketId"]');
          if (ticketEls && ticketEls.length > 0) {
            const cardParents = Array.from(ticketEls).map(el => el.closest('[class*="PostCard"], [class*="card"], div')).filter(Boolean);
            if (cardParents.length > 0) return cardParents;
          }
          await new Promise(r => setTimeout(r, 1000));
        }
        return [];
      }

      const allComplaints = [];
      const extractedTickets = new Set();
      let page = 1;
      
      while (true) {
        showStatus(`📸 กำลังดึงข้อมูลเรื่องร้องเรียน หน้าที่ ${page}...`);
        
        const cards = await getCardElements(page === 1 ? 8000 : 4000);
        if (cards.length === 0) {
          showStatus("⚠️ ไม่พบการ์ดข้อมูลเรื่องร้องเรียน");
          break;
        }
        
        cards.forEach(card => {
          // ดึง ID เรื่องร้องเรียน (เช่น #2026-EDUNC2)
          const ticketIdEl = card.querySelector('[class*="PostCard_ticketId"], [class*="ticketId"]') || 
                             Array.from(card.querySelectorAll('span, div, p')).find(el => el.innerText && el.innerText.trim().startsWith('#202'));
          if (!ticketIdEl) return;
          
          const rawTicketId = ticketIdEl.innerText.trim();
          const ticketIdMatch = rawTicketId.match(/#([A-Za-z0-9\-]+)/);
          if (!ticketIdMatch) return;
          const ticketId = ticketIdMatch[1];
          
          if (extractedTickets.has(ticketId)) return;
          extractedTickets.add(ticketId);
          
          // ดึงสถานะ
          const stateEl = card.querySelector('[class*="PostCard_stateBadge"]');
          const stateName = stateEl ? stateEl.innerText.trim() : 'รอรับเรื่อง';
          
          // ดึงประเภทปัญหา
          const problemTypeEl = card.querySelector('[class*="PostCard_problemTypeTag"]');
          const problemType = problemTypeEl ? problemTypeEl.innerText.trim() : 'อื่นๆ';
          
          // ดึงรายละเอียด
          const descEl = card.querySelector('[class*="PostCard_descText"]');
          const description = descEl ? descEl.innerText.trim() : '';
          
          // ดึงลิงก์รูปภาพประกอบ (ดึงรูปแรกสุดขึ้นแสดง)
          const imgEl = card.querySelector('img[class*="PostCard_postImgGrid"]') || card.querySelector('img');
          const photoUrl = imgEl ? imgEl.src : '';
          
          // ดึงที่อยู่/พิกัด
          const locationEl = card.querySelector('[class*="PostCard_locationText"]');
          const location = locationEl ? locationEl.innerText.trim() : '';
          
          // ดึงหน่วยงานที่รับผิดชอบ
          const orgDiv = Array.from(card.querySelectorAll('div, p')).find(el => el.innerText.includes('รับผิดชอบปัจจุบัน:'));
          let orgName = 'อบจ.ลำปาง';
          if (orgDiv) {
            orgName = orgDiv.innerText.replace('รับผิดชอบปัจจุบัน:', '').trim();
          }
          
          // ดึงวันที่แจ้ง
          let ticketDatetime = '';
          const metaCols = card.querySelectorAll('[class*="PostCard_metaCol"]');
          metaCols.forEach(col => {
            const label = col.querySelector('[class*="PostCard_metaLabel"]');
            if (label && label.innerText.includes('แจ้งเมื่อ')) {
              const valEl = col.querySelector('[class*="PostCard_metaValue"] span');
              if (valEl) ticketDatetime = valEl.innerText.trim();
            }
          });
          
          // ดึงคะแนนดาวพึงพอใจ
          let satisfactionStars = '';
          const starEl = Array.from(card.querySelectorAll('[class*="PostCard_metaValue"]')).find(el => el.innerText.includes('⭐'));
          if (starEl) {
            satisfactionStars = starEl.innerText.trim();
          }
          
          allComplaints.push({
            ticket_id: ticketId,
            state_name: stateName,
            problem_type: problemType,
            description: description,
            photo_url: photoUrl,
            location: location,
            org_name: orgName,
            ticket_datetime: ticketDatetime,
            satisfaction_stars: satisfactionStars
          });
        });
        
        // ค้นหาปุ่มหน้าถัดไป (ตรวจสอบในพื้นที่ Pagination เท่านั้น)
        const paginationArea = document.querySelector('ul[class*="pagination"], [class*="Pagination"], nav');
        const searchContext = paginationArea || document.body;
        
        let nextBtn = searchContext.querySelector('button[aria-label="Next Page"], button[aria-label="หน้าถัดไป"], a[aria-label="Next Page"], a[aria-label="หน้าถัดไป"]');
        
        if (!nextBtn) {
           nextBtn = Array.from(searchContext.querySelectorAll('button, a')).find(btn => {
              const txt = btn.innerText.toLowerCase().trim();
              return txt === 'next' || txt === 'ถัดไป' || txt === 'next page';
           });
        }
                        
        if (!nextBtn || nextBtn.disabled || nextBtn.className.includes('disabled')) {
          showStatus(`✅ ดึงครบทั้งหมด ${allComplaints.length} เรื่องแล้ว!`);
          break;
        }
        
        // กดหน้าถัดไป
        nextBtn.click();
        page++;
        await new Promise(r => setTimeout(r, 3000)); // รอหน้าถัดไปโหลด
      }
      
      return allComplaints;
    }

    async function sendComplaintsToServer(extractedData) {
      try {
        showStatus(`📡 กำลังส่งข้อมูลเรื่องร้องเรียน ${extractedData.length} รายการไป Node.js...`);
        const res = await waterApiFetch(`http://localhost:7000/api/append-complaints-db`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(extractedData)
        });
        
        if (res.ok) {
          showStatus(`✅ บันทึกข้อมูล ${extractedData.length} เรื่องลง Database สำเร็จ!`);
          if (window._waterSysSocket) {
            window._waterSysSocket.emit('client_log', {
              source: 'Extension',
              message: `✅ ดึงเรื่องร้องเรียนสำเร็จ ${extractedData.length} รายการ และบันทึกเข้า DB`
            });
            window._waterSysSocket.emit('fetch_complete', {
              project: 'complaint',
              mode: 'db',
              count: extractedData.length,
              status: 'success',
              timestamp: Date.now()
            });
          }
        } else {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
      } catch (e) {
        console.error(e);
        showStatus(`❌ ส่งข้อมูลล้มเหลว: ${e.message}`);
      }
    }

    // ============================================
    // ตรวจสอบ flag หลัง Refresh: ถ้ามี pending scrape ก็ทำงานทันที
    // ============================================
    window.addEventListener('load', () => {
      // รอให้หน้าเว็บโหลดเสร็จสมบูรณ์ก่อน
      // ใช้เวลา 5 วินาที สำหรับ SPA (Vue.js) ที่ต้องโหลด API เพิ่มเติม
      const isDAMPage = window.location.pathname.includes('/dam') || window.location.pathname.includes('/drought');
      const isPMPage = window.location.pathname.includes('/pm');
      // หน้า /dam ต้องรอนานกว่าปกติเพราะ API โหลดช้า
      const initialWaitMs = isDAMPage ? 5000 : (isPMPage ? 4000 : 3000);

      setTimeout(async () => {
        try {
          chrome.runtime.sendMessage({ action: 'check_pending_scrape' }, async (response) => {
            if (response && response.shouldScrape) {
              const mode = response.mode || 'excel';
              const rainfallOnly = response.rainfallOnly || false;
              console.log(`📌 ตรวจพบ pending scrape (${mode}, rainfallOnly: ${rainfallOnly}) หลัง Refresh กำลังดึงข้อมูล...`);
              showStatus(`📌 กำลังดึงข้อมูลล่าสุดหลัง Refresh... (${mode})`);

              let extractedData;
              if (window.location.host.includes('traffy.in.th')) {
                console.log('📌 [Traffy Page] เริ่มดึงข้อมูลร้องเรียน...');
                extractedData = await scrapeTraffyComplaints(true);
                if (extractedData && extractedData.length > 0) {
                  console.log(`📌 [Traffy Page] ดึงได้ ${extractedData.length} เรื่อง กำลังส่งข้อมูล...`);
                  await sendComplaintsToServer(extractedData);
                } else {
                  console.warn('📌 [Traffy Page] ดึงข้อมูลไม่ได้ ลองรออีก 5 วินาทีแล้ว retry...');
                  await new Promise(r => setTimeout(r, 5000));
                  extractedData = await scrapeTraffyComplaints(true);
                  if (extractedData && extractedData.length > 0) {
                    await sendComplaintsToServer(extractedData);
                  }
                }
              } else if (window.location.pathname.includes('/dam') || window.location.pathname.includes('/drought')) {
                // exportDroughtToExcel มี waitForElement/waitForTableRows ในตัวแล้ว ไม่ต้องรอเพิ่ม
                console.log('📌 [Dam Page] เริ่มดึงข้อมูลภัยแล้ง (มี waitForElement ในตัว)');
                extractedData = await exportDroughtToExcel(true);
                if (extractedData && extractedData.length > 1) {
                  console.log(`📌 [Dam Page] ดึงได้ ${extractedData.length - 1} อ่าง กำลังส่งข้อมูล...`);
                  await sendDataToServer(extractedData, mode);
                } else {
                  console.warn('📌 [Dam Page] ดึงข้อมูลไม่ได้ ลองรออีก 5 วินาทีแล้ว retry...');
                  await new Promise(r => setTimeout(r, 5000));
                  extractedData = await exportDroughtToExcel(true);
                  if (extractedData && extractedData.length > 1) {
                    await sendDataToServer(extractedData, mode);
                  }
                }
              } else if (window.location.pathname.includes('/rainfall')) {
                console.log('📌 [Rainfall Page] เริ่มดึงข้อมูลน้ำฝน...');
                const rainMaps = await scrapeRainfallFromPage();
                if (rainMaps) {
                  await new Promise(resolve => {
                    chrome.storage.local.set({ rainMaps: rainMaps, rainMapsTime: Date.now() }, resolve);
                  });
                  if (mode === 'db' && rainMaps.rawStations && rainMaps.rawStations.length > 0) {
                    try {
                      console.log(`📌 [Rainfall Page] กำลังส่งข้อมูลฝนดิบ ${rainMaps.rawStations.length} รายการไปยัง /api/append-rainfall-db...`);
                      await waterApiFetch(`http://localhost:7000/api/append-rainfall-db`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(rainMaps.rawStations)
                      });
                      console.log('📌 [Rainfall Page] ส่งข้อมูลฝนดิบสำเร็จ!');
                    } catch (err) {
                      console.error('📌 [Rainfall Page] ส่งข้อมูลฝนดิบล้มเหลว:', err);
                    }
                  }
                  if (rainfallOnly) {
                    console.log('📌 [Rainfall Page] เสร็จสิ้นกระบวนการดึงข้อมูลน้ำฝนในโหมดดึงฝนเท่านั้น (ไม่ไปหน้า /wl)');
                    showStatus('✅ ดึงข้อมูลน้ำฝนเสร็จสมบูรณ์!');
                    return;
                  }
                  console.log('📌 [Rainfall Page] บันทึกข้อมูลน้ำฝนเสร็จสิ้น กำลังย้ายไปหน้า /wl...');
                  chrome.runtime.sendMessage({
                    action: 'navigate_and_scrape',
                    url: 'https://lampang.thaiwater.net/wl',
                    mode: mode
                  });
                } else {
                  console.error('📌 [Rainfall Page] ไม่สามารถดึงข้อมูลน้ำฝนได้ ย้ายไปหน้า /wl ทันที...');
                  if (rainfallOnly) {
                    showStatus('❌ ไม่สามารถดึงข้อมูลน้ำฝนได้!');
                    return;
                  }
                  chrome.runtime.sendMessage({
                    action: 'navigate_and_scrape',
                    url: 'https://lampang.thaiwater.net/wl',
                    mode: mode
                  });
                }
              } else if (window.location.pathname.includes('/pm')) {
                extractedData = await exportPM25ToExcel(true);
                if (extractedData && extractedData.length > 1) {
                  await sendDataToServer(extractedData, mode);
                }
              } else {
                extractedData = await exportToExcel(true);
                if (extractedData && extractedData.length > 1) {
                  await sendDataToServer(extractedData, mode);
                }
              }
            }
          });
        } catch (e) {
          console.error('Error checking pending scrape:', e);
        }
      }, initialWaitMs);
    });

  } catch (globalErr) {
    console.error('❌ WaterSys Extension error:', globalErr);
  }
})();
