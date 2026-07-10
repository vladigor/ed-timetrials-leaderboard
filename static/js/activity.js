import { relativeTime, esc, formatImprovement } from './utils.js';
import { ChangePoller } from './poller.js';
import { getFavState } from './favourites.js';

// ── State ──────────────────────────────────────────────────────────────────
const FRESH_MS = 60 * 60 * 1000; // 1 hour
const PAGE_SIZE = 25;

function isFresh(ts) {
  if (!ts) return false;
  const norm = ts.replace(' ', 'T').replace(/(\.(\d{1,6})).*$/, '$1') + 'Z';
  return Date.now() - new Date(norm).getTime() < FRESH_MS;
}

let activity = [];
let poller = null;
let timeUpdater = null;
let currentOffset = 0;
let isLoading = false;
let hasMore = true;
let isOffline = false;
let scrollObserver = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
const container = document.getElementById('activity-container');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  await loadActivity();

  // Seed poller – refresh when any race changes (since we show recent activity)
  poller = new ChangePoller(60_000, async () => {
    setStatus('updating');
    await resetAndReload();
    setStatus('live');
  });

  try {
    const body = await fetch('/api/poll').then(r => r.json());
    const snap = body.last_updated ?? body;
    poller.seed(snap);
    isOffline = !!body.offline;
    if (isOffline) {
      setStatus('offline');
    } else {
      poller.start();
      setStatus('live');
    }
  } catch (_) {
    poller.start();
    setStatus('live');
  }

  await loadNewRaces();

  // Start periodic time updater for relative times
  startTimeUpdater();
}

// ── Data loading ───────────────────────────────────────────────────────────
async function loadNewRaces() {
  try {
    const cmdr = localStorage.getItem('tt_filter_cmdr') || '';
    const url  = cmdr ? `/api/races/new?commander=${encodeURIComponent(cmdr)}` : '/api/races/new';
    const data = await fetch(url).then(r => r.json());
    const visibleRaces = data.filter(r => getFavState(r.key) !== 'ignored');
    const panel = document.getElementById('new-races-panel');
    const list  = document.getElementById('new-races-list');
    if (!panel) return;
    if (!visibleRaces.length) { panel.style.display = 'none'; return; }
    list.innerHTML = visibleRaces.map(r =>
      `<li><a href="/race/${encodeURIComponent(r.key)}">${esc(r.name)}</a></li>`
    ).join('');
    panel.style.display = '';
  } catch (_) {
    // Non-fatal
  }
}

async function loadActivity() {
  if (isLoading || !hasMore) return;
  isLoading = true;
  removeSentinel();
  try {
    const url = `/api/activity?limit=${PAGE_SIZE}&offset=${currentOffset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const page = await res.json();
    if (page.length < PAGE_SIZE) hasMore = false;
    // Only check the first page (most recent) for system inference
    if (currentOffset === 0) maybeUpdateSystemFromActivity(page);
    activity = activity.concat(page);
    currentOffset += page.length;
    render();
  } catch (err) {
    if (activity.length === 0) {
      container.innerHTML = '<p class="empty-state">Could not load recent activity.</p>';
    }
  } finally {
    isLoading = false;
    if (hasMore) attachSentinel();
  }
}

// ── Update system in localStorage if this commander's most recent result is fresh ──
function maybeUpdateSystemFromActivity(page) {
  const cmdr = localStorage.getItem('tt_filter_cmdr') || '';
  if (!cmdr || !page || !page.length) return;
  const cmdrItem = page.find(item => item.name === cmdr);
  if (cmdrItem && cmdrItem.system && !cmdrItem.multi_system && isFresh(cmdrItem.updated)) {
    localStorage.setItem('tt_nendy_system', cmdrItem.system);
  }
}

/** Discard loaded data and fetch from the top (used when live data changes). */
async function resetAndReload() {
  activity = [];
  currentOffset = 0;
  hasMore = true;
  removeSentinel();
  await loadActivity();
}

// ── Render ─────────────────────────────────────────────────────────────────
function render() {
  container.innerHTML = '';

  const section = document.createElement('section');
  section.className = 'stats-section';

  const intro = document.createElement('p');
  intro.style.cssText = 'margin-bottom: 1.5rem; color: var(--text-muted);';
  intro.textContent = 'Showing all recent race submissions in chronological order. If a commander improves their time multiple times, each submission is shown with the position they achieved at that moment.';
  section.appendChild(intro);

  if (activity.length > 0) {
    section.insertAdjacentHTML('beforeend', renderActivityTable(activity));
  } else {
    section.insertAdjacentHTML('beforeend', '<p class="empty-state">No recent activity found.</p>');
  }

  container.appendChild(section);
}

// ── Infinite scroll sentinel ───────────────────────────────────────────────
function attachSentinel() {
  removeSentinel();
  const sentinel = document.createElement('div');
  sentinel.id = 'scroll-sentinel';
  sentinel.style.cssText = 'height: 1px; margin-top: 1rem;';
  container.appendChild(sentinel);

  scrollObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) loadActivity();
  }, { rootMargin: '200px' });
  scrollObserver.observe(sentinel);
}

function removeSentinel() {
  if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null; }
  const existing = document.getElementById('scroll-sentinel');
  if (existing) existing.remove();
}

// ── Render helpers ─────────────────────────────────────────────────────────

function renderCmdrLink(name) {
  return `<a href="/cmdr/${encodeURIComponent(name)}">${esc(name)}</a>`;
}

function renderRaceLink(key, name) {
  return `<a href="/race/${encodeURIComponent(key)}">${esc(name)}</a>`;
}

function renderActivityTable(items) {
  if (!items || items.length === 0) return '<p class="empty-state">No data available.</p>';

  const isMobile = window.innerWidth <= 768;
  const commanderLabel = isMobile ? 'Cmdr' : 'Commander';
  const positionLabel = isMobile ? 'Posn' : 'Position';
  const improvementLabel = isMobile ? 'Impvmnt' : 'Improvement';
  const updatedLabel = isMobile ? 'When' : 'Updated';

  let html = '<table class="stats-table">';
  html += '<thead><tr>';
  html += `<th>${commanderLabel}</th>`;
  html += `<th>Race</th>`;
  html += `<th style="text-align: center;">${positionLabel}</th>`;
  html += `<th style="text-align: center;">${improvementLabel}</th>`;
  html += `<th class="stats-time">${updatedLabel}</th>`;
  html += '</tr></thead>';
  html += '<tbody>';

  items.forEach(item => {
    const rowClass = isFresh(item.updated) ? ' class="row-fresh"' : '';
    const position = item.position;
    const currentPosition = item.current_position;

    // Display historical position with medal emoji for podium
    let positionDisplay = position === 1 ? '🏆' : position === 2 ? '🥈' : position === 3 ? '🥉' : (position || '—');

    // If current position has dropped (higher number = worse rank), show current position
    if (currentPosition != null && currentPosition > position) {
      let currentEmoji;
      if (currentPosition === 1) {
        currentEmoji = '🏆';
      } else if (currentPosition === 2) {
        currentEmoji = '🥈';
      } else if (currentPosition === 3) {
        currentEmoji = '🥉';
      } else {
        currentEmoji = currentPosition;
      }

      positionDisplay += ` <span style="color: var(--text-muted); font-size: 0.85em;">(now ${currentEmoji})</span>`;
    }

    // Format time improvement: positive = got faster (better)
    const improvement = formatImprovement(item.improvement_ms);
    const improvementDisplay = `<span class="improvement-cell ${improvement.cls}">${esc(improvement.text)}</span>`;

    html += `<tr${rowClass}>`;
    html += `<td>${renderCmdrLink(item.name)}</td>`;
    html += `<td>${renderRaceLink(item.location, item.race_name)}</td>`;
    html += `<td class="stats-rank">${positionDisplay}</td>`;
    html += `<td class="stats-rank">${improvementDisplay}</td>`;
    html += `<td class="stats-time activity-time" data-timestamp="${item.updated || ''}">${relativeTime(item.updated)}</td>`;
    html += '</tr>';
  });

  html += '</tbody></table>';
  return html;
}

// ── Dynamic time updater ───────────────────────────────────────────────────
/**
 * Update all relative time displays every minute to keep them current.
 */
function updateRelativeTimes() {
  const cells = document.querySelectorAll('.activity-time[data-timestamp]');

  cells.forEach(cell => {
    const timestamp = cell.dataset.timestamp;
    if (!timestamp) return;

    cell.textContent = relativeTime(timestamp);
  });
}

/**
 * Start the periodic time updater (runs every 60 seconds)
 */
function startTimeUpdater() {
  if (timeUpdater) clearInterval(timeUpdater);

  timeUpdater = setInterval(() => {
    updateRelativeTimes();
  }, 60_000); // Every 60 seconds
}

/**
 * Stop the periodic time updater
 */
function _stopTimeUpdater() {
  if (timeUpdater) {
    clearInterval(timeUpdater);
    timeUpdater = null;
  }
}

// ── Status bar ─────────────────────────────────────────────────────────────
function setStatus(state) {
  statusDot.className = 'dot';
  if (state === 'live')    { statusDot.classList.add('live');    statusText.textContent = 'Live (up to 1min delay)'; }
  if (state === 'offline') { statusDot.classList.add('offline'); statusText.textContent = 'Offline — local data'; }
  if (state === 'updating'){ statusText.textContent = 'Updating…'; }
  if (state === 'error')   { statusDot.classList.add('error');   statusText.textContent = 'Connection error'; }
}

// ── Start ──────────────────────────────────────────────────────────────────
init();
