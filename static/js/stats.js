import { formatTime, relativeTime, esc } from './utils.js';

// ── Utilities ──────────────────────────────────────────────────────────────

/**
 * Format long durations as "NN days YY hrs MM mins"
 * @param {number} ms - milliseconds
 * @returns {string}
 */
function formatLongDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;
  
  const parts = [];
  if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hr${hours !== 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} min${minutes !== 1 ? 's' : ''}`);
  
  return parts.length > 0 ? parts.join(' ') : '0 mins';
}

// ── State ──────────────────────────────────────────────────────────────────
let stats = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
const container = document.getElementById('stats-container');

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  try {
    // Check for secret limit parameter
    const params = new URLSearchParams(window.location.search);
    const limit = params.get('limit');
    const url = limit ? `/api/stats?limit=${encodeURIComponent(limit)}` : '/api/stats';
    
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    stats = await res.json();
  } catch (err) {
    container.innerHTML = '<p class="empty-state">Could not load statistics.</p>';
    return;
  }

  render();
}

// ── Render ─────────────────────────────────────────────────────────────────
function render() {
  let html = '';

  // ── Overview Stats ──────────────────────────────────────────────────────
  html += '<section class="stats-section">';
  html += '<h2 class="cmdr-section-heading">Overview</h2>';
  html += '<div class="stats-grid">';
  
  html += renderStatCard('Total Races', stats.total_races);
  html += renderStatCard('Total Racers', stats.total_racers);
  html += renderStatCard('Race Creators', stats.total_contributors);
  html += renderStatCard('Active Races (30d)', stats.active_races_30d);
  
  html += '</div>';
  html += '</section>';

  // ── Race Records ────────────────────────────────────────────────────────
  html += '<section class="stats-section">';
  html += '<h2 class="cmdr-section-heading">Race Records</h2>';
  html += '<div class="stats-grid">';

  if (stats.longest_race) {
    html += renderStatCard(
      'Longest Race',
      renderRaceLink(stats.longest_race.key, stats.longest_race.name),
      `Fastest time on this race: ${formatLongDuration(stats.longest_race.fastest_time_ms)}`
    );
  }

  if (stats.shortest_race) {
    html += renderStatCard(
      'Shortest Race',
      renderRaceLink(stats.shortest_race.key, stats.shortest_race.name),
      `Fastest time on this race: ${formatTime(stats.shortest_race.fastest_time_ms)}`
    );
  }

  if (stats.most_perseverance) {
    html += renderStatCard(
      'Most Perseverance',
      renderCmdrLink(stats.most_perseverance.name),
      `${formatLongDuration(stats.most_perseverance.time_ms)} on ${renderRaceLink(stats.most_perseverance.location, stats.most_perseverance.race_name)}`
    );
  }

  html += '</div>';
  html += '</section>';

  // ── Top Performers ──────────────────────────────────────────────────────
  html += '<section class="stats-section">';
  html += '<h2 class="cmdr-section-heading">Top Performers</h2>';

  if (stats.top_gold_medals && stats.top_gold_medals.length > 0) {
    html += '<h3 class="stats-subsection-heading">Most Gold Medals (1st Place Finishes)</h3>';
    html += renderTopNTable(stats.top_gold_medals, 'commander', 'gold medals');
  }

  if (stats.top_podium_finishes && stats.top_podium_finishes.length > 0) {
    html += '<h3 class="stats-subsection-heading">Most Podium Finishes (In the top 3)</h3>';
    html += renderTopNTable(stats.top_podium_finishes, 'commander', 'podium finishes');
  }

  if (stats.top_dedicated_racers && stats.top_dedicated_racers.length > 0) {
    html += '<h3 class="stats-subsection-heading">Most Dedicated Racers (Participated in Most Races)</h3>';
    html += renderTopNTable(stats.top_dedicated_racers, 'commander', 'races participated');
  }

    // ── Top Contributors ────────────────────────────────────────────────────
  if (stats.top_creators && stats.top_creators.length > 0) {
    html += '<h3 class="stats-subsection-heading">Top Contributors</h3>';
    html += renderTopNTable(stats.top_creators, 'creator', 'races created');
  }

  html += '</section>';

  // ── Most Competitive Races ──────────────────────────────────────────────
  if (stats.top_competitive_races && stats.top_competitive_races.length > 0) {
    html += '<section class="stats-section">';
    html += '<h2 class="cmdr-section-heading">Races with the Most Participants</h2>';
    html += renderRaceTable(stats.top_competitive_races, 'participants');
    html += '</section>';
  }

  // ── Least Competitive Races ─────────────────────────────────────────────
  if (stats.least_competitive_races && stats.least_competitive_races.length > 0) {
    html += '<section class="stats-section">';
    html += '<h2 class="cmdr-section-heading">Races with the Fewest Participants</h2>';
    html += '<p class="stats-section-description">Want to bag a sneaky trophy? These races haven\'t had much love — maybe you can pad out the numbers and sneak a trophy while no-one is looking?</p>';
    html += renderRaceTable(stats.least_competitive_races, 'participants');
    html += '</section>';
  }

  // ── Least Recently Active Races ─────────────────────────────────────────
  if (stats.least_recently_active_races && stats.least_recently_active_races.length > 0) {
    html += '<section class="stats-section">';
    html += '<h2 class="cmdr-section-heading">Most Neglected Races (Longest Time Since Activity)</h2>';
    html += '<p class="stats-section-description">These races are gathering dust in the hangar. Show them some love and be the first to set a new time in ages!</p>';
    html += renderRecentRacesTable(stats.least_recently_active_races);
    html += '</section>';
  }

  // ── Popular Vehicles ────────────────────────────────────────────────────
  html += '<section class="stats-section">';
  html += '<h2 class="cmdr-section-heading">Popular Vehicles</h2>';

  if (stats.top_ship_types && stats.top_ship_types.length > 0) {
    html += '<h3 class="stats-subsection-heading">Most Popular Ships</h3>';
    html += renderVehicleTable(stats.top_ship_types);
  }

  if (stats.top_fighter_types && stats.top_fighter_types.length > 0) {
    html += '<h3 class="stats-subsection-heading">Most Popular Fighters</h3>';
    html += renderVehicleTable(stats.top_fighter_types);
  }

  html += '</section>';

  // ── Top Systems ─────────────────────────────────────────────────────────
  if (stats.top_systems && stats.top_systems.length > 0) {
    html += '<section class="stats-section">';
    html += '<h2 class="cmdr-section-heading">Systems That Host The Most Races</h2>';
    html += renderSystemTable(stats.top_systems);
    html += '</section>';
  }

  container.innerHTML = html;
}

// ── Render helpers ─────────────────────────────────────────────────────────

function renderStatCard(label, value, subtitle = '') {
  const valueHtml = typeof value === 'number' ? value.toLocaleString() : value;
  const subtitleHtml = subtitle ? `<div class="stat-card-subtitle">${subtitle}</div>` : '';
  return `
    <div class="stat-card">
      <div class="stat-card-label">${esc(label)}</div>
      <div class="stat-card-value">${valueHtml}</div>
      ${subtitleHtml}
    </div>
  `;
}

function renderCmdrLink(name) {
  return `<a href="/cmdr/${encodeURIComponent(name)}">${esc(name)}</a>`;
}

function renderRaceLink(key, name) {
  return `<a href="/race/${encodeURIComponent(key)}">${esc(name)}</a>`;
}

function renderTopNTable(items, nameLabel, countLabel) {
  if (!items || items.length === 0) return '<p class="empty-state">No data available.</p>';

  const isCmdr = nameLabel === 'commander' || nameLabel === 'creator';
  
  let html = '<table class="stats-table">';
  html += '<thead><tr>';
  html += `<th class="stats-rank">Rank</th>`;
  html += `<th>${esc(nameLabel.charAt(0).toUpperCase() + nameLabel.slice(1))}</th>`;
  html += `<th class="stats-count">${esc(countLabel.charAt(0).toUpperCase() + countLabel.slice(1))}</th>`;
  html += '</tr></thead>';
  html += '<tbody>';
  
  let currentRank = 1;
  items.forEach((item, idx) => {
    // Handle ties: if this item's count equals the previous item's count, use the same rank
    if (idx > 0 && item.count !== items[idx - 1].count) {
      currentRank = idx + 1;
    }
    const medal = currentRank === 1 ? '🥇' : currentRank === 2 ? '🥈' : currentRank === 3 ? '🥉' : currentRank.toString();
    const nameDisplay = isCmdr ? renderCmdrLink(item.name) : esc(item.name);
    html += '<tr>';
    html += `<td class="stats-rank">${medal}</td>`;
    html += `<td>${nameDisplay}</td>`;
    html += `<td class="stats-count">${item.count.toLocaleString()}</td>`;
    html += '</tr>';
  });
  
  html += '</tbody></table>';
  return html;
}

function renderSystemTable(items) {
  if (!items || items.length === 0) return '<p class="empty-state">No data available.</p>';
  
  let html = '<table class="stats-table">';
  html += '<thead><tr>';
  html += `<th>System</th>`;
  html += `<th class="stats-count">Races</th>`;
  html += '</tr></thead>';
  html += '<tbody>';
  
  items.forEach(item => {
    html += '<tr>';
    html += `<td>${esc(item.system)}</td>`;
    html += `<td class="stats-count">${item.count.toLocaleString()}</td>`;
    html += '</tr>';
  });
  
  html += '</tbody></table>';
  return html;
}

function renderRaceTable(items, countLabel) {
  if (!items || items.length === 0) return '<p class="empty-state">No data available.</p>';
  
  let html = '<table class="stats-table">';
  html += '<thead><tr>';
  html += `<th>Race</th>`;
  html += `<th class="stats-count">${esc(countLabel.charAt(0).toUpperCase() + countLabel.slice(1))}</th>`;
  html += '</tr></thead>';
  html += '<tbody>';
  
  items.forEach(item => {
    html += '<tr>';
    html += `<td>${renderRaceLink(item.key, item.name)}</td>`;
    html += `<td class="stats-count">${item.count.toLocaleString()}</td>`;
    html += '</tr>';
  });
  
  html += '</tbody></table>';
  return html;
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
    html += '<tr>';
    html += `<td>${renderCmdrLink(item.name)}</td>`;
    html += `<td class="stats-time">${relativeTime(item.last_active)}</td>`;
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
    html += '<tr>';
    html += `<td>${renderRaceLink(item.key, item.name)}</td>`;
    html += `<td class="stats-time">${relativeTime(item.last_active)}</td>`;
    html += '</tr>';
  });
  
  html += '</tbody></table>';
  return html;
}

function renderVehicleTable(items) {
  if (!items || items.length === 0) return '<p class="empty-state">No data available.</p>';
  
  let html = '<table class="stats-table">';
  html += '<thead><tr>';
  html += `<th>Vehicle</th>`;
  html += `<th class="stats-count">Times Set</th>`;
  html += '</tr></thead>';
  html += '<tbody>';
  
  items.forEach(item => {
    html += '<tr>';
    html += `<td>${esc(item.ship)}</td>`;
    html += `<td class="stats-count">${item.count.toLocaleString()}</td>`;
    html += '</tr>';
  });
  
  html += '</tbody></table>';
  return html;
}

// ── Start ──────────────────────────────────────────────────────────────────
init();
