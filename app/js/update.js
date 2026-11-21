// Desktop app: tells when a newer version is published (window.pywebview.api.update_info, main process).
// Nothing in the web demo or on the phone (no such API). Closing it hides that version for good.
(function () {
  const KEY = 'memorizzz.updateDismissed';
  async function check() {
    const api = window.pywebview && window.pywebview.api;
    if (!api || !api.update_info || document.getElementById('upd-bar')) return;
    let info = null;
    try { info = await api.update_info(); } catch (e) { return; }
    if (!info) return;
    try { if (localStorage.getItem(KEY) === info.version) return; } catch (e) { /* storage off: show it */ }
    const bar = document.createElement('div');
    bar.id = 'upd-bar';
    bar.innerHTML = `<span>${t('Nouvelle version disponible')} <b>${info.version}</b></span>
      <button class="upd-go">${t('Télécharger')}</button>
      <button class="upd-x" aria-label="${t('Fermer')}">✕</button>`;
    bar.querySelector('.upd-go').addEventListener('click', () => api.open_url(info.url));
    bar.querySelector('.upd-x').addEventListener('click', () => {
      try { localStorage.setItem(KEY, info.version); } catch (e) { /* ignore */ }
      bar.remove();
    });
    document.body.appendChild(bar);
  }
  if (window.pywebview && window.pywebview.api) setTimeout(check, 3000);
  else window.addEventListener('pywebviewready', () => setTimeout(check, 3000), { once: true });
})();
