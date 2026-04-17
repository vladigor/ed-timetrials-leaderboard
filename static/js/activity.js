import { relativeTime, esc } from './utils.js';
import { ChangePoller } from './poller.js';

// ── State ──────────────────────────────────────────────────────────────────
const FRESH_MS = 60 * 60 * 1000; // 1 hour

function isFresh(ts) {
  if (!ts) return false;
  const norm = ts.replace(' ', 'T').replace(/(\.(\d{1,6})).*$/, '$1') + 'Z';
  return Date.now() - new Date(norm).getTime() < FRESH_MS;
}

let stats = null;
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
  
  await loadStats();

  // Seed poller – refresh when any race changes (since we show recent activity)
  poller = new ChangePoller(60_000, async () => {
    setStatus('updating');
    await loadStats();
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
async function loadStats() {
  try {
    const url = `/api/stats?limit=${encodeURIComponent(currentLimit)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    stats = await res.json();
    render();
  } catch (err) {
    container.innerHTML = '<p class="empty-state">Could not load recent activity.</p>';
  }
}

// ── Render ─────────────────────────────────────────────────────────────────
function render() {
  let html = '';

  // ── Recent Activity (side by side) ─────────────────────────────────────
  html += '<section class="stats-section">';
  html += '<div class="activity-grid">';

  // Left column: Recently Active Commanders
  html += '<div class="activity-column">';
  if (stats.top_recently_active_cmdrs && stats.top_recently_active_cmdrs.length > 0) {
    html += '<h2 class="cmdr-section-heading">Most Recently Active Commanders</h2>';
    html += renderRecentCommandersTable(stats.top_recently_active_cmdrs);
  } else {
    html += '<h2 class="cmdr-section-heading">Most Recently Active Commanders</h2>';
    html += '<p class="empty-state">No recent activity found.</p>';
  }
  html += '</div>';

  // Right column: Recently Active Races
  html += '<div class="activity-column">';
  if (stats.top_recently_active_races && stats.top_recently_active_races.length > 0) {
    html += '<h2 class="cmdr-section-heading">Most Recently Active Races</h2>';
    html += renderRecentRacesTable(stats.top_recently_active_races);
  } else {
    html += '<h2 class="cmdr-section-heading">Most Recently Active Races</h2>';
    html += '<p class="empty-state">No recent activity found.</p>';
  }
  html += '</div>';

  html += '</div>'; // .activity-grid
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

function renderRecentCommandersTable(items) {
  if (!items || items.length === 0) return '<p class="empty-state">No data available.</p>';
  
  let html = '<table class="stats-table">';
  html += '<thead><tr>';
  html += `<th>Commander</th>`;
  html += `<th class="stats-time">Last Active</th>`;
  html += '</tr></thead>';
  html += '<tbody>';
  
  items.forEach(item => {
    const rowClass = isFresh(item.last_active) ? ' class="row-fresh"' : '';
    html += `<tr${rowClass}>`;
    html += `<td>${renderCmdrLink(item.name)}</td>`;
    html += `<td class="stats-time activity-time" data-timestamp="${item.last_active || ''}">${relativeTime(item.last_active)}</td>`;
    html += '</tr>';
  });
  
  html += '</tbody></table>';
  return html;
}

function renderRecentRacesTable(items) {
  if (!items || items.length === 0) return '<p class="empty-state">No data available.</p>';
  
  let html = '<table class="stats-table">';
  html += '<thead><tr>';
  html += `<th>Race</th>`;
  html += `<th class="stats-time">Last Active</th>`;
  html += '</tr></thead>';
  html += '<tbody>';
  
  items.forEach(item => {
    const rowClass = isFresh(item.last_active) ? ' class="row-fresh"' : '';
    html += `<tr${rowClass}>`;
    html += `<td>${renderRaceLink(item.key, item.name)}</td>`;
    html += `<td class="stats-time activity-time" data-timestamp="${item.last_active || ''}">${relativeTime(item.last_active)}</td>`;
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
function stopTimeUpdater() {
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
