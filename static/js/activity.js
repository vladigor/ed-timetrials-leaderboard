import { relativeTime, esc } from './utils.js';
import { ChangePoller } from './poller.js';

// ── State ──────────────────────────────────────────────────────────────────
const FRESH_MS = 60 * 60 * 1000; // 1 hour

function isFresh(ts) {
  if (!ts) return false;
  const norm = ts.replace(' ', 'T').replace(/(\.(\d{1,6})).*$/, '$1') + 'Z';
  return Date.now() - new Date(norm).getTime() < FRESH_MS;
}

let activity = null;
let poller = null;
let timeUpdater = null;
let currentLimit = 20;
let isOffline = false;

// ── DOM refs ───────────────────────────────────────────────────────────────
const container = document.getElementById('activity-container');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  // Check for limit parameter (default 20)
  const params = new URLSearchParams(window.location.search);
  currentLimit = parseInt(params.get('limit') || '20', 10);

  await loadActivity();

  // Seed poller – refresh when any race changes (since we show recent activity)
  poller = new ChangePoller(60_000, async () => {
    setStatus('updating');
    await loadActivity();
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
async function loadActivity() {
  try {
    const url = `/api/activity?limit=${encodeURIComponent(currentLimit)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    activity = await res.json();
    render();
  } catch (err) {
    container.innerHTML = '<p class="empty-state">Could not load recent activity.</p>';
  }
}

// ── Render ─────────────────────────────────────────────────────────────────
function render() {
  let html = '';

  html += '<section class="stats-section">';
  html += '<p style="margin-bottom: 1.5rem; color: var(--text-muted);">Showing the most recently updated race results. Each entry represents a new or improved time submission.</p>';

  if (activity && activity.length > 0) {
    html += renderActivityTable(activity);
  } else {
    html += '<p class="empty-state">No recent activity found.</p>';
  }

  html += '</section>';

  container.innerHTML = html;
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

  let html = '<table class="stats-table">';
  html += '<thead><tr>';
  html += `<th>Commander</th>`;
  html += `<th>Race</th>`;
  html += `<th style="text-align: center;">Position</th>`;
  html += `<th class="stats-time">Updated</th>`;
  html += '</tr></thead>';
  html += '<tbody>';

  items.forEach(item => {
    const rowClass = isFresh(item.updated) ? ' class="row-fresh"' : '';
    const position = item.position;
    const positionDisplay = position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : (position || '—');

    html += `<tr${rowClass}>`;
    html += `<td>${renderCmdrLink(item.name)}</td>`;
    html += `<td>${renderRaceLink(item.location, item.race_name)}</td>`;
    html += `<td class="stats-rank">${positionDisplay}</td>`;
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
