import { relativeTime, esc } from './utils.js';
import { ChangePoller } from './poller.js';

// ── State ──────────────────────────────────────────────────────────────────
const PAGE_SIZE = 25;

let racers = [];
let poller = null;
let timeUpdater = null;
let currentOffset = 0;
let isLoading = false;
let hasMore = true;
let isOffline = false;
let scrollObserver = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
const container = document.getElementById('racers-container');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  await loadRacers();

  // Seed poller – refresh when any race changes (since we show active racers)
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

  // Start periodic time updater for relative times
  startTimeUpdater();
}

// ── Data loading ───────────────────────────────────────────────────────────
async function loadRacers() {
  if (isLoading || !hasMore) return;
  isLoading = true;
  removeSentinel();
  try {
    const url = `/api/active-racers?limit=${PAGE_SIZE}&offset=${currentOffset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const page = await res.json();
    if (page.length < PAGE_SIZE) hasMore = false;
    racers = racers.concat(page);
    currentOffset += page.length;
    render();
  } catch (err) {
    if (racers.length === 0) {
      container.innerHTML = '<p class="empty-state">Could not load active racers.</p>';
    }
  } finally {
    isLoading = false;
    if (hasMore) attachSentinel();
  }
}

/** Discard loaded data and fetch from the top (used when live data changes). */
async function resetAndReload() {
  racers = [];
  currentOffset = 0;
  hasMore = true;
  removeSentinel();
  await loadRacers();
}

// ── Render ─────────────────────────────────────────────────────────────────
function render() {
  container.innerHTML = '';

  const section = document.createElement('section');
  section.className = 'stats-section';

  const intro = document.createElement('p');
  intro.style.cssText = 'margin-bottom: 1.5rem; color: var(--text-muted);';
  intro.textContent = 'Showing all active commanders ordered by their most recent race submission across any time trial.';
  section.appendChild(intro);

  if (racers.length > 0) {
    section.insertAdjacentHTML('beforeend', renderRacersTable(racers));
  } else {
    section.insertAdjacentHTML('beforeend', '<p class="empty-state">No active racers found.</p>');
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
    if (entries[0].isIntersecting) loadRacers();
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

function renderRacersTable(items) {
  if (!items || items.length === 0) return '<p class="empty-state">No data available.</p>';

  const isMobile = window.innerWidth <= 768;
  const commanderLabel = isMobile ? 'Cmdr' : 'Commander';
  const lastActiveLabel = isMobile ? 'When' : 'Last Active';

  let html = '<table class="stats-table">';
  html += '<thead><tr>';
  html += `<th>${commanderLabel}</th>`;
  html += `<th class="stats-time">${lastActiveLabel}</th>`;
  html += '</tr></thead>';
  html += '<tbody>';

  items.forEach(item => {
    html += '<tr>';
    html += `<td>${renderCmdrLink(item.name)}</td>`;
    html += `<td class="stats-time racer-time" data-timestamp="${item.last_active || ''}">${relativeTime(item.last_active)}</td>`;
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
  const cells = document.querySelectorAll('.racer-time[data-timestamp]');

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
