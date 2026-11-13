import './style.css'

document.addEventListener('DOMContentLoaded', () => {
  // Mobile sidebar toggle logic
  const mobileMenuButton = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('sidebar');

  if (mobileMenuButton && sidebar) {
    mobileMenuButton.addEventListener('click', () => {
      sidebar.classList.toggle('-translate-x-full');
    });
  }
});
