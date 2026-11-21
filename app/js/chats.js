// Chats view: every conversation (groups and one-to-one) shown like the real chat,
// with its voice notes, media and snaps, plus a statistics sheet per conversation.
// Classic script sharing the page's global scope (see index.html for the load order).
'use strict';

const CH = {
  list: null,          // /api/chats payload
  filter: 'all',       // all | group | private
  sort: (() => { try { return localStorage.getItem('memora.chatSort') === 'messages' ? 'messages' : 'recent'; } catch (e) { return 'recent'; } })(),
                       // recent (last message first) | messages (most messages + snaps first)
  q: '',
  conv: null,          // /api/chats/conversation payload of the open conversation
  view: 'messages',    // messages | stats
  hideUnsaved: (() => { try { return localStorage.getItem('memora.hideUnsaved') === '1'; } catch (e) { return false; } })(),
  find: '',            // text search inside the open conversation
  kind: 'all',         // message-type filter (see CH_KINDS)
  prep: null,          // rendering plan of the open conversation (see _chPrepare)
  media: [],           // lightbox items of the open conversation
  obs: null,
  listScroll: 0,
};

const CH_BLOCK = 120;                   // messages per virtualized block
const CH_GROUP_GAP = 15 * 60 * 1000;    // a new name header after 15 min of quiet
const CH_ME_COLOR = '#f23c57';          // Snapchat's red for "Moi"
const CH_COLORS = ['#3cb2e2', '#a77bf3', '#3ddc97', '#ffb347', '#ff7ad9', '#7ad1ff', '#c6e94b', '#ff9466'];
// Message-type categories of the stats, in a fixed order (validated dark palette)
const CH_CATS = [
  ['text', 'Textes', '#3987e5'], ['notes', 'Vocaux', '#d95926'], ['media', 'Médias', '#199e70'],
  ['snapsImage', 'Snaps photo', '#c98500'], ['snapsVideo', 'Snaps vidéo', '#d55181'],
  ['stickers', 'Stickers et partages', '#0ca30c'],
];
const CH_EVENTS = {
  STATUSCONVERSATIONCAPTURESCREENSHOT: 'a fait une capture d’écran',
  STATUSCONVERSATIONCAPTURERECORD: 'a enregistré l’écran',
  STATUSERASEDMESSAGE: 'a supprimé un message',
  STATUSERASEDSNAPMESSAGE: 'a supprimé un snap',
  STATUSSAVETOCAMERAROLL: 'a enregistré un média dans sa pellicule',
  STATUSSNAPSTICKERCUTOUTCAPTURE: 'a fait un sticker à partir d’un snap',
  STATUSPARTICIPANTADDED: 'a ajouté quelqu’un au groupe',
  STATUSPARTICIPANTREMOVED: 'a retiré quelqu’un du groupe',
  STATUSPARTICIPANTKICKED: 'a exclu quelqu’un du groupe',
  STATUSINVITELINKCHANGE: 'a changé le lien d’invitation',
  STATUSCALLMISSEDAUDIO: 'appel audio manqué',
  STATUSCALLMISSEDVIDEO: 'appel vidéo manqué',
};

// Message-type filters of a conversation: [key, label, test(message)].
// Photos / vidéos / vocaux = messages whose file is in the export (what can be seen).
const _chHas = (m, type) => m[4] && m[4].some(x => x && x[1] === type);
// friends.json "Source" ("added by qr code"…) → how you became friends (Stats of a one-to-one)
const CH_FRIEND_HOW = {
  'phone': 'par numéro de téléphone', 'qr code': 'par QR code', 'group chat': 'depuis un groupe',
  'added me back': 'en retour', 'username': 'par nom d’utilisateur', 'suggested': 'par suggestion',
  'mention': 'par mention', 'deep link': 'via un lien partagé', 'shared username': 'via un lien partagé',
  'shared story': 'via un lien partagé', 'display name': 'par recherche', 'official story search': 'par recherche',
  'spotlight': 'depuis Spotlight',
};
const CH_PENCIL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

// compact tools: a magnifier that opens the search field, a « filter / sort » icon that opens a menu
const CH_ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>';
const CH_ICON_SORT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M7 12h10M10 17h4"/></svg>';
function _chCloseMenus() {
  document.querySelectorAll('.ch-menu').forEach(m => { m.hidden = true; });
  document.querySelectorAll('[data-pop]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}
// a dot on the menu icon while a filter is on
function _chDots() {
  $chatsView.querySelectorAll('[data-pop]').forEach(b => b.classList.toggle('dot',
    b.dataset.pop === 'list' ? CH.filter !== 'all' : CH.kind !== 'all' || CH.hideUnsaved));
}
// every [data-pop] icon of the page (Chats, Chat Media) opens the .ch-menu right after it;
// a choice in a menu, or a tap elsewhere, closes it
document.addEventListener('click', e => {
  const pop = e.target.closest('[data-pop]');
  if (pop) {
    const menu = pop.nextElementSibling, open = menu.hidden;
    _chCloseMenus();
    menu.hidden = !open;
    pop.setAttribute('aria-expanded', String(open));
    return;
  }
  if (!e.target.closest('.ch-menu input, .ch-menu select')) _chCloseMenus();
});

const CH_KINDS = [
  ['all', 'Tout', () => true],
  ['text', 'Textes', m => (m[2] === 'TEXT' || m[2] === 'NONPARTICIPANTBOTRESPONSE') && !!m[3]],
  ['photo', 'Photos', m => _chHas(m, 'image')],
  ['video', 'Vidéos', m => m[2] !== 'NOTE' && _chHas(m, 'video')],
  ['audio', 'Vocaux', m => m[2] === 'NOTE' && m[4] && m[4].some(Boolean)],
  ['snap', 'Snaps', m => m[2].startsWith('SNAP')],
];

const _chNum = n => (n || 0).toLocaleString(LOCALE);
function _chDur(sec) {
  sec = Math.round(sec || 0);
  if (sec < 60) return `${sec} s`;
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}
const _chTime = ts => new Date(ts).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
const _chDay = ts => new Date(ts).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const _chDateShort = ts => new Date(ts).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
const _chIso = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function _chAgo(ts) {
  const days = Math.floor((Date.now() - ts) / 864e5);
  if (days < 1) return _chTime(ts);
  if (days < 7) return new Date(ts).toLocaleDateString(LOCALE, { weekday: 'short' });
  return _chDateShort(ts);
}
function _chKindLabel(kind) {
  return ({ TEXT: 'Message', NOTE: '🎤 Message vocal', MEDIA: '📷 Média', SNAP_IMAGE: '📸 Snap',
            SNAP_VIDEO: '🎥 Snap vidéo', STICKER: 'Sticker', SHARE: '↗ Partage', SHARESAVEDSTORY: '↗ Story',
            LOCATION: '📍 Position', NONPARTICIPANTBOTRESPONSE: 'My AI' })[kind] || '';
}

// ── view switching ───────────────────────────────────────────────────────────
function showChatsView() {
  document.getElementById('main-content').style.display = 'none';
  $mapView.style.cssText = 'display:none';
  $statsView.style.display = 'none';
  document.querySelector('.search-wrap').style.display = 'none';
  $souv.style.display = 'none';
  $scrub.hidden = true;
  $chatsView.style.display = 'block';
  syncMemSeg();
  if (!CH.list && !CH.conv) loadChatList();   // (a conversation left open stays open)
  else requestAnimationFrame(() => { $scroll.scrollTop = _scroll.chats || 0; });
}

// API in the app, static files in the web demo (demo/chats.json, demo/chats/conv_<id>.json,
// demo/chats/stats_<id>.json, written by build_demo.py from made-up conversations).
// Not getJSON(): a failed chats call must not switch the whole app to demo mode.
async function _chGet(api, demoFile) {
  const r = await fetch(DEMO ? DEMO_BASE + '/' + demoFile : api);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// ── conversation list ────────────────────────────────────────────────────────
function loadChatList() {   // one fetch at a time, whoever asks
  if (!CH.loading) CH.loading = _loadChatList().finally(() => { CH.loading = null; });
  return CH.loading;
}

async function _loadChatList() {
  $chatsView.innerHTML = `<div class="state-view"><div class="spinner"></div><span>Chargement des conversations…</span></div>`;
  try {
    CH.list = await _chGet('/api/chats', 'chats.json');
  } catch (e) {
    $chatsView.innerHTML = `<div class="state-view"><span>Erreur : ${esc(e.message)}</span></div>`;
    return;
  }
  renderChatList();
}

function renderChatList() {
  const d = CH.list;
  if (!d.available || !d.conversations.length) {
    $chatsView.innerHTML = `<div class="ch-empty">
      <b>Pas encore de conversations</b>
      Pour les retrouver ici, demande à Snapchat un export qui inclut l’<b>historique des discussions</b>
      (case « Chats » cochée), puis ajoute-le avec le bouton <b>+</b>.</div>`;
    return;
  }
  const t = d.totals;
  $chatsView.innerHTML = `
    <div class="ch-summary">
      <div class="ch-big">${_chNum(t.messages)} <span>messages</span>${t.snapsSent + t.snapsReceived
        ? '<button class="ch-info" id="ch-info" aria-label="À propos de ces chiffres" aria-expanded="false">i</button>' : ''}</div>
      <div class="ch-sub">${_chNum(t.conversations)} conversations · ${_chNum(t.snapsSent + t.snapsReceived)} snaps
        (${_chNum(t.snapsSent)} envoyés) · ${_chNum(t.calls)} appels${t.callSeconds ? ` (${_chDur(t.callSeconds)})` : ''}</div>
      ${t.shownRows < t.allRows ? `<div class="ch-cap">Ta version affiche les <b>${_chNum(t.shownRows)}</b> messages et snaps les plus récents,
        sur ${_chNum(t.allRows)}. <button id="ch-unlock">Tout débloquer</button></div>` : ''}
      ${t.snapsSent + t.snapsReceived ? `<div class="ch-sub ch-subnote" id="ch-subnote" hidden>Snapchat ne conserve qu’une partie de l’historique des snaps, surtout pour les années anciennes : les nombres de snaps sont inférieurs à la réalité.</div>` : ''}
    </div>
    <div class="ch-tools">
      <div class="ch-bar">
        <button class="ch-ico" data-search="ch-qbox" aria-label="Rechercher une conversation" aria-expanded="${!!CH.q}">${CH_ICON_SEARCH}</button>
        <div class="search-inner ch-qbox" id="ch-qbox"${CH.q ? '' : ' hidden'}><input type="text" id="ch-q" placeholder="Rechercher une conversation…" autocomplete="off" spellcheck="false" value="${esc(CH.q)}"></div>
        <span class="ch-bar-sp"></span>
        <div class="ch-pop">
          <button class="ch-ico" data-pop="list" aria-label="Filtrer et trier" aria-expanded="false">${CH_ICON_SORT}</button>
          <div class="ch-menu" hidden>
            <div class="ch-mh">Afficher</div>
            ${[['all', 'Toutes'], ['group', 'Groupes'], ['private', 'Privées']].map(([k, l]) =>
              `<button class="ch-chip ch-opt${CH.filter === k ? ' on' : ''}" data-f="${k}">${l}</button>`).join('')}
            <div class="ch-mh">Trier</div>
            ${[['recent', 'Récentes'], ['messages', 'Plus de messages']].map(([k, l]) =>
              `<button class="ch-opt${CH.sort === k ? ' on' : ''}" data-sort="${k}">${l}</button>`).join('')}
          </div>
        </div>
      </div>
    </div>
    <div id="ch-list"></div>`;
  const q = document.getElementById('ch-q');
  q.addEventListener('input', () => { CH.q = q.value; paintChatList(); });
  document.getElementById('ch-unlock')?.addEventListener('click', () => document.getElementById('lic-unlock')?.click());
  document.getElementById('ch-info')?.addEventListener('click', e => {   // the note on snap counts, on demand
    const note = document.getElementById('ch-subnote');
    note.hidden = !note.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!note.hidden));
  });
  $chatsView.querySelectorAll('.ch-chip').forEach(b => b.addEventListener('click', () => {
    CH.filter = b.dataset.f;
    $chatsView.querySelectorAll('.ch-chip').forEach(x => x.classList.toggle('on', x === b));
    _chDots();
    paintChatList();
  }));
  $chatsView.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => {
    if (CH.sort === b.dataset.sort) return;
    CH.sort = b.dataset.sort;
    try { localStorage.setItem('memora.chatSort', CH.sort); } catch (e) {}
    $chatsView.querySelectorAll('[data-sort]').forEach(x => x.classList.toggle('on', x === b));
    paintChatList();
  }));
  _chDots();
  paintChatList();
}

function paintChatList() {
  const q = CH.q.toLowerCase().trim();
  const convs = CH.list.conversations.filter(c =>
    (CH.filter === 'all' || (CH.filter === 'group') === c.group) && (!q || c.title.toLowerCase().includes(q)));
  // the server sends them most recent first; "Plus de messages" = the count shown on each row
  if (CH.sort === 'messages') convs.sort((a, b) => (b.messages + b.snaps) - (a.messages + a.snaps) || b.last - a.last);
  const $l = document.getElementById('ch-list');
  if (!convs.length) { $l.innerHTML = '<div class="ch-none">Aucune conversation</div>'; return; }
  $l.innerHTML = convs.map(c => {
    const prev = c.lastText ? esc(c.lastText) : esc(_chKindLabel(c.lastKind) || '');
    const who = c.lastFrom ? `${esc(c.lastFrom)} : ` : (c.lastKind && !c.lastKind.startsWith('STATUS') ? 'Toi : ' : '');
    const initial = esc([...c.title.trim()][0] || '?').toUpperCase();
    return `<button class="ch-row" data-id="${esc(c.id)}">
      <span class="ch-av${c.group ? ' grp' : ''}">${c.group ? '👥' : initial}</span>
      <span class="ch-main">
        <span class="ch-title">${esc(c.title)}</span>
        <span class="ch-prev">${who}${prev}</span>
      </span>
      <span class="ch-meta"><span>${_chAgo(c.last)}</span><small>${_chNum(c.messages + c.snaps)}</small></span>
    </button>`;
  }).join('');
}

$chatsView.addEventListener('click', e => {
  const row = e.target.closest('.ch-row');
  if (row) { openConversation(row.dataset.id); return; }
  if (e.target.closest('#ch-back')) { closeConversation(); return; }
  const ren = e.target.closest('[data-rename]');
  if (ren) { _chRename(ren); return; }
  if (e.target.closest('[data-pop]')) return;   // the page-wide handler above
  const sb = e.target.closest('[data-search]');
  if (sb) {   // the magnifier opens the field; closing it clears the search
    const box = document.getElementById(sb.dataset.search), input = box.querySelector('input');
    box.hidden = !box.hidden;
    sb.setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) input.focus();
    else if (input.value) { input.value = ''; input.dispatchEvent(new Event('input')); }
    return;
  }
  const tab = e.target.closest('[data-chview]');
  if (tab) { setConvView(tab.dataset.chview); return; }
  const kindBtn = e.target.closest('[data-kind]');
  if (kindBtn) {
    CH.kind = kindBtn.dataset.kind;
    $chatsView.querySelectorAll('[data-kind]').forEach(b => b.classList.toggle('on', b === kindBtn));
    _chDots();
    if (CH.view !== 'messages') setConvView('messages'); else renderMessages();
    return;
  }
  const unsavedBtn = e.target.closest('#ch-unsaved');
  if (unsavedBtn) {
    CH.hideUnsaved = !CH.hideUnsaved;
    unsavedBtn.classList.toggle('on', CH.hideUnsaved);
    _chDots();
    try { localStorage.setItem('memora.hideUnsaved', CH.hideUnsaved ? '1' : '0'); } catch (err) {}
    if (CH.view !== 'messages') setConvView('messages'); else renderMessages();
    return;
  }
  const th = e.target.closest('[data-mi]');
  if (th) { flatItems = CH.media; openLb(+th.dataset.mi); }
});

// ── one conversation ─────────────────────────────────────────────────────────
async function openConversation(id) {
  voiceStop();
  CH.listScroll = $scroll.scrollTop;
  $chatsView.innerHTML = `<div class="state-view"><div class="spinner"></div><span>Ouverture de la conversation…</span></div>`;
  try {
    CH.conv = await _chGet('/api/chats/conversation?id=' + encodeURIComponent(id),
                           'chats/conv_' + encodeURIComponent(id) + '.json');
  } catch (e) {
    $chatsView.innerHTML = `<div class="state-view"><span>Erreur : ${esc(e.message)}</span></div>`;
    return;
  }
  CH.view = 'messages';
  CH.find = '';
  CH.kind = 'all';
  renderConversation();
}

function closeConversation() {
  voiceStop();   // leaving the conversation: no voice note keeps playing in the background
  if (CH.obs) { CH.obs.disconnect(); CH.obs = null; }
  CH.conv = null; CH.prep = null;
  if (!CH.list) { loadChatList().then(() => { $scroll.scrollTop = CH.listScroll; }); return; }   // a name changed
  renderChatList();
  requestAnimationFrame(() => { $scroll.scrollTop = CH.listScroll; });
}

function renderConversation() {
  const c = CH.conv;
  const people = c.people.filter((p, i) => i !== c.me).map(p => p.name);
  const sub = c.group ? `${people.length + 1} participants` : '@' + esc(c.people.find((p, i) => i !== c.me)?.u || '');
  // one-to-one: the id is the friend's username (in a group, tap a sender's name instead)
  const pencil = c.group || DEMO ? '' : `<button class="ch-rename" data-rename="${esc(c.id)}" title="Renommer" aria-label="Renommer">${CH_PENCIL}</button>`;
  $chatsView.innerHTML = `
    <div class="ch-head">
      <button class="ch-back" id="ch-back" aria-label="Retour aux conversations">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <div class="ch-htxt"><div class="ch-htitle"><span class="ch-hname">${esc(c.title)}</span>${pencil}</div><div class="ch-hsub">${sub}</div></div>
      <button class="ch-ico" data-search="ch-find" aria-label="Rechercher un message" aria-expanded="${!!CH.find}">${CH_ICON_SEARCH}</button>
      <div class="ch-pop">
        <button class="ch-ico" data-pop="conv" aria-label="Filtrer et aller à une date" aria-expanded="false">${CH_ICON_SORT}</button>
        <div class="ch-menu" hidden>
          <div class="ch-mh">Afficher</div>
          ${CH_KINDS.map(([k, l, test]) => {
            const n = k === 'all' ? 0 : c.messages.reduce((a, m) => a + (test(m) ? 1 : 0), 0);
            return k === 'all' || n ? `<button class="ch-opt${CH.kind === k ? ' on' : ''}" data-kind="${k}">${l}${n ? ` <small>${_chNum(n)}</small>` : ''}</button>` : '';
          }).join('')}
          ${c.messages.some(m => m[2] === 'TEXT' && !m[3]) ? `<button class="ch-opt ch-tog${CH.hideUnsaved ? ' on' : ''}" id="ch-unsaved"
            title="Messages dont Snapchat n’a pas exporté le texte">Masquer les non enregistrés</button>` : ''}
          <div class="ch-mh">Aller à une date</div>
          <label class="ch-opt ch-date"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>Choisir une date
            <input type="date" id="ch-date" aria-label="Aller à une date"
                   min="${_chIso(c.messages[0]?.[0] || Date.now())}" max="${_chIso(c.messages[c.messages.length - 1]?.[0] || Date.now())}"></label>
        </div>
      </div>
      <div class="ch-seg" role="tablist">
        <button data-chview="messages" class="${CH.view === 'messages' ? 'on' : ''}">Messages</button>
        <button data-chview="stats" class="${CH.view === 'stats' ? 'on' : ''}">Stats</button>
      </div>
      <div class="ch-find" id="ch-find"${CH.find ? '' : ' hidden'}>
        <div class="search-inner"><input type="text" id="ch-find-q" placeholder="Rechercher un message…" autocomplete="off" spellcheck="false" value="${esc(CH.find)}"></div>
      </div>
    </div>
    <div id="ch-body"></div>`;
  if (CH.view === 'stats') renderConvStats(); else renderMessages();
  _chDots();
  const fq = document.getElementById('ch-find-q');
  let fT = 0;
  fq.addEventListener('input', () => {
    clearTimeout(fT);
    fT = setTimeout(() => { CH.find = fq.value.trim(); if (CH.view !== 'messages') setConvView('messages'); else renderMessages(); }, 250);
  });
  const dateIn = document.getElementById('ch-date');
  // the field is invisible over its button: a tap opens the picker (iOS natively, elsewhere showPicker)
  dateIn.addEventListener('click', () => { try { dateIn.showPicker(); } catch (err) { /* not supported: native tap */ } });
  dateIn.addEventListener('change', e => {
    if (!e.target.value) return;
    _chCloseMenus();
    if (CH.view !== 'messages') setConvView('messages');
    jumpToDay(e.target.value);
  });
}

function setConvView(v) {
  if (v === CH.view) return;
  CH.view = v;
  $chatsView.querySelectorAll('[data-chview]').forEach(b => b.classList.toggle('on', b.dataset.chview === v));
  if (v === 'stats') renderConvStats(); else renderMessages();
}

function _chColor(i) {
  return i === CH.conv.me ? CH_ME_COLOR : CH_COLORS[(i - (i > CH.conv.me && CH.conv.me >= 0 ? 1 : 0)) % CH_COLORS.length];
}

// Rendering plan: which messages show, where day separators and name headers go,
// and the lightbox list of every media file of the conversation.
function _chPrepare() {
  const msgs = CH.conv.messages;
  const rows = [];
  CH.media = [];
  let prevDay = '', prevSender = -1, prevTs = 0;
  const q = CH.find.toLowerCase();
  const kindTest = (CH_KINDS.find(k => k[0] === CH.kind) || CH_KINDS[0])[2];
  for (const m of msgs) {
    const [ts, s, kind, content, media, saved] = m;
    if (CH.kind !== 'all' && !kindTest(m)) continue;
    if (CH.hideUnsaved && kind === 'TEXT' && !content) continue;
    if (q && !(content && content.toLowerCase().includes(q))) continue;
    const day = _chIso(ts);
    const status = kind.startsWith('STATUS');
    const row = { m, dayBreak: day !== prevDay, header: false, mi: [] };
    if (!status) {
      row.header = row.dayBreak || s !== prevSender || ts - prevTs > CH_GROUP_GAP;
      prevSender = s; prevTs = ts;
    } else {
      prevSender = -1;
    }
    if (media) {
      for (const it of media) {
        if (!it) { row.mi.push(-1); continue; }
        const last = CH.media[CH.media.length - 1];
        if (last && last.path === it[0]) { row.mi.push(-2); continue; }   // joined clip shown once
        row.mi.push(CH.media.length);
        CH.media.push({ path: it[0], type: kind === 'NOTE' ? 'audio' : it[1], date: day, d: it[2] || 0 });
      }
    }
    prevDay = day;
    rows.push(row);
  }
  return rows;
}

// Why a message's file is missing: before / after the period the media export covers.
function _chMissing(ts, what) {
  const r = CH.conv.mediaRange || {};
  const day = _chIso(ts);
  if (r.last && day > r.last) return `${what} plus récent que ton export de médias`;
  if (r.first && day < r.first) return `${what} plus ancien que ton export de médias`;
  return `${what} non inclus dans l’export`;
}

function _chMediaHTML(row) {
  const [, , kind, content, media] = row.m;
  const parts = [];
  row.mi.forEach((mi, k) => {
    if (mi === -2) return;
    if (mi === -1) {
      parts.push(`<span class="ch-ghost">${_chMissing(row.m[0], kind === 'NOTE' ? '🎤 Vocal' : kind.startsWith('SNAP') ? 'Snap' : '📷 Média')}</span>`);
      return;
    }
    const it = CH.media[mi];
    if (it.type === 'audio') {
      parts.push(voiceHTML(murl(it.path), false, it.d));
    } else {
      parts.push(`<button class="ch-thumb${it.type === 'video' ? ' vid' : ''}" data-mi="${mi}" aria-label="Ouvrir">
        <img src="${thumbUrl(it.path)}" loading="lazy" decoding="async" alt="">${it.type === 'video' && it.d ? `<span class="ch-dur">${fmtDur(it.d)}</span>` : ''}</button>`);
    }
  });
  if (content) parts.push(`<div class="ch-text">${esc(content)}</div>`);
  return parts.join('');
}

function _chBodyHTML(row) {
  const [, , kind, content, media] = row.m;
  switch (kind) {
    case 'TEXT':
      return content ? `<div class="ch-text">${esc(content)}</div>` : '<span class="ch-ghost">Message non enregistré</span>';
    case 'NONPARTICIPANTBOTRESPONSE':
      return content ? `<div class="ch-text">${esc(content)}</div>` : '<span class="ch-ghost">Réponse de My AI</span>';
    case 'NOTE':
      return media ? _chMediaHTML(row) : `<span class="ch-ghost">${_chMissing(row.m[0], '🎤 Vocal')}</span>`;
    case 'MEDIA':
      return media ? _chMediaHTML(row) : `<span class="ch-ghost">📷 Média${content ? '' : ' non enregistré'}</span>${content ? `<div class="ch-text">${esc(content)}</div>` : ''}`;
    case 'SNAP_IMAGE': case 'SNAP_VIDEO': {
      const vid = kind === 'SNAP_VIDEO';
      const pill = `<span class="ch-pill ${vid ? 'snapv' : 'snapi'}">${vid ? '🎥 Snap vidéo' : '📸 Snap'}</span>`;
      return media ? pill + _chMediaHTML(row).replace(/<span class="ch-ghost">[^<]*<\/span>/g, '') : pill;
    }
    case 'STICKER': return '<span class="ch-pill">Sticker</span>';
    case 'SHARE': return media ? _chMediaHTML(row) : '<span class="ch-pill">↗ Partage</span>';
    case 'SHARESAVEDSTORY': return '<span class="ch-pill">↗ Story partagée</span>';
    case 'LOCATION': return '<span class="ch-pill">📍 Position partagée</span>';
    default: return `<span class="ch-pill">${esc(kind.toLowerCase())}</span>`;
  }
}

function _chRowHTML(row) {
  const [ts, s, kind] = row.m;
  const p = CH.conv.people[s] || { name: '?' };
  let h = row.dayBreak ? `<div class="ch-day" data-day="${_chIso(ts)}">${esc(_chDay(ts))}</div>` : '';
  if (kind.startsWith('STATUS')) {
    const what = CH_EVENTS[kind];
    const txt = what ? (what.startsWith('appel') ? what[0].toUpperCase() + what.slice(1) : `${p.name} ${what}`) : kind.toLowerCase();
    return h + `<div class="ch-event" title="${_chTime(ts)}">${esc(txt)}</div>`;
  }
  const color = _chColor(s);
  if (row.header) {
    const bot = kind === 'NONPARTICIPANTBOTRESPONSE';
    const name = esc((bot ? 'My AI' : p.name).toUpperCase());
    const who = CH.conv.group && !bot && !DEMO && p.u && s !== CH.conv.me   // a group member: tap to rename
      ? `<button class="ch-whon" data-rename="${esc(p.u)}" title="Renommer">${name}</button>` : name;
    h += `<div class="ch-who" style="color:${color}">${who}<span>${_chTime(ts)}</span></div>`;
  }
  return h + `<div class="ch-msg" style="--c:${color}" title="${esc(_chDateShort(ts) + ' ' + _chTime(ts))}">${_chBodyHTML(row)}</div>`;
}

function renderMessages() {
  if (CH.obs) { CH.obs.disconnect(); CH.obs = null; }
  const body = document.getElementById('ch-body');
  if (!body) return;
  CH.prep = _chPrepare();
  const rows = CH.prep;
  const c = CH.conv;
  const unsaved = c.messages.reduce((n, m) => n + (m[2] === 'TEXT' && !m[3] ? 1 : 0), 0);
  const range = c.mediaRange && c.mediaRange.first
    ? `Médias et vocaux disponibles du ${_chDateShort(c.mediaRange.first + 'T12:00:00')} au ${_chDateShort(c.mediaRange.last + 'T12:00:00')} (période de ton export).` : '';
  const nBlocks = Math.ceil(rows.length / CH_BLOCK);
  const est = i => {   // reserved height before a block is drawn (fixed up once measured)
    let h = 0;
    for (const r of rows.slice(i * CH_BLOCK, (i + 1) * CH_BLOCK)) h += 26 + (r.header ? 22 : 0) + (r.dayBreak ? 38 : 0) + (r.mi.length ? 190 : 0);
    return h;
  };
  body.innerHTML = `
    <div class="ch-note">${CH.find ? `${_chNum(rows.length)} message${rows.length > 1 ? 's' : ''} contenant « ${esc(CH.find)} »` : `${_chNum(rows.length)} élément${rows.length > 1 ? 's' : ''}`}${CH.kind !== 'all' ? ` · filtre : ${CH_KINDS.find(k => k[0] === CH.kind)[1].toLowerCase()}` : ''}${unsaved && !CH.find && CH.kind === 'all' ? ` · ${_chNum(unsaved)} messages non enregistrés ${CH.hideUnsaved ? 'masqués' : 'affichés en gris'} : Snapchat n’exporte pas leur texte.` : ''}
      ${range ? `<br>${range}` : ''}</div>
    <div class="ch-msgs">${Array.from({ length: nBlocks }, (_, i) =>
      `<div class="ch-block" data-b="${i}" style="min-height:${est(i)}px"></div>`).join('')}</div>
    ${c.mediaRange && c.mediaRange.last && rows.length && _chIso(rows[rows.length - 1].m[0]) > c.mediaRange.last
      ? `<div class="ch-endnote">Ton export de médias s’arrête au ${_chDateShort(c.mediaRange.last + 'T12:00:00')} :
         les photos, vidéos et vocaux plus récents n’y sont pas. Remonte la conversation pour les voir.</div>` : ''}`;

  const blocks = [...body.querySelectorAll('.ch-block')];
  const fill = blk => {
    if (blk.dataset.filled || !blk.offsetParent) return;   // already drawn, or view hidden
    const i = +blk.dataset.b;
    const above = blk.getBoundingClientRect().bottom <= $scroll.getBoundingClientRect().top;
    const before = blk.offsetHeight;
    blk.innerHTML = rows.slice(i * CH_BLOCK, (i + 1) * CH_BLOCK).map(_chRowHTML).join('');
    blk.dataset.filled = '1';
    blk.style.minHeight = '';
    // Keep the view still when a block above it changes height (no scroll anchoring in WebKit).
    if (above) $scroll.scrollTop += blk.offsetHeight - before;
  };
  const empty = blk => {
    if (!blk.dataset.filled || !blk.offsetParent) return;          // hidden view: keep as is
    if (blk.querySelector('.vn.playing')) return;   // keep a playing voice note on screen
    blk.style.minHeight = blk.offsetHeight + 'px';
    blk.innerHTML = '';
    delete blk.dataset.filled;
  };
  CH.blocks = blocks; CH.fill = fill;
  // A chat opens on its latest messages, like Snapchat.
  blocks.slice(-2).forEach(fill);
  $scroll.scrollTop = $scroll.scrollHeight;
  CH.obs = new IntersectionObserver(entries => {
    for (const e of entries) (e.isIntersecting ? fill : empty)(e.target);
  }, { root: $scroll, rootMargin: '1500px 0px', threshold: 0 });
  blocks.forEach(b => CH.obs.observe(b));
  requestAnimationFrame(() => { $scroll.scrollTop = $scroll.scrollHeight; });
}

// ── names given in the app (Chats/names.json) ────────────────────────────────
// The pencil of a one-to-one, or a sender's name in a group, becomes a field: Enter saves,
// Escape (or leaving it unchanged) cancels, an empty name gives back the export's.
function _chRename(btn) {
  const u = btn.dataset.rename;
  const head = btn.closest('.ch-htitle');
  const shown = head ? head.querySelector('.ch-hname') : btn;
  const cur = (CH.conv.people.find(p => p.u === u) || {}).name || CH.conv.title;
  const input = document.createElement('input');
  input.className = 'ch-rename-in';
  input.value = cur;
  input.maxLength = 60;
  input.setAttribute('aria-label', 'Renommer');
  shown.replaceWith(input);
  if (head) btn.hidden = true;
  input.focus({ preventScroll: true });
  input.select();
  let done = false;
  const finish = async save => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    const back = () => { if (input.isConnected) input.replaceWith(shown); btn.hidden = false; };
    if (!save || name === cur) { back(); return; }
    input.disabled = true;
    try {
      const r = await fetch('/api/chats/rename', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ u, name }) });
      if (!r.ok || !(await r.json()).ok) throw new Error('HTTP ' + r.status);
    } catch (e) { back(); return; }
    back();
    await _chRenamed();
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

// After a rename: the open conversation shows the new names at once; the list and the
// Chat Media grid (who sent what) are fetched again when next shown.
async function _chRenamed() {
  CH.list = null;
  delete _mediaCache.chat;
  if (listSource === 'chat') listSource = null;
  const id = CH.conv.id;
  let fresh;
  try {
    fresh = await _chGet('/api/chats/conversation?id=' + encodeURIComponent(id), 'chats/conv_' + encodeURIComponent(id) + '.json');
  } catch (e) { return; }
  if (!CH.conv || CH.conv.id !== id) return;   // closed meanwhile
  CH.conv = fresh;                             // same messages, new names
  const title = $chatsView.querySelector('.ch-hname');
  if (title) title.textContent = fresh.title;
  if (CH.view === 'stats') { renderConvStats(); return; }
  voiceStop();
  for (const blk of CH.blocks || []) {        // redraw the blocks on screen (same heights)
    if (!blk.dataset.filled) continue;
    const i = +blk.dataset.b;
    blk.innerHTML = CH.prep.slice(i * CH_BLOCK, (i + 1) * CH_BLOCK).map(_chRowHTML).join('');
  }
}

// "Amis depuis le 12 mars 2017 (9 ans), ajouté par QR code" ('' when the export says nothing)
function _chFriendLine(f) {
  if (!f) return '';
  const how = CH_FRIEND_HOW[String(f.source || '').toLowerCase().replace(/^added (by|from) /, '').trim()];
  const day = f.since ? new Date(f.since).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }).replace(/^1 /, '1er ') : '';
  if (!day) return how ? `Ajouté ${how}` : '';
  return `Amis depuis le ${day} (${fmtAge(f.since)})${how ? `, ajouté ${how}` : ''}`;
}

// ── statistics sheet ─────────────────────────────────────────────────────────
async function renderConvStats() {
  if (CH.obs) { CH.obs.disconnect(); CH.obs = null; }
  const body = document.getElementById('ch-body');
  body.innerHTML = `<div class="state-view"><div class="spinner"></div><span>Calcul des statistiques…</span></div>`;
  $scroll.scrollTop = 0;
  let s;
  try {
    s = await _chGet('/api/chats/stats?id=' + encodeURIComponent(CH.conv.id),
                     'chats/stats_' + encodeURIComponent(CH.conv.id) + '.json');
  } catch (e) {
    body.innerHTML = `<div class="state-view"><span>Erreur : ${esc(e.message)}</span></div>`;
    return;
  }
  if (CH.view !== 'stats') return;
  body.innerHTML = _chStatsHTML(s);
}

function _chStatsHTML(s) {
  const T = s.totals;
  const tot = T.total || 0;
  const snaps = (T.snapsImage || 0) + (T.snapsVideo || 0);
  const people = s.people;
  const top = people.slice(0, 12);
  const rest = people.slice(12);
  if (rest.length) {   // more than 12 people: fold the rest into "Autres"
    const o = { name: `Autres (${rest.length})`, total: 0 };
    for (const p of rest) { o.total += p.total; for (const [k] of CH_CATS) o[k] = (o[k] || 0) + (k === 'stickers' ? p.stickers + p.shares : p[k]); }
    top.push(o);
  }
  const catVal = (p, k) => k === 'stickers' ? (p.stickers || 0) + (p.shares || 0) : (p[k] || 0);
  const pmax = Math.max(1, ...top.map(p => p.total));
  const legend = `<div class="ch-legend">${CH_CATS.map(([, l, c]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div>`;
  const bars = top.map(p => `
    <div class="ch-bar-row">
      <span class="ch-bar-name">${esc(p.name)}</span>
      <span class="ch-bar-track"><span class="ch-bar" style="width:${(p.total / pmax * 100).toFixed(1)}%">${
        CH_CATS.map(([k, l, c]) => { const v = catVal(p, k); return v ? `<i style="flex:${v};background:${c}" title="${esc(p.name)} · ${l} : ${_chNum(v)}"></i>` : ''; }).join('')
      }</span></span>
      <span class="ch-bar-v">${_chNum(p.total)}</span>
    </div>`).join('');

  const months = Object.keys(s.perMonth);
  const mmax = Math.max(1, ...Object.values(s.perMonth));
  const monthBars = months.map(m => `<div class="col" title="${m} · ${_chNum(s.perMonth[m])}">
      <div class="bar" style="height:${Math.max(2, Math.round(s.perMonth[m] / mmax * 100))}px"></div></div>`).join('');
  const yearTicks = months.map((m, i) => `<span style="left:${(i / Math.max(1, months.length - 1) * 100).toFixed(2)}%">${m.endsWith('-01') || i === 0 ? m.slice(0, 4) : ''}</span>`).join('');

  const hmax = Math.max(1, ...s.heatmap.flat());
  const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const heat = s.heatmap.map((row, d) => `<div class="ch-hm-row"><span>${DAYS[d]}</span>${row.map((n, h) =>
    `<i style="background:${CAL_STEPS[n ? Math.min(5, 1 + Math.floor(n / hmax * 4.999)) : 0]}" title="${DAYS[d]} ${h} h · ${_chNum(n)}"></i>`).join('')}</div>`).join('');
  const hours = `<div class="ch-hm-row ch-hm-x"><span></span>${Array.from({ length: 24 }, (_, h) => `<b>${h % 6 === 0 ? h : ''}</b>`).join('')}</div>`;

  const cell = v => v == null ? '–' : _chNum(v);
  const table = `<table class="ch-table"><thead><tr><th></th><th>Messages</th><th>Snaps 📸</th><th>Snaps 🎥</th>
      <th>Vocaux</th><th>Médias</th><th>Relances</th><th>Réponse</th><th>La nuit</th><th>Captures</th></tr></thead><tbody>${
    people.map(p => `<tr><th>${esc(p.name)}</th><td>${cell(p.text + p.stickers + p.shares + p.notes + p.media)}</td>
      <td>${cell(p.snapsImage)}</td><td>${cell(p.snapsVideo)}</td>
      <td>${cell(p.notes)}${p.voiceSeconds ? `<small>${_chDur(p.voiceSeconds)}</small>` : ''}</td><td>${cell(p.media)}</td>
      <td>${cell(p.starts)}</td><td>${p.replyMedian == null ? '–' : _chDur(p.replyMedian)}</td>
      <td>${cell(p.night)}</td><td>${cell(p.screenshots)}</td></tr>`).join('')}</tbody></table>`;

  const leader = people[0];
  const nightOwl = people.filter(p => p.night).sort((a, b) => b.night / b.total - a.night / a.total)[0];
  const starter = people.slice().sort((a, b) => b.starts - a.starts)[0];
  const fastest = people.filter(p => p.replyMedian != null && p.total >= 20).sort((a, b) => a.replyMedian - b.replyMedian)[0];
  const snapper = people.slice().sort((a, b) => (b.snapsImage + b.snapsVideo) - (a.snapsImage + a.snapsVideo))[0];
  const awards = [
    leader && ['🏆', 'Le plus bavard', leader.name, `${_chNum(leader.total)} messages et snaps`],
    snapper && (snapper.snapsImage + snapper.snapsVideo) && ['📸', 'Roi des snaps', snapper.name, `${_chNum(snapper.snapsImage + snapper.snapsVideo)} snaps`],
    starter && starter.starts && ['💬', 'Celui qui relance', starter.name, `${_chNum(starter.starts)} fois après un silence de 6 h`],
    fastest && ['⚡', 'Le plus rapide', fastest.name, `répond en ${_chDur(fastest.replyMedian)} (médiane)`],
    nightOwl && ['🌙', 'Le noctambule', nightOwl.name, `${_chNum(nightOwl.night)} messages entre 0 h et 5 h`],
  ].filter(Boolean);

  const ev = s.events || {};
  const friend = s.group ? '' : _chFriendLine(s.friend);
  return `
    <div class="ch-stats">
      <div class="rt-hero">
        <div class="big">${_chNum(tot)}</div>
        <div class="sub">messages et snaps · depuis le ${s.first ? _chDateShort(s.first) : '–'}</div>
        ${friend ? `<div class="sub ch-friend">${esc(friend)}</div>` : ''}
      </div>
      <div class="rt-tiles">
        <div class="rt-tile"><div class="n">${_chNum(s.activeDays)}</div><div class="l">Jours actifs</div></div>
        <div class="rt-tile"><div class="n">${_chNum(s.streak.days)} j</div><div class="l">Plus longue série</div></div>
        <div class="rt-tile"><div class="n">${_chNum(snaps)}</div><div class="l">Snaps échangés</div></div>
        <div class="rt-tile"><div class="n">${_chNum(T.notes)}</div><div class="l">Vocaux${s.voiceSeconds ? ` · ${_chDur(s.voiceSeconds)} à écouter` : ''}</div></div>
      </div>
      ${awards.length ? `<div class="ch-awards">${awards.map(([i, t, n, d]) =>
        `<div class="ch-award"><span class="ic">${i}</span><span><small>${t}</small><b>${esc(n)}</b><em>${esc(d)}</em></span></div>`).join('')}</div>` : ''}
      <div class="rt-sec">Qui parle le plus</div>
      ${legend}<div class="ch-bars">${bars}</div>
      ${snaps ? `<p class="ch-foot">Snapchat ne conserve qu’une partie de l’historique des snaps, surtout pour les années anciennes : les nombres de snaps sont inférieurs à la réalité.</p>` : ''}
      ${s.locked ? lockHTML('Activité par mois, jours et heures, détail par personne, mots et emojis les plus utilisés, records.') : `
      <div class="rt-sec">Activité par mois</div>
      <div class="ch-months">${monthBars}</div><div class="ch-years">${yearTicks}</div>
      <div class="rt-sec">Jours et heures</div>
      <div class="ch-hm">${heat}${hours}</div>
      <div class="rt-sec">Détail par personne</div>
      <div class="ch-table-wrap">${table}</div>
      <p class="ch-foot">Relances : premier message après 6 h de silence. Réponse : temps médian avant de répondre à quelqu’un d’autre.</p>
      ${s.topWords.length ? `<div class="rt-sec">Mots les plus utilisés</div>
        <div class="ch-words">${s.topWords.map(([w, n]) => `<span title="${_chNum(n)} fois">${esc(w)} <small>${_chNum(n)}</small></span>`).join('')}</div>` : ''}
      ${s.topEmojis.length ? `<div class="rt-sec">Emojis</div>
        <div class="ch-words emo">${s.topEmojis.map(([w, n]) => `<span title="${_chNum(n)} fois">${w} <small>${_chNum(n)}</small></span>`).join('')}</div>` : ''}
      <div class="rt-sec">Records</div>
      <div class="sub" style="color:#bbb;font-size:13px;line-height:1.7">
        ${s.busiestDay ? `Jour le plus actif : <b>${_chDateShort(s.busiestDay.date + 'T12:00:00')}</b> (${_chNum(s.busiestDay.n)} messages)<br>` : ''}
        ${s.streak.days > 1 ? `Plus longue série : <b>${_chNum(s.streak.days)} jours</b> d’affilée, du ${_chDateShort(s.streak.from + 'T12:00:00')} au ${_chDateShort(s.streak.to + 'T12:00:00')}<br>` : ''}
        ${ev.screenshots ? `Captures d’écran : <b>${_chNum(ev.screenshots)}</b><br>` : ''}
        ${ev.erased ? `Messages effacés : <b>${_chNum(ev.erased)}</b><br>` : ''}
        ${T.saved != null ? `Messages enregistrés dans la conversation : <b>${_chNum(T.saved)}</b>` : ''}
      </div>
      <p class="ch-foot">Le texte des messages non enregistrés n’est pas dans l’export Snapchat : ils sont comptés, mais pas dans les mots.</p>`}
    </div>`;
}

// From the lightbox (Chat Media tab): open the conversation of a media, at its day.
async function openInConversation(convId, ts) {
  closeLb();
  document.querySelector('.tab[data-view="chats"]')?.click();
  if (!CH.list) await loadChatList();
  await openConversation(convId);
  requestAnimationFrame(() => jumpToDay(_chIso(ts)));
}

// Scroll the open conversation to the first message of a day (or the next day with messages).
function jumpToDay(iso) {
  const rows = CH.prep;
  if (!rows || !rows.length) return;
  let i = rows.findIndex(r => _chIso(r.m[0]) >= iso);
  if (i < 0) i = rows.length - 1;
  const blk = CH.blocks[Math.floor(i / CH_BLOCK)];
  CH.fill(blk);
  const day = _chIso(rows[i].m[0]);
  const el = blk.querySelector(`.ch-day[data-day="${day}"]`) || blk;
  const head = $chatsView.querySelector('.ch-head');
  $scroll.scrollTop += el.getBoundingClientRect().top - $scroll.getBoundingClientRect().top - (head ? head.offsetHeight : 0) - 8;
}
