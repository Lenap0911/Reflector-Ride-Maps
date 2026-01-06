// Manual toggle interaction
const manualPanel = document.getElementById('manualPanel');
const manualToggleBtn = document.getElementById('manualToggleBtn');
const manualCloseBtn = document.getElementById('manualCloseBtn');

manualToggleBtn.addEventListener('click', () => {
  manualPanel.classList.add('open');
});

manualCloseBtn.addEventListener('click', () => {
  manualPanel.classList.remove('open');
});
