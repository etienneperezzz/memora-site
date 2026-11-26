// The day-grouped media grid: loading, search, virtualized rendering, taps, selection.
// Classic script sharing the page's global scope (see index.html for the load order).
'use strict';

// ── Load ─────────────────────────────────────────────────────────────────────
// One request per source at a time (a tab switch while it loads reuses it). The list is stored under the
// source it was ASKED for and drawn only if that tab is still the one on screen: before, a slow Souvenirs
// list arriving after a switch to Chat Media was drawn and cached as Chat Media (souvenirs carousel included).
const _mediaPending = {};
async function load() {
  const src = currentSource;
  const show = groups => {
    allGroups = groups;
    buildChatFilters();
    applyFilters();
    buildScrubber();
    buildSouvenirs();
  };
  if (_mediaCache[src]) { show(_mediaCache[src]); return; }   // instant re-visit, no refetch
  if (src !== 'memories') $souv.hidden = true;   // the souvenirs carousel belongs to Souvenirs, even while this loads
  $main.innerHTML = `<div class="state-view"><div class="spinner"></div><span>${sourceLoading[src] || 'Chargement…'}</span></div>`;
  try {
    const groups = await (_mediaPending[src] ||= getJSON('/api/media?source=' + encodeURIComponent(src), 'media_' + src + '.json')
      .finally(() => { delete _mediaPending[src]; }));
    _mediaCache[src] = groups;
    if (src === currentSource && currentView === 'list') show(groups);   // else drawn when the tab comes back
  } catch (e) {
    if (src === currentSource) $main.innerHTML = `<div class="state-view"><span>Erreur : ${e.message}</span></div>`;
  }
}

function buildFlat() {
  flatItems = filtGroups.flatMap(g => g.items);
}


// ── Chat Media filters: type (photos, videos, voice notes, snaps) + conversation ──
const cmFilter = { type: 'all', conv: '', person: '' };   // conv: '' | 'grp' (all groups) | 'dm' (one-to-one) | <conversation id> ; person: a sender (a selected group only)
const CM_TYPES = [
  ['all',   'Tout',    () => true],
  ['image', 'Photos',  it => it.type === 'image'],
  ['video', 'Vidéos',  it => it.type === 'video'],
  ['audio', 'Vocaux',  it => it.type === 'audio'],
  ['snap',  'Snaps',   it => !!it.snap],
];
const _cmConvOk = it => !cmFilter.conv ? true
  : cmFilter.conv === 'grp' ? !!it.grp
  : cmFilter.conv === 'dm'  ? !!it.cid && !it.grp
  : it.cid === cmFilter.conv;
const _cmTypeOk = it => (CM_TYPES.find(t => t[0] === cmFilter.type) || CM_TYPES[0])[2](it);
const _cmPersonOk = it => !cmFilter.person || it.by === cmFilter.person;

// Chips with counts (for the selected conversation) and the conversation menu.
function buildChatFilters() {
  const el = document.getElementById('cm-filters');
  if (!el) return;
  if (currentSource !== 'chat' || !allGroups.length) { el.hidden = true; return; }
  const items = allGroups.flatMap(g => g.items);
  const inConv = items.filter(_cmConvOk);
  const chips = CM_TYPES.map(([k, label, test]) => {
    const n = k === 'all' ? inConv.length : inConv.reduce((a, it) => a + (test(it) ? 1 : 0), 0);
    if (k === 'snap' && !items.some(it => it.snap)) return '';
    return `<button class="ch-opt${cmFilter.type === k ? ' on' : ''}" data-cmtype="${k}">${label} <small>${n.toLocaleString(LOCALE)}</small></button>`;
  }).join('');
  // conversations, most media first
  const convs = new Map();
  for (const it of items) if (it.cid) {
    const c = convs.get(it.cid) || convs.set(it.cid, { id: it.cid, title: it.conv, grp: !!it.grp, n: 0 }).get(it.cid);
    c.n++;
  }
  const list = [...convs.values()].sort((a, b) => b.n - a.n);
  const opt = c => `<option value="${esc(c.id)}"${cmFilter.conv === c.id ? ' selected' : ''}>${esc(c.title)} (${c.n})</option>`;
  const sel = v => cmFilter.conv === v ? ' selected' : '';
  const menu = list.length ? `<select id="cm-conv" aria-label="Conversation">
      <option value=""${sel('')}>Tous les chats</option>
      <option value="grp"${sel('grp')}>Tous les groupes</option>
      <option value="dm"${sel('dm')}>Chats privés</option>
      <optgroup label="Groupes">${list.filter(c => c.grp).map(opt).join('')}</optgroup>
      <optgroup label="Privé">${list.filter(c => !c.grp).map(opt).join('')}</optgroup>
    </select>` : '';
  // Member filter (a selected group only): the distinct senders in that conversation.
  const selConv = list.find(c => c.id === cmFilter.conv);
  let people = '';
  if (selConv && selConv.grp) {
    const members = [...new Set(inConv.map(it => it.by).filter(Boolean))].sort((a, b) => a.localeCompare(b, LOCALE));
    if (members.length > 1) people = `<select id="cm-person" aria-label="Membre">
        <option value=""${cmFilter.person ? '' : ' selected'}>Tous les membres</option>
        ${members.map(m => `<option value="${esc(m)}"${cmFilter.person === m ? ' selected' : ''}>${esc(m)}</option>`).join('')}
      </select>`;
  }
  if (!people) cmFilter.person = '';   // no member list here: forget any stale person

  // one line: what is shown, and a « filter » icon whose menu holds the type, conversation and member
  const t = CM_TYPES.find(x => x[0] === cmFilter.type) || CM_TYPES[0];
  const shown = inConv.reduce((a, it) => a + ((t[2](it) && _cmPersonOk(it)) ? 1 : 0), 0);
  const conv = cmFilter.conv ? (selConv?.title
    || { grp: 'Tous les groupes', dm: 'Chats privés' }[cmFilter.conv] || '') : '';
  const sub = cmFilter.person ? `${esc(cmFilter.person)}${conv ? ' · ' + esc(conv) : ''}` : (conv ? esc(conv) : '');
  el.innerHTML = `<span class="cm-sum">${t[1]} <small>${shown.toLocaleString(LOCALE)}</small>${sub ? ` <em>${sub}</em>` : ''}</span>
    <div class="ch-pop">
      <button class="ch-ico${cmFilter.type !== 'all' || cmFilter.conv || cmFilter.person ? ' dot' : ''}" data-pop="cm" aria-label="Filtrer les médias" aria-expanded="false">${CH_ICON_SORT}</button>
      <div class="ch-menu" hidden>
        <div class="ch-mh">Afficher</div>${chips}
        ${menu ? `<div class="ch-mh">Conversation</div>${menu}` : ''}
        ${people ? `<div class="ch-mh">Membre</div>${people}` : ''}
      </div>
    </div>`;
  el.hidden = false;
}

document.getElementById('cm-filters')?.addEventListener('click', e => {
  const b = e.target.closest('[data-cmtype]');
  if (!b) return;
  cmFilter.type = b.dataset.cmtype;
  buildChatFilters(); applyFilters(); $scroll.scrollTop = 0;
});
document.getElementById('cm-filters')?.addEventListener('change', e => {
  if (e.target.id === 'cm-conv') { cmFilter.conv = e.target.value; cmFilter.person = ''; }   // a new conversation: drop the member
  else if (e.target.id === 'cm-person') cmFilter.person = e.target.value;
  else return;
  buildChatFilters(); applyFilters(); $scroll.scrollTop = 0;
});

// ── Search (+ Chat Media filters; year/month navigation is the scrubber) ─────
function applyFilters() {
  const q = $search.value.toLowerCase().trim();
  const cm = currentSource === 'chat' && (cmFilter.type !== 'all' || cmFilter.conv || cmFilter.person);
  if (!q && !cm) filtGroups = allGroups;
  else {
    // a date ("2025-07") or, for chat media, a sender / group name
    const hitQ = it => !q || (it.by && it.by.toLowerCase().includes(q)) || (it.in && it.in.toLowerCase().includes(q))
                          || (it.conv && it.conv.toLowerCase().includes(q));
    const hitF = it => !cm || (_cmConvOk(it) && _cmTypeOk(it) && _cmPersonOk(it));
    filtGroups = allGroups.map(g => ({ date: g.date,
                                       items: g.items.filter(it => hitF(it) && (g.date.includes(q) || hitQ(it))) }))
                          .filter(g => g.items.length);
  }
  buildFlat();
  render();
}

// ── Search ───────────────────────────────────────────────────────────────────
$search.addEventListener('input', applyFilters);

// ── Render ───────────────────────────────────────────────────────────────────
function render() {
  listSource = currentSource;   // the source now actually painted into #main-content
  if (!filtGroups.length) {
    $main.innerHTML = appImporting
      ? `<div class="state-view"><div class="spinner"></div><span>${currentSource === 'chat'
          ? 'Import en cours… tes Chat Media arrivent ici une fois les souvenirs traités.'
          : 'Import en cours… tes souvenirs vont apparaître ici au fur et à mesure.'}</span></div>`
      : `<div class="state-view"><span>${sourceTitles[currentSource] || 'Aucun élément'}</span></div>`;
    return;
  }

  // Groups — build each day's cells HTML but keep it OUT of the DOM (in
  // _groupCells). The DOM gets empty grids with a reserved height; virtualize()
  // fills only the ones near the viewport. data-idx stays the flat index so the
  // lightbox and selection keep working whenever a cell is (re)mounted.
  let cursor = 0;
  _groupCells = [];
  const groupsHTML = filtGroups.map((g, gi) => {
    const cells = g.items.map(item => {
      const idx = cursor++;
      const vid = item.type === 'video';
      // chat media: who sent it (and in which group), small, at the bottom of the cell
      const by = item.by ? `<div class="cell-by" title="${esc(item.by + (item.in ? ' · ' + item.in : ''))}">
          <b>${esc(item.by)}</b>${item.in ? `<span>${esc(item.in)}</span>` : ''}</div>` : '';
      if (item.type === 'audio') {
        return `
        <div class="media-cell audio-cell${item.d ? ' has-dur' : ''}" data-idx="${idx}">
          ${voiceHTML(murl(item.path), true, item.d)}${by}
          ${item.d ? `<div class="video-badge"><span>${fmtDur(item.d)}</span></div>` : ''}
          <div class="check-circle">
            <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
              <path d="M1 4.5L3.8 7.5L10 1" stroke="#111" stroke-width="2.2"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>`;
      }
      return `
        <div class="media-cell${vid && item.d ? ' has-dur' : ''}" data-idx="${idx}">
          <img src="${thumbUrl(item.path)}" loading="lazy" decoding="async" alt="">
          ${by}
          ${vid ? `<div class="video-badge">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="rgba(255,255,255,0.92)">
              <polygon points="5,3 19,12 5,21"/>
            </svg>${item.d ? `<span>${fmtDur(item.d)}</span>` : ''}
          </div>` : ''}
          <div class="check-circle">
            <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
              <path d="M1 4.5L3.8 7.5L10 1" stroke="#111" stroke-width="2.2"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>`;
    }).join('');
    _groupCells.push(cells);
    return `
      <div class="date-group" data-date="${g.date}">
        <div class="date-label">${fmtDate(g.date)}</div>
        <div class="media-grid" data-gi="${gi}" data-n="${g.items.length}"></div>
      </div>`;
  }).join('');

  $main.innerHTML = '<div id="cap-note"></div>' + groupsHTML;
  paintCapNote();
  virtualize();
}

// Essentiel / free: how many of this tab's items the plan shows, out of how many (license.js keeps
// window.memoraLic up to date and repaints this when it changes).
function paintCapNote() {
  const box = document.getElementById('cap-note'), d = window.memoraLic;
  if (!box) return;
  const k = listSource, c = (d && d.counts && d.counts[k]) || 0;
  const tot = c + ((d && d.waiting && d.waiting[k]) || 0), shown = d ? Math.min(c, d.limit || c) : 0;
  if (!d || d.pro || !tot || shown >= tot || capBarOff()) { box.innerHTML = ''; return; }
  const what = k === 'chat' ? 'Chat Media' : 'souvenirs', n = x => x.toLocaleString(LOCALE);
  box.innerHTML = `<div class="cap-bar"><div class="t"><b>${n(shown)} ${what} sur ${n(tot)}</b>
      <span>Ta version affiche les plus récents.</span><div class="m"><i style="width:${Math.max(2, shown / tot * 100)}%"></i></div></div>
    <button>${d.plan === 'starter' ? 'Passer à l’illimité' : 'Tout débloquer'}</button>${CAP_X}</div>`;
  box.querySelector('button').onclick = () => document.getElementById('lic-unlock').click();
}

// The bar can be closed for good (Souvenirs, Chat Media and Chats alike); the unlock stays in Réglages.
const CAP_X = '<button class="x" aria-label="Fermer">×</button>';
const capBarOff = () => { try { return localStorage.getItem('memora.capBarOff') === '1'; } catch (e) { return false; } };
document.addEventListener('click', e => {
  const x = e.target.closest('.cap-bar .x');
  if (!x) return;
  try { localStorage.setItem('memora.capBarOff', '1'); } catch (err) {}
  const bar = x.closest('.cap-bar'), d = window.memoraLic;
  bar.classList.add('closed');
  bar.innerHTML = `<div class="t">Tu pourras ${d && d.plan === 'starter' ? 'passer à l’illimité' : 'tout débloquer'}
    à tout moment dans les <b>Réglages</b>.</div>`;
  setTimeout(() => bar.remove(), 5000);
});

// ── Virtualization (windowing by day) ────────────────────────────────────────
// Keep only grids near the viewport populated. Empty grids get a reserved
// min-height computed from column metrics so the scrollbar is correct.
let _groupCells = [];
let _vobs = null;

function _gridHeight(n, cols, cellW, gap) {
  const rows = Math.ceil(n / cols) || 1;
  return Math.round(rows * cellW + (rows + 1) * gap);  // +1 gap ≈ bottom padding
}

function _fillGrid(grid, cols, cellW, gap) {
  if (grid.dataset.filled) return;
  grid.innerHTML = _groupCells[+grid.dataset.gi] || '';
  grid.dataset.filled = '1';
  grid.style.minHeight = '';
  if (selecting && chosen.size) {                      // re-apply selection on remount
    grid.querySelectorAll('.media-cell').forEach(c => {
      if (chosen.has(+c.dataset.idx)) c.classList.add('selected');
    });
  }
}

function _emptyGrid(grid, cols, cellW, gap) {
  if (!grid.dataset.filled) return;
  grid.style.minHeight = _gridHeight(+grid.dataset.n, cols, cellW, gap) + 'px';
  grid.innerHTML = '';
  delete grid.dataset.filled;
}

function virtualize() {
  if (_vobs) { _vobs.disconnect(); _vobs = null; }
  const grids = [...$main.querySelectorAll('.media-grid[data-gi]')];
  if (!grids.length) return;

  // Measure column metrics from a live grid (handles the 2/3/4-col breakpoints
  // and the 600px cap automatically).
  const g0 = grids[0];
  const cs = getComputedStyle(g0);
  const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length || 2;
  const gap = parseFloat(cs.gap) || 2;
  const cellW = (g0.clientWidth - (cols - 1) * gap) / cols;

  // Reserve height up front so the full scroll length exists immediately
  // (filled grids already have real, content-driven height).
  for (const grid of grids)
    if (!grid.dataset.filled)
      grid.style.minHeight = _gridHeight(+grid.dataset.n, cols, cellW, gap) + 'px';

  // Fill the first few days synchronously so the first screen is never blank,
  // regardless of when the observer's first callback fires.
  for (const grid of grids.slice(0, 8)) _fillGrid(grid, cols, cellW, gap);

  _vobs = new IntersectionObserver(entries => {
    for (const e of entries) {
      const grid = e.target.querySelector('.media-grid[data-gi]');
      if (!grid) continue;
      if (e.isIntersecting) _fillGrid(grid, cols, cellW, gap);
      else _emptyGrid(grid, cols, cellW, gap);
    }
  }, { root: document.getElementById('content'), rootMargin: '1200px 0px', threshold: 0 });

  $main.querySelectorAll('.date-group').forEach(dg => _vobs.observe(dg));
}

// ── Cell interactions (event delegation — bound ONCE on $main, not per cell) ──
// Pointer events unify mouse + touch. A short press = tap (open/select); a
// 480ms hold = enter selection. Movement > 10px = scroll, not a tap.
function setupDelegation() {
  let downCell = null, downX = 0, downY = 0, lpTimer = null, lpFired = false;

  function endPress() {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    if (downCell) downCell.classList.remove('tap-flash');
    downCell = null;
  }

  $main.addEventListener('pointerdown', e => {
    const cell = e.target.closest('.media-cell');
    if (!cell) return;                       // stories/empty space: nothing to arm
    downCell = cell; downX = e.clientX; downY = e.clientY; lpFired = false;
    cell.classList.add('tap-flash');
    lpTimer = setTimeout(() => {
      lpFired = true; lpTimer = null;
      cell.classList.remove('tap-flash');
      if (!selecting) enterSelect();
      toggleSel(cell);
    }, 480);
  });

  $main.addEventListener('pointerup', e => {
    const cell = downCell;
    const fired = lpFired;
    endPress();
    if (cell && !fired && e.target.closest('.media-cell') === cell) tap(cell, e);
  });

  $main.addEventListener('pointermove', e => {
    if (downCell && (Math.abs(e.clientX - downX) > 10 || Math.abs(e.clientY - downY) > 10))
      endPress();                            // moved → it's a scroll, cancel
  }, { passive: true });

  ['pointercancel', 'pointerleave'].forEach(ev => $main.addEventListener(ev, endPress));
}

function tap(cell, e) {
  e.preventDefault();
  const idx = +cell.dataset.idx;
  if (selecting) toggleSel(cell);
  else if (cell.classList.contains('audio-cell')) voiceToggle(cell.querySelector('.vn').dataset.vn);   // play in place
  else { buildFlat(); openLb(idx, true); }   // restore flatItems to the grid (souvenirs/map/random may have replaced it) + sync the grid on close
}

// ── Selection ────────────────────────────────────────────────────────────────
function enterSelect() {
  selecting = true;
  // the actions this platform has: phone (MEMORA_NATIVE: Photos + share sheet), computer (export to a folder)
  $selDl.style.display = _selExport() ? '' : 'none';
  $selShare.style.display = window.MEMORA_NATIVE && window.MEMORA_NATIVE.shareItems ? '' : 'none';
  if (window.MEMORA_NATIVE && window.MEMORA_NATIVE.exportLabel) $selDl.querySelector('span').textContent = window.MEMORA_NATIVE.exportLabel;
  $main.classList.add('selecting');
  $selBar.classList.add('visible');
}
function exitSelect() {
  selecting = false;
  chosen.clear();
  $main.classList.remove('selecting');
  $selBar.classList.remove('visible');
  $main.querySelectorAll('.media-cell.selected').forEach(c => c.classList.remove('selected'));
  updateCount();
}
function toggleSel(cell) {
  const idx = +cell.dataset.idx;
  if (chosen.has(idx)) { chosen.delete(idx); cell.classList.remove('selected'); }
  else                  { chosen.add(idx);    cell.classList.add('selected'); }
  updateCount();
  if (chosen.size === 0) exitSelect();
}
function updateCount() {
  const n = chosen.size;
  $selCnt.textContent = n <= 1 ? `${n} sélectionné` : `${n} sélectionnés`;
}
$selCancel.addEventListener('click', exitSelect);

// ── Selection actions: Exporter (phone: into Photos, computer: copies in a folder) and Partager (phone) ──
const $selDl = document.getElementById('sel-dl'), $selShare = document.getElementById('sel-share');
const _selExport = () => DEMO ? null
  : window.MEMORA_NATIVE && window.MEMORA_NATIVE.exportItems ? (s, rels) => window.MEMORA_NATIVE.exportItems(s, rels)
  : window.pywebview && window.pywebview.api && window.pywebview.api.export_media ? async (s, rels) => {
      const r = await window.pywebview.api.export_media(s, rels);
      if (!r || !r.ok) return r && r.cancelled ? '' : 'Export impossible';
      return `${r.n} exporté${r.n > 1 ? 's' : ''}`;
    }
  : null;
async function selAction(btn, run) {
  const rels = [...chosen].map(i => flatItems[i]).filter(Boolean).map(it => it.path);
  if (!rels.length || btn.classList.contains('busy')) return;
  btn.classList.add('busy');
  const label = $selCnt.textContent;
  $selCnt.textContent = '…';
  try {
    const msg = await run(currentSource, rels);
    $selCnt.textContent = msg || label;
    if (msg) setTimeout(exitSelect, 1600);
  } catch (e) { $selCnt.textContent = 'Erreur : ' + e.message; }
  btn.classList.remove('busy');
}
$selDl.addEventListener('click', () => { const run = _selExport(); if (run) selAction($selDl, run); });
$selShare.addEventListener('click', () => selAction($selShare, (s, rels) => window.MEMORA_NATIVE.shareItems(s, rels)));

// Demo picker: push the current selection to the server (build_demo.py --selection).
// Developer tool: shown only when the app runs from source (/api/license → dev).
const $selDemo = document.getElementById('sel-demo');
if (!DEMO && $selDemo) fetch('/api/license').then(r => r.json()).then(d => {
  if (!d.dev) return;
  $selDemo.style.display = '';
  $selDemo.addEventListener('click', async () => {
    const items = [...chosen].map(i => flatItems[i]).filter(Boolean)
      .map(it => ({ source: currentSource, path: it.path }));
    if (!items.length) return;
    try {
      const r = await fetch('/api/demo/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
      const d = await r.json();
      $selCnt.textContent = `${items.length} ajouté(s) · ${d.total} dans la démo`;
      setTimeout(exitSelect, 1200);
    } catch (e) {
      $selCnt.textContent = 'Erreur : ' + e.message;
    }
  });
}).catch(() => {});

// ── Back to today: a pill at the top once far down a list (Souvenirs, Chat Media) ──
const $toTop = document.createElement('button');
$toTop.id = 'to-top';
$toTop.hidden = true;
$toTop.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>${t("Aujourd'hui")}`;
document.body.appendChild($toTop);
function syncToTop() {
  const on = currentView === 'list' && $scroll.scrollTop > $scroll.clientHeight * 2;
  if (on === !$toTop.hidden) return;
  $toTop.hidden = !on;
  if (on) $toTop.style.top = ($scroll.getBoundingClientRect().top + 10) + 'px';
}
$scroll.addEventListener('scroll', syncToTop, { passive: true });
document.querySelector('.tabs')?.addEventListener('click', () => setTimeout(syncToTop));
$toTop.addEventListener('click', () => {
  const h = $scroll.clientHeight;
  if ($scroll.scrollTop > h * 3) $scroll.scrollTop = h * 3;   // ponytail: only the last screens are animated (a long smooth scroll mounts every day on the way)
  $scroll.scrollTo({ top: 0, behavior: 'smooth' });
});
