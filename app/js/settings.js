// Réglages panel: library location, license, app files, version.
// Classic script sharing the page's global scope (see index.html for the load order).
'use strict';

// ── Réglages: where the data lives, license, version (desktop/local only) ─────
(function settingsUI(){
  if (DEMO) return;
  const btn = document.getElementById('settings-btn');
  btn.style.display = '';
  const appApi = () => window.pywebview && window.pywebview.api && window.pywebview.api.open_path
    ? window.pywebview.api : null;
  const gb = n => (n / 1e9).toLocaleString(LOCALE, { maximumFractionDigits: 1 }) + ' Go';
  const mb = n => n >= 1e9 ? gb(n) : Math.round(n / 1e6).toLocaleString(LOCALE) + ' Mo';


  const modal = document.createElement('div');
  modal.id = 'set-modal';
  modal.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="set-title">
    <button class="x" id="set-close" aria-label="Fermer">×</button>
    <h2 id="set-title">Réglages</h2>
    <div id="set-body">Chargement…</div>
  </div>`;
  document.body.appendChild(modal);
  const body = modal.querySelector('#set-body');
  const close = () => modal.classList.remove('on');
  modal.querySelector('#set-close').onclick = close;
  modal.onclick = e => { if (e.target === modal) close(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.classList.contains('on')) close(); });

  const openBtn = p => p && appApi()
    ? `<button class="s" data-open="${esc(p)}">Ouvrir</button>` : '';
  const row = (k, v, action = '') => `<div class="row"><div class="k">${k}</div><div class="v">${v}</div>${action}</div>`;

  function render(d){
    const canMove = !!(appApi() && appApi().pick_existing_library);
    const L = d.license, c = L.counts || {}, w = L.waiting || {}, ch = L.chats || {};
    const tot = (c.memories || 0) + (c.chat || 0) + (w.memories || 0) + (w.chat || 0) + (ch.all || 0);
    const keyRows = () => row('Email', esc(L.email || ''))
          + (L.order ? row('Commande', esc(String(L.order))) : '')
          + (since ? row('Activée le', esc(since)) : '')
          + row('Clé', '', '<button class="s danger" id="set-deact">Désactiver</button>');
    // the phone (store.ts): a purchase in the App Store, with its key for the computer
    const storeRows = () => row('Achat', 'App Store',
                '<button class="s" id="set-deskkey">Clé pour l’ordinateur</button>');
    const licRows = () => (L.store && L.store !== 'free' ? storeRows() : '')
          + (L.keyPlan === undefined || L.keyPlan !== 'free' ? keyRows() : '');
    const since = L.iat ? new Date(L.iat * 1000).toLocaleDateString(LOCALE, { day:'numeric', month:'long', year:'numeric' }) : '';
    let lic;
    const upTo = n => `${n.toLocaleString(LOCALE)} plus récents par catégorie`;
    if (L.devBypass) {
      lic = row('Statut', `<span class="pro">${L.plan === 'pro' ? 'Illimitée' : L.plan === 'starter' ? 'Essentiel' : 'Gratuite'}</span>`
          + '<small>Mode développeur</small>');
    } else if (L.plan === 'pro') {
      lic = row('Statut', '<span class="pro">Illimitée, à vie</span>') + licRows();
    } else if (L.plan === 'starter') {
      lic = row('Statut', `<span class="pro">Essentiel, à vie</span><small>${upTo(L.starterLimit)}</small>`,
                '<button class="s y" id="set-unlock">Passer à l’illimité</button>') + licRows();
    } else {
      lic = row('Statut', `Version gratuite<small>${upTo(L.freeLimit)}</small>`,
                '<button class="s y" id="set-unlock">Débloquer</button>');
    }
    body.innerHTML =
      '<h3>Bibliothèque</h3>'
      + row('Emplacement', `<span class="path">${esc(d.library || 'non configurée')}</span>`
            + (canMove ? '<small id="set-moveerr" class="err" hidden></small>' : ''),
            openBtn(d.library) + (canMove ? '<button class="s" id="set-move">Changer</button>' : ''))
      + (d.diskFree != null ? row('Espace disque', `${gb(d.diskFree)} libres sur ${gb(d.diskTotal)}`) : '')
      + row('Contenu', `${(c.memories || 0).toLocaleString(LOCALE)} souvenirs, ${(c.chat || 0).toLocaleString(LOCALE)} Chat Media`)
      + '<h3>Licence</h3>' + lic
      + (d.configDir ? '<h3>Fichiers de l’app</h3>'
      + row('Réglages', `<span class="path">${esc(d.configDir)}</span>`, openBtn(d.configDir))
      + row('Miniatures', `<span class="path">${esc(d.cacheDir)}</span><small>${mb(d.cacheBytes)} en cache, recréées si besoin.</small>`, openBtn(d.cacheDir)) : '')
      + '<h3>À propos</h3>'
      + row('Version', esc(d.version))
      + row('Aide', '<a href="mailto:contact@memorizzz.com" style="color:#FFFC00">contact@memorizzz.com</a>'
            + '<small><a href="https://memorizzz.com/mentions-legales/" target="_blank" rel="noopener" style="color:inherit">Mentions légales</a></small>')
      + '<p class="foot">Lieux : GeoNames (CC BY 4.0). Carte : © OpenStreetMap.<br>'
      + 'Non affilié à Snap Inc. Snapchat est une marque de Snap Inc.</p>';

    body.querySelectorAll('[data-open]').forEach(b => b.onclick = () => appApi().open_path(b.dataset.open));
    // the library was moved (other disk, other folder): point the app to it; the page reloads on it
    const move = body.querySelector('#set-move');
    if (move) move.onclick = async () => {
      const err = body.querySelector('#set-moveerr');
      if (appImporting) { err.hidden = false; err.textContent = 'Attends la fin de l’import en cours.'; return; }
      const r = await appApi().pick_existing_library();
      if (!r) return;
      if (!r.ok) { err.hidden = false; err.textContent = 'Ce dossier ne contient pas de bibliothèque Memorizzz.'; return; }
      location.reload();
    };
    const unlock = body.querySelector('#set-unlock');
    if (unlock) unlock.onclick = () => { close(); document.getElementById('lic-unlock').click(); };
    const deskKey = body.querySelector('#set-deskkey');
    if (deskKey) deskKey.onclick = () => { close(); if (window.memorizzzDesktopKey) window.memorizzzDesktopKey(); };
    const deact = body.querySelector('#set-deact');
    if (deact) deact.onclick = async () => {
      if (!deact.dataset.armed) { deact.dataset.armed = '1'; deact.textContent = 'Confirmer'; return; }
      await fetch('/api/license/deactivate', { method: 'POST' });
      for (const k in _mediaCache) delete _mediaCache[k];
      _geoLoaded = false; _statsLoaded = false; _tripsData = null;
      if (currentView === 'list') load();
      if (window.memoraLicenseRefresh) window.memoraLicenseRefresh();
      show();
    };
  }

  async function show(){
    modal.classList.add('on');
    try {
      const r = await fetch('/api/settings');   // not getJSON: a failure must not flip the app to demo mode
      if (!r.ok) throw new Error('HTTP ' + r.status);
      render(await r.json());
    }
    catch(e) { body.textContent = 'Impossible de charger les réglages : ' + e.message; }
  }
  btn.addEventListener('click', show);
})();
