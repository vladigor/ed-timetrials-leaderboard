import { formatTime, relativeTime, esc } from './utils.js';
import { ChangePoller } from './poller.js';

// ── State ──────────────────────────────────────────────────────────────────
let allRaces      = [];
let commanders    = [];
let filterActive  = localStorage.getItem('tt_filter_active') === '1';
let filterCmdr    = localStorage.getItem('tt_filter_cmdr') || '';
let poller        = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
const grid         = document.getElementById('races-grid');
const statusDot    = document.getElementById('status-dot');
const statusText   = document.getElementById('status-text');
const checkActive  = document.getElementById('filter-active');
const selectCmdr   = document.getElementById('filter-commander');
const countLabel   = document.getElementById('race-count');

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  // Restore persisted filter UI state before loading data
  checkActive.checked = filterActive;

  await Promise.all([loadRaces(), loadCommanders()]);

  checkActive.addEventListener('change', () => {
    filterActive = checkActive.checked;
    localStorage.setItem('tt_filter_active', filterActive ? '1' : '0');
    loadRaces();
  });

  selectCmdr.addEventListener('change', () => {
    filterCmdr = selectCmdr.value;
    localStorage.setItem('tt_filter_cmdr', filterCmdr);
    loadRaces();
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
    if (filterActive) url.searchParams.set('active_days', '7');
    if (filterCmdr)   url.searchParams.set('commander', filterCmdr);
    const data = await fetch(url).then(r => r.json());
    allRaces = data;
    renderGrid();
  } catch (err) {
    setStatus('error');
    grid.innerHTML = `<p class="empty-state">Could not load races. Please try again later.</p>`;
  }
}

async function loadCommanders() {
  try {
    const data = await fetch('/api/commanders').then(r => r.json());
    commanders = data;
    // Populate commander select
    const frag = document.createDocumentFragment();
    const blank = document.createElement('option');
    blank.value = ''; blank.textContent = 'All commanders';
    frag.appendChild(blank);
    for (const name of commanders) {
      const opt = document.createElement('option');
      opt.value = esc(name); opt.textContent = esc(name);
      frag.appendChild(opt);
    }
    selectCmdr.innerHTML = '';
    selectCmdr.appendChild(frag);
    // Restore saved commander selection
    if (filterCmdr) selectCmdr.value = filterCmdr;
  } catch (_) {
    // Non-fatal; filters will still work without the list
  }
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderGrid() {
  let races = allRaces;

  // Client-side filter: active in last 7 days
  if (filterActive) {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    races = races.filter(r => {
      if (!r.last_activity) return false;
      const normalised = r.last_activity.replace(' ', 'T').replace(/(\..{1,6}).*$/, '$1') + 'Z';
      return new Date(normalised).getTime() >= cutoff;
    });
  }

  countLabel.textContent = `${races.length} race${races.length !== 1 ? 's' : ''}`;

  if (races.length === 0) {
    grid.innerHTML = '<p class="empty-state">No time trials match the current filters.</p>';
    return;
  }

  grid.innerHTML = races.map(r => raceCard(r)).join('');

  // Attach click handlers
  grid.querySelectorAll('.race-card').forEach(card => {
    card.addEventListener('click', () => {
      location.href = `/race/${encodeURIComponent(card.dataset.key)}`;
    });
  });
}

function versionBadge(version) {
  const cls = version === 'ODYSSEY' ? 'badge-odyssey' : 'badge-horizons';
  return `<span class="badge ${cls}">${esc(version)}</span>`;
}

function typeBadge(type) {
  if (!type) return '';
  return `<span class="badge badge-type">${esc(type)}</span>`;
}

function raceCard(r) {
  const entries = Number(r.entry_count) || 0;
  const activity = r.last_activity ? relativeTime(r.last_activity) : 'no entries';
  const leader = r.results?.[0];
  const leaderTime = (leader && leader.time_ms != null) ? formatTime(leader.time_ms) : '';

  return `
  <div class="race-card" data-key="${esc(r.key)}" role="button" tabindex="0"
       aria-label="View ${esc(r.name)} leaderboard"
       onkeydown="if(event.key==='Enter')this.click()">
    <div class="race-card-name">${esc(r.name)}</div>
    <div class="race-card-meta">
      ${versionBadge(r.version)}
      ${typeBadge(r.type)}
    </div>
    <div class="race-card-meta">
      <span>${esc(r.system)}</span>
      ${r.station ? `<span>· ${esc(r.station)}</span>` : ''}
    </div>
    ${leaderTime ? `<div class="race-card-meta" style="color:var(--accent)">Best: ${leaderTime}</div>` : ''}
    <div class="race-card-footer">
      <span class="entry-count">${entries} ${entries === 1 ? 'entry' : 'entries'}</span>
      <span>${activity}</span>
    </div>
  </div>`;
}

// ── Status dot ─────────────────────────────────────────────────────────────
function setStatus(state) {
  statusDot.className = 'dot';
  if (state === 'live')    { statusDot.classList.add('live');    statusText.textContent = 'Live'; }
  if (state === 'offline') { statusDot.classList.add('offline'); statusText.textContent = 'Offline — local data'; }
  if (state === 'updating'){ statusText.textContent = 'Updating…'; }
  if (state === 'error')   { statusDot.classList.add('error');   statusText.textContent = 'Connection error'; }
}

init();
