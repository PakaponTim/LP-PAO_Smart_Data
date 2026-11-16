const socket = typeof io !== 'undefined' ? io() : null;
    function formatRealtimeLogLine(msg) {
      const text = String(msg || '');
      let colorClass = 'text-green-400';
      if (text.includes('❌') || text.includes('ไม่สำเร็จ') || text.includes('ล้มเหลว') || text.includes('ข้อผิดพลาด')) {
        colorClass = 'text-rose-400';
      } else if (text.includes('⚠️') || text.includes('เฝ้าระวัง') || text.includes('ค้าง')) {
        colorClass = 'text-amber-300';
      }
      return `<div class="border-b border-slate-800 pb-1 mb-1 ${colorClass}">${waterEscape(text)}</div>`;
    }

    function appendFilteredLogs(boxId, lines, keywords) {
      const box = document.getElementById(boxId);
      if (!box) return;
      const list = Array.isArray(lines) ? lines : [];
      const filtered = keywords && keywords.length
        ? list.filter(line => keywords.some(kw => String(line).includes(kw)))
        : list;
      if (filtered.length === 0) {
        box.innerHTML = `<div class="text-slate-500 italic">ยังไม่มีบันทึกกิจกรรมสำหรับหมวดหมู่นี้</div>`;
        return;
      }
      box.innerHTML = filtered.slice(0, 60).map(formatRealtimeLogLine).join('');
    }

    if (socket) {
      socket.on('server_log', (msg) => {
        const htmlLine = formatRealtimeLogLine(msg);
        const s = String(msg || '');
        const targets = ['logBox'];
        const isGlobal = s.includes('SmartSleep') || s.includes('ParallelAPI') || s.includes('GitHubSync');
        if (isGlobal || s.includes('ระดับน้ำ') || s.includes('น้ำฝน') || s.includes('water') || s.includes('rainfall')) targets.push('waterLogBox');
        if (isGlobal || s.includes('ภัยแล้ง') || s.includes('อ่าง') || s.includes('drought')) targets.push('droughtLogBox');
        if (isGlobal || s.includes('PM 2.5') || s.includes('PM2.5') || s.includes('ฝุ่น') || s.includes('pm25')) targets.push('pm25LogBox');
        if (isGlobal || s.includes('ร้องเรียน') || s.includes('Traffy') || s.includes('Cookie') || s.includes('Session') || s.includes('complaints')) targets.push('complaintsLogBox');

        targets.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.innerHTML = htmlLine + el.innerHTML;
        });
      });

      socket.on('system_log', () => {
        const homePage = document.getElementById('page-home');
        if (homePage && !homePage.classList.contains('hidden') && typeof window.loadSystemLogs === 'function') {
          window.loadSystemLogs();
          window.loadExecutionHeatmap();
        }
      });
    }

    let logsLoaded = false;
    let droughtLogsLoaded = false;
    let pm25LogsLoaded = false;
    let complaintsLogsLoaded = false;
    let complaintsList = [];

    let currentTasks = [];
    let tasksDirty = false;
    let editingTaskIndex = -1;
    let currentScheduleState = { water: true, drought: true, pm25: true, complaints: true };

    async function loadComplaints() {
      try {
        const res = await fetch('/api/complaints');
        if (!res.ok) return;
        const data = await res.json();
        complaintsList = data;
        window.complaintsList = data;

        applyComplaintsFilters();

        const complaintsLastUpdate = document.getElementById('complaintsLastUpdate');
        if (complaintsLastUpdate && data.length > 0) {
          const latest = data[0];
          if (latest && latest.recorded_at) {
            const date = new Date(latest.recorded_at);
            complaintsLastUpdate.innerText = `อัปเดตล่าสุด: ${date.toLocaleString('th-TH')}`;
          }
        }
      } catch (e) {
        console.error('Error loading complaints:', e);
      }
    }

    function parseTimeline(c) {
      if (!c.raw_timeline) return [];
      try {
        const obj = typeof c.raw_timeline === 'string' ? JSON.parse(c.raw_timeline) : c.raw_timeline;
        return obj?.results?.case?.timeline || [];
      } catch (e) { return []; }
    }

    function hasPaoCompletedTimeline(c) {
      const t = parseTimeline(c);
      if (t.length === 0) return c.state_name === 'เสร็จสิ้น' && c.org_name?.includes('องค์การบริหารส่วนจังหวัดลำปาง');
      return t.some(item => item.tl_state_name === 'เสร็จสิ้น' && item.name?.includes('องค์การบริหารส่วนจังหวัดลำปาง'));
    }

    function hasReceivedFromOtherTimeline(c) {
      const t = parseTimeline(c);
      return t.some(item => (item.tl_state_name === 'ส่งต่อ' || item.note?.includes('ส่งต่อให้')) && item.note?.includes('องค์การบริหารส่วนจังหวัดลำปาง'));
    }

    function hasPaoAssigned(c) {
      const t = parseTimeline(c);
      if (c.org_name?.includes('องค์การบริหารส่วนจังหวัดลำปาง')) return true;
      return t.some(item => item.name?.includes('องค์การบริหารส่วนจังหวัดลำปาง') && (item.tl_state_name === 'รับเรื่อง' || item.tl_state_name === 'กำลังดำเนินการ'));
    }

    function hasOtherReceivedFromPao(c) {
      const t = parseTimeline(c);
      return t.some(item => item.name?.includes('องค์การบริหารส่วนจังหวัดลำปาง') && (item.tl_state_name === 'ส่งต่อ' || item.note?.includes('ส่งต่อให้')));
    }

    window.updateComplaintsStats = function (data) {
      const paoData = data.filter(c => c.org_name?.includes('องค์การบริหารส่วนจังหวัดลำปาง'));
      const paoTotal = paoData.length;
      const paoCompleted = paoData.filter(c => c.state_name === 'เสร็จสิ้น').length;
      const paoPending = paoData.filter(c => c.state_name === 'รอรับเรื่อง').length;
      const paoInProgress = paoData.filter(c => c.state_name === 'กำลังดำเนินการ' || c.state_name === 'ติดตามเรื่อง' || c.state_name === 'ภาพการดำเนินการ').length;

      const paoComplaintsCount = document.getElementById('paoComplaintsCount');
      if (paoComplaintsCount) paoComplaintsCount.innerText = paoTotal + ' เรื่อง';
      const paoPendingCount = document.getElementById('paoPendingCount');
      if (paoPendingCount) paoPendingCount.innerText = paoPending + ' เรื่อง';
      const paoInProgressCount = document.getElementById('paoInProgressCount');
      if (paoInProgressCount) paoInProgressCount.innerText = paoInProgress + ' เรื่อง';
      const paoCompletedCount = document.getElementById('paoCompletedCount');
      if (paoCompletedCount) paoCompletedCount.innerText = paoCompleted + ' เรื่อง';

      const otherData = data.filter(c => !c.org_name?.includes('องค์การบริหารส่วนจังหวัดลำปาง'));
      const otherTotal = otherData.length;
      const otherCompleted = otherData.filter(c => c.state_name === 'เสร็จสิ้น').length;
      const otherPending = otherData.filter(c => c.state_name === 'รอรับเรื่อง').length;
      const otherInProgress = otherData.filter(c => c.state_name === 'กำลังดำเนินการ' || c.state_name === 'ติดตามเรื่อง' || c.state_name === 'ภาพการดำเนินการ').length;

      const otherComplaintsCount = document.getElementById('otherComplaintsCount');
      if (otherComplaintsCount) otherComplaintsCount.innerText = otherTotal + ' เรื่อง';
      const otherPendingCount = document.getElementById('otherPendingCount');
      if (otherPendingCount) otherPendingCount.innerText = otherPending + ' เรื่อง';
      const otherInProgressCount = document.getElementById('otherInProgressCount');
      if (otherInProgressCount) otherInProgressCount.innerText = otherInProgress + ' เรื่อง';
      const otherCompletedCount = document.getElementById('otherCompletedCount');
      if (otherCompletedCount) otherCompletedCount.innerText = otherCompleted + ' เรื่อง';
    };

    function parseThaiTicketDate(str) {
      if (!str) return null;
      let cleanStr = str.trim();

      // If it is already in standard CE date string format (e.g. YYYY-MM-DD)
      let testDate = new Date(cleanStr.replace(' ', 'T'));
      if (!isNaN(testDate.getTime()) && !cleanStr.match(/^[0-9]{1,2}\s+[ก-ฮ]/)) {
        return testDate;
      }

      try {
        const daysOfWeek = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'พฤหัส', 'ศุกร์', 'เสาร์', 'อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
        let parts = cleanStr.split(/\s+/);

        if (parts.length > 0 && daysOfWeek.some(day => parts[0].includes(day))) {
          parts.shift();
        }

        if (parts.length < 3) return null;

        const day = parseInt(parts[0], 10);
        const monthStr = parts[1];
        let yearStr = parts[2];

        const thMonthsAbbr = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
        const thMonthsFull = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

        let month = -1;
        for (let i = 0; i < 12; i++) {
          if (monthStr.includes(thMonthsAbbr[i]) || monthStr.includes(thMonthsFull[i])) {
            month = i;
            break;
          }
        }
        if (month === -1) return null;

        let year = parseInt(yearStr, 10);
        if (yearStr.length === 2 || year < 100) {
          if (year > 40) {
            year = 2500 + year;
          } else {
            year = 2000 + year;
          }
        }
        if (year > 2400) {
          year = year - 543;
        }

        let hour = 0;
        let minute = 0;
        let timeStr = parts.find(p => p.includes(':'));
        if (timeStr) {
          const timeParts = timeStr.split(':');
          hour = parseInt(timeParts[0], 10) || 0;
          minute = parseInt(timeParts[1], 10) || 0;
        }

        return new Date(year, month, day, hour, minute);
      } catch (e) {
        console.error('Error parsing Thai date:', e);
        return null;
      }
    }

    window.applyComplaintsFilters = function () {
      if (!window.complaintsList) return;
      let data = [...window.complaintsList];

      const startDateStr = document.getElementById('filterStartDate')?.value;
      const endDateStr = document.getElementById('filterEndDate')?.value;
      const statusGroup = document.getElementById('filterStatusGroup')?.value;
      const agencyFilter = document.getElementById('filterAgency')?.value;

      // 1. Date filter
      if (startDateStr || endDateStr) {
        const start = startDateStr ? new Date(startDateStr) : new Date('2000-01-01');
        const end = endDateStr ? new Date(endDateStr) : new Date('2099-12-31');
        end.setHours(23, 59, 59, 999);

        data = data.filter(c => {
          if (!c.ticket_datetime) return false;
          const d = parseThaiTicketDate(c.ticket_datetime);
          if (!d) return false;
          return d >= start && d <= end;
        });
      }

      // 2. Status Group Filter
      if (statusGroup && statusGroup !== 'all') {
        data = data.filter(c => {
          const s = c.state_name || '';
          if (statusGroup === 'received') {
            return ['รอรับเรื่อง', 'รับเรื่อง', 'กำลังดำเนินการ', 'ศึกษาปัญหา', 'จัดทำนโยบาย', 'ของบประมาณ', 'จัดซื้อจัดจ้าง', 'ขั้นตอนทางกฎหมาย', 'ติดตามเรื่อง'].includes(s);
          } else if (statusGroup === 'forwarded') {
            return s.includes('ส่งต่อ');
          } else if (statusGroup === 'pao_completed') {
            return s === 'เสร็จสิ้น' && (c.org_name?.includes('องค์การบริหารส่วนจังหวัดลำปาง') || hasPaoCompletedTimeline(c));
          } else if (statusGroup === 'other_status') {
            return ['ไม่เกี่ยวข้อง', 'ยุติเรื่อง'].includes(s) || (!['รอรับเรื่อง', 'รับเรื่อง', 'กำลังดำเนินการ', 'ศึกษาปัญหา', 'จัดทำนโยบาย', 'ของบประมาณ', 'จัดซื้อจัดจ้าง', 'ขั้นตอนทางกฎหมาย', 'ติดตามเรื่อง', 'ส่งต่อ(ใหม่)', 'เสร็จสิ้น'].includes(s) && !s.includes('ส่งต่อ'));
          } else if (statusGroup === 'received_from_other') {
            return hasReceivedFromOtherTimeline(c);
          }
          return true;
        });
      }

      // 3. Agency Filter
      if (agencyFilter && agencyFilter !== 'all') {
        data = data.filter(c => {
          if (agencyFilter === 'pao_assigned') {
            return hasPaoAssigned(c);
          } else if (agencyFilter === 'forward_to_pao') {
            return hasReceivedFromOtherTimeline(c);
          } else if (agencyFilter === 'pao_completed_agency') {
            return hasPaoCompletedTimeline(c);
          } else if (agencyFilter === 'other_receive_from_pao') {
            return hasOtherReceivedFromPao(c);
          }
          return true;
        });
      }

      // เรียงจากวันที่มากไปน้อย
      data.sort((a, b) => {
        const dA = parseThaiTicketDate(a.ticket_datetime) || new Date(0);
        const dB = parseThaiTicketDate(b.ticket_datetime) || new Date(0);
        return dB - dA;
      });

      updateComplaintsStats(data);
      renderComplaints(data);
    };

    function renderComplaints(data) {
      const grid = document.getElementById('complaintsGrid');
      if (!grid) return;

      if (data.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full py-12 text-center text-slate-400 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <svg class="w-12 h-12 mx-auto mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0a2 2 0 01-2 2H6a2 2 0 01-2-2m16 0V9a2 2 0 00-2-2H6a2 2 0 00-2 2v2m4.586-1H12m0 0h2.414M12 9V7m0 2h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
              <span>ยังไม่มีข้อมูลเรื่องร้องเรียนในระบบ กดปุ่ม "เริ่มซิงค์เรื่องร้องเรียนล่าสุด" เพื่อเริ่มดึงข้อมูล</span>
            </div>
          `;
        return;
      }

      let html = '';
      data.forEach(complaint => {
        const photoHtml = complaint.photo_url
          ? `<div class="relative w-full h-48 overflow-hidden rounded-t-2xl">
                 <img src="${complaint.photo_url}" class="w-full h-full object-cover transition-transform duration-500 hover:scale-105" alt="รูปภาพปัญหา">
                 <div class="absolute top-3 left-3 bg-white dark:bg-slate-800/90 backdrop-blur-md px-2.5 py-1 rounded-full shadow text-[10px] font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                   <span class="w-1.5 h-1.5 rounded-full bg-violet-600 animate-pulse"></span> ${complaint.problem_type || 'ทั่วไป'}
                 </div>
               </div>`
          : `<div class="relative w-full h-48 bg-gradient-to-br from-violet-600 to-indigo-600 flex flex-col items-center justify-center rounded-t-2xl text-white/90">
                 <svg class="w-12 h-12 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
                 <span class="text-[10px] font-bold mt-2 uppercase tracking-wider">${complaint.problem_type || 'ทั่วไป'}</span>
               </div>`;

        let badgeClass = '';
        if (complaint.state_name === 'รอรับเรื่อง') {
          badgeClass = 'bg-rose-50 text-rose-600 border-rose-100';
        } else if (complaint.state_name === 'กำลังดำเนินการ' || complaint.state_name === 'ติดตามเรื่อง' || complaint.state_name === 'ภาพการดำเนินการ') {
          badgeClass = 'bg-amber-50 text-amber-600 border-amber-100';
        } else if (complaint.state_name === 'เสร็จสิ้น') {
          badgeClass = 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 border-emerald-100';
        } else {
          badgeClass = 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-100 dark:border-slate-700/50';
        }

        html += `
            <div class="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col justify-between overflow-hidden group">
              <div>
                ${photoHtml}
                
                <div class="p-5 space-y-3.5">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-xs font-mono font-bold text-slate-400">ใบงาน #${complaint.ticket_id}</span>
                    <span class="text-[11px] font-bold border px-2.5 py-1 rounded-full shadow-sm ${badgeClass}">
                      ${complaint.state_name}
                    </span>
                  </div>
                  
                  <div>
                    <p class="text-slate-800 dark:text-slate-100 text-sm font-medium line-clamp-3 leading-relaxed" title="${complaint.description}">
                      ${complaint.description || 'ไม่มีรายละเอียดปัญหา'}
                    </p>
                  </div>
                  
                  <div class="space-y-2 text-xs border-t border-slate-100 dark:border-slate-700/50 pt-3 my-3">
                    <div class="flex items-start gap-1.5 text-slate-500 dark:text-slate-400">
                      <svg class="w-4 h-4 shrink-0 mt-0.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                      <span class="truncate" title="${complaint.location || 'ไม่ระบุพิกัด'}">${complaint.location || 'ไม่ระบุพิกัด'}</span>
                    </div>
                    <div class="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                      <svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
                      <span class="truncate" title="${complaint.org_name || 'ไม่ระบุหน่วยงาน'}">${complaint.org_name || 'ไม่ระบุหน่วยงาน'}</span>
                    </div>
                    <div class="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                      <svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                      <span>${complaint.ticket_datetime || 'ไม่ระบุเวลา'}</span>
                    </div>
                    ${complaint.satisfaction_stars ? `
                    <div class="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 pt-1">
                      <span class="font-medium">ความพึงพอใจ:</span>
                      <span class="text-amber-500">${complaint.satisfaction_stars}</span>
                    </div>
                    ` : ''}
                  </div>
                </div>
              </div>
              
              <div class="px-5 pb-5 shrink-0">
                <button onclick="showTimelineModal('${complaint.ticket_id}')" class="w-full bg-violet-50 hover:bg-violet-100 text-violet-700 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 border border-violet-100 hover:border-violet-200">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  ดูประวัติการดำเนินการ
                </button>
              </div>
            </div>
          `;
      });
      grid.innerHTML = html;
    }

    window.showTimelineModal = function (ticketId) {
      if (!window.complaintsList) return;
      const complaint = window.complaintsList.find(c => c.ticket_id === ticketId);
      if (!complaint) return;

      const modal = document.getElementById('timelineModal');
      const typeEl = document.getElementById('modalTicketType');
      const idEl = document.getElementById('modalTicketId');
      const bodyEl = document.getElementById('modalTimelineBody');

      if (!modal || !bodyEl) return;

      typeEl.innerText = complaint.problem_type || 'เรื่องร้องเรียนทั่วไป';
      idEl.innerText = 'ใบงาน #' + ticketId;

      let timelineItems = [];
      try {
        const rawTimeline = complaint.raw_timeline;
        const timelineObj = typeof rawTimeline === 'string' ? JSON.parse(rawTimeline) : rawTimeline;
        timelineItems = timelineObj?.results?.case?.timeline || [];
      } catch (e) {
        console.error("Error parsing timeline data", e);
      }

      if (timelineItems.length === 0) {
        bodyEl.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 text-slate-400">
              <svg class="w-12 h-12 text-slate-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
              <span>ไม่พบข้อมูลประวัติการดำเนินการ (ยังไม่มีข้อมูลในระบบ)</span>
            </div>
          `;
      } else {
        let timelineHTML = `<div class="relative border-l-2 border-slate-150 pl-6 ml-4 space-y-6">`;

        timelineItems.forEach((item) => {
          let stateColor = 'bg-slate-400';
          let stateText = item.tl_state_name || 'รอดำเนินการ';

          if (stateText === 'รอรับเรื่อง') {
            stateColor = 'bg-rose-500 ring-rose-200';
          } else if (stateText === 'กำลังดำเนินการ' || stateText === 'ติดตามเรื่อง' || stateText === 'ภาพการดำเนินการ') {
            stateColor = 'bg-amber-500 ring-amber-200';
          } else if (stateText === 'เสร็จสิ้น') {
            stateColor = 'bg-emerald-50 dark:bg-emerald-900/300 ring-emerald-200';
          }

          const photoHtml = item.photo
            ? `<div class="mt-3 overflow-hidden rounded-xl border border-slate-100 dark:border-slate-700/50 max-w-[200px]">
                   <img src="${item.photo}" class="w-full object-cover transition-transform duration-300 hover:scale-105 cursor-zoom-in" onclick="window.open('${item.photo}')">
                 </div>`
            : '';

          const operatorHtml = item.name
            ? `<div class="text-[10px] text-indigo-600 font-bold bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full inline-block mt-1">
                   👤 โดย: ${item.name}
                 </div>`
            : '';

          timelineHTML += `
              <div class="relative">
                <span class="absolute -left-[31px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full ${stateColor} ring-4 ring-white shadow-sm"></span>
                
                <div class="bg-slate-50 dark:bg-slate-800 hover:bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700/50 hover:border-slate-200 dark:border-slate-700 p-4 rounded-xl shadow-sm transition-all duration-300">
                  <div class="flex flex-wrap items-center justify-between gap-2 mb-1">
                    <span class="text-xs font-mono text-slate-400">🕒 ${item.timestamp || 'ไม่ระบุเวลา'}</span>
                    <span class="text-xs font-bold text-slate-700 dark:text-slate-200">📍 ${stateText}</span>
                  </div>
                  
                  <p class="text-slate-600 dark:text-slate-300 text-sm mt-1 whitespace-pre-wrap">${item.note || 'ไม่มีรายละเอียดเพิ่มเติม'}</p>
                  
                  ${operatorHtml}
                  ${photoHtml}
                </div>
              </div>
            `;
        });

        timelineHTML += `</div>`;
        bodyEl.innerHTML = timelineHTML;
      }

      modal.classList.remove('hidden');
    };

    window.closeTimelineModal = function () {
      const modal = document.getElementById('timelineModal');
      if (modal) modal.classList.add('hidden');
    };

    window.copyComplaintsLogs = function () {
      const logBox = document.getElementById('complaintsLogBox');
      if (!logBox) return;
      const text = Array.from(logBox.children).map(el => el.innerText.trim()).join('\n');
      if (!text) {
        alert('ไม่มีข้อมูลให้คัดลอก');
        return;
      }
      navigator.clipboard.writeText(text).then(() => {
        alert('คัดลอก Lampang Complaints Logs ลงในคลิปบอร์ดเรียบร้อยแล้ว!');
      }).catch(err => {
        console.error('Failed to copy: ', err);
        alert('ไม่สามารถคัดลอกได้');
      });
    };

    window.triggerComplaintsFetch = async function () {
      const btn1 = document.getElementById('forceFetchComplaintsDbBtn');
      const btn2 = document.getElementById('forceFetchComplaintsDbBtn2');
      const btns = [btn1, btn2].filter(b => b);

      if (btns.length === 0) return;
      const originalHTMLs = btns.map(b => b.innerHTML);

      btns.forEach(b => {
        b.innerHTML = '⏳ กำลังสั่งการ...';
        b.disabled = true;
      });

      try {
        const res = await fetch('/api/force-fetch-complaints-db', { method: 'POST' });
        if (res.ok) {
          // Status will sync automatically
        } else {
          alert('เกิดข้อผิดพลาดในการดึงเรื่องร้องเรียน');
        }
      } catch (e) {
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
      }
      setTimeout(() => {
        btns.forEach((b, i) => {
          b.innerHTML = originalHTMLs[i];
          b.disabled = false;
        });
        loadStatus();
      }, 2000);
    }

    window.triggerDroughtFetch = async function (type) {
      const isExcel = type === 'excel';
      const btn1 = isExcel ? document.getElementById('forceFetchDroughtExcelBtn') : document.getElementById('forceFetchDroughtDbBtn');
      const btn2 = isExcel ? document.querySelector('button[onclick="triggerDroughtFetch(\'excel\')"]') : document.querySelector('button[onclick="triggerDroughtFetch(\'db\')"]');
      const btns = Array.from(new Set([btn1, btn2])).filter(b => b);

      if (btns.length === 0) return;
      const originalHTMLs = btns.map(b => b.innerHTML);

      btns.forEach(b => {
        b.innerHTML = '⏳ กำลังสั่งการ...';
        b.disabled = true;
      });

      try {
        const url = isExcel ? '/api/force-fetch-drought-excel' : '/api/force-fetch-drought-db';
        const res = await fetch(url, { method: 'POST' });
        if (res.ok) {
          // Success
        } else {
          alert('เกิดข้อผิดพลาดในการดึงข้อมูลภัยแล้ง');
        }
      } catch (e) {
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
      }
      setTimeout(() => {
        btns.forEach((b, i) => {
          b.innerHTML = originalHTMLs[i];
          b.disabled = false;
        });
        loadStatus();
      }, 2000);
    };

    window.triggerPM25Fetch = async function (type) {
      const isExcel = type === 'excel';
      const btn1 = isExcel ? document.getElementById('forceFetchPM25ExcelBtn') : document.getElementById('forceFetchPM25DbBtn');
      const btn2 = isExcel ? document.querySelector('button[onclick="triggerPM25Fetch(\'excel\')"]') : document.querySelector('button[onclick="triggerPM25Fetch(\'db\')"]');
      const btns = Array.from(new Set([btn1, btn2])).filter(b => b);

      if (btns.length === 0) return;
      const originalHTMLs = btns.map(b => b.innerHTML);

      btns.forEach(b => {
        b.innerHTML = '⏳ กำลังสั่งการ...';
        b.disabled = true;
      });

      try {
        const url = isExcel ? '/api/force-fetch-pm25-excel' : '/api/force-fetch-pm25-db';
        const res = await fetch(url, { method: 'POST' });
        if (res.ok) {
          // Success
        } else {
          alert('เกิดข้อผิดพลาดในการดึงข้อมูลฝุ่น PM 2.5');
        }
      } catch (e) {
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
      }
      setTimeout(() => {
        btns.forEach((b, i) => {
          b.innerHTML = originalHTMLs[i];
          b.disabled = false;
        });
        loadStatus();
      }, 2000);
    };

    async function loadStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();

        const activePage = localStorage.getItem('activePage') || 'home';
        if (activePage === 'complaints') {
          loadComplaints();
        }

        // ==========================================
        // 🏠 UPDATE MAIN DASHBOARD (PAGE: HOME)
        // ==========================================

        // Update page-home stats
        const statCompletedCount = document.getElementById('statCompletedCount');
        if (statCompletedCount && data.completedTasks) {
          const totalTasks = data.completedTasks.length;
          statCompletedCount.innerText = totalTasks + ' งาน';

          const successTasks = data.completedTasks.filter(t => t.status === 'success');
          const failedTasks = data.completedTasks.filter(t => t.status !== 'success');

          const successCount = successTasks.length;
          const failedCount = failedTasks.length;

          const successRate = totalTasks > 0 ? Math.round((successCount / totalTasks) * 100) : 100;

          const statSuccessRate = document.getElementById('statSuccessRate');
          if (statSuccessRate) statSuccessRate.innerText = successRate + '%';

          const statSuccessBar = document.getElementById('statSuccessBar');
          if (statSuccessBar) statSuccessBar.style.width = successRate + '%';

          const statSuccessCountEl = document.getElementById('statSuccessCount');
          if (statSuccessCountEl) statSuccessCountEl.innerText = successCount + ' งาน';

          const statFailedCountEl = document.getElementById('statFailedCount');
          if (statFailedCountEl) statFailedCountEl.innerText = failedCount + ' งาน';

          // Cumulative rows saved
          let totalRows = 0;
          if (data.projectStats) {
            totalRows = (data.projectStats.waterLevel?.rowCountSaved || 0) +
              (data.projectStats.drought?.rowCountSaved || 0) +
              (data.projectStats.pm25?.rowCountSaved || 0) +
              (data.projectStats.complaints?.rowCountSaved || 0);
          }
          const statTotalRowsSaved = document.getElementById('statTotalRowsSaved');
          if (statTotalRowsSaved) statTotalRowsSaved.innerText = totalRows.toLocaleString('th-TH') + ' แถว';
        }

        // Update MySQL Status Card
        const statDbStatus = document.getElementById('statDbStatus');
        if (statDbStatus && data.storageStats) {
          const isWaterDbErr = typeof data.storageStats.waterLevel?.dbRows === 'string' && data.storageStats.waterLevel.dbRows.includes('เชื่อมต่อ');
          const isDroughtDbErr = typeof data.storageStats.drought?.dbRows === 'string' && data.storageStats.drought.dbRows.includes('เชื่อมต่อ');
          const isPm25DbErr = typeof data.storageStats.pm25?.dbRows === 'string' && data.storageStats.pm25.dbRows.includes('เชื่อมต่อ');
          const isComplaintsDbErr = typeof data.storageStats.complaints?.dbRows === 'string' && data.storageStats.complaints.dbRows.includes('เชื่อมต่อ');

          if (isWaterDbErr || isDroughtDbErr || isPm25DbErr || isComplaintsDbErr) {
            statDbStatus.className = "text-lg font-bold text-red-500 flex items-center gap-1.5";
            statDbStatus.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-500"></span> ขัดข้อง';
          } else {
            statDbStatus.className = "text-lg font-bold text-green-600 flex items-center gap-1.5";
            statDbStatus.innerHTML = '<span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> เชื่อมต่อปกติ';
          }
        }

        // Update Chrome Extension Card
        const statExtStatus = document.getElementById('statExtStatus');
        if (statExtStatus) {
          if (data.extensionConnected) {
            statExtStatus.className = "text-lg font-bold text-green-600 flex items-center gap-1.5";
            statExtStatus.innerHTML = '<span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> Connected';
          } else {
            statExtStatus.className = "text-lg font-bold text-amber-500 flex items-center gap-1.5";
            statExtStatus.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-500"></span> Disconnected';
          }
        }

        // Update Active Schedules Card
        const statScheduleCount = document.getElementById('statScheduleCount');
        if (statScheduleCount && data.scheduledTasks) {
          const schedActive = data.isScheduleActive;
          if (schedActive) {
            statScheduleCount.innerText = data.scheduledTasks.length + ' รอบ/วัน';
          } else {
            statScheduleCount.innerText = 'ปิดการทำงาน';
          }
        }

        // Update Verification Cards
        if (data.storageStats) {
          const updateVerifyCard = (projKey, projNameTh) => {
            const dbRows = data.storageStats[projKey]?.dbRows;
            const dbMtime = data.storageStats[projKey]?.dbMtime;
            const excelExists = data.storageStats[projKey]?.excelExists;
            const excelSize = data.storageStats[projKey]?.excelSize;
            const excelMtime = data.storageStats[projKey]?.excelMtime;

            const dbCountEl = document.getElementById('verifyDbCount' + projNameTh);
            const dbMtimeEl = document.getElementById('verifyDbMtime' + projNameTh);
            const excelSizeEl = document.getElementById('verifyExcelSize' + projNameTh);
            const excelMtimeEl = document.getElementById('verifyExcelMtime' + projNameTh);
            const badgeEl = document.getElementById('verifyBadge' + projNameTh);

            if (dbCountEl) {
              if (typeof dbRows === 'number') {
                dbCountEl.innerText = dbRows.toLocaleString('th-TH') + ' แถว';
              } else {
                dbCountEl.innerText = dbRows || 'Error';
              }
            }
            if (dbMtimeEl) {
              dbMtimeEl.innerText = dbMtime || 'N/A';
            }
            if (excelSizeEl) excelSizeEl.innerText = excelExists ? excelSize : 'ไม่พบไฟล์';
            if (excelMtimeEl) excelMtimeEl.innerText = excelExists ? excelMtime : 'N/A';

            if (badgeEl) {
              const isDbValid = typeof dbRows === 'number';
              const isExcelValid = excelExists === true;

              if (isDbValid && (isExcelValid || projKey === 'complaints')) {
                badgeEl.className = "text-[11px] bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60 font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-sm shrink-0 whitespace-nowrap";
                badgeEl.innerHTML = `
                        <svg class="w-3.5 h-3.5 shrink-0 text-emerald-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>
                        บันทึกถูกต้อง
                      `;
              } else {
                badgeEl.className = "text-[11px] bg-amber-50 text-amber-700 border border-amber-200/60 font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-sm shrink-0 whitespace-nowrap";
                badgeEl.innerHTML = `
                        <svg class="w-3.5 h-3.5 shrink-0 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                        พบจุดบกพร่อง
                      `;
              }
            }
          };

          updateVerifyCard('waterLevel', 'Water');
          updateVerifyCard('drought', 'Drought');
          updateVerifyCard('pm25', 'PM25');
          updateVerifyCard('complaints', 'Complaints');

          // Update the "อัปเดตข้อมูลล่าสุด" elements in the dashboard sub-pages
          const mtimeWater = data.storageStats.waterLevel?.dbMtime;
          const mtimeDrought = data.storageStats.drought?.dbMtime;
          const mtimePm25 = data.storageStats.pm25?.dbMtime;
          const mtimeComplaints = data.storageStats.complaints?.dbMtime;

          const waterUpdateEl = document.getElementById('last-update-water');
          if (waterUpdateEl) waterUpdateEl.innerText = mtimeWater || 'ยังไม่เคยบันทึก';

          const droughtUpdateEl = document.getElementById('last-update-drought');
          if (droughtUpdateEl) droughtUpdateEl.innerText = mtimeDrought || 'ยังไม่เคยบันทึก';

          const pm25UpdateEl = document.getElementById('last-update-pm25');
          if (pm25UpdateEl) pm25UpdateEl.innerText = mtimePm25 || 'ยังไม่เคยบันทึก';

          const complaintsUpdateEl = document.getElementById('last-update-complaints');
          if (complaintsUpdateEl) complaintsUpdateEl.innerText = mtimeComplaints || 'ยังไม่เคยบันทึก';
        }

        // Update Completed Tasks Timeline Feed
        const homeTaskFeed = document.getElementById('homeTaskFeed');
        const taskHistoryCounter = document.getElementById('taskHistoryCounter');
        if (homeTaskFeed && data.completedTasks) {
          if (taskHistoryCounter) {
            taskHistoryCounter.innerText = `${data.completedTasks.length} งานล่าสุด`;
          }

          if (data.completedTasks.length === 0) {
            homeTaskFeed.innerHTML = `
                    <div class="flex flex-col items-center justify-center h-full text-slate-400 border-2 border-dashed border-slate-100 dark:border-slate-700/50 rounded-2xl py-8">
                      <svg class="w-12 h-12 text-slate-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      <span>ยังไม่มีประวัติการทำงานในระบบ</span>
                    </div>
                  `;
          } else {
            let feedHTML = '';
            data.completedTasks.forEach(task => {
              let themeClasses = 'bg-blue-50 text-blue-600';
              let iconSVG = '';

              if (task.projectName.includes('น้ำ') || task.projectName.toLowerCase().includes('water')) {
                themeClasses = 'bg-blue-50 text-blue-600';
                iconSVG = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 9.172V5L8 4z"></path></svg>`;
              } else if (task.projectName.includes('ภัยแล้ง') || task.projectName.toLowerCase().includes('drought')) {
                themeClasses = 'bg-amber-50 text-amber-600';
                iconSVG = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707-.707"></path></svg>`;
              } else if (task.projectName.includes('PM') || task.projectName.toLowerCase().includes('pm25') || task.projectName.toLowerCase().includes('pm 2.5')) {
                themeClasses = 'bg-emerald-50 text-emerald-600';
                iconSVG = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"></path></svg>`;
              } else if (task.projectName.includes('ร้องเรียน') || task.projectName.toLowerCase().includes('complaint')) {
                themeClasses = 'bg-violet-50 text-violet-600';
                iconSVG = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>`;
              }

              const statusBadge = task.status === 'success'
                ? `<span class="bg-green-100 text-green-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-0.5 shadow-sm border border-green-200">
                          <span class="w-1.5 h-1.5 rounded-full bg-green-500"></span> สำเร็จ
                         </span>`
                : `<span class="bg-red-100 text-red-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-0.5 shadow-sm border border-red-200">
                          <span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span> ล้มเหลว
                         </span>`;

              const modeColor = task.taskType.includes('Database') ? 'bg-cyan-50 text-cyan-800 border-cyan-100' : 'bg-indigo-50 text-indigo-800 border-indigo-100';
              const countTag = task.count > 0
                ? `<span class="text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">+${task.count} รายการ</span>`
                : '';

              feedHTML += `
                      <div class="flex gap-3 bg-slate-50 dark:bg-slate-800 hover:bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700/50 hover:border-slate-200 dark:border-slate-700 p-4 rounded-xl shadow-sm hover:shadow transition-all duration-300 group">
                        <div class="w-10 h-10 rounded-lg ${themeClasses} flex items-center justify-center shadow-inner group-hover:scale-105 transition-transform duration-300 shrink-0">
                          ${iconSVG}
                        </div>
                        <div class="flex-1 min-w-0 space-y-1.5">
                          <div class="flex items-start justify-between gap-2">
                            <div>
                              <span class="font-bold text-slate-800 dark:text-slate-100 text-sm group-hover:text-blue-600 dark:text-blue-400 transition-colors">${task.projectName}</span>
                              <span class="text-[10px] font-semibold border ${modeColor} px-1.5 py-0.5 rounded ml-1.5">${task.taskType}</span>
                            </div>
                            <div class="flex items-center gap-1.5 shrink-0">
                              ${countTag}
                              ${statusBadge}
                            </div>
                          </div>
                          <p class="text-slate-500 dark:text-slate-400 text-xs truncate max-w-lg" title="${task.details}">${task.details}</p>
                          <div class="flex justify-between items-center text-[10px] text-slate-400 font-mono">
                            <span>ID: ${task.id}</span>
                            <span>🕒 ${task.timestamp}</span>
                          </div>
                        </div>
                      </div>
                    `;
            });
            homeTaskFeed.innerHTML = feedHTML;
          }
        }

        // ==========================================
        // 🤖 ORIGINAL LOGIC CONTINUES
        // ==========================================

        const extStatus = document.getElementById('extStatus');
        if (extStatus) {
          if (data.extensionConnected) {
            extStatus.innerHTML = '<div class="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></div> <span class="text-green-600">เชื่อมต่อแล้ว (Connected)</span>';
          } else {
            extStatus.innerHTML = '<div class="w-2.5 h-2.5 rounded-full bg-red-500"></div> ไม่ได้เชื่อมต่อ (Disconnected)';
          }
        }

        const droughtExtStatus = document.getElementById('droughtExtStatus');
        if (droughtExtStatus) {
          if (data.extensionConnected) {
            droughtExtStatus.innerHTML = '<div class="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></div> <span class="text-green-600">เชื่อมต่อแล้ว (Connected)</span>';
          } else {
            droughtExtStatus.innerHTML = '<div class="w-2.5 h-2.5 rounded-full bg-red-500"></div> ไม่ได้เชื่อมต่อ (Disconnected)';
          }
        }

        const pm25ExtStatus = document.getElementById('pm25ExtStatus');
        if (pm25ExtStatus) {
          if (data.extensionConnected) {
            pm25ExtStatus.innerHTML = '<div class="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></div> <span class="text-green-600">เชื่อมต่อแล้ว (Connected)</span>';
          } else {
            pm25ExtStatus.innerHTML = '<div class="w-2.5 h-2.5 rounded-full bg-red-500"></div> ไม่ได้เชื่อมต่อ (Disconnected)';
          }
        }

        const complaintsExtStatus = document.getElementById('complaintsExtStatus');
        if (complaintsExtStatus) {
          if (data.extensionConnected) {
            complaintsExtStatus.innerHTML = '<div class="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></div> <span class="text-green-600">เชื่อมต่อแล้ว (Connected)</span>';
          } else {
            complaintsExtStatus.innerHTML = '<div class="w-2.5 h-2.5 rounded-full bg-red-500"></div> ไม่ได้เชื่อมต่อ (Disconnected)';
          }
        }

        const fireExtStatus = document.getElementById('fireExtStatus');
        if (fireExtStatus) {
          if (data.extensionConnected) {
            fireExtStatus.innerHTML = '<div class="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></div> <span class="text-green-600">เชื่อมต่อแล้ว (Connected)</span>';
          } else {
            fireExtStatus.innerHTML = '<div class="w-2.5 h-2.5 rounded-full bg-red-500"></div> ไม่ได้เชื่อมต่อ (Disconnected)';
          }
        }

        if (document.getElementById('lastFetchTime')) document.getElementById('lastFetchTime').innerText = data.lastFetch;
        if (document.getElementById('droughtLastFetchTime')) document.getElementById('droughtLastFetchTime').innerText = data.lastFetch;
        if (document.getElementById('pm25LastFetchTime')) document.getElementById('pm25LastFetchTime').innerText = data.lastFetch;
        if (document.getElementById('complaintsLastFetchTime')) document.getElementById('complaintsLastFetchTime').innerText = data.lastFetch;
        if (document.getElementById('fireLastFetchTime')) document.getElementById('fireLastFetchTime').innerText = data.lastFetch;

        if (data.scheduledTasks !== undefined && !tasksDirty) {
          currentTasks = data.scheduledTasks;
          renderTasks();
        }

        if (data.isScheduleActive !== undefined) {
          let scheduleState = data.isScheduleActive;
          if (typeof scheduleState === 'boolean') {
            scheduleState = { water: scheduleState, drought: scheduleState, pm25: scheduleState, complaints: scheduleState };
          }
          currentScheduleState = scheduleState;
          const projects = [
            { key: 'water', btn: 'toggleScheduleBtn_water', subBtn: 'toggleScheduleBtn_water_sub', status: 'waterScheduleStatus', name: 'ระดับน้ำ' },
            { key: 'drought', btn: 'toggleScheduleBtn_drought', subBtn: 'toggleScheduleBtn_drought_sub', status: 'droughtScheduleStatus', name: 'ภัยแล้ง' },
            { key: 'pm25', btn: 'toggleScheduleBtn_pm25', subBtn: 'toggleScheduleBtn_pm25_sub', status: 'pm25ScheduleStatus', name: 'PM 2.5' },
            { key: 'complaints', btn: 'toggleScheduleBtn_complaints', subBtn: 'toggleScheduleBtn_complaints_sub', status: 'complaintsScheduleStatus', name: 'ร้องเรียน' }
          ];

          const projectColors = {
            'water': 'bg-blue-600 hover:bg-blue-700',
            'drought': 'bg-amber-600 hover:bg-amber-700',
            'pm25': 'bg-emerald-600 hover:bg-emerald-700',
            'complaints': 'bg-purple-600 hover:bg-purple-700'
          };

          projects.forEach(p => {
            const isActive = currentScheduleState[p.key];
            const themeColor = projectColors[p.key] || 'bg-green-600 hover:bg-green-700';

            const btnEl = document.getElementById(p.btn);
            if (btnEl) {
              btnEl.className = isActive ? `${themeColor} text-white px-2.5 py-1 rounded-full font-medium transition-colors text-[11px] flex items-center gap-1.5 shadow-sm shrink-0` : "bg-slate-500 hover:bg-slate-600 text-white px-2.5 py-1 rounded-full font-medium transition-colors text-[11px] flex items-center gap-1.5 shadow-sm shrink-0";
              btnEl.innerHTML = isActive ? '<div class="w-2 h-2 rounded-full animate-flash-red-white"></div> เปิด (ON)' : '<div class="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-700"></div> ปิด (OFF)';
            }
            const subBtnEl = document.getElementById(p.subBtn);
            if (subBtnEl) {
              subBtnEl.className = isActive ? `${themeColor} text-white px-4 py-3.5 rounded-2xl font-black flex flex-col items-center justify-center gap-2 text-sm transition-all shadow-sm hover:scale-[1.02] hover:shadow-md` : "bg-slate-500 hover:bg-slate-600 text-white px-4 py-3.5 rounded-2xl font-black flex flex-col items-center justify-center gap-2 text-sm transition-all shadow-sm hover:scale-[1.02]";
              subBtnEl.innerHTML = isActive ? `<div class="w-3.5 h-3.5 rounded-full animate-flash-red-white shadow-[0_0_8px_rgba(255,255,255,0.8)]"></div> <span>${p.name} (ON)</span>` : `<div class="w-3.5 h-3.5 rounded-full bg-slate-300 dark:bg-slate-700"></div> <span>${p.name} (OFF)</span>`;
            }
            if (p.status) {
              const statusEl = document.getElementById(p.status);
              if (statusEl) {
                statusEl.className = isActive ? `${themeColor} text-white px-4 py-1.5 rounded-full font-medium text-sm flex items-center gap-2 cursor-pointer shadow-sm` : "bg-slate-500 text-white px-4 py-1.5 rounded-full font-medium text-sm flex items-center gap-2 cursor-pointer shadow-sm";
                statusEl.innerHTML = isActive ? '<div class="w-3 h-3 rounded-full animate-flash-red-white"></div> เปิดใช้งาน (ON)' : '<div class="w-3 h-3 rounded-full bg-slate-300 dark:bg-slate-700"></div> ปิดใช้งาน (OFF)';
                statusEl.onclick = () => window.toggleSchedule(p.key);
              }
            }
          });
        }

        const logBox = document.getElementById('logBox');
        if (logBox && data.logs) {
          logBox.innerHTML = data.logs.slice(0, 80).map(formatRealtimeLogLine).join('');
          logsLoaded = true;
        }
        if (data.logs) {
          appendFilteredLogs('waterLogBox', data.logs, ['ระดับน้ำ', 'น้ำฝน', 'SmartSleep', 'ParallelAPI', 'GitHubSync', 'แจ้งเตือน']);
          appendFilteredLogs('droughtLogBox', data.logs, ['ภัยแล้ง', 'อ่าง', 'เขื่อน', 'SmartSleep', 'ParallelAPI', 'GitHubSync', 'แจ้งเตือน']);
          appendFilteredLogs('pm25LogBox', data.logs, ['PM 2.5', 'PM2.5', 'ฝุ่น', 'SmartSleep', 'ParallelAPI', 'GitHubSync', 'แจ้งเตือน']);
          appendFilteredLogs('complaintsLogBox', data.logs, ['ร้องเรียน', 'Traffy', 'Cookie', 'Session', 'Extension', 'SmartSleep', 'ParallelAPI', 'GitHubSync']);
          droughtLogsLoaded = true;
          pm25LogsLoaded = true;
          complaintsLogsLoaded = true;
        }
        if (typeof window.updateFreshnessStrip === 'function') {
          window.updateFreshnessStrip(data.freshness || {}, data.retryQueue || {});
        }
      } catch (e) {
        console.error('Error fetching status', e);
      }
    }

    window.forceFetch = async function () {
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

    window.forceFetchDB = async function () {
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

    window.forceFetchRainfallDB = async function () {
      const btn = document.getElementById('forceFetchRainfallDbBtn');
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '⏳ กำลังสั่งการ...';
      btn.disabled = true;
      try {
        await fetch('/api/force-fetch-rainfall-db', { method: 'POST' });
      } catch (e) {
        alert('เกิดข้อผิดพลาดในการสั่งการฐานข้อมูลปริมาณน้ำฝน');
      }
      setTimeout(() => {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
        loadStatus();
      }, 2000);
    }

    window.toggleSchedule = async function (project) {
      if (!currentScheduleState) return;
      const newActive = !currentScheduleState[project];
      try {
        const res = await fetch('/api/schedule/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project, active: newActive })
        });
        const data = await res.json();
        if (data.success) {
          currentScheduleState = data.isScheduleActive;
          loadStatus();
        }
      } catch (e) {
        console.error('Error toggling schedule:', e);
        alert('เกิดข้อผิดพลาดในการเปลี่ยนสถานะ');
      }
    };

    window.renderTasks = function () {
      const taskListEl = document.getElementById('taskList');
      if (!taskListEl) return;
      taskListEl.innerHTML = '';
      if (currentTasks.length === 0) {
        taskListEl.innerHTML = '<li class="col-span-full text-slate-400 text-base font-semibold py-10 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl bg-slate-50/50 dark:bg-slate-900/30">ไม่มีการตั้งเวลาไว้</li>';
        return;
      }

      currentTasks.forEach((time, index) => {
        const li = document.createElement('li');
        li.className = "flex items-center justify-between bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3.5 px-4.5 rounded-2xl shadow-sm hover:border-pink-300 dark:hover:border-pink-700 hover:shadow-md transition-all duration-200 hover:scale-[1.02] group";
        li.dataset.time = time;

        if (editingTaskIndex === index) {
          li.innerHTML = `
              <div class="flex items-center gap-1.5 flex-1 mr-1">
                <input type="time" id="editTimeInput_${index}" value="${time}" class="w-full px-2.5 py-1.5 border border-pink-500 rounded-xl focus:outline-none dark:bg-slate-700 dark:text-white dark:border-slate-600 font-mono text-lg font-bold text-center">
              </div>
              <div class="flex items-center gap-1">
                <button onclick="saveEdit(${index})" class="text-green-600 dark:text-green-400 hover:text-green-800 hover:bg-green-50 dark:hover:bg-green-900/30 p-1.5 rounded-lg transition-colors" title="บันทึก">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>
                </button>
                <button onclick="cancelEdit()" class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 p-1.5 rounded-lg transition-colors" title="ยกเลิก">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
              </div>
           `;
        } else {
          li.innerHTML = `
              <div class="flex items-center gap-2.5 cursor-move flex-1">
                <span class="text-slate-400 dark:text-slate-600 font-black text-xl select-none cursor-grab group-hover:text-pink-500 transition-colors">⋮⋮</span>
                <span class="font-mono font-extrabold text-xl sm:text-2xl text-slate-800 dark:text-slate-200">${time}</span>
              </div>
              <div class="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                <button onclick="editTask(${index})" class="text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 p-1.5 rounded-lg transition-colors" title="แก้ไข">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                </button>
                <button onclick="removeTask(${index})" class="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 p-1.5 rounded-lg transition-colors" title="ลบ">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
              </div>
            `;
        }
        taskListEl.appendChild(li);
      });
    };

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

    window.updateTasksFromArray = function () {
      const taskListEl = document.getElementById('taskList');
      if (!taskListEl) return;
      const items = taskListEl.querySelectorAll('li[data-time]');
      currentTasks = Array.from(items).map(li => li.dataset.time);
    };

    window.sortTasks = function () {
      currentTasks.sort();
      renderTasks();
    };

    window.saveTasks = async function () {
      try {
        await fetch('/api/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tasks: currentTasks })
        });
        tasksDirty = false;
        alert('บันทึกการตั้งค่าตารางเวลาสำเร็จ!');
        loadStatus();
      } catch (e) {
        alert('เกิดข้อผิดพลาดในการบันทึกเวลา');
      }
    };

    window.updateThemeBackground = function (pageId, subTabId = null) {
      const container = document.querySelector('.main-bg-gradient');
      if (!container) return;

      // Remove all theme classes first (added bg-theme-home)
      const themeClasses = ['bg-theme-water', 'bg-theme-drought', 'bg-theme-pm25', 'bg-theme-complaints', 'bg-theme-fire', 'bg-theme-general', 'bg-theme-home'];
      container.classList.remove(...themeClasses);

      let selectedTheme = 'bg-theme-general';

      if (pageId === 'home') {
        selectedTheme = 'bg-theme-home';
      } else if (pageId === 'overview') {
        selectedTheme = 'bg-theme-water';
      } else if (pageId === 'drought') {
        selectedTheme = 'bg-theme-drought';
      } else if (pageId === 'fire') {
        selectedTheme = 'bg-theme-fire';
      } else if (pageId === 'pm25') {
        selectedTheme = 'bg-theme-pm25';
      } else if (pageId === 'complaints') {
        selectedTheme = 'bg-theme-complaints';
      } else if (pageId === 'dashboard') {
        const activeSub = subTabId || localStorage.getItem('activeSubTab') || 'water';
        if (activeSub === 'water') selectedTheme = 'bg-theme-water';
        else if (activeSub === 'drought') selectedTheme = 'bg-theme-drought';
        else if (activeSub === 'pm25') selectedTheme = 'bg-theme-pm25';
        else if (activeSub === 'complaints') selectedTheme = 'bg-theme-complaints';
        else if (activeSub === 'risk') selectedTheme = 'bg-theme-fire';
      }

      container.classList.add(selectedTheme);
    };


    window.switchPage = function (pageId) {
      // Auto close sidebar on mobile if open
      if (document.body.classList.contains('sidebar-open')) {
        document.body.classList.remove('sidebar-open');
        const overlay = document.getElementById('sidebar-overlay');
        if (overlay) {
          overlay.classList.add('pointer-events-none', 'opacity-0');
          overlay.classList.remove('opacity-100');
        }
      }

      const pages = ['dashboard', 'home', 'overview', 'drought', 'fire', 'pm25', 'complaints', 'schedule', 'report', 'notification'];
      pages.forEach(p => {
        const pageEl = document.getElementById('page-' + p);
        if (pageEl) pageEl.classList.add('hidden');

        const menuEl = document.getElementById('menu-' + p);
        if (menuEl) {
          menuEl.className = "menu-link flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/50 hover:text-emerald-950 dark:hover:text-white transition-all duration-200 group";

          // Force SVG icon color for inactive state (makes it perfectly visible in light mode white backgrounds)
          const svg = menuEl.querySelector('svg');
          if (svg) {
            svg.setAttribute('class', 'w-5 h-5 text-emerald-600 dark:text-emerald-400 group-hover:text-emerald-700 dark:group-hover:text-emerald-300 transition-colors');
          }
        }
      });

      const targetPage = document.getElementById('page-' + pageId);
      if (targetPage) targetPage.classList.remove('hidden');

      const targetMenu = document.getElementById('menu-' + pageId);
      if (targetMenu) {
        const menuColors = {
          'dashboard': 'bg-pink-600 dark:bg-pink-700/80 shadow-pink-600/20',
          'home': 'bg-pink-600 dark:bg-pink-700/80 shadow-pink-600/20',
          'overview': 'bg-blue-600 dark:bg-blue-700/80 shadow-blue-500/20',
          'drought': 'bg-amber-600 dark:bg-amber-700/80 shadow-amber-500/20',
          'fire': 'bg-red-600 dark:bg-red-700/80 shadow-red-500/20',
          'pm25': 'bg-emerald-600 dark:bg-emerald-700/80 shadow-emerald-500/20',
          'complaints': 'bg-purple-600 dark:bg-purple-700/80 shadow-purple-500/20',
          'schedule': 'bg-pink-600 dark:bg-pink-700/80 shadow-pink-600/20',
          'report': 'bg-blue-600 dark:bg-blue-700/80 shadow-blue-500/20',
          'notification': 'bg-amber-500 dark:bg-amber-600/80 shadow-amber-500/20'
        };
        const activeClass = menuColors[pageId] || 'bg-pink-600 dark:bg-pink-700/80 shadow-pink-600/20';
        targetMenu.className = `menu-link flex items-center gap-3 px-3 py-2 text-sm font-semibold rounded-md ${activeClass} text-white shadow-md transition-all duration-200`;

        // Force SVG icon color to white for active state
        const svg = targetMenu.querySelector('svg');
        if (svg) {
          svg.setAttribute('class', 'w-5 h-5 text-white transition-colors duration-200');
        }
      }

      localStorage.setItem('activePage', pageId);

      const headerTitle = document.querySelector('header h1');
      if (headerTitle) {
        const titles = {
          'dashboard': 'แดชบอร์ดวิเคราะห์ข้อมูล',
          'home': 'หน้าหลัก',
          'overview': 'ข้อมูลน้ำ',
          'drought': 'ข้อมูลภัยแล้ง',
          'fire': 'ข้อมูลหมอกควันไฟป่า',
          'pm25': 'ข้อมูล PM 2.5',
          'complaints': 'ข้อมูลระบบร้องเรียน',
          'schedule': 'ตั้งเวลาทำงาน (Schedule)',
          'report': 'ดึงข้อมูลรายงาน',
          'notification': '🔔 แจ้งเตือนวิกฤตอัตโนมัติ'
        };
        headerTitle.innerText = titles[pageId] || 'Overview';
      }

      if (pageId === 'dashboard') {
        setTimeout(initDashboardCharts, 100);
      } else if (pageId === 'home') {
        if (typeof window.loadSystemLogs === 'function') window.loadSystemLogs();
        if (typeof window.loadExecutionHeatmap === 'function') window.loadExecutionHeatmap();
      } else if (pageId === 'complaints') {
        loadComplaints();
        if (typeof window.loadTraffySessionStatus === 'function') window.loadTraffySessionStatus();
      } else if (pageId === 'notification') {
        if (typeof window.initNotificationPage === 'function') {
          window.initNotificationPage();
        }
      }

      // Update background contextually
      updateThemeBackground(pageId);
    };

    window.switchSubTab = function (subTabId) {
      const subTabs = ['water', 'drought', 'pm25', 'complaints', 'risk', 'gis'];
      const tabColors = {
        'water': 'bg-blue-600 text-white shadow-lg shadow-blue-500/25',
        'drought': 'bg-amber-500 text-white shadow-lg shadow-amber-500/25',
        'pm25': 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/25',
        'complaints': 'bg-purple-600 text-white shadow-lg shadow-purple-500/25',
        'risk': 'bg-rose-600 text-white shadow-lg shadow-rose-500/25',
        'gis': 'bg-teal-600 text-white shadow-lg shadow-teal-500/25'
      };

      subTabs.forEach(t => {
        const btn = document.getElementById('btn-subtab-' + t);
        if (btn) {
          if (t === subTabId) {
            btn.className = `subtab-btn flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-bold rounded-xl transition-all duration-200 ${tabColors[t]}`;
          } else {
            btn.className = "subtab-btn flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-xl transition-all duration-200 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60";
          }
        }

        const page = document.getElementById('sub-page-' + t);
        if (page) {
          page.classList.add('hidden');
        }
      });

      const activePage = document.getElementById('sub-page-' + subTabId);
      if (activePage) {
        activePage.classList.remove('hidden');
      }

      localStorage.setItem('activeSubTab', subTabId);
      if (subTabId === 'risk') {
        fetchRiskIndexData();
      } else if (subTabId === 'gis') {
        setTimeout(() => {
          initGisMap();
          fetchGisData();
        }, 50);
      } else {
        setTimeout(initDashboardCharts, 10);
      }

      // Update background contextually inside dashboard
      updateThemeBackground('dashboard', subTabId);
    };

    let chartDistrictRiskInstance = null;
    let chartFloodVsDroughtInstance = null;
    let currentRiskData = null;

    async function fetchRiskIndexData() {
      try {
        let url = '/api/analytics/risk-index';
        if (currentGlobalStartDate && currentGlobalEndDate) {
          url += `?startDate=${currentGlobalStartDate}&endDate=${currentGlobalEndDate}`;
        }
        const res = await fetch(url);
        const data = await res.json();
        if (!data.success) return;
        currentRiskData = data;
        renderRiskIndexDashboard(data);
      } catch (err) {
        console.error('Error fetching risk index:', err);
      }
    }

    function renderRiskIndexDashboard(data) {
      if (!data || !data.summary) return;
      const { summary, districts, hotspots } = data;

      // 1. Update Gauge & Badges
      const scoreEl = document.getElementById('kpiProvRiskScore');
      if (scoreEl) scoreEl.innerText = summary.compositeScore;

      const badgeEl = document.getElementById('kpiProvRiskBadge');
      if (badgeEl) {
        badgeEl.innerText = summary.riskLevel;
        badgeEl.style.backgroundColor = summary.riskColor + '25';
        badgeEl.style.color = summary.riskColor;
      }

      const threatEl = document.getElementById('kpiProvThreat');
      if (threatEl) threatEl.innerText = `ภัยหลัก: ${summary.primaryThreat}`;

      const gaugeEl = document.getElementById('riskGaugeCircle');
      if (gaugeEl) {
        gaugeEl.style.borderColor = summary.riskColor;
        gaugeEl.style.backgroundColor = summary.riskColor + '15';
      }

      // Counters
      const highEl = document.getElementById('kpiHighRiskCount');
      if (highEl) highEl.innerText = summary.highRiskDistrictsCount;

      const warnEl = document.getElementById('kpiWarningCount');
      if (warnEl) warnEl.innerText = summary.warningDistrictsCount;

      const normEl = document.getElementById('kpiNormalCount');
      if (normEl) normEl.innerText = summary.normalDistrictsCount;

      // AI Recommendation
      const aiTextEl = document.getElementById('riskAiRecommendationText');
      if (aiTextEl) aiTextEl.innerText = summary.aiRecommendation;

      // 2. Chart 1: District Risk Bar Chart
      const isDark = document.documentElement.classList.contains('dark');
      const textColor = isDark ? '#cbd5e1' : '#475569';
      const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

      const ctx1 = document.getElementById('chartDistrictRisk');
      if (ctx1) {
        if (chartDistrictRiskInstance) chartDistrictRiskInstance.destroy();
        chartDistrictRiskInstance = new Chart(ctx1, {
          type: 'bar',
          data: {
            labels: districts.map(d => d.district),
            datasets: [{
              label: 'คะแนนความเสี่ยงรวม (0-100)',
              data: districts.map(d => d.compositeScore),
              backgroundColor: districts.map(d => d.color),
              borderRadius: 8,
              barThickness: 16
            }]
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: ctx => ` คะแนน: ${ctx.parsed.x} / 100 (${districts[ctx.dataIndex].riskLevel})`
                }
              }
            },
            scales: {
              x: {
                min: 0,
                max: 100,
                grid: { color: gridColor },
                ticks: { color: textColor, font: { family: "'Prompt', sans-serif" } }
              },
              y: {
                grid: { display: false },
                ticks: { color: textColor, font: { family: "'Prompt', sans-serif", weight: 'bold' } }
              }
            }
          }
        });
      }

      // 3. Chart 2: Flood vs Drought Risk
      const ctx2 = document.getElementById('chartFloodVsDrought');
      if (ctx2) {
        if (chartFloodVsDroughtInstance) chartFloodVsDroughtInstance.destroy();
        chartFloodVsDroughtInstance = new Chart(ctx2, {
          type: 'bar',
          data: {
            labels: districts.map(d => d.district),
            datasets: [
              {
                label: 'ความเสี่ยงน้ำท่วม (Flood)',
                data: districts.map(d => d.floodScore),
                backgroundColor: 'rgba(59, 130, 246, 0.85)',
                borderColor: '#2563eb',
                borderWidth: 1,
                borderRadius: 6
              },
              {
                label: 'ความเสี่ยงภัยแล้ง (Drought)',
                data: districts.map(d => d.droughtScore),
                backgroundColor: 'rgba(245, 158, 11, 0.85)',
                borderColor: '#d97706',
                borderWidth: 1,
                borderRadius: 6
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'top',
                labels: { color: textColor, font: { family: "'Prompt', sans-serif", weight: 'bold' } }
              },
              tooltip: {
                callbacks: {
                  label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y} คะแนน`
                }
              }
            },
            scales: {
              x: {
                grid: { display: false },
                ticks: { color: textColor, font: { family: "'Prompt', sans-serif" } }
              },
              y: {
                min: 0,
                max: 100,
                grid: { color: gridColor },
                ticks: { color: textColor, font: { family: "'Prompt', sans-serif" } }
              }
            }
          }
        });
      }

      // 4. Hotspots Table
      const tbody = document.getElementById('riskHotspotsTableBody');
      const countBadge = document.getElementById('hotspotsCountBadge');
      if (countBadge) countBadge.innerText = `พบ ${hotspots.length} จุดเฝ้าระวัง`;

      if (tbody) {
        if (hotspots.length === 0) {
          tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-400 font-semibold">ไม่พบจุดเสี่ยงวิกฤต ทุกจุดตรวจวัดอยู่ในเกณฑ์ปลอดภัย</td></tr>`;
        } else {
          tbody.innerHTML = hotspots.map(h => `
            <tr class="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
              <td class="py-3 px-4">
                <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${h.type === 'อ่างเก็บน้ำ' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'}">
                  ${h.type === 'อ่างเก็บน้ำ' ? '🏞️' : '🌊'} ${h.type}
                </span>
              </td>
              <td class="py-3 px-4 font-bold text-slate-800 dark:text-white">${h.name}</td>
              <td class="py-3 px-4 text-slate-600 dark:text-slate-300">${h.amphoe}</td>
              <td class="py-3 px-4 text-center font-bold font-mono text-base" style="color: ${h.color}">${h.score}</td>
              <td class="py-3 px-4 text-center">
                <span class="px-2.5 py-0.5 rounded-full text-xs font-bold" style="background-color: ${h.color}25; color: ${h.color};">
                  ${h.riskLevel}
                </span>
              </td>
              <td class="py-3 px-4 text-slate-500 dark:text-slate-400 text-xs">${h.detail}</td>
            </tr>
          `).join('');
        }
      }
    }

    // =========================================================================
    // 🗺️ Interactive GIS Map Engine (Leaflet.js)
    // =========================================================================
    let gisMap = null;
    let gisData = null;
    let layerStations = null;
    let layerDams = null;
    let layerCritical = null;
    let layerRain = null;
    let layerDistricts = null;

    let activeGisLayers = {
      all: true,
      critical: false,
      rain: false,
      districts: false
    };

    function initGisMap() {
      const container = document.getElementById('lampangGisMap');
      if (!container || typeof L === 'undefined') return;

      if (gisMap) {
        gisMap.invalidateSize();
        return;
      }

      // Initialize Leaflet map centered on Lampang
      gisMap = L.map('lampangGisMap', {
        center: [18.2888, 99.4920],
        zoom: 9,
        minZoom: 8,
        maxZoom: 15,
        zoomControl: true
      });

      // OpenStreetMap Basemap (Crisp, complete Thai geographic names, no API key watermark)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
      }).addTo(gisMap);

      // Initialize feature layer groups
      layerStations = L.layerGroup().addTo(gisMap);
      layerDams = L.layerGroup().addTo(gisMap);
      layerCritical = L.layerGroup();
      layerRain = L.layerGroup();
      layerDistricts = L.layerGroup();
    }

    async function fetchGisData(force = false) {
      try {
        if (!gisMap) initGisMap();
        const res = await fetch('/api/gis/map-data');
        const data = await res.json();
        if (!data.success) return;
        gisData = data;
        renderGisMapFeatures(data);
        renderGisTable(data);
      } catch (err) {
        console.error('Error loading GIS map data:', err);
      }
    }

    function renderGisMapFeatures(data) {
      if (!gisMap || !data) return;
      layerStations.clearLayers();
      layerDams.clearLayers();
      layerCritical.clearLayers();
      layerRain.clearLayers();
      layerDistricts.clearLayers();

      const { stations, dams, districts, rainCircles, summary } = data;

      // Update counters
      const allBadge = document.getElementById('gisAllBadge');
      if (allBadge) allBadge.innerText = (stations.length + dams.length);
      const critBadge = document.getElementById('gisCritBadge');
      if (critBadge) critBadge.innerText = summary.criticalCount;

      // 1. Water Station Markers
      stations.forEach(s => {
        const pinHtml = `
          <div class="relative flex items-center justify-center cursor-pointer group">
            ${s.isCritical ? '<div class="absolute w-7 h-7 rounded-full bg-red-500/40 animate-ping"></div>' : ''}
            <div class="w-5 h-5 rounded-full border-2 border-white shadow-md flex items-center justify-center text-white text-[9px] font-bold"
                 style="background-color: ${s.color};">
              💧
            </div>
          </div>
        `;
        const icon = L.divIcon({
          className: 'custom-gis-pin',
          html: pinHtml,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        });

        const popupHtml = `
          <div class="p-4 space-y-2.5 min-w-[270px]">
            <p class="text-xs text-slate-500">${s.coordinatePrecision === "district_center" ? "?????????????????????????????? ?????????????????????" : "??????????????????????????"}</p>
            <div class="flex items-center justify-between border-b border-slate-100 pb-2">
              <div>
                <span class="text-[10px] font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">สถานีวัดน้ำ</span>
                <h4 class="font-bold text-slate-800 text-sm mt-0.5">${s.name}</h4>
              </div>
              <span class="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full whitespace-nowrap" style="background-color: ${s.color}25; color: ${s.color};">
                ${s.severityLabel}
              </span>
            </div>
            <div class="text-xs text-slate-600 space-y-1.5">
              <div class="flex justify-between items-center"><span class="text-slate-500">ลำน้ำ:</span> <strong class="text-slate-800">${s.river}</strong></div>
              <div class="flex justify-between items-center"><span class="text-slate-500">อำเภอ:</span> <strong class="text-slate-800">${s.amphoe}</strong></div>
              <div class="flex justify-between items-center"><span class="text-slate-500">ระดับน้ำปัจจุบัน:</span> <strong class="text-blue-600 font-mono font-bold">${s.currentWaterLevel} ม.</strong></div>
              <div class="flex justify-between items-center"><span class="text-slate-500">ระดับตลิ่งซ้าย:</span> <strong class="font-mono">${s.leftBankLevel > 0 ? s.leftBankLevel + ' ม.' : '-'}</strong></div>
              ${s.bankDiff !== null ? `<div class="flex justify-between items-center"><span class="text-slate-500">ระยะห่างตลิ่ง:</span> <strong class="font-mono ${s.bankDiff <= 0.5 ? 'text-red-500 font-bold' : 'text-slate-700'}">${s.bankDiff.toFixed(2)} ม.</strong></div>` : ''}
              <div class="flex justify-between items-center"><span class="text-slate-500">ฝนรายวันในพื้นที่:</span> <strong class="font-mono text-cyan-700">${s.totalRain24h} มม.</strong></div>
            </div>
          </div>
        `;

        const marker = L.marker([s.lat, s.lng], { icon }).bindPopup(popupHtml);
        layerStations.addLayer(marker);
        if (s.isCritical) {
          const critMarker = L.marker([s.lat, s.lng], { icon }).bindPopup(popupHtml);
          layerCritical.addLayer(critMarker);
        }
      });

      // 2. Dam Markers
      dams.forEach(d => {
        const pinHtml = `
          <div class="relative flex items-center justify-center cursor-pointer group">
            ${d.isCritical ? '<div class="absolute w-7 h-7 rounded-full bg-red-500/40 animate-ping"></div>' : ''}
            <div class="w-5 h-5 rounded-lg border-2 border-white shadow-md flex items-center justify-center text-white text-[9px] font-bold"
                 style="background-color: ${d.color};">
              🛡️
            </div>
          </div>
        `;
        const icon = L.divIcon({
          className: 'custom-gis-dam-pin',
          html: pinHtml,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        });

        const popupHtml = `
          <div class="p-4 space-y-2.5 min-w-[270px]">
            <div class="flex items-center justify-between border-b border-slate-100 pb-2">
              <div>
                <span class="text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">${d.damType}</span>
                <h4 class="font-bold text-slate-800 text-sm mt-0.5">${d.name}</h4>
              </div>
              <span class="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full whitespace-nowrap" style="background-color: ${d.color}25; color: ${d.color};">
                ${d.severityLabel}
              </span>
            </div>
            <div class="text-xs text-slate-600 space-y-1.5">
              <div class="flex justify-between items-center"><span class="text-slate-500">อำเภอ:</span> <strong class="text-slate-800">${d.amphoe}</strong></div>
              <div class="flex justify-between items-center"><span class="text-slate-500">ความจุอ่าง:</span> <strong class="font-mono">${d.capacity} ล้าน ลบ.ม.</strong></div>
              <div class="flex justify-between items-center"><span class="text-slate-500">ปริมาณน้ำกักเก็บ:</span> <strong class="text-blue-600 font-mono font-bold">${d.volume} ล้าน ลบ.ม.</strong></div>
              <div class="flex justify-between items-center"><span class="text-slate-500">สัดส่วนน้ำคงเหลือ:</span> <strong class="text-amber-600 font-mono font-bold">${d.percent}%</strong></div>
              <div class="flex justify-between items-center"><span class="text-slate-500">น้ำใช้การได้:</span> <strong class="font-mono text-emerald-600">${d.usable} ล้าน ลบ.ม.</strong></div>
            </div>
          </div>
        `;

        const marker = L.marker([d.lat, d.lng], { icon }).bindPopup(popupHtml);
        layerDams.addLayer(marker);
        if (d.isCritical) {
          const critMarker = L.marker([d.lat, d.lng], { icon }).bindPopup(popupHtml);
          layerCritical.addLayer(critMarker);
        }
      });

      // 3. Rainfall Heatmap / Intensity Circles Layer
      rainCircles.forEach(rc => {
        const circle = L.circle([rc.lat, rc.lng], {
          color: rc.color,
          fillColor: rc.color,
          fillOpacity: 0.22,
          weight: 1.5,
          radius: rc.radius
        }).bindTooltip(`🌧️ ${rc.name}: ฝนสะสม ${rc.rain_mm} มม.`, { sticky: true });
        layerRain.addLayer(circle);
      });

      // 4. District Centroid Labels
      districts.forEach(dist => {
        const badgeHtml = `<div class="district-map-badge">${dist.districtName}</div>`;
        const icon = L.divIcon({
          className: 'custom-dist-badge',
          html: badgeHtml,
          iconSize: [60, 20],
          iconAnchor: [30, 10]
        });
        const marker = L.marker([dist.lat, dist.lng], { icon });
        layerDistricts.addLayer(marker);
      });
    }

    function toggleGisLayer(layerName) {
      if (!gisMap) return;

      if (layerName === 'critical') {
        activeGisLayers.critical = !activeGisLayers.critical;
        const btn = document.getElementById('btnGisLayerCritical');
        const btnAll = document.getElementById('btnGisLayerAll');
        if (activeGisLayers.critical) {
          gisMap.removeLayer(layerStations);
          gisMap.removeLayer(layerDams);
          gisMap.addLayer(layerCritical);
          btn.className = "gis-layer-toggle-btn px-3 py-1.5 text-xs font-bold rounded-xl transition-all border flex items-center gap-1.5 bg-rose-500 text-white border-rose-600 shadow-md cursor-pointer";
          btnAll.className = "gis-layer-toggle-btn px-3 py-1.5 text-xs font-bold rounded-xl transition-all border flex items-center gap-1.5 bg-white border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 shadow-sm cursor-pointer";
        } else {
          gisMap.removeLayer(layerCritical);
          gisMap.addLayer(layerStations);
          gisMap.addLayer(layerDams);
          btn.className = "gis-layer-toggle-btn px-3 py-1.5 text-xs font-bold rounded-xl transition-all border flex items-center gap-1.5 bg-white border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 hover:border-rose-400 shadow-sm cursor-pointer";
          btnAll.className = "gis-layer-toggle-btn px-3 py-1.5 text-xs font-bold rounded-xl transition-all border flex items-center gap-1.5 bg-teal-50 border-teal-300 text-teal-700 dark:bg-teal-900/40 dark:border-teal-700 dark:text-teal-300 shadow-sm cursor-pointer";
        }
      } else if (layerName === 'all') {
        activeGisLayers.critical = false;
        activeGisLayers.all = true;
        gisMap.removeLayer(layerCritical);
        gisMap.addLayer(layerStations);
        gisMap.addLayer(layerDams);
        const btn = document.getElementById('btnGisLayerCritical');
        const btnAll = document.getElementById('btnGisLayerAll');
        btnAll.className = "gis-layer-toggle-btn px-3 py-1.5 text-xs font-bold rounded-xl transition-all border flex items-center gap-1.5 bg-teal-50 border-teal-300 text-teal-700 dark:bg-teal-900/40 dark:border-teal-700 dark:text-teal-300 shadow-sm cursor-pointer";
        btn.className = "gis-layer-toggle-btn px-3 py-1.5 text-xs font-bold rounded-xl transition-all border flex items-center gap-1.5 bg-white border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 hover:border-rose-400 shadow-sm cursor-pointer";
      } else if (layerName === 'rain') {
        activeGisLayers.rain = !activeGisLayers.rain;
        const btn = document.getElementById('btnGisLayerRain');
        if (activeGisLayers.rain) {
          gisMap.addLayer(layerRain);
          btn.className = "gis-layer-toggle-btn px-3 py-1.5 text-xs font-bold rounded-xl transition-all border flex items-center gap-1.5 bg-blue-600 text-white border-blue-700 shadow-md cursor-pointer";
        } else {
          gisMap.removeLayer(layerRain);
          btn.className = "gis-layer-toggle-btn px-3 py-1.5 text-xs font-bold rounded-xl transition-all border flex items-center gap-1.5 bg-white border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 hover:border-blue-400 shadow-sm cursor-pointer";
        }
      } else if (layerName === 'districts') {
        activeGisLayers.districts = !activeGisLayers.districts;
        const btn = document.getElementById('btnGisLayerDistricts');
        if (activeGisLayers.districts) {
          gisMap.addLayer(layerDistricts);
          btn.className = "gis-layer-toggle-btn px-3 py-1.5 text-xs font-bold rounded-xl transition-all border flex items-center gap-1.5 bg-purple-600 text-white border-purple-700 shadow-md cursor-pointer";
        } else {
          gisMap.removeLayer(layerDistricts);
          btn.className = "gis-layer-toggle-btn px-3 py-1.5 text-xs font-bold rounded-xl transition-all border flex items-center gap-1.5 bg-white border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 hover:border-purple-400 shadow-sm cursor-pointer";
        }
      }
    }

    function resetGisMapView() {
      if (gisMap) {
        gisMap.setView([18.2888, 99.4920], 9);
      }
    }

    function flyToGisFeature(lat, lng, name) {
      if (!gisMap) return;
      gisMap.flyTo([lat, lng], 13, { duration: 1.2 });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function renderGisTable(data) {
      const tbody = document.getElementById('gisTableBody');
      if (!tbody || !data) return;

      const items = [...data.stations, ...data.dams];
      const query = (document.getElementById('gisSearchInput')?.value || '').toLowerCase().trim();
      const dist = document.getElementById('gisDistrictFilter')?.value || '';
      const type = document.getElementById('gisTypeFilter')?.value || '';

      const filtered = items.filter(item => {
        if (query && !item.name.toLowerCase().includes(query) && !item.amphoe.toLowerCase().includes(query)) return false;
        if (dist && item.amphoe !== dist) return false;
        if (type && item.type !== type) return false;
        return true;
      });

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-400">ไม่พบจุดตรวจวัดตามเงื่อนไขค้นหา</td></tr>`;
        return;
      }

      tbody.innerHTML = filtered.map(item => {
        const isStation = item.type === 'station';
        const typeBadge = isStation 
          ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">💧 สถานีวัดน้ำ</span>'
          : '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">🛡️ อ่างเก็บน้ำ</span>';

        const valText = isStation 
          ? `<span class="font-mono text-blue-600 font-bold">${item.currentWaterLevel} ม.</span> (ฝน: ${item.totalRain24h} มม.)`
          : `<span class="font-mono text-amber-600 font-bold">${item.percent}%</span> (${item.volume}/${item.capacity} ล.ลบ.ม.)`;

        return `
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
            <td class="py-3 px-4">${typeBadge}</td>
            <td class="py-3 px-4 font-bold text-slate-800 dark:text-slate-100">${item.name}</td>
            <td class="py-3 px-4 text-slate-600 dark:text-slate-300 font-medium">${item.amphoe}</td>
            <td class="py-3 px-4 text-xs">${valText}</td>
            <td class="py-3 px-4 text-center">
              <span class="px-2.5 py-0.5 rounded-full text-xs font-bold" style="background-color: ${item.color}20; color: ${item.color};">
                ${item.severityLabel}
              </span>
            </td>
            <td class="py-3 px-4 text-center">
              <button onclick="flyToGisFeature(${item.lat}, ${item.lng}, '${item.name}')" 
                class="px-2.5 py-1 text-xs font-semibold bg-teal-50 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/60 rounded-lg transition-all border border-teal-200/60 dark:border-teal-800 cursor-pointer">
                📍 ซูม
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }

    window.filterGisTable = function() {
      if (gisData) renderGisTable(gisData);
    };

    let currentDbData = null;
    let dashboardCharts = [];
    let isRenderingCharts = false;
    let pendingRenderRequest = false;

    let currentGlobalStartDate = '';
    let currentGlobalEndDate = '';
    const WATER_FORECAST_ALL_STATIONS = '__all_stations_average__';

    function selectWaterForecastStation(value = WATER_FORECAST_ALL_STATIONS) {
      const select = document.getElementById('waterForecastStationSelect');
      const optionValues = select ? Array.from(select.options).map(option => option.value) : [];
      const nextValue = optionValues.includes(value) ? value : WATER_FORECAST_ALL_STATIONS;
      localStorage.setItem('selectedWaterForecastStation', nextValue);
      if (select && select.value !== nextValue) {
        select.value = nextValue;
      }
      setTimeout(() => initDashboardCharts(currentGlobalStartDate, currentGlobalEndDate), 50);
    }

    async function initDashboardCharts(startDate = currentGlobalStartDate, endDate = currentGlobalEndDate) {
      if (isRenderingCharts) {
        pendingRenderRequest = true;
        return;
      }
      isRenderingCharts = true;
      pendingRenderRequest = false;

      try {
        let url = '/api/dashboard-summary';
        if (startDate && endDate) {
          url += `?startDate=${startDate}&endDate=${endDate}`;
        }

        const res = await fetch(url);
        const json = await res.json();
        if (!json.success) {
          isRenderingCharts = false;
          return;
        }
        
        // Destroy existing before drawing new ones (moved after fetch to prevent race conditions)
        dashboardCharts.forEach(c => {
          if (c && typeof c.destroy === 'function') c.destroy();
        });
        dashboardCharts = [];

        const dbData = json.data;
        currentDbData = dbData;

        // Auto-set date picker to the latest date from database if no filter is applied (Removed since we default to Today)

        // Helper for Forecasting (Linear Regression)
        function calculateForecast(historyData, futureDays = 3) {
          if (!historyData || historyData.length < 2) return [];
          const yVals = historyData.map(v => Number(v));
          const n = yVals.length;
          let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
          for (let i = 0; i < n; i++) {
            sumX += i;
            sumY += yVals[i];
            sumXY += i * yVals[i];
            sumX2 += i * i;
          }
          const slope = (n * sumXY - sumX * sumY) / ((n * sumX2) - (sumX * sumX));
          const intercept = (sumY - slope * sumX) / n;

          let forecast = Array(n).fill(null);
          forecast[n - 1] = yVals[n - 1]; // Connect line
          for (let i = 0; i < futureDays; i++) {
            let pred = slope * (n + i) + intercept;
            forecast.push(pred > 0 ? Number(pred.toFixed(2)) : 0);
          }
          return forecast;
        }

        const isDark = document.documentElement.classList.contains('dark');
        const textColor = isDark ? '#cbd5e1' : '#475569';
        const gridColor = isDark ? '#334155' : '#e2e8f0';

        // Helper function to wrap long axis labels
        function wrapTickLabel(val, maxChars = 20) {
          if (val === null || val === undefined) return '';
          let label = String(val);
          if (label.length <= maxChars) return label;
          const words = label.split(' ');
          let lines = [];
          let currentLine = '';
          words.forEach(w => {
            if ((currentLine.length + w.length + 1) > maxChars) {
              if (currentLine) lines.push(currentLine);
              if (w.length > maxChars) {
                lines.push(w.substring(0, maxChars) + '...');
              } else {
                currentLine = w;
              }
            } else {
              currentLine = currentLine ? currentLine + ' ' + w : w;
            }
          });
          if (currentLine) lines.push(currentLine);
          return lines;
        }

        // Helper function to dynamically split long tooltip strings into lines of maxChars to prevent overflow on PC & mobile
        function wrapTooltipText(text, maxChars = 40) {
          if (!text) return [];
          const result = [];
          const paragraphs = text.split('\n');
          
          paragraphs.forEach(para => {
            if (!para.trim()) {
              result.push('');
              return;
            }
            
            let currentLine = '';
            // Space split for grouping, but can wrap characters if needed
            const words = para.split(' ');
            
            words.forEach(word => {
              if (!word) return;
              
              if (currentLine.length + word.length + (currentLine ? 1 : 0) > maxChars) {
                if (currentLine) {
                  result.push(currentLine);
                  currentLine = '';
                }
                
                if (word.length > maxChars) {
                  let temp = word;
                  while (temp.length > maxChars) {
                    result.push(temp.substring(0, maxChars));
                    temp = temp.substring(maxChars);
                  }
                  currentLine = temp;
                } else {
                  currentLine = word;
                }
              } else {
                currentLine += (currentLine ? ' ' : '') + word;
              }
            });
            
            if (currentLine) {
              result.push(currentLine);
            }
          });
          
          return result;
        }

        Chart.defaults.color = textColor;
        Chart.defaults.font.family = "'Prompt', 'Inter', sans-serif";

        // Explicitly register the datalabels plugin
        Chart.register(ChartDataLabels);

        const commonOptions = {
          responsive: true,
          maintainAspectRatio: false,
          barPercentage: 0.6,
          categoryPercentage: 0.8,
          layout: {
            padding: { top: 45, bottom: 10, left: 25, right: 30 }
          },
          interaction: {
            mode: 'index',
            intersect: false,
          },
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, padding: 15, font: { size: 12, family: "'Prompt', 'Inter', sans-serif" } } },
            tooltip: {
              enabled: true,
              backgroundColor: isDark ? 'rgba(15, 23, 42, 0.98)' : 'rgba(255, 255, 255, 0.99)',
              titleColor: isDark ? '#f8fafc' : '#0f172a',
              bodyColor: isDark ? '#cbd5e1' : '#334155',
              borderColor: isDark ? '#334155' : '#cbd5e1',
              borderWidth: 1,
              padding: 16,
              cornerRadius: 12,
              titleFont: { size: 15, family: "'Prompt', 'Inter', sans-serif", weight: 'bold' },
              bodyFont: { size: 14, family: "'Prompt', 'Inter', sans-serif", weight: 'normal' },
              footerColor: isDark ? '#fbbf24' : '#7c2d12', // Warm premium amber/gold (dark rust color in light mode for maximum readability)
              footerFont: { size: 13, family: "'Prompt', 'Inter', sans-serif", weight: '600' },
              footerMarginTop: 10,
              displayColors: true,
              boxPadding: 6,
              usePointStyle: true,
              callbacks: {
                title: function (context) {
                  return '📌 ' + (context[0].label || 'ข้อมูล');
                },
                label: function (context) {
                  let label = context.dataset.label || '';
                  let val = context.parsed.y !== null && context.chart.config.options.indexAxis !== 'y' ? context.parsed.y : context.parsed.x !== null && context.chart.config.options.indexAxis === 'y' ? context.parsed.x : context.parsed;
                  let formattedVal = Number(val).toLocaleString(undefined, { maximumFractionDigits: 2 });
                  return ` ${label}: ${formattedVal}`;
                },
                footer: function (context) {
                  if (context.length >= 2) {
                    let isHoriz = context[0].chart.config.options.indexAxis === 'y';
                    let val1 = isHoriz ? context[0].parsed.x : context[0].parsed.y;
                    let val2 = isHoriz ? context[1].parsed.x : context[1].parsed.y;
                    let label2 = context[1].dataset.label || '';
                    if (val1 !== null && val2 !== null) {
                      if (label2.includes('ความจุ') && val2 > 0) {
                        let pct = ((val1 / val2) * 100).toFixed(1);
                        return wrapTooltipText(`💡 สรุปสัดส่วนน้ำ:\nเก็บน้ำไว้ได้ ${pct}% ของความจุอ่างกักเก็บ`);
                      } else if (label2.includes('ตลิ่งซ้าย')) {
                        let diff = (val2 - val1).toFixed(2);
                        if (diff > 0) {
                          return wrapTooltipText(`💡 สรุปสถานการณ์:\nน้ำยังต่ำกว่าตลิ่งอยู่ ${diff} ม. ปลอดภัยดี`);
                        } else {
                          return wrapTooltipText(`💡 สรุปสถานการณ์:\n⚠️ น้ำล้นตลิ่งแล้ว ${Math.abs(diff).toFixed(2)} ม.!`);
                        }
                      } else if (label2.includes('น้ำระบาย')) {
                        let net = (val1 - val2).toFixed(2);
                        return wrapTooltipText(`💡 สรุปยอดไหลเวียน:\nมีน้ำเติมเข้าอ่างมากกว่าระบายออก +${net} ล้าน ลบ.ม.`);
                      }
                    }
                  }
                  return '';
                }
              }
            },
            datalabels: {
              display: true,
              color: isDark ? '#cbd5e1' : '#1e293b', // Higher contrast color for readability
              font: { weight: 'bold', size: 10, family: "'Prompt', 'Inter', sans-serif" }, // Slighter smaller for better spacing
              rotation: 0, // Perfectly horizontal layout (rotation: 0) to avoid slanted cluttered overlapping labels
              anchor: 'end',
              align: (ctx) => {
                if (ctx.chart.config.type === 'bar') {
                  return ctx.chart.config.options.indexAxis === 'y' ? 'right' : 'end';
                }
                return 'top';
              },
              offset: (ctx) => {
                return ctx.chart.config.type === 'bar' ? 4 : 8; // Simple elegant offset without stagger
              },
              formatter: (value, ctx) => {
                if (value === null || value === undefined || value === 0) return '';
                if (ctx.chart.config.type === 'doughnut') return '';

                let formattedNum = Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
                if (ctx.chart.config.type === 'bar' && ctx.chart.data.datasets.length >= 2 && ctx.datasetIndex === 0) {
                  let label2 = ctx.chart.data.datasets[1].label || '';
                  if (label2.includes('ความจุ')) {
                    let compareVal = ctx.chart.data.datasets[1].data[ctx.dataIndex];
                    if (compareVal && compareVal > 0) {
                      let pct = ((value / compareVal) * 100).toFixed(0);
                      return `${formattedNum} (${pct}%)`;
                    }
                  }
                }
                return formattedNum;
              }
            }
          },
          scales: {
            x: {
              grid: {
                display: false, // Clean look: Hide cluttered vertical grid lines on X-axis
                drawBorder: false
              },
              ticks: {
                color: textColor,
                font: { size: 11, family: "'Prompt', 'Inter', sans-serif" },
                callback: function(value, index, values) {
                  let label = this.getLabelForValue ? this.getLabelForValue(value) : value;
                  if (typeof label === 'number') {
                     return new Intl.NumberFormat().format(label);
                  }
                  return wrapTickLabel(label, 20);
                }
              }
            },
            y: {
              grid: {
                color: gridColor,
                drawBorder: false,
                borderDash: [5, 5] // Modern minimalist look: dashed grid lines on Y-axis
              },
              ticks: {
                color: textColor,
                font: { size: 11, family: "'Prompt', 'Inter', sans-serif" },
                callback: function(value, index, values) {
                  let label = this.getLabelForValue ? this.getLabelForValue(value) : value;
                  if (typeof label === 'number') {
                     return new Intl.NumberFormat().format(label);
                  }
                  return wrapTickLabel(label, 20);
                }
              }
            }
          }
        };

        const pieOptions = {
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: { top: 20, bottom: 20, left: 20, right: 20 }
          },
          plugins: {
            legend: { position: 'right', labels: { boxWidth: 15, padding: 15, font: { size: 12, family: "'Prompt', 'Inter', sans-serif" }, usePointStyle: true } },
            tooltip: {
              enabled: true,
              backgroundColor: isDark ? 'rgba(15, 23, 42, 0.98)' : 'rgba(255, 255, 255, 0.99)',
              titleColor: isDark ? '#f8fafc' : '#0f172a',
              bodyColor: isDark ? '#cbd5e1' : '#334155',
              borderColor: isDark ? '#334155' : '#cbd5e1',
              borderWidth: 1,
              padding: 16,
              cornerRadius: 12,
              titleFont: { size: 15, family: "'Prompt', 'Inter', sans-serif", weight: 'bold' },
              bodyFont: { size: 14, family: "'Prompt', 'Inter', sans-serif" },
              footerColor: isDark ? '#fbbf24' : '#7c2d12', // Warm premium amber/gold (dark rust color in light mode for maximum readability)
              footerFont: { size: 13, family: "'Prompt', 'Inter', sans-serif", weight: '600' },
              footerMarginTop: 10,
              displayColors: true,
              boxPadding: 6,
              usePointStyle: true,
              callbacks: {
                label: function (context) {
                  let label = context.label || '';
                  let value = context.parsed;
                  let sum = 0;
                  let dataArr = context.chart.data.datasets[0].data;
                  dataArr.map(data => { sum += Number(data || 0); });
                  let percentage = sum === 0 ? "0%" : (value * 100 / sum).toFixed(1) + "%";
                  return ` ${label}: ${Number(value).toLocaleString()} (${percentage})`;
                },
                afterLabel: function (context) {
                  return '\n✨ แสดงสัดส่วนภาพรวมทั้งหมดได้อย่างชัดเจน';
                }
              }
            },
            datalabels: {
              color: '#ffffff',
              font: { weight: 'bold', size: 12, family: "'Prompt', 'Inter', sans-serif" },
              formatter: (value, ctx) => {
                let sum = 0;
                let dataArr = ctx.chart.data.datasets[0].data;
                dataArr.map(data => { sum += Number(data || 0); });
                if (sum === 0) return '';
                let percentage = (value * 100 / sum).toFixed(1);
                if (percentage < 4) return '';
                return percentage + "%";
              },
              textShadowBlur: 4,
              textShadowColor: 'rgba(0,0,0,0.5)'
            }
          }
        };

        const futureLabels = ['พรุ่งนี้', 'มะรืน', 'วันถัดไป'];
        const activeSubTab = localStorage.getItem('activeSubTab') || 'water';

        // ==========================================
        // 1. SUB-PAGE RENDERING: WATER LEVEL
        // ==========================================
        if (activeSubTab === 'water') {
          let waterCurrent = dbData.water.current || [];
          waterCurrent = waterCurrent.filter(w => !w.station_name.toLowerCase().includes('test'));

          // 1.1 Calculate KPI Metrics
          let totalLvl = 0, validLvlCount = 0, warningCount = 0, totalRain = 0, validRainCount = 0;
          let maxLevel = 0, maxStation = 'N/A', maxAmphoe = '';

          let wCritLow = 0, wLow = 0, wNormal = 0, wHigh = 0, wOverflow = 0;
          waterCurrent.forEach(w => {
            const statusStr = w.status || '';
            const riskStr = w.risk_level || '';
            const lvl = parseFloat(w.current_water_level_m);
            const bank = parseFloat(w.left_bank_level_m) || 0;

            if (statusStr.includes('น้ำน้อยวิกฤต')) {
              wCritLow++;
            } else if (statusStr.includes('น้ำน้อย')) {
              wLow++;
            } else if (statusStr.includes('น้ำล้นตลิ่ง') || riskStr.includes('น้ำล้นตลิ่ง') || (bank > 0 && lvl >= bank)) {
              wOverflow++;
            } else if (statusStr.includes('น้ำมาก') || riskStr.includes('น้ำมาก')) {
              wHigh++;
            } else {
              wNormal++;
            }
          });

          waterCurrent.forEach(w => {
            const lvl = parseFloat(w.current_water_level_m);
            const rain = parseFloat(w.current_rain_mm);
            if (!isNaN(lvl)) {
              totalLvl += lvl;
              validLvlCount++;
              if (lvl > maxLevel) {
                maxLevel = lvl;
                maxStation = w.station_name;
                maxAmphoe = w.amphoe || 'N/A';
              }
            }
            if (!isNaN(rain)) {
              totalRain += rain;
              validRainCount++;
            }

            // Check Warning/Critical based on status from source data (primary)
            // or actual gap between water level and bank level (secondary)
            // NOTE: Values are absolute elevation (ม.รทก.) so we compare the GAP, not a percentage
            const riskStr = w.status || w.risk_level || '';
            let isWarningOrCritical = false;

            // Flood logic: Ignore 'น้ำน้อย' (low water), only alert for high water/overflow
            if (riskStr.includes('น้ำล้นตลิ่ง') || riskStr.includes('น้ำมาก') ||
              (riskStr.includes('วิกฤต') && !riskStr.includes('น้ำน้อย')) ||
              riskStr.includes('เตือนภัย') || riskStr.includes('เฝ้าระวัง')) {
              isWarningOrCritical = true;
            } else if (!isNaN(lvl) && w.left_bank_level_m) {
              const bankLvl = parseFloat(w.left_bank_level_m);
              if (!isNaN(bankLvl) && bankLvl > 0 && lvl >= bankLvl) {
                isWarningOrCritical = true; // Water level has actually reached or exceeded bank level
              }
            }

            if (isWarningOrCritical) {
              warningCount++;
            }
          });

          const avgWater = validLvlCount > 0 ? (totalLvl / validLvlCount).toFixed(2) : 'N/A';
          const avgRain = validRainCount > 0 ? (totalRain / validRainCount).toFixed(1) : '0';

          let rainText = 'N/A';
          let rainColorClass = 'text-slate-500 dark:text-slate-400';
          const rainVal = parseFloat(avgRain);
          if (!isNaN(rainVal)) {
            if (rainVal > 90) {
              rainText = 'หนักมาก';
              rainColorClass = 'text-rose-600 dark:text-rose-500';
            } else if (rainVal > 35) {
              rainText = 'หนัก';
              rainColorClass = 'text-amber-500 dark:text-amber-400';
            } else if (rainVal > 10) {
              rainText = 'ปานกลาง';
              rainColorClass = 'text-emerald-500 dark:text-emerald-400';
            } else if (rainVal > 0) {
              rainText = 'เล็กน้อย';
              rainColorClass = 'text-blue-400 dark:text-blue-300';
            } else {
              rainText = 'ไม่มีฝน';
              rainColorClass = 'text-slate-400 dark:text-slate-500';
            }
          }

          // Set values to DOM
          document.getElementById('kpiAvgWater').innerText = avgWater !== 'N/A' ? `${avgWater} ม.` : 'N/A';
          document.getElementById('kpiWarningWater').innerText = `${warningCount} จุด`;
          
          const rainKpiEl = document.getElementById('kpiAvgRain');
          rainKpiEl.innerText = rainText;
          rainKpiEl.className = `text-2xl font-black font-mono mt-1 block ${rainColorClass}`;

          // 1.2 Initialize Water Charts
          const waterLabels = waterCurrent.map(item => item.station_name);
          const waterLevels = waterCurrent.map(item => item.current_water_level_m ? parseFloat(item.current_water_level_m) : null);

          // Perspective 1: Primary Bar Chart
          const leftBanksPrimary = waterCurrent.map(item => parseFloat(item.left_bank_level_m) || 0);

          const ctxWater1 = document.getElementById('chartWaterPrimary').getContext('2d');
          dashboardCharts.push(new Chart(ctxWater1, {
            type: 'bar',
            data: {
              labels: waterLabels,
              datasets: [{
                label: 'ระดับน้ำ (ม. รทก.)',
                data: waterLevels,
                backgroundColor: '#3b82f6',
                borderRadius: 6,
                bankLevels: leftBanksPrimary
              }]
            },
            options: {
              ...commonOptions,
              plugins: {
                ...commonOptions.plugins,
                datalabels: {
                  ...commonOptions.plugins.datalabels,
                  display: true,
                  rotation: 0, // Make it horizontal for clean layout since it has plenty of space
                  color: isDark ? '#60a5fa' : '#1e3a8a', // Deep elegant blue matching the theme
                  font: {
                    weight: 'bold',
                    size: 10,
                    family: "'Prompt', 'Inter', sans-serif"
                  },
                  align: 'end',
                  anchor: 'end',
                  offset: 4,
                  formatter: (value, ctx) => {
                    return value !== null && value !== undefined ? Number(value).toFixed(1) : '';
                  }
                },
                tooltip: {
                  ...commonOptions.plugins.tooltip,
                  displayColors: false,
                  callbacks: {
                    title: function (context) {
                      let index = context[0].dataIndex;
                      let item = waterCurrent[index];
                      let station = item.station_name || context[0].label || 'ข้อมูล';
                      let amphoe = item.amphoe ? ` (${item.amphoe})` : '';
                      return '📌 ' + station + amphoe;
                    },
                    label: function (context) {
                      let val = context.parsed.y;
                      let formattedVal = val !== null && val !== undefined ? Number(val).toFixed(2) : '-';
                      return `🔵 ระดับน้ำปัจจุบัน: ${formattedVal} เมตร`;
                    },
                    afterBody: function (context) {
                      let index = context[0].dataIndex;
                      let item = waterCurrent[index];
                      let rainVal = item.current_rain_mm !== null && item.current_rain_mm !== undefined ? parseFloat(item.current_rain_mm).toFixed(2) : '0.00';
                      let risk = item.risk_level || 'ปกติ';
                      let riskIcon = '🟢';
                      if (risk.includes('วิกฤต') || risk.includes('สีแดง')) riskIcon = '🔴';
                      else if (risk.includes('เตือนภัย') || risk.includes('สีส้ม')) riskIcon = '🟠';
                      else if (risk.includes('เฝ้าระวัง') || risk.includes('สีเหลือง')) riskIcon = '🟡';
                      
                      return [
                        ...wrapTooltipText(`🌧️ ปริมาณฝนสะสมวันนี้: ${rainVal} มม. (เกิน 50 มม. เสี่ยงเพิ่มขึ้น)`),
                        ...wrapTooltipText(`⚠️ สถานะความปลอดภัย: ${riskIcon} ${risk}`)
                      ];
                    },
                    footer: function (context) {
                      let val = context[0].parsed.y;
                      let bank = context[0].dataset.bankLevels[context[0].dataIndex];
                      if (val !== null && bank > 0) {
                        let diff = bank - val;
                        if (diff >= 0) {
                          return wrapTooltipText(`💡 วิเคราะห์ระดับตลิ่ง:\nตลิ่งสูง ${bank.toFixed(2)} ม. ปัจจุบันน้ำยังต่ำกว่าตลิ่งอยู่ ${diff.toFixed(2)} ม. (ปลอดภัย)`);
                        } else {
                          return wrapTooltipText(`💡 วิเคราะห์ระดับตลิ่ง:\n⚠️ น้ำเอ่อล้นตลิ่งแล้ว ${Math.abs(diff).toFixed(2)} ม.! (เสี่ยงท่วมขัง ควรเตรียมตัวยกของขึ้นที่สูง)`);
                        }
                      }
                      return '';
                    }
                  }
                }
              }
            }
          }));

          // Perspective 2: Station-level Trend, Forecast & Rainfall
          const waterStationHistory = (dbData.water.stationHistory || []).filter(w => w.station_name && !w.station_name.toLowerCase().includes('test'));
          const stationPriorityScore = (w) => {
            const statusStr = w.status || '';
            const riskStr = w.risk_level || '';
            const lvl = parseFloat(w.current_water_level_m);
            const bank = parseFloat(w.left_bank_level_m);
            if (statusStr.includes('น้ำล้นตลิ่ง') || riskStr.includes('น้ำล้นตลิ่ง') || (!isNaN(lvl) && !isNaN(bank) && bank > 0 && lvl >= bank)) return 5;
            if (statusStr.includes('น้ำมาก') || riskStr.includes('น้ำมาก')) return 4;
            if (riskStr.includes('เฝ้าระวัง') || riskStr.includes('เตือนภัย') || (riskStr.includes('วิกฤต') && !riskStr.includes('น้ำน้อย'))) return 3;
            if (statusStr.includes('น้ำน้อย')) return 1;
            return 2;
          };
          const sortedWaterStations = [...waterCurrent].sort((a, b) => {
            const scoreDiff = stationPriorityScore(b) - stationPriorityScore(a);
            if (scoreDiff !== 0) return scoreDiff;
            const gapA = Number.isFinite(parseFloat(a.bank_difference_m)) ? parseFloat(a.bank_difference_m) : Number.POSITIVE_INFINITY;
            const gapB = Number.isFinite(parseFloat(b.bank_difference_m)) ? parseFloat(b.bank_difference_m) : Number.POSITIVE_INFINITY;
            if (gapA !== gapB) return gapA - gapB;
            const rainDiff = (parseFloat(b.current_rain_mm) || 0) - (parseFloat(a.current_rain_mm) || 0);
            if (rainDiff !== 0) return rainDiff;
            return (a.station_name || '').localeCompare(b.station_name || '', 'th');
          });
          const allStationsValue = WATER_FORECAST_ALL_STATIONS;
          const allStationsLabel = 'รวมเฉลี่ยทุกสถานี';
          const stationNames = [...new Set([
            ...sortedWaterStations.map(w => w.station_name),
            ...waterStationHistory.map(w => w.station_name)
          ].filter(Boolean))];
          const forecastChoices = [allStationsValue, ...stationNames];
          const aggregateFromStationHistory = Object.values(waterStationHistory.reduce((acc, row) => {
            const date = row.date;
            if (!date) return acc;
            if (!acc[date]) acc[date] = { date, levelSum: 0, levelCount: 0, rainSum: 0, rainCount: 0, forecastSum: 0, forecastCount: 0 };
            const level = Number(row.current_water_level_m);
            const rain = Number(row.current_rain_mm);
            const forecast = Number(row.rainfall_accum_3d_mm);
            if (Number.isFinite(level)) {
              acc[date].levelSum += level;
              acc[date].levelCount++;
            }
            if (Number.isFinite(rain)) {
              acc[date].rainSum += rain;
              acc[date].rainCount++;
            }
            if (Number.isFinite(forecast)) {
              acc[date].forecastSum += forecast;
              acc[date].forecastCount++;
            }
            return acc;
          }, {})).map(row => ({
            date: row.date,
            current_water_level_m: row.levelCount ? Number((row.levelSum / row.levelCount).toFixed(2)) : null,
            current_rain_mm: row.rainCount ? Number((row.rainSum / row.rainCount).toFixed(2)) : 0,
            rainfall_accum_3d_mm: row.forecastCount ? Number((row.forecastSum / row.forecastCount).toFixed(2)) : 0
          })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
          const aggregateFallbackHistory = (dbData.water.history || []).map(row => ({
            date: row.date,
            current_water_level_m: Number(row.avg_val),
            current_rain_mm: 0,
            rainfall_accum_3d_mm: 0
          })).filter(row => row.date && Number.isFinite(row.current_water_level_m));
          const aggregateHistory = aggregateFromStationHistory.length > 0 ? aggregateFromStationHistory : aggregateFallbackHistory;
          const defaultWaterStation = allStationsValue;
          let selectedWaterStation = localStorage.getItem('selectedWaterForecastStation') || defaultWaterStation;
          if (!forecastChoices.includes(selectedWaterStation)) {
            selectedWaterStation = defaultWaterStation;
          }
          localStorage.setItem('selectedWaterForecastStation', selectedWaterStation);

          const waterStationSelect = document.getElementById('waterForecastStationSelect');
          const allStationsBtn = document.getElementById('waterForecastAllStationsBtn');
          if (allStationsBtn) {
            const isAllStations = selectedWaterStation === allStationsValue;
            allStationsBtn.classList.toggle('opacity-60', isAllStations);
          }
          if (waterStationSelect) {
            waterStationSelect.innerHTML = '';
            const aggregateOption = document.createElement('option');
            aggregateOption.value = allStationsValue;
            aggregateOption.textContent = allStationsLabel;
            aggregateOption.selected = selectedWaterStation === allStationsValue;
            waterStationSelect.appendChild(aggregateOption);
            stationNames.forEach(name => {
              const option = document.createElement('option');
              option.value = name;
              option.textContent = name;
              option.selected = name === selectedWaterStation;
              waterStationSelect.appendChild(option);
              if (name === selectedWaterStation && selectedWaterStation !== allStationsValue) {
                const quickAggregateOption = document.createElement('option');
                quickAggregateOption.value = allStationsValue;
                quickAggregateOption.textContent = `${allStationsLabel} (ดูทั้งหมด)`;
                waterStationSelect.appendChild(quickAggregateOption);
              }
            });
            waterStationSelect.disabled = aggregateHistory.length === 0 && stationNames.length === 0;
          }

          const latestWaterHistoryDate = (dbData.water.history && dbData.water.history.length > 0)
            ? dbData.water.history[dbData.water.history.length - 1].date
            : 'ล่าสุด';
          let selectedStationHistory = selectedWaterStation === allStationsValue
            ? aggregateHistory
            : waterStationHistory.filter(w => w.station_name === selectedWaterStation);
          if (selectedWaterStation !== allStationsValue && selectedStationHistory.length === 0) {
            const currentStation = waterCurrent.find(w => w.station_name === selectedWaterStation);
            if (currentStation) {
              selectedStationHistory = [{
                date: latestWaterHistoryDate,
                current_water_level_m: Number(currentStation.current_water_level_m),
                current_rain_mm: Number(currentStation.current_rain_mm || 0),
                rainfall_accum_3d_mm: Number(currentStation.rainfall_accum_3d_mm || 0)
              }].filter(row => Number.isFinite(row.current_water_level_m));
            }
          }
          const selectedWaterLabel = selectedWaterStation === allStationsValue ? allStationsLabel : selectedWaterStation;
          const waterHistDates = selectedStationHistory.map(d => d.date);
          const waterHistVals = selectedStationHistory.map(d => Number(d.current_water_level_m));
          const waterHistRainVals = selectedStationHistory.map(d => Number(d.current_rain_mm || 0));
          const latestForecastRain3d = Number(selectedStationHistory[selectedStationHistory.length - 1]?.rainfall_accum_3d_mm || 0);
          const forecastRainDaily = latestForecastRain3d > 0 ? Number((latestForecastRain3d / 3).toFixed(2)) : 0;
          const waterForecast = waterHistVals.length >= 2
            ? calculateForecast(waterHistVals, 3)
            : Array(waterHistVals.length + 3).fill(null);
          const waterAllDates = [...waterHistDates, ...futureLabels];

          // 🛡️ Populate Multi-Station Filter Chips
          if (typeof window.populateMultiStationChips === 'function') {
            window.populateMultiStationChips(stationNames);
          }

          // Build Datasets: Multi-Station vs Single Station
          let chartWater2Datasets = [];
          let allVals = [];

          if (window.selectedTrendStations && window.selectedTrendStations.size > 0) {
            const stationArray = Array.from(window.selectedTrendStations);
            stationArray.forEach((stName, idx) => {
              const color = TREND_STATION_COLORS[idx % TREND_STATION_COLORS.length];
              const stHist = waterStationHistory.filter(w => w.station_name === stName);
              const histMap = {};
              stHist.forEach(h => {
                const lvl = Number(h.current_water_level_m);
                if (Number.isFinite(lvl)) histMap[h.date] = lvl;
              });
              const vals = waterHistDates.map(d => histMap[d] !== undefined ? histMap[d] : null);
              vals.forEach(v => { if (v !== null) allVals.push(v); });

              chartWater2Datasets.push({
                type: 'line',
                label: `ระดับน้ำ: ${stName}`,
                data: vals.concat(Array(3).fill(null)),
                yAxisID: 'y',
                borderColor: color,
                backgroundColor: color + '15',
                borderWidth: 2.2,
                pointRadius: 3,
                tension: 0.3
              });

              // Left bank reference line if available
              const currentSt = waterCurrent.find(w => w.station_name === stName);
              const bankVal = parseFloat(currentSt?.left_bank_level_m);
              if (bankVal && !isNaN(bankVal) && bankVal > 0) {
                allVals.push(bankVal);
                chartWater2Datasets.push({
                  type: 'line',
                  label: `ตลิ่ง ${stName} (${bankVal.toFixed(1)} ม.)`,
                  data: Array(waterAllDates.length).fill(bankVal),
                  yAxisID: 'y',
                  borderColor: color,
                  borderDash: [5, 5],
                  borderWidth: 1.2,
                  pointRadius: 0,
                  fill: false
                });
              }
            });

            // Add rainfall bar
            chartWater2Datasets.push({
              type: 'bar',
              label: 'ฝนเฉลี่ยรายวัน (มม.)',
              data: waterHistRainVals.concat(Array(3).fill(null)),
              yAxisID: 'yRain',
              backgroundColor: 'rgba(14, 165, 233, 0.25)',
              borderColor: '#0ea5e9',
              borderWidth: 1,
              borderRadius: 4,
              order: 99
            });
          } else {
            // Default single station or all-stations average
            allVals = [...waterHistVals, ...waterForecast].filter(v => v !== null && Number.isFinite(v));
            chartWater2Datasets = [
              {
                type: 'line',
                label: `ระดับน้ำย้อนหลัง: ${selectedWaterLabel || 'ไม่พบข้อมูล'}`,
                data: waterHistVals.concat(Array(3).fill(null)),
                yAxisID: 'y',
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2.5,
                fill: true,
                tension: 0.3
              },
              {
                type: 'line',
                label: 'พยากรณ์แนวโน้ม (3 วัน)',
                data: waterForecast,
                yAxisID: 'y',
                borderColor: '#f59e0b',
                borderDash: [6, 4],
                borderWidth: 2,
                fill: false,
                tension: 0.3
              },
              {
                type: 'bar',
                label: 'ฝนย้อนหลังรายวัน',
                data: waterHistRainVals.concat(Array(3).fill(null)),
                yAxisID: 'yRain',
                backgroundColor: 'rgba(14, 165, 233, 0.28)',
                borderColor: '#0ea5e9',
                borderWidth: 1,
                borderRadius: 4,
                order: 3
              },
              {
                type: 'bar',
                label: 'สมมติฐานฝนเฉลี่ยจาก 3 วันย้อนหลัง',
                data: Array(waterHistVals.length).fill(null).concat(Array(3).fill(forecastRainDaily)),
                yAxisID: 'yRain',
                backgroundColor: 'rgba(245, 158, 11, 0.28)',
                borderColor: '#f59e0b',
                borderWidth: 1,
                borderRadius: 4,
                order: 4
              }
            ];
          }

          // Calculate dynamic scale boundaries for water level Y-axis to prevent flat line display
          let yMin = undefined;
          let yMax = undefined;
          if (allVals.length > 0) {
            const minVal = Math.min(...allVals);
            const maxVal = Math.max(...allVals);
            const range = maxVal - minVal;
            const padding = range > 0 ? range * 0.2 : 0.5; // Add elegant padding of at least 0.5m
            yMin = Number((minVal - padding).toFixed(2));
            yMax = Number((maxVal + padding).toFixed(2));
            if (yMin < 0) yMin = 0;
          }

          const ctxWater2 = document.getElementById('chartWaterSecondary').getContext('2d');
          dashboardCharts.push(new Chart(ctxWater2, {
            type: 'bar',
            data: {
              labels: waterAllDates,
              datasets: chartWater2Datasets
            },
            options: {
              ...commonOptions,
              scales: {
                ...commonOptions.scales,
                y: {
                  ...commonOptions.scales.y,
                  min: yMin,
                  max: yMax,
                  title: { display: true, text: 'ระดับน้ำ (ม.รทก.)', color: textColor }
                },
                yRain: {
                  position: 'right',
                  grid: { drawOnChartArea: false },
                  title: { display: true, text: 'ปริมาณฝน (มม.)', color: textColor },
                  ticks: {
                    color: textColor,
                    font: { size: 11, family: "'Prompt', 'Inter', sans-serif" },
                    callback: value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })
                  }
                }
              },
              plugins: {
                ...commonOptions.plugins,
                datalabels: { display: false },
                tooltip: {
                  ...commonOptions.plugins.tooltip,
                  displayColors: true,
                  callbacks: {
                    title: function (context) {
                      return '📅 วันที่วิเคราะห์: ' + context[0].label + (selectedWaterLabel ? ` (${selectedWaterLabel})` : '');
                    },
                    label: function (context) {
                      let val = context.parsed.y;
                      if (val === null || val === undefined) return null;
                      const datasetLabel = context.dataset.label || '';
                      if (datasetLabel.includes('ระดับน้ำย้อนหลัง')) {
                        return `🔵 ระดับน้ำย้อนหลังรายสถานี: ${Number(val).toFixed(2)} เมตร`;
                      }
                      if (datasetLabel.includes('พยากรณ์แนวโน้ม')) {
                        return `🟠 พยากรณ์ระดับน้ำ 3 วันข้างหน้า: ${Number(val).toFixed(2)} เมตร`;
                      }
                      if (datasetLabel.includes('ฝนย้อนหลัง')) {
                        return `🔷 ฝนย้อนหลังรายวัน: ${Number(val).toFixed(2)} มม.`;
                      }
                      return `🟡 สมมติฐานฝนเฉลี่ยจาก 3 วันย้อนหลัง: ${Number(val).toFixed(2)} มม.`;
                    },
                    footer: function (context) {
                      return wrapTooltipText('💡 ภาพจำลองทิศทางน้ำรายสถานี (ไม่ใช่พยากรณ์ยืนยัน):\nเส้นพยากรณ์ใช้ประวัติของสถานีที่เลือกเท่านั้น และแท่งสมมติฐานฝนเฉลี่ยจาก 3 วันย้อนหลังคำนวณจากฝนสะสม 3 วัน / 3');
                    }
                  }
                }
              }
            }
          }));

          // Perspective 3: Doughnut Warning Status Share
          const ctxWater3 = document.getElementById('chartWaterTertiary').getContext('2d');

          let displayNormal = wNormal;
          if (wCritLow === 0 && wLow === 0 && wNormal === 0 && wHigh === 0 && wOverflow === 0) { displayNormal = 1; }

          dashboardCharts.push(new Chart(ctxWater3, {
            type: 'doughnut',
            data: {
              labels: ['น้ำน้อยวิกฤต (<=10%)', 'น้ำน้อย (>10-30%)', 'น้ำปกติ (>30-70%)', 'น้ำมาก (>70-100%)', 'น้ำล้นตลิ่ง (>100%)'],
              datasets: [{
                data: [wCritLow, wLow, displayNormal, wHigh, wOverflow],
                backgroundColor: ['#b45309', '#eab308', '#10b981', '#3b82f6', '#ef4444'],
                borderWidth: 0
              }]
            },
            options: {
              ...pieOptions,
              plugins: {
                ...pieOptions.plugins,
                tooltip: {
                  ...pieOptions.plugins.tooltip,
                  displayColors: false,
                  callbacks: {
                    title: function (context) {
                      return '📢 สัดส่วนระดับน้ำทั้งจังหวัด';
                    },
                    label: function (context) {
                      let label = context.label || '';
                      let val = context.parsed;
                      let sum = 0;
                      let dataArr = context.chart.data.datasets[0].data;
                      dataArr.map(data => { sum += Number(data || 0); });
                      let percentage = sum === 0 ? "0%" : (val * 100 / sum).toFixed(1) + "%";
                      
                      let emoji = '⚪';
                      if (label.includes('น้ำน้อยวิกฤต')) emoji = '🟤';
                      else if (label.includes('น้ำน้อย')) emoji = '🟡';
                      else if (label.includes('น้ำปกติ')) emoji = '🟢';
                      else if (label.includes('น้ำมาก')) emoji = '🔵';
                      else if (label.includes('น้ำล้นตลิ่ง')) emoji = '🔴';
                      
                      return `${emoji} ${label}: ${Number(val).toLocaleString()} จุด (${percentage})`;
                    },
                    footer: function (context) {
                      return wrapTooltipText('💡 สรุปภาพรวมจังหวัด:\nแสดงอัตราส่วนของจุดวัดน้ำทุกจุด เพื่อให้รู้ว่าตอนนี้น้ำเฉลี่ยทั้งจังหวัดอยู่ในเกณฑ์ดีหรือต้องเริ่มเฝ้าระวัง');
                    }
                  }
                }
              }
            }
          }));

          // Perspective 4: Bank Compare (Bar Grouped)
          const leftBanks = waterCurrent.map(item => item.left_bank_level_m ? parseFloat(item.left_bank_level_m) : null);
          const ctxWater4 = document.getElementById('chartWaterBankCompare').getContext('2d');
          dashboardCharts.push(new Chart(ctxWater4, {
            type: 'bar',
            data: {
              labels: waterLabels,
              datasets: [
                {
                  label: 'ระดับน้ำปัจจุบัน (ม.)',
                  data: waterLevels,
                  backgroundColor: '#3b82f6',
                  borderRadius: 4
                },
                {
                  label: 'ระดับตลิ่งซ้าย (ม.)',
                  data: leftBanks,
                  backgroundColor: '#f87171', // Soft coral red representing danger/warning bank level
                  borderRadius: 4
                }
              ]
            },
            options: {
              ...commonOptions,
              plugins: {
                ...commonOptions.plugins,
                datalabels: {
                  display: false
                },
                tooltip: {
                  ...commonOptions.plugins.tooltip,
                  displayColors: false,
                  callbacks: {
                    title: function (context) {
                      let index = context[0].dataIndex;
                      let item = waterCurrent[index];
                      let station = item.station_name || context[0].label || 'ข้อมูล';
                      let amphoe = item.amphoe ? ` (${item.amphoe})` : '';
                      return '📌 ' + station + amphoe;
                    },
                    label: function (context) {
                      let val = context.parsed.y;
                      let formattedVal = val !== null && val !== undefined ? Number(val).toFixed(2) : '-';
                      if (context.datasetIndex === 0) {
                        return `🔵 ระดับน้ำปัจจุบัน (ม.): ${formattedVal}`;
                      } else {
                        return `🔴 ระดับตลิ่งซ้าย (ม.): ${formattedVal}`;
                      }
                    },
                    afterBody: function (context) {
                      let index = context[0].dataIndex;
                      let item = waterCurrent[index];
                      let rainVal = item.current_rain_mm !== null && item.current_rain_mm !== undefined ? parseFloat(item.current_rain_mm).toFixed(2) : '0.00';
                      let risk = item.risk_level || 'ปกติ';
                      let riskIcon = '🟢';
                      if (risk.includes('วิกฤต') || risk.includes('สีแดง')) riskIcon = '🔴';
                      else if (risk.includes('เตือนภัย') || risk.includes('สีส้ม')) riskIcon = '🟠';
                      else if (risk.includes('เฝ้าระวัง') || risk.includes('สีเหลือง')) riskIcon = '🟡';
                      
                      return [
                        ...wrapTooltipText(`🌧️ ปริมาณน้ำฝนปัจจุบัน: ${rainVal} มม.`),
                        ...wrapTooltipText(`⚠️ สถานะความเสี่ยง: ${riskIcon} ${risk}`)
                      ];
                    },
                    footer: function (context) {
                      if (context.length >= 2) {
                        let val1 = context[0].parsed.y;
                        let val2 = context[1].parsed.y;
                        if (val1 !== null && val2 !== null) {
                          let diff = val2 - val1;
                          if (diff >= 0) {
                            return wrapTooltipText(`💡 ผลวิเคราะห์:\nระดับน้ำยังปลอดภัย ต่ำกว่าแนวตลิ่งอยู่ ${diff.toFixed(2)} ม.`);
                          } else {
                            return wrapTooltipText(`💡 ผลวิเคราะห์:\n⚠️ ระดับน้ำล้นตลิ่งแล้ว ${Math.abs(diff).toFixed(2)} ม. (เสี่ยงท่วมขัง!)`);
                          }
                        }
                      }
                      return '';
                    }
                  }
                }
              }
            }
          }));

          // 1.3 Populate AI Box
          const aiBox = document.getElementById('aiInsightsWater');
          if (aiBox) {
            // Calculate gap analysis for AI insights
            let minGap = Infinity, minGapStation = 'N/A', minGapAmphoe = '', minGapLvl = 0;
            waterCurrent.forEach(w => {
              const lvl = parseFloat(w.current_water_level_m);
              const bankLvl = parseFloat(w.left_bank_level_m);
              if (!isNaN(lvl) && !isNaN(bankLvl) && bankLvl > 0) {
                const gap = bankLvl - lvl;
                if (gap < minGap) {
                  minGap = gap;
                  minGapStation = w.station_name;
                  minGapAmphoe = w.amphoe || 'N/A';
                  minGapLvl = lvl;
                }
              }
            });
            const minGapDisplay = isFinite(minGap) ? Math.abs(minGap).toFixed(2) : 'N/A';

            let riskAssessment, insightDetails;
            if (warningCount > 0) {
              riskAssessment = `ขณะนี้ตรวจพบ <strong>จุดเฝ้าระวังและวิกฤตรวม ${warningCount} จุด</strong> ในเขตลุ่มน้ำสำคัญ จังหวัดลำปาง ซึ่งมีแนวโน้มน้ำหนุนเพิ่มสูงขึ้นอย่างรวดเร็ว`;
              insightDetails = `
              <div class="flex items-start gap-2">
                <span class="text-lg">📍</span>
                <p><strong>จุดเสี่ยงวิกฤตสูงสุด:</strong> สถานี <strong>"${minGapStation}"</strong> ในพื้นที่อำเภอ <strong>${minGapAmphoe}</strong> ปัจจุบันอยู่ที่ ${minGapLvl} ม. รทก. ซึ่ง${minGap < 0 ? 'ล้นตลิ่งแล้ว ' + minGapDisplay + ' ม.' : 'ใกล้ล้นตลิ่ง (เหลือ ' + minGapDisplay + ' ม.)'}</p>
              </div>
              <div class="flex items-start gap-2">
                <span class="text-lg">💡</span>
                <div class="flex-1">
                  <p><strong>ข้อเสนอแนะเชิงรุกสําหรับ อบจ.ลำปาง:</strong></p>
                  <ul class="list-disc pl-5 mt-1.5 space-y-1 text-slate-600 dark:text-slate-300">
                    <li>เร่งสั่งการระบายน้ำ ณ ประตูระบายน้ำย่อยที่มีความกังวลล้นตลิ่ง</li>
                    <li>ประสานผู้นำท้องถิ่นในเขตอำเภอ ${minGapAmphoe} ตรวจสอบแนวคันกั้นตลิ่งและสะสมกระสอบทราย</li>
                    <li>เปิดแจ้งเตือนผ่านช่องทางหลัก อบจ. ให้ประชาชนริมตลิ่งเตรียมขนย้ายสิ่งของขึ้นที่สูงล่วงหน้าอย่างน้อย 24 ชั่วโมง</li>
                  </ul>
                </div>
              </div>`;
            } else {
              riskAssessment = `ระดับความเสี่ยงโดยภาพรวมของจังหวัดลำปาง <strong>อยู่ในเกณฑ์ปกติ</strong> สถานีทั้งหมด ${waterCurrent.length} จุด มีระดับน้ำต่ำกว่าระดับตลิ่ง`;
              insightDetails = `
              <div class="flex items-start gap-2">
                <span class="text-lg">📍</span>
                <p><strong>สถานีที่ระดับน้ำใกล้ตลิ่งมากที่สุด:</strong> สถานี <strong>"${minGapStation}"</strong> ในพื้นที่อำเภอ <strong>${minGapAmphoe}</strong> (ห่างจากตลิ่ง ${minGapDisplay} ม.)</p>
              </div>
              <div class="flex items-start gap-2">
                <span class="text-lg">📊</span>
                <p><strong>สถานีระดับน้ำสูงสุด:</strong> สถานี <strong>"${maxStation}" (${maxLevel} ม. รทก.)</strong> ในพื้นที่อำเภอ <strong>${maxAmphoe}</strong></p>
              </div>
              <div class="flex items-start gap-2">
                <span class="text-lg">💡</span>
                <div class="flex-1">
                  <p><strong>ข้อเสนอแนะจากระบบ AI:</strong></p>
                  <ul class="list-disc pl-5 mt-1.5 space-y-1 text-slate-600 dark:text-slate-300">
                    <li>ปริมาณน้ำไหลเข้ายังมีอัตราสมดุล</li>
                    <li>ควรติดตามสถานการณ์อย่างต่อเนื่อง โดยเฉพาะสถานีที่มีระยะห่างจากตลิ่งน้อย</li>
                  </ul>
                </div>
              </div>`;
            }

            let droughtInsight = '';
            if (wCritLow > 0 || wLow > 0) {
              droughtInsight = `
              <div class="flex items-start gap-2 pt-2 border-t border-blue-200/50 dark:border-slate-700/50">
                <span class="text-lg">🍂</span>
                <div class="flex-1">
                  <p><strong>สถานการณ์ภัยแล้ง/น้ำน้อย:</strong> ตรวจพบสถานีที่มีระดับ <strong>น้ำน้อยวิกฤต ${wCritLow} จุด</strong> และ <strong>น้ำน้อย ${wLow} จุด</strong> ในเขตพื้นที่จังหวัดลำปาง</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">⚠️ แนะนำประสานโครงการชลประทานและองค์กรปกครองส่วนท้องถิ่นเพื่อควบคุมการระบายน้ำ จัดสรรการใช้น้ำอุปโภคบริโภคและการเกษตรอย่างเป็นระบบ เพื่อหลีกเลี่ยงวิกฤตขาดแคลนน้ำช่วงฤดูแล้ง</p>
                </div>
              </div>`;
            }

            aiBox.innerHTML = `
              <div class="space-y-3 text-sm md:text-base">
                <div class="flex items-start gap-2">
                  <span class="text-lg">🌊</span>
                  <p><strong>ประเมินความเสี่ยงอุทกภัยโดย AI ผู้เชี่ยวชาญด้านทรัพยากรน้ำ:</strong> ${riskAssessment}</p>
                </div>
                ${insightDetails}
                ${droughtInsight}
              </div>
            `;
          }
        }

        // ==========================================
        // 2. SUB-PAGE RENDERING: DROUGHT
        // ==========================================
        else if (activeSubTab === 'drought') {
          const droughtCurrent = dbData.drought.current || [];

          // 2.1 Calculate KPI Metrics
          let damCount = droughtCurrent.length;
          let totalVolume = 0, totalCapacity = 0, totalUsable = 0;
          let minStoragePct = 100, minDam = 'N/A';

          droughtCurrent.forEach(d => {
            const cap = parseFloat(d.capacity_m_cum);
            const vol = parseFloat(d.water_volume_m_cum);
            const use = parseFloat(d.usable_water_m_cum);

            if (!isNaN(vol)) totalVolume += vol;
            if (!isNaN(cap) && cap > 0) totalCapacity += cap;
            if (!isNaN(use)) totalUsable += use;

            if (!isNaN(vol) && !isNaN(cap) && cap > 0) {
              const pct = (vol / cap) * 100;
              if (pct < minStoragePct) {
                minStoragePct = pct;
                minDam = d.dam_name;
              }
            }
          });

          const avgStoragePct = totalCapacity > 0 ? ((totalVolume / totalCapacity) * 100).toFixed(1) : 'N/A';

          // Set to DOM
          document.getElementById('kpiDamCount').innerText = `${damCount} อ่าง`;
          document.getElementById('kpiTotalVolume').innerText = `${totalVolume.toFixed(1)}M ลบ.ม.`;
          document.getElementById('kpiAvgStoragePct').innerText = avgStoragePct !== 'N/A' ? `${avgStoragePct}%` : 'N/A';

          // 2.2 Initialize Drought Charts
          const damLabels = droughtCurrent.map(d => d.dam_name);
          const damCapacity = droughtCurrent.map(d => d.capacity_m_cum);
          const damVolume = droughtCurrent.map(d => d.water_volume_m_cum);
          const damUsable = droughtCurrent.map(d => d.usable_water_m_cum);
          const damInflow = droughtCurrent.map(d => d.inflow_m_cum ? parseFloat(d.inflow_m_cum) : 0);
          const damDischarge = droughtCurrent.map(d => d.discharge_m_cum ? parseFloat(d.discharge_m_cum) : 0);

          // Perspective 1: Water Volume vs Capacity
          const ctxDrought1 = document.getElementById('chartDroughtPrimary').getContext('2d');
          dashboardCharts.push(new Chart(ctxDrought1, {
            type: 'bar',
            data: {
              labels: damLabels,
              datasets: [
                {
                  label: 'ปริมาณน้ำปัจจุบัน (ล้าน ลบ.ม.)',
                  data: damVolume,
                  backgroundColor: '#3b82f6',
                  borderRadius: 6
                },
                {
                  label: 'ความจุอ่างกักเก็บ (ล้าน ลบ.ม.)',
                  data: damCapacity,
                  backgroundColor: '#fbbf24',
                  borderRadius: 6
                }
              ]
            },
            options: {
              ...commonOptions,
              plugins: {
                ...commonOptions.plugins,
                datalabels: {
                  ...commonOptions.plugins.datalabels,
                  display: false // Hide datalabels entirely on the primary dam chart to solve horizontal overlap
                },
                tooltip: {
                  ...commonOptions.plugins.tooltip,
                  displayColors: false,
                  callbacks: {
                    title: function (context) {
                      let index = context[0].dataIndex;
                      let item = droughtCurrent[index];
                      let name = item.dam_name || context[0].label || 'ข้อมูลอ่างกักเก็บ';
                      return '💧 ' + name;
                    },
                    label: function (context) {
                      let val = context.parsed.y;
                      let formattedVal = val !== null && val !== undefined ? Number(val).toFixed(2) : '-';
                      if (context.datasetIndex === 0) {
                        return `🔵 น้ำกักเก็บปัจจุบัน: ${formattedVal} ล้าน ลบ.ม.`;
                      } else {
                        return `🟡 ความจุอ่างสูงสุด: ${formattedVal} ล้าน ลบ.ม.`;
                      }
                    },
                    footer: function (context) {
                      if (context.length >= 2) {
                        let vol = context[0].parsed.y;
                        let cap = context[1].parsed.y;
                        if (vol !== null && cap > 0) {
                          let pct = ((vol / cap) * 100).toFixed(1);
                          let word = pct >= 80 ? 'น้ำเต็มอ่างดีเยี่ยม' : pct >= 50 ? 'น้ำปานกลาง ปลอดภัย' : pct >= 30 ? 'น้ำเริ่มน้อย ควรเริ่มระวัง' : 'น้ำวิกฤตแห้งแล้ง งดใช้น้ำเยอะ';
                          return wrapTooltipText(`💡 สรุปสถานะน้ำ:\nมีน้ำกักเก็บอยู่ ${pct}% ของความจุอ่าง (${word})`);
                        }
                      }
                      return '';
                    }
                  }
                }
              }
            }
          }));

          // Perspective 2: Trend & Prediction
          const droughtHist = dbData.drought.history || [];
          const droughtHistDates = droughtHist.map(d => d.date);
          const droughtHistVals = droughtHist.map(d => d.total_val);
          const droughtForecast = calculateForecast(droughtHistVals, 3);
          const droughtAllDates = [...droughtHistDates, ...futureLabels];

          const ctxDrought2 = document.getElementById('chartDroughtSecondary').getContext('2d');
          dashboardCharts.push(new Chart(ctxDrought2, {
            type: 'line',
            data: {
              labels: droughtAllDates,
              datasets: [
                {
                  label: 'ปริมาณน้ำสะสมจังหวัด (ย้อนหลัง 7 วัน)',
                  data: droughtHistVals.concat(Array(3).fill(null)),
                  borderColor: '#06b6d4',
                  backgroundColor: 'rgba(6, 182, 212, 0.1)',
                  borderWidth: 2.5,
                  fill: true,
                  tension: 0.3
                },
                {
                  label: 'พยากรณ์แนวโน้มกักเก็บ (3 วัน)',
                  data: droughtForecast,
                  borderColor: '#ef4444',
                  borderDash: [6, 4],
                  borderWidth: 2,
                  fill: false,
                  tension: 0.3
                }
              ]
            },
            options: {
              ...commonOptions,
              plugins: {
                ...commonOptions.plugins,
                datalabels: {
                  ...commonOptions.plugins.datalabels,
                  formatter: (value) => {
                    if (value === null) return '';
                    return Number(value).toFixed(1) + 'M';
                  }
                },
                tooltip: {
                  ...commonOptions.plugins.tooltip,
                  displayColors: false,
                  callbacks: {
                    title: function (context) {
                      return '📅 วันที่สถิติ: ' + context[0].label;
                    },
                    label: function (context) {
                      let val = context.parsed.y;
                      let formattedVal = val !== null && val !== undefined ? Number(val).toFixed(2) : 'ไม่มีข้อมูล';
                      if (context.datasetIndex === 0) {
                        return `🟢 ปริมาณน้ำสะสมรวม: ${formattedVal} ล้าน ลบ.ม.`;
                      } else {
                        return `🔴 คาดการณ์ล่วงหน้า 3 วัน: ${formattedVal} ล้าน ลบ.ม.`;
                      }
                    },
                    footer: function (context) {
                      return wrapTooltipText('💡 ทิศทางปริมาณน้ำสะสม:\nหากเส้นพยากรณ์ชี้ขึ้นแสดงว่าอ่างต่างๆ เก็บน้ำได้เพิ่มขึ้น หากชี้ลงแปลว่าน้ำกำลังแห้งลงเรื่อยๆ');
                    }
                  }
                }
              }
            }
          }));

          // Perspective 3: Doughnut Storage Risk Distribution (Usable water %)
          const ctxDrought3 = document.getElementById('chartDroughtTertiary').getContext('2d');
          let dryCritical = 0, dryWatch = 0, dryModerate = 0, dryExcellent = 0;
          droughtCurrent.forEach(d => {
            const cap = parseFloat(d.capacity_m_cum);
            const vol = parseFloat(d.water_volume_m_cum);
            if (!isNaN(vol) && !isNaN(cap) && cap > 0) {
              const pct = (vol / cap) * 100;
              if (pct < 30) dryCritical++;
              else if (pct < 50) dryWatch++;
              else if (pct < 80) dryModerate++;
              else dryExcellent++;
            }
          });
          if (dryCritical === 0 && dryWatch === 0 && dryModerate === 0 && dryExcellent === 0) { dryModerate = 1; }

          dashboardCharts.push(new Chart(ctxDrought3, {
            type: 'doughnut',
            data: {
              labels: ['วิกฤตภัยแล้ง (<30%)', 'เฝ้าระวังภัยแล้ง (30-50%)', 'ปริมาณปานกลาง (50-80%)', 'น้ำดีมาก (>80%)'],
              datasets: [{
                data: [dryCritical, dryWatch, dryModerate, dryExcellent],
                backgroundColor: ['#ef4444', '#f59e0b', '#3b82f6', '#10b981'],
                borderWidth: 0
              }]
            },
            options: {
              ...pieOptions,
              plugins: {
                ...pieOptions.plugins,
                tooltip: {
                  ...pieOptions.plugins.tooltip,
                  displayColors: false,
                  callbacks: {
                    title: function (context) {
                      return '🍂 สัดส่วนระดับน้ำของอ่างเก็บน้ำ';
                    },
                    label: function (context) {
                      let label = context.label || '';
                      let val = context.parsed;
                      let sum = 0;
                      let dataArr = context.chart.data.datasets[0].data;
                      dataArr.map(data => { sum += Number(data || 0); });
                      let percentage = sum === 0 ? "0%" : (val * 100 / sum).toFixed(1) + "%";
                      
                      let emoji = '⚪';
                      if (label.includes('วิกฤตภัยแล้ง')) emoji = '🔴';
                      else if (label.includes('เฝ้าระวังภัยแล้ง')) emoji = '🟡';
                      else if (label.includes('ปริมาณปานกลาง')) emoji = '🔵';
                      else if (label.includes('น้ำดีมาก')) emoji = '🟢';
                      
                      return `${emoji} ${label}: ${Number(val).toLocaleString()} อ่าง (${percentage})`;
                    },
                    footer: function (context) {
                      return wrapTooltipText('💡 ภาพรวมสัดส่วนความจุ:\nหากมีจำนวนอ่างสีแดง (น้ำน้อยกว่า 30%) มาก แสดงว่ากำลังเสี่ยงภัยแล้งในวงกว้าง ควรรีบประหยัดน้ำเพื่อการเกษตร');
                    }
                  }
                }
              }
            }
          }));

          // Perspective 4: Inflow vs Outflow Rates
          const ctxDrought4 = document.getElementById('chartDroughtInflowOutflow').getContext('2d');
          dashboardCharts.push(new Chart(ctxDrought4, {
            type: 'bar',
            data: {
              labels: damLabels,
              datasets: [
                {
                  label: 'ปริมาณไหลเข้า (ล้าน ลบ.ม./วัน)',
                  data: damInflow,
                  backgroundColor: '#10b981',
                  borderRadius: 4
                },
                {
                  label: 'ปริมาณน้ำระบาย (ล้าน ลบ.ม./วัน)',
                  data: damDischarge,
                  backgroundColor: '#ef4444',
                  borderRadius: 4
                }
              ]
            },
            options: {
              ...commonOptions,
              plugins: {
                ...commonOptions.plugins,
                datalabels: {
                  ...commonOptions.plugins.datalabels,
                  display: false // Hide datalabels here as well for clean grouped layouts
                },
                tooltip: {
                  ...commonOptions.plugins.tooltip,
                  displayColors: false,
                  callbacks: {
                    title: function (context) {
                      let index = context[0].dataIndex;
                      let item = droughtCurrent[index];
                      let name = item.dam_name || context[0].label || 'ข้อมูลสมดุลน้ำ';
                      return '💧 ' + name;
                    },
                    label: function (context) {
                      let val = context.parsed.y;
                      let formattedVal = val !== null && val !== undefined ? Number(val).toFixed(3) : '-';
                      if (context.datasetIndex === 0) {
                        return `🟢 น้ำไหลเข้าอ่าง: ${formattedVal} ล้าน ลบ.ม./วัน`;
                      } else {
                        return `🔴 น้ำปล่อยระบายออก: ${formattedVal} ล้าน ลบ.ม./วัน`;
                      }
                    },
                    footer: function (context) {
                      if (context.length >= 2) {
                        let inflow = context[0].parsed.y;
                        let discharge = context[1].parsed.y;
                        if (inflow !== null && discharge !== null) {
                          let net = inflow - discharge;
                          if (net >= 0) {
                            return wrapTooltipText(`💡 สมดุลไหลเข้า-ออกวันนี้:\nน้ำเข้าเยอะกว่าระบายออก ทำให้น้ำในอ่างเพิ่มสุทธิ +${net.toFixed(3)} ล้าน ลบ.ม. (สภาวะน้ำกักเก็บดีขึ้น)`);
                          } else {
                            return wrapTooltipText(`💡 สมดุลไหลเข้า-ออกวันนี้:\nปล่อยระบายน้ำเยอะกว่าน้ำเข้า ทำให้น้ำอ่างลดลงสุทธิ -${Math.abs(net).toFixed(3)} ล้าน ลบ.ม. (ต้องประหยัดน้ำสำรอง)`);
                          }
                        }
                      }
                      return '';
                    }
                  }
                }
              }
            }
          }));

          // 2.3 Populate AI Box
          const aiBox = document.getElementById('aiInsightsDrought');
          if (aiBox) {
            let waterStatusWord = "อยู่ในเกณฑ์ปกติ มีความเสถียรด้านพลังงานและเกษตรกรรมสูง";
            if (parseFloat(avgStoragePct) < 40) {
              waterStatusWord = "อยู่ในเกณฑ์ต่ำ มีความเสี่ยงต่อวิกฤตภัยแล้งเฉียบพลัน";
            } else if (parseFloat(avgStoragePct) < 60) {
              waterStatusWord = "อยู่ในระดับเฝ้าระวังปานกลาง จำเป็นต้องจัดสรรปริมาณน้ำอย่างประหยัด";
            }

            aiBox.innerHTML = `
              <div class="space-y-3 text-sm md:text-base">
                <div class="flex items-start gap-2">
                  <span class="text-lg">🍂</span>
                  <p><strong>ประเมินความมั่นคงด้านน้ำสะสมโดย AI ผู้เชี่ยวชาญด้านอุทกวิทยา:</strong> ปัจจุบันจังหวัดลำปางมีสัดส่วนกักเก็บน้ำเฉลี่ยอยู่ที่ <strong>${avgStoragePct}%</strong> ของความจุรวม ซึ่งภาพรวม <strong>${waterStatusWord}</strong></p>
                </div>
                <div class="flex items-start gap-2">
                  <span class="text-lg">📍</span>
                  <p><strong>จุดเตือนภัยวิกฤตภัยแล้ง:</strong> อ่างเก็บน้ำที่มีระดับน้ำกักเก็บต่ำที่สุดคือ <strong>"${minDam}"</strong> มีปริมาตรคงเหลือเพียง <strong>${minStoragePct.toFixed(1)}%</strong> ของความจุ ซึ่งเข้าขั้นวิกฤตอย่างมีนัยสำคัญ</p>
                </div>
                <div class="flex items-start gap-2">
                  <span class="text-lg">💡</span>
                  <div class="flex-1">
                    <p><strong>ข้อเสนอแนะเชิงรุกสําหรับ อบจ.ลำปาง:</strong></p>
                    <ul class="list-disc pl-5 mt-1.5 space-y-1 text-slate-600 dark:text-slate-300">
                      <li>เร่งออกประกาศขอความร่วมมือจากกลุ่มเกษตรกรชลประทานอ่าง ${minDam} ให้ปรับเปลี่ยนมาปลูกพืชใช้น้ำน้อย</li>
                      <li>จัดสรรงบประมาณสำรวจบ่อน้ำตื้นและจัดเตรียมเครื่องสูบน้ำเคลื่อนที่เข้าบรรเทาทุกข์ชาวบ้านในพื้นที่ใกล้เคียง</li>
                      <li>ร่วมมือกับหน่วยปฏิบัติการฝนหลวงพิเศษเพื่อวางแผนขึ้นบินกระตุ้นฝนในเขตกักเก็บต้นน้ำ</li>
                    </ul>
                  </div>
                </div>
              </div>
            `;
          }
        }

        // ==========================================
        // 3. SUB-PAGE RENDERING: PM 2.5
        // ==========================================
        else if (activeSubTab === 'pm25') {
          const pm25Current = dbData.pm25.current || [];

          // 3.1 Calculate KPI Metrics
          let totalPM25 = 0, validPMCount = 0, unhealthyCount = 0;
          let maxPM = 0, maxStation = 'N/A', maxAmphoe = '';
          let minPM = 999, minStation = 'N/A', minAmphoe = '';

          pm25Current.forEach(p => {
            const val = parseFloat(p.pm25_value);
            if (!isNaN(val)) {
              totalPM25 += val;
              validPMCount++;

              if (val > maxPM) {
                maxPM = val;
                maxStation = p.station_name || 'N/A';
                maxAmphoe = p.amphoe || 'N/A';
              }
              if (val < minPM) {
                minPM = val;
                minStation = p.station_name || 'N/A';
                minAmphoe = p.amphoe || 'N/A';
              }

              // Standard PM 2.5 Health Limit is 37.5 in Thailand (or 50 AQI standard)
              if (val > 37.5) {
                unhealthyCount++;
              }
            }
          });

          const avgPM25 = validPMCount > 0 ? (totalPM25 / validPMCount).toFixed(1) : 'N/A';
          const bestDistrict = minAmphoe !== '' ? `อ. ${minAmphoe} (${minPM.toFixed(0)} µg)` : 'N/A';

          // Set to DOM
          document.getElementById('kpiAvgPM25').innerText = `${avgPM25} µg/m³`;
          document.getElementById('kpiUnhealthyPM25').innerText = `${unhealthyCount} สถานี`;
          document.getElementById('kpiBestPM25').innerText = bestDistrict;

          // 3.2 Initialize PM2.5 Charts
          const pmLabels = pm25Current.map(d => d.amphoe + (d.station_name ? ` (${d.station_name})` : ''));
          const pmValues = pm25Current.map(d => d.pm25_value);
          const pmAvgs = pm25Current.map(d => d.pm25_avg_24h ? parseFloat(d.pm25_avg_24h) : 0);

          // Perspective 1: Current levels (Colored uniquely by threshold)
          let pmVeryGood = 0, pmGood = 0, pmModerate = 0, pmUnhealthy = 0, pmSevere = 0;
          const barColors = pmValues.map(v => {
            const num = parseFloat(v);
            if (!isNaN(num)) {
              if (num <= 15.0) pmVeryGood++;
              else if (num <= 25.0) pmGood++;
              else if (num <= 37.5) pmModerate++;
              else if (num <= 75.0) pmUnhealthy++;
              else pmSevere++;
            }
            if (num <= 15.0) return '#60a5fa';      // ดีมาก (Cyan)
            if (num <= 25.0) return '#10b981';      // ดี (Green)
            if (num <= 37.5) return '#fbbf24';      // ปานกลาง (Yellow)
            if (num <= 75.0) return '#f97316';      // เริ่มมีผลต่อสุขภาพ (Orange)
            return '#ef4444';                       // มีผลกระทบต่อสุขภาพ (Red)
          });

          const ctxPM1 = document.getElementById('chartPM25Primary').getContext('2d');
          dashboardCharts.push(new Chart(ctxPM1, {
            type: 'bar',
            data: {
              labels: pmLabels,
              datasets: [{
                label: 'ค่า PM2.5 ปัจจุบัน',
                data: pmValues,
                backgroundColor: barColors,
                borderRadius: 5
              }]
            },
            options: {
              ...commonOptions,
              plugins: {
                ...commonOptions.plugins,
                legend: { display: false },
                tooltip: {
                  ...commonOptions.plugins.tooltip,
                  displayColors: false,
                  callbacks: {
                    title: function (context) {
                      let index = context[0].dataIndex;
                      let item = pm25Current[index];
                      let name = item.station_name ? ` (${item.station_name})` : '';
                      return '😷 จุดตรวจวัดฝุ่น: ' + (item.amphoe || 'ไม่ระบุอำเภอ') + name;
                    },
                    label: function (context) {
                      let val = context.parsed.y;
                      let formattedVal = val !== null && val !== undefined ? Number(val).toFixed(1) : '-';
                      return `🔴 ฝุ่น PM 2.5 ชั่วโมงนี้: ${formattedVal} µg/m³`;
                    },
                    footer: function (context) {
                      let val = context[0].parsed.y;
                      if (val !== null) {
                        let word = '', icon = '';
                        if (val <= 15.0) { icon = '🔵'; word = 'ดีมาก หายใจสะดวก ทำกิจกรรมนอกบ้านได้เต็มที่'; }
                        else if (val <= 25.0) { icon = '🟢'; word = 'อากาศดี ทำกิจกรรมนอกบ้านและออกกำลังกายได้ปกติ'; }
                        else if (val <= 37.5) { icon = '🟡'; word = 'ปานกลาง กลุ่มเสี่ยง/คนมีโรคประจำตัวควรเริ่มระวัง'; }
                        else if (val <= 75.0) { icon = '🟠'; word = 'เริ่มส่งผลเสีย! ควรลดกิจกรรมกลางแจ้งและสวมหน้ากาก'; }
                        else { icon = '🔴'; word = 'อันตรายมาก! งดออกกลางแจ้งเด็ดขาด และอยู่แต่ในอาคาร'; }
                        return wrapTooltipText(`💡 แนะนำการดูแลตัว:\n${icon} ${word}`);
                      }
                      return '';
                    }
                  }
                }
              }
            }
          }));

          // Perspective 2: Line Chart PM2.5 forecast
          const pmHistDates = dbData.pm25.history.map(d => d.date);
          const pmHistVals = dbData.pm25.history.map(d => Number(d.avg_val).toFixed(1));
          const pmForecast = calculateForecast(pmHistVals, 3);
          const pmAllDates = [...pmHistDates, ...futureLabels];

          const ctxPM2 = document.getElementById('chartPM25Secondary').getContext('2d');
          dashboardCharts.push(new Chart(ctxPM2, {
            type: 'line',
            data: {
              labels: pmAllDates,
              datasets: [
                {
                  label: 'PM2.5 เฉลี่ยจังหวัด (ย้อนหลัง 7 วัน)',
                  data: pmHistVals.concat(Array(3).fill(null)),
                  borderColor: '#f43f5e',
                  backgroundColor: 'rgba(244, 63, 94, 0.1)',
                  borderWidth: 2.5,
                  fill: true,
                  tension: 0.3
                },
                {
                  label: 'พยากรณ์ฝุ่นล่วงหน้า (3 วัน)',
                  data: pmForecast,
                  borderColor: '#8b5cf6',
                  borderDash: [6, 4],
                  borderWidth: 2,
                  fill: false,
                  tension: 0.3
                }
              ]
            },
            options: {
              ...commonOptions,
              plugins: {
                ...commonOptions.plugins,
                tooltip: {
                  ...commonOptions.plugins.tooltip,
                  displayColors: false,
                  callbacks: {
                    title: function (context) {
                      return '📅 วันที่วิเคราะห์ค่าฝุ่น: ' + context[0].label;
                    },
                    label: function (context) {
                      let val = context.parsed.y;
                      let formattedVal = val !== null && val !== undefined ? Number(val).toFixed(1) : 'ไม่มีข้อมูล';
                      if (context.datasetIndex === 0) {
                        return `🔵 ฝุ่นเฉลี่ยย้อนหลัง: ${formattedVal} µg/m³`;
                      } else {
                        return `🟣 พยากรณ์ล่วงหน้า 3 วัน: ${formattedVal} µg/m³`;
                      }
                    },
                    footer: function (context) {
                      return wrapTooltipText('💡 ประโยชน์ของข้อมูล:\nช่วยประเมินฝุ่นล่วงหน้า 3 วัน เพื่อให้ท่านวางแผนหลีกเลี่ยงฝุ่นหนาแน่น หรือเตรียมสวมใส่หน้ากากล่วงหน้า');
                    }
                  }
                }
              }
            }
          }));

          // Perspective 3: Quality Share
          const ctxPM3 = document.getElementById('chartPM25Tertiary').getContext('2d');

          let displayVeryGood = pmVeryGood;
          if (pmVeryGood === 0 && pmGood === 0 && pmModerate === 0 && pmUnhealthy === 0 && pmSevere === 0) { displayVeryGood = 1; }

          dashboardCharts.push(new Chart(ctxPM3, {
            type: 'doughnut',
            data: {
              labels: ['ดีมาก (0-15.0 µg/m³)', 'ดี (15.1-25.0 µg/m³)', 'ปานกลาง (25.1-37.5 µg/m³)', 'เริ่มมีผลต่อสุขภาพ (37.6-75.0 µg/m³)', 'มีผลกระทบต่อสุขภาพ (>75.1 µg/m³)'],
              datasets: [{
                data: [displayVeryGood, pmGood, pmModerate, pmUnhealthy, pmSevere],
                backgroundColor: ['#60a5fa', '#10b981', '#fbbf24', '#f97316', '#ef4444'],
                borderWidth: 0
              }]
            },
            options: {
              ...pieOptions,
              plugins: {
                ...pieOptions.plugins,
                tooltip: {
                  ...pieOptions.plugins.tooltip,
                  displayColors: false,
                  callbacks: {
                    title: function (context) {
                      return '🌬️ สัดส่วนคุณภาพอากาศ';
                    },
                    label: function (context) {
                      let label = context.label || '';
                      let val = context.parsed;
                      let sum = 0;
                      let dataArr = context.chart.data.datasets[0].data;
                      dataArr.map(data => { sum += Number(data || 0); });
                      let percentage = sum === 0 ? "0%" : (val * 100 / sum).toFixed(1) + "%";
                      
                      let emoji = '⚪';
                      if (label.includes('ดีมาก')) emoji = '🔵';
                      else if (label.includes('ดี')) emoji = '🟢';
                      else if (label.includes('ปานกลาง')) emoji = '🟡';
                      else if (label.includes('เริ่มมีผลต่อสุขภาพ')) emoji = '🟠';
                      else if (label.includes('มีผลกระทบต่อสุขภาพ')) emoji = '🔴';
                      
                      return `${emoji} เกณฑ์${label.split(' ')[0]}: ${Number(val).toLocaleString()} จุด (${percentage})`;
                    },
                    footer: function (context) {
                      return wrapTooltipText('💡 สรุปสัดส่วนอากาศ:\nแสดงให้เห็นว่าฝุ่นละอองกำลังครอบคลุมพื้นที่ส่วนใหญ่ หรือเป็นเพียงฝุ่นหนาแน่นบางพื้นที่เท่านั้น');
                    }
                  }
                }
              }
            }
          }));

          // Perspective 4: Compare current vs 24h average
          const ctxPM4 = document.getElementById('chartPM25AvgCompare').getContext('2d');
          dashboardCharts.push(new Chart(ctxPM4, {
            type: 'bar',
            data: {
              labels: pmLabels,
              datasets: [
                {
                  label: 'ค่าฝุ่นล่าสุด',
                  data: pmValues,
                  backgroundColor: '#f43f5e',
                  borderRadius: 4
                },
                {
                  label: 'เฉลี่ยสะสม 24 ชม.',
                  data: pmAvgs,
                  backgroundColor: '#8b5cf6',
                  borderRadius: 4
                }
              ]
            },
            options: {
              ...commonOptions,
              plugins: {
                ...commonOptions.plugins,
                datalabels: {
                  ...commonOptions.plugins.datalabels,
                  display: false
                },
                tooltip: {
                  ...commonOptions.plugins.tooltip,
                  displayColors: false,
                  callbacks: {
                    title: function (context) {
                      let index = context[0].dataIndex;
                      let item = pm25Current[index];
                      let name = item.station_name ? ` (${item.station_name})` : '';
                      return '😷 จุดวัด: ' + (item.amphoe || 'ไม่ระบุอำเภอ') + name;
                    },
                    label: function (context) {
                      let val = context.parsed.y;
                      let formattedVal = val !== null && val !== undefined ? Number(val).toFixed(1) : '-';
                      if (context.datasetIndex === 0) {
                        return `🔴 ฝุ่นล่าสุดชั่วโมงนี้: ${formattedVal} µg/m³`;
                      } else {
                        return `🟣 เฉลี่ยสะสม 24 ชม.: ${formattedVal} µg/m³`;
                      }
                    },
                    footer: function (context) {
                      if (context.length >= 2) {
                        let cur = context[0].parsed.y;
                        let avg = context[1].parsed.y;
                        if (cur !== null && avg !== null) {
                          if (cur < avg) {
                            return wrapTooltipText(`💡 แนวโน้มฝุ่นล่าสุด:\nฝุ่นตอนนี้น้อยลงกว่าช่วง 24 ชม.ที่ผ่านมา (สัญญาณดี ฝุ่นละอองเจือจางลง)`);
                          } else {
                            return wrapTooltipText(`💡 แนวโน้มฝุ่นล่าสุด:\n⚠️ ฝุ่นตอนนี้หนาแน่นขึ้นกว่าค่าเฉลี่ย 24 ชม. (ฝุ่นกำลังสะสมเพิ่มขึ้น)`);
                          }
                        }
                      }
                      return '';
                    }
                  }
                }
              }
            }
          }));

          // 3.3 Populate AI Box
          const aiBox = document.getElementById('aiInsightsPM25');
          if (aiBox) {
            let pmRiskWord = "ดัชนีคุณภาพอากาศอยู่ในเกณฑ์ปกติส่วนใหญ่ ประชาชนสามารถดำเนินชีวิตกลางแจ้งได้อย่างปลอดภัย";
            let colorLabel = "ส้ม";
            if (maxPM > 37.5) {
              pmRiskWord = `ตรวจพบดัชนีมลพิษฝุ่นเกินค่ามาตรฐาน **เป็นอันตรายต่อสุขภาพใน ${unhealthyCount} พื้นที่** ซึ่งจำเป็นต้องหลีกเลี่ยงกิจกรรมกลางแจ้ง`;
              colorLabel = maxPM > 75 ? "แดงเข้ม (มีผลกระทบรุนแรง)" : "ส้ม/แดง (เริ่มส่งผลกระทบ)";
            }

            aiBox.innerHTML = `
              <div class="space-y-3 text-sm md:text-base">
                <div class="flex items-start gap-2">
                  <span class="text-lg">🍃</span>
                  <p><strong>ประเมินดัชนีสุขภาพอากาศโดย AI ผู้เชี่ยวชาญด้านสิ่งแวดล้อม:</strong> ค่าฝุ่นเฉลี่ยในภาพรวมของจังหวัด อยู่ในระดับ <strong>${avgPM25} µg/m³</strong> ซึ่ง ${pmRiskWord}</p>
                </div>
                <div class="flex items-start gap-2">
                  <span class="text-lg">📍</span>
                  <p><strong>พื้นที่วิกฤตฝุ่นละอองสูงสุด:</strong> สถานีอำเภอ <strong>${maxAmphoe} (${maxStation})</strong> วัดค่าได้สูงสุดสะสมถึง <strong>${maxPM.toFixed(1)} µg/m³</strong> (ระดับสี${colorLabel})</p>
                </div>
                <div class="flex items-start gap-2">
                  <span class="text-lg">💡</span>
                  <div class="flex-1">
                    <p><strong>มาตรการแนะนำเชิงรุกสําหรับ อบจ.ลำปาง:</strong></p>
                    <ul class="list-disc pl-5 mt-1.5 space-y-1 text-slate-600 dark:text-slate-300">
                      <li>เร่งจัดส่งรถบรรทุกน้ำและเครื่องพ่นฝอยละอองน้ำขึ้นสูงเข้าสลายกลุ่มฝุ่นในอำเภอ ${maxAmphoe}</li>
                      <li>ออกคำสั่งงดเว้นการเผาวัชพืชทางการเกษตรในเขตพื้นที่แอ่งกระทะลำปางร่วมกับป่าไม้จังหวัดอย่างเด็ดขาด</li>
                      <li>ส่งเสริมศูนย์เด็กเล็กปลอดฝุ่นของ อบจ. และแจกหน้ากากอนามัยป้องกันฝุ่นพิษให้แก่กลุ่มเปราะบาง</li>
                    </ul>
                  </div>
                </div>
              </div>
            `;
          }
        }

        // ==========================================
        // 4. SUB-PAGE RENDERING: COMPLAINTS
        // ==========================================
        else if (activeSubTab === 'complaints') {
          const compState = dbData.complaints.state || [];
          const compType = dbData.complaints.type || [];
          const compAgency = dbData.complaints.agency || [];

          // 4.1 Calculate KPI Metrics
          let totalTickets = 0, resolvedTickets = 0;
          compState.forEach(s => {
            const count = parseInt(s.count) || 0;
            totalTickets += count;
            if (s.state_name === 'เสร็จสิ้น' || s.state_name.includes('เสร็จ')) {
              resolvedTickets += count;
            }
          });

          const resRate = totalTickets > 0 ? ((resolvedTickets / totalTickets) * 100).toFixed(1) + '%' : '0.0%';

          // Set to DOM
          document.getElementById('kpiTotalTickets').innerText = `${totalTickets} เรื่อง`;
          document.getElementById('kpiResolvedTickets').innerText = `${resolvedTickets} เรื่อง`;
          document.getElementById('kpiResolutionRate').innerText = resRate;

          // 4.2 Initialize Complaints Charts
          // Perspective 1: Status Horizontal Bar
          const compStateLabels = compState.map(d => d.state_name);
          const compStateCounts = compState.map(d => d.count);
          const stateColors = {
            'รอรับเรื่อง': '#ef4444',
            'กำลังดำเนินการ': '#f59e0b',
            'ส่งต่อ': '#3b82f6',
            'เสร็จสิ้น': '#10b981',
            'ถูกติดตาม': '#8b5cf6'
          };
          const compStateBgColors = compStateLabels.map(l => stateColors[l] || '#64748b');

          const ctxComp1 = document.getElementById('chartComplaintsPrimary').getContext('2d');
          dashboardCharts.push(new Chart(ctxComp1, {
            type: 'bar',
            data: {
              labels: compStateLabels,
              datasets: [{
                label: 'จำนวนใบงานร้องทุกข์',
                data: compStateCounts,
                backgroundColor: compStateBgColors,
                borderRadius: 5
              }]
            },
            options: {
              ...commonOptions,
              indexAxis: 'y', // Makes it Horizontal Bar!
              scales: {
                x: {
                  ticks: { stepSize: 1 }
                }
              },
              plugins: {
                ...commonOptions.plugins,
                legend: { display: false },
                tooltip: {
                  ...commonOptions.plugins.tooltip,
                  displayColors: false,
                  callbacks: {
                    title: function (context) {
                      return '📋 ขั้นตอนการดำเนินงาน: ' + context[0].label;
                    },
                    label: function (context) {
                      let val = context.parsed.x;
                      let formattedVal = val !== null && val !== undefined ? Number(val).toLocaleString() : '-';
                      return `🟠 เรื่องเดือดร้อน: ${formattedVal} เรื่อง`;
                    },
                    footer: function (context) {
                      let label = context[0].label || '';
                      let word = 'แสดงความคืบหน้าของปัญหาที่รับเรื่องเข้าระบบ';
                      if (label.includes('เสร็จสิ้น')) {
                        word = 'แก้ไขช่วยเหลือชาวบ้านเสร็จสิ้นเรียบร้อยแล้ว';
                      } else if (label.includes('กำลังดำเนินการ') || label.includes('ประสานงาน') || label.includes('รับเรื่อง') || label.includes('ติดตาม')) {
                        word = 'เจ้าหน้าที่กำลังเร่งวางแผน ประสานช่างเพื่อลงพื้นที่แก้ไขโดยด่วน';
                      } else if (label.includes('ส่งต่อ')) {
                        word = 'ส่งต่อเรื่องให้หน่วยงานท้องถิ่นที่รับผิดชอบโดยตรงเข้าดำเนินการ';
                      }
                      return `💡 สรุปการช่วยเหลือ:\n${word}`;
                    }
                  }
                }
              }
            }
          }));

          // Perspective 2: Trend & Prediction
          const compHistDates = dbData.complaints.history.map(d => d.date);
          const compHistVals = dbData.complaints.history.map(d => d.daily_count);
          const compForecast = calculateForecast(compHistVals, 3);
          const compAllDates = [...compHistDates, ...futureLabels];

          const ctxComp2 = document.getElementById('chartComplaintsSecondary').getContext('2d');
          dashboardCharts.push(new Chart(ctxComp2, {
            type: 'line',
            data: {
              labels: compAllDates,
              datasets: [
                {
                  label: 'สถิติแจ้งปัญหารายวัน (ย้อนหลัง 7 วัน)',
                  data: compHistVals.concat(Array(3).fill(null)),
                  borderColor: '#c084fc',
                  backgroundColor: 'rgba(192, 132, 252, 0.1)',
                  borderWidth: 2.5,
                  fill: true,
                  tension: 0.3
                },
                {
                  label: 'พยากรณ์แนวโน้มการร้องเรียน (3 วัน)',
                  data: compForecast,
                  borderColor: '#10b981',
                  borderDash: [6, 4],
                  borderWidth: 2,
                  fill: false,
                  tension: 0.3
                }
              ]
            },
            options: {
              ...commonOptions,
              plugins: {
                ...commonOptions.plugins,
                tooltip: {
                  ...commonOptions.plugins.tooltip,
                  displayColors: false,
                  callbacks: {
                    title: function (context) {
                      return '📅 วันที่สถิติร้องเรียน: ' + context[0].label;
                    },
                    label: function (context) {
                      let val = context.parsed.y;
                      let formattedVal = val !== null && val !== undefined ? Number(val).toFixed(0) : 'ไม่มีข้อมูล';
                      if (context.datasetIndex === 0) {
                        return `🟣 แจ้งเรื่องเดือดร้อนจริง: ${formattedVal} เรื่อง/วัน`;
                      } else {
                        return `🟢 พยากรณ์ล่วงหน้า 3 วัน: ${formattedVal} เรื่อง/วัน`;
                      }
                    },
                    footer: function (context) {
                      return wrapTooltipText('💡 ประโยชน์การดูทิศทาง:\nถ้ากราฟชี้ลงแปลว่าปัญหาน้อยลงหรือแก้ไขเสร็จเร็วขึ้น ถ้าชี้ขึ้นแสดงว่ามีเหตุฉุกเฉินหรือปัญหาสะสมเพิ่ม');
                    }
                  }
                }
              }
            }
          }));

          // Perspective 3: Topic Breakdown (Real database values)
          const compTypeLabels = compType.map(d => d.problem_type || 'อื่นๆ');
          const compTypeCounts = compType.map(d => d.count);

          const ctxComp3 = document.getElementById('chartComplaintsTertiary').getContext('2d');
          dashboardCharts.push(new Chart(ctxComp3, {
            type: 'doughnut',
            data: {
              labels: compTypeLabels.length > 0 ? compTypeLabels : ['ไม่มีข้อมูล'],
              datasets: [{
                data: compTypeCounts.length > 0 ? compTypeCounts : [0],
                backgroundColor: compTypeCounts.length > 0 ? ['#ef4444', '#fbbf24', '#3b82f6', '#10b981', '#8b5cf6'] : ['#e2e8f0'],
                borderWidth: 0
              }]
            },
            options: {
              ...pieOptions,
              plugins: {
                ...pieOptions.plugins,
                tooltip: {
                  ...pieOptions.plugins.tooltip,
                  displayColors: false,
                  callbacks: {
                    title: function (context) {
                      return '🏷️ หัวข้อเรื่องร้องทุกข์ยอดนิยม';
                    },
                    label: function (context) {
                      let label = context.label || '';
                      let val = context.parsed;
                      let sum = 0;
                      let dataArr = context.chart.data.datasets[0].data;
                      dataArr.map(data => { sum += Number(data || 0); });
                      let percentage = sum === 0 ? "0%" : (val * 100 / sum).toFixed(1) + "%";
                      
                      let emoji = '⚪';
                      if (label.includes('ถนน') || label.includes('ทางเท้า')) emoji = '🛣️';
                      else if (label.includes('เสียง')) emoji = '🔊';
                      else if (label.includes('ความสะอาด') || label.includes('ขยะ')) emoji = '🧹';
                      else if (label.includes('น้ำ') || label.includes('ประปา')) emoji = '💧';
                      else if (label.includes('ไฟ') || label.includes('แสงสว่าง')) emoji = '💡';
                      
                      return `${emoji} ประเภท ${label}: ${Number(val).toLocaleString()} เรื่อง (${percentage})`;
                    },
                    footer: function (context) {
                      return wrapTooltipText(`💡 สรุปหัวข้อเรื่องร้องเรียน:\nการรู้ว่าประเภทใดเดือดร้อนบ่อยที่สุด ช่วยให้จัดเตรียมงบประมาณและทีมช่างลงพื้นที่แก้ปัญหาได้ตรงเป้าและทันเวลา`);
                    }
                  }
                }
              }
            }
          }));

          // Perspective 4: PAO Performance compared to other agencies
          let paoResolved = 0, paoPending = 0;
          let otherResolved = 0, otherPending = 0;

          compAgency.forEach(a => {
            const count = parseInt(a.count) || 0;
            const status = a.agency_status;

            if (status.includes('เสร็จ')) {
              if (status.includes('อบจ.')) paoResolved += count;
              else otherResolved += count;
            } else {
              if (status.includes('อบจ.')) paoPending += count;
              else otherPending += count;
            }
          });

          if (paoResolved === 0 && paoPending === 0) { paoResolved = 0; paoPending = 0; }
          if (otherResolved === 0 && otherPending === 0) { otherResolved = 0; otherPending = 0; }

          const ctxComp4 = document.getElementById('chartComplaintsAgency').getContext('2d');
          dashboardCharts.push(new Chart(ctxComp4, {
            type: 'bar',
            data: {
              labels: ['อบจ.ลำปาง (PAO)', 'หน่วยงานอื่น ๆ ในจังหวัด'],
              datasets: [
                {
                  label: 'แก้ไขเสร็จสิ้นแล้ว',
                  data: [paoResolved, otherResolved],
                  backgroundColor: '#10b981',
                  borderRadius: 4
                },
                {
                  label: 'กำลังอยู่ระหว่างดำเนินการ',
                  data: [paoPending, otherPending],
                  backgroundColor: '#f59e0b',
                  borderRadius: 4
                }
              ]
            },
            options: {
              ...commonOptions,
              plugins: {
                ...commonOptions.plugins,
                datalabels: {
                  ...commonOptions.plugins.datalabels,
                  display: false
                },
                tooltip: {
                  ...commonOptions.plugins.tooltip,
                  displayColors: false,
                  callbacks: {
                    title: function (context) {
                      return '🏢 หน่วยงานรับผิดชอบหลัก: ' + context[0].label;
                    },
                    label: function (context) {
                      let val = context.parsed.y;
                      let formattedVal = val !== null && val !== undefined ? Number(val).toLocaleString() : '-';
                      if (context.datasetIndex === 0) {
                        return `🟢 แก้ไขเสร็จเรียบร้อย: ${formattedVal} เรื่อง`;
                      } else {
                        return `🟡 กำลังดำเนินการแก้ไข: ${formattedVal} เรื่อง`;
                      }
                    },
                    footer: function (context) {
                      if (context.length >= 2) {
                        let ok = context[0].parsed.y;
                        let pending = context[1].parsed.y;
                        if (ok !== null && pending !== null) {
                          let total = ok + pending;
                          if (total > 0) {
                            let pct = ((ok / total) * 100).toFixed(1);
                            return wrapTooltipText(`💡 ประสิทธิภาพการแก้ไข:\nแก้ไขเรื่องร้องเรียนสำเร็จเสร็จสิ้นคิดเป็น ${pct}% (สะท้อนการทำงานเพื่อความสุขของประชาชน)`);
                          }
                        }
                      }
                      return '';
                    }
                  }
                }
              }
            }
          }));

          // 4.3 Populate AI Box
          const topTopic = compTypeLabels.length > 0 ? compTypeLabels[0] : 'ขาดแคลนแหล่งน้ำเพื่ออุปโภค';
          const topTopicCount = compTypeCounts.length > 0 ? compTypeCounts[0] : 15;
          const aiBox = document.getElementById('aiInsightsComplaints');

          if (aiBox) {
            aiBox.innerHTML = `
              <div class="space-y-3 text-sm md:text-base">
                <div class="flex items-start gap-2">
                  <span class="text-lg">📢</span>
                  <p><strong>ประเมินความเดือดร้อนสาธารณะโดย AI ผู้เชี่ยวชาญด้านบริหารจัดการเมือง:</strong> ได้รับเรื่องร้องเรียนสะสมผ่านระบบทั้งสิ้น <strong>${totalTickets} เรื่อง</strong> แก้ไขปัญหาเสร็จสิ้นแล้วคิดเป็นอัตราความสำเร็จ <strong>${resRate}</strong></p>
                </div>
                <div class="flex items-start gap-2">
                  <span class="text-lg">📍</span>
                  <p><strong>ประเด็นวิกฤตสะสมสูงสุด:</strong> ความเดือดร้อนหลักที่ประชาชนแจ้งเข้ามาสูงสุดเกี่ยวข้องกับ <strong>"${topTopic}" (${topTopicCount} เรื่อง)</strong> ซึ่งส่วนใหญ่อยู่ในพื้นที่การจัดการของท้องถิ่น</p>
                </div>
                <div class="flex items-start gap-2">
                  <span class="text-lg">💡</span>
                  <div class="flex-1">
                    <p><strong>มาตรการแนะนำเชิงรุกสําหรับ อบจ.ลำปาง:</strong></p>
                    <ul class="list-disc pl-5 mt-1.5 space-y-1 text-slate-600 dark:text-slate-300">
                      <li>จัดตั้งทีมช่วยเหลือเคลื่อนที่เร็วเฉพาะกิจในการแก้ไขเรื่องร้องทุกข์เกี่ยวกับปัญหากลุ่มงาน ${topTopic} เพื่อลดภาระตกค้างสะสม</li>
                      <li>ปรับกระบวนการส่งต่อใบงานร่วมกับเทศบาลและ อบต. ในจังหวัดเพื่อขจัดข้อพิพาทความทับซ้อนทางเขตอำนาจ</li>
                      <li>จัดสรรงบประมาณพัฒนาโครงสร้างพื้นฐานในพื้นที่ที่มีการร้องเรียนซ้ำซาก เพื่อแก้ไขปัญหาของประชาชนอย่างถาวรและลดจำนวนใบงานใหม่</li>
                    </ul>
                  </div>
                </div>
              </div>
            `;
          }
        }
        else if (activeSubTab === 'risk') {
          fetchRiskIndexData();
        }

      } catch (e) {
        console.error("Error loading dashboard charts", e);
      } finally {
        isRenderingCharts = false;
        if (pendingRenderRequest) {
          setTimeout(() => initDashboardCharts(currentGlobalStartDate, currentGlobalEndDate), 50);
        }
      }
    }

    document.addEventListener("DOMContentLoaded", () => {
      // Run once page finishes loading
      const activeSubTab = localStorage.getItem('activeSubTab') || 'water';
      if (typeof window.switchSubTab === 'function') {
        window.switchSubTab(activeSubTab);
      }

      // Initialize Sortable for schedule page task list
      const taskListEl = document.getElementById('taskList');
      if (taskListEl && typeof Sortable !== 'undefined') {
        new Sortable(taskListEl, {
          animation: 150,
          ghostClass: 'bg-blue-50',
          onEnd: function (evt) {
            window.updateTasksFromArray();
            window.sortTasks(); // Auto sort after drag
          }
        });
      }

      // Load system status and completed tasks history immediately on page load
      loadStatus();

      // Auto-refresh status and live verifications every 5 seconds (5000ms)
      setInterval(() => { if (!document.hidden) loadStatus(); }, 15000);

      // Heartbeat ping to keep server connection active
      setInterval(() => {
        fetch('/api/ping', { method: 'POST' }).catch(() => {});
      }, 10000);
    });


    // Initial page routing call
    const activePage = localStorage.getItem('activePage') || 'dashboard';
    switchPage(activePage);



    // === Dark Mode Toggle Logic ===
    const themeToggleDarkIcon = document.getElementById('theme-toggle-dark-icon');
    const themeToggleLightIcon = document.getElementById('theme-toggle-light-icon');
    const themeToggleBtn = document.getElementById('theme-toggle');

    // Change the icons inside the button based on previous settings
    if (localStorage.getItem('color-theme') === 'dark' || (!('color-theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      themeToggleLightIcon.classList.remove('hidden');
    } else {
      themeToggleDarkIcon.classList.remove('hidden');
    }

    themeToggleBtn.addEventListener('click', function () {
      // toggle icons inside button
      themeToggleDarkIcon.classList.toggle('hidden');
      themeToggleLightIcon.classList.toggle('hidden');

      // if set via local storage previously
      if (localStorage.getItem('color-theme')) {
        if (localStorage.getItem('color-theme') === 'light') {
          document.documentElement.classList.add('dark');
          localStorage.setItem('color-theme', 'dark');
        } else {
          document.documentElement.classList.remove('dark');
          localStorage.setItem('color-theme', 'light');
        }
        // if NOT set via local storage previously
      } else {
        if (document.documentElement.classList.contains('dark')) {
          document.documentElement.classList.remove('dark');
          localStorage.setItem('color-theme', 'light');
        } else {
          document.documentElement.classList.add('dark');
          localStorage.setItem('color-theme', 'dark');
        }
      }

      // Re-render dashboard charts to update theme colors
      if (localStorage.getItem('activePage') === 'dashboard' || !localStorage.getItem('activePage')) {
        setTimeout(initDashboardCharts, 100);
      }
    });

    // === Sidebar Collapsible Logic ===
    const sidebar = document.getElementById('sidebar');
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    
    // Create mobile backdrop overlay dynamically if it doesn't exist
    let overlay = document.getElementById('sidebar-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sidebar-overlay';
      overlay.className = 'fixed inset-0 bg-slate-950/40 dark:bg-slate-950/60 backdrop-blur-xs z-15 opacity-0 transition-opacity duration-300 pointer-events-none sm:hidden';
      document.body.appendChild(overlay);
    }

    function toggleSidebar() {
      const isMobile = window.innerWidth < 640;
      if (isMobile) {
        document.body.classList.toggle('sidebar-open');
        const isOpen = document.body.classList.contains('sidebar-open');
        if (isOpen) {
          overlay.classList.remove('pointer-events-none', 'opacity-0');
          overlay.classList.add('opacity-100');
        } else {
          overlay.classList.add('pointer-events-none', 'opacity-0');
          overlay.classList.remove('opacity-100');
        }
      } else {
        document.body.classList.toggle('sidebar-collapsed');
        // Persist collapsed state for desktop
        const isCollapsed = document.body.classList.contains('sidebar-collapsed');
        localStorage.setItem('sidebarCollapsed', isCollapsed ? 'true' : 'false');
        
        // Trigger resize event so charts adapt
        setTimeout(() => {
          window.dispatchEvent(new Event('resize'));
        }, 305);
      }
    }

    if (mobileMenuBtn) {
      mobileMenuBtn.addEventListener('click', toggleSidebar);
    }
    overlay.addEventListener('click', toggleSidebar);

    // Initialize desktop collapsed state from local storage on load
    if (localStorage.getItem('sidebarCollapsed') === 'true') {
      document.body.classList.add('sidebar-collapsed');
    }

    // === Global Date Range Picker ===
    $(document).ready(function () {
      const $picker = $('#globalDateRange');
      const $clearBtn = $('#clearGlobalDate');

      const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

      function formatThaiDate(momentObj) {
        return `${momentObj.date()} ${thaiMonths[momentObj.month()]} ${momentObj.year() + 543}`;
      }

      $picker.val('');

      $picker.daterangepicker({
        startDate: moment(),
        endDate: moment(),
        autoUpdateInput: false,
        opens: 'left',
        drops: 'down',
        showDropdowns: true,
        alwaysShowCalendars: true,
        locale: {
          format: 'DD/MM/YYYY',
          separator: ' - ',
          applyLabel: "บันทึก",
          cancelLabel: "ยกเลิก",
          fromLabel: "จาก",
          toLabel: "ถึง",
          customRangeLabel: "กำหนดช่วงเวลาเอง",
          daysOfWeek: ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"],
          monthNames: [
            "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
            "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
          ],
          firstDay: 1
        },
        ranges: {
          'วันนี้': [moment(), moment()],
          'เมื่อวาน': [moment().subtract(1, 'days'), moment().subtract(1, 'days')],
          '7 วันล่าสุด': [moment().subtract(6, 'days'), moment()],
          '30 วันล่าสุด': [moment().subtract(29, 'days'), moment()],
          'เดือนนี้': [moment().startOf('month'), moment().endOf('month')],
          'เดือนที่แล้ว': [moment().subtract(1, 'month').startOf('month'), moment().subtract(1, 'month').endOf('month')]
        }
      });

      // Fix Thai Year in dropdown via MutationObserver and toggle show class
      $picker.on('show.daterangepicker', function (ev, picker) {
        picker.container.addClass('show');
        if (!picker._customNextBtnObserver) {
          picker._customNextBtnObserver = new MutationObserver(() => {
            // Fix Thai Year display in dropdowns
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

      $picker.on('hide.daterangepicker', function (ev, picker) {
        picker.container.removeClass('show');
      });


      $picker.on('apply.daterangepicker', function (ev, picker) {
        let displayStr;
        if (picker.startDate.format('YYYY-MM-DD') === picker.endDate.format('YYYY-MM-DD')) {
          displayStr = formatThaiDate(picker.startDate);
        } else {
          displayStr = formatThaiDate(picker.startDate) + '  ถึง  ' + formatThaiDate(picker.endDate);
        }
        $(this).val(displayStr);
        $clearBtn.removeClass('hidden');

        currentGlobalStartDate = picker.startDate.format('YYYY-MM-DD');
        currentGlobalEndDate = picker.endDate.format('YYYY-MM-DD');

        // Fetch new data
        initDashboardCharts();
      });

      $picker.on('cancel.daterangepicker', function (ev, picker) {
        $(this).val('');
        $clearBtn.addClass('hidden');
        currentGlobalStartDate = '';
        currentGlobalEndDate = '';
        initDashboardCharts();
      });

      $clearBtn.on('click', function (e) {
        e.stopPropagation();
        $picker.val('');
        $(this).addClass('hidden');
        currentGlobalStartDate = '';
        currentGlobalEndDate = '';
        initDashboardCharts();
      });
    });

    // === KPI Modal Logic ===
    async function openKpiModal(type) {
      if (!currentDbData) return;
      const modal = document.getElementById('kpiModal');
      const titleEl = document.getElementById('kpiModalTitle');
      const contentEl = document.getElementById('kpiModalContent');
      let title = '';
      let contentHtml = '';

      function createSummaryBlock(summaries) {
        let html = '<div class="grid grid-cols-2 sm:grid-cols-2 gap-3 mb-4">';
        summaries.forEach(s => {
          html += `
            <div class="bg-slate-50 dark:bg-slate-700/40 border border-slate-200/80 dark:border-slate-700/60 rounded-xl p-3 shadow-sm flex flex-col justify-between">
              <p class="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 break-words whitespace-normal">${s.label}</p>
              <div class="flex items-baseline gap-2">
                 <span class="text-lg font-bold text-slate-800 dark:text-white">${s.count}</span>
                 <span class="text-[10px] text-slate-400">(${(s.count / (s.total || 1) * 100).toFixed(1)}%)</span>
              </div>
            </div>`;
        });
        html += '</div><hr class="my-3 border-slate-200 dark:border-slate-700" /><ul class="space-y-2 pb-2 max-h-[50vh] overflow-y-auto pr-1">';
        return html;
      }

      if (type === 'water_rain') {
        title = 'รายงานปริมาณน้ำฝน';
        try {
          const res = await fetch('/api/rainfall-data');
          if (!res.ok) throw new Error('Failed to fetch rainfall data');
          const rainData = await res.json();
          
          contentHtml = `
          <div class="overflow-x-auto border border-slate-200 dark:border-slate-700/60 rounded-xl max-h-[60vh]">
            <table class="w-full text-sm text-left text-slate-500 dark:text-slate-400">
              <thead class="text-xs text-slate-700 uppercase bg-slate-50 dark:bg-slate-700/40 dark:text-slate-400 sticky top-0 shadow-sm z-10">
                <tr>
                  <th scope="col" class="px-6 py-3 font-semibold whitespace-nowrap">สถานี</th>
                  <th scope="col" class="px-6 py-3 font-semibold">ที่ตั้ง</th>
                  <th scope="col" class="px-6 py-3 font-semibold whitespace-nowrap">แม่น้ำ/คลอง</th>
                  <th scope="col" class="px-6 py-3 font-semibold whitespace-nowrap text-right">ฝนสะสม (มม.)</th>
                  <th scope="col" class="px-6 py-3 font-semibold whitespace-nowrap text-center">เกณฑ์ปริมาณฝน</th>
                  <th scope="col" class="px-6 py-3 font-semibold whitespace-nowrap text-center">ระดับความเสี่ยง</th>
                  <th scope="col" class="px-6 py-3 font-semibold whitespace-nowrap text-center">เวลา</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200 dark:divide-slate-700/60">
          `;
          
          if (rainData && rainData.length > 0) {
            rainData.forEach(station => {
              let rain = parseFloat(station.rain_mm);
              let isNull = isNaN(rain) || station.rain_mm === null;
              
              let rainStatusText = 'ไม่มีฝน';
              let rainStatusClass = 'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-700 dark:text-slate-300';
              let riskLevel = 'ปกติ';
              let riskClass = 'text-slate-500';

              if (!isNull && rain > 90) {
                rainStatusText = 'หนักมาก';
                rainStatusClass = 'bg-[#ff0000] text-white border-[#cc0000]';
                riskLevel = 'วิกฤต';
                riskClass = 'text-red-600 font-bold';
              } else if (!isNull && rain > 70) {
                rainStatusText = 'หนัก';
                rainStatusClass = 'bg-[#cc5500] text-white border-[#aa4400]';
                riskLevel = 'เสี่ยงสูงมาก';
                riskClass = 'text-[#cc5500] font-bold';
              } else if (!isNull && rain > 50) {
                rainStatusText = 'หนัก';
                rainStatusClass = 'bg-[#ff8800] text-white border-[#dd7700]';
                riskLevel = 'เสี่ยงสูง';
                riskClass = 'text-[#ff8800] font-bold';
              } else if (!isNull && rain > 35) {
                rainStatusText = 'หนัก';
                rainStatusClass = 'bg-[#ffcc00] text-yellow-900 border-[#ddaa00]';
                riskLevel = 'เฝ้าระวัง';
                riskClass = 'text-yellow-600 font-semibold';
              } else if (!isNull && rain > 20) {
                rainStatusText = 'ปานกลาง';
                rainStatusClass = 'bg-[#77cc00] text-white border-[#66aa00]';
                riskLevel = 'ปกติ';
                riskClass = 'text-[#55aa00]';
              } else if (!isNull && rain > 10) {
                rainStatusText = 'ปานกลาง';
                rainStatusClass = 'bg-[#a8f0ad] text-green-900 border-[#88dd8d]';
                riskLevel = 'ปกติ';
                riskClass = 'text-green-700';
              } else if (!isNull && rain > 0) {
                rainStatusText = 'เล็กน้อย';
                rainStatusClass = 'bg-[#9cc2ff] text-blue-900 border-[#77aaff]';
                riskLevel = 'ปกติ';
                riskClass = 'text-blue-600';
              }
              
              contentHtml += `
                <tr class="bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                  <td class="px-6 py-3 font-medium text-slate-900 dark:text-white whitespace-nowrap">${station.station_name || '-'}</td>
                  <td class="px-6 py-3 min-w-[200px] leading-snug">${station.location || '-'}</td>
                  <td class="px-6 py-3 whitespace-nowrap">${station.river_basin || '-'}</td>
                  <td class="px-6 py-3 text-right font-mono font-medium">${isNull ? '-' : rain.toFixed(1)}</td>
                  <td class="px-6 py-3 text-center">
                    <span class="px-2.5 py-1 text-xs font-semibold rounded-md border ${rainStatusClass}">
                      ${rainStatusText}
                    </span>
                  </td>
                  <td class="px-6 py-3 text-center text-xs whitespace-nowrap font-semibold ${riskClass}">
                    ${riskLevel}
                  </td>
                  <td class="px-6 py-3 text-center text-xs whitespace-nowrap text-slate-500 dark:text-slate-400">${station.measured_time || '-'}</td>
                </tr>
              `;
            });
          } else {
            contentHtml += `<tr><td colspan="7" class="px-6 py-8 text-center text-slate-500">ไม่พบข้อมูลปริมาณน้ำฝน</td></tr>`;
          }
          
          contentHtml += `
              </tbody>
            </table>
          </div>`;
        } catch (err) {
          console.error(err);
          contentHtml = `<div class="text-center text-red-500 p-4">เกิดข้อผิดพลาดในการโหลดข้อมูลปริมาณน้ำฝน</div>`;
        }
      } else if (type.startsWith('water_')) {
        title = 'รายงานระดับน้ำรายอำเภอและสถานี';
        let current = currentDbData.water.current || [];
        current = current.filter(w => !w.station_name.toLowerCase().includes('test'));
        let critLow = [], low = [], normal = [], high = [], overflow = [];

        current.forEach(w => {
          let lvl = parseFloat(w.current_water_level_m) || 0;
          let bank = parseFloat(w.left_bank_level_m) || 0;
          const statusStr = w.status || '';
          const riskStr = w.risk_level || '';

          if (statusStr.includes('น้ำน้อยวิกฤต')) {
            critLow.push(w);
          } else if (statusStr.includes('น้ำน้อย')) {
            low.push(w);
          } else if (statusStr.includes('น้ำล้นตลิ่ง') || riskStr.includes('น้ำล้นตลิ่ง') || (bank > 0 && lvl >= bank)) {
            overflow.push(w);
          } else if (statusStr.includes('น้ำมาก') || riskStr.includes('น้ำมาก')) {
            high.push(w);
          } else {
            normal.push(w);
          }
        });

        contentHtml = `
        <div class="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4">
          <div class="bg-slate-50 dark:bg-slate-700/40 border border-slate-200/80 dark:border-slate-700/60 rounded-xl p-2 flex flex-col items-center text-center">
            <span class="w-2.5 h-2.5 rounded-full bg-[#b45309] mb-1"></span>
            <span class="text-[9px] sm:text-[10px] font-semibold text-slate-500 dark:text-slate-400 break-words whitespace-normal leading-tight">น้ำน้อยวิกฤต</span>
            <span class="text-xs font-bold text-slate-800 dark:text-white mt-1">${critLow.length} <span class="text-[9px] font-normal text-slate-400">(${(critLow.length / (current.length || 1) * 100).toFixed(0)}%)</span></span>
          </div>
          <div class="bg-slate-50 dark:bg-slate-700/40 border border-slate-200/80 dark:border-slate-700/60 rounded-xl p-2 flex flex-col items-center text-center">
            <span class="w-2.5 h-2.5 rounded-full bg-[#eab308] mb-1"></span>
            <span class="text-[9px] sm:text-[10px] font-semibold text-slate-500 dark:text-slate-400 break-words whitespace-normal leading-tight">น้ำน้อย</span>
            <span class="text-xs font-bold text-slate-800 dark:text-white mt-1">${low.length} <span class="text-[9px] font-normal text-slate-400">(${(low.length / (current.length || 1) * 100).toFixed(0)}%)</span></span>
          </div>
          <div class="bg-slate-50 dark:bg-slate-700/40 border border-slate-200/80 dark:border-slate-700/60 rounded-xl p-2 flex flex-col items-center text-center">
            <span class="w-2.5 h-2.5 rounded-full bg-[#10b981] mb-1"></span>
            <span class="text-[9px] sm:text-[10px] font-semibold text-slate-500 dark:text-slate-400 break-words whitespace-normal leading-tight">น้ำปกติ</span>
            <span class="text-xs font-bold text-slate-800 dark:text-white mt-1">${normal.length} <span class="text-[9px] font-normal text-slate-400">(${(normal.length / (current.length || 1) * 100).toFixed(0)}%)</span></span>
          </div>
          <div class="bg-slate-50 dark:bg-slate-700/40 border border-slate-200/80 dark:border-slate-700/60 rounded-xl p-2 flex flex-col items-center text-center">
            <span class="w-2.5 h-2.5 rounded-full bg-[#3b82f6] mb-1"></span>
            <span class="text-[9px] sm:text-[10px] font-semibold text-slate-500 dark:text-slate-400 break-words whitespace-normal leading-tight">น้ำมาก</span>
            <span class="text-xs font-bold text-slate-800 dark:text-white mt-1">${high.length} <span class="text-[9px] font-normal text-slate-400">(${(high.length / (current.length || 1) * 100).toFixed(0)}%)</span></span>
          </div>
          <div class="bg-slate-50 dark:bg-slate-700/40 border border-slate-200/80 dark:border-slate-700/60 rounded-xl p-2 flex flex-col items-center text-center col-span-3 sm:col-span-1">
            <span class="w-2.5 h-2.5 rounded-full bg-[#ef4444] mb-1"></span>
            <span class="text-[9px] sm:text-[10px] font-semibold text-slate-500 dark:text-slate-400 break-words whitespace-normal leading-tight">น้ำล้นตลิ่ง</span>
            <span class="text-xs font-bold text-slate-800 dark:text-white mt-1">${overflow.length} <span class="text-[9px] font-normal text-slate-400">(${(overflow.length / (current.length || 1) * 100).toFixed(0)}%)</span></span>
          </div>
        </div>
        <hr class="my-3 border-slate-200 dark:border-slate-700" />
        <ul class="space-y-2 pb-2 max-h-[50vh] overflow-y-auto pr-1">`;

        const allSorted = [...overflow, ...high, ...normal, ...low, ...critLow];
        allSorted.forEach(w => {
          let badge = '';
          if (overflow.includes(w)) badge = '<span class="bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 px-2 py-0.5 rounded text-xs border border-red-200/50 font-bold">น้ำล้นตลิ่ง</span>';
          else if (high.includes(w)) badge = '<span class="bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded text-xs border border-blue-200/50 font-bold">น้ำมาก</span>';
          else if (normal.includes(w)) badge = '<span class="bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded text-xs border border-emerald-200/50 font-bold">น้ำปกติ</span>';
          else if (low.includes(w)) badge = '<span class="bg-yellow-100 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-400 px-2 py-0.5 rounded text-xs border border-yellow-200/50 font-bold">น้ำน้อย</span>';
          else if (critLow.includes(w)) badge = '<span class="bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded text-xs border border-amber-200/50 font-bold">น้ำน้อยวิกฤต</span>';

          let detailText = `ระดับน้ำ ${parseFloat(w.current_water_level_m || 0).toFixed(2)} เมตร`;
          contentHtml += `
          <li class="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50 hover:bg-slate-100 dark:bg-slate-700/30 dark:hover:bg-slate-700/50 p-3 rounded-xl border border-slate-200/50 dark:border-slate-700/60 transition-colors gap-2">
            <div class="flex flex-col min-w-0 flex-1">
              <span class="font-semibold text-sm text-slate-700 dark:text-slate-200 break-words whitespace-normal">${w.station_name}</span>
              <span class="text-xs text-slate-400 dark:text-slate-500 mt-0.5">${w.amphoe ? 'อำเภอ' + w.amphoe : 'ไม่ระบุอำเภอ'}</span>
            </div>
            <div class="flex items-center justify-between sm:justify-end gap-3 shrink-0 mt-2 sm:mt-0 pt-2 sm:pt-0 border-t border-slate-100 dark:border-slate-700/40 sm:border-0">
              <span class="font-bold text-sm text-slate-700 dark:text-slate-200">${detailText}</span>
              ${badge}
            </div>
          </li>`;
        });
        contentHtml += '</ul>';

      } else if (type.startsWith('drought_')) {
        title = 'ปริมาตรน้ำอ่างกักเก็บรายอำเภอ';
        const current = currentDbData.drought.current || [];
        let critical = [], warning = [], normal = [];

        current.forEach(w => {
          let pct = (parseFloat(w.water_volume_m_cum) / parseFloat(w.capacity_m_cum)) * 100;
          if (pct < 30) critical.push(w);
          else if (pct < 60) warning.push(w);
          else normal.push(w);
        });

        contentHtml = createSummaryBlock([
          { label: 'น้ำเพียงพอปกติ', count: normal.length, total: current.length, colorClass: 'bg-emerald-500' },
          { label: 'น้ำน้อยควรระวัง', count: warning.length, total: current.length, colorClass: 'bg-amber-500' },
          { label: 'วิกฤตน้ำแล้งจัด', count: critical.length, total: current.length, colorClass: 'bg-rose-500' }
        ]);

        const allSorted = [...current].sort((a, b) => (parseFloat(a.water_volume_m_cum) / parseFloat(a.capacity_m_cum)) - (parseFloat(b.water_volume_m_cum) / parseFloat(b.capacity_m_cum)));
        allSorted.forEach(w => {
          let pct = ((parseFloat(w.water_volume_m_cum) / parseFloat(w.capacity_m_cum)) * 100).toFixed(1);
          let badge = '';
          if (pct < 30) badge = '<span class="bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 px-2 py-0.5 rounded text-xs border border-rose-200 font-bold">น้ำแล้งวิกฤต</span>';
          else if (pct < 60) badge = '<span class="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 px-2 py-0.5 rounded text-xs border border-amber-200 font-bold">เฝ้าระวัง</span>';
          else badge = '<span class="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 px-2 py-0.5 rounded text-xs border border-emerald-200 font-bold">น้ำปกติ</span>';

          contentHtml += `
          <li class="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50 hover:bg-slate-100 dark:bg-slate-700/30 dark:hover:bg-slate-700/50 p-3 rounded-xl border border-slate-200/50 dark:border-slate-700/60 transition-colors gap-2">
            <div class="flex flex-col min-w-0 flex-1">
              <span class="font-semibold text-sm text-slate-700 dark:text-slate-200 break-words whitespace-normal">${w.dam_name}</span>
              <span class="text-xs text-slate-400 dark:text-slate-500 mt-0.5">อ่างเก็บน้ำในจังหวัดลำปาง</span>
            </div>
            <div class="flex items-center justify-between sm:justify-end gap-3 shrink-0 mt-2 sm:mt-0 pt-2 sm:pt-0 border-t border-slate-100 dark:border-slate-700/40 sm:border-0">
              <span class="font-bold text-sm text-slate-700 dark:text-slate-200">น้ำกักเก็บ ${parseFloat(w.water_volume_m_cum || 0).toFixed(1)} ล้าน ลบ.ม. <span class="text-xs font-normal text-slate-400">(${pct}%)</span></span>
              ${badge}
            </div>
          </li>`;
        });
        contentHtml += '</ul>';

      } else if (type.startsWith('pm25_')) {
        title = 'รายงานค่าฝุ่นละออง PM 2.5 ทุกจุดตรวจ';
        const current = currentDbData.pm25.current || [];
        let veryGood = [], good = [], moderate = [], unhealthy = [], severe = [];

        current.forEach(w => {
          const val = parseFloat(w.pm25_value);
          if (!isNaN(val)) {
            if (val <= 15.0) veryGood.push(w);
            else if (val <= 25.0) good.push(w);
            else if (val <= 37.5) moderate.push(w);
            else if (val <= 75.0) unhealthy.push(w);
            else severe.push(w);
          } else {
            veryGood.push(w);
          }
        });

        contentHtml = `
        <div class="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4">
          <div class="bg-slate-50 dark:bg-slate-700/40 border border-slate-200/80 dark:border-slate-700/60 rounded-xl p-2 flex flex-col items-center text-center">
            <span class="w-2.5 h-2.5 rounded-full bg-[#60a5fa] mb-1"></span>
            <span class="text-[9px] sm:text-[10px] font-semibold text-slate-500 dark:text-slate-400 break-words whitespace-normal leading-tight">ดีมาก</span>
            <span class="text-xs font-bold text-slate-800 dark:text-white mt-1">${veryGood.length} <span class="text-[9px] font-normal text-slate-400">(${(veryGood.length / (current.length || 1) * 100).toFixed(0)}%)</span></span>
          </div>
          <div class="bg-slate-50 dark:bg-slate-700/40 border border-slate-200/80 dark:border-slate-700/60 rounded-xl p-2 flex flex-col items-center text-center">
            <span class="w-2.5 h-2.5 rounded-full bg-[#10b981] mb-1"></span>
            <span class="text-[9px] sm:text-[10px] font-semibold text-slate-500 dark:text-slate-400 break-words whitespace-normal leading-tight">อากาศดี</span>
            <span class="text-xs font-bold text-slate-800 dark:text-white mt-1">${good.length} <span class="text-[9px] font-normal text-slate-400">(${(good.length / (current.length || 1) * 100).toFixed(0)}%)</span></span>
          </div>
          <div class="bg-slate-50 dark:bg-slate-700/40 border border-slate-200/80 dark:border-slate-700/60 rounded-xl p-2 flex flex-col items-center text-center">
            <span class="w-2.5 h-2.5 rounded-full bg-[#fbbf24] mb-1"></span>
            <span class="text-[9px] sm:text-[10px] font-semibold text-slate-500 dark:text-slate-400 break-words whitespace-normal leading-tight">ปานกลาง</span>
            <span class="text-xs font-bold text-slate-800 dark:text-white mt-1">${moderate.length} <span class="text-[9px] font-normal text-slate-400">(${(moderate.length / (current.length || 1) * 100).toFixed(0)}%)</span></span>
          </div>
          <div class="bg-slate-50 dark:bg-slate-700/40 border border-slate-200/80 dark:border-slate-700/60 rounded-xl p-2 flex flex-col items-center text-center">
            <span class="w-2.5 h-2.5 rounded-full bg-[#f97316] mb-1"></span>
            <span class="text-[9px] sm:text-[10px] font-semibold text-slate-500 dark:text-slate-400 break-words whitespace-normal leading-tight">เริ่มมีผลฯ</span>
            <span class="text-xs font-bold text-slate-800 dark:text-white mt-1">${unhealthy.length} <span class="text-[9px] font-normal text-slate-400">(${(unhealthy.length / (current.length || 1) * 100).toFixed(0)}%)</span></span>
          </div>
          <div class="bg-slate-50 dark:bg-slate-700/40 border border-slate-200/80 dark:border-slate-700/60 rounded-xl p-2 flex flex-col items-center text-center col-span-3 sm:col-span-1">
            <span class="w-2.5 h-2.5 rounded-full bg-[#ef4444] mb-1"></span>
            <span class="text-[9px] sm:text-[10px] font-semibold text-slate-500 dark:text-slate-400 break-words whitespace-normal leading-tight">มีผลกระทบ</span>
            <span class="text-xs font-bold text-slate-800 dark:text-white mt-1">${severe.length} <span class="text-[9px] font-normal text-slate-400">(${(severe.length / (current.length || 1) * 100).toFixed(0)}%)</span></span>
          </div>
        </div>
        <hr class="my-3 border-slate-200 dark:border-slate-700" />
        <ul class="space-y-2 pb-2 max-h-[50vh] overflow-y-auto pr-1">`;

        const allSorted = [...severe, ...unhealthy, ...moderate, ...good, ...veryGood];
        allSorted.forEach(w => {
          let badgeClass = '';
          let badgeText = '';
          const val = parseFloat(w.pm25_value);
          if (val <= 15.0) { badgeClass = 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-400'; badgeText = 'ดีมาก'; }
          else if (val <= 25.0) { badgeClass = 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400'; badgeText = 'ดี'; }
          else if (val <= 37.5) { badgeClass = 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-400'; badgeText = 'ปานกลาง'; }
          else if (val <= 75.0) { badgeClass = 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400'; badgeText = 'เริ่มมีผลฯ'; }
          else { badgeClass = 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400'; badgeText = 'มีผลเสีย'; }

          contentHtml += `
          <li class="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50 hover:bg-slate-100 dark:bg-slate-700/30 dark:hover:bg-slate-700/50 p-3 rounded-xl border border-slate-200/50 dark:border-slate-700/60 transition-colors gap-2">
            <div class="flex flex-col min-w-0 flex-1">
              <span class="font-semibold text-sm text-slate-700 dark:text-slate-200 break-words whitespace-normal">${w.station_name || 'สถานีตรวจวัด'}</span>
              <span class="text-xs text-slate-400 dark:text-slate-500 mt-0.5">อำเภอ${w.amphoe || 'ไม่ระบุ'}</span>
            </div>
            <div class="flex items-center justify-between sm:justify-end gap-3 shrink-0 mt-2 sm:mt-0 pt-2 sm:pt-0 border-t border-slate-100 dark:border-slate-700/40 sm:border-0">
              <span class="font-bold text-sm text-slate-700 dark:text-slate-200">ค่าฝุ่น PM 2.5: ${w.pm25_value} ไมโครกรัม</span>
              <span class="px-2 py-0.5 rounded-md text-xs border ${badgeClass} font-bold">${badgeText}</span>
            </div>
          </li>`;
        });
        contentHtml += '</ul>';

      } else if (type.startsWith('complaints_')) {
        title = 'รายงานเรื่องร้องเรียนและความเดือดร้อน';
        const statusData = currentDbData.complaints.state || [];
        let total = 0, resolved = 0, pending = 0;
        statusData.forEach(s => {
          let count = parseInt(s.count) || 0;
          total += count;
          if (s.state_name.includes('เสร็จ')) resolved += count;
          else pending += count;
        });

        contentHtml = createSummaryBlock([
          { label: 'ช่วยเหลือสำเร็จแล้ว', count: resolved, total: total || 1, colorClass: 'bg-emerald-500' },
          { label: 'กำลังอยู่ระหว่างดำเนินการ', count: pending, total: total || 1, colorClass: 'bg-amber-500' }
        ]);

        contentHtml += '<ul class="space-y-2 pb-2 max-h-[50vh] overflow-y-auto pr-1">';
        statusData.forEach(s => {
          let isResolved = s.state_name.includes('เสร็จ');
          let badge = isResolved ? '<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-xs border border-emerald-200 font-bold">ช่วยเหลือเสร็จ</span>' : '<span class="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-xs border border-amber-200 font-bold">กำลังทำ</span>';
          contentHtml += `
          <li class="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50 hover:bg-slate-100 dark:bg-slate-700/30 dark:hover:bg-slate-700/50 p-3 rounded-xl border border-slate-200/50 dark:border-slate-700/60 transition-colors gap-2">
             <div class="flex flex-col min-w-0 flex-1">
               <span class="font-semibold text-sm text-slate-700 dark:text-slate-200 break-words whitespace-normal">${s.state_name}</span>
               <span class="text-xs text-slate-400 dark:text-slate-500 mt-0.5">สถานะความคืบหน้ากระบวนการแก้ไขปัญหา</span>
             </div>
             <div class="flex items-center justify-between sm:justify-end gap-3 shrink-0 mt-2 sm:mt-0 pt-2 sm:pt-0 border-t border-slate-100 dark:border-slate-700/40 sm:border-0">
               <span class="font-bold text-sm text-slate-700 dark:text-slate-200">ทั้งหมด ${s.count} เรื่อง</span>
               ${badge}
             </div>
          </li>`;
        });
        contentHtml += '</ul>';
      }

      titleEl.innerText = title;
      contentEl.innerHTML = contentHtml || '<p class="text-slate-500">ไม่มีข้อมูลเพิ่มเติม</p>';

      modal.classList.remove('hidden');
      modal.classList.add('flex');
      void modal.offsetWidth;
      modal.classList.remove('opacity-0');
      modal.firstElementChild.classList.remove('scale-95');
    }

    function closeKpiModal() {
      const modal = document.getElementById('kpiModal');
      modal.classList.add('opacity-0');
      modal.firstElementChild.classList.add('scale-95');
      setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
      }, 300);
    }

    // === Image Viewer Modal Logic ===
    window.openImageModal = function (src) {
      const modal = document.getElementById('imageViewerModal');
      const img = document.getElementById('viewerImage');
      if (!modal || !img) return;
      img.src = src;
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      setTimeout(() => {
        modal.classList.remove('opacity-0');
        modal.firstElementChild.classList.remove('scale-95');
      }, 10);
    };

    window.closeImageViewer = function () {
      const modal = document.getElementById('imageViewerModal');
      if (!modal) return;
      modal.classList.add('opacity-0');
      modal.firstElementChild.classList.add('scale-95');
      setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
      }, 300);
    };

    // =========================================================================
    // System Log Center, 48-Slot Heatmap, Auto-Retry, Data Freshness & Traffy Session UI
    // =========================================================================
    function copyLogContainerText(elementId, label) {
      const box = document.getElementById(elementId);
      if (!box) return;
      const text = box.innerText.trim();
      if (!text) {
        alert('ไม่มีข้อมูลให้คัดลอก');
        return;
      }
      navigator.clipboard.writeText(text).then(() => {
        alert(`คัดลอก ${label} ลงในคลิปบอร์ดเรียบร้อยแล้ว!`);
      }).catch(() => alert('ไม่สามารถคัดลอกได้'));
    }

    window.copyLogs = () => copyLogContainerText('logBox', 'Live System Logs');
    window.copyWaterLogs = () => copyLogContainerText('waterLogBox', 'Water Logs');
    window.copyDroughtLogs = () => copyLogContainerText('droughtLogBox', 'Drought Logs');
    window.copyPM25Logs = () => copyLogContainerText('pm25LogBox', 'PM 2.5 Logs');

    window.switchSystemLogView = function (mode) {
      const structBox = document.getElementById('structuredLogsContainer');
      const consoleBox = document.getElementById('consoleLogsContainer');
      const filterBar = document.getElementById('sysLogFiltersBar');
      const btnS = document.getElementById('tabBtnStructuredLogs');
      const btnC = document.getElementById('tabBtnConsoleLogs');
      if (!structBox || !consoleBox) return;

      if (mode === 'console') {
        structBox.classList.add('hidden');
        if (filterBar) filterBar.classList.add('hidden');
        consoleBox.classList.remove('hidden');
        if (btnC) btnC.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white';
        if (btnS) btnS.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700';
      } else {
        consoleBox.classList.add('hidden');
        structBox.classList.remove('hidden');
        if (filterBar) filterBar.classList.remove('hidden');
        if (btnS) btnS.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white';
        if (btnC) btnC.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700';
      }
    };

    window.updateFreshnessStrip = function (freshness, retryQueue) {
      const strip = document.getElementById('freshnessBadgeStrip');
      if (!strip) return;
      const modNames = { water: 'น้ำ', rainfall: 'ฝน', pm25: 'PM 2.5', drought: 'เขื่อน' };
      const items = Object.keys(modNames).map(k => {
        const info = freshness[k];
        if (!info) return `<span class="px-2 py-0.5 rounded bg-slate-800 text-slate-400">${modNames[k]}: รอตรวจสอบ</span>`;
        if (info.isStale) {
          return `<span class="px-2 py-0.5 rounded bg-amber-950/80 border border-amber-500/40 text-amber-300" title="อัปเดตล่าสุด ${waterEscape(info.latestObsAt || '')}">⚠️ ${modNames[k]}: ค้าง ${info.maxLagHours} ชม. (>${info.thresholdHours}ชม.)</span>`;
        }
        return `<span class="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/30 text-emerald-300">✅ ${modNames[k]}: ปกติ (${info.maxLagHours} ชม.)</span>`;
      });

      const retryKeys = retryQueue ? Object.keys(retryQueue) : [];
      const retryBadge = retryKeys.length > 0
        ? `<span class="px-2.5 py-0.5 rounded bg-rose-950/80 border border-rose-500/50 text-rose-300 animate-pulse">🔁 คิว Auto-Retry: ${retryKeys.map(m => `${m} (ครั้งที่ ${retryQueue[m].attempt})`).join(', ')}</span>`
        : `<span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-400">🔁 คิว Retry: ว่าง</span>`;

      strip.innerHTML = `<div class="flex flex-wrap items-center gap-1.5"><span class="text-slate-400 font-semibold mr-1">🛰️ ความสดข้อมูลต้นทาง:</span>${items.join('')}</div>${retryBadge}`;
    };

    function getSysLogFilterQuery() {
      const params = new URLSearchParams();
      const mod = document.getElementById('sysLogModuleFilter')?.value || 'all';
      const st  = document.getElementById('sysLogStatusFilter')?.value || 'all';
      const trg = document.getElementById('sysLogTriggerFilter')?.value || 'all';
      const dt  = document.getElementById('sysLogDateFilter')?.value || '';
      const q   = document.getElementById('sysLogSearchInput')?.value.trim() || '';
      if (mod !== 'all') params.set('module', mod);
      if (st !== 'all') params.set('status', st);
      if (trg !== 'all') params.set('trigger_source', trg);
      if (dt) { params.set('startDate', dt); params.set('endDate', dt); }
      if (q) params.set('search', q);
      params.set('limit', '100');
      return params.toString();
    }

    window.loadSystemLogs = async function () {
      const feed = document.getElementById('systemLogFeed');
      if (!feed) return;
      try {
        const res = await fetch('/api/system-logs?' + getSysLogFilterQuery());
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'โหลดข้อมูลไม่สำเร็จ');

        const s = data.stats || {};
        const badges = document.getElementById('sysLogSummaryBadges');
        if (badges) {
          badges.innerHTML = `
            <span class="px-2 py-0.5 rounded bg-slate-800 text-slate-200">รวม ${s.total || 0}</span>
            <span class="px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-500/40 text-emerald-300">✅ สำเร็จ ${s.success || 0}</span>
            <span class="px-2 py-0.5 rounded bg-rose-950/70 border border-rose-500/40 text-rose-300">❌ ไม่สำเร็จ ${s.failed || 0}</span>
            <span class="px-2 py-0.5 rounded bg-amber-950/70 border border-amber-500/40 text-amber-300">⚠️ เฝ้าระวัง/บางส่วน ${(s.partial || 0) + (s.warning || 0)}</span>
          `;
        }

        window.updateFreshnessStrip(data.freshness || {}, data.retryQueue || {});

        const logs = data.logs || [];
        if (logs.length === 0) {
          feed.innerHTML = `<div class="p-6 text-center text-slate-400">ไม่พบประวัติการทำงานที่ตรงกับเงื่อนไข</div>`;
          return;
        }

        const pillMap = {
          success: { cls: 'bg-emerald-950 text-emerald-300 border-emerald-500/40', txt: '✅ สำเร็จ' },
          failed:  { cls: 'bg-rose-950 text-rose-300 border-rose-500/40', txt: '❌ ไม่สำเร็จ' },
          partial: { cls: 'bg-amber-950 text-amber-300 border-amber-500/40', txt: '🟡 สำเร็จบางส่วน' },
          warning: { cls: 'bg-amber-950 text-amber-200 border-amber-500/40', txt: '⚠️ เฝ้าระวัง' },
          running: { cls: 'bg-blue-950 text-blue-300 border-blue-500/40', txt: '⏳ กำลังทำงาน' }
        };

        feed.innerHTML = logs.map(r => {
          const p = pillMap[r.status] || { cls: 'bg-slate-800 text-slate-300 border-slate-700', txt: r.status };
          const sec = r.duration_ms > 0 ? `${(r.duration_ms / 1000).toFixed(2)} วิ` : '-';
          const timeRange = r.finished_at && r.finished_at !== r.started_at
            ? `${waterEscape(r.started_at)} → ${waterEscape(String(r.finished_at).slice(11))}`
            : waterEscape(r.started_at);
          const canRetry = (r.status === 'failed' || r.status === 'partial') && ['water', 'rainfall', 'drought', 'pm25', 'complaints', 'github_sync', 'notification'].includes(r.module);
          const retryBtn = canRetry
            ? `<button onclick="retryFailedModule('${waterEscape(r.module)}', '${waterEscape(r.scheduled_slot || '')}', this)" class="px-2 py-0.5 bg-rose-700 hover:bg-rose-600 text-white rounded text-[11px] font-semibold">🔄 ดึงซ้ำเฉพาะงานนี้</button>`
            : '';
          const errHtml = r.error_detail
            ? `<div class="mt-1 px-2 py-1 rounded bg-rose-950/50 border border-rose-500/30 text-rose-300 font-mono text-[11px] break-all">สาเหตุ: ${waterEscape(r.error_detail)}</div>`
            : '';

          return `
            <div class="p-3 hover:bg-slate-900/70 transition-colors flex flex-col gap-1">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="px-2 py-0.5 rounded border text-[11px] font-semibold ${p.cls}">${p.txt}</span>
                  <span class="px-2 py-0.5 rounded bg-slate-800 text-slate-200 font-semibold">${waterEscape(r.module_label || r.module)}</span>
                  ${r.scheduled_slot ? `<span class="px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-500/30 text-[11px]">รอบ ${waterEscape(r.scheduled_slot)}</span>` : ''}
                  <span class="text-slate-400 text-[11px]">• ${waterEscape(r.trigger_label || r.trigger_source)}</span>
                </div>
                <div class="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                  <span>🕒 ${timeRange}</span>
                  <span>⏱️ ${sec}</span>
                  ${r.row_count > 0 ? `<span class="text-cyan-300">${r.row_count} แถว</span>` : ''}
                  ${retryBtn}
                </div>
              </div>
              <div class="text-slate-200">${waterEscape(r.summary || r.action)}</div>
              ${errHtml}
            </div>`;
        }).join('');
      } catch (e) {
        feed.innerHTML = `<div class="p-4 text-rose-400">โหลด System Log ไม่สำเร็จ: ${waterEscape(e.message)}</div>`;
      }
    };

    let cachedHeatmapSlots = [];
    window.loadExecutionHeatmap = async function () {
      const grid = document.getElementById('executionHeatmapGrid');
      const dateInput = document.getElementById('heatmapDateInput');
      if (!grid) return;
      if (dateInput && !dateInput.value) {
        dateInput.value = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
      }
      const dateVal = dateInput ? dateInput.value : '';
      try {
        const res = await fetch('/api/system-logs/heatmap' + (dateVal ? `?date=${encodeURIComponent(dateVal)}` : ''));
        const data = await res.json();
        if (!data.success) return;

        cachedHeatmapSlots = data.slots || [];
        const c = data.counts || {};
        const summaryEl = document.getElementById('heatmapSummaryText');
        if (summaryEl) {
          summaryEl.textContent = `(สำเร็จ ${c.success || 0} | บางส่วน ${c.partial || 0} | ไม่สำเร็จ ${c.failed || 0} | ข้าม ${c.missed || 0})`;
        }

        const colorMap = {
          success: 'bg-emerald-600/90 hover:bg-emerald-500 text-white border-emerald-400/50',
          partial: 'bg-amber-500/90 hover:bg-amber-400 text-slate-950 border-amber-300/60',
          failed:  'bg-rose-600/90 hover:bg-rose-500 text-white border-rose-400/60',
          missed:  'bg-slate-700/80 hover:bg-slate-600 text-slate-300 border-slate-500/50',
          pending: 'bg-slate-900 hover:bg-slate-800 text-slate-500 border-slate-800'
        };

        grid.innerHTML = cachedHeatmapSlots.map(sl => {
          const cls = colorMap[sl.status] || colorMap.pending;
          return `<button onclick="selectHeatmapSlot('${waterEscape(sl.slot)}')" title="${waterEscape(sl.slot + ' — ' + sl.summary)}" class="px-1 py-1 rounded border text-[10px] font-mono text-center transition-all ${cls}">${waterEscape(sl.slot)}</button>`;
        }).join('');
      } catch (e) {
        console.error('Heatmap error', e);
      }
    };

    window.selectHeatmapSlot = function (slotHm) {
      const box = document.getElementById('heatmapSlotDetail');
      const sl = cachedHeatmapSlots.find(s => s.slot === slotHm);
      if (!box || !sl) return;
      box.classList.remove('hidden');
      const modsHtml = (sl.modules || []).map(m => {
        const icon = m.status === 'success' ? '✅' : (m.status === 'failed' ? '❌' : '⚠️');
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 border border-slate-700 mr-1 mb-1">${icon} ${waterEscape(m.module)}: ${waterEscape(m.summary)}</span>`;
      }).join('');
      box.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-2 mb-1">
          <span class="font-bold text-slate-100">รอบเวลา ${waterEscape(sl.slot)} น. — สถานะ: ${waterEscape(sl.status)}</span>
          <span class="text-slate-400 font-mono">เริ่ม: ${waterEscape(sl.startedAt || '-')} | เสร็จ: ${waterEscape(sl.finishedAt || '-')} | รวม ${sl.rowCount || 0} แถว</span>
        </div>
        <div class="text-slate-300 mb-1">${waterEscape(sl.summary || '')}</div>
        ${modsHtml ? `<div class="flex flex-wrap pt-1">${modsHtml}</div>` : ''}
      `;
    };

    window.retryFailedModule = async function (moduleName, slotHm, btn) {
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ กำลังดึงซ้ำ...';
      }
      try {
        const res = await fetch('/api/system-logs/retry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ module: moduleName, slot: slotHm })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          alert(`ดึงซ้ำ [${moduleName}] ไม่สำเร็จ: ` + (data.error || 'Unknown error'));
        } else {
          alert(`✅ ${data.message}`);
        }
      } catch (e) {
        alert('เกิดข้อผิดพลาดระหว่าง Retry: ' + e.message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🔄 ดึงซ้ำเฉพาะงานนี้';
        }
        window.loadSystemLogs();
        window.loadExecutionHeatmap();
      }
    };

    window.exportSystemLogsCsv = async function () {
      try {
        const res = await fetch('/api/system-logs/export?' + getSysLogFilterQuery());
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `System_Audit_Logs_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setTimeout(() => { if (typeof window.loadSystemLogs === 'function') window.loadSystemLogs(); }, 600);
      } catch (e) {
        alert('ไม่สามารถส่งออก Audit CSV ได้: ' + e.message);
      }
    };

    window.loadTraffySessionStatus = async function () {
      const badge = document.getElementById('traffyAuthStatusBadge');
      if (!badge) return;
      try {
        const res = await fetch('/api/traffy/session-status');
        const data = await res.json();
        if (!data.success) return;
        const orgInput = document.getElementById('traffyOrgIdInput');
        if (orgInput && !orgInput.value && data.orgId) orgInput.value = data.orgId;
        const expBadge = (data.jwtInfo && data.jwtInfo.expAt)
          ? (data.jwtInfo.isExpired
              ? ` | ❌ Token หมดอายุแล้ว (${data.jwtInfo.expAt})`
              : ` | ⏳ เหลืออายุ ~${data.jwtInfo.remainingDays} วัน (หมด ${data.jwtInfo.expAt})`)
          : '';
        const authTxt = data.configured
          ? `✅ ตั้งค่า Traffy Token/Cookie แล้ว (${data.hasToken ? 'Bearer Token' : ''}${data.hasCookie ? (data.hasToken ? ' + Cookie' : 'Cookie ' + data.cookieLength + ' chars') : ''}${data.orgId ? ', Org: ' + data.orgId : ''}${expBadge})`
          : 'ℹ️ ใช้ Direct Public API อยู่ — หากล็อกอิน LINE ใน citydata.traffy.in.th สามารถวาง local_login_data / fondue_token ด้านล่างได้';
        badge.textContent = `${authTxt} | App Cookie: ${data.appSessionCookie} | ในฐานข้อมูล: ${data.dbCount || 0} เรื่อง`;
      } catch (e) {
        badge.textContent = 'ไม่สามารถตรวจสอบสถานะ Session ได้';
      }
    };

    window.saveTraffySessionConfig = async function (clearFlag) {
      const cookieVal = document.getElementById('traffyCookieInput')?.value.trim() || '';
      const tokenVal  = document.getElementById('traffyTokenInput')?.value.trim() || '';
      const orgVal    = document.getElementById('traffyOrgIdInput')?.value.trim() || '';
      if (!clearFlag && !cookieVal && !tokenVal && !orgVal) {
        alert('กรุณากรอก Bearer Token (fondue_token), Cookie หรือ Org ID ก่อนบันทึก');
        return;
      }
      try {
        const res = await fetch('/api/traffy/session-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clear: !!clearFlag, cookie: cookieVal, token: tokenVal, orgId: orgVal })
        });
        const data = await res.json();
        alert(data.message || (data.success ? 'บันทึกสำเร็จ' : 'ไม่สำเร็จ'));
        if (clearFlag) {
          if (document.getElementById('traffyCookieInput')) document.getElementById('traffyCookieInput').value = '';
          if (document.getElementById('traffyTokenInput')) document.getElementById('traffyTokenInput').value = '';
          if (document.getElementById('traffyOrgIdInput')) document.getElementById('traffyOrgIdInput').value = '';
        }
        window.loadTraffySessionStatus();
      } catch (e) {
        alert('เกิดข้อผิดพลาด: ' + e.message);
      }
    };

    window.testTraffyCookieAndSession = async function () {
      const btn = document.getElementById('testTraffySessionBtn');
      const box = document.getElementById('traffyDiagResult');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ กำลังทดสอบ...';
      }
      try {
        const res = await fetch('/api/traffy/test-session', { method: 'POST' });
        const d = await res.json();
        if (box) {
          box.classList.remove('hidden');
          const appOk = d.appSession?.ok ? '✅ ผ่าน' : '❌ ไม่ผ่าน';
          const tfAuth = d.traffyAuth?.statusLabel || 'ไม่ได้ตั้งค่า';
          const geo = d.publicApi?.geojson || {};
          const tl  = d.publicApi?.timeline || {};
          box.innerHTML = `
            <div class="font-bold text-slate-800 dark:text-slate-100">ผลการทดสอบเมื่อ ${waterEscape(d.testedAt || '')} (${((d.durationMs || 0)/1000).toFixed(2)} วิ)</div>
            <div>• <b>1. Internal App Session (${waterEscape(d.appSession?.cookieName || 'water_session_7000')}):</b> ${appOk} — ${waterEscape(d.appSession?.message || '')}</div>
            <div>• <b>2. Traffy Cookie / Token Session:</b> ${waterEscape(tfAuth)} ${d.traffyAuth?.jwtInfo?.expAt ? `(หมดอายุ ${waterEscape(d.traffyAuth.jwtInfo.expAt)})` : ''}</div>
            <div>• <b>3. Traffy Public GeoJSON API:</b> ${geo.ok ? `✅ HTTP ${geo.httpCode} (${geo.lampangCount} เรื่อง, ${geo.durationMs}ms)` : `❌ HTTP ${geo.httpCode || 0} (${waterEscape(geo.error || 'Timeout/502')})`}</div>
            <div>• <b>4. Traffy Timeline API &amp; Portal SPA:</b> Timeline ${tl.ok ? `✅ HTTP ${tl.httpCode}` : `⚠️ HTTP ${tl.httpCode || 0}`} | citydata.traffy.in.th ${d.publicApi?.citydataReachable ? '✅ เชื่อมต่อได้' : '⚠️ เข้าไม่ได้'}</div>
            <div class="text-indigo-600 dark:text-indigo-300 font-medium pt-1">สรุป: ${waterEscape(d.summary || '')}</div>
          `;
        }
        window.loadTraffySessionStatus();
      } catch (e) {
        if (box) {
          box.classList.remove('hidden');
          box.innerHTML = `<div class="text-rose-600">❌ ทดสอบไม่สำเร็จ: ${waterEscape(e.message)}</div>`;
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🧪 ทดสอบ Cookie & Session + API';
        }
      }
    };
