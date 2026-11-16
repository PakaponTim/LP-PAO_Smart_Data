const message = document.getElementById('message');
const labels = {water:'ระดับน้ำ',rainfall:'ฝน',drought:'อ่างเก็บน้ำ',pm25:'PM2.5',complaints:'เรื่องร้องเรียน'};
const states = {new:'ยังไม่รับทราบ',acknowledged:'รับทราบแล้ว',in_progress:'กำลังดำเนินการ',resolved:'คลี่คลายแล้ว',reopened:'เปิดติดตามอีกครั้ง'};
let writable = false;
const call = async (url,options) => { const response=await fetch(url,options); const body=await response.json(); if(!response.ok) throw new Error(body.error||'ทำรายการไม่สำเร็จ'); return body; };
const post = (url,body={}) => call(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const element = (tag,text) => {const node=document.createElement(tag);node.textContent=text;return node;};
const stamp = value => value ? new Date(value).toLocaleString('th-TH') : 'ไม่มีข้อมูล';
async function loadIncidents() {
  const {incidents}=await call('/api/incidents');const list=document.getElementById('incident-list');list.replaceChildren();
  if(!incidents.length) list.append(element('p','ยังไม่มีเหตุแจ้งเตือน'));
  for(const item of incidents){
    const card=element('article','');card.className='incident';card.append(element('h3',item.alert_title||item.station_name));card.append(element('p',`${stamp(item.created_at)} · ${states[item.status]} · ผู้รับผิดชอบ: ${item.owner||'ยังไม่ระบุ'}`));
    const form=document.createElement('form');const status=document.createElement('select');status.setAttribute('aria-label','สถานะเหตุ');
    for(const [value,label] of Object.entries(states)) if(value!=='new'){const option=element('option',label);option.value=value;status.append(option);}status.value=item.status==='new'?'acknowledged':item.status;
    const owner=document.createElement('input');owner.placeholder='ผู้รับผิดชอบ';owner.setAttribute('aria-label','ผู้รับผิดชอบ');owner.maxLength=100;owner.value=item.owner;
    const note=document.createElement('textarea');note.placeholder='บันทึกการดำเนินการ';note.setAttribute('aria-label','บันทึกการดำเนินการ');note.maxLength=2000;
    const button=element('button','บันทึก');button.disabled=!writable;form.append(status,owner,note,button);
    form.onsubmit=async event=>{event.preventDefault();button.disabled=true;try{await post(`/api/incidents/${item.id}`,{status:status.value,owner:owner.value,note:note.value});await loadIncidents();message.textContent='บันทึกสถานะแล้ว';}catch(error){message.textContent=error.message;button.disabled=!writable;}};
    const history=document.createElement('details');history.append(element('summary',`ประวัติ ${item.history.length} รายการ`));for(const event of item.history)history.append(element('p',`${stamp(event.at)} · ${event.actor} · ${states[event.to]} · ${event.note}`));
    card.append(form,history);list.append(card);
  }
}
async function loadQuality(){
  const result=await call('/api/data-quality?days=7');const list=document.getElementById('quality-list');list.replaceChildren();
  for(const item of result.stations){const row=document.createElement('tr');for(const value of [labels[item.kind],item.name,stamp(item.lastReceived),item.stale?'ข้อมูลเก่า':'มีข้อมูลล่าสุด',item.missingDates.join(', ')||(item.todayPending?'วันนี้ยังไม่รับข้อมูล':'ไม่พบวันที่ขาด')])row.append(element('td',value));list.append(row);}
}
async function loadJobs(){
  const result=await call('/api/operations/status');const backups=document.getElementById('backup-list');backups.replaceChildren();
  for(const item of result.backupJobs.slice().reverse())backups.append(element('p',`${labels[item.kind]} · ${item.status} · ${item.pendingRows} แถวรอ · ลอง ${item.attempts} ครั้ง${item.error?' · '+item.error:''}`));
  if(!result.backupJobs.length)backups.append(element('p','ไม่มีงานสำรอง'));
  const recovery=document.getElementById('recovery-list');recovery.replaceChildren();
  for(const item of result.recoveryJobs){const line=element('p',`${labels[item.kind]} · ${item.count} แถว · ${stamp(item.createdAt)} `);const button=element('button','ส่งเข้าฐานข้อมูลอีกครั้ง');button.disabled=!writable;button.onclick=async()=>{button.disabled=true;try{await post(`/api/operations/retry-ingest/${item.id}`);await loadJobs();}catch(error){message.textContent=error.message;button.disabled=!writable;}};line.append(button);recovery.append(line);}
  if(!result.recoveryJobs.length)recovery.append(element('p','ไม่มีข้อมูลรอกู้คืน'));
  document.getElementById('metrics').textContent=result.requests.map(item=>`${item.route}: เฉลี่ย ${item.avgMs} ms · p95 ${item.p95Ms} ms · ${item.count} ครั้ง`).join('\n');
}
for(const button of document.querySelectorAll('[data-tab]'))button.onclick=async()=>{for(const section of document.querySelectorAll('main>section'))section.hidden=section.id!==button.dataset.tab;try{await ({incidents:loadIncidents,quality:loadQuality,jobs:loadJobs}[button.dataset.tab])();}catch(error){message.textContent=error.message;}};
document.getElementById('refresh-quality').onclick=()=>loadQuality().catch(error=>{message.textContent=error.message;});
document.getElementById('retry-backups').onclick=async()=>{try{await post('/api/operations/retry-backups');await loadJobs();}catch(error){message.textContent=error.message;}};
window.waterSession.then(async user=>{writable=user.role!=='viewer';document.getElementById('retry-backups').disabled=!writable;try{await loadIncidents();}catch(error){message.textContent=error.message;}});
