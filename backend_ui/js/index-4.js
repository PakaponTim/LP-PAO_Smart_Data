// === Report Feature ===
    let reportPeriod = 'daily';
    let reportCurrentPage = 0;
    const REPORT_PAGE_SIZE = 50;
    let reportAllRows = [];
    let reportCurrentProject = 'all';

    function initReportDatePicker() {
      const dateInput = document.getElementById('reportDateInput');
      if (!dateInput) return;

      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const todayStr = `${dd}/${mm}/${yyyy}`;

      // Destroy daterangepicker if it exists
      try {
        $(dateInput).data('daterangepicker')?.remove();
      } catch (e) {}

      const $dateInput = $(dateInput);
      $dateInput.off('show.daterangepicker');
      $dateInput.off('hide.daterangepicker');
      $dateInput.off('apply.daterangepicker');

      if (reportPeriod === 'weekly') {
        dateInput.type = 'text';
        dateInput.readOnly = true;
        $dateInput.val(`${todayStr} - ${todayStr}`);

        $dateInput.daterangepicker({
          singleDatePicker: false,
          autoUpdateInput: true,
          startDate: moment(),
          endDate: moment(),
          opens: 'left',
          drops: 'auto',
          showDropdowns: true,
          alwaysShowCalendars: true,
          locale: {
            format: 'DD/MM/YYYY',
            applyLabel: 'ตกลง',
            cancelLabel: 'ยกเลิก',
            daysOfWeek: ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"],
            monthNames: ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]
          }
        });

        // Bind show/hide class toggle to make it visible
        $dateInput.on('show.daterangepicker', function (ev, picker) {
          picker.container.addClass('show');
          // Fix Thai Year display in dropdowns
          if (!picker._customNextBtnObserver) {
            picker._customNextBtnObserver = new MutationObserver(() => {
              picker.container.find('.yearselect option').each(function () {
                const val = parseInt($(this).val());
                if (val < 2500) {
                  const newText = (val + 543).toString();
                  if ($(this).text() !== newText) {
                    $(this).text(newText);
                  }
                }
              });
            });
            picker._customNextBtnObserver.observe(picker.container[0], { childList: true, subtree: true });
          }
        });

        $dateInput.on('hide.daterangepicker', function (ev, picker) {
          picker.container.removeClass('show');
        });

        $dateInput.on('apply.daterangepicker', function (ev, picker) {
          $(this).val(picker.startDate.format('DD/MM/YYYY') + ' - ' + picker.endDate.format('DD/MM/YYYY'));
        });

      } else if (reportPeriod === 'monthly') {
        dateInput.type = 'month';
        dateInput.readOnly = false;
        dateInput.value = `${yyyy}-${mm}`;
      } else {
        dateInput.type = 'date';
        dateInput.readOnly = false;
        dateInput.value = `${yyyy}-${mm}-${dd}`;
      }
    }

    // Set default on load
    $(document).ready(function() {
      initReportDatePicker();
    });

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
      initReportDatePicker();
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
        let url;
        if (reportPeriod === 'weekly') {
          const parts = dateVal.split(' - ');
          if (parts.length === 2) {
            const startParts = parts[0].split('/');
            const endParts = parts[1].split('/');
            const startIso = `${startParts[2]}-${startParts[1]}-${startParts[0]}`;
            const endIso = `${endParts[2]}-${endParts[1]}-${endParts[0]}`;
            url = `/api/report-data?project=${project}&period=${reportPeriod}&startDate=${startIso}&endDate=${endIso}`;
          } else {
            url = `/api/report-data?project=${project}&period=${reportPeriod}&date=${dateVal}`;
          }
        } else if (reportPeriod === 'monthly') {
          url = `/api/report-data?project=${project}&period=${reportPeriod}&date=${dateVal}-01`;
        } else {
          url = `/api/report-data?project=${project}&period=${reportPeriod}&date=${dateVal}`;
        }

        const res = await fetch(url);
        const json = await res.json();

        document.getElementById('reportLoading').classList.add('hidden');

        if (!json.success || json.meta.totalRecords === 0) {
          document.getElementById('reportEmpty').classList.remove('hidden');
          return;
        }

        // Show date range
        document.getElementById('reportDateRange').classList.remove('hidden');
        
        function formatToThaiBE(dateStr) {
          if (!dateStr) return '';
          const parts = dateStr.split('-');
          if (parts.length !== 3) return dateStr;
          const year = parseInt(parts[0]) + 543;
          const month = parseInt(parts[1]);
          const day = parseInt(parts[2]);
          return `${day}/${month}/${year}`;
        }
        
        const startThai = formatToThaiBE(json.meta.dateRange.start);
        const endThai = formatToThaiBE(json.meta.dateRange.end);
        const periodLabels = { daily: 'รายวัน', weekly: json.meta.weekInfo || 'รายสัปดาห์', monthly: 'รายเดือน' };
        
        let rangeText = '';
        if (json.meta.period === 'daily') {
          rangeText = `${startThai} (${periodLabels.daily})`;
        } else {
          rangeText = `${startThai} ถึง ${endThai} (${periodLabels[json.meta.period]})`;
        }
        
        document.getElementById('reportDateRangeText').textContent = `${rangeText} — ${json.meta.totalRecords.toLocaleString()} รายการ`;

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
        <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md transition-shadow">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-xl">${icon}</span>
            <span class="text-slate-500 dark:text-slate-300 text-sm font-medium">${label}</span>
          </div>
          <div class="text-2xl font-bold ${colorClass}">${value}</div>
          <div class="text-xs text-slate-400 dark:text-slate-500 mt-1 font-medium">${detail}</div>
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

      const projectNames = { 
        water: '💧 ข้อมูลระดับน้ำ', 
        rainfall: '🌧️ ข้อมูลปริมาณน้ำฝน',
        drought: '☀️ ข้อมูลภัยแล้ง', 
        pm25: '🌫️ ข้อมูล PM 2.5', 
        complaints: '📢 ข้อมูลร้องเรียน' 
      };

      // Project tab buttons if 'all' or 'water'
      let tabsHtml = '';
      if (reportCurrentProject === 'all' || reportCurrentProject === 'water') {
        const projects = reportCurrentProject === 'all'
          ? ['water', 'rainfall', 'drought', 'pm25', 'complaints']
          : ['water', 'rainfall'];
        tabsHtml = '<div class="flex gap-2 mt-2">';
        projects.forEach(p => {
          if (data[p] && data[p].rows && data[p].rows.length > 0) {
            const isActive = p === projectKey;
            const colors = { water: 'blue', rainfall: 'sky', drought: 'amber', pm25: 'teal', complaints: 'purple' };
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
        rainfall: ['สถานี', 'ที่ตั้ง', 'ลุ่มน้ำ', 'ปริมาณฝน (มม.)', 'สถานะ', 'เวลาที่วัด', 'วันที่บันทึก'],
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
      else if (keys.includes('river_basin')) projectKey = 'rainfall';

      const rowMapper = {
        water: r => [r.station_name, r.river, r.amphoe, r.current_water_level_m, r.left_bank_level_m, r.trend, r.current_rain_mm, r.risk_level, r.recorded_at],
        rainfall: r => [r.station_name, r.location, r.river_basin, r.rain_mm, r.rain_status, r.measured_time, r.recorded_at],
        drought: r => [r.dam_name, r.dam_type, r.capacity_m_cum, r.water_volume_m_cum, r.inflow_m_cum, r.discharge_m_cum, r.water_percent, r.recorded_at],
        pm25: r => [r.station_name, r.tambon, r.amphoe, r.pm25_value, r.pm25_avg_24h, r.air_quality_status, r.recorded_at],
        complaints: r => [r.ticket_id, r.state_name, r.problem_type, r.org_name, r.agency_status, r.ticket_datetime, r.recorded_at]
      };

      const mapper = rowMapper[projectKey] || (r => Object.values(r));

      bodyEl.innerHTML = pageRows.map(row => {
        const cells = mapper(row);
        return '<tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">' + cells.map(v => {
          let val = v === null || v === undefined ? '-' : v;
          // Color code risk levels and air quality
          let cls = 'px-4 py-3 whitespace-nowrap text-slate-700 dark:text-slate-200';
          if (val === 'วิกฤตสีแดง' || val === 'มีผลกระทบต่อสุขภาพ') cls += ' text-red-600 dark:text-red-500 font-bold';
          else if (val === 'เฝ้าระวัง' || val === 'เริ่มมีผลต่อสุขภาพ') cls += ' text-amber-600 dark:text-amber-500 font-bold';
          else if (val === 'ปกติ' || val === 'ดีมาก' || val === 'ดี') cls += ' text-green-600 dark:text-green-500 font-semibold';
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

    window.exportReportToExcel = function() {
      if (!reportAllRows || reportAllRows.length === 0) {
        alert('ไม่มีข้อมูลที่จะดาวน์โหลด');
        return;
      }

      // Determine project from first row keys (same as renderReportPage)
      const keys = Object.keys(reportAllRows[0] || {});
      let projectKey = 'water';
      if (keys.includes('dam_name')) projectKey = 'drought';
      else if (keys.includes('pm25_value')) projectKey = 'pm25';
      else if (keys.includes('ticket_id')) projectKey = 'complaints';
      else if (keys.includes('river_basin')) projectKey = 'rainfall';

      const headerMap = {
        water: ['สถานี', 'แม่น้ำ', 'อำเภอ', 'ระดับน้ำ (ม.)', 'ระดับตลิ่ง', 'แนวโน้ม', 'ฝน (มม.)', 'ความเสี่ยง', 'วันที่บันทึก'],
        rainfall: ['สถานี', 'ที่ตั้ง', 'ลุ่มน้ำ', 'ปริมาณฝน (มม.)', 'สถานะ', 'เวลาที่วัด', 'วันที่บันทึก'],
        drought: ['ชื่ออ่าง', 'ประเภท', 'ความจุ', 'น้ำกักเก็บ', 'น้ำไหลเข้า', 'น้ำระบาย', '%น้ำ', 'วันที่บันทึก'],
        pm25: ['สถานี', 'ตำบล', 'อำเภอ', 'PM 2.5', 'เฉลี่ย 24 ชม.', 'คุณภาพ', 'วันที่บันทึก'],
        complaints: ['Ticket ID', 'สถานะ', 'ประเภทปัญหา', 'หน่วยงาน', 'สถานะ อบจ.', 'วันที่', 'วันที่บันทึก']
      };

      const rowMapper = {
        water: r => [r.station_name, r.river, r.amphoe, r.current_water_level_m, r.left_bank_level_m, r.trend, r.current_rain_mm, r.risk_level, r.recorded_at],
        rainfall: r => [r.station_name, r.location, r.river_basin, r.rain_mm, r.rain_status, r.measured_time, r.recorded_at],
        drought: r => [r.dam_name, r.dam_type, r.capacity_m_cum, r.water_volume_m_cum, r.inflow_m_cum, r.discharge_m_cum, r.water_percent, r.recorded_at],
        pm25: r => [r.station_name, r.tambon, r.amphoe, r.pm25_value, r.pm25_avg_24h, r.air_quality_status, r.recorded_at],
        complaints: r => [r.ticket_id, r.state_name, r.problem_type, r.org_name, r.agency_status, r.ticket_datetime, r.recorded_at]
      };

      const headers = headerMap[projectKey] || Object.keys(reportAllRows[0] || {});
      const mapper = rowMapper[projectKey] || (r => Object.values(r));

      // Construct CSV Rows
      const csvRows = [];
      
      // Headers
      csvRows.push(headers.map(h => `"${h.replace(/"/g, '""')}"`).join(','));

      // Data Rows
      reportAllRows.forEach(row => {
        const cells = mapper(row);
        const mappedCells = cells.map(v => {
          let cell = v === null || v === undefined ? '' : String(v);
          return `"${cell.replace(/"/g, '""')}"`;
        });
        csvRows.push(mappedCells.join(','));
      });

      // Combine with UTF-8 BOM
      const csvString = '\uFEFF' + csvRows.join('\n');
      
      const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);

      const dateVal = document.getElementById('reportDateInput').value || 'date';
      const projectNames = { water: 'water', drought: 'drought', pm25: 'pm25', complaints: 'complaints' };
      const projName = projectNames[projectKey] || 'data';
      
      const filename = `report_${projName}_${reportPeriod}_${dateVal}.csv`;
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      try {
        fetch('/api/reports/log-client-export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project: projName,
            period: reportPeriod,
            rowCount: reportAllRows.length,
            format: 'CSV',
            filename
          })
        });
      } catch (e) {}
    };

    

    // ============================================================
    // 🔔 NOTIFICATION PAGE — Iframe Helpers
    // ============================================================
    window.resizeNotificationIframe = function (obj) {
      try {
        if (obj && obj.contentWindow && obj.contentWindow.document.body) {
          const bodyHeight = obj.contentWindow.document.body.scrollHeight;
          if (bodyHeight > 300) {
            obj.style.height = (bodyHeight + 40) + 'px';
          }
        }
      } catch (e) {
        console.log("Iframe cross-origin or resize notice", e);
      }
    };

    window.initNotificationPage = function () {
      const iframe = document.getElementById('notification-iframe');
      if (!iframe) return;
      
      // Ensure iframe has valid src
      if (!iframe.src || iframe.src === 'about:blank' || iframe.src.endsWith('about:blank')) {
        iframe.src = 'notification.html';
      } else {
        // Refresh iframe data if already loaded
        try {
          if (iframe.contentWindow && typeof iframe.contentWindow.loadAll === 'function') {
            iframe.contentWindow.loadAll();
          }
        } catch(e) {}
      }
    };

    // ============================================================
    // 🟢 SYSTEM HEALTH & EXECUTIVE REPORTS & MULTI-STATION HELPERS
    // ============================================================
    window.selectedTrendStations = new Set();
    window.availableTrendStations = [];
    const TREND_STATION_COLORS = [
      '#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1', '#84cc16'
    ];

    window.populateMultiStationChips = function(stationNames) {
      window.availableTrendStations = stationNames || [];
      const container = document.getElementById('multiStationChipsContainer');
      if (!container) return;
      container.innerHTML = (stationNames || []).map(name => {
        const isSelected = window.selectedTrendStations.has(name);
        return `
          <button type="button" onclick="toggleTrendStation('${name}')"
            class="px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer select-none ${
              isSelected
                ? 'bg-blue-600 text-white border-blue-600 shadow-sm font-bold'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-blue-400'
            }">
            ${isSelected ? '✓ ' : ''}${name}
          </button>
        `;
      }).join('');
    };

    window.toggleMultiStationPanel = function() {
      const panel = document.getElementById('multiStationPanel');
      const btn = document.getElementById('btnToggleMultiStation');
      if (!panel) return;
      const isHidden = panel.classList.contains('hidden');
      if (isHidden) {
        panel.classList.remove('hidden');
        if (btn) btn.classList.add('bg-indigo-600', 'text-white');
      } else {
        panel.classList.add('hidden');
        if (btn) btn.classList.remove('bg-indigo-600', 'text-white');
      }
    };

    window.toggleTrendStation = function(stationName) {
      if (window.selectedTrendStations.has(stationName)) {
        window.selectedTrendStations.delete(stationName);
      } else {
        window.selectedTrendStations.add(stationName);
      }
      window.populateMultiStationChips(window.availableTrendStations);
      initDashboardCharts();
    };

    window.selectMajorStations = function() {
      window.selectedTrendStations.clear();
      const majorKeywords = ['TW.27', 'TW.28', 'TW.29', 'TW.30', 'น้ำแม่งาว', 'น้ำแม่สอย', 'สะพานเสตุวารี'];
      const matched = window.availableTrendStations.filter(s => majorKeywords.some(m => s.includes(m) || m.includes(s)));
      const toAdd = matched.length > 0 ? matched.slice(0, 4) : window.availableTrendStations.slice(0, 4);
      toAdd.forEach(s => window.selectedTrendStations.add(s));
      
      const panel = document.getElementById('multiStationPanel');
      if (panel) panel.classList.remove('hidden');
      window.populateMultiStationChips(window.availableTrendStations);
      initDashboardCharts();
    };

    window.selectAllTrendStations = function() {
      window.selectedTrendStations.clear();
      window.availableTrendStations.slice(0, 8).forEach(s => window.selectedTrendStations.add(s));
      window.populateMultiStationChips(window.availableTrendStations);
      initDashboardCharts();
    };

    window.clearAllTrendStations = function() {
      window.selectedTrendStations.clear();
      window.populateMultiStationChips(window.availableTrendStations);
      selectWaterForecastStation('__all_stations_average__');
    };

    window.onSingleStationChange = function(val) {
      window.selectedTrendStations.clear();
      window.populateMultiStationChips(window.availableTrendStations);
      selectWaterForecastStation(val);
    };

    // Health Monitor Functions
    window.fetchSystemHealth = async function() {
      try {
        const res = await fetch('/api/system-health');
        if (!res.ok) return;
        const data = await res.json();

        const isHealthy = data.status === 'healthy';
        const statusLabel = document.getElementById('health-status-label');
        const statusDot = document.getElementById('health-dot');
        const statusPing = document.getElementById('health-ping');
        const modalBadge = document.getElementById('modal-health-badge');

        if (statusLabel) statusLabel.innerText = isHealthy ? 'ระบบปกติ' : 'มีข้อควรระวัง';
        if (statusDot) statusDot.className = `relative inline-flex rounded-full h-2 w-2 ${isHealthy ? 'bg-emerald-500' : 'bg-amber-500'}`;
        if (statusPing) statusPing.className = `animate-ping absolute inline-flex h-full w-full rounded-full ${isHealthy ? 'bg-emerald-400' : 'bg-amber-400'} opacity-75`;
        if (modalBadge) {
          modalBadge.innerText = isHealthy ? '🟢 ปกติสมบูรณ์' : '🟡 เฝ้าระวัง';
          modalBadge.className = `px-2.5 py-0.5 text-xs rounded-full font-semibold ${isHealthy ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-800'}`;
        }

        const dbStatus = document.getElementById('health-db-status');
        const dbLatency = document.getElementById('health-db-latency');
        const dbRows = document.getElementById('health-db-rows');
        if (dbStatus) {
          dbStatus.innerText = data.database.status === 'connected' ? 'Connected' : 'Error';
          dbStatus.className = `text-xs px-2 py-0.5 rounded-full font-bold ${data.database.status === 'connected' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' : 'bg-rose-100 text-rose-700'}`;
        }
        if (dbLatency) dbLatency.innerText = `${data.database.latencyMs} ms`;
        if (dbRows) dbRows.innerText = `${Number(data.database.estimatedTotalRows).toLocaleString('th-TH')} แถว`;

        const dwLast = document.getElementById('health-dw-last');
        if (dwLast) {
          const lastT = data.dualWrite.lastDataReceived || data.dualWrite.lastWLDataReceived;
          dwLast.innerText = lastT ? new Date(lastT).toLocaleTimeString('th-TH') : 'ตามรอบ 30 นาที';
        }

        const excelList = document.getElementById('health-excel-list');
        if (excelList && Array.isArray(data.excelFiles)) {
          excelList.innerHTML = data.excelFiles.map(f => `
            <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
              <div class="flex items-center gap-2 overflow-hidden">
                <span class="text-sm">📁</span>
                <div class="truncate">
                  <p class="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">${f.name}</p>
                  <p class="text-[10px] text-slate-400">${f.sizeKb} KB | ${f.isQueueBusy ? 'กำลังบันทึก' : 'พร้อมใช้งาน'}</p>
                </div>
              </div>
              <span class="text-[10px] px-2 py-0.5 rounded font-bold ${f.exists ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-rose-100 text-rose-700'}">
                ${f.exists ? '✓ สมบูรณ์' : 'ไม่พบ'}
              </span>
            </div>
          `).join('');
        }

        const lastChecked = document.getElementById('health-last-checked');
        if (lastChecked) lastChecked.innerText = `ตรวจสอบล่าสุด: ${new Date().toLocaleTimeString('th-TH')}`;
      } catch (err) {
        console.error('Health fetch error:', err);
      }
    };

    window.openHealthModal = function() {
      const modal = document.getElementById('health-modal');
      if (!modal) return;
      modal.classList.remove('hidden');
      setTimeout(() => {
        modal.classList.remove('opacity-0');
        const card = document.getElementById('health-modal-card');
        if (card) card.classList.remove('scale-95');
      }, 10);
      window.fetchSystemHealth();
    };

    window.closeHealthModal = function() {
      const modal = document.getElementById('health-modal');
      if (!modal) return;
      modal.classList.add('opacity-0');
      const card = document.getElementById('health-modal-card');
      if (card) card.classList.add('scale-95');
      setTimeout(() => modal.classList.add('hidden'), 250);
    };

    // Executive Report Functions
    let execReportPeriod = 'monthly';

    window.toggleAllReportSections = function(checked) {
      ['chkSecWater', 'chkSecDrought', 'chkSecRisk', 'chkSecPm25', 'chkSecComplaints'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = checked;
      });
    };

    window.setExecReportPeriod = function(p) {
      execReportPeriod = p;
      const mBtn = document.getElementById('execReportPeriodMonthly');
      const wBtn = document.getElementById('execReportPeriodWeekly');
      const cBtn = document.getElementById('execReportPeriodCustom');
      const mInput = document.getElementById('execReportMonthInput');
      const dInput = document.getElementById('execReportDateInput');
      const customBox = document.getElementById('execReportCustomDateBox');
      const label = document.getElementById('execReportDateLabel');

      const activeBtnClass = 'flex-1 py-2 text-xs font-bold rounded-lg bg-blue-600 text-white shadow-sm transition-all cursor-pointer';
      const inactiveBtnClass = 'flex-1 py-2 text-xs font-bold rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer';

      if (mBtn) mBtn.className = p === 'monthly' ? activeBtnClass : inactiveBtnClass;
      if (wBtn) wBtn.className = p === 'weekly' ? activeBtnClass : inactiveBtnClass;
      if (cBtn) cBtn.className = p === 'custom' ? activeBtnClass : inactiveBtnClass;

      if (p === 'monthly') {
        if (mInput) mInput.classList.remove('hidden');
        if (dInput) dInput.classList.add('hidden');
        if (customBox) customBox.classList.add('hidden');
        if (label) label.innerText = 'เดือน/ปี ที่ต้องการออกรายงาน';
      } else if (p === 'weekly') {
        if (dInput) dInput.classList.remove('hidden');
        if (mInput) mInput.classList.add('hidden');
        if (customBox) customBox.classList.add('hidden');
        if (label) label.innerText = 'วันที่อ้างอิงสัปดาห์ (ย้อนหลัง 7 วัน)';
      } else {
        // custom
        if (customBox) customBox.classList.remove('hidden');
        if (mInput) mInput.classList.add('hidden');
        if (dInput) dInput.classList.add('hidden');
        if (label) label.innerText = 'กำหนดช่วงวันที่เริ่มต้น - สิ้นสุด';
      }
    };

    window.triggerDownloadExecutiveReport = async function(format) {
      const loadingBox = document.getElementById('execReportLoadingBox');
      const loadingMsg = document.getElementById('execReportLoadingMsg');
      const btnDocx = document.getElementById('btnDownloadExecDocx');
      const btnPdf = document.getElementById('btnDownloadExecPdf');

      const sections = {
        water: document.getElementById('chkSecWater')?.checked !== false,
        drought: document.getElementById('chkSecDrought')?.checked !== false,
        riskIndex: document.getElementById('chkSecRisk')?.checked !== false,
        pm25: document.getElementById('chkSecPm25')?.checked !== false,
        complaints: document.getElementById('chkSecComplaints')?.checked !== false
      };

      if (!sections.water && !sections.drought && !sections.riskIndex && !sections.pm25 && !sections.complaints) {
        alert('กรุณาเลือกอย่างน้อย 1 หัวข้อในการสร้างรายงาน');
        return;
      }

      let url = `/api/reports/generate-summary?period=${execReportPeriod}&format=${format}&sections=${encodeURIComponent(JSON.stringify(sections))}`;

      if (execReportPeriod === 'monthly') {
        const mVal = document.getElementById('execReportMonthInput') ? document.getElementById('execReportMonthInput').value : '';
        if (mVal) url += `&targetDate=${mVal}-01`;
      } else if (execReportPeriod === 'weekly') {
        const dVal = document.getElementById('execReportDateInput') ? document.getElementById('execReportDateInput').value : '';
        if (dVal) url += `&targetDate=${dVal}`;
      } else {
        // Custom
        const sVal = document.getElementById('execReportStartDate')?.value;
        const eVal = document.getElementById('execReportEndDate')?.value;
        if (!sVal || !eVal) {
          alert('กรุณาระบุวันเริ่มต้นและวันสิ้นสุดให้ครบถ้วน');
          return;
        }
        url += `&startDate=${sVal}&endDate=${eVal}`;
      }

      try {
        if (loadingBox) loadingBox.classList.remove('hidden');
        if (btnDocx) btnDocx.disabled = true;
        if (btnPdf) btnPdf.disabled = true;

        const res = await fetch(url);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Server error generating report');
        }

        const disposition = res.headers.get('content-disposition') || '';
        let filename = `Executive_Report_${execReportPeriod}.${format}`;
        const match = disposition.match(/filename="?([^";]+)"?/);
        if (match && match[1]) filename = decodeURIComponent(match[1]);

        const blob = await res.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(downloadUrl);

        if (loadingMsg) loadingMsg.innerText = '✅ ดาวน์โหลดสำเร็จเรียบร้อย!';
        setTimeout(() => {
          if (loadingBox) loadingBox.classList.add('hidden');
          if (loadingMsg) loadingMsg.innerText = 'ระบบกำลังคิวรีข้อมูลสถิติ เรนเดอร์กราฟิกชาร์ต และประมวลผลรูปเล่มเอกสาร กรุณารอสักครู่ (ประมาณ 3-5 วินาที)...';
        }, 2500);
      } catch (err) {
        console.error('Download error:', err);
        alert('เกิดข้อผิดพลาดในการสร้างรายงาน: ' + err.message);
        if (loadingBox) loadingBox.classList.add('hidden');
      } finally {
        if (btnDocx) btnDocx.disabled = false;
        if (btnPdf) btnPdf.disabled = false;
      }
    };

    // On-demand Raw Data Exporter (Excel / CSV)
    window.exportFilteredRawData = async function(format) {
      const project = document.getElementById('reportProjectSelect')?.value || 'all';
      const dateVal = document.getElementById('reportDateInput')?.value || '';
      
      let url = `/api/reports/export-raw-data?project=${project}&format=${format}&period=${reportPeriod}`;
      
      if (reportPeriod === 'weekly') {
        const parts = (dateVal || '').split(' - ');
        if (parts.length === 2) {
          const startParts = parts[0].split('/');
          const endParts = parts[1].split('/');
          const startIso = `${startParts[2]}-${startParts[1]}-${startParts[0]}`;
          const endIso = `${endParts[2]}-${endParts[1]}-${endParts[0]}`;
          url += `&startDate=${startIso}&endDate=${endIso}`;
        } else if (dateVal) {
          url += `&date=${dateVal}`;
        }
      } else if (reportPeriod === 'monthly') {
        if (dateVal) url += `&date=${dateVal}-01`;
      } else {
        if (dateVal) url += `&date=${dateVal}`;
      }

      const btnId = format === 'xlsx' ? 'btnExportRawXlsx' : 'btnExportRawCsv';
      const btn = document.getElementById(btnId);
      const origHtml = btn ? btn.innerHTML : '';
      if (btn) {
        btn.innerHTML = '<div class="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></div> กำลังส่งออก...';
        btn.disabled = true;
      }

      try {
        const res = await fetch(url);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Export error');
        }

        const disposition = res.headers.get('content-disposition') || '';
        let filename = `RawData_${project}.${format}`;
        const match = disposition.match(/filename="?([^";]+)"?/);
        if (match && match[1]) filename = decodeURIComponent(match[1]);

        const blob = await res.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(downloadUrl);
      } catch (err) {
        console.error('Raw Export Error:', err);
        alert('เกิดข้อผิดพลาดในการส่งออกข้อมูลดิบ: ' + err.message);
      } finally {
        if (btn) {
          btn.innerHTML = origHtml;
          btn.disabled = false;
        }
      }
    };

    // Auto-initialize Health check and default report inputs
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(window.fetchSystemHealth, 1500);
      setInterval(window.fetchSystemHealth, 60000);

      const mInput = document.getElementById('execReportMonthInput');
      const dInput = document.getElementById('execReportDateInput');
      const sInput = document.getElementById('execReportStartDate');
      const eInput = document.getElementById('execReportEndDate');
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      if (mInput) mInput.value = `${yyyy}-${mm}`;
      if (dInput) dInput.value = `${yyyy}-${mm}-${dd}`;
      if (sInput) sInput.value = `${yyyy}-${mm}-01`;
      if (eInput) eInput.value = `${yyyy}-${mm}-${dd}`;
    });
