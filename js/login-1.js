const form = document.getElementById('loginForm');
    const submitBtn = document.getElementById('submitBtn');
    const btnText = document.getElementById('btnText');
    const btnLoader = document.getElementById('btnLoader');
    const errorMessage = document.getElementById('errorMessage');
    
    // Toggle Password Visibility
    const togglePasswordBtn = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('password');
    const eyeIcon = document.getElementById('eyeIcon');
    
    togglePasswordBtn.addEventListener('click', () => {
      const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordInput.setAttribute('type', type);
      
      if (type === 'text') {
        eyeIcon.classList.remove('fa-eye');
        eyeIcon.classList.add('fa-eye-slash');
      } else {
        eyeIcon.classList.remove('fa-eye-slash');
        eyeIcon.classList.add('fa-eye');
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorMessage.classList.add('hidden'); submitBtn.disabled = true;
      btnText.textContent = 'กำลังตรวจสอบ...'; btnLoader.style.display = 'block';
      try {
        const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: document.getElementById('username').value, password: passwordInput.value }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'เข้าสู่ระบบไม่สำเร็จ');
        location.replace('/index.html');
      } catch (error) {
        errorMessage.textContent = error.message; errorMessage.classList.remove('hidden');
      } finally { submitBtn.disabled = false; btnText.textContent = 'เข้าสู่ระบบ'; btnLoader.style.display = 'none'; }
    });
    fetch('/api/auth/bootstrap-status').then(r => r.json()).then(data => {
      if (data.required) { errorMessage.textContent = 'ยังไม่มีบัญชีผู้ดูแล กรุณาเปิดลิงก์ตั้งค่าที่แสดงในหน้าต่างเซิร์ฟเวอร์'; errorMessage.classList.remove('hidden'); }
    });
