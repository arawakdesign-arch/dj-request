const menuBtn = document.getElementById('menuBtn');
const menuOverlay = document.getElementById('menuOverlay');
const menuClose = document.getElementById('menuClose');
const openMenu = () => { menuOverlay.classList.add('open'); document.body.style.overflow = 'hidden'; };
const closeMenu = () => { menuOverlay.classList.remove('open'); document.body.style.overflow = ''; };
menuBtn.addEventListener('click', openMenu);
menuClose.addEventListener('click', closeMenu);
menuOverlay.addEventListener('click', (e) => { if (e.target === menuOverlay) closeMenu(); });
document.querySelectorAll('[data-close]').forEach(a => a.addEventListener('click', closeMenu));
