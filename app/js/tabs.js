// Tab bar: switches between the list (Mes Souvenirs has a Souvenirs | Stats switch), map and chats views.
// Classic script sharing the page's global scope (see index.html for the load order).
'use strict';

// ── Tab indicator ────────────────────────────────────────────────────────────
const TAB_CAPTIONS = {
  memories: 'Tous tes souvenirs Snapchat, triés par jour, du plus récent au plus ancien.',
  chat:     'Les photos et vidéos échangées en conversation, rassemblées au même endroit.',
  map:      'Chaque souvenir replacé sur la carte, là où tu l’as vécu.',
  chats:    'Tes conversations comme dans Snapchat : photos, vidéos et vocaux à leur place, et leurs stats.',
  stats:    'Ta vie Snapchat en chiffres : photos, vidéos, lieux et calendrier d’activité.',
};
function updateTabCaption(tab) {
  const cap = document.getElementById('tab-caption');
  if (!cap) return;
  const view = tab.dataset.view;
  const key = view === 'map' ? 'map' : view === 'chats' ? 'chats'
    : (tab.dataset.source || 'memories') === 'memories' && !view && memView === 'stats' ? 'stats'
    : (tab.dataset.source || 'memories');
  cap.textContent = t(TAB_CAPTIONS[key] || '');
}

function initTabs() {
  // web demo: the Chats tab shows made-up conversations; hidden when the build has none
  // (a demo built from a real library never publishes its chats)
  if (DEMO) fetch(DEMO_BASE + '/chats.json', { method: 'HEAD' })
    .then(r => { if (!r.ok) throw 0; })
    .catch(() => document.querySelector('.tab[data-view="chats"]')?.remove());
  const tabs = document.querySelectorAll('.tab');
  const ind  = document.getElementById('tab-indicator');
  if (DEMO) document.getElementById('app').classList.add('demo');

  function move(tab, animate) {
    if (!animate) {
      ind.style.transition = 'none';
      requestAnimationFrame(() => { ind.style.transition = ''; });
    }
    ind.style.width     = tab.offsetWidth + 'px';
    ind.style.transform = `translateX(${tab.offsetLeft}px)`;
  }

  tabs.forEach(t => t.addEventListener('click', () => {
    const view = t.dataset.view || 'list';
    const nextSource = t.dataset.source || 'memories';
    if (t.classList.contains('active') && view === currentView && nextSource === currentSource) return;
    _scroll[currentView] = $scroll.scrollTop;   // remember where we were
    voiceStop();                                // a voice note doesn't follow you to another tab
    tabs.forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    move(t, true);
    updateTabCaption(t);
    currentView = view;
    if (view === 'map') {
      currentSource = nextSource;          // map media URLs resolve via currentSource
      showMapView();
      return;
    }
    if (view === 'chats') {
      currentSource = nextSource;          // chat media URLs (thumbnails, voice notes, lightbox)
      showChatsView();
      return;
    }
    if (nextSource === 'memories' && memView === 'stats') {   // Mes Souvenirs, back on its Stats view
      currentView = 'stats';
      currentSource = nextSource;
      showStatsView();
      $scroll.scrollTop = _scroll.stats || 0;   // restore (or top), not the list's stale offset
      return;
    }
    currentSource = nextSource;          // keep in sync like the map/chats/stats paths,
                                         // so showListView() shows the search bar for the right source
    showListView();
    $scroll.scrollTop = _scroll.list || 0;
    // Reload when the list isn't already showing this source. Compare against
    // what's actually rendered (listSource), not currentSource — the map/stats
    // tabs overwrite currentSource, which used to make this guard skip wrongly
    // and leave the previous source's media on screen.
    if (listSource !== nextSource) {
      $search.value = '';
      $search.placeholder = sourceSearchPh[currentSource] || $search.placeholder;
      load();
    }
  }));

  const active = document.querySelector('.tab.active');
  if (active) { requestAnimationFrame(() => move(active, false)); updateTabCaption(active); }
}
