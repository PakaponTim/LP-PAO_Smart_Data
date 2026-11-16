const socket = typeof io !== 'undefined' ? io() : null;
    if (socket) {
      socket.on('server_log', (msg) => {
        const logBox = document.getElementById('logBox');
        if (logBox) logBox.innerHTML = `<div class="border-b border-slate-800 pb-1 mb-1">${waterEscape(msg)}</div>` + logBox.innerHTML;
      });
    }

    let logsLoaded = false;
    async function loadStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();

        const extStatus = document.getElementById('extStatus');
        if (extStatus) {
          if (!data.extensionPaired) {
            extStatus.innerHTML = '<div class="w-2.5 h-2.5 rounded-full bg-amber-500"></div> <span class="text-amber-600">ยังไม่ได้จับคู่ Extension</span>';
          } else if (data.extensionConnected) {
            extStatus.innerHTML = '<div class="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></div> <span class="text-green-600">เชื่อมต่อแล้ว (Connected)</span>';
          } else {
            extStatus.innerHTML = '<div class="w-2.5 h-2.5 rounded-full bg-red-500"></div> ไม่ได้เชื่อมต่อ (Disconnected)';
          }
        }

        if (document.getElementById('lastFetchTime')) document.getElementById('lastFetchTime').innerText = data.lastFetch;

        // Only overwrite local list if user hasn't made unsaved edits
        if (data.scheduledTasks !== undefined && !tasksDirty) {
          currentTasks = data.scheduledTasks;
          renderTasks();
        }

        if (data.isScheduleActive !== undefined) {
          currentScheduleState = data.isScheduleActive;
          const toggleBtn = document.getElementById('toggleScheduleBtn');
          if (toggleBtn) {
            if (data.isScheduleActive) {
              toggleBtn.className = "bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm flex items-center gap-2";
              toggleBtn.innerHTML = '<div class="w-3.5 h-3.5 rounded-full animate-flash-red-white"></div> เปิดใช้งาน (ON)';
            } else {
              toggleBtn.className = "bg-slate-500 hover:bg-slate-600 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm flex items-center gap-2";
              toggleBtn.innerHTML = '<div class="w-3.5 h-3.5 rounded-full bg-slate-300"></div> ปิดใช้งาน (OFF)';
            }
          }
        }

        const logBox = document.getElementById('logBox');
        if (logBox && !logsLoaded && data.logs) {
          const existingLines = Array.from(logBox.querySelectorAll('div')).map(el => el.innerText.trim());
          let newHTML = '';
          data.logs.forEach(log => {
            if (!existingLines.includes(log.trim())) {
              newHTML += `<div class="border-b border-slate-800 pb-1 mb-1">${waterEscape(log)}</div>`;
            }
          });
          logBox.innerHTML = logBox.innerHTML + newHTML;
          logsLoaded = true;
        }

        // Render completed tasks
        if (data.completedTasks) {
          renderCompletedTasks(data.completedTasks);
        }

        // Update dynamic dashboard overview cards
        updateDashboardCards(data);
      } catch (e) {
        console.error('Error fetching status', e);
      }
    }

    async function forceFetch() {
      const btn = document.getElementById('forceFetchBtn');
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '⏳ กำลังสั่งการ...';
      btn.disabled = true;
      try {
        await fetch('/api/force-fetch', { method: 'POST' });
      } catch (e) {
        alert('เกิดข้อผิดพลาดในการสั่งการ');
      }
      setTimeout(() => {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
        loadStatus();
      }, 2000);
    }

    async function forceFetchDB() {
      const btn = document.getElementById('forceFetchDbBtn');
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '⏳ กำลังสั่งการ...';
      btn.disabled = true;
      try {
        await fetch('/api/force-fetch-db', { method: 'POST' });
      } catch (e) {
        alert('เกิดข้อผิดพลาดในการสั่งการฐานข้อมูล');
      }
      setTimeout(() => {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
        loadStatus();
      }, 2000);
    }

    // === Force Fetch Functions for all projects ===
    async function genericForceFetch(btnId, apiUrl, label) {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '⏳ กำลังสั่งการ...';
      btn.disabled = true;
      btn.classList.add('opacity-60', 'cursor-not-allowed');
      try {
        const res = await fetch(apiUrl, { method: 'POST' });
        const data = await res.json();
        btn.innerHTML = '✅ สั่งการสำเร็จ!';
        setTimeout(() => { btn.innerHTML = originalHTML; btn.disabled = false; btn.classList.remove('opacity-60', 'cursor-not-allowed'); loadStatus(); }, 2500);
      } catch (e) {
        btn.innerHTML = '❌ เกิดข้อผิดพลาด';
        setTimeout(() => { btn.innerHTML = originalHTML; btn.disabled = false; btn.classList.remove('opacity-60', 'cursor-not-allowed'); }, 2500);
      }
    }

    function forceFetchDroughtExcel() { genericForceFetch('forceDroughtExcelBtn', '/api/force-fetch-drought-excel', 'ภัยแล้ง Excel'); }
    function forceFetchDroughtDB() { genericForceFetch('forceDroughtDbBtn', '/api/force-fetch-drought-db', 'ภัยแล้ง DB'); }
    function forceFetchPM25Excel() { genericForceFetch('forcePm25ExcelBtn', '/api/force-fetch-pm25-excel', 'PM 2.5 Excel'); }
    function forceFetchPM25DB() { genericForceFetch('forcePm25DbBtn', '/api/force-fetch-pm25-db', 'PM 2.5 DB'); }
    function forceFetchComplaintsDB() { genericForceFetch('forceComplaintsDbBtn', '/api/force-fetch-complaints-db', 'ร้องเรียน DB'); }
    function forceFetchRainfallDB() { genericForceFetch('forceFetchRainfallDbBtn', '/api/force-fetch-rainfall-db', 'ดึงข้อมูลน้ำฝน DB'); }

    // === Render Completed Tasks ===
    function renderCompletedTasks(tasks) {
      const box = document.getElementById('completedTasksBox');
      if (!box) return;
      if (!tasks || tasks.length === 0) {
        box.innerHTML = '<div class="text-slate-400 text-sm text-center py-4 border-2 border-dashed border-slate-200 rounded-lg">ยังไม่มีประวัติงาน</div>';
        return;
      }
      box.innerHTML = tasks.slice(0, 20).map(t => {
        const statusIcon = t.status === 'success' ? '✅' : '❌';
        const statusColor = t.status === 'success' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50';
        return `<div class="flex items-start gap-3 p-3 rounded-lg border ${statusColor} text-sm">
            <span class="text-lg mt-0.5">${statusIcon}</span>
            <div class="flex-1 min-w-0">
              <div class="font-semibold text-slate-700">${t.projectName}</div>
              <div class="text-slate-500 text-xs">${t.taskType} | ${t.timestamp}</div>
              <div class="text-slate-600 text-xs mt-1 truncate">${t.details || ''}</div>
            </div>
            <span class="text-xs font-mono text-slate-400 whitespace-nowrap">${t.count || 0} รายการ</span>
          </div>`;
      }).join('');
    }

    // Tab switching logic — persist active tab to localStorage
    const tabs = ['dashboard', 'drought', 'fire', 'pm25', 'complaints', 'report', 'settings'];
    function switchTab(tabId) {
      tabs.forEach(t => {
        const viewEl = document.getElementById('view-' + t);
        if (viewEl) viewEl.classList.add('hidden');

        const navEl = document.getElementById('nav-' + t);
        if (navEl) {
          // Reset to inactive state with emerald-themed colors
          navEl.className = "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md text-emerald-800 hover:bg-emerald-50 hover:text-emerald-950 transition-all duration-200 group";
          const svg = navEl.querySelector('svg');
          if (svg) {
            svg.setAttribute('class', 'w-5 h-5 text-emerald-600 group-hover:text-emerald-700 transition-colors');
          }
        }
      });

      const targetView = document.getElementById('view-' + tabId);
      if (targetView) targetView.classList.remove('hidden');

      const targetNav = document.getElementById('nav-' + tabId);
      if (targetNav) {
        const activeColors = {
          'dashboard': 'bg-blue-600 text-white shadow-md shadow-blue-500/20',
          'drought': 'bg-amber-600 text-white shadow-md shadow-amber-500/20',
          'fire': 'bg-red-600 text-white shadow-md shadow-red-500/20',
          'pm25': 'bg-emerald-600 text-white shadow-md shadow-emerald-500/20',
          'complaints': 'bg-purple-600 text-white shadow-md shadow-purple-500/20',
          'report': 'bg-sky-600 text-white shadow-md shadow-sky-500/20',
          'settings': 'bg-pink-600 text-white shadow-md shadow-pink-600/20'
        };
        const activeClass = activeColors[tabId] || 'bg-blue-600 text-white shadow-md shadow-blue-500/20';
        targetNav.className = `flex items-center gap-3 px-3 py-2 text-sm font-bold rounded-md ${activeClass} transition-all duration-200`;

        const svg = targetNav.querySelector('svg');
        if (svg) {
          svg.setAttribute('class', 'w-5 h-5 text-white transition-colors duration-200');
        }
      }

      localStorage.setItem('activeTab', tabId);
    }

    // Restore last active tab on page load
    (function () {
      const hash = window.location.hash.replace('#', '');
      if (hash && tabs.includes(hash)) {
        switchTab(hash);
      } else {
        const saved = localStorage.getItem('activeTab');
        if (saved && tabs.includes(saved)) {
          switchTab(saved);
        } else {
          switchTab('dashboard');
        }
      }
    })();

    // Tasks Logic
    let currentTasks = [];
    let tasksDirty = false; // true = user made local changes not yet saved
    const taskListEl = document.getElementById('taskList');

    // Initialize Sortable
    if (taskListEl) {
      new Sortable(taskListEl, {
        animation: 150,
        ghostClass: 'bg-blue-50',
        onEnd: function (evt) {
          updateTasksFromArray();
          sortTasks(); // Auto sort after drag
        }
      });
    }

    let editingTaskIndex = -1;

    function renderTasks() {
      if (!taskListEl) return;
      taskListEl.innerHTML = '';
      if (currentTasks.length === 0) {
        taskListEl.innerHTML = '<li class="text-slate-400 text-sm py-4 text-center border-2 border-dashed border-slate-200 rounded-lg">ไม่มีการตั้งเวลาไว้</li>';
        return;
      }

      currentTasks.forEach((time, index) => {
        const li = document.createElement('li');
        li.className = "flex items-center justify-between bg-white border border-slate-200 p-3 rounded-lg shadow-sm hover:border-blue-300 transition-colors group";
        li.dataset.time = time;

        if (editingTaskIndex === index) {
          li.innerHTML = `
                <div class="flex items-center gap-3 flex-1 mr-4">
                  <svg class="w-5 h-5 text-slate-400 cursor-move" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path></svg>
                  <input type="time" id="editTimeInput_${index}" value="${time}" class="flex-1 px-3 py-1 border border-blue-500 rounded focus:outline-none font-mono text-lg">
                </div>
                <div class="flex items-center gap-1">
                  <button onclick="saveEdit(${index})" class="text-green-600 hover:text-green-800 hover:bg-green-50 p-1.5 rounded-md transition-colors" title="บันทึก">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                  </button>
                  <button onclick="cancelEdit()" class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1.5 rounded-md transition-colors" title="ยกเลิก">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                  </button>
                </div>
             `;
        } else {
          li.innerHTML = `
                <div class="flex items-center gap-3 cursor-move flex-1">
                  <svg class="w-5 h-5 text-slate-400 group-hover:text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path></svg>
                  <span class="font-mono font-bold text-lg text-slate-700">${time}</span>
                </div>
                <div class="flex items-center gap-1">
                  <button onclick="editTask(${index})" class="text-blue-500 hover:text-blue-700 hover:bg-blue-50 p-1.5 rounded-md transition-colors" title="แก้ไข">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                  </button>
                  <button onclick="removeTask(${index})" class="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded-md transition-colors" title="ลบ">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                  </button>
                </div>
              `;
        }
        taskListEl.appendChild(li);
      });
    }

    window.addTask = function () {
      const input = document.getElementById('taskTimeInput');
      const timeVal = input.value;
      if (!timeVal) {
        alert('กรุณาระบุเวลา');
        return;
      }
      if (currentTasks.includes(timeVal)) {
        alert('เวลานี้ถูกตั้งไว้แล้ว');
        return;
      }
      tasksDirty = true;
      currentTasks.push(timeVal);
      sortTasks();
      input.value = '';
    };

    window.editTask = function (index) {
      editingTaskIndex = index;
      renderTasks();
    };

    window.cancelEdit = function () {
      editingTaskIndex = -1;
      renderTasks();
    };

    window.saveEdit = function (index) {
      const input = document.getElementById('editTimeInput_' + index);
      const timeVal = input.value;
      if (!timeVal) {
        alert('กรุณาระบุเวลา');
        return;
      }
      if (currentTasks.includes(timeVal) && currentTasks.indexOf(timeVal) !== index) {
        alert('เวลานี้ถูกตั้งไว้แล้ว');
        return;
      }
      tasksDirty = true;
      currentTasks[index] = timeVal;
      editingTaskIndex = -1;
      sortTasks();
    };

    window.removeTask = function (index) {
      tasksDirty = true;
      currentTasks.splice(index, 1);
      renderTasks();
    };

    function updateTasksFromArray() {
      const items = taskListEl.querySelectorAll('li[data-time]');
      currentTasks = Array.from(items).map(li => li.dataset.time);
    }

    function sortTasks() {
      currentTasks.sort();
      renderTasks();
    }

    window.saveTasks = async function () {
      try {
        await fetch('/api/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tasks: currentTasks })
        });
        tasksDirty = false; // saved — allow loadStatus to sync again
        alert('บันทึกการตั้งค่าตารางเวลาสำเร็จ!');
        loadStatus();
      } catch (e) {
        alert('เกิดข้อผิดพลาดในการบันทึกเวลา');
      }
    };

    let currentScheduleState = true;
    window.toggleSchedule = async function () {
      const newState = !currentScheduleState;
      try {
        await fetch('/api/schedule/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: newState })
        });
        loadStatus();
      } catch (e) {
        alert('เกิดข้อผิดพลาดในการเปลี่ยนสถานะ');
      }
    };

    window.forceFetch = forceFetch;
    window.forceFetchDB = forceFetchDB;
    window.forceFetchDroughtExcel = forceFetchDroughtExcel;
    window.forceFetchDroughtDB = forceFetchDroughtDB;
    window.forceFetchPM25Excel = forceFetchPM25Excel;
    window.forceFetchPM25DB = forceFetchPM25DB;
    window.forceFetchComplaintsDB = forceFetchComplaintsDB;
    window.forceFetchRainfallDB = forceFetchRainfallDB;

    // === Dynamic Dashboard Cards ===
    function updateDashboardCards(data) {
      // Total DB rows
      const totalRowsEl = document.getElementById('cardTotalRows');
      const totalDetailEl = document.getElementById('cardTotalDetail');
      if (totalRowsEl && data.storageStats) {
        const ss = data.storageStats;
        let totalRows = 0;
        let parts = [];
        ['waterLevel', 'drought', 'pm25', 'complaints'].forEach(key => {
          const val = typeof ss[key]?.dbRows === 'number' ? ss[key].dbRows : 0;
          totalRows += val;
        });
        totalRowsEl.textContent = totalRows.toLocaleString() + ' รายการ';
        if (totalDetailEl) {
          const detailSpan = totalDetailEl.querySelector('span');
          if (detailSpan) detailSpan.textContent = `น้ำ: ${(ss.waterLevel?.dbRows||0).toLocaleString()} | ภัยแล้ง: ${(ss.drought?.dbRows||0).toLocaleString()} | PM2.5: ${(ss.pm25?.dbRows||0).toLocaleString()} | ร้องเรียน: ${(ss.complaints?.dbRows||0).toLocaleString()}`;
        }
      }

      // System Status
      const sysStatusEl = document.getElementById('cardSystemStatus');
      const sysDetailEl = document.getElementById('cardSystemDetail');
      if (sysStatusEl) {
        const connected = data.extensionConnected;
        sysStatusEl.textContent = connected ? 'ออนไลน์' : 'Extension ออฟไลน์';
        sysStatusEl.className = `text-3xl font-bold ${connected ? 'text-green-600' : 'text-amber-600'}`;
        if (sysDetailEl) {
          const dot = sysDetailEl.querySelector('div');
          const span = sysDetailEl.querySelector('span');
          if (dot) {
            dot.className = connected ? 'w-2 h-2 rounded-full bg-green-500 animate-pulse' : 'w-2 h-2 rounded-full bg-amber-500';
          }
          if (span) span.textContent = connected ? 'Direct PHP API + Server พร้อมทำงาน' : 'รอการเชื่อมต่อ Server';
        }
      }

      // Alerts (failed tasks)
      const alertCountEl = document.getElementById('cardAlertCount');
      const alertDetailEl = document.getElementById('cardAlertDetail');
      if (alertCountEl && data.completedTasks) {
        const failedTasks = data.completedTasks.filter(t => t.status === 'failed');
        alertCountEl.textContent = failedTasks.length;
        alertCountEl.className = `text-3xl font-bold ${failedTasks.length > 0 ? 'text-red-600' : 'text-slate-800'}`;
        if (alertDetailEl) {
          const span = alertDetailEl.querySelector('span');
          if (span) {
            span.textContent = failedTasks.length > 0 ? `มีงานล้มเหลว ${failedTasks.length} รายการล่าสุด` : 'ไม่มีข้อผิดพลาด';
          }
          alertDetailEl.className = `mt-2 text-sm font-medium flex items-center gap-1 ${failedTasks.length > 0 ? 'text-red-600' : 'text-slate-500'}`;
        }
      }
    }

    // Patch loadStatus to also update cards
    const _originalLoadStatus = loadStatus;
    loadStatus = async function() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();

        // Extension status
        const extStatus = document.getElementById('extStatus');
        if (extStatus) {
          if (!data.extensionPaired) {
            extStatus.innerHTML = '<div class="w-2.5 h-2.5 rounded-full bg-amber-500"></div> <span class="text-amber-600">ยังไม่ได้จับคู่ Extension</span>';
          } else if (data.extensionConnected) {
            extStatus.innerHTML = '<div class="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></div> <span class="text-green-600">เชื่อมต่อแล้ว (Connected)</span>';
          } else {
            extStatus.innerHTML = '<div class="w-2.5 h-2.5 rounded-full bg-red-500"></div> ไม่ได้เชื่อมต่อ (Disconnected)';
          }
        }

        if (document.getElementById('lastFetchTime')) document.getElementById('lastFetchTime').innerText = data.lastFetch;

        if (data.scheduledTasks !== undefined && !tasksDirty) {
          currentTasks = data.scheduledTasks;
          renderTasks();
        }

        if (data.isScheduleActive !== undefined) {
          currentScheduleState = data.isScheduleActive;
          const toggleBtn = document.getElementById('toggleScheduleBtn');
          if (toggleBtn) {
            if (data.isScheduleActive) {
              toggleBtn.className = "bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm flex items-center gap-2";
              toggleBtn.innerHTML = '<div class="w-3.5 h-3.5 rounded-full animate-flash-red-white"></div> เปิดใช้งาน (ON)';
            } else {
              toggleBtn.className = "bg-slate-500 hover:bg-slate-600 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm flex items-center gap-2";
              toggleBtn.innerHTML = '<div class="w-3.5 h-3.5 rounded-full bg-slate-300"></div> ปิดใช้งาน (OFF)';
            }
          }
        }

        const logBox = document.getElementById('logBox');
        if (logBox && !logsLoaded && data.logs) {
          const existingLines = Array.from(logBox.querySelectorAll('div')).map(el => el.innerText.trim());
          let newHTML = '';
          data.logs.forEach(log => {
            if (!existingLines.includes(log.trim())) {
              newHTML += `<div class="border-b border-slate-800 pb-1 mb-1">${waterEscape(log)}</div>`;
            }
          });
          logBox.innerHTML = logBox.innerHTML + newHTML;
          logsLoaded = true;
        }

        if (data.completedTasks) {
          renderCompletedTasks(data.completedTasks);
        }

        // Update dynamic cards
        updateDashboardCards(data);

      } catch (e) {
        console.error('Error fetching status', e);
      }
    };

    // === Report Feature ===
    let reportPeriod = 'daily';
    let reportCurrentPage = 0;
    const REPORT_PAGE_SIZE = 50;
    let reportAllRows = [];
    let reportCurrentProject = 'all';

    // Set today as default
    (function initReportDate() {
      const dateInput = document.getElementById('reportDateInput');
      if (dateInput) {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        dateInput.value = `${yyyy}-${mm}-${dd}`;
      }
    })();

    window.setReportPeriod = function(period) {
      reportPeriod = period;
      ['daily', 'weekly', 'monthly'].forEach(p => {
        const btn = document.getElementById('periodBtn' + p.charAt(0).toUpperCase() + p.slice(1));
        if (btn) {
          if (p === period) {
            btn.className = 'flex-1 py-2.5 text-sm font-bold bg-blue-600 text-white transition-colors';
          } else {
            btn.className = 'flex-1 py-2.5 text-sm font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors' + (p === 'weekly' ? ' border-x border-slate-300' : '');
          }
        }
      });
    };

    window.fetchReportData = async function() {
      const project = document.getElementById('reportProjectSelect').value;
      const dateVal = document.getElementById('reportDateInput').value;
      reportCurrentProject = project;
      
      if (!dateVal) {
        alert('กรุณาเลือกวันที่อ้างอิง');
        return;
      }

      // Show loading, hide others
      document.getElementById('reportLoading').classList.remove('hidden');
      document.getElementById('reportKpiCards').classList.add('hidden');
      document.getElementById('reportTableContainer').classList.add('hidden');
      document.getElementById('reportEmpty').classList.add('hidden');
      document.getElementById('reportDateRange').classList.add('hidden');

      const btn = document.getElementById('reportFetchBtn');
      const origHTML = btn.innerHTML;
      btn.innerHTML = '<div class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> กำลังดึงข้อมูล...';
      btn.disabled = true;
      btn.classList.add('opacity-70');

      try {
        const url = `/api/report-data?project=${project}&period=${reportPeriod}&date=${dateVal}`;
        const res = await fetch(url);
        const json = await res.json();

        document.getElementById('reportLoading').classList.add('hidden');

        if (!json.success || json.meta.totalRecords === 0) {
          document.getElementById('reportEmpty').classList.remove('hidden');
          return;
        }

        // Show date range
        document.getElementById('reportDateRange').classList.remove('hidden');
        const periodLabels = { daily: 'รายวัน', weekly: 'รายสัปดาห์', monthly: 'รายเดือน' };
        document.getElementById('reportDateRangeText').textContent = `${json.meta.dateRange.start} ถึง ${json.meta.dateRange.end} (${periodLabels[json.meta.period]}) — ${json.meta.totalRecords.toLocaleString()} รายการ`;

        // Render KPI Cards
        renderReportKpi(json.data, json.meta);

        // Determine which project to show in table
        let tableProject = project;
        if (project === 'all') {
          // Show first available
          if (json.data.water && json.data.water.rows.length) tableProject = 'water';
          else if (json.data.drought && json.data.drought.rows.length) tableProject = 'drought';
          else if (json.data.pm25 && json.data.pm25.rows.length) tableProject = 'pm25';
          else if (json.data.complaints && json.data.complaints.rows.length) tableProject = 'complaints';
        }

        renderReportTable(json.data, tableProject);

      } catch (e) {
        document.getElementById('reportLoading').classList.add('hidden');
        alert('เกิดข้อผิดพลาดในการดึงข้อมูล: ' + e.message);
      } finally {
        btn.innerHTML = origHTML;
        btn.disabled = false;
        btn.classList.remove('opacity-70');
      }
    };

    function renderReportKpi(data, meta) {
      const container = document.getElementById('reportKpiCards');
      container.classList.remove('hidden');
      let html = '';

      const kpiCard = (icon, label, value, detail, colorClass = 'text-blue-600') => `
        <div class="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-xl">${icon}</span>
            <span class="text-slate-500 text-sm font-medium">${label}</span>
          </div>
          <div class="text-2xl font-bold ${colorClass}">${value}</div>
          <div class="text-xs text-slate-400 mt-1 font-medium">${detail}</div>
        </div>`;

      if (data.water) {
        const s = data.water.summary;
        html += kpiCard('💧', 'ข้อมูลระดับน้ำ', `${s.totalRecords} รายการ`, `${s.totalStations} สถานี | เฉลี่ย ${s.avgWaterLevel} ม.`, 'text-blue-600');
      }
      if (data.drought) {
        const s = data.drought.summary;
        html += kpiCard('☀️', 'ข้อมูลภัยแล้ง', `${s.totalRecords} รายการ`, `${s.totalDams} อ่าง | น้ำเฉลี่ย ${s.avgVolumePercent}%`, 'text-amber-600');
      }
      if (data.pm25) {
        const s = data.pm25.summary;
        html += kpiCard('🌫️', 'ข้อมูล PM 2.5', `${s.totalRecords} รายการ`, `${s.totalStations} สถานี | เฉลี่ย ${s.avgPm25} µg/m³`, 'text-teal-600');
      }
      if (data.complaints) {
        const s = data.complaints.summary;
        html += kpiCard('📢', 'ข้อมูลร้องเรียน', `${s.totalRecords} รายการ`, `เสร็จ ${s.resolvedCount} | รอดำเนินการ ${s.pendingCount}`, 'text-purple-600');
      }

      container.innerHTML = html;
    }

    function renderReportTable(data, projectKey) {
      const container = document.getElementById('reportTableContainer');
      const headEl = document.getElementById('reportTableHead');
      const bodyEl = document.getElementById('reportTableBody');
      const titleEl = document.getElementById('reportTableTitle');
      const countEl = document.getElementById('reportRecordCount');

      const projectData = data[projectKey];
      if (!projectData || !projectData.rows || projectData.rows.length === 0) {
        container.classList.add('hidden');
        return;
      }

      container.classList.remove('hidden');
      reportAllRows = projectData.rows;
      reportCurrentPage = 0;

      const projectNames = { water: '💧 ข้อมูลระดับน้ำ', drought: '☀️ ข้อมูลภัยแล้ง', pm25: '🌫️ ข้อมูล PM 2.5', complaints: '📢 ข้อมูลร้องเรียน' };

      // Project tab buttons if 'all'
      let tabsHtml = '';
      if (reportCurrentProject === 'all') {
        const projects = ['water', 'drought', 'pm25', 'complaints'];
        tabsHtml = '<div class="flex gap-2 mt-2">';
        projects.forEach(p => {
          if (data[p] && data[p].rows && data[p].rows.length > 0) {
            const isActive = p === projectKey;
            const colors = { water: 'blue', drought: 'amber', pm25: 'teal', complaints: 'purple' };
            const c = colors[p];
            tabsHtml += `<button onclick="renderReportTable(window._lastReportData, '${p}')" class="px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${isActive ? `bg-${c}-600 text-white` : `bg-slate-100 text-slate-600 hover:bg-slate-200`}">${projectNames[p]} (${data[p].rows.length})</button>`;
          }
        });
        tabsHtml += '</div>';
        window._lastReportData = data;
      }

      titleEl.innerHTML = `<svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"></path></svg> ${projectNames[projectKey] || 'ผลลัพธ์ข้อมูล'}${tabsHtml}`;
      countEl.textContent = `${reportAllRows.length.toLocaleString()} รายการ`;

      // Headers based on project
      const headerMap = {
        water: ['สถานี', 'แม่น้ำ', 'อำเภอ', 'ระดับน้ำ (ม.)', 'ระดับตลิ่ง', 'แนวโน้ม', 'ฝน (มม.)', 'ความเสี่ยง', 'วันที่บันทึก'],
        drought: ['ชื่ออ่าง', 'ประเภท', 'ความจุ', 'น้ำกักเก็บ', 'น้ำไหลเข้า', 'น้ำระบาย', '%น้ำ', 'วันที่บันทึก'],
        pm25: ['สถานี', 'ตำบล', 'อำเภอ', 'PM 2.5', 'เฉลี่ย 24 ชม.', 'คุณภาพ', 'วันที่บันทึก'],
        complaints: ['Ticket ID', 'สถานะ', 'ประเภทปัญหา', 'หน่วยงาน', 'สถานะ อบจ.', 'วันที่', 'วันที่บันทึก']
      };

      const headers = headerMap[projectKey] || Object.keys(reportAllRows[0] || {});
      headEl.innerHTML = '<tr>' + headers.map(h => `<th class="text-left px-4 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide whitespace-nowrap">${h}</th>`).join('') + '</tr>';

      renderReportPage();
    }

    function renderReportPage() {
      const bodyEl = document.getElementById('reportTableBody');
      const showingEl = document.getElementById('reportShowingInfo');
      const prevBtn = document.getElementById('reportPrevBtn');
      const nextBtn = document.getElementById('reportNextBtn');

      const start = reportCurrentPage * REPORT_PAGE_SIZE;
      const end = Math.min(start + REPORT_PAGE_SIZE, reportAllRows.length);
      const pageRows = reportAllRows.slice(start, end);

      // Determine project from first row keys
      const keys = Object.keys(pageRows[0] || {});
      let projectKey = 'water';
      if (keys.includes('dam_name')) projectKey = 'drought';
      else if (keys.includes('pm25_value')) projectKey = 'pm25';
      else if (keys.includes('ticket_id')) projectKey = 'complaints';

      const rowMapper = {
        water: r => [r.station_name, r.river, r.amphoe, r.current_water_level_m, r.left_bank_level_m, r.trend, r.current_rain_mm, r.risk_level, r.recorded_at],
        drought: r => [r.dam_name, r.dam_type, r.capacity_m_cum, r.water_volume_m_cum, r.inflow_m_cum, r.discharge_m_cum, r.water_percent, r.recorded_at],
        pm25: r => [r.station_name, r.tambon, r.amphoe, r.pm25_value, r.pm25_avg_24h, r.air_quality_status, r.recorded_at],
        complaints: r => [r.ticket_id, r.state_name, r.problem_type, r.org_name, r.agency_status, r.ticket_datetime, r.recorded_at]
      };

      const mapper = rowMapper[projectKey] || (r => Object.values(r));

      bodyEl.innerHTML = pageRows.map(row => {
        const cells = mapper(row);
        return '<tr class="hover:bg-slate-50 transition-colors">' + cells.map(v => {
          let val = v === null || v === undefined ? '-' : v;
          // Color code risk levels and air quality
          let cls = 'px-4 py-3 whitespace-nowrap text-slate-700';
          if (val === 'วิกฤตสีแดง' || val === 'มีผลกระทบต่อสุขภาพ') cls += ' text-red-600 font-bold';
          else if (val === 'เฝ้าระวัง' || val === 'เริ่มมีผลต่อสุขภาพ') cls += ' text-amber-600 font-bold';
          else if (val === 'ปกติ' || val === 'ดีมาก' || val === 'ดี') cls += ' text-green-600 font-semibold';
          return `<td class="${cls}">${val}</td>`;
        }).join('') + '</tr>';
      }).join('');

      showingEl.textContent = `แสดง ${start + 1}–${end} จาก ${reportAllRows.length} รายการ`;
      prevBtn.disabled = reportCurrentPage === 0;
      nextBtn.disabled = end >= reportAllRows.length;
    }

    window.reportChangePage = function(delta) {
      reportCurrentPage += delta;
      if (reportCurrentPage < 0) reportCurrentPage = 0;
      const maxPage = Math.ceil(reportAllRows.length / REPORT_PAGE_SIZE) - 1;
      if (reportCurrentPage > maxPage) reportCurrentPage = maxPage;
      renderReportPage();
    };

    loadStatus();
    setInterval(() => { if (!document.hidden) loadStatus(); }, 15000);
