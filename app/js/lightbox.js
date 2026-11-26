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
// Three slides side by side in a track (previous, current, next), like Snapchat's Memories: a swipe drags
// the track under the finger so the next media shows while the current one is still there, and every
// navigation (tap on a side, arrow, key, slideshow) is the same slide animation. Only the current slide
// carries sound, controls, zoom and the H.264 fallback; its neighbours are preloaded previews.
const $lbTrack = document.getElementById('lb-track');
const $lbBg = $lb.querySelector('.lb-bg');
let lbSlides = [...$lbTrack.children];         // [previous, current, next]
const LB_GAP = 24;                              // px between two slides while swiping
function lbPlace() {
  lbSlides.forEach((el, i) => {
    const k = i - 1;
    el.style.transform = k ? `translateX(calc(${k * 100}% + ${k * LB_GAP}px))` : '';
    el.id = k ? '' : 'lb-slide';
    el.setAttribute('aria-hidden', k ? 'true' : 'false');
  });
  $lbSlide = lbSlides[1];
}
const lbStep = () => $lbWrap.clientWidth + LB_GAP;
function lbTrackTo(x, ms) {
  $lbTrack.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2,.8,.2,1)` : 'none';
  $lbTrack.style.transform = x ? `translateX(${x}px)` : '';
}

// fromList = opened by browsing the grid normally; only then do we move the grid to the last item on
// close. A pinned souvenir, the random "dé" or the map open with their own list → leave the grid alone.
let lbSyncOnClose = false;
function openLb(idx, fromList = false) {
  // reopened during the close animation: its delayed clean-up would empty the slides just filled
  if (lbCloseT) { clearTimeout(lbCloseT); lbCleanup(); }
  lbSyncOnClose = fromList;
  voiceStop();   // an inline voice note would play over the viewer
  lbIdx = idx;
  if ($scrub) $scrub.hidden = true;   // the scrubber must never show through the viewer
  $lb.classList.add('opening');
  requestAnimationFrame(() => {
    lbShow();
    $lb.classList.add('open');
    document.body.style.overflow = 'hidden';
  });
}
// (Re)build the three slides around lbIdx: the current one first so it loads first.
function lbShow() {
  lbAnimEnd(false);
  lbResetZoom();
  lbTrackTo(0);
  lbPlace();
  lbActivate(lbSlides[1], lbIdx, true);
  lbFill(lbSlides[0], lbIdx - 1);
  lbFill(lbSlides[2], lbIdx + 1);
  updateNavArrows();
}
// Desktop nav arrows (CSS hides them on touch): dim at the first/last item.
function updateNavArrows() {
  const prev = document.getElementById('lb-prev');
  const next = document.getElementById('lb-next');
  if (prev) prev.classList.toggle('edge', lbIdx <= 0);
  if (next) next.classList.toggle('edge', lbIdx >= flatItems.length - 1);
}
function closeLb(fromDrag = false) {
  lbMenu(false);
  setPlay(false);
  lbHoldEnd();
  lbAnimEnd(false);
  lbSetClean(false);
  $lb.classList.remove('open', 'has-video', 'ctrl-hidden', 'dragging');
  if (lbSyncOnClose && !fromDrag) lbSyncGrid();   // only when browsing the grid: leave it on the last item seen
  // the scrubber comes back only on the list, as map.js/scrubber.js decide
  if ($scrub && currentView === 'list' && allGroups.length >= 2) { $scrub.hidden = false; positionScrubber(); }
  // cut the sound at once (a drag-close still shows the frame flying back to the grid); unload after
  for (const el of lbSlides) for (const m of el.querySelectorAll('video,audio')) { m.muted = true; m.pause(); }
  lbCloseT = setTimeout(lbCleanup, 260);
}
let lbCloseT = 0;
function lbCleanup() {
  lbCloseT = 0;
  $lb.classList.remove('opening');
  for (const el of lbSlides) {
    lbTeardownMedia(el.querySelector('video,audio'));
    el.innerHTML = ''; el.dataset.idx = ''; el.classList.remove('loaded'); el.style.cssText = '';
  }
  $lbBg.style.cssText = '';
  $lb.style.removeProperty('--lb-chrome');
  lbTrackTo(0);
  lbPlace();
  document.body.style.overflow = '';
}

// Stop a media element and abort its pending network load. src='' is unreliable (keeps buffering, can
// fire a stray request to the page URL); removeAttribute + load() is the spec way to abort.
function lbTeardownMedia(m) { if (m) { m.pause(); m.removeAttribute('src'); m.load(); } }

// Scroll the grid to the item currently shown in the viewer (lbIdx moves as you swipe).
function lbSyncGrid() {
  const item = flatItems[lbIdx];
  if (!item || currentView !== 'list') return;
  const g = filtGroups.find(g => g.items.includes(item));
  if (g) scrollToDay(g.date);          // the group is remounted by the virtualizer on scroll
}
// The grid cell of the item shown, brought into view at once (no smooth scroll): the drag-to-close
// shows the grid behind the media and lands the media on it. Null when the viewer wasn't opened from it.
function lbGridCell() {
  if (!lbSyncOnClose || currentView !== 'list') return null;
  const cell = $main.querySelector(`.media-cell[data-idx="${lbIdx}"]`);
  if (!cell) { lbSyncGrid(); return null; }   // its day isn't drawn yet: scroll there, the virtualizer draws it
  const r = cell.getBoundingClientRect(), s = $scroll.getBoundingClientRect();
  if (r.top < s.top || r.bottom > s.bottom) $scroll.scrollTop += r.top - s.top - (s.height - r.height) / 2;
  return cell;
}

// A neighbour: a still preview (photo, first frame of a video muted, the voice-note icon), or empty past the ends.
function lbFill(el, idx) {
  lbTeardownMedia(el.querySelector('video,audio'));
  el.innerHTML = '';
  el.classList.remove('loaded');
  const item = flatItems[idx];
  el.dataset.idx = item ? String(idx) : '';
  if (!item) return;
  const done = () => el.classList.add('loaded');
  if (item.type === 'audio') {
    const wrap = document.createElement('div');
    wrap.className = 'audio-player';
    wrap.innerHTML = `<div class="lb-vn">${_vnPeaks(murl(item.path)).map(p => `<i style="--h:${p.toFixed(3)}"></i>`).join('')}</div>`;
    el.appendChild(wrap);
    done();
  } else if (item.type === 'video') {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'metadata';
    v.src = murl(item.path) + '#t=0.1';          // #t: Safari draws the first frame instead of black
    v.addEventListener('loadeddata', done);
    v.addEventListener('loadedmetadata', done);
    v.addEventListener('error', done);
    el.appendChild(v);
  } else {
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.onload = img.onerror = done;
    img.src = murl(item.path);
    el.appendChild(img);
  }
}
// The current slide: its preview (already loaded when it was a neighbour) gets sound, controls, the info line.
function lbActivate(el, idx, fresh = false) {
  const item = flatItems[idx];
  if (!item) return;
  if (fresh || el.dataset.idx !== String(idx) || !el.firstChild) lbFill(el, idx);
  $lb.classList.toggle('has-video', item.type !== 'image');
  $lb.classList.remove('ctrl-hidden');
  if (item.type === 'audio') {
    const a = document.createElement('audio');
    a.src = murl(item.path);
    a.autoplay = true;
    el.querySelector('.audio-player').appendChild(a);
    el.appendChild(lbBuildControls(a));
    lbVoiceBars(a, el.querySelector('.lb-vn'), murl(item.path));
  } else if (item.type === 'video') {
    const v = el.querySelector('video');
    v.muted = false;
    v.preload = 'auto';
    lbArmVideo(v, item, el);
    el.appendChild(lbBuildControls(v));
    if (v.currentTime > 0.2) v.currentTime = 0;
    v.autoplay = true;
    v.play().catch(() => {});
  }
  lbActions(item);
  loadLbMeta(item);
  autoNext();
}
// A voice note in the viewer: its bars bounce while it plays and light up as it goes (like the grid's preview).
function lbVoiceBars(a, box, url) {
  _vnDecode(url);   // the real waveform, once (voice.js)
  const bars = box.querySelectorAll('i');
  (function step() {
    if (!a.isConnected) return;   // swiped away or viewer closed (lbCleanup empties the slides)
    const peaks = _vnPeaks(url), p = a.duration ? a.currentTime / a.duration : 0, now = performance.now();
    bars.forEach((b, i) => {
      const h = a.paused ? peaks[i] : Math.min(1, peaks[i] * (0.55 + 0.75 * (0.5 + 0.5 * Math.sin(now / 140 + i * 0.9))));
      b.style.setProperty('--h', h.toFixed(3));
      b.classList.toggle('on', i < p * bars.length);
    });
    requestAnimationFrame(step);
  })();
}
// The slide leaving the centre goes back to a still preview (silent, at its start, not zoomed).
function lbDeactivate(el) {
  const idx = el.dataset.idx === '' ? -1 : +el.dataset.idx;
  const item = flatItems[idx];
  if (item && item.type === 'image') { const img = el.querySelector('img'); if (img) { img.style.transform = ''; img.style.transition = ''; } }
  else lbFill(el, idx);
  el.style.cssText = '';
}
// A video the engine can't decode (HEVC in Chromium on Linux, and on Windows without hardware
// decoding) loads with its sound only, or not at all: ask the app's server for an H.264 copy,
// made once and cached. Not on the phone or the web demo (no such server, and they play HEVC).
function lbArmVideo(v, item, el) {
  let wait = null;
  const h264 = () => {
    if (v.dataset.h264 || window.MEMORA_NATIVE || DEMO) return false;
    v.dataset.h264 = '1';
    wait = document.createElement('div');
    wait.className = 'lb-wait';
    wait.innerHTML = '<div class="spinner"></div><span>Préparation de la vidéo…</span>';
    el.appendChild(wait);
    v.src = murl(item.path) + '?h264=1';
    return true;
  };
  const ready = () => { if (wait) { wait.remove(); wait = null; } el.classList.add('loaded'); };
  v.addEventListener('loadedmetadata', () => { if (!v.videoWidth && h264()) return; ready(); });
  v.addEventListener('error', () => { if (h264()) return; ready(); });
  if (v.readyState >= 1 && !v.videoWidth) h264();   // the preview already loaded without a picture
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
  }, 4000);
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
  if (m.readyState >= 1) dur.textContent = fmtDur(m.duration | 0);
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

// The voice video's caption: « Vocal de Léa », then the group and the date.
function lbVoiceLines(item) {
  return [item.by ? `Vocal de ${item.by}` : 'Vocal', [item.in || item.conv, lbShareText(item)].filter(Boolean).join(' · ')];
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
  // « Envoyer à » (the phone's strip under the media): the same share; a voice note goes as a video of its bars
  const send = document.getElementById('lb-send');
  send.hidden = DEMO;   // the web demo: it would only download the file to the visitor's computer
  send.onclick = item.type !== 'audio' ? share.onclick : async () => {
    if (send.classList.contains('busy')) return;
    send.classList.add('busy');
    try {
      if (native && window.MEMORA_NATIVE.shareVoiceVideo) {   // the phone: made natively, in a few seconds
        try {
          const o = { ...(await voiceBars(murl(item.path))), lines: lbVoiceLines(item) };
          if (await window.MEMORA_NATIVE.shareVoiceVideo(currentSource, item.path, o, name.replace(/\.[^.]+$/, '') + '.mp4', lbShareText(item))) lbToast('Partagé');
          return;
        } catch (e) { console.warn('[voice video] native', e); }   // an app built before VoiceVideo.swift: the page makes it
      }
      const blob = await voiceVideo(murl(item.path), lbVoiceLines(item), null);
      const file = name.replace(/\.[^.]+$/, '') + (blob.type.includes('webm') ? '.webm' : '.mp4');
      if (native && window.MEMORA_NATIVE.shareFile) {
        if (await window.MEMORA_NATIVE.shareFile(blob, file, lbShareText(item))) lbToast('Partagé');
      } else if (navigator.canShare && navigator.canShare({ files: [new File([blob], file, { type: blob.type })] })) {
        await navigator.share({ files: [new File([blob], file, { type: blob.type })] });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = file; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      }
    } catch (e) {
      if (e.name !== 'AbortError') { console.warn('[voice video]', e); share.onclick(); }   // no video here: the voice note itself
    } finally { send.classList.remove('busy'); }
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

// One step left or right, always animated; a step asked while one is running finishes it at once
// first, so quick taps never skip or lose a media (WebKit's touch + emulated mouse used to fire twice).
let lbAnim = null;
function navLb(dir) {
  lbAnimEnd(true);
  const next = lbIdx + dir;
  if (next < 0 || next >= flatItems.length) { lbTrackTo(0, 200); return; }
  lbResetZoom(); lbApplyZoom(false);
  lbTrackTo(-dir * lbStep(), 240);
  lbAnim = { dir, t: setTimeout(() => lbAnimEnd(true), 260) };
}
// Land the running step: the slides rotate, the new neighbour loads. apply=false just drops it.
function lbAnimEnd(apply) {
  if (!lbAnim) return;
  const { dir, t } = lbAnim;
  clearTimeout(t);
  lbAnim = null;
  if (!apply) return;
  const old = lbSlides[1];
  if (dir > 0) lbSlides.push(lbSlides.shift()); else lbSlides.unshift(lbSlides.pop());
  lbIdx += dir;
  lbDeactivate(old);
  lbTrackTo(0);
  lbPlace();
  lbActivate(lbSlides[1], lbIdx);
  lbFill(dir > 0 ? lbSlides[2] : lbSlides[0], lbIdx + dir);
  updateNavArrows();
}

// Clean display (photo): a center tap hides the header and the informations line.
function lbSetClean(on) {
  $lb.classList.toggle('clean', on);
}

// ── Zoom / pan (photos and videos): pinch, double-tap, trackpad pinch, applied to the media element ──
// The point under the fingers (or the tap, or the cursor) stays put while the scale changes.
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
  const maxX = Math.max(0, (el.offsetWidth * lbScale - $lbWrap.clientWidth) / 2);
  const maxY = Math.max(0, (el.offsetHeight * lbScale - $lbWrap.clientHeight) / 2);
  lbTx = Math.max(-maxX, Math.min(maxX, lbTx));
  lbTy = Math.max(-maxY, Math.min(maxY, lbTy));
}
// offset of a screen point from the media's resting centre (the wrap's centre)
function lbFocal(x, y) {
  const r = $lbWrap.getBoundingClientRect();
  return [x - (r.left + r.width / 2), y - (r.top + r.height / 2)];
}
function lbZoomAt(x, y, s, anim = true) {
  if (!lbZoomEl()) return;
  s = Math.max(1, Math.min(5, s));
  const [fx, fy] = lbFocal(x, y);
  lbTx = fx - (fx - lbTx) * s / lbScale;
  lbTy = fy - (fy - lbTy) * s / lbScale;
  lbScale = s;
  if (s === 1) lbResetZoom(); else lbClampPan();
  lbApplyZoom(anim);
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

// A tap on a side third navigates at once; a tap in the center pauses a video (or toggles the clean
// display on a photo), slightly delayed so a double-tap there (zoom on that point) is not two taps.
let lbTapTimer = 0, lbLastTap = 0, lbLastTapX = 0, lbLastTapY = 0;
function lbTap(x, y) {
  const now = performance.now();
  const dbl = now - lbLastTap < 300 && Math.hypot(x - lbLastTapX, y - lbLastTapY) < 40;
  lbLastTap = now; lbLastTapX = x; lbLastTapY = y;
  if (lbScale > 1) { if (dbl) { lbLastTap = 0; lbZoomAt(x, y, 1); } return; }   // zoomed: double-tap resets
  const r = $lbWrap.getBoundingClientRect(), rel = (x - r.left) / r.width;
  if (rel < 0.34 || rel > 0.66) { lbLastTap = 0; navLb(rel < 0.34 ? -1 : 1); return; }
  clearTimeout(lbTapTimer);
  if (dbl) { lbLastTap = 0; lbZoomAt(x, y, 2.5); return; }
  lbTapTimer = setTimeout(() => {
    lbLastTap = 0;
    const m = lbMedia();
    if (m) { if (m.paused) m.play().catch(() => {}); else m.pause(); lbShowCtrl(true); }
    else lbSetClean(!$lb.classList.contains('clean'));
  }, 260);
}

// ── Drag down: the media comes off the screen and follows the finger, the grid shows behind it ──
function lbDragSet(dx, dy) {
  const p = Math.max(0, Math.min(1, dy / 350));
  $lbSlide.style.transition = 'none';
  $lbSlide.style.transform = `translate(${dx}px,${dy}px) scale(${1 - 0.4 * p})`;
  $lbBg.style.transition = 'none';
  $lbBg.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / 220));
  $lb.style.setProperty('--lb-chrome', String(Math.max(0, 1 - Math.max(0, dy) / 120)));
}
function lbDragBack() {
  $lbSlide.style.transition = 'transform 220ms cubic-bezier(.2,.8,.2,1)';
  $lbSlide.style.transform = '';
  $lbBg.style.transition = 'opacity 220ms ease';
  $lbBg.style.opacity = '';
  $lb.style.removeProperty('--lb-chrome');
  $lb.classList.remove('dragging');
}
// Released low enough: the media flies back onto its cell in the grid (or fades away), then closes.
function lbDragClose() {
  const media = lbZoomEl() || $lbSlide.firstElementChild;
  const cell = lbGridCell();
  $lbSlide.style.transition = 'transform 260ms cubic-bezier(.2,.8,.2,1), opacity 160ms ease 110ms';
  $lbBg.style.transition = 'opacity 200ms ease';
  $lbBg.style.opacity = '0';
  if (cell && media) {
    const c = cell.getBoundingClientRect(), w = $lbWrap.getBoundingClientRect();
    const s = Math.max(c.width / (media.offsetWidth || c.width), c.height / (media.offsetHeight || c.height));
    $lbSlide.style.transform = `translate(${c.left + c.width / 2 - (w.left + w.width / 2)}px,${c.top + c.height / 2 - (w.top + w.height / 2)}px) scale(${s})`;
  } else {
    $lbSlide.style.transform += ' translateY(120px) scale(.8)';
  }
  $lbSlide.style.opacity = '0';
  closeLb(true);
}

// ── Gestures: pointer events only (finger, mouse, pen) ───────────────────────
// One path for every input, so a tap is handled once: iOS also sent emulated mouse events after each
// touch, and the old touch + mouse handlers both navigated (a tap on the side skipped a media).
const lbPtrs = new Map();
let lbG = null;      // the gesture under way: {mode: tap|swipe|drag|pan|pinch|none, x0, y0, t0, …}
const lbPair = () => { const [a, b] = [...lbPtrs.values()]; return [Math.hypot(a.x - b.x, a.y - b.y), (a.x + b.x) / 2, (a.y + b.y) / 2]; };

$lbWrap.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (e.isPrimary) lbPtrs.clear();                          // first contact: a lost pointerup never turns the next touch into a pinch
  try { $lbWrap.setPointerCapture(e.pointerId); } catch (err) {}
  lbPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (lbPtrs.size === 2) {                                   // second finger: pinch
    clearTimeout(lbHoldT);
    if (lbG && lbG.mode === 'swipe') lbTrackTo(0, 200);
    if (lbG && lbG.mode === 'drag') lbDragBack();
    const [d, mx, my] = lbPair();
    lbG = { mode: 'pinch', d0: d, mx0: mx, my0: my, s0: lbScale, tx0: lbTx, ty0: lbTy };
    return;
  }
  if (lbPtrs.size > 2) return;
  lbAnimEnd(true);                                           // grab a running step: it lands, the finger takes over
  lbG = { mode: 'tap', x0: e.clientX, y0: e.clientY, t0: performance.now(), tx0: lbTx, ty0: lbTy, lastX: e.clientX, lastT: performance.now(), vx: 0, vy: 0 };
  lbHoldStart(e.clientX);                                    // self-gates to the side thirds, media only
});

$lbWrap.addEventListener('pointermove', e => {
  // Desktop: a mouse move brings the close button and the progress bar back (they auto-hide again
  // while the video keeps playing). The phone uses a center tap instead.
  if (e.pointerType === 'mouse' && !lbPtrs.size && $lb.classList.contains('has-video')) lbShowCtrl();
  const p = lbPtrs.get(e.pointerId);
  if (!p || !lbG) return;
  const now = performance.now(), dt = Math.max(1, now - (lbG.lastT || now));
  lbG.vx = (e.clientX - p.x) / dt; lbG.vy = (e.clientY - p.y) / dt; lbG.lastT = now;
  p.x = e.clientX; p.y = e.clientY;
  if (lbG.mode === 'pinch') {
    if (lbPtrs.size < 2) return;
    const [d, mx, my] = lbPair(), g = lbG;
    const s = Math.max(1, Math.min(5, g.s0 * d / g.d0));
    const [fx, fy] = lbFocal(g.mx0, g.my0);
    lbTx = fx - (fx - g.tx0) * s / g.s0 + (mx - g.mx0);
    lbTy = fy - (fy - g.ty0) * s / g.s0 + (my - g.my0);
    lbScale = s;
    if (s === 1) lbResetZoom(); else lbClampPan();
    lbApplyZoom(false);
    return;
  }
  if (lbFast || lbG.mode === 'none') return;                 // held at 2×: no swipe
  const dx = e.clientX - lbG.x0, dy = e.clientY - lbG.y0;
  if (lbG.mode === 'tap') {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    clearTimeout(lbHoldT);
    if (lbScale > 1) lbG.mode = 'pan';
    else if (Math.abs(dx) > Math.abs(dy)) lbG.mode = 'swipe';
    else if (dy > 0) {
      lbG.mode = 'drag';
      $lb.classList.add('dragging');
      lbGridCell();                                          // the grid behind already on this media
    } else lbG.mode = 'none';
  }
  if (lbG.mode === 'pan') { lbTx = lbG.tx0 + dx; lbTy = lbG.ty0 + dy; lbClampPan(); lbApplyZoom(false); }
  else if (lbG.mode === 'swipe') {
    const edge = (dx > 0 && lbIdx <= 0) || (dx < 0 && lbIdx >= flatItems.length - 1);
    lbTrackTo(edge ? dx * 0.3 : dx);                         // rubber band past the first / last media
  } else if (lbG.mode === 'drag') lbDragSet(dx, dy);
});

function lbPointerEnd(e, cancel) {
  if (!lbPtrs.has(e.pointerId)) return;
  lbPtrs.delete(e.pointerId);
  const g = lbG;
  if (!g) return;
  if (g.mode === 'pinch') {
    if (lbPtrs.size) return;                                 // one finger still down: it doesn't start a swipe
    if (lbScale <= 1) { lbResetZoom(); lbApplyZoom(true); }
    lbG = null;
    return;
  }
  lbG = null;
  if (lbHoldEnd() || cancel) {
    if (g.mode === 'swipe') lbTrackTo(0, 200);
    if (g.mode === 'drag') lbDragBack();
    return;
  }
  const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
  if (g.mode === 'tap') {
    if (performance.now() - g.t0 < 350) lbTap(e.clientX, e.clientY);
  } else if (g.mode === 'swipe') {
    const dir = dx < 0 ? 1 : -1, next = lbIdx + dir;
    const far = Math.abs(dx) > $lbWrap.clientWidth * 0.2 || (Math.abs(g.vx) > 0.45 && Math.sign(g.vx) === Math.sign(dx));
    if (far && next >= 0 && next < flatItems.length) navLb(dir); else lbTrackTo(0, 200);
  } else if (g.mode === 'drag') {
    if (dy > 120 || g.vy > 0.6) lbDragClose(); else lbDragBack();
  }
}
$lbWrap.addEventListener('pointerup', e => lbPointerEnd(e, false));
// a mouse pressed on the photo started the browser's own image drag-and-drop, which cancels the gesture
$lbWrap.addEventListener('dragstart', e => e.preventDefault());
$lbWrap.addEventListener('pointercancel', e => lbPointerEnd(e, true));

// Trackpad (Mac): pinch = zoom on the cursor, two-finger swipe left/right = next/previous media,
// two-finger scroll while zoomed = pan. One swipe moves one media, its momentum is ignored.
let lbWheelAcc = 0, lbWheelLock = false, lbWheelT = 0;
$lbWrap.addEventListener('wheel', e => {
  if (!$lb.classList.contains('open')) return;
  e.preventDefault();
  if (e.ctrlKey) { lbZoomAt(e.clientX, e.clientY, lbScale * Math.exp(-e.deltaY * 0.01), false); return; }
  if (lbScale > 1) { lbTx -= e.deltaX; lbTy -= e.deltaY; lbClampPan(); lbApplyZoom(false); return; }
  clearTimeout(lbWheelT);
  lbWheelT = setTimeout(() => { lbWheelAcc = 0; lbWheelLock = false; }, 220);
  if (lbWheelLock || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
  lbWheelAcc += e.deltaX;
  if (Math.abs(lbWheelAcc) > 60) { navLb(lbWheelAcc > 0 ? 1 : -1); lbWheelLock = true; lbWheelAcc = 0; }
}, { passive: false });

$lbClose.addEventListener('click', closeLb);
// Leaving the app or locking the phone: a video or voice note doesn't wait in the viewer (nor on the lock
// screen's player, which a paused media with a source keeps there). Close it and unload every media now:
// timers sleep in the background, so the clean-up runs at once, not after the close animation.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  voiceStop();
  if ($lb.classList.contains('open') && flatItems[lbIdx] && flatItems[lbIdx].type !== 'image') {
    closeLb();
    clearTimeout(lbCloseT); lbCleanup();
  }
  for (const m of document.querySelectorAll('video,audio')) lbTeardownMedia(m);
  lbTeardownMedia(_vnAudio);
});
document.getElementById('lb-play').addEventListener('change', e => setPlay(e.target.checked));

document.addEventListener('keydown', e => {
  if (!$lb.classList.contains('open')) return;
  // space = play/pause the current video/voice note (not the slideshow); on a photo it runs the slideshow
  if (e.key === ' ' && !e.target.closest('input,textarea,.lb-ctrl')) {
    e.preventDefault();
    const m = $lbSlide.querySelector('video,audio');
    if (m) { if (m.paused) m.play().catch(() => {}); else m.pause(); lbShowCtrl(true); }
    else setPlay(!lbPlay);
  }
  if (e.key === 'ArrowLeft')  navLb(-1);
  if (e.key === 'ArrowRight') navLb(1);
  if (e.key === 'Escape') { if (!$lbMenu.hidden) lbMenu(false); else closeLb(); }
});

// Desktop nav arrows (hidden on touch by CSS; side taps handle touch navigation)
document.getElementById('lb-prev').addEventListener('click', e => { e.stopPropagation(); navLb(-1); });
document.getElementById('lb-next').addEventListener('click', e => { e.stopPropagation(); navLb(1); });

// ── Random button ────────────────────────────────────────────────────────────
document.getElementById('random-btn').addEventListener('click', () => {
  buildFlat();                         // pick from the whole grid, not a souvenir/map list left in flatItems
  if (!flatItems.length) return;
  const idx = Math.floor(Math.random() * flatItems.length);
  openLb(idx);                         // fromList = false: a random pick must not move the grid on close
});
