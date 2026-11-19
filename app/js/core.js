// Shared state, DOM handles, demo mode and small helpers used by every view.
// Classic script sharing the page's global scope (see index.html for the load order).
'use strict';

// Voice-note icon (microphone) shown for audio-only media
const AUDIO_ICON_SVG = `<svg class="audio-icon" viewBox="0 0 24 24" fill="currentColor" aria-label="Audio">
  <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3z"/>
  <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21a1 1 0 1 0 2 0v-3.08A7 7 0 0 0 19 11z"/>
</svg>`;

// ── State ───────────────────────────────────────────────────────────────────
let allGroups   = [];
const _mediaCache = {}; // source -> groups, so re-visiting a tab is instant
let flatItems   = [];   // aligned with rendered idx values
let filtGroups  = [];
let lbIdx       = -1;
let selecting   = false;
let chosen      = new Set();
let _metaGen    = 0;

// ── Search / nav ──────────────────────────────────────────────────────────────
const MONTHS_FR = ['Janv','Févr','Mars','Avr','Mai','Juin',
                   'Juil','Août','Sept','Oct','Nov','Déc'];

// ── DOM ─────────────────────────────────────────────────────────────────────
const $main    = document.getElementById('main-content');
const $scroll  = document.getElementById('content');   // the one shared scroller
const _scroll  = {};                                    // remembered scrollTop per view
const $search  = document.getElementById('search-input');
const $lb      = document.getElementById('lightbox');
const $lbWrap  = document.getElementById('lb-wrap');
const $lbSlide = document.getElementById('lb-slide');
const $lbDate  = document.getElementById('lb-date');
const $lbClose = document.getElementById('lb-close');
const $lbDl    = document.getElementById('lb-dl');
const $selBar  = document.getElementById('sel-bar');
const $selCnt  = document.getElementById('sel-count');
const $selCancel = document.getElementById('sel-cancel');
const $chatsView = document.getElementById('chats-view');

// ── Active source (tab) ────────────────────────────────────────────────────
let currentSource = 'memories';
let currentView   = 'list';
let appImporting  = false;  // an import is running → empty views say "coming", not "none found"
let listSource    = null;   // which source is currently rendered in the list view
                            // (map/stats tabs mutate currentSource, so we can't trust it)

const sourceTitles = { memories: t('Aucun souvenir trouvé'), chat: t('Aucun média trouvé') };
const sourceLoading = { memories: t('Chargement des souvenirs…'), chat: t('Chargement des médias…') };
const sourceSearchPh = {
  memories: t('Rechercher dans les souvenirs…'),
  chat:     t('Rechercher dans les médias…'),
};

// Search bar shows only on Chat Media; memories navigate via the scrubber, map/stats/chats have none.
function syncSearchBar() {
  const el = document.querySelector('.search-wrap');
  if (el) el.style.display = (currentView === 'list' && currentSource === 'chat') ? '' : 'none';
  syncMemSeg();
}

// Mes Souvenirs has two sub-views, like a conversation (Messages | Stats): the grid
// and the stats dashboard (formerly the Rétro tab). memView is remembered across tabs.
let memView = 'list';   // list | stats
function syncMemSeg() {
  const el = document.getElementById('mem-seg');
  if (!el) return;
  const on = currentSource === 'memories' && (currentView === 'list' || currentView === 'stats');
  el.style.display = on ? '' : 'none';
  el.querySelectorAll('[data-memview]').forEach(b => b.classList.toggle('on', b.dataset.memview === memView));
}

// ── Demo mode ────────────────────────────────────────────────────────────────
// Served without the Python backend (e.g. the public web demo), the app reads
// precomputed JSON + static images from ./demo/ (built by build_demo.py). DEMO
// turns on automatically the first time an API call can't be reached.
let DEMO = (typeof window !== 'undefined' && window.MEMORA_DEMO === true) || /[?&]demo\b/.test(location.search);
const DEMO_BASE = 'demo';
async function getJSON(apiPath, demoName) {
  if (!DEMO) {
    try { const r = await fetch(apiPath); if (r.ok) return await r.json(); DEMO = true; }
    catch (e) { DEMO = true; }
  }
  const r = await fetch(DEMO_BASE + '/' + demoName);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.json();
}
const _enc = path => path.split('/').map(encodeURIComponent).join('/');

// ── Helpers ─────────────────────────────────────────────────────────────────
// The mobile app (mobile/app) sets window.MEMORA_NATIVE: files are read from the phone's
// library folder instead of the desktop server.
function murl(path) {
  if (window.MEMORA_NATIVE) return window.MEMORA_NATIVE.mediaUrl(currentSource, path);
  return DEMO ? DEMO_BASE + '/img/' + currentSource + '/' + _enc(path)
              : '/media/' + currentSource + '/' + _enc(path);
}

// ── Thumbnail URL (server-generated, or static in demo) ──────────────────────
function thumbUrl(path) {
  if (window.MEMORA_NATIVE) return window.MEMORA_NATIVE.thumbUrl(currentSource, path);
  return DEMO ? DEMO_BASE + '/thumb/' + currentSource + '/' + _enc(path) + '.jpg'
              : '/thumb/' + currentSource + '/' + _enc(path);
}

function fmtDate(d) {
  const dt   = new Date(d + 'T12:00:00');
  const now  = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const that = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const diff = Math.round((base - that) / 86400000);
  if (diff === 0) return t("Aujourd'hui");
  if (diff === 1) return t('Hier');
  if (diff < 7)  return dt.toLocaleDateString(LOCALE, { weekday: 'long' });
  return dt.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
}

// ── Formatting helpers ──────────────────────────────────────────────────────
const flagEmoji = cc => cc && cc.length === 2
  ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '🏳️';
const MONTHS3 = ['J','F','M','A','M','J','J','A','S','O','N','D'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// Media duration: 7 → "0:07", 754 → "12:34", 3725 → "1:02:05" ('' when unknown)
function fmtDur(s) {
  if (!s || !isFinite(s)) return '';
  s = Math.max(1, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
function fmtFR(d) { return new Date(d + 'T12:00:00').toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }); }
// Whole years from a date (Date, ms or ISO string) to today: "9 ans", "1 an", "moins d’un an"
function fmtAge(d) {
  const a = new Date(d), b = new Date();
  const y = b.getFullYear() - a.getFullYear() - (b.getMonth() * 32 + b.getDate() < a.getMonth() * 32 + a.getDate() ? 1 : 0);
  return y < 1 ? 'moins d’un an' : y === 1 ? '1 an' : `${y} ans`;
}
