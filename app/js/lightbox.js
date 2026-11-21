// Full-screen viewer: photos, videos, voice notes, slideshow, gestures.
// Classic script sharing the page's global scope (see index.html for the load order).
'use strict';

// Informations card: filled in ONE step once the new item's facts are known, so it
// doesn't empty out and jump on every swipe (it keeps the previous values meanwhile).
async function loadLbMeta(item) {
  const gen = ++_metaGen;
  const $time = document.getElementById('lb-time');
  const $loc  = document.getElementById('lb-loc');
  const $who  = document.getElementById('lb-who');
  const $goconv = document.getElementById('lb-goconv');
  const $meta = document.getElementById('lb-meta');
  let meta = {};
  try {
    if (DEMO) {
      meta = { datetime: item.datetime, lat: item.lat, lon: item.lon };
    } else {
      const r = await fetch('/api/meta?source=' + encodeURIComponent(currentSource) + '&p=' + encodeURIComponent(item.path));
      if (r.ok) meta = await r.json();
    }
  } catch { /* no facts: the card hides */ }
  if (gen !== _metaGen) return;   // already swiped further

  $time.style.display = $loc.style.display = $who.style.display = 'none';
  $goconv.hidden = true;
  if (meta.datetime) {
    const dt = new Date(meta.datetime);
    document.getElementById('lb-time-text').textContent =
      dt.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
    $time.style.display = 'inline-flex';
  }
  if (meta.lat != null && meta.lon != null) {
    const $link = document.getElementById('lb-loc-link');
    $link.href = `https://maps.apple.com/?ll=${meta.lat},${meta.lon}&z=15`;
    // place name comes from the local server (offline geocoding), never an online service
    $link.textContent = meta.place || 'Voir le lieu';
    $loc.style.display = 'inline-flex';
  }
  if (meta.chat) {   // chat media: who sent it, in which conversation
    const c = meta.chat;
    const what = c.kind === 'NOTE' ? 'Vocal de' : c.kind.startsWith('SNAP') ? 'Snap de' : 'Envoyé par';
    document.getElementById('lb-who-text').textContent =
      `${what} ${c.from}` + (c.group || c.from === 'Moi' ? ` · ${c.conv}` : '');
    const link = document.getElementById('lb-who-link');
    link.style.display = currentView === 'chats' ? 'none' : '';   // already in that conversation
    link.onclick = e => { e.preventDefault(); openInConversation(c.convId, c.ts); };
    $who.style.display = 'inline-flex';
    if (currentView !== 'chats') {   // ⋯ menu shortcut to the same place
      $goconv.hidden = false;
      $goconv.onclick = () => { lbMenu(false); openInConversation(c.convId, c.ts); };
    }
  }
  $meta.classList.toggle('empty', ![$time, $loc, $who].some(el => el.style.display !== 'none'));
}

function updateNavArrows() {
  const prev = document.getElementById('lb-prev');
  const next = document.getElementById('lb-next');
  if (prev) prev.classList.toggle('edge', lbIdx <= 0);
  if (next) next.classList.toggle('edge', lbIdx >= flatItems.length - 1);
}

// ── Lightbox ─────────────────────────────────────────────────────────────────
function openLb(idx) {
  voiceStop();   // an inline voice note would play over the viewer
  lbIdx = idx;
  $lb.classList.add('opening');
  requestAnimationFrame(() => {
    loadSlide(idx);
    $lb.classList.add('open');
    document.body.style.overflow = 'hidden';
    updateNavArrows();
  });
}
function closeLb() {
  lbMenu(false);
  setPlay(false);
  lbHoldEnd();
  lbSetClean(false);
  $lb.classList.remove('open');
  $lb.classList.remove('has-video');
  setTimeout(() => {
    $lb.classList.remove('opening');
    const v = $lbSlide.querySelector('video');
    if (v) { v.pause(); v.src = ''; }
    $lbSlide.innerHTML = '';
    $lbSlide.classList.remove('loaded');
    $lbSlide.style.cssText = '';
    document.body.style.overflow = '';
  }, 260);
}
function loadSlide(idx) {
  const item = flatItems[idx];
  if (!item) return;

  $lbSlide.classList.remove('loaded');
  $lbSlide.innerHTML = '';

  const dt = new Date(item.date + 'T12:00:00');
  $lbDate.textContent = dt.toLocaleDateString(LOCALE,
    { day: 'numeric', month: 'long', year: 'numeric' });

  if (item.type === 'audio') {
    $lb.classList.add('has-video');
    const wrap = document.createElement('div');
    wrap.className = 'audio-player';
    wrap.innerHTML = AUDIO_ICON_SVG;
    const a = document.createElement('audio');
    a.src = murl(item.path);
    a.controls = true;
    a.autoplay = true;
    a.addEventListener('loadedmetadata', () => $lbSlide.classList.add('loaded'));
    a.addEventListener('error', () => $lbSlide.classList.add('loaded'));
    wrap.appendChild(a);
    $lbSlide.appendChild(wrap);
    lbHoldZones();
  } else if (item.type === 'video') {
    $lb.classList.add('has-video');
    const v = document.createElement('video');
    v.src = murl(item.path);
    v.controls = !$lb.classList.contains('clean');
    v.autoplay = true;
    v.playsInline = true;
    v.style.cssText = 'max-width:100%;max-height:100%';
    v.addEventListener('loadedmetadata', () => $lbSlide.classList.add('loaded'));
    v.addEventListener('error', () => $lbSlide.classList.add('loaded'));
    $lbSlide.appendChild(v);
    lbHoldZones();
  } else {
    $lb.classList.remove('has-video');
    const img = new Image();
    img.alt = '';
    img.onload  = () => $lbSlide.classList.add('loaded');
    img.onerror = () => $lbSlide.classList.add('loaded');
    img.src = murl(item.path);
    $lbSlide.appendChild(img);
  }

  lbActions(item);

  loadLbMeta(item);
  autoNext();
}

// ── ⋯ menu: informations, share, copy, download, show in folder ──────────────
const $lbMenu = document.getElementById('lb-menu');
const $lbMore = document.getElementById('lb-more');
// Informations card: shown by default; hidden only once the viewer turns it off.
let lbInfoOn = (() => { try { return localStorage.getItem('memora.lbInfo') !== '0'; } catch (e) { return true; } })();

function lbMenu(open) {
  $lbMenu.hidden = !open;
  $lbMore.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function lbSetInfo(on) {
  lbInfoOn = on;
  $lb.classList.toggle('info-on', on);
  document.getElementById('lb-info-label').textContent = on ? 'Masquer les informations' : 'Informations';
  try { localStorage.setItem('memora.lbInfo', on ? '1' : '0'); } catch (e) {}
}
lbSetInfo(lbInfoOn);

function lbToast(msg) {
  let t = document.getElementById('lb-toast');
  if (!t) { t = document.createElement('div'); t.id = 'lb-toast'; $lb.appendChild(t); }
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('on'), 1800);
}

async function _lbBlob(item) {
  const r = await fetch(murl(item.path));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.blob();
}

// Wire the menu for the current item; only the actions that work here are shown.
function lbActions(item) {
  const name = item.path.split('/').pop();
  const desk = !DEMO && window.pywebview && window.pywebview.api && window.pywebview.api.reveal_media;
  const share = document.getElementById('lb-share');
  const copy = document.getElementById('lb-copy');
  const reveal = document.getElementById('lb-reveal');
  const canCopy = item.type === 'image' && window.ClipboardItem && navigator.clipboard && navigator.clipboard.write;
  copy.hidden = !canCopy;
  reveal.hidden = !desk;

  // Partager: the system share sheet when the browser has one (macOS, Windows, mobile);
  // otherwise an image goes to the clipboard and anything else is downloaded, ready to send.
  share.onclick = async () => {
    lbMenu(false);
    try {
      if (navigator.share && navigator.canShare) {
        const blob = await _lbBlob(item);
        const file = new File([blob], name, { type: blob.type });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
      }
    } catch (e) { if (e.name === 'AbortError') return; }
    if (canCopy) { await copy.onclick(); lbToast('Image copiée : colle-la où tu veux'); }
    else { $lbDl.onclick(); lbToast('Fichier téléchargé : tu peux l’envoyer'); }
  };
  copy.onclick = async () => {
    lbMenu(false);
    try {
      let blob = await _lbBlob(item);
      if (blob.type !== 'image/png') {          // the clipboard takes PNG only
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        blob = await new Promise(res => c.toBlob(res, 'image/png'));
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      lbToast('Image copiée');
    } catch (e) { lbToast('Copie impossible'); }
  };
  $lbDl.onclick = () => {
    lbMenu(false);
    const a = document.createElement('a');
    a.href = murl(item.path);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  reveal.onclick = async () => {
    lbMenu(false);
    const ok = await window.pywebview.api.reveal_media(currentSource, item.path);
    if (!ok) lbToast('Fichier introuvable');
  };
}

$lbMore.addEventListener('click', e => { e.stopPropagation(); lbMenu($lbMenu.hidden); });
document.getElementById('lb-info').addEventListener('click', () => { lbMenu(false); lbSetInfo(!lbInfoOn); });
document.addEventListener('click', e => {
  if (!$lbMenu.hidden && !e.target.closest('.lb-more')) lbMenu(false);
});

// ── Slideshow: photos stay 4 s, videos and voice notes play to the end ───────
const SLIDE_MS = 4000;
let lbPlay = false, lbTimer = 0;
function setPlay(on) {
  lbPlay = on;
  document.getElementById('lb-play').checked = on;
  autoNext();
}
function autoNext() {
  clearTimeout(lbTimer);
  if (!lbPlay) return;
  const go = () => { if (lbIdx < flatItems.length - 1) navLb(1); else setPlay(false); };
  const m = $lbSlide.querySelector('video,audio');
  if (!m) { lbTimer = setTimeout(go, SLIDE_MS); return; }
  m.addEventListener('ended', () => { if (lbPlay && m.isConnected) go(); });
  m.addEventListener('error', () => { if (lbPlay && m.isConnected) lbTimer = setTimeout(go, 1500); });
  if (m.paused) m.play().catch(() => {});
}

function navLb(dir) {
  const next = lbIdx + dir;
  if (next < 0 || next >= flatItems.length) return;
  lbIdx = next;
  updateNavArrows();

  const outX = dir < 0 ? 60 : -60;
  $lbSlide.style.transition = 'transform 200ms ease,opacity 200ms ease';
  $lbSlide.style.transform  = `translateX(${outX}px)`;
  $lbSlide.style.opacity    = '0';

  setTimeout(() => {
    $lbSlide.style.transition = 'none';
    $lbSlide.style.transform  = `translateX(${-outX}px)`;
    $lbSlide.style.opacity    = '0';
    loadSlide(lbIdx);
    requestAnimationFrame(() => {
      $lbSlide.style.transition = 'transform 240ms ease,opacity 240ms ease';
      $lbSlide.style.transform  = 'translateX(0)';
      $lbSlide.style.opacity    = '1';
    });
  }, 200);
}

// Clean display: a tap hides the buttons, the date and the informations (and the video's controls)
function lbSetClean(on) {
  $lb.classList.toggle('clean', on);
  const v = $lbSlide.querySelector('video');
  if (v) v.controls = !on;
}

// Hold on the left or right side of a video or voice note: 2× while held (like Instagram, TikTok)
let lbHoldT = 0, lbFast = false, lbFastEnd = 0;
const lbMedia = () => $lbSlide.querySelector('video,audio');
// Touch: the hold is caught by two invisible side zones over the video (clear of its full-screen button and
// progress bar), so iOS never sees a long press on the video itself (its loupe, and a restart of the video).
const LB_TOUCH = matchMedia('(pointer:coarse)').matches;
function lbHoldZones() {
  if (LB_TOUCH) $lbSlide.insertAdjacentHTML('beforeend', '<div class="lb-hold l"></div><div class="lb-hold r"></div>');
}
$lbSlide.addEventListener('touchstart', e => { if (e.target.closest('.lb-hold')) e.preventDefault(); }, { passive: false });
// changing the speed must never send the video back to its start (it reloaded on the phone)
function lbKeepTime(m, t) {
  const fix = () => { if (Math.abs(m.currentTime - t) > 1) m.currentTime = t; };
  setTimeout(fix, 150);
  m.addEventListener('loadedmetadata', fix, { once: true });
}
function lbHoldStart(x) {
  clearTimeout(lbHoldT);
  const m = lbMedia(), r = $lbWrap.getBoundingClientRect();
  if (!m || (x > r.left + r.width / 3 && x < r.right - r.width / 3)) return;
  lbHoldT = setTimeout(() => {
    lbFast = true;
    const t = m.currentTime;
    m.playbackRate = 2;
    lbKeepTime(m, t);
    if (m.paused && !m.ended) m.play().catch(() => {});
    $lb.classList.add('fast');
  }, 350);
}
function lbHoldEnd() {   // true when a 2× hold just ended (the release is not a tap or a swipe)
  clearTimeout(lbHoldT);
  if (!lbFast) return false;
  lbFast = false; lbFastEnd = performance.now();
  const m = lbMedia();
  if (m) { const t = m.currentTime; m.playbackRate = 1; lbKeepTime(m, t); }
  $lb.classList.remove('fast');
  return true;
}
// the click that follows a hold must not pause the video (its native click action)
$lbWrap.addEventListener('click', e => {
  if (performance.now() - lbFastEnd < 400) { e.preventDefault(); e.stopPropagation(); }
}, true);

// Touch / mouse gestures on lightbox
let lbT0x = 0, lbT0y = 0, lbT0 = 0, lbDrg = false;

$lbWrap.addEventListener('touchstart', e => {
  lbT0x = e.touches[0].clientX;
  lbT0y = e.touches[0].clientY;
  lbT0 = performance.now();
  lbDrg = true;
  if (e.target.closest('.lb-hold')) lbHoldStart(lbT0x);
}, { passive: true });

$lbWrap.addEventListener('touchmove', e => {
  if (!lbDrg) return;
  const dx = e.touches[0].clientX - lbT0x;
  const dy = e.touches[0].clientY - lbT0y;
  if (lbFast) { e.preventDefault(); return; }               // holding at 2×: no swipe
  if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearTimeout(lbHoldT);
  if (Math.abs(dx) > Math.abs(dy)) {
    e.preventDefault();
    $lbSlide.style.transition = 'none';
    $lbSlide.style.transform  = `translateX(${dx * 0.35}px)`;
  }
}, { passive: false });

$lbWrap.addEventListener('touchend', e => {
  if (!lbDrg) return;
  lbDrg = false;
  const dx = e.changedTouches[0].clientX - lbT0x;
  const dy = e.changedTouches[0].clientY - lbT0y;
  $lbSlide.style.transition = '';
  $lbSlide.style.transform  = '';
  if (lbHoldEnd()) return;
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && performance.now() - lbT0 < 300) lbSetClean(!$lb.classList.contains('clean'));
  else if (Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx)) closeLb();
  else if (Math.abs(dx) > 55) navLb(dx < 0 ? 1 : -1);
}, { passive: true });

// Desktop mouse drag
let lbM0 = 0, lbMDrg = false;
$lbWrap.addEventListener('mousedown', e => {
  if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;   // a touch: handled above
  lbM0 = e.clientX; lbMDrg = true; lbHoldStart(e.clientX);
});
$lbWrap.addEventListener('mousemove', e => {
  if (!lbMDrg) return;
  if (lbFast) return;
  if (Math.abs(e.clientX - lbM0) > 6) clearTimeout(lbHoldT);
  $lbSlide.style.transition = 'none';
  $lbSlide.style.transform  = `translateX(${(e.clientX - lbM0) * 0.3}px)`;
});
$lbWrap.addEventListener('mouseup', e => {
  if (!lbMDrg) return;
  lbMDrg = false;
  const dx = e.clientX - lbM0;
  $lbSlide.style.transition = '';
  $lbSlide.style.transform  = '';
  if (lbHoldEnd()) return;
  if (Math.abs(dx) > 70) navLb(dx < 0 ? 1 : -1);
  else if (Math.abs(dx) < 4 && !lbMedia()) lbSetClean(!$lb.classList.contains('clean'));   // photo: click = clean display
});
$lbWrap.addEventListener('mouseleave', () => {
  lbMDrg = false;
  lbHoldEnd();
  $lbSlide.style.transition = '';
  $lbSlide.style.transform  = '';
});

$lbClose.addEventListener('click', closeLb);
document.getElementById('lb-prev').addEventListener('click', () => navLb(-1));
document.getElementById('lb-next').addEventListener('click', () => navLb(1));
document.getElementById('lb-play').addEventListener('change', e => setPlay(e.target.checked));

document.addEventListener('keydown', e => {
  if (!$lb.classList.contains('open')) return;
  // space toggles, except where it already acts natively (players, the switch itself)
  if (e.key === ' ' && !e.target.closest('video,audio,input')) { e.preventDefault(); setPlay(!lbPlay); }
  if (e.key === 'ArrowLeft')  navLb(-1);
  if (e.key === 'ArrowRight') navLb(1);
  if (e.key === 'Escape') { if (!$lbMenu.hidden) lbMenu(false); else closeLb(); }
});

// ── Random button ────────────────────────────────────────────────────────────
document.getElementById('random-btn').addEventListener('click', () => {
  if (!flatItems.length) return;
  const idx = Math.floor(Math.random() * flatItems.length);
  openLb(idx);
});
