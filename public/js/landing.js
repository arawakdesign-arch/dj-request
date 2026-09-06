const menuBtn = document.getElementById('menuBtn');
const menuOverlay = document.getElementById('menuOverlay');
const menuClose = document.getElementById('menuClose');
const menuPanel = menuOverlay.querySelector('.menu-panel');

function focusableMenuEls() {
  return [...menuPanel.querySelectorAll('a[href], button')].filter(el => el.offsetParent !== null);
}

const openMenu = () => {
  menuOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  menuBtn.setAttribute('aria-expanded', 'true');
  menuClose.focus();
};
const closeMenu = () => {
  menuOverlay.classList.remove('open');
  document.body.style.overflow = '';
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.focus();
};
menuBtn.addEventListener('click', openMenu);
menuClose.addEventListener('click', closeMenu);
menuOverlay.addEventListener('click', (e) => { if (e.target === menuOverlay) closeMenu(); });
document.querySelectorAll('[data-close]').forEach(a => a.addEventListener('click', closeMenu));

document.addEventListener('keydown', (e) => {
  if (!menuOverlay.classList.contains('open')) return;
  if (e.key === 'Escape') { closeMenu(); return; }
  // Piège le focus (Tab/Shift+Tab) à l'intérieur du menu tant qu'il est ouvert.
  if (e.key === 'Tab') {
    const els = focusableMenuEls();
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
