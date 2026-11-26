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
    // Phone app: no Web Audio routing (it can silence a capacitor:// media in WKWebView); the bars use the travelling wave
    if (!window.MEMORA_NATIVE) _vnAnalyser();
    _vnAudio.play().catch(e => console.warn('[voice] play failed', url, e && e.name, e && e.message));
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
    _vnWave.set(url, _vnPeaksOf(audio.getChannelData(0), VN_BARS));
    _vnDur.set(url, audio.duration);
  } catch (e) { /* keep the placeholder */ }
}
// n bars of a decoded voice note: RMS of each slice, scaled to [0.16..1]
function _vnPeaksOf(d, n) {
  const step = Math.floor(d.length / n) || 1, peaks = [];
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * step, e = Math.min(d.length, j + step); j < e; j += 4) s += d[j] * d[j];
    peaks.push(Math.sqrt(s / (step / 4)));
  }
  const max = Math.max(...peaks) || 1;
  return peaks.map(p => 0.16 + 0.84 * (p / max));
}

// ── A voice note as a video (« Envoyer à » in the viewer): the purple card of the preview, its bars bouncing
// on the real level and lit as it plays, the sender and the date above. The phone app renders it natively in
// a few seconds (VoiceVideo.swift, same drawing); here, the fallback for browsers: recorded in real time
// (canvas + the decoded audio → MediaRecorder: MP4 on Safari, WebM elsewhere), so it takes the note's length.
async function voiceVideo(url, lines, onPct) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!window.MediaRecorder || !AC || !HTMLCanvasElement.prototype.captureStream) throw new Error('unsupported');
  const ctx = new AC();
  ctx.resume();                              // still inside the tap: iOS lets the context run
  try {
    const audio = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
    // a context the browser keeps suspended never advances: give up (the caller shares the voice note itself)
    if (ctx.state !== 'running') await Promise.race([ctx.resume(), new Promise(r => setTimeout(r, 1000))]);
    if (ctx.state !== 'running') throw new Error('audio blocked');
    const dur = audio.duration, { peaks, levels, fps } = _vnBarsOf(audio), N = peaks.length;
    const W = 720, H = 1280, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#5b57d6'); bg.addColorStop(1, '#8a56d6');
    const font = '-apple-system, "Segoe UI", Roboto, sans-serif';
    const draw = t => {
      const p = Math.min(1, t / dur), lv = levels[Math.min(levels.length - 1, t * fps | 0)] || 0;
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff'; g.textAlign = 'center';
      g.font = `700 46px ${font}`; g.fillText(lines[0] || 'Vocal', W / 2, 400, W - 80);
      g.fillStyle = 'rgba(255,255,255,.75)'; g.font = `500 30px ${font}`; g.fillText(lines[1] || '', W / 2, 452, W - 80);
      const bw = 10, gap = (560 - N * bw) / (N - 1), x0 = (W - 560) / 2, cy = 680;
      for (let i = 0; i < N; i++) {
        const wave = 0.5 + 0.5 * Math.sin(t * 7 + i * 0.9);
        const h = Math.max(12, 300 * Math.min(1, peaks[i] * (0.45 + 0.9 * lv * wave)));
        g.fillStyle = i < p * N ? '#fff' : 'rgba(255,255,255,.4)';
        g.beginPath(); g.roundRect(x0 + i * (bw + gap), cy - h / 2, bw, h, 5); g.fill();
      }
      g.fillStyle = 'rgba(255,255,255,.85)'; g.font = `600 30px ${font}`;
      g.fillText(`${_vnFmt(Math.max(t, 0.01)) || '0:00'} / ${_vnFmt(dur)}`, W / 2, 900);
      g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `600 26px ${font}`; g.fillText('Memorizzz', W / 2, H - 90);
    };
    const dest = ctx.createMediaStreamDestination();
    const src = ctx.createBufferSource();
    src.buffer = audio; src.connect(dest);
    const stream = new MediaStream([...c.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
      .find(m => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2e6 });
    const chunks = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise(res => { rec.onstop = res; });
    draw(0);
    rec.start(500);
    const t0 = ctx.currentTime + 0.05;
    src.start(t0);
    await new Promise(res => {
      (function frame() {
        const t = Math.max(0, ctx.currentTime - t0);
        draw(t);
        onPct && onPct(Math.min(99, Math.round(t / dur * 100)));
        if (t < dur + 0.25) requestAnimationFrame(frame); else res();
      })();
    });
    rec.stop();
    await stopped;
    stream.getTracks().forEach(tr => tr.stop());
    return new Blob(chunks, { type: (rec.mimeType || mime || 'video/mp4').split(';')[0] });
  } finally { ctx.close(); }
}
// The video's bars (36 peaks) and the loudness of each frame (0…1, `fps` per second), from a decoded note.
function _vnBarsOf(audio, fps = 30) {
  const d = audio.getChannelData(0), step = audio.sampleRate / fps;
  const levels = [];
  for (let i = 0; i * step < d.length; i++) levels.push(_vnRms(d, i * step | 0, step | 0));
  const max = Math.max(...levels) || 1;
  return { peaks: _vnPeaksOf(d, 36), levels: levels.map(l => +(l / max).toFixed(3)), fps };
}
// The same, decoding the note here (the phone's native video, VoiceVideo.swift, draws from it).
async function voiceBars(url) {
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  return _vnBarsOf(await new AC(1, 1, 44100).decodeAudioData(await (await fetch(url)).arrayBuffer()));
}
const _vnRms = (d, i, n) => {
  let s = 0, k = 0;
  for (let j = Math.max(0, i), e = Math.min(d.length, i + n); j < e; j += 8) { s += d[j] * d[j]; k++; }
  return k ? Math.sqrt(s / k) : 0;
};

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

// Hold a voice note: it plays at 2× while held (like a video in the viewer). The click that
// follows the release is swallowed (capture phase), so it neither pauses nor seeks.
let _vnHoldT = 0, _vnFastOn = false, _vnFastEnd = 0;
function _vnRate(r) {   // a speed change must never send the note back to its start
  const t = _vnAudio.currentTime;
  _vnAudio.playbackRate = r;
  setTimeout(() => { if (Math.abs(_vnAudio.currentTime - t) > 1) _vnAudio.currentTime = t; }, 150);
}
document.addEventListener('pointerdown', e => {
  const el = e.target.closest('.vn');
  if (!el) return;
  clearTimeout(_vnHoldT);
  _vnHoldT = setTimeout(() => {
    _vnFastOn = true;
    if (el.dataset.vn !== _vnSrc || _vnAudio.paused) voiceToggle(el.dataset.vn);
    _vnRate(2);
    _vnEls(el.dataset.vn).forEach(x => x.classList.add('fast'));
  }, 350);
});
function _vnHoldEnd() {
  clearTimeout(_vnHoldT);
  if (!_vnFastOn) return;
  _vnFastOn = false; _vnFastEnd = performance.now();
  _vnRate(1);
  document.querySelectorAll('.vn.fast').forEach(x => x.classList.remove('fast'));
}
['pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, _vnHoldEnd));
document.addEventListener('pointermove', e => { if (!_vnFastOn && (Math.abs(e.movementX) + Math.abs(e.movementY)) > 8) clearTimeout(_vnHoldT); });
document.addEventListener('click', e => {
  if (performance.now() - _vnFastEnd < 400 && e.target.closest('.vn')) { e.preventDefault(); e.stopPropagation(); }
}, true);

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
