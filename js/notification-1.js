const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","\'":"&#39;"}[c]));
    const API = window.location.origin;

    // ============================================================
    // UTILS
    // ============================================================
    function showToast(msg, type = 'info') {
      const tc = document.getElementById('toast-container');
      const el = document.createElement('div');
      el.className = `toast ${type}`;
      el.innerHTML = msg;
      tc.appendChild(el);
      setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.4s'; setTimeout(() => el.remove(), 400); }, 4000);
    }

    const levelBadgeMap = {
      info: '<span class="badge badge-info">ℹ️ INFO</span>',
      warning: '<span class="badge badge-warning">⚠️ WARNING</span>',
      critical: '<span class="badge badge-critical">🚨 CRITICAL</span>'
    };
    const statusBadgeMap = {
      sent: '<span class="badge badge-sent">✅ ส่งแล้ว</span>',
      failed: '<span class="badge badge-failed">❌ ล้มเหลว</span>',
      skipped: '<span class="badge badge-skipped">⏭️ ข้าม</span>'
    };
    const typeIconMap = { water: '🌊', rainfall: '🌧️', drought: '🏜️', pm25: '💨', complaints: '📢' };
    const avatarColors = ['#6366f1','#8b5cf6','#ec4899','#14b8a6','#f97316','#0ea5e9','#84cc16'];
    function getInitials(name) {
      return name ? name.slice(0, 1).toUpperCase() : '?';
    }
    function getAvatarColor(id) { return avatarColors[id % avatarColors.length]; }

    // ============================================================
    // LOAD STATS
    // ============================================================
    async function loadStats() {
      try {
        const res = await fetch(`${API}/api/notifications/stats`);
        const d = await res.json();
        if (d.success) {
          document.getElementById('statTotalToday').textContent = d.stats.today?.total ?? 0;
          document.getElementById('statCritical').textContent = d.stats.today?.critical ?? 0;
          document.getElementById('statWarning').textContent = d.stats.today?.warning ?? 0;
          document.getElementById('statSent').textContent = d.stats.today?.sent ?? 0;
          document.getElementById('statMonthly').textContent = d.stats.month?.total ?? 0;
        }
      } catch(e) { console.error('stats:', e); }
    }

    // ============================================================
    // LOAD CONFIG & SMTP STATUS
    // ============================================================
    async function loadConfig() {
      try {
        const res = await fetch(`${API}/api/notifications/config`);
        const d = await res.json();
        if (!d.success) return;
        const cfg = d.config;
        const aa = cfg.alertActive || {};
        ['water','drought','pm25','complaints'].forEach(k => {
          const el = document.getElementById('toggle-' + k);
          if (el) el.checked = aa[k] !== false;
        });
        // SMTP status
        const panel = document.getElementById('smtpPanel');
        const dot = document.getElementById('smtpStatusDot');
        const txt = document.getElementById('smtpStatusText');
        const badge = document.getElementById('systemStatusBadge');
        if (cfg.smtp?.user && cfg.smtp?.pass && cfg.smtp.pass !== '________') {
          panel.className = 'smtp-panel configured';
          dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block';
          txt.textContent = `ส่งจาก: ${cfg.smtp.user}`;
          badge.innerHTML = '🟢 ระบบพร้อมส่ง Email';
          document.getElementById('smtpUserInput').value = cfg.smtp.user || '';
        } else {
          panel.className = 'smtp-panel not-configured';
          dot.className = 'w-2.5 h-2.5 rounded-full bg-red-400 inline-block';
          txt.textContent = 'ยังไม่ได้ตั้งค่า SMTP — กรอก Gmail + App Password';
          badge.innerHTML = '🔴 ยังไม่พร้อมส่ง Email';
        }
        // LINE status
        const lineDot = document.getElementById('lineStatusDot');
        const lineTxt = document.getElementById('lineStatusText');
        const lineTarget = document.getElementById('lineTargetInput');
        if (lineDot && lineTxt) {
          if (cfg.line?.configured) {
            lineDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block';
            lineTxt.textContent = `🟢 เชื่อมต่อ LINE แล้ว (Target: ${cfg.line.targetId || ''})`;
            if (lineTarget && cfg.line.targetId) lineTarget.value = cfg.line.targetId;
          } else {
            lineDot.className = 'w-2.5 h-2.5 rounded-full bg-slate-300 inline-block';
          }
        }
      } catch(e) { console.error('config:', e); }
    }

    // ============================================================
    // SAVE LINE VIA API
    // ============================================================
    async function saveLINE() {
      const channelToken = (document.getElementById('lineTokenInput')?.value || '').trim();
      const targetId = (document.getElementById('lineTargetInput')?.value || '').trim();
      if (!channelToken || !targetId) { showToast('⚠️ กรุณากรอก LINE Channel Access Token และ Target/Group ID', 'warning'); return; }
      try {
        const res = await fetch(`${API}/api/notifications/line`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelToken, targetId })
        });
        const d = await res.json();
        if (d.success) {
          showToast('✅ บันทึกการตั้งค่า LINE สำเร็จ', 'success');
          if (document.getElementById('lineTokenInput')) document.getElementById('lineTokenInput').value = '';
          loadConfig();
        } else { showToast(`❌ ${d.error}`, 'error'); }
      } catch(e) { showToast('❌ ไม่สามารถเชื่อมต่อ server', 'error'); }
    }

    // ============================================================
    // SAVE SMTP VIA API
    // ============================================================
    async function saveSMTP() {
      const user = document.getElementById('smtpUserInput').value.trim();
      const rawPass = document.getElementById('smtpPassInput').value;
      const pass = rawPass.replace(/\s+/g, ''); // Remove spaces from App Password
      if (!user || !pass) { showToast('⚠️ กรุณากรอก Gmail และ App Password (16 ตัวอักษร)', 'warning'); return; }
      try {
        const res = await fetch(`${API}/api/notifications/smtp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user, pass })
        });
        const d = await res.json();
        if (d.success) {
          showToast('✅ บันทึก SMTP สำเร็จ (นำเว้นวรรคออกให้อัตโนมัติแล้ว)', 'success');
          document.getElementById('smtpPassInput').value = '';
          loadConfig();
        } else { showToast(`❌ ${d.error}`, 'error'); }
      } catch(e) { showToast('❌ ไม่สามารถเชื่อมต่อ server', 'error'); }
    }


    // ============================================================
    // LOAD RECIPIENTS
    // ============================================================
    async function loadRecipients() {
      try {
        const res = await fetch(`${API}/api/notifications/recipients`);
        const d = await res.json();
        if (d.success) renderRecipients(d.recipients);
      } catch(e) { console.error('recipients:', e); }
    }

    window._recipientsMap = new Map();

    function renderRecipients(list) {
      const tbody = document.getElementById('recipientsBody');
      if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-10 text-slate-400">ยังไม่มีผู้รับ — กด "+ เพิ่มผู้รับ"</td></tr>';
        return;
      }
      window._recipientsMap.clear();
      tbody.innerHTML = list.map(r => {
        window._recipientsMap.set(r.id, r);
        const domains = [r.notify_water?'🌊':'',r.notify_drought?'🏜️':'',r.notify_pm25?'💨':'',r.notify_complaints?'📢':''].filter(Boolean).join(' ');
        const bg = getAvatarColor(r.id);
        return `<tr>
          <td>
            <label class="toggle-wrap" style="display:inline-block;">
              <input type="checkbox" ${r.is_active?'checked':''} onchange="toggleRecipient(${r.id},this.checked)">
              <div class="toggle-track"></div>
              <div class="toggle-thumb" style="transition:all 0.3s;transform:${r.is_active?'translateX(22px)':'translateX(0)'}"></div>
            </label>
          </td>
          <td>
            <div class="flex items-center gap-2.5">
              <div class="avatar" style="background:${bg};">${escapeHtml(getInitials(r.name))}</div>
              <span class="font-semibold text-slate-700 text-sm">${escapeHtml(r.name)}</span>
            </div>
          </td>
          <td class="hidden md:table-cell text-slate-500 text-xs">${escapeHtml(r.position)}</td>
          <td><code class="text-xs text-slate-600 bg-slate-50 px-2 py-1 rounded-md">${escapeHtml(r.email)}</code></td>
          <td class="text-center">${levelBadgeMap[r.alert_level_min]||''}</td>
          <td class="text-center hidden lg:table-cell text-sm">${domains||'—'}</td>
          <td class="text-center">
            <div class="flex items-center justify-center gap-1">
              <button onclick="editRecipientById(${r.id})" class="btn-small-blue" title="แก้ไข">✏️</button>
              <button onclick="deleteRecipient(${r.id})" class="btn-small-red" title="ลบ">🗑️</button>
            </div>
          </td>
        </tr>`;
      }).join('');
    }

    // ============================================================
    // LOAD HISTORY
    // ============================================================
    async function loadHistory() {
      try {
        const res = await fetch(`${API}/api/notifications?limit=50`);
        const d = await res.json();
        if (d.success) renderHistory(d.notifications);
      } catch(e) { console.error('history:', e); }
    }

    function renderHistory(list) {
      const tbody = document.getElementById('historyBody');
      if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-10 text-slate-400">ยังไม่มีประวัติการแจ้งเตือน</td></tr>';
        return;
      }
      tbody.innerHTML = list.map(n => {
        const dt = new Date(n.created_at);
        const ts = dt.toLocaleString('th-TH', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
        return `<tr>
          <td class="text-xs text-slate-400 whitespace-nowrap">${ts}</td>
          <td class="text-center">${levelBadgeMap[n.alert_level]||''}</td>
          <td class="text-base">${typeIconMap[n.alert_type]||n.alert_type}</td>
          <td class="text-xs text-slate-700 max-w-[260px] truncate" title="${escapeHtml(n.alert_title)}">${escapeHtml(n.alert_title)}</td>
          <td class="text-center">${statusBadgeMap[n.email_status]||''}</td>
        </tr>`;
      }).join('');
    }

    // ============================================================
    // ACTIONS
    // ============================================================
    async function toggleAlertType(type, active) {
      try {
        await fetch(`${API}/api/notifications/toggle`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({type, active}) });
        showToast(`${active?'✅ เปิด':'⏸️ ปิด'}การแจ้งเตือน: ${type}`, active?'success':'info');
      } catch(e) { showToast('❌ เกิดข้อผิดพลาด', 'error'); }
    }

    async function checkNow() {
      showToast('🔍 กำลังตรวจสอบเกณฑ์...', 'info');
      try {
        const res = await fetch(`${API}/api/notifications/check-now`, { method:'POST' });
        const d = await res.json();
        if (d.success) {
          const r = d.result;
          showToast(`🔔 ตรวจเสร็จ: พบ ${r.totalAlerts} รายการ | ส่ง ${r.sentEmails} | ข้าม ${r.skipped}`, r.sentEmails>0?'success':'info');
          loadStats(); loadHistory();
        } else { showToast(`⚠️ ${d.error||'เกิดข้อผิดพลาด'}`, 'error'); }
      } catch(e) { showToast('❌ ไม่สามารถเชื่อมต่อ server', 'error'); }
    }

    async function sendTestEmail() {
      showToast('📧 กำลังส่ง test email...', 'info');
      try {
        const res = await fetch(`${API}/api/notifications/test`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({}) });
        const d = await res.json();
        if (d.success) { showToast(`✅ ส่ง test email สำเร็จ → ${d.sentTo}`, 'success'); loadHistory(); }
        else { showToast(`❌ ส่งล้มเหลว: ${d.error}`, 'error'); }
      } catch(e) { showToast('❌ ไม่สามารถเชื่อมต่อ server', 'error'); }
    }

    async function toggleRecipient(id, active) {
      try {
        const res = await fetch(`${API}/api/notifications/recipients`, { 
          method:'POST', 
          headers:{'Content-Type':'application/json'}, 
          body: JSON.stringify({id, is_active: active ? 1 : 0}) 
        });
        const d = await res.json();
        if (d.success) {
          showToast(active ? '✅ เปิดการแจ้งเตือนผู้รับท่านนี้แล้ว' : '⏸️ ปิดการแจ้งเตือนผู้รับท่านนี้แล้ว', active ? 'success' : 'info');
        } else {
          showToast(`❌ ${d.error || 'เกิดข้อผิดพลาด'}`, 'error');
          loadRecipients(); // reload to reset toggle state
        }
      } catch(e) {
        showToast('❌ ไม่สามารถบันทึกสถานะได้', 'error');
        loadRecipients();
      }
    }


    async function deleteRecipient(id) {
      if (!confirm('ต้องการลบผู้รับแจ้งเตือนนี้?')) return;
      const res = await fetch(`${API}/api/notifications/recipients/${id}`, { method:'DELETE' });
      const d = await res.json();
      if (d.success) { showToast('🗑️ ลบเรียบร้อย', 'success'); loadRecipients(); }
    }

    // ============================================================
    // MODAL
    // ============================================================
    function showAddModal() {
      document.getElementById('modalTitle').textContent = 'เพิ่มผู้รับแจ้งเตือน';
      document.getElementById('editId').value = '';
      ['inputName','inputPosition','inputEmail'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('inputLevel').value = 'warning';
      ['chkWater','chkDrought','chkPM25','chkComplaints'].forEach(id => document.getElementById(id).checked = true);
      document.getElementById('recipientModal').style.display = 'flex';
    }

    function editRecipientById(id) {
      const r = window._recipientsMap.get(id);
      if (r) editRecipient(r);
    }
    window.editRecipientById = editRecipientById;

    function editRecipient(r) {
      document.getElementById('modalTitle').textContent = 'แก้ไขผู้รับแจ้งเตือน';
      document.getElementById('editId').value = r.id;
      document.getElementById('inputName').value = r.name;
      document.getElementById('inputPosition').value = r.position;
      document.getElementById('inputEmail').value = r.email;
      document.getElementById('inputLevel').value = r.alert_level_min;
      document.getElementById('chkWater').checked = !!r.notify_water;
      document.getElementById('chkDrought').checked = !!r.notify_drought;
      document.getElementById('chkPM25').checked = !!r.notify_pm25;
      document.getElementById('chkComplaints').checked = !!r.notify_complaints;
      document.getElementById('recipientModal').style.display = 'flex';
    }

    function closeModal() { document.getElementById('recipientModal').style.display = 'none'; }

    async function saveRecipient() {
      const id = document.getElementById('editId').value;
      const payload = {
        name: document.getElementById('inputName').value.trim(),
        position: document.getElementById('inputPosition').value.trim(),
        email: document.getElementById('inputEmail').value.trim(),
        alert_level_min: document.getElementById('inputLevel').value,
        notify_water: document.getElementById('chkWater').checked ? 1 : 0,
        notify_drought: document.getElementById('chkDrought').checked ? 1 : 0,
        notify_pm25: document.getElementById('chkPM25').checked ? 1 : 0,
        notify_complaints: document.getElementById('chkComplaints').checked ? 1 : 0,
        is_active: 1
      };
      if (!payload.name || !payload.email) { showToast('⚠️ กรุณากรอกชื่อและ E-mail', 'warning'); return; }
      if (id) payload.id = parseInt(id);
      const res = await fetch(`${API}/api/notifications/recipients`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      const d = await res.json();
      if (d.success) { showToast(id?'✅ แก้ไขเรียบร้อย':'✅ เพิ่มผู้รับเรียบร้อย', 'success'); closeModal(); loadRecipients(); }
      else { showToast(`❌ ${d.error}`, 'error'); }
    }

    // ============================================================
    // LOAD ALL
    // ============================================================
    function loadAll() { loadStats(); loadConfig(); loadRecipients(); loadHistory(); }
    window.loadAll = loadAll;

    document.addEventListener('DOMContentLoaded', () => {
      loadAll();
      setInterval(() => { loadStats(); loadHistory(); }, 60000);
    });
