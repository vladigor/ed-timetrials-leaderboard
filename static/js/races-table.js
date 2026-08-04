import { relativeTime, esc, ordinal, computeDaynightInfo } from './utils.js';
import { ChangePoller } from './poller.js';
import { updateProfileDisplay } from './profile.js';
import { getFavState, getAllFavs } from './favourites.js';

const _favGlobal = !!(window.FEATURE_FLAGS && window.FEATURE_FLAGS.favourites);
const _favFor    = (window.FEATURE_FLAGS && window.FEATURE_FLAGS.favourites_for) || [];
const _favCmdr   = (localStorage.getItem('tt_filter_cmdr') || '').toLowerCase();
const FAVOURITES_ENABLED = _favGlobal || (_favFor.length > 0 && !!_favCmdr && _favFor.includes(_favCmdr));

// ── State ──────────────────────────────────────────────────────────────────
let allRaces      = [];
let commanders    = [];
let sortOrder     = localStorage.getItem('tt_sort_order') || 'activity';
let filterCmdr    = localStorage.getItem('tt_filter_cmdr') || '';
let filterHideDW3 = localStorage.getItem('tt_filter_hide_dw3') === '1'; // default off
let filterHideHorizons = localStorage.getItem('tt_filter_hide_horizons') !== '0'; // default on
let filterDaytimeOnly = localStorage.getItem('tt_filter_daytime_only') === '1'; // default off
let filterHideIgnored = localStorage.getItem('tt_filter_hide_ignored') === '1'; // default off
let filterSearchText = ''; // Not persisted - ephemeral search state
let filterRival   = localStorage.getItem('tt_filter_rival') || '';
let daynightBulkData = null;
let currentSystem = localStorage.getItem('tt_nendy_system') || '';
let currentCoords = null; // { x, y, z, name }
let poller        = null;
let acDebounce    = null;
let acActive      = -1;
let rivalAcDebounce = null;
let rivalAcActive   = -1;

// Sorting state (default overridden by applySortOrder in init)
let sortBy     = 'last_activity';
let sortDir    = 'desc';
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
const searchInput      = document.getElementById('filter-search');
const sortSelect       = document.getElementById('sort-select');
const checkHideDW3      = document.getElementById('filter-hide-dw3');
const checkHideHorizons = document.getElementById('filter-hide-horizons');
const checkDaytimeOnly  = document.getElementById('filter-daytime-only');
const checkHideIgnored  = document.getElementById('filter-hide-ignored');        // null if flag off
const hideIgnoredGroup  = document.getElementById('filter-hide-ignored-group'); // null if flag off
const countLabel       = document.getElementById('race-count');
const tableContainer   = document.getElementById('races-table-container');
const systemInput      = document.getElementById('current-system');
const findSystemBtn    = document.getElementById('find-system-btn');
const suggestionsList  = document.getElementById('system-suggestions');
const rivalInput       = document.getElementById('rival-input');
const rivalSuggestions = document.getElementById('rival-suggestions');
const rivalApplyBtn    = document.getElementById('rival-apply-btn');
const rivalClearBtn    = document.getElementById('rival-clear-btn');
const rivalPanel       = document.getElementById('rival-panel');

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  // Migrate: clear deprecated storage key
  localStorage.removeItem('tt_filter_cmdr_races');

  sortSelect.value = sortOrder;
  applySortOrder(sortOrder);
  checkHideDW3.checked      = filterHideDW3;
  checkHideHorizons.checked = filterHideHorizons;
  checkDaytimeOnly.checked  = filterDaytimeOnly;
  if (checkHideIgnored) checkHideIgnored.checked = filterHideIgnored;
  updateHideIgnoredGroup();

  if (currentSystem) {
    systemInput.value = currentSystem;
    await resolveSystemCoords(currentSystem);
  }

  if (filterRival) {
    rivalInput.value = filterRival;
    rivalClearBtn.style.display = '';
    rivalApplyBtn.style.display = 'none';
    rivalPanel.classList.add('filter-bar--active');
  }

  // Hide rival panel entirely when no commander profile is selected
  if (!filterCmdr) {
    rivalPanel.style.display = 'none';
    // Clear any stale rival filter so it doesn't silently affect results
    if (filterRival) {
      filterRival = '';
      localStorage.removeItem('tt_filter_rival');
    }
  }

  updateProfileDisplay();

  await Promise.all([loadRaces(), loadCommanders(), loadDaynightBulk()]);
  applyDaynightBulkToRaces();
  renderTable();

  sortSelect.addEventListener('change', () => {
    sortOrder = sortSelect.value;
    localStorage.setItem('tt_sort_order', sortOrder);
    applySortOrder(sortOrder);
    renderTable();
  });

  checkDaytimeOnly.addEventListener('change', () => {
    filterDaytimeOnly = checkDaytimeOnly.checked;
    localStorage.setItem('tt_filter_daytime_only', filterDaytimeOnly ? '1' : '0');
    renderTable();
  });

  if (checkHideIgnored) {
    checkHideIgnored.addEventListener('change', () => {
      filterHideIgnored = checkHideIgnored.checked;
      localStorage.setItem('tt_filter_hide_ignored', filterHideIgnored ? '1' : '0');
      renderTable();
    });
  }

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

  searchInput.addEventListener('input', () => {
    filterSearchText = searchInput.value;
    renderTable();
  });

  systemInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      hideSuggestions();
      const systemName = systemInput.value.trim();
      if (systemName) {
        currentSystem = systemName;
        localStorage.setItem('tt_nendy_system', currentSystem);
        await resolveSystemCoords(systemName);
        renderTable();
      }
      return;
    }
    if (e.key === 'Escape') {
      hideSuggestions();
      return;
    }
    const items = [...suggestionsList.querySelectorAll('li')];
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acActive = Math.min(acActive + 1, items.length - 1);
      applySuggestionHighlight(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      acActive = Math.max(acActive - 1, -1);
      applySuggestionHighlight(items);
    }
  });

  systemInput.addEventListener('input', () => {
    clearTimeout(acDebounce);
    const q = systemInput.value.trim();
    if (q.length < 3) { hideSuggestions(); return; }
    acDebounce = setTimeout(() => fetchSuggestions(q), 300);
  });

  systemInput.addEventListener('blur', () => setTimeout(hideSuggestions, 150));

  // ── Rival CMDR autocomplete & filter ──────────────────────────────────
  rivalInput.addEventListener('input', () => {
    clearTimeout(rivalAcDebounce);
    const q = rivalInput.value.trim();
    if (q.length < 1) { hideRivalSuggestions(); return; }
    rivalAcDebounce = setTimeout(() => showRivalSuggestions(q), 150);
  });

  rivalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      hideRivalSuggestions();
      applyRivalFilter(rivalInput.value.trim());
      return;
    }
    if (e.key === 'Escape') {
      hideRivalSuggestions();
      return;
    }
    const items = [...rivalSuggestions.querySelectorAll('li')];
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      rivalAcActive = Math.min(rivalAcActive + 1, items.length - 1);
      applyRivalSuggestionHighlight(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      rivalAcActive = Math.max(rivalAcActive - 1, -1);
      applyRivalSuggestionHighlight(items);
    }
  });

  rivalInput.addEventListener('blur', () => setTimeout(hideRivalSuggestions, 150));

  rivalApplyBtn.addEventListener('click', () => {
    hideRivalSuggestions();
    applyRivalFilter(rivalInput.value.trim());
  });

  rivalClearBtn.addEventListener('click', () => {
    rivalInput.value = '';
    rivalClearBtn.style.display = 'none';
    rivalApplyBtn.style.display = '';
    rivalPanel.classList.remove('filter-bar--active');
    filterRival = '';
    localStorage.removeItem('tt_filter_rival');
    loadRaces();
  });

  findSystemBtn.addEventListener('click', async () => {
    hideSuggestions();
    const systemName = systemInput.value.trim();
    if (systemName) {
      currentSystem = systemName;
      localStorage.setItem('tt_nendy_system', currentSystem);
      await resolveSystemCoords(systemName);
      renderTable();
    }
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

    // Handle copy button
    const copyBtn = e.target.closest('.copy-btn');
    if (copyBtn) {
      e.preventDefault();
      handleCopySystemName(copyBtn);
    }
  });

  // Seed poller with current snapshot, reload races if anything changes
  poller = new ChangePoller(60_000, async () => {
    setStatus('updating');
    await loadRaces();
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
    if (filterRival) url.searchParams.set('rival_pos', filterRival);
    const data = await fetch(url).then(r => r.json());
    allRaces = data;
    applyDaynightBulkToRaces();
    renderTable();
  } catch (err) {
    setStatus('error');
    tableContainer.innerHTML = `<p class="empty-state">Could not load races. Please try again later.</p>`;
  }
}

async function loadCommanders() {
  try {
    const data = await fetch('/api/commanders').then(r => r.json());
    commanders = data;
  } catch (_) {
    // Non-fatal — commanders list stays empty, autocomplete won't show suggestions
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
  } catch (err) {
    currentCoords = null;
  }
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderTable() {
  let races = allRaces;

  // Client-side filter: hide DW3 races
  if (filterHideDW3) {
    races = races.filter(r => {
      const hasDW3Tag = (r.tags || '').split(',').map(t => t.trim()).includes('DW3');
      return !hasDW3Tag;
    });
  }

  // Client-side filter: hide Horizons races
  if (filterHideHorizons) {
    races = races.filter(r => r.version !== 'HORIZONS');
  }

  // Client-side filter: only daylight races
  if (filterDaytimeOnly) {
    races = races.filter(r => r.daylight_state === 'day');
  }

  // Client-side filter: hide 💔 races
  if (FAVOURITES_ENABLED && filterHideIgnored) {
    races = races.filter(r => getFavState(r.key) !== 'ignored');
  }

  // Client-side filter: rivalry — show only races where the rival is ahead of (or tied ahead of) you
  if (filterRival) {
    races = races.filter(r => {
      if (r.rival_position == null) return false; // rival hasn't competed here
      if (r.cmdr_position == null) return false;  // you haven't competed here
      return r.rival_position < r.cmdr_position;  // rival has a better (lower) rank
    });
  }

  // Client-side filter: search text
  if (filterSearchText.trim()) {
    const searchLower = filterSearchText.toLowerCase();
    races = races.filter(r => {
      if (r.name && r.name.toLowerCase().includes(searchLower)) return true;
      if (r.system && r.system.toLowerCase().includes(searchLower)) return true;
      if (r.station && r.station.toLowerCase().includes(searchLower)) return true;
      if (r.type && r.type.toLowerCase().includes(searchLower)) return true;
      if (r.version && r.version.toLowerCase().includes(searchLower)) return true;
      if (Array.isArray(r.tags)) {
        if (r.tags.some(t => String(t).toLowerCase().includes(searchLower))) return true;
      } else if (r.tags && String(r.tags).toLowerCase().includes(searchLower)) {
        return true;
      }
      if (r.multi_mode && 'multi-mode'.includes(searchLower)) return true;
      if (r.multi_planet && 'multi-planet'.includes(searchLower)) return true;
      if (r.multi_system && 'multi-system'.includes(searchLower)) return true;
      if (r.creator && r.creator.toLowerCase().includes(searchLower)) return true;
      return false;
    });
  }

  // Calculate distances if system is set
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

  // Sort races
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
        // Secondary sort by most recent activity (descending)
        if (cmp === 0) {
          const ta = a.last_activity ?? '';
          const tb = b.last_activity ?? '';
          cmp = -(ta.localeCompare(tb)); // Negative for descending (most recent first)
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
    tableContainer.innerHTML = '<p class="empty-state">No time trials match the current filters.</p>';
    return;
  }

  const rows = races.map((r, idx) => renderRow(r, idx)).join('');

  tableContainer.innerHTML = `
    <table class="results-table" style="width: 100%">
      <thead>
        <tr>
          ${thSort('name', 'Race')}
          ${thSort('type', 'Type', 'num')}
          ${thSort('location', 'Location')}
          ${currentCoords ? thSort('distance', 'Distance', 'num') : '<th class="num">Distance</th>'}
          ${filterCmdr ? thSort('position', 'Position', 'num') : '<th class="num">Participants</th>'}
          ${thSort('last_activity', 'Last Activity')}
          ${thSort('created_at', 'Created')}
          ${thSort('creator', 'Creator')}
          <th>Restrictions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function thSort(col, label, extraClass = '') {
  const isActive = sortBy === col;
  const indicator = isActive ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
  const cls = ['th-sortable', isActive ? 'th-active' : '', extraClass].filter(Boolean).join(' ');
  return `<th class="${cls}" data-sort="${col}">${label}${indicator}</th>`;
}

function renderRow(r, _idx) {
  const restrictions = formatConstraintsSummary(r.constraints || []);

  const location = r.station
    ? `${esc(r.system)} • ${esc(r.station)}`
    : esc(r.system);

  const copyBtn = `<button class="copy-btn" data-copy="${esc(r.system)}" title="Copy system name" aria-label="Copy system name">
    <svg class="copy-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="12" height="12">
      <path fill="currentColor" d="M384 336H192c-8.8 0-16-7.2-16-16V64c0-8.8 7.2-16 16-16l140.1 0L400 115.9V320c0 8.8-7.2 16-16 16zM192 384H384c35.3 0 64-28.7 64-64V115.9c0-12.7-5.1-24.9-14.1-33.9L366.1 14.1c-9-9-21.2-14.1-33.9-14.1H192c-35.3 0-64 28.7-64 64V320c0 35.3 28.7 64 64 64zM64 128c-35.3 0-64 28.7-64 64V448c0 35.3 28.7 64 64 64H256c35.3 0 64-28.7 64-64V416H272v32c0 8.8-7.2 16-16 16H64c-8.8 0-16-7.2-16-16V192c0-8.8 7.2-16 16-16h32V128H64z"/>
    </svg>
  </button>`;

  const distance = r.distance !== undefined && r.distance !== Infinity
    ? `${Math.round(r.distance).toLocaleString()} ly`
    : currentCoords ? '—' : '';

  const entries = Number(r.entry_count) || 0;
  const positionText = (filterCmdr && r.cmdr_position != null)
    ? `${ordinal(r.cmdr_position)} of ${entries}`
    : `${entries.toString()} finishers`;

  const activity = r.last_activity ? relativeTime(r.last_activity) : '—';

  const created = r.created_at ? formatDate(r.created_at) : '—';
  const creator = r.creator ? esc(r.creator) : '—';

  const favState    = FAVOURITES_ENABLED ? getFavState(r.key) : null;
  const favMarker   = favState === 'fav' ? ' ❤️' : favState === 'ignored' ? ' 💔' : '';
  const dayEmoji    = r.daylight_state === 'day' ? '☀️' : r.daylight_state === 'night' ? '🌙' : '';
  const dayBadge    = dayEmoji ? `<span style="margin-left:0.5rem">${dayEmoji}</span>` : '';
  const tagsLine    = renderTypeTags(r.tags || '');

  return `
    <tr>
      <td><a href="/race/${encodeURIComponent(r.key)}">${esc(r.name)}${favMarker}</a>${dayBadge}</td>
      <td class="num">
        <div class="race-type-cell">
          ${typeBadge(r.type)}
          ${tagsLine}
        </div>
      </td>
      <td>${location} ${copyBtn}</td>
      <td class="num">${distance}</td>
      <td class="num">${positionText}</td>
      <td class="muted">${activity}</td>
      <td class="muted">${created}</td>
      <td>${creator}</td>
      <td class="muted">${restrictions}</td>
    </tr>
  `;
}

function typeBadge(type) {
  if (!type) return '';
  const cls = { SHIP: 'badge-ship', SRV: 'badge-srv', FIGHTER: 'badge-fighter', ONFOOT: 'badge-onfoot' }[type] ?? 'badge-onfoot';
  return `<span class="badge ${cls}">${esc(type)}</span>`;
}

function renderTypeTags(tags) {
  const tagList = (tags || '').split(',').map(t => t.trim()).filter(Boolean);
  if (!tagList.length) return '';

  const badges = tagList.map((tag) => {
    const badgeClass = tag === 'DW3'
      ? 'info-badge-dw3'
      : tag === 'Circuit'
        ? 'info-badge-circuit'
        : 'info-badge-inactive';
    const title = tag === 'Inactive' ? "It's no longer possible to compete in this time trial" : `Tagged race: ${tag}`;
    return `<span class="info-badge ${badgeClass}" title="${esc(title)}">${esc(tag)}</span>`;
  }).join('');

  return `<div class="race-type-tags">${badges}</div>`;
}

function formatConstraintsSummary(constraints) {
  if (!constraints || !constraints.length) return '';

  const cmap = {};
  constraints.forEach(c => { cmap[c.key] = c.value; });

  const items = [];

  if ('MaxSRVPips' in cmap) {
    const maxPips = cmap.MaxSRVPips / 2;
    items.push(`Max pips: ${maxPips.toFixed(1)}`);
  }

  if ('NoShipDocking' in cmap) {
    items.push('No docking');
  }

  if ('NoHullRepair' in cmap) {
    items.push('No hull repair');
  }

  if ('PauseResume' in cmap) {
    items.push('Pausable');
  }

  if (items.length === 0 && constraints.length > 0) {
    return `${constraints.length} constraint${constraints.length !== 1 ? 's' : ''}`;
  }

  return items.length > 0 ? items.join(', ') : '';
}

function formatDate(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString.replace(' ', 'T') + 'Z');
  const now = new Date();

  // Compare calendar dates, not 24-hour periods
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
  } catch (err) {
    console.error('Failed to copy:', err);
  }
}

// ── Sort helpers ─────────────────────────────────────────────────────────
function applySortOrder(order) {
  switch (order) {
    case 'name':    sortBy = 'name';          sortDir = 'asc';  break;
    case 'created': sortBy = 'created_at';    sortDir = 'desc'; break;
    default:        sortBy = 'last_activity'; sortDir = 'desc'; break;
  }
}

// ── Day/night helpers ─────────────────────────────────────────────────────
async function loadDaynightBulk() {
  try {
    const res = await fetch('/api/daynight-bulk');
    if (!res.ok) return;
    daynightBulkData = await res.json();
  } catch { /* non-fatal */ }
}

function applyDaynightBulkToRaces() {
  if (!daynightBulkData) return;
  for (const race of allRaces) {
    const dn = daynightBulkData[race.key];
    if (!dn) continue;
    const { state } = computeDaynightInfo(dn);
    if (state !== null) race.daylight_state = state;
  }
}

// ── Status (no-op, kept for compatibility) ────────────────────────────────
function setStatus(_state) {
  // Status display removed - function kept to avoid breaking existing calls
}

// ── Favourites helpers ────────────────────────────────────────────────────
function updateHideIgnoredGroup() {
  if (!FAVOURITES_ENABLED || !hideIgnoredGroup) return;
  const prefs = getAllFavs();
  const hasIgnored = Object.values(prefs).some(v => v === 'ignored');
  hideIgnoredGroup.style.display = hasIgnored ? '' : 'none';
}

// ── Autocomplete ───────────────────────────────────────────────────────────
async function fetchSuggestions(q) {
  try {
    const res = await fetch(`/api/system-suggest?q=${encodeURIComponent(q)}`);
    if (!res.ok) return;
    const names = await res.json();
    showSuggestions(Array.isArray(names) ? names.slice(0, 8) : []);
  } catch { /* ignore */ }
}

function showSuggestions(names) {
  if (!names.length) { hideSuggestions(); return; }
  acActive = -1;
  suggestionsList.innerHTML = names.map(n => `<li>${esc(n)}</li>`).join('');
  suggestionsList.querySelectorAll('li').forEach((li, i) => {
    li.addEventListener('mousedown', async (e) => {
      e.preventDefault();
      systemInput.value = names[i];
      hideSuggestions();
      currentSystem = names[i];
      localStorage.setItem('tt_nendy_system', currentSystem);
      await resolveSystemCoords(names[i]);
      renderTable();
    });
  });
  suggestionsList.hidden = false;
}

function hideSuggestions() {
  suggestionsList.hidden = true;
  acActive = -1;
}

function applySuggestionHighlight(items) {
  items.forEach((li, i) => li.classList.toggle('active', i === acActive));
  if (acActive >= 0) systemInput.value = items[acActive].textContent;
}

// ── Rival autocomplete helpers ─────────────────────────────────────────────
function showRivalSuggestions(q) {
  const lower = q.toLowerCase();
  const ownName = filterCmdr.toLowerCase();
  const matches = commanders
    .filter(name => name.toLowerCase().includes(lower) && name.toLowerCase() !== ownName)
    .slice(0, 8);
  if (!matches.length) { hideRivalSuggestions(); return; }
  rivalAcActive = -1;
  rivalSuggestions.innerHTML = matches.map(n => `<li>${esc(n)}</li>`).join('');
  rivalSuggestions.querySelectorAll('li').forEach((li, i) => {
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      rivalInput.value = matches[i];
      hideRivalSuggestions();
      applyRivalFilter(matches[i]);
    });
  });
  rivalSuggestions.hidden = false;
}

function hideRivalSuggestions() {
  rivalSuggestions.hidden = true;
  rivalAcActive = -1;
}

function applyRivalSuggestionHighlight(items) {
  items.forEach((li, i) => li.classList.toggle('active', i === rivalAcActive));
  if (rivalAcActive >= 0) rivalInput.value = items[rivalAcActive].textContent;
}

async function applyRivalFilter(name) {
  if (!name) return;
  if (name.toLowerCase() === filterCmdr.toLowerCase()) return; // can't rival yourself
  filterRival = name;
  localStorage.setItem('tt_filter_rival', filterRival);
  rivalInput.value = filterRival;
  rivalClearBtn.style.display = '';
  rivalApplyBtn.style.display = 'none';
  rivalPanel.classList.add('filter-bar--active');
  await loadRaces();
}

init();
