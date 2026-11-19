// Inline voice-note player (Chats + Chat Media grid): tap to play/pause in place,
// animated bars (real waveform once decoded, bouncing on the live level, played part lit).
// One shared <audio> for the whole app, so only one voice note plays at a time and
// playback survives the virtualized lists unmounting / remounting the element.
// Classic script sharing the page's global scope (see index.html for the load order).
'use strict';

const VN_BARS = 28;
const _vnAudio = new Audio();
_vnAudio.preload = 'none';
let _vnSrc = '';           // URL currently loaded in _vnAudio
let _vnRaf = 0;
let _vnCtx = null, _vnAn = null, _vnBins = null;   // Web Audio analyser (live level)
const _vnWave = new Map(); // url -> real peaks [0..1] (decoded on first play)
const _vnDur = new Map();  // url -> duration (s)

// Placeholder waveform, stable per file (hash of the URL) until the real one is decoded.
function _vnSeed(url) {
  let h = 2166136261;
  for (let i = 0; i < url.length; i++) { h ^= url.charCodeAt(i); h = Math.imul(h, 16777619); }
  const out = [];
  for (let i = 0; i < VN_BARS; i++) {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    const r = ((h >>> 0) % 1000) / 1000;
    const env = Math.sin(Math.PI * (i + 0.5) / VN_BARS) ** 0.6;   // softer at both ends
    out.push(0.22 + 0.78 * env * (0.35 + 0.65 * r));
  }
  return out;
}
const _vnPeaks = url => _vnWave.get(url) || _vnSeed(url);
const _vnFmt = s => !isFinite(s) || s <= 0 ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// HTML of a player. `compact` = the grid-cell variant (no time label, bars fill the cell).
function voiceHTML(url, compact, dur) {
  if (dur && !_vnDur.has(url)) _vnDur.set(url, dur);
  const bars = _vnPeaks(url).map(p => `<i style="--h:${p.toFixed(3)}"></i>`).join('');
  return `<div class="vn${compact ? ' vn-cell' : ''}${url === _vnSrc && !_vnAudio.paused ? ' playing' : ''}" data-vn="${esc(url)}">
    <button class="vn-play" aria-label="Lire le vocal"><svg viewBox="0 0 24 24"><path class="pl" d="M8 5.5v13l11-6.5z"/><path class="pa" d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z"/></svg></button>
    <div class="vn-bars">${bars}</div>
    ${compact ? '' : `<span class="vn-time">${_vnFmt(_vnDur.get(url))}</span>`}
  </div>`;
}

const _vnEls = url => document.querySelectorAll(`.vn[data-vn="${CSS.escape(url)}"]`);

function voiceToggle(url, seekFrac) {
  if (url !== _vnSrc) {
    voiceStop();
    _vnSrc = url;
    _vnAudio.src = url;
    _vnDecode(url);
  }
  if (seekFrac != null && isFinite(_vnAudio.duration)) _vnAudio.currentTime = seekFrac * _vnAudio.duration;
  else if (seekFrac != null) _vnAudio.addEventListener('loadedmetadata', () => { _vnAudio.currentTime = seekFrac * _vnAudio.duration; }, { once: true });
  if (_vnAudio.paused || seekFrac != null) {
    _vnAnalyser();
    _vnAudio.play().catch(() => {});
  } else _vnAudio.pause();
}

function voiceStop() {
  if (!_vnSrc) return;
  _vnAudio.pause();
  const prev = _vnSrc;
  _vnSrc = '';
  _vnEls(prev).forEach(_vnReset);
}

function _vnReset(el) {
  el.classList.remove('playing');
  el.style.removeProperty('--p');
  const peaks = _vnPeaks(el.dataset.vn);
  el.querySelectorAll('.vn-bars i').forEach((b, i) => { b.style.setProperty('--h', peaks[i].toFixed(3)); b.classList.remove('on'); });
  const t = el.querySelector('.vn-time');
  if (t) t.textContent = _vnFmt(_vnDur.get(el.dataset.vn));
}

// Live level: an AnalyserNode on the shared element (created once, on a user gesture).
function _vnAnalyser() {
  if (_vnCtx) { if (_vnCtx.state === 'suspended') _vnCtx.resume(); return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    _vnCtx = new AC();
    const src = _vnCtx.createMediaElementSource(_vnAudio);
    _vnAn = _vnCtx.createAnalyser();
    _vnAn.fftSize = 64;
    _vnAn.smoothingTimeConstant = 0.55;
    _vnBins = new Uint8Array(_vnAn.frequencyBinCount);
    src.connect(_vnAn); _vnAn.connect(_vnCtx.destination);
  } catch (e) { _vnAn = null; }
}

// Real waveform: decode the file once (voice notes are small) and keep VN_BARS peaks.
async function _vnDecode(url) {
  if (_vnWave.has(url)) return;
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const audio = await new AC(1, 1, 44100).decodeAudioData(buf);
    const d = audio.getChannelData(0), step = Math.floor(d.length / VN_BARS) || 1;
    const peaks = [];
    for (let i = 0; i < VN_BARS; i++) {
      let s = 0;
      for (let j = i * step, e = Math.min(d.length, j + step); j < e; j += 4) s += d[j] * d[j];
      peaks.push(Math.sqrt(s / (step / 4)));
    }
    const max = Math.max(...peaks) || 1;
    _vnWave.set(url, peaks.map(p => 0.16 + 0.84 * (p / max)));
    _vnDur.set(url, audio.duration);
  } catch (e) { /* keep the placeholder */ }
}

function _vnFrame() {
  _vnRaf = 0;
  if (!_vnSrc) return;
  const els = _vnEls(_vnSrc);
  const dur = _vnAudio.duration, t = _vnAudio.currentTime;
  const p = isFinite(dur) && dur > 0 ? t / dur : 0;
  let level = null;
  if (_vnAn && !_vnAudio.paused) {
    _vnAn.getByteFrequencyData(_vnBins);
    level = _vnBins;
  }
  const peaks = _vnPeaks(_vnSrc), now = performance.now();
  els.forEach(el => {
    el.classList.toggle('playing', !_vnAudio.paused);
    el.style.setProperty('--p', p.toFixed(4));
    const bars = el.querySelectorAll('.vn-bars i'), cut = p * bars.length;
    bars.forEach((b, i) => {
      let h = peaks[i];
      if (!_vnAudio.paused) {
        // bounce: live spectrum when available, else a soft travelling wave
        const lv = level ? level[(i * 3) % level.length] / 255
                         : 0.5 + 0.5 * Math.sin(now / 140 + i * 0.9);
        h = Math.min(1, h * (0.55 + 0.75 * lv));
      }
      b.style.setProperty('--h', h.toFixed(3));
      b.classList.toggle('on', i < cut);
    });
    const tl = el.querySelector('.vn-time');
    if (tl) tl.textContent = _vnFmt(_vnAudio.paused ? dur : t) || _vnFmt(dur);
  });
  if (!_vnAudio.paused) _vnRaf = requestAnimationFrame(_vnFrame);
}
const _vnKick = () => { if (!_vnRaf) _vnRaf = requestAnimationFrame(_vnFrame); };
['play', 'pause', 'timeupdate', 'loadedmetadata', 'seeked'].forEach(ev => _vnAudio.addEventListener(ev, _vnKick));
_vnAudio.addEventListener('loadedmetadata', () => { if (_vnSrc) _vnDur.set(_vnSrc, _vnAudio.duration); });
_vnAudio.addEventListener('ended', () => {
  const url = _vnSrc;
  _vnSrc = '';
  _vnEls(url).forEach(_vnReset);
});

// One delegated handler for every player in the page. Play button toggles; a tap on
// the bars seeks there (grid cells: the whole cell toggles, see grid.js).
document.addEventListener('click', e => {
  const el = e.target.closest('.vn');
  if (!el || el.classList.contains('vn-cell')) return;
  e.preventDefault(); e.stopPropagation();
  const bars = e.target.closest('.vn-bars');
  if (bars && el.dataset.vn === _vnSrc) {
    const r = bars.getBoundingClientRect();
    voiceToggle(el.dataset.vn, Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
  } else voiceToggle(el.dataset.vn);
});
