// Plan bar + unlock modal (server mode only): Gratuit 100 → Essentiel 4,99 € (1000) → Illimité 19,99 €.
// Classic script sharing the page's global scope (see index.html for the load order).
'use strict';

// ── Plans + unlock (server mode only; the static demo shows everything) ──────
(function licenseUI(){
  if (DEMO) return;
  const LS_CHECKOUT_PRO = 'https://memora-app.lemonsqueezy.com/checkout/buy/326ff2c3-ddeb-4f2f-ac83-09b4007a5444';
  // Shared checkout: this link shows both variants (Essentiel 4,99 € / Illimité 19,99 €) and the
  // buyer picks. The plan is decided server-side from the variant actually bought (Worker planFor,
  // STARTER_VARIANT_IDS), so both buttons can point here. Swap for a per-variant link when available.
  const LS_CHECKOUT_STARTER = LS_CHECKOUT_PRO;
  const STARTER_READY = !LS_CHECKOUT_STARTER.includes('REMPLACER');
  const nf = n => (n || 0).toLocaleString(LOCALE);

  const bar = document.createElement('div');
  bar.id = 'lic-bar';
  bar.innerHTML = `<span id="lic-msg"></span><button id="lic-unlock">Débloquer</button><button class="lic-hide" id="lic-hide" aria-label="Masquer">×</button>`;
  document.body.appendChild(bar);

  const modal = document.createElement('div');
  modal.id = 'lic-modal';
  modal.innerHTML = `<div class="box">
    <button class="x" id="lic-close" aria-label="Fermer">×</button>
    <h2 id="lic-title">Débloquer Memorizzz</h2>
    <p class="lic-note">Paiement unique, sans abonnement.</p>
    <div class="lic-plans">
      <div class="lic-plan" id="lic-starter">
        <div class="nm">Essentiel</div>
        <div class="pr">4,99&nbsp;€<small> une fois</small></div>
        <ul><li><b>1 000</b> souvenirs</li><li><b>1 000</b> Chat Media</li><li><b>1 000</b> messages</li></ul>
        <a class="lic-btn sec" id="lic-buy-starter" target="_blank" rel="noopener"></a>
      </div>
      <div class="lic-plan best">
        <div class="nm">Illimité <span class="tag">Tout ton export</span></div>
        <div class="pr">19,99&nbsp;€<small> une fois</small></div>
        <ul><li>Tous tes souvenirs</li><li>Tous tes Chat Media</li><li>Toutes tes conversations</li></ul>
        <a class="lic-btn primary" href="${LS_CHECKOUT_PRO}" target="_blank" rel="noopener">Choisir Illimité</a>
      </div>
    </div>
    <div class="lic-key"><input id="lic-input" placeholder="Colle ta clé de licence" autocomplete="off"><button class="lic-btn sec" id="lic-activate">Activer</button></div>
    <div id="lic-err"></div>
  </div>`;
  document.body.appendChild(modal);

  const buyStarter = document.getElementById('lic-buy-starter');
  if (STARTER_READY) { buyStarter.href = LS_CHECKOUT_STARTER; buyStarter.textContent = 'Choisir Essentiel'; }
  else { buyStarter.removeAttribute('href'); buyStarter.textContent = 'Bientôt disponible'; buyStarter.classList.add('off'); }

  async function refresh(){
    try {
      const d = await (await fetch('/api/license')).json();
      const starter = d.plan === 'starter';
      // already on Essentiel: only the upgrade is offered
      document.getElementById('lic-starter').hidden = starter;
      document.getElementById('lic-title').textContent = starter ? 'Passer à l’illimité' : 'Débloquer Memorizzz';
      if (d.pro) { bar.classList.remove('on'); return; }
      const c = d.counts || {}, w = d.waiting || {}, ch = d.chats || {};
      const shown = ['memories', 'chat'].reduce((s, k) => s + Math.min(c[k] || 0, d.limit), 0) + (ch.shown || 0);
      const tot = ['memories', 'chat'].reduce((s, k) => s + (c[k] || 0) + (w[k] || 0), 0) + (ch.all || 0);
      const name = starter ? 'Version Essentiel' : 'Version gratuite';
      document.getElementById('lic-msg').textContent = shown < tot
        ? `${name} : ${nf(shown)} éléments sur ${nf(tot)}`
        : `${name} : jusqu'à ${nf(d.limit)} éléments par catégorie`;
      document.getElementById('lic-unlock').textContent = starter ? 'Passer à l’illimité' : 'Débloquer';
      bar.classList.toggle('on', !hidden);
    } catch(e) {}
  }
  document.getElementById('lic-unlock').onclick = () => modal.classList.add('on');
  // the bar can be put away for this session; it comes back on the next launch
  let hidden = false;
  try { hidden = sessionStorage.getItem('memora.licBarHidden') === '1'; } catch (e) {}
  document.getElementById('lic-hide').onclick = () => {
    hidden = true; bar.classList.remove('on');
    try { sessionStorage.setItem('memora.licBarHidden', '1'); } catch (e) {}
  };
  document.getElementById('lic-close').onclick = () => modal.classList.remove('on');
  modal.onclick = e => { if (e.target === modal) modal.classList.remove('on'); };
  document.getElementById('lic-activate').onclick = async () => {
    const key = document.getElementById('lic-input').value.trim();
    if (!key) return;
    const err = document.getElementById('lic-err'); err.textContent = '…';
    try {
      const d = await (await fetch('/api/license/activate', {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ key })
      })).json();
      if (d.ok) {
        err.textContent = '';
        modal.classList.remove('on');
        for (const k in _mediaCache) delete _mediaCache[k];
        _geoLoaded = false; _statsLoaded = false; _tripsData = null;
        CH.list = null; CH.conv = null;
        if (currentView === 'list') load();
        if (currentView === 'stats') showStatsView();
        if (currentView === 'chats') showChatsView();
        refresh();
        // the previous plan only processed part of the export: do the rest now
        if (window.memoraImportRemaining) window.memoraImportRemaining();
      } else { err.textContent = 'Clé invalide.'; }
    } catch(e) { err.textContent = 'Erreur : ' + e.message; }
  };
  window.memoraLicenseRefresh = refresh;   // used by the Réglages panel
  refresh();
})();
