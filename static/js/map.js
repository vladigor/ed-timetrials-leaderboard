import { esc } from './utils.js';

// Galactic-coordinate → Leaflet (CRS.Simple) projection, matching EDAstro's galmap.
// Sol is at (0, 0, 0); z runs toward the galactic core (Sagittarius A* ≈ 25,900).
function galToLatLng(x, z) {
  const lng = (x / 81920) * 128 + 128;
  const lat = -128 - ((25000 - z) / 81920) * 128;
  return [lat, lng];
}
// Initial view. When FIT_TO_RACES is true the map frames all race markers (capped
// at FIT_MAX_ZOOM). Set it to false to force a fixed centre + zoom instead.
const FIT_TO_RACES = false;
const FIT_MAX_ZOOM = 5;
const INITIAL_CENTER = [0, 13000]; // galactic [x, z]; [0, 0] = Sol
const INITIAL_ZOOM = 4;
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

function setStatus(text, ok = true) {
  statusText.textContent = text;
  statusDot.classList.toggle('live', ok);
  statusDot.classList.toggle('error', !ok);
}

function initMap() {
  /* global L */
  const map = L.map('galaxy-map', {
    crs: L.CRS.Simple,
    minZoom: 1,
    maxZoom: 8,
    zoomControl: true,
  }).setView([-128, 128], 2);

  const tileOpts = { minZoom: 1, maxZoom: 8, maxNativeZoom: 7, noWrap: true };
  const attribution =
    'Map imagery &copy; <a href="https://edastro.com/galmap/">EDAstro.com</a> · Data: EDDN &amp; EDSM';

  L.tileLayer('https://edastro.com/galmap/tiles/galaxy/{z}/{x}/{y}.png', {
    ...tileOpts,
    attribution,
  }).addTo(map);

  L.tileLayer('https://edastro.com/galmap/tiles/regionlines/{z}/{x}/{y}.png', {
    ...tileOpts,
  }).addTo(map);

  return map;
}

function raceRowHtml(race) {
  const entries = race.entry_count === 1 ? '1 racer' : `${race.entry_count} racers`;
  return `
    <div class="map-popup-race">
      <a class="map-popup-name" href="/race/${encodeURIComponent(race.key)}">${esc(race.name)}</a>
      <div class="map-popup-meta">${esc(entries)}${race.creator ? ' · ' + esc(race.creator) : ''}</div>
    </div>`;
}

function popupHtml(system, races) {
  const header =
    races.length > 1
      ? `<div class="map-popup-sys">${esc(system)} · ${races.length} races</div>`
      : `<div class="map-popup-sys">${esc(system)}</div>`;
  return `<div class="map-popup">${header}${races.map(raceRowHtml).join('')}</div>`;
}

const DEFAULT_COLOR = '#ffcc44';
const TAG_COLORS = {
  DW3: '#ff6b6b', // Distant Worlds 3 expedition (pastel red)
  DR1: '#4aa3ff', // Distant Races 1 expedition (blue)
};

function hasTag(race, tag) {
  return (race.tags || '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .includes(tag.toLowerCase());
}

// Colour a marker by expedition tag; DW3 wins when a system has both.
function groupColor(races) {
  if (races.some((r) => hasTag(r, 'DW3'))) return TAG_COLORS.DW3;
  if (races.some((r) => hasTag(r, 'DR1'))) return TAG_COLORS.DR1;
  return DEFAULT_COLOR;
}

function addLegend(map) {
  /* global L */
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `
      <div class="map-legend-row"><span class="map-legend-dot" style="background:${TAG_COLORS.DW3}"></span>DW3 expedition</div>
      <div class="map-legend-row"><span class="map-legend-dot" style="background:${TAG_COLORS.DR1}"></span>DR1 expedition</div>
      <div class="map-legend-row"><span class="map-legend-dot" style="background:${DEFAULT_COLOR}"></span>Everything else</div>`;
    return div;
  };
  legend.addTo(map);
}

async function load() {
  const map = initMap();
  try {
    const res = await fetch('/api/map-races');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const races = await res.json();

    if (!races.length) {
      setStatus('No races have coordinates yet.', false);
      return;
    }

    // Group races by system so co-located races share one marker instead of stacking.
    const groups = new Map();
    for (const race of races) {
      const key = `${race.sys_x},${race.sys_z}`;
      let g = groups.get(key);
      if (!g) {
        g = { latlng: galToLatLng(race.sys_x, race.sys_z), system: race.system, races: [] };
        groups.set(key, g);
      }
      g.races.push(race);
    }

    const bounds = [];
    for (const g of groups.values()) {
      bounds.push(g.latlng);
      const count = g.races.length;
      const color = groupColor(g.races);
      const tooltip =
        count > 1 ? `${esc(g.system)} — ${count} races` : esc(g.races[0].name);
      L.circleMarker(g.latlng, {
        radius: count > 1 ? 7 : 5,
        color,
        weight: 1,
        fillColor: color,
        fillOpacity: 0.85,
      })
        .bindPopup(popupHtml(g.system, g.races), { maxHeight: 300 })
        .bindTooltip(tooltip, { direction: 'top', offset: [0, -4] })
        .addTo(map);
    }

    addLegend(map);

    if (!FIT_TO_RACES) {
      map.setView(galToLatLng(INITIAL_CENTER[0], INITIAL_CENTER[1]), INITIAL_ZOOM);
    } else if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: FIT_MAX_ZOOM });
    } else {
      map.setView(bounds[0], INITIAL_ZOOM);
    }

    const n = races.length;
    setStatus(`${n} time trial${n === 1 ? '' : 's'} mapped`);
  } catch (err) {
    setStatus(`Failed to load map data: ${err.message}`, false);
  }
}

load();
