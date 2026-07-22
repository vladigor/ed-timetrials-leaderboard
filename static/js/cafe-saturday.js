import { relativeTime, esc } from './utils.js';
import { ChangePoller } from './poller.js';
import { updateProfileDisplay } from './profile.js';
import { getFavState, getAllFavs } from './favourites.js';

const _favGlobal = !!(window.FEATURE_FLAGS && window.FEATURE_FLAGS.favourites);
const _favFor = (window.FEATURE_FLAGS && window.FEATURE_FLAGS.favourites_for) || [];
const _favCmdr = (localStorage.getItem('tt_filter_cmdr') || '').toLowerCase();
const FAVOURITES_ENABLED = _favGlobal || (_favFor.length > 0 && !!_favCmdr && _favFor.includes(_favCmdr));

// ── State ──────────────────────────────────────────────────────────────────
let allRaces = [];
let sortOrder = 'created';
let filterCmdr = localStorage.getItem('tt_filter_cmdr') || '';
let filterHideDW3 = localStorage.getItem('tt_filter_hide_dw3') === '1';
let filterHideHorizons = localStorage.getItem('tt_filter_hide_horizons') !== '0';
let filterHideIgnored = localStorage.getItem('tt_filter_hide_ignored') === '1';
let filterSearchText = '';
let daynightBulkData = null;
let currentCoords = null;
let poller = null;

let eventDay = 6;
let eventStartText = '16:00';
let eventDurationHours = 2;

let sortBy = 'last_activity';
let sortDir = 'desc';
const SOL_SYSTEM = 'Sol';
const SUPPRESSION_WINDOW_MS = 48 * 60 * 60 * 1000;
const SORT_DEFAULTS = {
  name: 'asc',
  type: 'asc',
  location: 'asc',
  distance: 'asc',
  position: 'asc',
  last_activity: 'desc',
  created_at: 'asc',
  creator: 'asc'
};

// ── DOM refs ───────────────────────────────────────────────────────────────
const searchInput = document.getElementById('filter-search');
const sortSelect = document.getElementById('sort-select');
const checkHideDW3 = document.getElementById('filter-hide-dw3');
const checkHideHorizons = document.getElementById('filter-hide-horizons');
const checkHideIgnored = document.getElementById('filter-hide-ignored');
const hideIgnoredGroup = document.getElementById('filter-hide-ignored-group');
const countLabel = document.getElementById('race-count');
const tableContainer = document.getElementById('races-table-container');
const eventDayInput = document.getElementById('event-day');
const eventStartInput = document.getElementById('event-start');
const eventDurationInput = document.getElementById('event-duration');
const windowDescription = document.getElementById('window-description');
const windowWarning = document.getElementById('window-warning');

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  // Migrate: clear deprecated storage key
  localStorage.removeItem('tt_filter_cmdr_races');

  sortSelect.value = sortOrder;
  applySortOrder(sortOrder);
  checkHideDW3.checked = filterHideDW3;
  checkHideHorizons.checked = filterHideHorizons;
  if (checkHideIgnored) checkHideIgnored.checked = filterHideIgnored;

  eventDayInput.value = String(Number.isInteger(eventDay) && eventDay >= 0 && eventDay <= 6 ? eventDay : 6);
  eventStartInput.value = /^\d{2}:\d{2}$/.test(eventStartText) ? eventStartText : '16:00';
  if (Number.isFinite(eventDurationHours)) {
    eventDurationHours = Math.max(1, Math.min(8, Math.round(eventDurationHours)));
  } else {
    eventDurationHours = 2;
  }
  eventDurationInput.value = String(eventDurationHours);

  updateHideIgnoredGroup();
  updateProfileDisplay();

  await resolveSystemCoords(SOL_SYSTEM);
  await Promise.all([loadRaces(), loadDaynightBulk()]);
  renderTable();

  sortSelect.addEventListener('change', () => {
    sortOrder = sortSelect.value;
    applySortOrder(sortOrder);
    renderTable();
  });

  checkHideDW3.addEventListener('change', () => {
    filterHideDW3 = checkHideDW3.checked;
    localStorage.setItem('tt_filter_hide_dw3', filterHideDW3 ? '1' : '0');
    renderTable();
  });

  checkHideHorizons.addEventListener('change', () => {
    filterHideHorizons = checkHideHorizons.checked;
    localStorage.setItem('tt_filter_hide_horizons', filterHideHorizons ? '1' : '0');
    renderTable();
  });

  if (checkHideIgnored) {
    checkHideIgnored.addEventListener('change', () => {
      filterHideIgnored = checkHideIgnored.checked;
      localStorage.setItem('tt_filter_hide_ignored', filterHideIgnored ? '1' : '0');
      renderTable();
    });
  }

  searchInput.addEventListener('input', () => {
    filterSearchText = searchInput.value;
    renderTable();
  });

  eventDayInput.addEventListener('change', () => {
    eventDay = Number(eventDayInput.value);
    renderTable();
  });

  eventStartInput.addEventListener('change', () => {
    eventStartText = eventStartInput.value || '16:00';
    renderTable();
  });

  eventDurationInput.addEventListener('change', () => {
    const parsed = Number(eventDurationInput.value);
    const clamped = Number.isFinite(parsed) ? Math.max(1, Math.min(8, Math.round(parsed))) : 2;
    eventDurationHours = clamped;
    eventDurationInput.value = String(clamped);
    renderTable();
  });

  tableContainer.addEventListener('click', (e) => {
    const th = e.target.closest('.th-sortable');
    if (th) {
      const col = th.dataset.sort;
      if (sortBy === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortBy = col;
        sortDir = SORT_DEFAULTS[col] ?? 'asc';
      }
      renderTable();
    }

    const copyBtn = e.target.closest('.copy-btn');
    if (copyBtn) {
      e.preventDefault();
      handleCopySystemName(copyBtn);
    }
  });

  poller = new ChangePoller(60_000, async () => {
    setStatus('updating');
    await Promise.all([loadRaces(), loadDaynightBulk()]);
    setStatus('live');
  });
  try {
    const body = await fetch('/api/poll').then(r => r.json());
    const snap = body.last_updated ?? body;
    poller.seed(snap);
    if (body.offline) {
      setStatus('offline');
    } else {
      poller.start();
      setStatus('live');
    }
  } catch (_) {
    poller.start();
    setStatus('live');
  }
}

// ── Data loading ───────────────────────────────────────────────────────────
async function loadRaces() {
  try {
    const url = new URL('/api/races', location.origin);
    if (filterCmdr) url.searchParams.set('commander_pos', filterCmdr);
    allRaces = await fetch(url).then(r => r.json());
  } catch (_) {
    setStatus('error');
    tableContainer.innerHTML = '<p class="empty-state">Could not load races. Please try again later.</p>';
  }
}

async function loadDaynightBulk() {
  try {
    const res = await fetch('/api/daynight-bulk');
    if (!res.ok) return;
    daynightBulkData = await res.json();
  } catch {
    // Non-fatal
  }
}

async function resolveSystemCoords(systemName) {
  try {
    const coordsRes = await fetch(`/api/system-coords?name=${encodeURIComponent(systemName)}`);
    if (coordsRes.status === 404) {
      currentCoords = null;
      return;
    }
    if (!coordsRes.ok) throw new Error('EDSM lookup failed');
    const { name: resolvedName, x, y, z } = await coordsRes.json();
    currentCoords = { x, y, z, name: resolvedName };
  } catch (_) {
    currentCoords = null;
  }
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderTable() {
  const eventWindow = getNextEventWindow();
  renderWindowText(eventWindow);

  if (eventWindow.startsInMs > SUPPRESSION_WINDOW_MS) {
    countLabel.textContent = 'Predictions unavailable yet';
    tableContainer.innerHTML = '<p class="empty-state">This page only shows results when we are within 48 hours of the next session window.</p>';
    return;
  }

  let races = allRaces;

  if (filterHideDW3) {
    races = races.filter(r => {
      const hasDW3Tag = (r.tags || '').split(',').map(t => t.trim()).includes('DW3');
      return !hasDW3Tag;
    });
  }

  if (filterHideHorizons) {
    races = races.filter(r => r.version !== 'HORIZONS');
  }

  if (FAVOURITES_ENABLED && filterHideIgnored) {
    races = races.filter(r => getFavState(r.key) !== 'ignored');
  }

  if (filterSearchText.trim()) {
    const searchLower = filterSearchText.toLowerCase();
    races = races.filter(r => {
      if (r.name && r.name.toLowerCase().includes(searchLower)) return true;
      if (r.system && r.system.toLowerCase().includes(searchLower)) return true;
      if (r.station && r.station.toLowerCase().includes(searchLower)) return true;
      if (r.type && r.type.toLowerCase().includes(searchLower)) return true;
      if (r.version && r.version.toLowerCase().includes(searchLower)) return true;
      if (r.multi_mode && 'multi-mode'.includes(searchLower)) return true;
      if (r.multi_planet && 'multi-planet'.includes(searchLower)) return true;
      if (r.multi_system && 'multi-system'.includes(searchLower)) return true;
      if (r.creator && r.creator.toLowerCase().includes(searchLower)) return true;
      return false;
    });
  }

  races = races.filter(r => {
    const dn = daynightBulkData && daynightBulkData[r.key];
    if (!dn) return false;
    const startState = stateAtUtc(dn, eventWindow.startMs);
    const endState = stateAtUtc(dn, eventWindow.endMs);
    return startState === 'day' && endState === 'day';
  });

  if (currentCoords) {
    races = races.map(r => {
      if (r.coords) {
        const parts = r.coords.split(',').map(v => Number(v.trim()));
        if (parts.length === 3 && !parts.some(isNaN)) {
          const [rx, ry, rz] = parts;
          const dist = Math.sqrt(
            (rx - currentCoords.x) ** 2 +
            (ry - currentCoords.y) ** 2 +
            (rz - currentCoords.z) ** 2
          );
          return { ...r, distance: dist };
        }
      }
      return { ...r, distance: Infinity };
    });
  }

  races = races.slice().sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case 'name':
        cmp = a.name.localeCompare(b.name);
        break;
      case 'type':
        cmp = (a.type || '').localeCompare(b.type || '');
        break;
      case 'location':
        cmp = a.system.localeCompare(b.system);
        break;
      case 'distance':
        cmp = (a.distance ?? Infinity) - (b.distance ?? Infinity);
        if (cmp === 0) {
          const ta = a.last_activity ?? '';
          const tb = b.last_activity ?? '';
          cmp = -(ta.localeCompare(tb));
        }
        break;
      case 'position': {
        const aPos = a.cmdr_position ?? Infinity;
        const bPos = b.cmdr_position ?? Infinity;
        cmp = aPos - bPos;
        break;
      }
      case 'last_activity': {
        const ta = a.last_activity ?? '';
        const tb = b.last_activity ?? '';
        cmp = ta.localeCompare(tb);
        break;
      }
      case 'created_at': {
        const ta = a.created_at ?? '';
        const tb = b.created_at ?? '';
        cmp = ta.localeCompare(tb);
        break;
      }
      case 'creator':
        cmp = (a.creator || '').localeCompare(b.creator || '');
        break;
    }
    return sortDir === 'desc' ? -cmp : cmp;
  });

  countLabel.textContent = `Displaying ${races.length} race${races.length !== 1 ? 's' : ''}`;

  if (races.length === 0) {
    tableContainer.innerHTML = '<p class="empty-state">No races are currently predicted to stay in daylight for this event window.</p>';
    return;
  }

  const rows = races.map((r, idx) => renderRow(r, idx, eventWindow)).join('');
  tableContainer.innerHTML = `
    <table class="results-table" style="width: 100%">
      <thead>
        <tr>
          ${thSort('name', 'Race')}
          ${thSort('type', 'Type', 'num')}
          ${thSort('location', 'Location')}
          ${currentCoords ? thSort('distance', 'Distance', 'num') : '<th class="num">Distance</th>'}
          ${thSort('last_activity', 'Last Activity')}
          ${thSort('created_at', 'Created')}
          <th>Restrictions</th>
          <th class="num">☀️ Sunrise</th>
          <th class="num">🌙 Sunset</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderWindowText(eventWindow) {
  const startLabel = formatUtcDateTime(eventWindow.startMs);
  const endLabel = formatUtcDateTime(eventWindow.endMs);
  const isDefaultCafe = Number(eventDayInput.value) === 6 && eventStartInput.value === '16:00' && Number(eventDurationInput.value) === 2;

  windowDescription.innerHTML = isDefaultCafe
    ? `This page lists only races predicted to be in daylight at both ${startLabel} and ${endLabel}.<br>Current system is fixed to Sol for distance estimates.<br>If no Sunrise/Sunset time is listed, the Sunrise has already occurred and the Sunset is many days away.`
    : `This page lists only races predicted to be in daylight at both ${startLabel} and ${endLabel}.<br>Current system is fixed to Sol for distance estimates.<br>If no Sunrise/Sunset time is listed, the Sunrise has already occurred and the Sunset is many days away.`;

  if (eventWindow.startsInMs > SUPPRESSION_WINDOW_MS) {
    windowWarning.textContent = `Predictions are intentionally hidden until we are within 48 hours of the session so as to maintain accuracy.`;
  } else {
    windowWarning.textContent = `The session starts in ${formatDuration(eventWindow.startsInMs)}.`;
  }
}

function thSort(col, label, extraClass = '') {
  const isActive = sortBy === col;
  const indicator = isActive ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
  const cls = ['th-sortable', isActive ? 'th-active' : '', extraClass].filter(Boolean).join(' ');
  return `<th class="${cls}" data-sort="${col}">${label}${indicator}</th>`;
}

function renderRow(r, _idx, eventWindow) {
  const restrictions = formatConstraintsSummary(r.constraints || []);
  const location = r.station ? `${esc(r.system)} • ${esc(r.station)}` : esc(r.system);
  const { sunrise, sunset } = getSunriseSunset(daynightBulkData && daynightBulkData[r.key], eventWindow);

  const copyBtn = `<button class="copy-btn" data-copy="${esc(r.system)}" title="Copy system name" aria-label="Copy system name">
    <svg class="copy-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="12" height="12">
      <path fill="currentColor" d="M384 336H192c-8.8 0-16-7.2-16-16V64c0-8.8 7.2-16 16-16l140.1 0L400 115.9V320c0 8.8-7.2 16-16 16zM192 384H384c35.3 0 64-28.7 64-64V115.9c0-12.7-5.1-24.9-14.1-33.9L366.1 14.1c-9-9-21.2-14.1-33.9-14.1H192c-35.3 0-64 28.7-64 64V320c0 35.3 28.7 64 64 64zM64 128c-35.3 0-64 28.7-64 64V448c0 35.3 28.7 64 64 64H256c35.3 0 64-28.7 64-64V416H272v32c0 8.8-7.2 16-16 16H64c-8.8 0-16-7.2-16-16V192c0-8.8 7.2-16 16-16h32V128H64z"/>
    </svg>
  </button>`;

  const distance = r.distance !== undefined && r.distance !== Infinity
    ? `${Math.round(r.distance).toLocaleString()} ly`
    : currentCoords ? '—' : '';

  const activity = r.last_activity ? relativeTime(r.last_activity) : '—';
  const created = r.created_at ? formatDate(r.created_at) : '—';

  const favState = FAVOURITES_ENABLED ? getFavState(r.key) : null;
  const favMarker = favState === 'fav' ? ' ❤️' : favState === 'ignored' ? ' 💔' : '';

  return `
    <tr>
      <td><a href="/race/${encodeURIComponent(r.key)}">${esc(r.name)}${favMarker}</a></td>
      <td class="num">${typeBadge(r.type)}</td>
      <td>${location} ${copyBtn}</td>
      <td class="num">${distance}</td>
      <td class="muted">${activity}</td>
      <td class="muted">${created}</td>
      <td class="muted">${restrictions}</td>
      <td class="num muted">${sunrise}</td>
      <td class="num muted">${sunset}</td>
    </tr>
  `;
}

function getSunriseSunset(dn, eventWindow) {
  if (!dn || !eventWindow) return { sunrise: '—', sunset: '—' };

  const { startMs } = eventWindow;
  const currentUntilMs = dn.until ? Date.parse(dn.until) : Infinity;
  const intervals = Array.isArray(dn.upcoming_intervals) ? dn.upcoming_intervals : [];

  // Case 1: current interval is already "day" and covers the event start
  if (dn.state === 'day' && currentUntilMs > startMs) {
    const sunset = Number.isFinite(currentUntilMs) ? formatUtcTime(currentUntilMs) : '—';
    return { sunrise: '—', sunset }; // sunrise is in the past, not available
  }

  // Case 2: find the upcoming "day" interval that covers the event start
  for (const iv of intervals) {
    if (iv.state !== 'day') continue;
    const fromMs = Date.parse(iv.from);
    const ivUntilMs = Date.parse(iv.until);
    if (!Number.isFinite(fromMs) || !Number.isFinite(ivUntilMs)) continue;
    if (fromMs <= startMs && ivUntilMs > startMs) {
      return { sunrise: formatUtcTime(fromMs), sunset: formatUtcTime(ivUntilMs) };
    }
  }

  return { sunrise: '—', sunset: '—' };
}

function formatUtcTime(ms) {
  if (!ms || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${weekday} ${hh}:${mm} UTC`;
}

function typeBadge(type) {
  if (!type) return '';
  const cls = { SHIP: 'badge-ship', SRV: 'badge-srv', FIGHTER: 'badge-fighter', ONFOOT: 'badge-onfoot' }[type] ?? 'badge-onfoot';
  return `<span class="badge ${cls}">${esc(type)}</span>`;
}

function formatConstraintsSummary(constraints) {
  if (!constraints || !constraints.length) return '';

  const cmap = {};
  constraints.forEach(c => { cmap[c.key] = c.value; });

  const items = [];
  if ('MaxSRVPips' in cmap) items.push(`Max pips: ${(cmap.MaxSRVPips / 2).toFixed(1)}`);
  if ('NoShipDocking' in cmap) items.push('No docking');
  if ('NoHullRepair' in cmap) items.push('No hull repair');
  if ('PauseResume' in cmap) items.push('Pausable');

  if (items.length === 0 && constraints.length > 0) {
    return `${constraints.length} constraint${constraints.length !== 1 ? 's' : ''}`;
  }
  return items.length > 0 ? items.join(', ') : '';
}

function formatDate(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString.replace(' ', 'T') + 'Z');
  const now = new Date();

  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const diffMs = nowDay - dateDay;
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

async function handleCopySystemName(btn) {
  const text = btn.dataset.copy;
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 2000);
  } catch (_) {
    // ignore
  }
}

function applySortOrder(order) {
  switch (order) {
    case 'name':
      sortBy = 'name';
      sortDir = 'asc';
      break;
    case 'created':
      sortBy = 'created_at';
      sortDir = 'desc';
      break;
    default:
      sortBy = 'last_activity';
      sortDir = 'desc';
      break;
  }
}

function getNextEventWindow() {
  const [hourRaw, minuteRaw] = (eventStartInput.value || '16:00').split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const day = Number(eventDayInput.value);
  const duration = Math.max(1, Math.min(8, Number(eventDurationInput.value) || 2));

  const now = new Date();
  const candidate = new Date(now);
  candidate.setUTCHours(hour, minute, 0, 0);

  const dayDelta = (day - now.getUTCDay() + 7) % 7;
  candidate.setUTCDate(candidate.getUTCDate() + dayDelta);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 7);
  }

  const startMs = candidate.getTime();
  const endMs = startMs + duration * 60 * 60 * 1000;
  return {
    startMs,
    endMs,
    startsInMs: startMs - now.getTime()
  };
}

function stateAtUtc(dn, atMs) {
  if (!dn) return null;

  const untilMs = dn.until ? Date.parse(dn.until) : Infinity;
  if (atMs < untilMs) {
    return dn.state || null;
  }

  const intervals = Array.isArray(dn.upcoming_intervals) ? dn.upcoming_intervals : [];
  for (const iv of intervals) {
    const fromMs = Date.parse(iv.from);
    const ivUntilMs = Date.parse(iv.until);
    if (!Number.isFinite(fromMs) || !Number.isFinite(ivUntilMs)) continue;
    if (atMs >= fromMs && atMs < ivUntilMs) {
      return iv.state || null;
    }
  }

  return null;
}

function formatUtcDateTime(ms) {
  const d = new Date(ms);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${weekday} ${hh}:${mm} UTC`;
}

function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function setStatus(_state) {
  // Status display removed - function kept to avoid breaking existing calls
}

function updateHideIgnoredGroup() {
  if (!FAVOURITES_ENABLED || !hideIgnoredGroup) return;
  const prefs = getAllFavs();
  const hasIgnored = Object.values(prefs).some(v => v === 'ignored');
  hideIgnoredGroup.style.display = hasIgnored ? '' : 'none';
}

init();
