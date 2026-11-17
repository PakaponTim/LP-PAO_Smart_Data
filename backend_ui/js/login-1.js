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

    const urlParams = new URLSearchParams(location.search);
    const ALLOWED_NEXT = new Set(['index.html', 'control.html', 'notification.html', 'operations.html', 'accounts.html', 'db_compare.html', 'mobile.html', 'server_setup.php']);
    const reqNext = (urlParams.get('next') || 'index.html').replace(/^\.?\//, '');
    const nextUrl = './' + (ALLOWED_NEXT.has(reqNext) ? reqNext : 'index.html');
    const reauthBadge = document.getElementById('adminReauthBadge');
    if (reauthBadge && urlParams.get('reauth') === '1') {
      reauthBadge.classList.remove('hidden');
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorMessage.classList.add('hidden'); submitBtn.disabled = true;
      btnText.textContent = 'กำลังตรวจสอบ...'; btnLoader.style.display = 'block';
      try {
        const rememberEl = document.getElementById('remember');
        const response = await fetch('./endpoint.php?r=/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: document.getElementById('username').value,
            password: passwordInput.value,
            remember: rememberEl ? !!rememberEl.checked : true,
            strictCheck: true,
            adminOnly: true
          })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'เข้าสู่ระบบไม่สำเร็จ');
        location.replace(nextUrl);
      } catch (error) {
        errorMessage.textContent = error.message; errorMessage.classList.remove('hidden');
      } finally { submitBtn.disabled = false; btnText.textContent = 'เข้าสู่ระบบ'; btnLoader.style.display = 'none'; }
    });
    fetch('./endpoint.php?r=/api/auth/bootstrap-status').then(r => r.json()).then(data => {
      if (data.required) { errorMessage.textContent = 'ยังไม่มีบัญชีผู้ดูแล กรุณาเปิดลิงก์ตั้งค่าที่แสดงในหน้าต่างเซิร์ฟเวอร์'; errorMessage.classList.remove('hidden'); }
    });
