import { formatTime, relativeTime, esc, ordinal, computeDaynightInfo } from './utils.js';
import { ChangePoller } from './poller.js';
import { updateProfileDisplay } from './profile.js';
import { getFavState, favDisplay, getAllFavs } from './favourites.js';

const _favGlobal = !!(window.FEATURE_FLAGS && window.FEATURE_FLAGS.favourites);
const _favFor    = (window.FEATURE_FLAGS && window.FEATURE_FLAGS.favourites_for) || [];
const _favCmdr   = (localStorage.getItem('tt_filter_cmdr') || '').toLowerCase();
const FAVOURITES_ENABLED = _favGlobal || (_favFor.length > 0 && !!_favCmdr && _favFor.includes(_favCmdr));
// console.debug('[favourites] FEATURE_FLAGS:', window.FEATURE_FLAGS);
// console.debug('[favourites] _favGlobal:', _favGlobal, '| _favFor:', _favFor, '| _favCmdr:', _favCmdr, '| FAVOURITES_ENABLED:', FAVOURITES_ENABLED);

// ── State ──────────────────────────────────────────────────────────────────
let allRaces      = [];
let commanders    = [];
let filterCmdr    = localStorage.getItem('tt_filter_cmdr') || '';
let filterHideDW3 = localStorage.getItem('tt_filter_hide_dw3') === '1'; // default off
let filterHideHorizons = localStorage.getItem('tt_filter_hide_horizons') !== '0'; // default on
let filterDaytimeOnly = localStorage.getItem('tt_filter_daytime_only') === '1'; // default off
let filterHideIgnored = localStorage.getItem('tt_filter_hide_ignored') === '1'; // default off
let filterSearchText = ''; // Not persisted - ephemeral search state
let sortOrder     = localStorage.getItem('tt_sort_order') || 'activity';
let poller        = null;

// Bulk day/night data loaded once per session from /api/daynight-bulk.
// Keyed by race_key: { state, until, upcoming_intervals, fetched_at }
let daynightBulkData = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
const grid             = document.getElementById('races-grid');
const statusDot        = document.getElementById('status-dot');
const statusText       = document.getElementById('status-text');
const searchInput      = document.getElementById('filter-search');
const checkHideDW3     = document.getElementById('filter-hide-dw3');
const checkHideHorizons = document.getElementById('filter-hide-horizons');
const checkDaytimeOnly  = document.getElementById('filter-daytime-only');
const checkHideIgnored  = document.getElementById('filter-hide-ignored');   // may be null if flag off
const hideIgnoredGroup = document.getElementById('filter-hide-ignored-group'); // may be null if flag off
const sortSelect       = document.getElementById('sort-select');
const countLabel       = document.getElementById('race-count');
const profileLabel     = document.getElementById('profile-label');
const btnChangeProfile = document.getElementById('btn-change-profile');
const profileOverlay   = document.getElementById('profile-overlay');
const modalCmdrSelect  = document.getElementById('modal-cmdr-select');
const modalConfirm     = document.getElementById('modal-confirm');
const modalCloseX      = document.getElementById('modal-close-x');

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  // Migration: deprecated filters removed; clear any persisted state.
  localStorage.removeItem('tt_filter_active');
  localStorage.removeItem('tt_filter_cmdr_races');

  // Sanity check — surface missing elements immediately
  const missing = [grid, statusDot, statusText, searchInput, checkHideDW3, checkHideHorizons, checkDaytimeOnly,
    sortSelect, countLabel, profileLabel, btnChangeProfile, profileOverlay, modalCmdrSelect, modalConfirm, modalCloseX]
    .map((el, i) => el ? null : ['races-grid','status-dot','status-text','filter-search',
      'filter-hide-dw3','filter-hide-horizons','filter-daytime-only','sort-select','race-count','profile-label',
      'btn-change-profile','profile-overlay','modal-cmdr-select','modal-confirm','modal-close-x'][i])
    .filter(Boolean);
  if (missing.length) {
    console.error('Missing DOM elements:', missing);
    return;
  }

  checkHideDW3.checked      = filterHideDW3;
  checkHideHorizons.checked = filterHideHorizons;
  checkDaytimeOnly.checked  = filterDaytimeOnly;
  if (checkHideIgnored) checkHideIgnored.checked = filterHideIgnored;
  sortSelect.value       = sortOrder;
  if (!FAVOURITES_ENABLED) {
    const favOpt = sortSelect.querySelector('option[value="favourites"]');
    if (favOpt) favOpt.remove();
    if (sortOrder === 'favourites') {
      sortOrder = 'activity';
      localStorage.setItem('tt_sort_order', sortOrder);
      sortSelect.value = sortOrder;
    }
  }
  updateProfileDisplay();
  updateHideIgnoredGroup();

  await Promise.all([loadRaces(), loadCommanders(), loadNewRaces(), loadDaynightBulk()]);
  // Re-apply bulk day/night data now that both datasets are guaranteed to be loaded,
  // then re-render so the correct state is shown even if loadRaces() finished first.
  applyDaynightBulkToRaces();
  renderGrid();

  checkHideDW3.addEventListener('change', () => {
    filterHideDW3 = checkHideDW3.checked;
    localStorage.setItem('tt_filter_hide_dw3', filterHideDW3 ? '1' : '0');
    renderGrid(); // Client-side only, no need to reload from API
  });

  checkHideHorizons.addEventListener('change', () => {
    filterHideHorizons = checkHideHorizons.checked;
    localStorage.setItem('tt_filter_hide_horizons', filterHideHorizons ? '1' : '0');
    renderGrid(); // Client-side only, no need to reload from API
  });

  checkDaytimeOnly.addEventListener('change', () => {
    filterDaytimeOnly = checkDaytimeOnly.checked;
    localStorage.setItem('tt_filter_daytime_only', filterDaytimeOnly ? '1' : '0');
    renderGrid(); // Client-side only, no need to reload from API
  });

  if (checkHideIgnored) {
    checkHideIgnored.addEventListener('change', () => {
      filterHideIgnored = checkHideIgnored.checked;
      localStorage.setItem('tt_filter_hide_ignored', filterHideIgnored ? '1' : '0');
      renderGrid();
    });
  }

  searchInput.addEventListener('input', () => {
    filterSearchText = searchInput.value;
    renderGrid(); // Client-side only, no need to reload from API
  });

  sortSelect.addEventListener('change', () => {
    sortOrder = sortSelect.value;
    localStorage.setItem('tt_sort_order', sortOrder);
    renderGrid();
  });

  modalConfirm.addEventListener('click', () => {
    filterCmdr = modalCmdrSelect.value;
    localStorage.setItem('tt_filter_cmdr', filterCmdr);
    localStorage.setItem('tt_profile_set', '1');
    updateProfileDisplay();
    hideProfileModal();
    loadRaces();
  });

  profileLabel.addEventListener('click', (e) => {
    if (!filterCmdr) { e.preventDefault(); showProfileModal(); }
  });
  btnChangeProfile.addEventListener('click', showProfileModal);
  modalCloseX.addEventListener('click', hideProfileModal);

  // Check if we should show the profile modal
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('changeProfile') || localStorage.getItem('tt_profile_set') !== '1') {
    showProfileModal();
    // Clean up URL if changeProfile param was present
    if (urlParams.has('changeProfile')) {
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }

  // Seed poller with current snapshot, reload races if anything changes
  poller = new ChangePoller(30_000, async () => {
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
    const data = await fetch(url).then(r => r.json());
    allRaces = data;
    applyDaynightBulkToRaces();
    renderGrid();
  } catch (err) {
    setStatus('error');
    grid.innerHTML = `<p class="empty-state">Could not load races. Please try again later.</p>`;
  }
}

async function loadDaynightBulk() {
  try {
    const data = await fetch('/api/daynight-bulk').then(r => r.json());
    daynightBulkData = data;
  } catch (_) {
    // Non-fatal — fall back to stop-gap daylight_state from /api/races
  }
}



/**
 * Overlay computed day/night state from the bulk cache onto allRaces.
 * Races not covered by the bulk API keep whatever daylight_state came from
 * the server (populated by the per-race stop-gap mechanism).
 */
function applyDaynightBulkToRaces() {
  if (!daynightBulkData) return;
  for (const race of allRaces) {
    const dn = daynightBulkData[race.key];
    if (!dn) continue;
    const info = computeDaynightInfo(dn);
    if (info.state !== null) {
      race.daylight_state = info.state;
      race.daylight_until = info.until;
    }
  }
}

async function loadCommanders() {
  try {
    const data = await fetch('/api/commanders').then(r => r.json());
    commanders = data;
    populateModalSelect();
  } catch (_) {
    // Non-fatal
  }
}

async function loadNewRaces() {
  try {
    const cmdr = localStorage.getItem('tt_filter_cmdr') || '';
    const url  = cmdr ? `/api/races/new?commander=${encodeURIComponent(cmdr)}` : '/api/races/new';
    const data = await fetch(url).then(r => r.json());
    const visibleRaces = data.filter(r => getFavState(r.key) !== 'ignored');
    const panel = document.getElementById('new-races-panel');
    const list  = document.getElementById('new-races-list');
    if (!visibleRaces.length) { panel.style.display = 'none'; return; }
    list.innerHTML = visibleRaces.map(r =>
      `<li><a href="/race/${encodeURIComponent(r.key)}">${esc(r.name)}</a></li>`
    ).join('');
    panel.style.display = '';
  } catch (_) {
    // Non-fatal
  }
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderGrid() {
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

  // Client-side filter: daytime only (known current state from cache)
  if (filterDaytimeOnly) {
    races = races.filter(r => r.daylight_state === 'day');
  }

  // Client-side filter: hide 💔 races (favourites feature)
  if (FAVOURITES_ENABLED && filterHideIgnored) {
    races = races.filter(r => getFavState(r.key) !== 'ignored');
  }

  // Client-side filter: search text
  if (filterSearchText.trim()) {
    const searchLower = filterSearchText.toLowerCase();
    races = races.filter(r => {
      // Search in name
      if (r.name && r.name.toLowerCase().includes(searchLower)) return true;
      // Search in system
      if (r.system && r.system.toLowerCase().includes(searchLower)) return true;
      // Search in station
      if (r.station && r.station.toLowerCase().includes(searchLower)) return true;
      // Search in type (SRV, SHIP, FIGHTER, ONFOOT)
      if (r.type && r.type.toLowerCase().includes(searchLower)) return true;
      // Search in version (HORIZONS, ODYSSEY)
      if (r.version && r.version.toLowerCase().includes(searchLower)) return true;
      // Search for badge keywords
      if (r.multi_mode && 'multi-mode'.includes(searchLower)) return true;
      if (r.multi_planet && 'multi-planet'.includes(searchLower)) return true;
      if (r.multi_system && 'multi-system'.includes(searchLower)) return true;
      return false;
    });
  }

  // Sort
  const activityMs = ts => ts ? new Date(ts.replace(' ', 'T').replace(/(\..{1,6}).*$/, '$1') + 'Z').getTime() : 0;
  const sortName = name => (name || '').trimStart().replace(/^The\s+/i, '');
  if (sortOrder === 'name') {
    races.sort((a, b) => {
      const cmp = sortName(a.name).localeCompare(sortName(b.name));
      return cmp !== 0 ? cmp : activityMs(b.last_activity) - activityMs(a.last_activity);
    });
  } else if (sortOrder === 'created') {
    races.sort((a, b) => {
      const aMs = activityMs(a.created_at);
      const bMs = activityMs(b.created_at);
      if (aMs !== bMs) return bMs - aMs; // newest first; nulls/zeros fall to end
      return activityMs(b.last_activity) - activityMs(a.last_activity);
    });
  } else if (FAVOURITES_ENABLED && sortOrder === 'favourites') {
    // Favourites first, then activity; ignored races sink to the bottom
    const order = { fav: 0, null: 1, ignored: 2 };
    races.sort((a, b) => {
      const fa = getFavState(a.key);
      const fb = getFavState(b.key);
      const cmp = (order[fa] ?? 1) - (order[fb] ?? 1);
      return cmp !== 0 ? cmp : activityMs(b.last_activity) - activityMs(a.last_activity);
    });
  } else {
    // 'activity' — most recent first, races with no activity at the end
    races.sort((a, b) => activityMs(b.last_activity) - activityMs(a.last_activity));
  }

  countLabel.textContent = `${races.length} race${races.length !== 1 ? 's' : ''}`;

  if (races.length === 0) {
    grid.innerHTML = '<p class="empty-state">No time trials match the current filters.</p>';
    return;
  }

  grid.innerHTML = races.map(r => raceCard(r)).join('');
}

function typeBadge(type) {
  if (!type) return '';
  const cls = { SHIP: 'badge-ship', SRV: 'badge-srv', FIGHTER: 'badge-fighter', ONFOOT: 'badge-onfoot' }[type] ?? 'badge-onfoot';
  return `<span class="badge ${cls}">${esc(type)}</span>`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
function isRecentActivity(ts) {
  if (!ts) return false;
  const norm = ts.replace(' ', 'T').replace(/(\.\d{1,6}).*$/, '$1') + 'Z';
  return Date.now() - new Date(norm).getTime() < DAY_MS;
}

function raceCard(r) {
  const entries = Number(r.entry_count) || 0;
  const activity = r.last_activity ? relativeTime(r.last_activity) : 'no entries';
  const leader = r.results?.[0];
  const leaderTime = (leader && leader.time_ms != null) ? formatTime(leader.time_ms) : '';
  const positionLabel = (filterCmdr && r.cmdr_position != null)
    ? `${ordinal(r.cmdr_position)} of ${entries} finisher${entries !== 1 ? 's' : ''}`
    : `${entries} finisher${entries !== 1 ? 's' : ''}`;

  const daylightEmoji = r.daylight_state === 'day' ? ' ☀️' : r.daylight_state === 'night' ? ' 🌙' : '';
  let daylightDuration = '';
  if (daylightEmoji && r.daylight_until) {
    const msLeft = new Date(r.daylight_until).getTime() - Date.now();
    if (msLeft > 24 * 3_600_000) {
      const daysLeft = Math.round(msLeft / 86_400_000);
      daylightDuration = ` for ${daysLeft}d`;
    } else {
      const hoursLeft = Math.round(msLeft / 3_600_000);
      if (hoursLeft >= 1) daylightDuration = ` for ${hoursLeft}h`;
    }
  }

  const infoBadges = [
    r.version === 'HORIZONS' ? `<span class="info-badge info-badge-horizons">Horizons</span>` : '',
    r.multi_mode ? `<span class="info-badge info-badge-accent">Multi-mode</span>` : '',
    r.multi_planet ? `<span class="info-badge info-badge-accent">Multi-planet</span>` : '',
    r.multi_system ? `<span class="info-badge info-badge-accent">Multi-system</span>` : '',
    (r.tags || '').split(',').map(t => t.trim()).filter(Boolean).map(t => {
      const title = t === 'Inactive' ? "It's no longer possible to compete in this time trial" : `Tagged race: ${t}`;
      const badgeClass = t === 'DW3' ? 'info-badge-dw3' : 'info-badge-inactive';
      return `<span class="info-badge ${badgeClass}" title="${esc(title)}">${esc(t)}</span>`;
    }).join(''),
  ].join('');

  let favBtn = '';
  if (FAVOURITES_ENABLED) {
    const state = getFavState(r.key);
    if (state) {
      const { icon, title } = favDisplay(state);
      favBtn = `<span class="fav-indicator" title="${title}" aria-label="${title}">${icon}</span>`;
    }
  }

  return `
  <a class="race-card" href="/race/${encodeURIComponent(r.key)}"
     aria-label="View ${esc(r.name)} leaderboard">
    ${favBtn}
    <div class="race-card-name">${esc((r.name || '').trimStart())}</div>
    <div class="race-card-meta">
      ${typeBadge(r.type)}
      ${infoBadges}
      ${daylightEmoji ? `<span class="race-card-daylight-emoji">${daylightEmoji}${daylightDuration ? `<span class="daylight-duration">${daylightDuration}</span>` : ''}</span>` : ''}
    </div>
    <div class="race-card-meta">
      <span>${esc(r.system)}</span>
      ${r.station ? `<span>· ${esc(r.station)}</span>` : ''}
    </div>
    ${leaderTime ? `<div class="race-card-meta" style="color:var(--accent)">Best: ${leaderTime}</div>` : ''}
    <div class="race-card-footer">
      <span class="entry-count">${positionLabel}</span>
      <span${isRecentActivity(r.last_activity) ? ' class="activity-fresh"' : ''}>${activity}</span>
    </div>
  </a>`;
}

// ── Profile modal ───────────────────────────────────────────────────────────
function updateHideIgnoredGroup() {
  if (!FAVOURITES_ENABLED || !hideIgnoredGroup) return;
  // Only show the "Hide 💔 races" checkbox when there are any ignored races
  const prefs = getAllFavs();
  const hasIgnored = Object.values(prefs).some(v => v === 'ignored');
  hideIgnoredGroup.style.display = hasIgnored ? '' : 'none';
}

function populateModalSelect() {
  const frag = document.createDocumentFragment();
  const blank = document.createElement('option');
  blank.value = ''; blank.textContent = "I haven't taken part in any time trials yet";
  frag.appendChild(blank);
  for (const name of commanders) {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    frag.appendChild(opt);
  }
  modalCmdrSelect.innerHTML = '';
  modalCmdrSelect.appendChild(frag);
  if (filterCmdr) modalCmdrSelect.value = filterCmdr;
}

function showProfileModal() {
  populateModalSelect();
  modalCmdrSelect.disabled = false;
  profileOverlay.style.display = 'flex';
  // Trigger transition on next frame
  requestAnimationFrame(() => profileOverlay.classList.add('visible'));
}

function hideProfileModal() {
  profileOverlay.classList.remove('visible');
  profileOverlay.addEventListener('transitionend', () => {
    profileOverlay.style.display = 'none';
  }, { once: true });
}

// ── Status dot ─────────────────────────────────────────────────────────────
function setStatus(state) {
  statusDot.className = 'dot';
  if (state === 'live')    { statusDot.classList.add('live');    statusText.textContent = 'Live (up to 1min delay)'; }
  if (state === 'offline') { statusDot.classList.add('offline'); statusText.textContent = 'Offline — local data'; }
  if (state === 'updating'){ statusText.textContent = 'Updating…'; }
  if (state === 'error')   { statusDot.classList.add('error');   statusText.textContent = 'Connection error'; }
}

init();
