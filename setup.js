const bootstrapToken = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
document.querySelector('#setup').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target; const message = document.querySelector('#message');
  if (form.password.value !== form.confirm.value) { message.textContent = 'รหัสผ่านไม่ตรงกัน'; return; }
  try {
    const response = await fetch('/api/auth/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bootstrap-Token': bootstrapToken }, body: JSON.stringify({ username: form.username.value, password: form.password.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    location.replace('/login.html');
  } catch (error) { message.textContent = error.message; }
});
