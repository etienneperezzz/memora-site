// Full-screen viewer: photos, videos, voice notes, slideshow, gestures.
// Classic script sharing the page's global scope (see index.html for the load order).
'use strict';

const CONV_ICON = '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

// The datetime of the item currently shown (for the share text); set by loadLbMeta.
let lbCurMeta = { path: '', datetime: null };
// A ready-to-edit caption: date (· heure when known).
function lbShareText(item) {
  if (lbCurMeta.path === item.path && lbCurMeta.datetime) {
    const dt = new Date(lbCurMeta.datetime);
    return `${dt.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' })} · ${dt.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })}`;
  }
  return item.date ? new Date(item.date + 'T12:00:00').toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

// Informations line: filled in ONE step once the new item's facts are known, so it
// doesn't empty out and jump on every swipe (it keeps the previous line meanwhile).
//   Memories: date · heure · lieu       Chat: date · heure · pseudo · groupe · [↪ conversation]
async function loadLbMeta(item) {
  const gen = ++_metaGen;
  const $meta = document.getElementById('lb-meta');
  const $goconv = document.getElementById('lb-goconv');
  let meta = {};
  try {
    if (DEMO) {
      meta = { datetime: item.datetime, lat: item.lat, lon: item.lon };
    } else {
      const r = await fetch('/api/meta?source=' + encodeURIComponent(currentSource) + '&p=' + encodeURIComponent(item.path));
      if (r.ok) meta = await r.json();
    }
  } catch { /* no facts: the line hides */ }
  if (gen !== _metaGen) return;   // already swiped further

  const dt = meta.datetime ? new Date(meta.datetime) : (item.date ? new Date(item.date + 'T12:00:00') : null);
  const seg = [];
  if (dt) {
    seg.push(dt.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }));
    if (meta.datetime) seg.push(dt.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }));
  }
  if (meta.lat != null && meta.lon != null)   // place name from the local server (offline), never online
    seg.push(`<a href="https://maps.apple.com/?ll=${meta.lat},${meta.lon}&z=15" target="_blank" rel="noopener">${esc(meta.place || 'Voir le lieu')}</a>`);
  let who = null;
  if (meta.chat) {   // chat media: who sent it (pseudo only), in which conversation
    const c = meta.chat;
    seg.push(esc(c.from));
    if (c.group || c.from === 'Moi') seg.push(esc(c.conv));
    if (currentView !== 'chats') who = c;   // not already in that conversation
  }
  lbCurMeta = { path: item.path, datetime: meta.datetime || null };   // for the share text
  $meta.innerHTML = seg.join(' <span class="lb-sep">·</span> ')
    + (who ? ` <button class="lb-who-btn" id="lb-who-btn" aria-label="Voir dans la conversation">${CONV_ICON}</button>` : '');
  $meta.classList.toggle('empty', !seg.length);

  $goconv.hidden = !who;
  if (who) {
    document.getElementById('lb-who-btn').onclick = () => openInConversation(who.convId, who.ts);
    $goconv.onclick = () => { lbMenu(false); openInConversation(who.convId, who.ts); };
  }
}

// ── Lightbox ─────────────────────────────────────────────────────────────────
function openLb(idx) {
  voiceStop();   // an inline voice note would play over the viewer
  lbIdx = idx;
  if ($scrub) $scrub.hidden = true;   // the scrubber must never show through the viewer
  $lb.classList.add('opening');
  requestAnimationFrame(() => {
    loadSlide(idx);
    $lb.classList.add('open');
    document.body.style.overflow = 'hidden';
    updateNavArrows();
  });
}
// Desktop nav arrows (CSS hides them on touch): dim at the first/last item.
function updateNavArrows() {
  const prev = document.getElementById('lb-prev');
  const next = document.getElementById('lb-next');
  if (prev) prev.classList.toggle('edge', lbIdx <= 0);
  if (next) next.classList.toggle('edge', lbIdx >= flatItems.length - 1);
}
function closeLb() {
  lbMenu(false);
  setPlay(false);
  lbHoldEnd();
  lbSetClean(false);
  $lb.classList.remove('open', 'has-video', 'ctrl-hidden');
  lbSyncGrid();                        // leave the grid on the last item seen, not the one opened
  // the scrubber comes back only on the list, as map.js/scrubber.js decide
  if ($scrub && currentView === 'list' && allGroups.length >= 2) { $scrub.hidden = false; positionScrubber(); }
  setTimeout(() => {
    $lb.classList.remove('opening');
    const v = $lbSlide.querySelector('video,audio');
    if (v) { v.pause(); v.src = ''; }
    $lbSlide.innerHTML = '';
    $lbSlide.classList.remove('loaded');
    $lbSlide.style.cssText = '';
    document.body.style.overflow = '';
  }, 260);
}

// Scroll the grid to the item currently shown in the viewer (lbIdx moves as you swipe).
function lbSyncGrid() {
  const item = flatItems[lbIdx];
  if (!item || currentView !== 'list') return;
  const g = filtGroups.find(g => g.items.includes(item));
  if (g) scrollToDay(g.date);          // the group is remounted by the virtualizer on scroll
}
function loadSlide(idx) {
  const item = flatItems[idx];
  if (!item) return;

  $lbSlide.classList.remove('loaded');
  $lbSlide.innerHTML = '';
  lbResetZoom();
  $lb.classList.remove('ctrl-hidden');

  if (item.type === 'audio') {
    $lb.classList.add('has-video');
    const wrap = document.createElement('div');
    wrap.className = 'audio-player';
    wrap.innerHTML = AUDIO_ICON_SVG;
    const a = document.createElement('audio');
    a.src = murl(item.path);
    a.autoplay = true;
    a.addEventListener('loadedmetadata', () => $lbSlide.classList.add('loaded'));
    a.addEventListener('error', () => $lbSlide.classList.add('loaded'));
    wrap.appendChild(a);
    $lbSlide.appendChild(wrap);
    $lbSlide.appendChild(lbBuildControls(a));
  } else if (item.type === 'video') {
    $lb.classList.add('has-video');
    const v = document.createElement('video');
    v.src = murl(item.path);
    v.autoplay = true;
    v.playsInline = true;
    v.style.cssText = 'max-width:100%;max-height:100%';
    // A video the engine can't decode (HEVC in Chromium on Linux, and on Windows without hardware
    // decoding) loads with its sound only, or not at all: ask the app's server for an H.264 copy,
    // made once and cached. Not on the phone or the web demo (no such server, and they play HEVC).
    let wait = null;
    const h264 = () => {
      if (v.dataset.h264 || window.MEMORA_NATIVE || DEMO) return false;
      v.dataset.h264 = '1';
      wait = document.createElement('div');
      wait.className = 'lb-wait';
      wait.innerHTML = '<div class="spinner"></div><span>Préparation de la vidéo…</span>';
      $lbSlide.appendChild(wait);
      v.src = murl(item.path) + '?h264=1';
      return true;
    };
    const ready = () => { if (wait) { wait.remove(); wait = null; } $lbSlide.classList.add('loaded'); };
    v.addEventListener('loadedmetadata', () => { if (!v.videoWidth && h264()) return; ready(); });
    v.addEventListener('error', () => { if (h264()) return; ready(); });
    $lbSlide.appendChild(v);
    $lbSlide.appendChild(lbBuildControls(v));
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

// ── Custom media controls: play/pause, scrubbable progress, time (no native controls) ──
const PLAY_SVG  = '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
let lbCtrlT = 0;
function lbShowCtrl(sticky) {
  clearTimeout(lbCtrlT);
  $lb.classList.remove('ctrl-hidden');
  if (!sticky) lbCtrlAutoHide();
}
function lbCtrlAutoHide() {
  clearTimeout(lbCtrlT);
  lbCtrlT = setTimeout(() => {
    const m = lbMedia();
    if (m && !m.paused) $lb.classList.add('ctrl-hidden');
  }, 2500);
}
function lbBuildControls(m) {
  const bar = document.createElement('div');
  bar.className = 'lb-ctrl';
  bar.innerHTML = `<button class="lb-pp" aria-label="Lecture ou pause">${PLAY_SVG}</button>`
    + `<span class="lb-cur">0:00</span>`
    + `<input class="lb-seek" type="range" min="0" max="1000" value="0" aria-label="Progression">`
    + `<span class="lb-dur">0:00</span>`;
  const pp = bar.querySelector('.lb-pp'), seek = bar.querySelector('.lb-seek');
  const cur = bar.querySelector('.lb-cur'), dur = bar.querySelector('.lb-dur');
  const setPP = () => { pp.innerHTML = m.paused ? PLAY_SVG : PAUSE_SVG; };
  pp.onclick = () => { if (m.paused) m.play().catch(() => {}); else m.pause(); };
  let seeking = false;
  const seekTime = () => (seek.value / 1000) * (m.duration || 0);
  seek.addEventListener('input', () => { seeking = true; cur.textContent = fmtDur(seekTime() | 0); lbShowCtrl(true); });
  seek.addEventListener('change', () => { m.currentTime = seekTime(); seeking = false; lbShowCtrl(); });
  m.addEventListener('timeupdate', () => {
    if (seeking || !m.duration) return;
    seek.value = Math.round(m.currentTime / m.duration * 1000);
    cur.textContent = fmtDur(m.currentTime | 0);
  });
  m.addEventListener('loadedmetadata', () => { dur.textContent = fmtDur(m.duration | 0); setPP(); });
  m.addEventListener('play',  () => { setPP(); lbCtrlAutoHide(); });
  m.addEventListener('pause', () => { setPP(); lbShowCtrl(true); });
  // taps on the bar operate the controls, never the viewer's tap/swipe gestures
  ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'mousedown', 'click'].forEach(ev =>
    bar.addEventListener(ev, e => e.stopPropagation()));
  setPP();
  return bar;
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
  const native = !DEMO && window.MEMORA_NATIVE;   // the phone: real files + camera roll
  const share = document.getElementById('lb-share');
  const copy = document.getElementById('lb-copy');
  const reveal = document.getElementById('lb-reveal');
  const save = document.getElementById('lb-save');
  const canCopy = item.type === 'image' && window.ClipboardItem && navigator.clipboard && navigator.clipboard.write;
  copy.hidden = !canCopy;
  reveal.hidden = !desk;
  save.hidden = !(native && window.MEMORA_NATIVE.exportItems);
  if (!save.hidden) document.getElementById('lb-save-label').textContent =
    window.MEMORA_NATIVE.exportLabel ? 'Enregistrer dans ' + window.MEMORA_NATIVE.exportLabel : 'Enregistrer';

  // Partager: on the phone the native share sheet sends the real file + a date/time caption to edit;
  // in a browser the Web Share API; otherwise an image goes to the clipboard, anything else is downloaded.
  share.onclick = async () => {
    lbMenu(false);
    const text = lbShareText(item);
    if (native && window.MEMORA_NATIVE.shareItems) {
      try { if (await window.MEMORA_NATIVE.shareItems(currentSource, [item.path], text)) lbToast('Partagé'); }
      catch (e) { lbToast('Partage impossible'); }
      return;
    }
    try {
      if (navigator.share && navigator.canShare) {
        const blob = await _lbBlob(item);
        const file = new File([blob], name, { type: blob.type });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text, title: name }); return; }
      }
    } catch (e) { if (e.name === 'AbortError') return; }
    if (canCopy) { await copy.onclick(); lbToast('Image copiée : colle-la où tu veux'); }
    else { $lbDl.onclick(); lbToast('Fichier téléchargé : tu peux l’envoyer'); }
  };
  // Enregistrer (phone): into the camera roll, with a confirmation.
  save.onclick = async () => {
    lbMenu(false);
    try { lbToast(await window.MEMORA_NATIVE.exportItems(currentSource, [item.path]) || 'Enregistré'); }
    catch (e) { lbToast('Enregistrement impossible'); }
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

// Clean display (photo): a center tap hides the header and the informations line.
function lbSetClean(on) {
  $lb.classList.toggle('clean', on);
}

// ── Zoom / pan (photos and videos): pinch + double-tap, applied to the media element ──
let lbScale = 1, lbTx = 0, lbTy = 0;
const lbZoomEl = () => $lbSlide.querySelector('img,video');
function lbResetZoom() { lbScale = 1; lbTx = 0; lbTy = 0; }
function lbApplyZoom(anim) {
  const el = lbZoomEl();
  if (!el) return;
  el.style.transition = anim ? 'transform 180ms ease' : 'none';
  // scale(1) + no offset ⇒ clear the inline transform so the open animation (CSS) is free to run
  el.style.transform = (lbScale === 1 && !lbTx && !lbTy) ? '' : `translate(${lbTx}px,${lbTy}px) scale(${lbScale})`;
}
function lbClampPan() {
  const el = lbZoomEl();
  if (!el) return;
  const r = el.getBoundingClientRect();
  const maxX = Math.max(0, (r.width * lbScale - $lbWrap.clientWidth) / 2 / lbScale + 1);
  const maxY = Math.max(0, (r.height * lbScale - $lbWrap.clientHeight) / 2 / lbScale + 1);
  lbTx = Math.max(-maxX, Math.min(maxX, lbTx));
  lbTy = Math.max(-maxY, Math.min(maxY, lbTy));
}
function lbToggleZoom() {
  if (lbScale > 1) lbResetZoom();
  else lbScale = 2.5;   // ponytail: double-tap zooms on the frame center, not the finger focal point
  lbApplyZoom(true);
}

// Hold on the left or right third of a video or voice note: 2× while held (like Instagram, TikTok)
let lbHoldT = 0, lbFast = false, lbFastEnd = 0;
const lbMedia = () => $lbSlide.querySelector('video,audio');
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

// A tap on a side third navigates; a tap in the center pauses a video (or toggles the clean
// display on a photo). Delayed slightly so a double-tap (zoom) is not read as two taps.
function lbZoneTap(x) {
  const r = $lbWrap.getBoundingClientRect(), rel = (x - r.left) / r.width;
  if (rel < 0.34) navLb(-1);
  else if (rel > 0.66) navLb(1);
  else {
    const m = lbMedia();
    if (m) { if (m.paused) m.play().catch(() => {}); else m.pause(); lbShowCtrl(true); }
    else lbSetClean(!$lb.classList.contains('clean'));
  }
}

// ── Touch gestures ───────────────────────────────────────────────────────────
let lbT0x = 0, lbT0y = 0, lbT0 = 0, lbDrg = false;
let lbPanX = 0, lbPanY = 0;                 // pan base when a zoomed drag starts
let lbPinchD = 0, lbPinchS = 1;             // pinch base distance / scale
let lbTapTimer = 0, lbLastTap = 0, lbLastTapX = 0;
const lbDist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

$lbWrap.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {             // pinch
    clearTimeout(lbHoldT); lbDrg = false;
    lbPinchD = lbDist(e.touches); lbPinchS = lbScale;
    e.preventDefault();
    return;
  }
  lbT0x = e.touches[0].clientX; lbT0y = e.touches[0].clientY;
  lbT0 = performance.now(); lbDrg = true;
  lbPanX = lbTx; lbPanY = lbTy;
  lbHoldStart(lbT0x);                        // self-gates to the side thirds, media only
}, { passive: false });

$lbWrap.addEventListener('touchmove', e => {
  if (e.touches.length === 2 && lbPinchD) {  // pinch: scale around the frame center
    lbScale = Math.max(1, Math.min(5, lbPinchS * lbDist(e.touches) / lbPinchD));
    if (lbScale === 1) lbResetZoom();
    lbApplyZoom(false);
    e.preventDefault();
    return;
  }
  if (!lbDrg) return;
  const dx = e.touches[0].clientX - lbT0x, dy = e.touches[0].clientY - lbT0y;
  if (lbFast) { e.preventDefault(); return; }               // holding at 2×: no swipe
  if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearTimeout(lbHoldT);
  if (lbScale > 1) {                                         // zoomed: pan the media
    lbTx = lbPanX + dx; lbTy = lbPanY + dy; lbClampPan(); lbApplyZoom(false);
    e.preventDefault();
    return;
  }
  if (Math.abs(dx) > Math.abs(dy)) {                         // swipe preview
    e.preventDefault();
    $lbSlide.style.transition = 'none';
    $lbSlide.style.transform  = `translateX(${dx * 0.35}px)`;
  }
}, { passive: false });

$lbWrap.addEventListener('touchend', e => {
  if (lbPinchD && e.touches.length < 2) {    // pinch ended
    lbPinchD = 0;
    if (lbScale <= 1) { lbResetZoom(); lbApplyZoom(true); }
    lbDrg = false;
    return;
  }
  if (!lbDrg) return;
  lbDrg = false;
  const dx = e.changedTouches[0].clientX - lbT0x, dy = e.changedTouches[0].clientY - lbT0y;
  $lbSlide.style.transition = '';
  $lbSlide.style.transform  = '';
  if (lbHoldEnd()) return;
  const tap = Math.abs(dx) < 10 && Math.abs(dy) < 10 && performance.now() - lbT0 < 300;
  if (lbScale > 1) {                                         // zoomed: a tap can only be a double-tap to reset
    if (tap && performance.now() - lbLastTap < 300) { clearTimeout(lbTapTimer); lbLastTap = 0; lbToggleZoom(); }
    else if (tap) { lbLastTap = performance.now(); lbLastTapX = lbT0x; }
    return;
  }
  if (tap) {
    if (performance.now() - lbLastTap < 300 && Math.abs(lbT0x - lbLastTapX) < 40) {
      clearTimeout(lbTapTimer); lbLastTap = 0; lbToggleZoom();   // double-tap: zoom in
    } else {
      lbLastTap = performance.now(); lbLastTapX = lbT0x;
      const x = lbT0x;
      lbTapTimer = setTimeout(() => { lbLastTap = 0; lbZoneTap(x); }, 290);
    }
  } else if (Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx)) closeLb();
  else if (Math.abs(dx) > 55) navLb(dx < 0 ? 1 : -1);
}, { passive: true });

// ── Desktop mouse drag ───────────────────────────────────────────────────────
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
  else if (Math.abs(dx) < 4) lbZoneTap(e.clientX);           // click = navigate / pause / clean
});
$lbWrap.addEventListener('mouseleave', () => {
  lbMDrg = false;
  lbHoldEnd();
  $lbSlide.style.transition = '';
  $lbSlide.style.transform  = '';
});
$lbWrap.addEventListener('dblclick', () => lbToggleZoom());

$lbClose.addEventListener('click', closeLb);
document.getElementById('lb-play').addEventListener('change', e => setPlay(e.target.checked));

document.addEventListener('keydown', e => {
  if (!$lb.classList.contains('open')) return;
  // space toggles, except where it already acts natively (players, the switch itself)
  if (e.key === ' ' && !e.target.closest('video,audio,input')) { e.preventDefault(); setPlay(!lbPlay); }
  if (e.key === 'ArrowLeft')  navLb(-1);
  if (e.key === 'ArrowRight') navLb(1);
  if (e.key === 'Escape') { if (!$lbMenu.hidden) lbMenu(false); else closeLb(); }
});

// Desktop nav arrows (hidden on touch by CSS; side taps handle touch navigation)
document.getElementById('lb-prev').addEventListener('click', e => { e.stopPropagation(); navLb(-1); });
document.getElementById('lb-next').addEventListener('click', e => { e.stopPropagation(); navLb(1); });

// ── Random button ────────────────────────────────────────────────────────────
document.getElementById('random-btn').addEventListener('click', () => {
  if (!flatItems.length) return;
  const idx = Math.floor(Math.random() * flatItems.length);
  openLb(idx);
});
