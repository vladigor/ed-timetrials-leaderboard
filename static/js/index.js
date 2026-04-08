import { formatTime, relativeTime, esc, ordinal } from './utils.js';
import { ChangePoller } from './poller.js';

// ── State ──────────────────────────────────────────────────────────────────
let allRaces      = [];
let commanders    = [];
let filterActive  = localStorage.getItem('tt_filter_active') === '1';
let filterCmdr    = localStorage.getItem('tt_filter_cmdr') || '';
let filterCmdrRaces = localStorage.getItem('tt_filter_cmdr_races') !== '0'; // default on
let poller        = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
const grid             = document.getElementById('races-grid');
const statusDot        = document.getElementById('status-dot');
const statusText       = document.getElementById('status-text');
const checkActive      = document.getElementById('filter-active');
const checkCmdrRaces   = document.getElementById('filter-cmdr-races');
const cmdrRacesGroup   = document.getElementById('filter-cmdr-races-group');
const countLabel       = document.getElementById('race-count');
const profileLabel     = document.getElementById('profile-label');
const btnViewProfile   = document.getElementById('btn-view-profile');
const btnChangeProfile = document.getElementById('btn-change-profile');
const profileOverlay   = document.getElementById('profile-overlay');
const modalCmdrSelect  = document.getElementById('modal-cmdr-select');
const modalConfirm     = document.getElementById('modal-confirm');

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  // Sanity check — surface missing elements immediately
  const missing = [grid, statusDot, statusText, checkActive, checkCmdrRaces, cmdrRacesGroup,
    countLabel, profileLabel, btnViewProfile, btnChangeProfile, profileOverlay, modalCmdrSelect, modalConfirm]
    .map((el, i) => el ? null : ['races-grid','status-dot','status-text','filter-active',
      'filter-cmdr-races','filter-cmdr-races-group','race-count','profile-label',
      'btn-view-profile','btn-change-profile','profile-overlay','modal-cmdr-select','modal-confirm'][i])
    .filter(Boolean);
  if (missing.length) {
    console.error('Missing DOM elements:', missing);
    return;
  }

  checkActive.checked    = filterActive;
  checkCmdrRaces.checked = filterCmdrRaces;
  updateProfileLabel();

  await Promise.all([loadRaces(), loadCommanders(), loadNewRaces()]);

  checkActive.addEventListener('change', () => {
    filterActive = checkActive.checked;
    localStorage.setItem('tt_filter_active', filterActive ? '1' : '0');
    loadRaces();
  });

  checkCmdrRaces.addEventListener('change', () => {
    filterCmdrRaces = checkCmdrRaces.checked;
    localStorage.setItem('tt_filter_cmdr_races', filterCmdrRaces ? '1' : '0');
    loadRaces();
  });

  modalConfirm.addEventListener('click', () => {
    filterCmdr = modalCmdrSelect.value;
    localStorage.setItem('tt_filter_cmdr', filterCmdr);
    localStorage.setItem('tt_profile_set', '1');
    updateProfileLabel();
    hideProfileModal();
    loadRaces();
  });

  btnChangeProfile.addEventListener('click', showProfileModal);

  if (localStorage.getItem('tt_profile_set') !== '1') {
    showProfileModal();
  }

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
    if (filterActive)                  url.searchParams.set('active_days', '7');
    if (filterCmdr && filterCmdrRaces) url.searchParams.set('commander', filterCmdr);
    else if (filterCmdr)               url.searchParams.set('commander_pos', filterCmdr);
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
    populateModalSelect();
  } catch (_) {
    // Non-fatal
  }
}

async function loadNewRaces() {
  try {
    const data = await fetch('/api/races/new').then(r => r.json());
    const panel = document.getElementById('new-races-panel');
    const list  = document.getElementById('new-races-list');
    if (!data.length) { panel.style.display = 'none'; return; }
    list.innerHTML = data.map(r =>
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
}

function typeBadge(type) {
  if (!type) return '';
  const cls = { SHIP: 'badge-ship', SRV: 'badge-srv', FIGHTER: 'badge-fighter', ONFOOT: 'badge-onfoot' }[type] ?? 'badge-onfoot';
  return `<span class="badge ${cls}">${esc(type)}</span>`;
}

function raceCard(r) {
  const entries = Number(r.entry_count) || 0;
  const activity = r.last_activity ? relativeTime(r.last_activity) : 'no entries';
  const leader = r.results?.[0];
  const leaderTime = (leader && leader.time_ms != null) ? formatTime(leader.time_ms) : '';
  const positionLabel = (filterCmdr && r.cmdr_position != null)
    ? `${ordinal(r.cmdr_position)} of ${entries} finisher${entries !== 1 ? 's' : ''}`
    : `${entries} finisher${entries !== 1 ? 's' : ''}`;

  const infoBadges = [
    r.multi_mode ? `<span class="info-badge info-badge-accent">Multi-mode</span>` : '',
    r.multi_planet ? `<span class="info-badge info-badge-accent">Multi-planet</span>` : '',
    r.multi_system ? `<span class="info-badge info-badge-accent">Multi-system</span>` : '',
  ].join('');

  return `
  <a class="race-card" href="/race/${encodeURIComponent(r.key)}"
     aria-label="View ${esc(r.name)} leaderboard">
    <div class="race-card-name">${esc(r.name)}</div>
    <div class="race-card-meta">
      ${typeBadge(r.type)}
      ${infoBadges}
    </div>
    <div class="race-card-meta">
      <span>${esc(r.system)}</span>
      ${r.station ? `<span>· ${esc(r.station)}</span>` : ''}
    </div>
    ${leaderTime ? `<div class="race-card-meta" style="color:var(--accent)">Best: ${leaderTime}</div>` : ''}
    <div class="race-card-footer">
      <span class="entry-count">${positionLabel}</span>
      <span>${activity}</span>
    </div>
  </a>`;
}

// ── Profile modal ───────────────────────────────────────────────────────────
function updateProfileLabel() {
  if (filterCmdr) {
    const profileUrl = `/cmdr/${encodeURIComponent(filterCmdr)}`;
    profileLabel.textContent = `CMDR ${filterCmdr}`;
    profileLabel.classList.remove('no-profile');
    profileLabel.href = profileUrl;
    btnViewProfile.href = profileUrl;
    btnViewProfile.style.display = '';
    cmdrRacesGroup.style.display = '';
    checkCmdrRaces.checked = filterCmdrRaces;
  } else {
    profileLabel.textContent = 'No profile selected';
    profileLabel.classList.add('no-profile');
    profileLabel.removeAttribute('href');
    btnViewProfile.style.display = 'none';
    cmdrRacesGroup.style.display = 'none';
  }
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
