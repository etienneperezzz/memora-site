// Boot: refresh button, resize handling, language, first load.
// Classic script sharing the page's global scope (see index.html for the load order).
'use strict';

// ── Refresh button ────────────────────────────────────────────────────────────
document.getElementById('refresh-btn').addEventListener('click', async () => {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');
  try {
    if (currentView === 'chats') { CH.list = null; CH.conv = null; showChatsView(); return; }
    if (currentView === 'stats') {   // Mes Souvenirs → Stats: recompute the dashboard only
      if (!DEMO) await fetch('/api/refresh?source=memories');
      delete _mediaCache.memories;
      _statsLoaded = false; showStatsView(); return;
    }
    if (!DEMO) await fetch('/api/refresh?source=' + encodeURIComponent(currentSource));
    delete _mediaCache[currentSource];   // force a real refetch
    _tripsData = null;                   // trips may have changed
    await load();
  } finally {
    btn.classList.remove('spinning');
  }
});

// Column count/width change on resize → recompute reserved heights.
let _rzT = null;
window.addEventListener('resize', () => {
  clearTimeout(_rzT);
  _rzT = setTimeout(() => {
    if ($main.querySelector('.media-grid[data-gi]')) virtualize();
    if (!$scrub.hidden) positionScrubber();
  }, 200);
});

// ── Boot ─────────────────────────────────────────────────────────────────────
// Translate the static HTML tab labels + search placeholder (no-op when LANG=fr).
function applyLang() {
  if (LANG === 'fr') return;
  const lbl = { 0: 'Mes Souvenirs', 2: 'Carte' };   // keep Chat Media + Rétro as-is
  document.querySelectorAll('.tab[data-tab]').forEach(tab => {
    const k = lbl[tab.dataset.tab];
    if (k) tab.textContent = t(k);
  });
  $search.placeholder = sourceSearchPh[currentSource] || $search.placeholder;
  document.documentElement.lang = LANG;
}
applyLang();
initTabs();
setupDelegation();
syncSearchBar();   // hidden on the default (memories) tab; shows on Chat Media
load();
