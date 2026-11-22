// Timeline scrubber (year/month navigation on the right edge).
// Classic script sharing the page's global scope (see index.html for the load order).
'use strict';

// ── Timeline scrubber (year/month navigation) ────────────────────────────────
const $scrub = document.getElementById('scrubber');
const $scrubBubble = document.getElementById('sc-bubble');
let _scrubYears = [];

function buildScrubber() {
  _scrubYears = [...new Set(allGroups.map(g => g.date.slice(0, 4)))].sort().reverse();
  if (allGroups.length < 2) { $scrub.hidden = true; return; }
  const monthsByYear = {};   // year -> Set of months that actually have memories
  for (const g of allGroups)
    (monthsByYear[g.date.slice(0, 4)] || (monthsByYear[g.date.slice(0, 4)] = new Set())).add(+g.date.slice(5, 7));
  $scrub.innerHTML = _scrubYears.map(y => {
    const ms = monthsByYear[y] || new Set();
    const dots = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]   // Dec→Jan, newest at top
      .map(m => `<span class="sc-dot${ms.has(m) ? ' on' : ''}" data-y="${y}" data-m="${m}"></span>`).join('');
    return `<div class="sc-seg" data-year="${y}"><span class="sc-year">${y.slice(2)}</span><span class="sc-dots">${dots}</span></div>`;
  }).join('');
  $scrub.hidden = (currentView !== 'list');
  positionScrubber();
  requestAnimationFrame(() => $scrub.classList.add('ready'));
}

function positionScrubber() {
  // the content's inner bottom margin (phone: room under the floating dock) is not timeline
  const r = $scroll.getBoundingClientRect(), pad = parseFloat(getComputedStyle($scroll).paddingBottom) || 0;
  $scrub.style.top = r.top + 'px';
  $scrub.style.height = (r.height - pad) + 'px';
}

// ── Month targeting: hover/drag shows the exact month in the bubble, release
// jumps to it (nearest data if that month is empty).
let _scDots = [];                       // cached dot centers: [{cy, y, m}]

function _cacheDots() {
  _scDots = [...$scrub.querySelectorAll('.sc-dot')].map(el => {
    const r = el.getBoundingClientRect();
    return { cy: r.top + r.height / 2, y: el.dataset.y, m: +el.dataset.m };
  });
}
function _nearestDot(clientY) {
  let best = null, bd = Infinity;
  for (const d of _scDots) { const dd = Math.abs(d.cy - clientY); if (dd < bd) { bd = dd; best = d; } }
  return best;
}
// Only the single dot under the cursor (or at the current scroll position) is accent.
let _curDot = null;
function _setCur(y, m) {
  const el = $scrub.querySelector(`.sc-dot[data-y="${y}"][data-m="${m}"]`);
  if (el === _curDot) return;
  if (_curDot) _curDot.classList.remove('cur');
  _curDot = el;
  if (el) el.classList.add('cur');
}
function _scrubSyncScroll() {
  if ($scrub.hidden) return;
  const top = $scroll.getBoundingClientRect().top + 4;
  for (const dg of $main.querySelectorAll('.date-group')) {
    if (dg.getBoundingClientRect().bottom > top) {
      _setCur(dg.dataset.date.slice(0, 4), +dg.dataset.date.slice(5, 7));
      break;
    }
  }
}
// Nearest group to a (year, month) so an empty month still lands on real data.
function _groupForYM(y, m) {
  const target = (+y) * 12 + m;
  let best = null, bd = Infinity;
  for (const g of allGroups) {
    const d = Math.abs((+g.date.slice(0, 4)) * 12 + (+g.date.slice(5, 7)) - target);
    if (d < bd) { bd = d; best = g; }
  }
  return best;
}
function _scrubHover(clientY) {
  if (!_scDots.length) _cacheDots();
  const d = _nearestDot(clientY);
  if (!d) return;
  $scrubBubble.textContent = `${MONTHS_FR[d.m - 1]} ${d.y}`;
  $scrubBubble.style.top = clientY + 'px';
  $scrubBubble.classList.add('show');
  _setCur(d.y, d.m);
  return d;
}
function _scrubRest() {
  _scrubbing = false; $scrub.classList.remove('dragging');
  $scrubBubble.classList.remove('show');
  _scrubSyncScroll();                      // revert the accent dot to the current position
}

let _scrubbing = false, _scHoverRaf = 0;
$scrub.addEventListener('pointerenter', _cacheDots);
$scrub.addEventListener('pointerdown', e => {
  _scrubbing = true; $scrub.classList.add('dragging');
  $scrub.setPointerCapture(e.pointerId);
  _cacheDots(); _scrubHover(e.clientY);
});
$scrub.addEventListener('pointermove', e => {
  const y = e.clientY;
  if (_scHoverRaf) return;
  _scHoverRaf = requestAnimationFrame(() => { _scHoverRaf = 0; _scrubHover(y); });
});
$scrub.addEventListener('pointerup', e => {
  const d = _scDots.length ? _nearestDot(e.clientY) : null;
  _scrubRest();
  if (d) { const g = _groupForYM(d.y, d.m); if (g) scrollToDay(g.date); }
});
$scrub.addEventListener('pointercancel', _scrubRest);
$scrub.addEventListener('pointerleave', () => { if (!_scrubbing) _scrubRest(); });

// Passive: while the grid scrolls, keep the current month dot highlighted.
let _scrubRaf = 0;
$scroll.addEventListener('scroll', () => {
  if (_scrubRaf || $scrub.hidden) return;
  _scrubRaf = requestAnimationFrame(() => { _scrubRaf = 0; _scrubSyncScroll(); });
}, { passive: true });
