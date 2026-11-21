// Add data (desktop app): pick export zips, run the import, show progress.
// Classic script sharing the page's global scope (see index.html for the load order).
'use strict';

// ── Add data (desktop app only): pick export zip(s) → import → refresh ────────
(function importUI(){
  const addBtn = document.getElementById('add-btn');
  if (!addBtn) return;
  // pywebview injects its API asynchronously; reveal the button once it's there.
  function hasApi(){ return !!(window.pywebview && window.pywebview.api && window.pywebview.api.run_import); }
  function reveal(){ if (hasApi()) addBtn.style.display = ''; }
  window.addEventListener('pywebviewready', reveal);
  let tries = 0; const t = setInterval(() => { reveal(); if (hasApi() || ++tries > 40) clearInterval(t); }, 150);

  const modal = document.createElement('div');
  modal.id = 'imp-modal';
  modal.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-label="Ajouter un export Snapchat">
    <h3>Ajouter un export Snapchat</h3>
    <ul id="imp-intro" hidden>
      <li><b>Un export plus récent</b> ou un .zip oublié</li>
      <li><b>Rien n'est écrasé</b>, tes souvenirs restent en place</li>
      <li><b>Les doublons sont ignorés</b>, le nouveau s'ajoute à ta galerie</li>
    </ul>
    <div id="imp-msg"></div>
    <div id="imp-prog" hidden></div>
    <p id="imp-bg" hidden>Tu peux fermer cette fenêtre et continuer à parcourir tes photos : l'import continue en arrière-plan.</p>
    <button class="link" id="imp-logtoggle" hidden>Afficher le détail</button>
    <div id="imp-log" hidden></div>
    <div class="row">
      <button id="imp-copy" hidden>Copier le journal</button>
      <button id="imp-recheck" class="primary" hidden>Revérifier et importer</button>
      <button id="imp-pick" class="primary" hidden>Choisir mes .zip</button>
      <button id="imp-close">Fermer</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  const pill = document.createElement('button');
  pill.id = 'imp-pill'; pill.hidden = true;
  pill.setAttribute('aria-label', 'Import en cours : afficher le détail');
  pill.innerHTML = '<div class="t"><span class="l">Import en cours…</span><span class="p">0 %</span></div><div class="b"><i></i></div><small>Cliquer pour voir le détail</small>';
  document.body.appendChild(pill);

  const q = s => modal.querySelector(s);
  const log = q('#imp-log'), msgEl = q('#imp-msg'), progEl = q('#imp-prog'), bgNote = q('#imp-bg');
  const intro = q('#imp-intro'), pickBtn = q('#imp-pick');
  const closeBtn = q('#imp-close'), recheck = q('#imp-recheck'), logToggle = q('#imp-logtoggle'), copyBtn = q('#imp-copy');
  let busy = false, pending = [], prog = null, last = { pct: 0, label: '', status: 'running' }, hideTimer = null;
  let _liveTimer = null;

  // the progress bar is shared with the wizard (progress.js), loaded only in the app
  let progLoaded = null;
  const loadProg = () => progLoaded || (progLoaded = new Promise(res => {
    const sc = document.createElement('script'); sc.src = '/progress.js';
    sc.onload = res; sc.onerror = res; document.head.appendChild(sc);
  }));

  // mirror of the bar, shown when the modal is closed during (or right after) an import
  function paintPill(u){
    last = u || last;
    pill.className = last.status === 'running' ? '' : last.status;
    pill.querySelector('.l').textContent = last.label || 'Import en cours…';
    pill.querySelector('.p').textContent = last.pct + ' %';
    pill.querySelector('.b i').style.width = last.pct + '%';
  }
  const modalOpen = () => modal.classList.contains('on');
  function openModal(){ modal.classList.add('on'); pill.hidden = true; clearTimeout(hideTimer); }
  function closeModal(){
    modal.classList.remove('on');
    if (busy) { paintPill(); pill.hidden = false; }
  }
  pill.addEventListener('click', openModal);

  async function ensureProg(){
    await loadProg();
    if (!prog && window.MemoraProgress) prog = MemoraProgress(progEl, u => { paintPill(u); });
    return prog;
  }

  // New photos show up at the end; on a first import (empty gallery) also as soon as
  // the memories step is over, so there is something to browse while chat media run.
  async function reloadLibrary(){
    try { await Promise.all(['memories', 'chat'].map(s => fetch('/api/refresh?source=' + s))); } catch (e) {}
    for (const k in _mediaCache) delete _mediaCache[k];
    _geoLoaded = false; _statsLoaded = false; _tripsData = null;
    CH.list = null; CH.conv = null;
    if (currentView === 'list') load();
    if (currentView === 'chats') showChatsView();
    if (currentView === 'stats') showStatsView();
    if (window.memoraLicenseRefresh) window.memoraLicenseRefresh();
  }

  logToggle.addEventListener('click', () => {
    const show = log.hidden;
    log.hidden = !show; copyBtn.hidden = !show;
    logToggle.textContent = show ? 'Masquer le détail' : 'Afficher le détail';
  });

  // Live refresh during import: memories are written newest-first, so new items land at
  // the top. Only refresh while the user is watching the top (no spinner, no scroll jump)
  // and only re-render when the count actually grew.
  async function liveRefresh(){
    if (currentView !== 'list' || DEMO || $scroll.scrollTop > 80) return;
    try { await fetch('/api/refresh?source=' + currentSource); } catch (e) { return; }
    let g; try { g = await getJSON('/api/media?source=' + currentSource, 'media_' + currentSource + '.json'); }
    catch (e) { return; }
    const cnt = a => a.reduce((n, x) => n + x.items.length, 0);
    if (allGroups && cnt(g) === cnt(allGroups)) return;   // nothing new
    _mediaCache[currentSource] = g; allGroups = g;
    applyFilters(); buildScrubber(); buildSouvenirs();
    $scroll.scrollTop = 0;
  }

  function showRunning(){
    if (prog) { progEl.hidden = false; prog.start(); }
    else { log.hidden = false; }   // progress.js unavailable: show the raw log instead
    logToggle.hidden = !prog; bgNote.hidden = false;
    busy = true; appImporting = true; paintPill({ pct: 0, label: 'Préparation…', status: 'running' });
    if (!_liveTimer) _liveTimer = setInterval(liveRefresh, 4000);   // ponytail: 4 s poll
    // If the gallery is already showing the empty "Aucun souvenir trouvé" state (opened
    // mid-import), swap it for the "import en cours" message right away.
    if (currentView === 'list' && (!filtGroups || !filtGroups.length)) render();
  }

  // Refuse to start unless the library's disk has room; let the user free space and re-check.
  async function tryStart(){
    const api = window.pywebview.api;
    recheck.disabled = true; recheck.textContent = 'Vérification…';
    const r = await api.check_space(pending);
    recheck.disabled = false; recheck.textContent = 'Revérifier et importer';
    intro.hidden = true; pickBtn.hidden = true;
    openModal();
    if (!r.ok){
      msgEl.textContent = '⚠️ ' + r.msg;
      progEl.hidden = true; logToggle.hidden = true; bgNote.hidden = true;
      recheck.hidden = false;
      return;
    }
    msgEl.textContent = ''; recheck.hidden = true;
    await ensureProg();
    log.textContent = '▶ Import de ' + pending.length + ' fichier(s)…';
    showRunning();
    api.run_import(pending);
  }
  recheck.addEventListener('click', tryStart);

  window.onImportLog = function(msg){
    if (msg === '__DONE__' || msg === '__FAIL__'){
      const ok = msg === '__DONE__';
      busy = false; appImporting = false; bgNote.hidden = true;
      clearInterval(_liveTimer); _liveTimer = null;
      if (prog) prog.finish(ok); else paintPill({ pct: ok ? 100 : last.pct, label: ok ? 'Import terminé ✓' : 'Import interrompu', status: ok ? 'ok' : 'fail' });
      log.textContent += ok ? '\n✅ Import terminé.' : '\n⚠️ Import interrompu, voir le message ci-dessus.';
      log.scrollTop = log.scrollHeight;
      if (!modalOpen()) {   // tell how it ended; success fades out, a failure stays until clicked
        pill.hidden = false;
        if (ok) hideTimer = setTimeout(() => { pill.hidden = true; }, 8000);
      }
      if (ok) reloadLibrary();
      return;
    }
    if (msg.startsWith('@@STEP chat') && !allGroups.length) reloadLibrary();   // memories ready
    if (prog ? prog.line(msg) : msg.startsWith('@@')) return;   // progress marker
    log.textContent += (log.textContent ? '\n' : '') + msg;
    log.scrollTop = log.scrollHeight;
  };

  // An import started elsewhere (the wizard, before opening the gallery) keeps running:
  // pick it up, modal closed, indicator shown.
  async function resume(){
    const api = window.pywebview && window.pywebview.api;
    if (!api || !api.import_state || busy) return;
    const s = await api.import_state();
    if (!s.running) return;
    await ensureProg();
    q('h3').textContent = 'Import de ton export Snapchat';
    msgEl.textContent = ''; log.textContent = '';
    showRunning();
    for (const l of s.lines) window.onImportLog(l);
    pill.hidden = false;
  }
  window.addEventListener('pywebviewready', resume);
  setTimeout(resume, 1200);

  // "+": first say what will happen (nothing overwritten, duplicates skipped), then the file picker
  addBtn.addEventListener('click', () => {
    if (busy) { openModal(); return; }
    q('h3').textContent = 'Importer de nouvelles données';
    msgEl.textContent = '';
    for (const el of [progEl, bgNote, logToggle, log, copyBtn, recheck]) el.hidden = true;
    logToggle.textContent = 'Afficher le détail';
    intro.hidden = false; pickBtn.hidden = false;
    openModal();
    pickBtn.focus();
  });
  pickBtn.addEventListener('click', async () => {
    const zips = await window.pywebview.api.pick_exports();
    if (!zips || !zips.length) return;
    pending = zips;
    q('h3').textContent = 'Ajouter un export Snapchat';
    tryStart();
  });

  // Right after unlocking: process what the free tier left in the exports already imported.
  window.memoraImportRemaining = async (title) => {
    if (!hasApi() || busy || !window.pywebview.api.raw_exports) return;
    pending = await window.pywebview.api.raw_exports();
    if (!pending.length) return;
    q('h3').textContent = title || 'Import du reste de ta bibliothèque';
    tryStart();
  };

  // Videos an older version left empty (overlay merge with ffmpeg 7): the import makes them
  // again from the exports kept in raw/. Once per launch, after resume() had its chance.
  let repairChecked = false;
  async function repair(){
    if (repairChecked || !hasApi() || busy) return;
    repairChecked = true;
    try {
      const n = (await (await fetch('/api/notices')).json()).emptyVideos || 0;
      if (n) window.memoraImportRemaining(`Réparation de ${n} vidéo${n > 1 ? 's' : ''}`);
    } catch (e) {}
  }
  window.addEventListener('pywebviewready', () => setTimeout(repair, 2000));
  setTimeout(repair, 3000);
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modalOpen()) closeModal(); });
  copyBtn.addEventListener('click', () => {
    try { navigator.clipboard.writeText(log.textContent || ''); } catch(e){}
  });
})();
