import { relativeTime, esc, ordinal } from './utils.js';
import { ChangePoller } from './poller.js';
import { updateProfileDisplay } from './profile.js';

// ── State ──────────────────────────────────────────────────────────────────
const creatorName = decodeURIComponent(location.pathname.split('/creator/')[1] ?? '');
const currentCmdr = (localStorage.getItem('tt_filter_cmdr') || '').toUpperCase();
const isCreator = !!creatorName && creatorName.toUpperCase() === currentCmdr;

let allRaces      = [];
let mediaData     = {};
let filterActive  = localStorage.getItem('tt_filter_active') === '1';
let filterCmdr    = localStorage.getItem('tt_filter_cmdr') || '';
let filterCmdrRaces = localStorage.getItem('tt_filter_cmdr_races') !== '0'; // default on
let filterHideDW3 = localStorage.getItem('tt_filter_hide_dw3') === '1'; // default off
let filterHideHorizons = localStorage.getItem('tt_filter_hide_horizons') !== '0'; // default on
let filterSearchText = ''; // Not persisted - ephemeral search state
let currentSystem = localStorage.getItem('tt_nendy_system') || '';
let currentCoords = null; // { x, y, z, name }
let poller        = null;
let acDebounce    = null;
let acActive      = -1;

// Sorting state per race type
let sortState = {
  SHIP: { by: 'created_at', dir: 'desc' },
  FIGHTER: { by: 'created_at', dir: 'desc' },
  SRV: { by: 'created_at', dir: 'desc' },
  ONFOOT: { by: 'created_at', dir: 'desc' }
};

const SORT_DEFAULTS = {
  name: 'asc',
  type: 'asc',
  location: 'asc',
  distance: 'asc',
  position: 'asc',
  participants: 'desc',
  last_activity: 'desc',
  created_at: 'desc'
};

// ── DOM refs ───────────────────────────────────────────────────────────────
const breadcrumb          = document.getElementById('creator-breadcrumb');
const title               = document.getElementById('creator-title');
const titleLink           = document.getElementById('creator-title-link');
const summaryEl           = document.getElementById('creator-summary');
const instructionsEl      = document.getElementById('creator-instructions');
const searchInput         = document.getElementById('filter-search');
const checkActive         = document.getElementById('filter-active');
const checkCmdrRaces      = document.getElementById('filter-cmdr-races');
const checkHideDW3        = document.getElementById('filter-hide-dw3');
const checkHideHorizons   = document.getElementById('filter-hide-horizons');
const cmdrRacesGroup      = document.getElementById('filter-cmdr-races-group');
const countLabel          = document.getElementById('race-count');
const racesByTypeContainer = document.getElementById('races-by-type');
const systemInput         = document.getElementById('current-system');
const findSystemBtn       = document.getElementById('find-system-btn');
const suggestionsList     = document.getElementById('system-suggestions');
const participationSection = document.getElementById('participation-section');
const participationBars   = document.getElementById('participation-bars');

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  if (!creatorName) {
    title.textContent = 'Creator not found';
    return;
  }

  breadcrumb.textContent = `CMDR ${creatorName}`;
  titleLink.textContent  = `CMDR ${creatorName}`;
  titleLink.href         = `/cmdr/${encodeURIComponent(creatorName)}`;

  checkActive.checked    = filterActive;
  checkCmdrRaces.checked = filterCmdrRaces;
  checkHideDW3.checked   = filterHideDW3;
  checkHideHorizons.checked = filterHideHorizons;

  if (currentSystem) {
    systemInput.value = currentSystem;
    await resolveSystemCoords(currentSystem);
  }

  updateProfileDisplay();
  updateCmdrRacesGroup();

  // Load creator races and media data
  await Promise.all([loadCreatorRaces(), loadMediaData()]);

  // Event listeners
  checkActive.addEventListener('change', () => {
    filterActive = checkActive.checked;
    localStorage.setItem('tt_filter_active', filterActive ? '1' : '0');
    renderTables();
  });

  checkCmdrRaces.addEventListener('change', () => {
    filterCmdrRaces = checkCmdrRaces.checked;
    localStorage.setItem('tt_filter_cmdr_races', filterCmdrRaces ? '1' : '0');
    renderTables();
  });

  checkHideDW3.addEventListener('change', () => {
    filterHideDW3 = checkHideDW3.checked;
    localStorage.setItem('tt_filter_hide_dw3', filterHideDW3 ? '1' : '0');
    renderTables();
  });

  checkHideHorizons.addEventListener('change', () => {
    filterHideHorizons = checkHideHorizons.checked;
    localStorage.setItem('tt_filter_hide_horizons', filterHideHorizons ? '1' : '0');
    renderTables();
  });

  searchInput.addEventListener('input', () => {
    filterSearchText = searchInput.value;
    renderTables();
  });

  systemInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      hideSuggestions();
      const systemName = systemInput.value.trim();
      if (systemName) {
        currentSystem = systemName;
        localStorage.setItem('tt_nendy_system', currentSystem);
        await resolveSystemCoords(systemName);
        renderTables();
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

  findSystemBtn.addEventListener('click', async () => {
    hideSuggestions();
    const systemName = systemInput.value.trim();
    if (systemName) {
      currentSystem = systemName;
      localStorage.setItem('tt_nendy_system', currentSystem);
      await resolveSystemCoords(systemName);
      renderTables();
    }
  });

  racesByTypeContainer.addEventListener('click', (e) => {
    const th = e.target.closest('.th-sortable');
    if (th) {
      const col = th.dataset.sort;
      const type = th.dataset.type;
      if (type) {
        handleSort(type, col);
      }
    }

    // Handle copy button
    const copyBtn = e.target.closest('.copy-btn');
    if (copyBtn) {
      e.preventDefault();
      handleCopySystemName(copyBtn);
    }
  });

  // Render participation bars
  if (!isCreator) {
    await renderParticipationBars();
  }

  // Seed poller with current snapshot, reload races if anything changes
  poller = new ChangePoller(60_000, async () => {
    await loadCreatorRaces();
  });
  try {
    const body = await fetch('/api/poll').then(r => r.json());
    const snap = body.last_updated ?? body;
    poller.seed(snap);
    if (!body.offline) {
      poller.start();
    }
  } catch (_) {
    poller.start();
  }
}

// ── Data loading ───────────────────────────────────────────────────────────
async function loadCreatorRaces() {
  try {
    const url = new URL(`/api/creator/${encodeURIComponent(creatorName)}`, location.origin);

    // Always fetch position data if a commander is set
    // The filterCmdrRaces checkbox will control whether we filter to only those races
    if (filterCmdr) {
      url.searchParams.set('commander_pos', filterCmdr);
    }

    const data = await fetch(url).then(r => r.json());

    // The API returns { creator, races }
    if (data && data.races) {
      allRaces = data.races;
      summaryEl.textContent = `Created ${allRaces.length} race${allRaces.length !== 1 ? 's' : ''}`;
    } else {
      allRaces = [];
      summaryEl.textContent = `No races created yet`;
    }

    // Show instructions if viewing own creator page
    if (isCreator) {
      instructionsEl.innerHTML = `
        <p style="margin: 0; font-size: 0.95rem; line-height: 1.5;">
          <strong>Want to add maps and links?</strong><br>
          Send any race maps and related links to <strong>CMDR vladigor</strong> via DM.
          <br>Please limit number of links to up to 4 items and include a label for the link (eg. demo video, crator on wp3, etc).
          <br>Please include the link to the race page that the media is for (e.g., <code style="background: var(--surface); padding: 0.15rem 0.4rem; border-radius: 3px;">https://elitettleaderboard.vladigor.net/race/YOUR_RACE_KEY</code>) —
          this makes it easier for me to find the race and add the media.
        </p>
      `;
      instructionsEl.style.display = 'block';
    } else {
      instructionsEl.style.display = 'none';
    }

    renderTables();
  } catch (err) {
    racesByTypeContainer.innerHTML = `<p class="empty-state">This commander hasn't created any races yet.</p>`;
  }
}

async function loadMediaData() {
  try {
    const data = await fetch('/api/media').then(r => r.json());
    mediaData = data || {};
  } catch (err) {
    console.error('Failed to load media data:', err);
    mediaData = {};
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

// ── Participation Progress Bars ───────────────────────────────────────────
async function renderParticipationBars() {
  if (!allRaces || allRaces.length === 0) return;
  if (!filterCmdr) return; // Only show if a commander is set

  try {
    // Fetch commander stats to see which races they've participated in
    const res = await fetch(`/api/cmdr/${encodeURIComponent(filterCmdr)}`);
    if (!res.ok) return; // Commander not found or no data
    const cmdrStats = await res.json();

    // Build set of race keys the commander has participated in
    const cmdrRaceKeys = new Set(cmdrStats.races.map(r => r.key));

    // Count creator's races by type and commander's participation by type
    const creatorTotalByType = {};
    const cmdrParticipationByType = {};

    for (const race of allRaces) {
      const type = race.type || 'UNKNOWN';
      creatorTotalByType[type] = (creatorTotalByType[type] || 0) + 1;

      if (cmdrRaceKeys.has(race.key)) {
        cmdrParticipationByType[type] = (cmdrParticipationByType[type] || 0) + 1;
      }
    }

    const typeLabels = {
      SHIP: 'Ship Races',
      SRV: 'SRV Races',
      FIGHTER: 'Fighter Races',
      ONFOOT: 'On Foot Races',
    };

    // Render bars for each type that the creator has made
    const types = ['SHIP', 'FIGHTER', 'SRV', 'ONFOOT'].filter(t => creatorTotalByType[t] > 0);
    if (types.length === 0) return;

    const barsHTML = types.map(type => {
      const cmdrCount = cmdrParticipationByType[type] || 0;
      const totalCount = creatorTotalByType[type] || 1;
      const percentage = Math.round((cmdrCount / totalCount) * 100);
      const label = typeLabels[type] || type;

      return `
        <div class="participation-bar-row">
          <div class="participation-bar-label">
            <span class="participation-bar-type">${esc(label)}</span>
            <span class="participation-bar-count">${cmdrCount} / ${totalCount}</span>
          </div>
          <div class="participation-bar-wrapper">
            <div class="neidy-bar">
              <div class="neidy-bar-fill" style="width:${percentage}%"></div>
            </div>
            <span class="participation-bar-pct">${percentage}%</span>
          </div>
        </div>`;
    }).join('');

    participationBars.innerHTML = barsHTML;
    participationSection.style.display = 'block';
  } catch (err) {
    console.error('Failed to render participation bars:', err);
  }
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderTables() {
  let races = allRaces;

  // Apply filters
  if (filterHideDW3) {
    races = races.filter(r => !r.name.startsWith('DW3') && !r.name.startsWith('The DW3'));
  }

  if (filterHideHorizons) {
    races = races.filter(r => r.version !== 'HORIZONS');
  }

  if (filterActive) {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    races = races.filter(r => {
      if (!r.last_activity) return false;
      const activityDate = new Date(r.last_activity.replace(' ', 'T') + 'Z');
      return activityDate.getTime() >= cutoff;
    });
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
      return false;
    });
  }

  // Filter to only races the commander has participated in
  if (filterCmdr && filterCmdrRaces) {
    races = races.filter(r => r.cmdr_position != null);
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

  countLabel.textContent = `Displaying ${races.length} race${races.length !== 1 ? 's' : ''}`;

  if (races.length === 0) {
    racesByTypeContainer.innerHTML = '<p class="empty-state">No races match the current filters.</p>';
    return;
  }

  // Group by type
  const byType = {};
  for (const race of races) {
    const type = race.type || 'UNKNOWN';
    if (!byType[type]) byType[type] = [];
    byType[type].push(race);
  }

  const typeOrder = ['SHIP', 'FIGHTER', 'SRV', 'ONFOOT'];
  const typesPresent = typeOrder.filter(t => byType[t]);

  // Render a table for each type
  const tablesHTML = typesPresent.map(type => {
    const typeRaces = byType[type];

    // Sort this type's races
    const { by: sortBy, dir: sortDir } = sortState[type];
    const sorted = sortRaces(typeRaces, sortBy, sortDir);

    const rows = sorted.map((r, idx) => renderRow(r, idx, type)).join('');

    const typeLabel = {
      SHIP: 'Ship Races',
      FIGHTER: 'Fighter Races',
      SRV: 'SRV Races',
      ONFOOT: 'On Foot Races'
    }[type] || type;

    return `
      <section style="margin-bottom: 2rem;">
        <h2 class="cmdr-section-heading">${esc(typeLabel)}</h2>
        <table class="results-table" style="width: 100%">
          <thead>
            <tr>
              ${thSort(type, 'name', 'Race', '', 'max-width: 250px; overflow-wrap: break-word; word-break: break-word; white-space: normal;')}
              ${thSort(type, 'location', 'Location', '', 'max-width: 250px; overflow-wrap: break-word; word-break: break-word; white-space: normal;')}
              ${currentCoords ? thSort(type, 'distance', 'Distance', 'num', '', 'Dist') : '<th class="num" data-short="Dist"><span class="th-label">Distance</span></th>'}
              ${filterCmdr ? thSort(type, 'position', 'Position', 'num', '', 'Posn') : '<th class="num" data-short="Posn"><span class="th-label">Position</span></th>'}
              ${thSort(type, 'participants', 'Participants', 'num', '', '#')}
              ${thSort(type, 'last_activity', 'Last Activity', '', '', 'Activity')}
              ${thSort(type, 'created_at', 'Created')}
              <th class="col-restrictions">Restrictions</th>
              ${isCreator ? '<th class="num">Map</th>' : ''}
              ${isCreator ? '<th class="num">Links</th>' : ''}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    `;
  }).join('');

  racesByTypeContainer.innerHTML = tablesHTML;
}

function handleSort(type, col) {
  const current = sortState[type];
  if (current.by === col) {
    current.dir = current.dir === 'asc' ? 'desc' : 'asc';
  } else {
    current.by = col;
    current.dir = SORT_DEFAULTS[col] ?? 'asc';
  }
  renderTables();
}

function sortRaces(races, sortBy, sortDir) {
  const sorted = races.slice().sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case 'name':
        cmp = a.name.localeCompare(b.name);
        break;
      case 'location':
        cmp = a.system.localeCompare(b.system);
        break;
      case 'distance':
        cmp = (a.distance ?? Infinity) - (b.distance ?? Infinity);
        // Secondary sort by last activity (most recent first)
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
      case 'participants': {
        const aCount = Number(a.entry_count) || 0;
        const bCount = Number(b.entry_count) || 0;
        cmp = aCount - bCount;
        break;
      }
      case 'last_activity': {
        const ta = a.last_activity ?? '';
        const tb = b.last_activity ?? '';
        cmp = ta.localeCompare(tb);
        // Secondary sort by created_at
        if (cmp === 0) {
          const ca = a.created_at ?? '';
          const cb = b.created_at ?? '';
          cmp = ca.localeCompare(cb);
        }
        break;
      }
      case 'created_at': {
        const ta = a.created_at ?? '';
        const tb = b.created_at ?? '';
        cmp = ta.localeCompare(tb);
        // Secondary sort by last_activity (most recent first)
        if (cmp === 0) {
          const la = a.last_activity ?? '';
          const lb = b.last_activity ?? '';
          cmp = la.localeCompare(lb);
        }
        break;
      }
    }
    return sortDir === 'desc' ? -cmp : cmp;
  });
  return sorted;
}

function thSort(type, col, label, extraClass = '', extraStyle = '', shortLabel = '') {
  const { by: sortBy, dir: sortDir } = sortState[type];
  const isActive = sortBy === col;
  const indicator = isActive ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
  const cls = ['th-sortable', isActive ? 'th-active' : '', extraClass].filter(Boolean).join(' ');
  const style = extraStyle ? ` style="${extraStyle}"` : '';
  const dataShort = shortLabel ? ` data-short="${shortLabel}"` : '';
  return `<th class="${cls}" data-sort="${col}" data-type="${type}"${style}${dataShort}><span class="th-label">${label}</span>${indicator}</th>`;
}

function renderRow(r, _idx, _type) {
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
    ? ordinal(r.cmdr_position)
    : '—';
  const participantsText = entries.toString();

  const activity = r.last_activity ? relativeTime(r.last_activity) : '—';
  const created = r.created_at ? formatDate(r.created_at) : '—';

  // Map and Links columns (only if isCreator)
  let mapCol = '';
  let linksCol = '';
  if (isCreator) {
    const media = mediaData[r.key] || {};
    const hasMap = media.map ? '<span style="color: #3fb97a;">✓</span>' : '<span style="color: #d94f4f;">✗</span>';
    const hasLinks = (media.links && media.links.length > 0) ? '<span style="color: #3fb97a;">✓</span>' : '<span style="color: #d94f4f;">✗</span>';
    mapCol = `<td class="num">${hasMap}</td>`;
    linksCol = `<td class="num">${hasLinks}</td>`;
  }

  return `
    <tr>
      <td style="max-width: 250px; overflow-wrap: break-word; word-break: break-word; white-space: normal;"><a href="/race/${encodeURIComponent(r.key)}">${esc(r.name)}</a></td>
      <td style="max-width: 250px; overflow-wrap: break-word; word-break: break-word; white-space: normal;">${location} ${copyBtn}</td>
      <td class="num">${distance}</td>
      <td class="num">${positionText}</td>
      <td class="num">${participantsText}</td>
      <td class="muted">${activity}</td>
      <td class="muted">${created}</td>
      <td class="muted col-restrictions">${restrictions}</td>
      ${mapCol}
      ${linksCol}
    </tr>
  `;
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

// ── Profile helpers ────────────────────────────────────────────────────────
function updateCmdrRacesGroup() {
  if (filterCmdr) {
    cmdrRacesGroup.style.display = '';
    checkCmdrRaces.checked = filterCmdrRaces;
  } else {
    cmdrRacesGroup.style.display = 'none';
  }
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
      renderTables();
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

init();
