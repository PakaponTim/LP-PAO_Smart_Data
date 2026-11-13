(function () {
  try {
    const themeColor = "#8b5cf6"; // Purple Theme

    // Inject the HTML Panel specifically for Lampang Traffy Fondue
    const panelHTML = `
      <button id="traffy-sys-ext-toggle">ดึงข้อมูลระบบร้องเรียน</button>
      <div id="traffy-sys-ext-panel" class="hidden">
        <div id="traffy-sys-ext-header">
          <span>💬 Traffy Fondue Scraper</span>
          <button id="traffy-sys-ext-close">&times;</button>
        </div>

        <div id="traffy-sys-ext-content">
          <div class="ext-section-title">📊 สถานะการเชื่อมต่อ Node.js</div>
          <div id="node-connection-status" class="conn-disconnected">
            🔴 ไม่พบการเชื่อมต่อ backend (พอร์ต 7000)
          </div>
          <button id="btn-pair-server" class="traffy-sys-btn traffy-sys-btn-secondary">เชื่อมต่อ Water System</button>

          <div class="ext-section-title">📍 ตัวกรองพื้นที่</div>
          <div class="info-card">
            เป้าหมาย: <b>จังหวัดลำปาง</b><br>
            ระบบจะกรองจังหวัดลำปางและดึงข้อมูลทุกหน้าโดยอัตโนมัติ
          </div>

          <div class="ext-section-title">⚙️ เครื่องมือควบคุม</div>
          <button id="btn-manual-scrape" class="traffy-sys-btn">
            🚀 เริ่มดึงข้อมูลเรื่องร้องเรียนลำปาง
          </button>
          
          <button id="btn-open-dashboard" class="traffy-sys-btn traffy-sys-btn-secondary">
            ⚙️ เปิดหน้าตั้งค่า Dashboard
          </button>

          <div class="ext-section-title">📜 ประวัติการทำงาน (Activity Logs)</div>
          <div id="scraper-activity-box">Scraper ready. Waiting for action...</div>

          <div id="traffy-sys-ext-status">กำลังดำเนินการ...</div>
        </div>
      </div>
    `;

    const container = document.createElement('div');
    container.innerHTML = panelHTML;

    function setupPanel() {
      const panel = document.getElementById('traffy-sys-ext-panel');
      const toggleBtn = document.getElementById('traffy-sys-ext-toggle');
      const closeBtn = document.getElementById('traffy-sys-ext-close');
      const btnScrape = document.getElementById('btn-manual-scrape');
      const btnDashboard = document.getElementById('btn-open-dashboard');
      const activityBox = document.getElementById('scraper-activity-box');
      const statusDiv = document.getElementById('traffy-sys-ext-status');

      if (!panel || !toggleBtn || !closeBtn) {
        console.error('❌ TraffyLP: Panel elements not found after injection');
        return;
      }

      window._traffyPanel = panel;
      window._traffyToggleBtn = toggleBtn;
      window._traffyActivityBox = activityBox;
      window._traffyStatusDiv = statusDiv;

      // Toggle UI
      toggleBtn.addEventListener('click', () => {
        panel.classList.remove('hidden');
        toggleBtn.style.display = 'none';
        document.body.style.marginRight = '320px';
        document.body.style.transition = 'margin-right 0.3s ease-in-out';
      });

      closeBtn.addEventListener('click', () => {
        panel.classList.add('hidden');
        toggleBtn.style.display = 'block';
        document.body.style.marginRight = '0';
      });

      // Manual Sync Button Clicked
      btnScrape.addEventListener('click', async () => {
        if (window._traffyIsScraping) {
          showStatus("⚠️ ระบบกำลังดึงข้อมูลอยู่แล้ว กรุณารอสักครู่");
          return;
        }
        btnScrape.disabled = true;
        btnScrape.style.opacity = '0.6';
        window._traffyIsScraping = true;
        try {
          const extractedData = await scrapeTraffyComplaints();
          if (extractedData && extractedData.length > 0) {
            await sendComplaintsToServer(extractedData);
          } else {
            showStatus("❌ ไม่พบข้อมูลเรื่องร้องเรียน");
            addLog("❌ ดึงข้อมูลล้มเหลว: ไม่พบเรื่องร้องเรียนบนหน้าเว็บ");
          }
        } catch (e) {
          console.error(e);
          showStatus(`❌ เกิดข้อผิดพลาด: ${e.message}`);
          addLog(`❌ ข้อผิดพลาด: ${e.message}`);
        } finally {
          window._traffyIsScraping = false;
          window._traffyLastScrapeTime = Date.now();
          btnScrape.disabled = false;
          btnScrape.style.opacity = '1';
        }
      });

      // Open Dashboard Button Clicked
      btnDashboard.addEventListener('click', () => {
        window.open('http://localhost:7000', '_blank');
      });
      document.getElementById('btn-pair-server').addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'open_pairing_options' });
      });

      addLog("✅ เริ่มต้นแผงควบคุมสเปเชียลลิสต์สำเร็จ");
    }

    // Append to body when ready
    if (document.body) {
      document.body.appendChild(container);
      setupPanel();
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        document.body.appendChild(container);
        setupPanel();
      });
    }

    // Logger utility function
    function addLog(message) {
      const activityBox = window._traffyActivityBox || document.getElementById('scraper-activity-box');
      if (activityBox) {
        const now = new Date();
        const timeStr = now.toTimeString().split(' ')[0];
        activityBox.textContent += `\n[${timeStr}] ${message}`;
        activityBox.scrollTop = activityBox.scrollHeight;
      }
      
      // Sync log to central dashboard through socket if connected
      if (window._traffySocket && window._traffySocket.connected) {
        window._traffySocket.emit('client_log', {
          source: 'Traffy Extension',
          message: message
        });
      }
    }

    // Status notification overlay
    function showStatus(text) {
      const statusDiv = window._traffyStatusDiv || document.getElementById('traffy-sys-ext-status');
      if (statusDiv) {
        statusDiv.innerText = text;
        statusDiv.classList.add('show');
        setTimeout(() => {
          statusDiv.classList.remove('show');
        }, 5000);
      }
    }

    // ============================================
    // Core Scraper Function for Traffy Fondue Lampang
    // ============================================
    async function scrapeTraffyComplaints() {
      addLog("⏳ เริ่มกรองจังหวัดลำปาง...");
      showStatus("⏳ ตรวจสอบและกรองจังหวัด 'ลำปาง'...");

      // 1. Expand filter if not already expanded
      const toggleFilterBtn = document.querySelector('[class*="toggleFilterBtn"]') || 
                            Array.from(document.querySelectorAll('button')).find(btn => btn.innerText.includes('ตัวกรอง'));
      if (toggleFilterBtn) {
        const isAlreadyActive = toggleFilterBtn.className.includes('active') || 
                                toggleFilterBtn.getAttribute('aria-expanded') === 'true';
        if (!isAlreadyActive) {
          addLog("📂 คลิกเปิดเมนูตัวกรองจังหวัด...");
          toggleFilterBtn.click();
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      // 1.5 กรอกช่วงเวลา (Date Filter) แบบ React-compatible
      const dateInput = document.querySelector('input[placeholder="เลือกวันที่เริ่มต้น - สิ้นสุด"]');
      if (dateInput) {
        if (dateInput.value !== "05/01/2026 - 09/30/2026") {
          addLog("📅 กำลังตั้งค่าช่วงเวลาแจ้งเหตุ (05/01/2026 - 09/30/2026)...");
          showStatus("📅 กำลังตั้งค่าช่วงเวลาแจ้งเหตุ...");
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          nativeInputValueSetter.call(dateInput, "05/01/2026 - 09/30/2026");
          dateInput.dispatchEvent(new Event('input', { bubbles: true }));
          dateInput.dispatchEvent(new Event('change', { bubbles: true }));
          
          const saveFilterBtn = document.querySelector('button[class*="saveFilterBtn"]') || 
                                Array.from(document.querySelectorAll('button')).find(btn => btn.innerText.includes('บันทึกเงื่อนไข'));
          if (saveFilterBtn) {
            saveFilterBtn.click();
          }
          await new Promise(r => setTimeout(r, 4000)); // รอโหลดข้อมูลตามช่วงเวลา
        }
      } else {
        addLog("⚠️ ไม่พบช่องกรอกช่วงเวลาแจ้งเหตุ");
      }

      // 2. Select Lampang
      const select = Array.from(document.querySelectorAll('select')).find(s => {
        return Array.from(s.options).some(opt => opt.value === 'ลำปาง');
      });

      if (select) {
        if (select.value !== 'ลำปาง') {
          addLog("📍 เปลี่ยนจังหวัดในตัวกรองเป็น 'ลำปาง'...");
          select.value = 'ลำปาง';
          select.dispatchEvent(new Event('change', { bubbles: true }));
          addLog("⏳ รอโหลดข้อมูลใหม่ 4 วินาที...");
          await new Promise(r => setTimeout(r, 4000));
        } else {
          addLog("📍 จังหวัด 'ลำปาง' ถูกเลือกไว้อยู่แล้ว");
        }
      } else {
        addLog("⚠️ ไม่พบดรอปดาวน์เลือกจังหวัด กำลังดึงข้อมูลจากหน้าเว็บดั้งเดิม...");
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
      const MAX_PAGES = 15; // Limit to prevent infinite loop

      while (page <= MAX_PAGES) {
        addLog(`📸 กำลังสแกนหาการ์ดข้อมูลเรื่องร้องเรียน หน้าที่ ${page}...`);
        showStatus(`📸 ดึงข้อมูลหน้าที่ ${page}...`);

        const cards = await getCardElements(page === 1 ? 8000 : 4000);
        if (cards.length === 0) {
          addLog("⚠️ ไม่พบการ์ดร้องเรียนในหน้านี้ จบการดึงข้อมูล");
          break;
        }

        addLog(`Found ${cards.length} cards in this page.`);
        let newCount = 0;

        cards.forEach(card => {
          // Get Ticket ID (e.g. #2026-EDUNC2)
          const ticketIdEl = card.querySelector('[class*="PostCard_ticketId"], [class*="ticketId"]') || 
                             Array.from(card.querySelectorAll('span, div, p')).find(el => el.innerText && el.innerText.trim().startsWith('#202'));
          if (!ticketIdEl) return;

          const rawTicketId = ticketIdEl.innerText.trim();
          const ticketIdMatch = rawTicketId.match(/#([A-Za-z0-9\-]+)/);
          if (!ticketIdMatch) return;
          const ticketId = ticketIdMatch[1];

          if (extractedTickets.has(ticketId)) return;
          extractedTickets.add(ticketId);
          newCount++;

          // Get State/Status
          const stateEl = card.querySelector('[class*="PostCard_stateBadge"], [class*="stateBadge"]');
          const forwarded = card.querySelector('[title^="ส่งต่อไป:"]');
          const stateName = stateEl ? stateEl.innerText.trim() : forwarded ? 'ส่งต่อ' : '';

          // Get Problem Type
          const problemTypeEl = card.querySelector('[class*="PostCard_problemTypeTag"], [class*="problemTypeTag"]');
          const problemType = problemTypeEl ? problemTypeEl.innerText.trim() : 'อื่นๆ';

          // Get Description
          const descEl = card.querySelector('[class*="PostCard_descText"], [class*="descText"]');
          const description = descEl ? descEl.innerText.trim() : '';

          // Get Attachment Image Link (First Image displays at top of card)
          const imgEl = card.querySelector('img[class*="PostCard_postImgGrid"], img[class*="postImgGrid"]') || card.querySelector('img');
          const photoUrl = imgEl ? imgEl.src : '';

          // Get Location text
          const locationEl = card.querySelector('[class*="PostCard_locationText"], [class*="locationText"]');
          const location = locationEl ? locationEl.innerText.trim() : '';

          // Get Organization currently responsible
          const orgLabel = Array.from(card.querySelectorAll('strong')).find(el => /^(หน่วยงานปัจจุบัน|รับผิดชอบปัจจุบัน):?$/.test(el.innerText.trim()));
          const orgDiv = orgLabel?.parentElement || Array.from(card.querySelectorAll('div, p')).find(el => el.innerText.trim().startsWith('รับผิดชอบปัจจุบัน:'));
          let orgName = 'อบจ.ลำปาง';
          if (orgDiv) {
            orgName = orgDiv.innerText.replace(/^(หน่วยงานปัจจุบัน|รับผิดชอบปัจจุบัน):\s*/, '').trim();
          }

          // Get Date & Time (metaCol -> metaLabel contains แจ้งเมื่อ -> metaValue span)
          let ticketDatetime = '';
          const metaCols = card.querySelectorAll('[class*="metaCol"]');
          metaCols.forEach(col => {
            const label = col.querySelector('[class*="metaLabel"]');
            if (label && label.innerText.includes('แจ้งเมื่อ')) {
              const valEl = col.querySelector('[class*="metaValue"] span');
              if (valEl) ticketDatetime = valEl.innerText.trim();
            }
          });

          // Get Satisfaction Stars
          let satisfactionStars = '';
          const starEl = Array.from(card.querySelectorAll('[class*="metaValue"]')).find(el => el.innerText.includes('⭐'));
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

        addLog(`📄 หน้าที่ ${page}: เก็บเรื่องใหม่ได้ ${newCount} รายการ (สะสมรวม ${allComplaints.length} เรื่อง)`);

        // Break if no new cards found to prevent infinite looping
        if (newCount === 0) {
          addLog("⚠️ ไม่พบเรื่องร้องเรียนใหม่ในหน้านี้ (อาจโหลดซ้ำหรือถึงหน้าสุดท้าย) จบการดึงข้อมูล");
          break;
        }

        // Check for end of list text on the page
        if (document.body.innerText.includes('ไม่มีเรื่องแจ้งเพิ่มเติมแล้ว')) {
          addLog("🏁 พบข้อความ 'ไม่มีเรื่องแจ้งเพิ่มเติมแล้ว' สิ้นสุดการดึงข้อมูล!");
          break;
        }

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
          addLog("🏁 สิ้นสุดหน้าสุดท้ายเรียบร้อยแล้ว!");
          break;
        }

        // Navigate to next page, prevent opening new tab if it's an anchor
        addLog("➡️ กำลังกดไปยังหน้าถัดไป...");
        if (nextBtn.tagName.toLowerCase() === 'a' && nextBtn.target === '_blank') {
          nextBtn.removeAttribute('target');
        }
        
        nextBtn.click();
        page++;
        await new Promise(r => setTimeout(r, 4000)); // Wait for page DOM updates
      }

      addLog(`🎉 เสร็จสิ้นกระบวนการดึงข้อมูลเรื่องร้องเรียนลำปาง ทั้งหมด ${allComplaints.length} เรื่อง!`);
      return allComplaints;
    }

    // ============================================
    // HTTP POST to Local Node.js Backend API (with Retry & Guard)
    // ============================================
    async function sendComplaintsToServer(extractedData, requestId = crypto.randomUUID()) {
      const maxRetries = 3;
      let lastErr = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 1) {
            addLog(`🔄 พยายามส่งข้อมูลซ้ำ (ครั้งที่ ${attempt}/${maxRetries})...`);
            await new Promise(r => setTimeout(r, 2000));
          } else {
            addLog(`📡 กำลังส่งข้อมูล ${extractedData.length} เรื่องไปบันทึกยังเซิร์ฟเวอร์...`);
            showStatus(`📡 ส่งข้อมูล ${extractedData.length} เรื่องไปฐานข้อมูล...`);
          }

          const res = await waterApiFetch(`http://localhost:7000/api/append-complaints-db`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Ingest-Key': requestId },
            body: JSON.stringify(extractedData)
          });

          if (res.ok) {
            showStatus(`✅ บันทึก ${extractedData.length} เรื่องลงฐานข้อมูลสำเร็จ!`);
            addLog(`✅ บันทึกเรื่องร้องเรียนเข้า MySQL สำเร็จทั้งหมด ${extractedData.length} เรื่อง!`);
            
            if (window._traffySocket && window._traffySocket.connected) {
              window._traffySocket.emit('fetch_complete', {
                project: 'complaints', requestId,
                mode: 'db',
                count: extractedData.length,
                status: 'success',
                timestamp: Date.now()
              });
            }
            return; // สำเร็จแล้ว จบฟังก์ชัน
          } else {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
          }
        } catch (e) {
          lastErr = e;
          console.warn(`[Traffy Ext] sendComplaintsToServer attempt ${attempt} failed:`, e.message);
        }
      }

      // หากส่งล้มเหลวครบทุกรอบแล้ว
      console.error(lastErr);
      showStatus(`❌ บันทึกข้อมูลล้มเหลว: ${lastErr?.message}`);
      addLog(`❌ ส่งข้อมูลล้มเหลว: ${lastErr?.message}`);
      
      if (window._traffySocket && window._traffySocket.connected) {
        window._traffySocket.emit('fetch_complete', {
          project: 'complaints', requestId,
          mode: 'db',
          count: 0,
          status: 'failed',
          error: lastErr?.message || 'Failed to send data',
          timestamp: Date.now()
        });
      }
    }

    // ============================================
    // Socket.io Connection to Port 7000 Dashboard
    // ============================================
    function connectSocket() {
      const connDiv = document.getElementById('node-connection-status');
      if (typeof io === 'undefined') {
        console.warn('⚠️ socket.io client not loaded yet.');
        return;
      }

      try {
        const reportConnectionError = error => {
          if (connDiv) {
            connDiv.className = 'conn-disconnected';
            connDiv.textContent = `🔴 ${error.message}`;
          }
          addLog(`❌ การเชื่อมต่อ: ${error.message}`);
        };
        const socket = waterSocket({ onAuthError: reportConnectionError });
        window._traffySocket = socket;
        socket.on('connect_error', reportConnectionError);

        socket.on('connect', () => {
          console.log('✅ Connect event fired on Traffy Extension socket');
          socket.emit('identify', { role: 'extension', url: window.location.href, complaintsRequestIds: true });
          
          if (connDiv) {
            connDiv.className = 'conn-connected';
            connDiv.innerHTML = '🟢 เชื่อมต่อ backend สำเร็จ (พอร์ต 7000)';
          }
          addLog("🟢 เชื่อมต่อสายตรงบอร์ดควบคุมหลักพอร์ต 7000 สำเร็จ");
        });

        // ส่ง Heartbeat และ Ping เป็นประจำทุก 15 วินาที
        setInterval(() => {
          if (socket && socket.connected) {
            socket.emit('heartbeat', { role: 'extension', url: window.location.href });
          }
          waterApiFetch('http://localhost:7000/api/ping', { method: 'POST' }).catch(() => {});
        }, 15000);

        socket.on('disconnect', () => {
          console.log('❌ Disconnected from socket server');
          if (connDiv) {
            connDiv.className = 'conn-disconnected';
            connDiv.innerHTML = '🔴 ไม่พบการเชื่อมต่อ backend (พอร์ต 7000)';
          }
          addLog("🔴 ตัดการเชื่อมต่อจากบอร์ดหลักพอร์ต 7000");
        });

        // 🛡️ Global Mutex & Debounce Guard เพื่อป้องกันคำสั่งซ้ำซ้อน
        window._traffyIsScraping = false;
        window._traffyLastScrapeTime = 0;

        const handleTraffyFetch = async (data) => {
          if (window._traffyIsScraping) {
            console.warn("⚠️ Traffy Scraper กำลังทำงานอยู่แล้ว ข้ามคำสั่งซ้ำซ้อน");
            return;
          }
          const timeSinceLast = Date.now() - (window._traffyLastScrapeTime || 0);
          if (timeSinceLast < 15000) {
            console.warn(`⚠️ เพิ่งดึงข้อมูลไปเมื่อ ${Math.round(timeSinceLast/1000)} วินาทีที่แล้ว ข้ามคำสั่งซ้ำซ้อน`);
            return;
          }

          window._traffyIsScraping = true;
          addLog("📥 ได้รับคำสั่งรีโมทดึงข้อมูลเรื่องร้องเรียน เริ่มดึงข้อมูล...");
          try {
            if (!window.location.hostname.includes('traffy.in.th')) {
               addLog("⚠️ ไม่ได้อยู่บนหน้าเว็บ Traffy");
               return;
            }
            
            const extractedData = await scrapeTraffyComplaints();
            if (extractedData && extractedData.length > 0) {
              await sendComplaintsToServer(extractedData, data?.requestId);
            } else {
              addLog("❌ ไม่พบข้อมูลเรื่องร้องเรียน");
              socket.emit('fetch_complete', { project: 'complaints', requestId: data?.requestId, mode: 'db', count: 0, status: 'failed', error: 'ไม่พบการ์ดเรื่องร้องเรียน', timestamp: Date.now() });
            }
          } catch (e) {
            console.error(e);
            addLog(`❌ เกิดข้อผิดพลาดในการดึงข้อมูล: ${e.message}`);
            socket.emit('fetch_complete', { project: 'complaints', requestId: data?.requestId, mode: 'db', count: 0, status: 'failed', error: e.message, timestamp: Date.now() });
          } finally {
            window._traffyIsScraping = false;
            window._traffyLastScrapeTime = Date.now();
          }
        };

        // Listen for unified fetch commands
        socket.on('FETCH_TRAFFY_LP_DB', handleTraffyFetch);
        socket.on('FETCH_COMPLAINTS_DB', handleTraffyFetch);
        socket.on('FETCH_COMPLAINTS_EXCEL', handleTraffyFetch);

      } catch (err) {
        console.error('Socket setup error:', err);
        addLog(`❌ ข้อผิดพลาดการเชื่อมต่อ Socket: ${err.message}`);
      }
    }

    // Initialize Socket connection
    connectSocket();

    // ============================================
    // Check Pending Scrape Flag after Page Loads
    // ============================================
    window.addEventListener('load', () => {
      setTimeout(() => {
        try {
          chrome.runtime.sendMessage({ action: 'check_pending_scrape' }, async (response) => {
              if (window._traffyIsScraping) return;
              window._traffyIsScraping = true;
              try {
                addLog("📌 ตรวจพบคำสั่งเก็บข้อมูลค้างอยู่ ดำเนินการต่อทันที...");
                await new Promise(r => setTimeout(r, 2000));
                
                const extractedData = await scrapeTraffyComplaints();
                if (extractedData && extractedData.length > 0) {
                  await sendComplaintsToServer(extractedData);
                }
              } finally {
                window._traffyIsScraping = false;
                window._traffyLastScrapeTime = Date.now();
              }
          });
        } catch (e) {
          console.error('Error checking pending scrape in TraffyLP:', e);
        }
      }, 3000);
    });

  } catch (err) {
    console.error('❌ TraffyLP Content Script error:', err);
  }
})();
