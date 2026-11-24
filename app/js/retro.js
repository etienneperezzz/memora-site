// Stats of Mes Souvenirs (formerly the Rétro tab), and jumps from it into the grid.
// Classic script sharing the page's global scope (see index.html for the load order).
'use strict';

// ── Stats dashboard ──────────────────────────────────────────────────────────
function showStatsView() {
  document.getElementById('main-content').style.display = 'none';
  $mapView.style.cssText = 'display:none';
  $chatsView.style.display = 'none';
  document.querySelector('.search-wrap').style.display = 'none';
  $souv.style.display = 'none';
  $scrub.hidden = true;
  $statsView.style.display = 'block';
  syncMemSeg();
  if (!_statsLoaded) { _statsLoaded = true; loadStats(); }
}

// Souvenirs | Stats switch at the top of Mes Souvenirs.
function setMemView(v) {
  if (v === memView && currentView === v) return;
  _scroll[currentView] = $scroll.scrollTop;
  memView = v;
  currentView = v;
  const tab = document.querySelector('.tab[data-tab="0"]');
  if (tab) updateTabCaption(tab);
  if (v === 'stats') {
    showStatsView();
    $scroll.scrollTop = _scroll.stats || 0;
    return;
  }
  showListView();
  $scroll.scrollTop = _scroll.list || 0;
  if (listSource !== 'memories') load();
}
document.getElementById('mem-seg')?.addEventListener('click', e => {
  const b = e.target.closest('[data-memview]');
  if (b) setMemView(b.dataset.memview);
});


// sequential purple ramp (dark surface → brighter = more)
const CAL_STEPS = ['#ffffff0d', '#3a2a5c', '#5a3f9e', '#7c5fd0', '#a989f5', '#d4bbff'];
function calBucket(n) {
  if (!n) return 0;
  if (n <= 2) return 1; if (n <= 5) return 2; if (n <= 10) return 3; if (n <= 20) return 4; return 5;
}

async function loadStats() {
  $statsView.innerHTML = `<div class="state-view"><div class="spinner"></div><span>${t('Calcul des statistiques… (première fois, ~1 min)')}</span></div>`;
  try {
    renderStats(await getJSON('/api/stats?source=memories', 'stats_memories.json'));
  } catch (e) {
    $statsView.innerHTML = `<div class="state-view"><span>Erreur : ${esc(e.message)}</span></div>`;
  }
}


// "Ton Snapchat en chiffres": the account summary of the export (user_profile.json), kept by the import
const RT_EVENTS = {   // the most telling counts, in this order
  'Application Opens': 'ouvertures de l’app', 'Snap Sends': 'snaps envoyés', 'Snap Views': 'snaps vus',
  'Chats Sent': 'messages envoyés', 'Chats Viewed': 'messages lus', 'Story Views': 'stories vues',
  'Direct Snaps Created': 'snaps directs créés', 'Discover Snap Views': 'snaps Discover vus',
};
const RT_PARTS = { Camera: 'Caméra', Messaging: 'Messages', Discover: 'Discover', Map: 'Carte',
                   Memories: 'Souvenirs', Profile: 'Profil', Others: 'Autres' };

// A feature of the Essentiel plan seen from the free plan (the server sent no data): what it holds,
// a lock, and the button of the plans window.
const LOCK_SVG = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M7.5 10.5V7.5a4.5 4.5 0 0 1 9 0v3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><rect x="4.5" y="10.5" width="15" height="10.5" rx="3" fill="currentColor"/></svg>';
function lockHTML(what) {
  return `<div class="rt-lock">${LOCK_SVG}<b>Réservé au forfait Essentiel</b><span>${what}</span>
    <button type="button" class="rt-lock-btn">Débloquer</button></div>`;
}
document.addEventListener('click', e => {
  if (e.target.closest('.rt-lock-btn')) document.getElementById('lic-unlock')?.click();
});

function profileHTML(p) {
  if (!p) return '';
  if (p.locked) return `<div class="rt-sec">Ton Snapchat en chiffres</div>
    ${lockHTML('Depuis quand tu es sur Snapchat, combien de snaps et de messages tu as envoyés, où passe ton temps dans l’app.')}`;
  const n = new Map(p.engagement || []);
  const tiles = Object.entries(RT_EVENTS).filter(([e]) => n.get(e) > 0).slice(0, 8).map(([e, l]) =>
    `<div class="rt-tile"><div class="n">${n.get(e).toLocaleString(LOCALE)}</div><div class="l">${l}</div></div>`).join('');
  const parts = (p.timeSpent || []).filter(([, v]) => v > 0);
  const pmax = Math.max(1, ...parts.map(([, v]) => v));
  const bars = parts.map(([k, v]) =>
    `<div class="rt-place"><span class="nm">${esc(RT_PARTS[k] || k)}</span>
      <span class="track"><span class="fill" style="width:${Math.round(v / pmax * 100)}%"></span></span>
      <span class="v">${v.toLocaleString(LOCALE, { maximumFractionDigits: v < 10 ? 1 : 0 })}&nbsp;%</span></div>`).join('');
  if (!p.since && !tiles && !bars) return '';
  return `<div class="rt-sec">Ton Snapchat en chiffres</div>
    ${p.since ? `<div class="rt-hero rt-since"><div class="big">Sur Snapchat depuis ${p.since.slice(0, 4)}</div>
      <div class="sub">${fmtAge(p.since + 'T12:00:00')}</div></div>` : ''}
    ${tiles ? `<div class="rt-tiles">${tiles}</div>` : ''}
    ${bars ? `<div class="rt-sec">Temps passé dans l’app</div>${bars}` : ''}`;
}

function renderStats(s) {
  const profile = profileHTML(s.profile);
  if (!s.total) {   // no memories yet (e.g. an export with only the chat history)
    $statsView.innerHTML = profile ? profile + `<p class="rt-note">Pas encore de souvenirs à résumer ici.
      Ajoute un export qui contient tes souvenirs avec le bouton +.</p>`
      : `<div class="state-view" style="text-align:center;padding:0 24px">
      <span>Pas encore de souvenirs à résumer ici.<br>Ajoute un export qui contient tes souvenirs avec le bouton +.</span></div>`;
    return;
  }
  const h = Math.floor(s.videoSeconds / 3600), m = Math.round((s.videoSeconds % 3600) / 60);
  const vidTime = h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;

  // year bars
  const years = Object.keys(s.perYear);
  const ymax = Math.max(1, ...Object.values(s.perYear));
  const yearBars = years.map(y => {
    const n = s.perYear[y];
    return `<div class="col" data-year="${y}">
      <div class="nv">${n.toLocaleString(LOCALE)}</div>
      <div class="bar" style="height:${Math.round(n / ymax * 110)}px"></div>
      <div class="xl">${y.slice(2)}</div></div>`;
  }).join('');

  // month bars (seasonality)
  const mmax = Math.max(1, ...s.perMonth);
  const monthBars = s.perMonth.map((n, i) =>
    `<div class="col" title="${['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'][i]} · ${n}">
      <div class="bar" style="height:${Math.round(n / mmax * 64)}px"></div>
      <div class="xl">${MONTHS3[i]}</div></div>`).join('');

  // calendar heatmap, one block per year
  const cal = years.slice().reverse().map(y => {
    const start = new Date(y + '-01-01T12:00:00'), end = new Date(y + '-12-31T12:00:00');
    const pad = start.getDay();                 // leading blanks (Sun=0)
    let cells = '';
    for (let i = 0; i < pad; i++) cells += `<div class="cell" style="visibility:hidden"></div>`;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const n = s.perDay[iso] || 0;
      const hit = n > 0 ? ` hit" data-date="${iso}` : '';
      cells += `<div class="cell${hit}" style="background:${CAL_STEPS[calBucket(n)]}" title="${fmtFR(iso)} · ${n} souvenir${n > 1 ? 's' : ''}"></div>`;
    }
    return `<div class="rt-cal-year"><div class="yl">${y}</div><div class="rt-cal">${cells}</div></div>`;
  }).join('');
  const legend = `<div class="rt-legend"><span>moins</span>${CAL_STEPS.map(c => `<span class="cell" style="background:${c}"></span>`).join('')}<span>plus</span></div>`;

  // top places
  const pmax = Math.max(1, ...s.topPlaces.map(p => p.n));
  const places = s.topPlaces.map(p =>
    `<div class="rt-place"><span class="flag">${flagEmoji(p.cc)}</span>
      <span class="nm">${esc(p.city)}</span>
      <span class="track"><span class="fill" style="width:${Math.round(p.n / pmax * 100)}%"></span></span>
      <span class="v">${p.n}</span></div>`).join('');

  $statsView.innerHTML = `
    <div class="rt-hero">
      <div class="big">${s.total.toLocaleString(LOCALE)}</div>
      <div class="sub">${t('souvenirs')} · ${fmtFR(s.first)} → ${fmtFR(s.last)}</div>
      <div class="sub">${tf('{c} pays · {v} villes', { c: s.countries, v: s.cities })}</div>
    </div>
    <div class="rt-tiles">
      <div class="rt-tile"><div class="n">${s.photos.toLocaleString(LOCALE)}</div><div class="l">${t('Photos')}</div></div>
      <div class="rt-tile"><div class="n">${s.videos.toLocaleString(LOCALE)}</div><div class="l">${t('Vidéos')}</div></div>
      <div class="rt-tile"><div class="n">${vidTime}</div><div class="l">${t('Temps vidéo')}</div></div>
      <div class="rt-tile"><div class="n">${s.countries}</div><div class="l">${t('Pays')}</div></div>
    </div>
    <div class="rt-sec">${t('Par année')}</div>
    <div class="rt-bars" id="rt-years">${yearBars}</div>
    <div class="rt-sec">${t('Saisonnalité (par mois, toutes années)')}</div>
    <div class="rt-months">${monthBars}</div>
    <div class="rt-sec">${t("Calendrier d'activité")}</div>
    ${legend}${cal}
    <div class="rt-sec">${t('Top lieux')}</div>
    ${places}
    <div class="rt-sec">${t('Records')}</div>
    <div class="sub" style="color:#bbb;font-size:13px;line-height:1.7">
      ${t('Jour le plus actif :')} <b>${fmtFR(s.busiestDay.date)}</b> (${s.busiestDay.n} ${t('souvenirs')})<br>
      ${t('Année record :')} <b>${s.busiestYear.year}</b> (${s.busiestYear.n} ${t('souvenirs')})
    </div>
    ${profile}`;

  // click a year bar → jump to that year in the gallery
  $statsView.querySelectorAll('#rt-years .col').forEach(col =>
    col.addEventListener('click', () => goToYear(col.dataset.year)));

  // click a calendar day (with memories) → jump to that exact day in the gallery
  $statsView.querySelectorAll('.rt-cal .cell.hit').forEach(cell =>
    cell.addEventListener('click', () => goToDay(cell.dataset.date)));
}

// Scroll the (already-rendered, virtualized) list to a day-group. The group div
// always exists with a reserved height, so the jump lands even before its cells
// mount; then the observer fills it. Retries once while the list is still loading.
function scrollToDay(iso) {
  const scroll = () => {
    let el = $main.querySelector(`.date-group[data-date="${iso}"]`);
    if (!el)   // grid grouped by month/year: land on the bucket that contains the day (groups are newest-first)
      for (const dg of $main.querySelectorAll('.date-group')) { if (dg.dataset.date >= iso) el = dg; else break; }
    if (!el) return false;
    // scroll the list only: scrollIntoView also scrolls every ancestor, the page around the web demo's
    // iframe included (the site, the laptop frame), which pushed the tab bar out of sight
    const top = el.getBoundingClientRect().top - $scroll.getBoundingClientRect().top + $scroll.scrollTop;
    $scroll.scrollTo({ top, behavior: 'smooth' });
    el.classList.add('jumped');
    setTimeout(() => el.classList.remove('jumped'), 1500);
    return true;
  };
  requestAnimationFrame(() => { if (!scroll()) setTimeout(scroll, 250); });
}

// Back to the Souvenirs grid (from the stats sub-view or another tab), loading memories if needed.
function _toMemoriesGrid() {
  const tab = document.querySelector('.tab[data-tab="0"]');
  if (tab.classList.contains('active')) setMemView('list');
  else { memView = 'list'; tab.click(); }
}

function goToDay(iso) {
  _toMemoriesGrid();
  scrollToDay(iso);
}

// Jump to the newest day of a given year.
function goToYear(y) {
  _toMemoriesGrid();
  const g = allGroups.find(g => g.date.slice(0, 4) === y);
  if (g) scrollToDay(g.date);
}
