// Souvenirs carousel: on this day, trips, seasons, random.
// Classic script sharing the page's global scope (see index.html for the load order).
'use strict';

// ── Souvenirs carousel ───────────────────────────────────────────────────────
// Cards built from the already-loaded day-groups (flashbacks / random / season)
// plus the /api/trips endpoint (voyages). Tapping a card opens its snaps in the
// existing lightbox — same pattern the map uses (flatItems = …; openLb(0)).
const $souv = document.getElementById('souvenirs');
let _souvCards = [];                 // [{items}] parallel to the rendered cards
let _tripsData = null;               // cached /api/trips result for the current source
const SEASONS = [['hiver',[12,1,2]], ['printemps',[3,4,5]], ['été',[6,7,8]], ['automne',[9,10,11]]];

async function buildSouvenirs() {
  // Souvenirs are a memories concept (chat has no trips/places).
  if (currentSource !== 'memories' || !allGroups.length) { $souv.hidden = true; return; }
  if (_tripsData === null) {
    try { _tripsData = await getJSON('/api/trips?source=memories', 'trips_memories.json'); }
    catch (e) { _tripsData = []; }
  }
  renderSouvenirs();
}

function _souvThisDay() {
  // Snaps from the same calendar day in past years (±3 days if the exact day is empty).
  const now = new Date();
  const curY = now.getFullYear();
  const ord = d => { const x = new Date(now.getFullYear(), d.getMonth(), d.getDate()); return Math.round((x - new Date(now.getFullYear(), 0, 0)) / 864e5); };
  const today = ord(now);
  const best = {};   // year -> {dist, group}
  for (const g of allGroups) {
    const y = +g.date.slice(0, 4);
    if (y >= curY) continue;
    const gd = new Date(g.date + 'T12:00:00');
    let dist = Math.abs(ord(gd) - today);
    dist = Math.min(dist, 365 - dist);           // wrap around the year
    if (dist > 3) continue;
    if (!best[y] || dist < best[y].dist) best[y] = { dist, group: g };
  }
  return Object.keys(best).sort().reverse().map(y => {
    const g = best[y].group, n = curY - (+y);
    return { kind: t('Ce jour-là'), title: n === 1 ? t('Il y a 1 an') : tf('Il y a {n} ans', { n }),
             sub: fmtFR(g.date), cover: g.items[0].path, items: g.items };
  });
}

function _souvSeasons() {
  // Busiest (year, season) buckets → "Ton été 2023".
  const buckets = {};   // "year|season" -> {items, label, year}
  for (const g of allGroups) {
    const y = g.date.slice(0, 4), mo = +g.date.slice(5, 7);
    const s = SEASONS.find(([, ms]) => ms.includes(mo));
    if (!s) continue;
    const k = y + '|' + s[0];
    (buckets[k] || (buckets[k] = { items: [], label: s[0], year: y })).items.push(...g.items);
  }
  return Object.values(buckets)
    .filter(b => b.items.length >= 8)
    .sort((a, b) => b.items.length - a.items.length)
    .slice(0, 3)
    .map(b => ({ kind: 'Rétro', title: tf('Ton {s} {y}', { s: t(b.label), y: b.year }),
                 sub: tf('{n} souvenirs', { n: b.items.length }), cover: b.items[0].path, items: b.items }));
}

function _souvRandom() {
  const g = allGroups[Math.floor(Math.random() * allGroups.length)];
  if (!g) return null;
  const it = g.items[Math.floor(Math.random() * g.items.length)];
  return { kind: t('Au hasard'), title: t('Souvenir surprise'), sub: fmtFR(g.date),
           cover: it.path, items: g.items, reroll: true };
}

function renderSouvenirs() {
  const trips = (_tripsData || []).slice(0, 6).map(trip => ({
    kind: t('Voyage'), title: tf('Voyage à {c}', { c: trip.city }),
    sub: `${new Date(trip.end + 'T12:00:00').toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' })} · ${trip.count} snaps`,
    cover: trip.cover, items: trip.items,
  }));
  const rnd = _souvRandom();
  let cards = [..._souvThisDay(), ...trips, ..._souvSeasons()];
  cards = cards.slice(0, 9);
  if (rnd) cards.push(rnd);              // always end on a surprise

  _souvCards = cards;
  if (!cards.length) { $souv.hidden = true; return; }
  $souv.hidden = false;
  $souv.innerHTML = cards.map((c, i) => `
    <div class="souv-card" data-i="${i}">
      <img src="${thumbUrl(c.cover)}" loading="lazy" decoding="async" alt="">
      <div class="souv-grad"></div>
      <div class="souv-kind">${esc(c.kind)}</div>
      ${c.reroll ? '<button class="souv-reroll" data-reroll aria-label="Un autre">↻</button>' : ''}
      <div class="souv-txt">
        <div class="souv-title">${esc(c.title)}</div>
        <div class="souv-sub">${esc(c.sub)}</div>
      </div>
    </div>`).join('');
}

$souv.addEventListener('click', e => {
  if (e.target.closest('[data-reroll]')) { renderSouvenirs(); return; }
  const card = e.target.closest('.souv-card');
  if (!card) return;
  const c = _souvCards[+card.dataset.i];
  if (c && c.items.length) { flatItems = c.items; openLb(0); }
});
