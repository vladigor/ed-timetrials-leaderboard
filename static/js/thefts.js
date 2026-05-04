import { relativeTime, esc } from './utils.js';
import { ChangePoller } from './poller.js';

// ── State ──────────────────────────────────────────────────────────────────
const FRESH_MS = 60 * 60 * 1000; // 1 hour

function isFresh(ts) {
  if (!ts) return false;
  const norm = ts.replace(' ', 'T').replace(/(\.(\d{1,6})).*$/, '$1') + 'Z';
  return Date.now() - new Date(norm).getTime() < FRESH_MS;
}

let thefts = null;
let poller = null;
let timeUpdater = null;
let currentDays = 30;
let isOffline = false;
let filterVictim = ''; // Ephemeral victim filter
let filterThief = '';  // Ephemeral thief filter
let filterRace = '';   // Ephemeral race filter

// ── DOM refs ───────────────────────────────────────────────────────────────
const container = document.getElementById('thefts-container');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const victimInput = document.getElementById('filter-victim');
const thiefInput = document.getElementById('filter-thief');
const raceInput = document.getElementById('filter-race');

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  // Check for days parameter (default 30)
  const params = new URLSearchParams(window.location.search);
  currentDays = parseInt(params.get('days') || '30', 10);

  // Read filter params from URL and populate inputs
  filterVictim = params.get('victim') || '';
  filterThief = params.get('thief') || '';
  filterRace = params.get('race') || '';

  if (filterVictim) victimInput.value = filterVictim;
  if (filterThief) thiefInput.value = filterThief;
  if (filterRace) raceInput.value = filterRace;

  await loadThefts();

  // Seed poller – refresh when any race changes
  poller = new ChangePoller(60_000, async () => {
    setStatus('updating');
    await loadThefts();
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

  // Set up filter inputs
  victimInput.addEventListener('input', () => {
    filterVictim = victimInput.value;
    updateURL();
    render();
  });

  thiefInput.addEventListener('input', () => {
    filterThief = thiefInput.value;
    updateURL();
    render();
  });

  raceInput.addEventListener('input', () => {
    filterRace = raceInput.value;
    updateURL();
    render();
  });
}

// ── URL management ─────────────────────────────────────────────────────────
function updateURL() {
  const params = new URLSearchParams();

  // Add non-default days parameter
  if (currentDays !== 30) {
    params.set('days', currentDays);
  }

  // Add filter parameters only if they have values
  if (filterVictim) params.set('victim', filterVictim);
  if (filterThief) params.set('thief', filterThief);
  if (filterRace) params.set('race', filterRace);

  // Update URL without page reload (replaceState avoids cluttering history)
  const newURL = params.toString() ? `?${params.toString()}` : window.location.pathname;
  window.history.replaceState({}, '', newURL);
}

// ── Data loading ───────────────────────────────────────────────────────────
async function loadThefts() {
  try {
    const url = `/api/thefts?days=${encodeURIComponent(currentDays)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    thefts = await res.json();
    render();
  } catch (err) {
    container.innerHTML = '<p class="empty-state">Could not load recent trophy thefts.</p>';
  }
}

// ── Render ─────────────────────────────────────────────────────────────────
function render() {
  let html = '';

  html += '<section class="stats-section">';
  html += `<p style="margin-bottom: 1.5rem; color: var(--text-muted);">Trophy thefts occur when a commander is bumped off or down from a podium position (top 3). This page shows all recent thefts across all races in the last ${currentDays} days.</p>`;

  if (thefts && thefts.length > 0) {
    // Apply filters
    let filtered = thefts;

    if (filterVictim) {
      const needle = filterVictim.toLowerCase();
      filtered = filtered.filter(t => t.victim_name?.toLowerCase().includes(needle));
    }

    if (filterThief) {
      const needle = filterThief.toLowerCase();
      filtered = filtered.filter(t => t.thief_name?.toLowerCase().includes(needle));
    }

    if (filterRace) {
      const needle = filterRace.toLowerCase();
      filtered = filtered.filter(t => t.race_name?.toLowerCase().includes(needle));
    }

    if (filtered.length > 0) {
      html += renderTheftsTable(filtered);
    } else {
      html += '<p class="empty-state">No thefts match your filter.</p>';
    }
  } else {
    html += '<p class="empty-state">No recent trophy thefts found. Podium positions have been remarkably stable!</p>';
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

function renderTheftsTable(items) {
  if (!items || items.length === 0) return '<p class="empty-state">No data available.</p>';

  const posLabel = { 1: 'Gold', 2: 'Silver', 3: 'Bronze' };
  const posCls   = { 1: 'theft-pos-1', 2: 'theft-pos-2', 3: 'theft-pos-3' };

  const isMobile = window.innerWidth <= 720;
  const victimLabel = isMobile ? 'Victim' : 'Victim';
  const thiefLabel = isMobile ? 'Thief' : 'Stolen by';
  const positionLabel = isMobile ? 'Lost' : 'Lost Position';

  let html = '<table class="stats-table thefts-table">';
  html += '<thead><tr>';
  html += `<th class="num">${positionLabel}</th>`;
  html += `<th>${victimLabel}</th>`;
  html += `<th>${thiefLabel}</th>`;
  html += `<th>Race</th>`;
  html += `<th style="text-align: center;">Status</th>`;
  html += `<th class="stats-time">When</th>`;
  html += '</tr></thead>';
  html += '<tbody>';

  items.forEach(item => {
    const cls = posCls[item.stolen_position] ?? '';
    const label = posLabel[item.stolen_position] ?? `P${item.stolen_position}`;
    const rowClass = isFresh(item.stolen_at) ? 'row-fresh' : '';

    const thief = item.thief_name
      ? renderCmdrLink(item.thief_name)
      : '<span style="color: var(--text-muted);">unknown</span>';

    let statusBadge = '';
    let statusClass = '';
    if (item.reclaimed) {
      statusBadge = '<span class="status-badge status-reclaimed" title="Trophy reclaimed by original holder!">🏆 Reclaimed</span>';
      statusClass = ' reclaimed-theft';
    } else if (item.redeemed) {
      statusBadge = '<span class="status-badge status-redeemed" title="Thief lost the trophy and victim is now ahead!">✨ Redeemed</span>';
      statusClass = ' redeemed-theft';
    } else if (item.thief_lost) {
      statusBadge = '<span class="status-badge status-dropped" title="Thief no longer holds this trophy">📉 Dropped</span>';
      statusClass = ' thief-lost-theft';
    } else {
      statusBadge = '<span class="status-badge status-active" title="Trophy still held by thief">🔥 Active</span>';
      statusClass = ' active-theft';
    }

    html += `<tr class="${rowClass}${statusClass}">`;
    html += `<td class="num ${cls}">${label}</td>`;
    html += `<td>${renderCmdrLink(item.victim_name)}</td>`;
    html += `<td>${thief}</td>`;
    html += `<td>${renderRaceLink(item.race_key, item.race_name)}</td>`;
    html += `<td class="stats-center">${statusBadge}</td>`;
    html += `<td class="stats-time theft-time" data-timestamp="${item.stolen_at || ''}">${relativeTime(item.stolen_at)}</td>`;
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
  const cells = document.querySelectorAll('.theft-time[data-timestamp]');

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
  if (timeUpdater) return; // Already running
  timeUpdater = setInterval(updateRelativeTimes, 60_000);
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

// ── Status indicator ───────────────────────────────────────────────────────
function setStatus(state) {
  statusDot.className = state === 'live' ? 'dot live'
    : state === 'updating' ? 'dot updating'
    : state === 'offline' ? 'dot offline'
    : 'dot';
  statusText.textContent = state === 'live' ? 'Live'
    : state === 'updating' ? 'Updating…'
    : state === 'offline' ? 'Offline'
    : 'Loading…';
}

// ── Lifecycle ──────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);

// Cleanup when leaving page
window.addEventListener('beforeunload', () => {
  if (poller) poller.stop();
  stopTimeUpdater();
});
