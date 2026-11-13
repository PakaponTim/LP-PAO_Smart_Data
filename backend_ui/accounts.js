const message = document.querySelector('#message');
async function call(url, options) { const response = await fetch(url, options); const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; }
async function load() {
  try {
    const [{ users }, { devices }] = await Promise.all([call('/api/auth/users'), call('/api/auth/devices')]);
    for (const [id, rows] of [['users', users], ['devices', devices]]) {
      const list = document.getElementById(id); list.replaceChildren();
      for (const row of rows) {
        const item = document.createElement('li'); item.textContent = id === 'users' ? `${row.username} — ${row.role}` : `${row.name} — ${row.revoked ? 'เพิกถอนแล้ว' : 'ใช้งานอยู่'} `;
        if (id === 'devices' && !row.revoked) {
          const button = document.createElement('button'); button.textContent = 'เพิกถอน';
          button.onclick = async () => { try { await call(`/api/auth/devices/${row.id}`, { method: 'DELETE' }); await load(); } catch (error) { message.textContent = error.message; } }; item.append(button);
        }
        list.append(item);
      }
    }
  } catch (error) { message.textContent = error.message; }
}
document.querySelector('#account').onsubmit = async event => {
  event.preventDefault(); const form = event.target;
  try { await call('/api/auth/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: form.username.value, password: form.password.value, role: form.role.value }) }); form.reset(); message.textContent = 'เพิ่มบัญชีแล้ว'; await load(); }
  catch (error) { message.textContent = error.message; }
};
load();
