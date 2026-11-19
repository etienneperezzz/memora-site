// Carte view: a spinning globe (MapLibre GL + supercluster), or the flat Leaflet map when the
// machine has no WebGL (GPU disabled, VM, remote desktop), and the switch back to the list.
// Classic script sharing the page's global scope (see index.html for the load order).
'use strict';

// ── Map view (Snap-Map-style) ────────────────────────────────────────────────
const $mapView = document.getElementById('map-view');
const $statsView = document.getElementById('stats-view');
let _map = null, _ready = null, _flat = false, _geoLoaded = false, _statsLoaded = false;
let _sc = null, _spots = [];  // globe: cluster index + the spots it points into
let _cluster = null;          // flat map: the Leaflet markercluster group
const _markers = new Map();   // globe: key → maplibregl.Marker currently on the map
let _spin = true;             // the globe turns until the viewer touches it

function showListView() {
  $mapView.style.cssText = 'display:none';
  $statsView.style.display = 'none';
  $chatsView.style.display = 'none';
  document.getElementById('main-content').style.display = '';
  syncSearchBar();                                // Chat Media only; hidden on memories
  $souv.style.display = '';                       // let the [hidden] attr decide
  $scrub.hidden = (allGroups.length < 2);
  if (!$scrub.hidden) positionScrubber();
  buildFlat();   // restore flatItems to match the grid (map viewer may have replaced it)
}
// The full-width map overlay starts below the tab bar — and, in the demo, below
// the tab caption too (otherwise the overlay covers the Carte description).
function _mapTop() {
  const cap = document.getElementById('tab-caption');
  const anchor = (cap && getComputedStyle(cap).display !== 'none') ? cap : document.querySelector('.tabs');
  return anchor.getBoundingClientRect().bottom;
}
function _resizeMap() {
  if (!_map) return;
  if (_flat) _map.invalidateSize(); else { _map.resize(); _spinStep(); }
}
function showMapView() {
  document.getElementById('main-content').style.display = 'none';
  $statsView.style.display = 'none';
  $chatsView.style.display = 'none';
  document.querySelector('.search-wrap').style.display = 'none';
  $souv.style.display = 'none';
  $scrub.hidden = true;
  syncMemSeg();
  $mapView.style.cssText =
    `display:block;position:fixed;left:0;right:0;top:${_mapTop()}px;bottom:0;z-index:400`;
  _ready = _ready || initMap();
  setTimeout(_resizeMap, 50);  // size settles after layout
  if (!_geoLoaded) { _geoLoaded = true; loadGeo(); }
}
window.addEventListener('resize', () => {
  if (currentView !== 'map') return;
  $mapView.style.top = _mapTop() + 'px';
  _resizeMap();
});

const _cnt = n => n > 999 ? '999+' : ('' + n);
function _bubbleHTML(previewPath, count) {
  return `<div class="bub"><img loading="lazy" src="${thumbUrl(previewPath)}">` +
    (count > 1 ? `<div class="cnt">${_cnt(count)}</div>` : '') + `<div class="pin"></div></div>`;
}
function _openItems(items) {
  _spin = false;
  flatItems = items; openLb(0);
}
const _newestFirst = (a, b) => a.date < b.date ? 1 : (a.date > b.date ? -1 : 0);

// Basemaps the viewer can switch between (all key-free Esri raster services).
const _esri = s => `https://server.arcgisonline.com/ArcGIS/rest/services/${s}/MapServer/tile/{z}/{y}/{x}`;
const BASEMAPS = {
  'Sombre':    ['Canvas/World_Dark_Gray_Base', 'Canvas/World_Dark_Gray_Reference'],
  'Satellite': ['World_Imagery', 'Reference/World_Boundaries_and_Places'],
  'Clair':     ['Canvas/World_Light_Gray_Base', 'Canvas/World_Light_Gray_Reference'],
};

async function initMap() {
  if (_hasWebGL()) {
    try { return _initGlobe(); }
    catch (e) {   // context refused after all: clear what MapLibre left in the container
      console.warn('globe:', e);
      _map = null;
      $mapView.className = '';
      for (const c of [...$mapView.children]) if (c.id !== 'map-hud') c.remove();
    }
  }
  _flat = true;
  const cdn = 'https://cdnjs.cloudflare.com/ajax/libs/';
  _load('link', { rel: 'stylesheet', href: cdn + 'leaflet/1.9.4/leaflet.min.css' });
  _load('link', { rel: 'stylesheet', href: cdn + 'leaflet.markercluster/1.5.3/MarkerCluster.min.css' });
  await _load('script', { src: cdn + 'leaflet/1.9.4/leaflet.min.js' });
  await _load('script', { src: cdn + 'leaflet.markercluster/1.5.3/leaflet.markercluster.min.js' });
  _initFlat();
}
function _hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch (e) { return false; }
}
const _load = (tag, attrs) => new Promise((ok, ko) => {
  const el = Object.assign(document.createElement(tag), attrs);
  el.onload = ok;
  el.onerror = () => ko(new Error('chargement impossible : ' + (attrs.src || attrs.href)));
  document.head.appendChild(el);
});

async function loadGeo() {
  const hud = document.getElementById('map-hud');
  try {
    const [spots] = await Promise.all([getJSON('/api/geo?source=memories', 'geo_memories.json'), _ready]);
    if (_flat) _flatMarkers(spots); else { _spots = spots; _index(spots); _render(); }
    const total = spots.reduce((t, s) => t + s.items.length, 0);
    hud.innerHTML = tf('{n} lieux · {t} souvenirs', { n: spots.length, t: total }) +
      '<small>' + t('Les Chat Media n’ont pas de position : ils n’apparaissent pas sur la carte.') + '</small>';
    showMapNotice(spots.length);
  } catch (e) {
    hud.textContent = 'Erreur carte : ' + e.message;
  }
}

// ── Globe (MapLibre GL) ──────────────────────────────────────────────────────
function _style(name) {
  const [base, ref] = BASEMAPS[name];
  const src = s => ({ type: 'raster', tiles: [_esri(s)], tileSize: 256, maxzoom: 18, attribution: '© Esri' });
  return {
    version: 8,
    projection: { type: 'globe' },   // turns into a flat map by itself when zoomed in
    sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] },
    sources: { base: src(base), ref: src(ref) },
    layers: [
      { id: 'base', type: 'raster', source: 'base' },
      { id: 'ref', type: 'raster', source: 'ref', paint: { 'raster-opacity': .9 } },
    ],
  };
}
// Tiny basemap switcher (top right), like Leaflet's layers control on the flat map.
class BasemapControl {
  onAdd(map) {
    const box = document.createElement('div');
    box.className = 'maplibregl-ctrl maplibregl-ctrl-group map-base';
    for (const name of Object.keys(BASEMAPS)) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = name; b.className = name === 'Sombre' ? 'on' : '';
      b.onclick = () => {
        map.setStyle(_style(name));
        for (const o of box.children) o.classList.toggle('on', o === b);
      };
      box.appendChild(b);
    }
    return box;
  }
  onRemove() {}
}

// Slow spin while the globe is seen whole; stops for good at the first touch.
// ponytail: never resumes after an interaction; add an idle timer if people miss it.
function _spinStep() {
  // isMoving: one spin chain only (show / load / moveend would otherwise each start one,
  // and two chains interrupt each other every frame).
  if (_flat || !_spin || !_map || _map.isMoving() || $mapView.style.display === 'none' || _map.getZoom() > 3) return;
  const c = _map.getCenter();
  c.lng -= 4;
  _map.easeTo({ center: c, duration: 1000, easing: n => n });
}

function _initGlobe() {
  _map = new maplibregl.Map({
    container: 'map-view', style: _style('Sombre'),
    center: [0, 30], zoom: 1.4, attributionControl: { compact: true },
  });
  _map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
  _map.addControl(new BasemapControl(), 'top-right');
  // A move from the viewer (drag, wheel, touch, keys, +/- buttons) carries originalEvent;
  // resizes (tab switch, window) and our own spin don't.
  _map.on('movestart', e => { if (e.originalEvent) _spin = false; });
  // Next frame: starting an ease from inside moveend re-enters MapLibre's camera loop.
  _map.on('moveend', () => { _render(); requestAnimationFrame(_spinStep); });
  _map.on('load', _spinStep);
}

// Clusters: a bubble sits on the spot with the most memories (not on the centroid, which put
// a bubble mixing Lisbon and France in the ocean) and shows that spot's newest memory.
function _index(spots) {
  _sc = new Supercluster({
    radius: 48, maxZoom: 14,   // none from street level: each bubble then sits on its real spot
    map: p => ({ n: p.n, best: p.i, bestN: p.n }),
    reduce: (a, b) => { a.n += b.n; if (b.bestN > a.bestN) { a.bestN = b.bestN; a.best = b.best; } },
  });
  _sc.load(spots.map((s, i) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    properties: { i, n: s.items.length },
  })));
}

function _render() {
  if (!_map || !_sc) return;
  const z = Math.floor(_map.getZoom());
  // Seen whole, a globe's bounds are meaningless: take the world (the far side is hidden by MapLibre).
  const bbox = z < 5 ? [-180, -85, 180, 85] : _map.getBounds().toArray().flat();
  const seen = new Set();
  for (const f of _sc.getClusters(bbox, z)) {
    const p = f.properties, cluster = !!p.cluster;
    const key = cluster ? 'c' + p.cluster_id : 's' + p.i;
    seen.add(key);
    if (_markers.has(key)) continue;
    const spot = _spots[cluster ? p.best : p.i];
    const el = document.createElement('div');
    el.className = 'bub-anchor';
    el.innerHTML = _bubbleHTML(spot.items[0].path, p.n);
    el.onclick = e => {
      e.stopPropagation();
      if (!cluster) return _openItems(spot.items);
      const items = _sc.getLeaves(p.cluster_id, Infinity).flatMap(l => _spots[l.properties.i].items);
      _openItems(items.sort(_newestFirst));
    };
    // .bub draws itself up and to the left of the anchor (css/map.css); the pin tip is 6 px below it.
    _markers.set(key, new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [0, -6], opacityWhenCovered: '0' })
      .setLngLat([spot.lon, spot.lat]).addTo(_map));
  }
  for (const [key, m] of _markers) if (!seen.has(key)) { m.remove(); _markers.delete(key); }
}

// ── Flat map (Leaflet + markercluster), without WebGL ───────────────────────
// .bub draws itself up and to the left of the icon's corner, so the corner must be ON the
// place (Leaflet's default anchor, the centre, put every pin ~23 px off). 6 px = the pin tip.
const BUB_ICON = { className: '', iconSize: [46, 62], iconAnchor: [0, 6] };

// Same rule as the globe: a cluster sits on its busiest spot, not on markercluster's centroid.
// _wLatLng (weighted centre) is left as is: the clustering maths use it.
function _anchorClustersOnRealSpots() {
  if (L.MarkerCluster.prototype._memoraAnchor) return;
  const orig = L.MarkerCluster.prototype._recalculateBounds;
  L.MarkerCluster.prototype._recalculateBounds = function () {
    orig.call(this);
    if (!this._childCount) return;
    let best = null, bestN = -1, total = 0;
    for (const m of this._markers) {
      const n = m.spot ? m.spot.items.length : 1;
      total += n;
      if (n > bestN) { bestN = n; best = m.spot || null; this._anchor = m._latlng; }
    }
    for (const c of this._childClusters) {
      const n = c._items || c._childCount;
      total += n;
      if (n > bestN) { bestN = n; best = c._anchorSpot || null; this._anchor = c._anchor || c._latlng; }
    }
    this._items = total;
    this._anchorSpot = best;
    if (this._anchor) this._latlng = this._anchor;
  };
  L.MarkerCluster.prototype._memoraAnchor = true;
}

function _initFlat() {
  _anchorClustersOnRealSpots();
  _map = L.map('map-view', { worldCopyJump: true, zoomControl: true }).setView([30, 0], 2);
  const layer = (s, o) => L.tileLayer(_esri(s), Object.assign({ maxZoom: 18, attribution: '© Esri' }, o || {}));
  const base = {};
  for (const [name, [b, r]] of Object.entries(BASEMAPS))
    base[name] = L.layerGroup([layer(b), layer(r, { opacity: .9 })]);
  base['Sombre'].addTo(_map);
  L.control.layers(base, null, { position: 'topright' }).addTo(_map);
  _cluster = L.markerClusterGroup({
    // Bubbles split earlier as you zoom in; none from street level.
    maxClusterRadius: z => z <= 6 ? 48 : z <= 10 ? 40 : z <= 12 ? 32 : z === 13 ? 24 : z === 14 ? 18 : 12,
    disableClusteringAtZoom: 16,
    showCoverageOnHover: false, spiderfyOnMaxZoom: false,
    zoomToBoundsOnClick: false,
    iconCreateFunction(c) {
      const best = c._anchorSpot || c.getAllChildMarkers()[0].spot;
      const total = c.getAllChildMarkers().reduce((t, m) => t + m.spot.items.length, 0);
      return L.divIcon({ html: _bubbleHTML(best.items[0].path, total), ...BUB_ICON });
    }
  });
  _cluster.on('clusterclick', e =>
    _openItems(e.layer.getAllChildMarkers().flatMap(m => m.spot.items).sort(_newestFirst)));
  _map.addLayer(_cluster);
}

function _flatMarkers(spots) {
  for (const s of spots) {
    const m = L.marker([s.lat, s.lon],
      { icon: L.divIcon({ html: _bubbleHTML(s.items[0].path, s.items.length), ...BUB_ICON }) });
    m.spot = s;
    m.on('click', () => _openItems(s.items));
    _cluster.addLayer(m);
  }
}

// Why the map is empty or incomplete: memories imported without memories_history.json
// (the only source of places in a Snapchat export) have a date but no position.
async function showMapNotice(nSpots) {
  document.getElementById('map-note')?.remove();
  if (DEMO) return;
  let missingJson = false;
  try { missingJson = (await (await fetch('/api/notices')).json()).missingJson; } catch (e) {}
  if (!missingJson && nSpots) return;
  const box = document.createElement('div');
  box.id = 'map-note'; box.setAttribute('role', 'status');
  box.innerHTML = missingJson
    ? `<b>${nSpots ? 'Il manque des lieux sur ta carte' : 'Ta carte est vide'}</b>
       Le fichier <code>memories_history.json</code> n’a pas été trouvé dans ton export : c’est lui qui
       contient les lieux de tes souvenirs. Snapchat le met en général dans le <b>premier zip</b> de
       l’export (celui dont le nom ne finit pas par -2, -3…). Ajoute ce zip avec le bouton <b>+</b> :
       les lieux seront ajoutés tout seuls.`
    : `<b>Aucun souvenir géolocalisé</b> Tes souvenirs n’ont pas de position enregistrée par Snapchat.`;
  const x = document.createElement('button');
  x.className = 'x'; x.setAttribute('aria-label', 'Fermer'); x.textContent = '×';
  x.onclick = () => box.remove();
  box.prepend(x);
  $mapView.appendChild(box);
}
