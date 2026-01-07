/*
 * Basic Count Up from Date and Time
 * Author: @mrwigster / https://guwii.com/bytes/count-date-time-javascript/
 * Modified: @leonardwongly
 */
const updateCountUp = (countFrom, id) => {
  const now = new Date();
  const diff = now - new Date(countFrom);

  const msYear = 31536000000;
  const msMonth = 2592000000;
  const msDay = 86400000;

  const year = Math.floor(diff / msYear);
  const month = Math.floor((diff % msYear) / msMonth);
  const day = Math.floor(((diff % msYear) % msMonth) / msDay);

  const idEl = document.getElementById(id);
  if (!idEl) {
    return;
  }

  const yearsEl = idEl.getElementsByClassName('years')[0];
  const monthsEl = idEl.getElementsByClassName('months')[0];
  const daysEl = idEl.getElementsByClassName('days')[0];

  if (yearsEl) {
    yearsEl.textContent = String(year);
  }
  if (monthsEl) {
    monthsEl.textContent = String(month);
  }
  if (daysEl) {
    daysEl.textContent = String(day);
  }
};

const startCountUp = (countFrom, id) => {
  updateCountUp(countFrom, id);
  setTimeout(() => startCountUp(countFrom, id), 1000);
};

window.addEventListener('load', () => {
  startCountUp('Jan 4, 2022 00:00:00', 'countUpJob');
  startCountUp('Dec 1, 2020 00:00:00', 'countUpProject');
});
