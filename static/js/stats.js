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
let points = [];
let extras = null;
let visualDays = 180;
const selectedCmdr = localStorage.getItem('tt_filter_cmdr') || '';

let graphContainer = null;
let compositionContainer = null;
let racerCompositionContainer = null;
let participationContainer = null;
let freshnessContainer = null;
let rivalryContainer = null;
let heatmapContainer = null;
let leadersContainer = null;
let medalsContainer = null;
let vehiclesContainer = null;

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

    await loadVisualData();
  } catch (err) {
    container.innerHTML = '<p class="empty-state">Could not load statistics.</p>';
    return;
  }

  render();
}

async function loadVisualData() {
  const [trendRes, extrasRes] = await Promise.all([
    fetch(`/api/active-racers-graph?days=${visualDays}`),
    fetch(`/api/visual-stats-extras?days=${visualDays}&months=12`),
  ]);

  if (!trendRes.ok) throw new Error(String(trendRes.status));
  if (!extrasRes.ok) throw new Error(String(extrasRes.status));

  points = await trendRes.json();
  extras = await extrasRes.json();
}

// ── Render ─────────────────────────────────────────────────────────────────
function render() {
  let html = '';

  // ── Races ──────────────────────────────────────────────────────
  html += '<section class="stats-section">';
  html += '<h2 class="cmdr-section-heading">Locations</h2>';
  html += '<div class="stats-grid">';

  html += renderStatCard('Total Races', stats.total_races);
  html += renderStatCard('DW3 Races', stats.dw3_races, 'Races that were created during the Distant Worlds 3 expedition.');
  html += renderStatCard('Non-DW3 Races', stats.non_dw3_races, 'Races that were created outside of the Distant Worlds 3 expedition.');
  html += renderStatCard('Active Races', stats.active_races_30d, 'Races that have had at least one time set in the last 30 days');
  html += renderStatCard('SRV Races', stats.srv_races, 'Races with SRV as the primary race type');
  html += renderStatCard('Ship Races', stats.ship_races, 'Races with ship as the primary race type');
  html += renderStatCard('Fighter Races', stats.fighter_races, 'Races with fighter as the primary race type');
  html += renderStatCard('On Foot Races', stats.onfoot_races, 'Races with on-foot as the primary race type');

  html += '</div>';
  html += '</section>';

  html += '<section class="stats-section">';
  html += '<h2 class="cmdr-section-heading">Location Visuals</h2>';
  html += '<div id="composition-container" class="trend-composition-panel"><p class="loading-placeholder">Loading race composition...</p></div>';
  html += '<div id="freshness-container" class="trend-composition-panel"><p class="loading-placeholder">Loading race freshness...</p></div>';
  html += '</section>';

  // ── Racers ────────────────────────────────────────────────────────
  html += '<section class="stats-section">';
  html += '<h2 class="cmdr-section-heading">Participants</h2>';
  html += '<div class="stats-grid">';

  html += renderStatCard('Total Racers', stats.total_racers, 'Note that this will include some Alt accounts');
  html += renderStatCard('DW3 Racers', stats.dw3_racers, 'Racers who have set a time on at least one DW3 race');
  html += renderStatCard('Non-DW3 Racers', stats.non_dw3_racers, 'Racers who have set a time on at least one non-DW3 race');
  html += '<a href="/active-racers" class="stat-card-link">';
  html += renderStatCard('Active Racers', stats.active_racers_30d, 'Racers who have set at least one time in the last 30 days');
  html += '</a>';
  html += '<a href="/visual-stats" class="stat-card-link">';
  html += renderStatCard('Active Racers Trend', 'View Graph', 'Daily active racers over time');
  html += '</a>';

  //html += renderStatCard('Race Creators', stats.total_contributors);

  html += '</div>';
  html += '</section>';

  html += '<section class="stats-section">';
  html += '<h2 class="cmdr-section-heading">Participant Visuals</h2>';
  html += '<div id="racer-composition-container" class="trend-composition-panel"><p class="loading-placeholder">Loading racer composition...</p></div>';
  html += '<div id="participation-container" class="trend-composition-panel"><p class="loading-placeholder">Loading participation depth...</p></div>';
  html += '<h3 class="stats-subsection-heading">Active Racers 7-Day Rolling Average</h3>';
  html += '<div class="active-racers-graph-controls">';
  html += '<label for="stats-graph-range-days">Time range</label>';
  html += '<select id="stats-graph-range-days">';
  html += '<option value="30">Last 30 days</option>';
  html += '<option value="90">Last 90 days</option>';
  html += '<option value="180" selected>Last 180 days</option>';
  html += '<option value="365">Last 365 days</option>';
  html += '</select>';
  html += '</div>';
  html += '<div id="graph-container" class="trend-chart-panel"><p class="loading-placeholder">Loading active racers graph...</p></div>';
  html += '<h3 class="stats-subsection-heading">Activity Time-of-Week Heatmap</h3>';
  html += '<div id="heatmap-container" class="trend-composition-panel"><p class="loading-placeholder">Loading activity heatmap...</p></div>';
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

  if (stats.top_podium_finishes && stats.top_podium_finishes.length > 0) {
    html += '<h3 class="stats-subsection-heading">Medals Table</h3>';
    html += renderPodiumTable(stats.top_podium_finishes);
    html += '<h3 class="stats-subsection-heading">Medals Visual</h3>';
    html += '<div id="medals-container" class="trend-composition-panel"><p class="loading-placeholder">Loading medals chart...</p></div>';
  }

  if (stats.top_dedicated_racers && stats.top_dedicated_racers.length > 0) {
    html += '<h3 class="stats-subsection-heading">Most Dedicated Racers (Participated in Most Races)</h3>';
    html += renderTopNTable(stats.top_dedicated_racers, 'commander', 'races participated');
  }

    // ── Top Contributors ────────────────────────────────────────────────────
  if (stats.top_creators && stats.top_creators.length > 0) {
    html += '<h3 class="stats-subsection-heading">Top Contributors</h3>';
    html += renderTopNTable(stats.top_creators, 'creator', 'races created');
    html += '<h3 class="stats-subsection-heading">Top Creators & Systems Visual</h3>';
    html += '<div id="leaders-container" class="trend-grid-2">';
    html += '<div class="trend-composition-panel"><p class="loading-placeholder">Loading top creators...</p></div>';
    html += '<div class="trend-composition-panel"><p class="loading-placeholder">Loading top systems...</p></div>';
    html += '</div>';
  }
  html += '</section>';

  // ── Biggest Leaders ─────────────────────────────────────────────────────
  if (stats.biggest_leaders && stats.biggest_leaders.length > 0) {
    html += '<section class="stats-section">';
    html += '<h2 class="cmdr-section-heading">Biggest Leaders</h2>';
    html += '<p class="stats-section-description">The largest gaps between 1st and 2nd place — pure dominance!</p>';
    html += renderLeaderGapTable(stats.biggest_leaders);
    html += '</section>';
  }

  // ── Closest Finishes ────────────────────────────────────────────────────
  if (stats.closest_finishes && stats.closest_finishes.length > 0) {
    html += '<section class="stats-section">';
    html += '<h2 class="cmdr-section-heading">Closest Finishes</h2>';
    html += '<p class="stats-section-description">The tightest races — where victory hung by a thread!</p>';
    html += renderLeaderGapTable(stats.closest_finishes);
    html += '<h3 class="stats-subsection-heading">Rivalry Intensity</h3>';
    html += '<p class="stats-section-description">Scores reflect how competitive races are: based on position changes in the top 3 and how close their times are. Higher scores = more intense competition.</p>';
    html += '<div id="rivalry-container" class="trend-composition-panel"><p class="loading-placeholder">Loading rivalry intensity...</p></div>';
    html += '</section>';
  }

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

  html += '<h3 class="stats-subsection-heading">Vehicle Popularity Visual</h3>';
  html += '<div id="vehicles-container" class="trend-grid-2">';
  html += '<div class="trend-composition-panel"><p class="loading-placeholder">Loading ship popularity...</p></div>';
  html += '<div class="trend-composition-panel"><p class="loading-placeholder">Loading fighter popularity...</p></div>';
  html += '</div>';

  html += '</section>';

  // ── Top Systems ─────────────────────────────────────────────────────────
  if (stats.top_systems && stats.top_systems.length > 0) {
    html += '<section class="stats-section">';
    html += '<h2 class="cmdr-section-heading">Systems That Host The Most Races</h2>';
    html += renderSystemTable(stats.top_systems);
    html += '</section>';
  }

  // ── Popular Ship Names ─────────────────────────────────────────────────
  if (stats.popular_ship_names && stats.popular_ship_names.length > 0) {
    html += '<section class="stats-section">';
    html += '<h2 class="cmdr-section-heading">Popular Ship Names</h2>';
    html += '<p class="stats-section-description">Ship names used by more than one cmdr.</p>';
    html += renderPopularShipNamesTable(stats.popular_ship_names);
    html += '</section>';
  }

  const urlParams = new URLSearchParams(window.location.search);
  const currentLimit = urlParams.get('limit') || 10;
  let newLimit = 25;
  let message = "Show Me More Stats";
  if (currentLimit == 25) {
    message = "Show Me MOOOORE Stats!";
    newLimit = 50;
  } else if (currentLimit == 50) {
    message = "WTF is wrong with you? That's a lot of stats. Let's calm down and go back to 10.";
    newLimit = 10;
  } else if (currentLimit >= 50) {
    message = "Well, ain't you clever. You're gonna break the stats page with your insane thirst for data. Let's reset back to 10 before we melt some servers.";
    newLimit = 10;
  }
  html += `<a href="/stats?limit=${newLimit}" class="btn">${message}</a>`;

  container.innerHTML = html;

  const graphRangeSelect = document.getElementById('stats-graph-range-days');
  if (graphRangeSelect) {
    graphRangeSelect.value = String(visualDays);
    graphRangeSelect.onchange = async () => {
      visualDays = Number(graphRangeSelect.value || 180);
      try {
        await loadVisualData();
      } catch {
        // Keep existing values if refresh fails.
      }
      renderVisualCharts();
    };
  }

  renderVisualCharts();
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

function typeBadge(type) {
  if (!type) return '';
  const cls = { SHIP: 'badge-ship', SRV: 'badge-srv', FIGHTER: 'badge-fighter', ONFOOT: 'badge-onfoot' }[type] ?? 'badge-onfoot';
  return `<span class="badge ${cls}">${esc(type)}</span>`;
}

function versionBadge(version) {
  if (!version || version === 'ODYSSEY') return '';
  // version can be stored as 'HRZ' or 'HORIZONS' in the database
  if (version === 'HRZ' || version === 'HORIZONS') {
    return `<span class="info-badge info-badge-horizons">Horizons</span>`;
  }
  return '';
}

function tagsBadges(tags) {
  if (!tags) return '';
  return tags
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
    .map(t => {
      const title = t === 'Inactive' ? "It's no longer possible to compete in this time trial" : `Tagged race: ${t}`;
      const badgeClass = t === 'DW3' ? 'info-badge-dw3' : 'info-badge-inactive';
      return `<span class="info-badge ${badgeClass}" title="${esc(title)}">${esc(t)}</span>`;
    })
    .join(' ');
}

function renderTopNTable(items, nameLabel, countLabel) {
  if (!items || items.length === 0) return '<p class="empty-state">No data available.</p>';

  const isCmdr = nameLabel === 'commander' || nameLabel === 'creator';

  let html = '<table class="stats-table">';
  html += '<thead><tr>';
  html += `<th class="stats-rank">Rank</th>`;
  html += `<th>${esc(nameLabel.charAt(0).toUpperCase() + nameLabel.slice(1))}</th>`;
  const countHeading = countLabel === 'races participated'
    ? `<span class="label-desktop">Races Participated</span><span class="label-mobile">Races Done</span>`
    : esc(countLabel.charAt(0).toUpperCase() + countLabel.slice(1));
  html += `<th class="stats-count">${countHeading}</th>`;
  html += '</tr></thead>';
  html += '<tbody>';

  let currentRank = 1;
  items.forEach((item, idx) => {
    // Handle ties: if this item's count equals the previous item's count, use the same rank
    if (idx > 0 && item.count !== items[idx - 1].count) {
      currentRank = idx + 1;
    }
    const medal = currentRank === 1 ? '🏆' : currentRank === 2 ? '🥈' : currentRank === 3 ? '🥉' : currentRank.toString();
    const nameDisplay = isCmdr ? renderCmdrLink(item.name) : esc(item.name);
    const rowClass = selectedCmdr && item.name === selectedCmdr ? ' class="row-cmdr"' : '';
    html += `<tr${rowClass}>`;
    html += `<td class="stats-rank">${medal}</td>`;
    html += `<td>${nameDisplay}</td>`;
    html += `<td class="stats-count">${item.count.toLocaleString()}</td>`;
    html += '</tr>';
  });

  html += '</tbody></table>';
  return html;
}

function renderPodiumTable(items) {
  if (!items || items.length === 0) return '<p class="empty-state">No data available.</p>';

  let html = '<table class="stats-table">';
  html += '<thead><tr>';
  html += `<th class="stats-rank">Rank</th>`;
  html += `<th>Commander</th>`;
  html += `<th class="stats-count">🥇</th>`;
  html += `<th class="stats-count">🥈</th>`;
  html += `<th class="stats-count">🥉</th>`;
  html += '</tr></thead>';
  html += '<tbody>';

  let currentRank = 1;
  items.forEach((item, idx) => {
    if (idx > 0 && (item.gold !== items[idx - 1].gold || item.silver !== items[idx - 1].silver || item.bronze !== items[idx - 1].bronze)) {
      currentRank = idx + 1;
    }
    const medal = currentRank === 1 ? '🏆' : currentRank === 2 ? '🥈' : currentRank === 3 ? '🥉' : currentRank.toString();
    const nameDisplay = renderCmdrLink(item.name);
    const rowClass = selectedCmdr && item.name === selectedCmdr ? ' class="row-cmdr"' : '';

    html += `<tr${rowClass}>`;
    html += `<td class="stats-rank">${medal}</td>`;
    html += `<td>${nameDisplay}</td>`;
    html += `<td class="stats-count">${item.gold}</td>`;
    html += `<td class="stats-count">${item.silver}</td>`;
    html += `<td class="stats-count">${item.bronze}</td>`;
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
    const badges = `${typeBadge(item.type)} ${versionBadge(item.version)} ${tagsBadges(item.tags)}`;
    html += '<tr>';
    html += `<td>${renderRaceLink(item.key, item.name)} ${badges}</td>`;
    html += `<td class="stats-count">${item.count.toLocaleString()}</td>`;
    html += '</tr>';
  });

  html += '</tbody></table>';
  return html;
}

function _renderRecentCommandersTable(items) {
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
    const badges = `${typeBadge(item.type)} ${versionBadge(item.version)} ${tagsBadges(item.tags)}`;
    html += '<tr>';
    html += `<td>${renderRaceLink(item.key, item.name)} ${badges}</td>`;
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

function renderPopularShipNamesTable(items) {
  if (!items || items.length === 0) return '<p class="empty-state">No data available.</p>';

  let html = '<table class="stats-table">';
  html += '<thead><tr>';
  html += '<th>Ship Name</th>';
  html += '<th>Commanders</th>';
  html += '</tr></thead>';
  html += '<tbody>';

  items.forEach(item => {
    const cmdrs = (item.cmdrs || []).map(n => renderCmdrLink(n)).join(', ');
    html += '<tr>';
    html += `<td>${esc(item.ship_name)}</td>`;
    html += `<td>${cmdrs || '<span class="muted">—</span>'}</td>`;
    html += '</tr>';
  });

  html += '</tbody></table>';
  return html;
}

function renderLeaderGapTable(items) {
  if (!items || items.length === 0) return '<p class="empty-state">No data available.</p>';

  let html = '<table class="stats-table">';
  html += '<thead><tr>';
  html += `<th>Race</th>`;
  html += `<th>Winner</th>`;
  html += `<th>2nd Place</th>`;
  html += `<th class="stats-time">Lead Time</th>`;
  html += `<th class="stats-count">Lead %</th>`;
  html += '</tr></thead>';
  html += '<tbody>';

  items.forEach(item => {
    const isSelectedCmdr = selectedCmdr && (item.commander === selectedCmdr || item.second_commander === selectedCmdr);
    const rowClass = isSelectedCmdr ? ' class="row-cmdr"' : '';
    const badges = `${typeBadge(item.type)} ${versionBadge(item.version)} ${tagsBadges(item.tags)}`;
    html += `<tr${rowClass}>`;
    html += `<td>${renderRaceLink(item.key, item.race_name)} ${badges}</td>`;
    html += `<td>${renderCmdrLink(item.commander)}</td>`;
    html += `<td>${renderCmdrLink(item.second_commander)}</td>`;
    html += `<td class="stats-time">${formatTime(item.lead_ms)}</td>`;
    html += `<td class="stats-count">${item.lead_pct}%</td>`;
    html += '</tr>';
  });

  html += '</tbody></table>';
  return html;
}

function renderVisualCharts() {
  graphContainer = document.getElementById('graph-container');
  compositionContainer = document.getElementById('composition-container');
  racerCompositionContainer = document.getElementById('racer-composition-container');
  participationContainer = document.getElementById('participation-container');
  freshnessContainer = document.getElementById('freshness-container');
  rivalryContainer = document.getElementById('rivalry-container');
  heatmapContainer = document.getElementById('heatmap-container');
  leadersContainer = document.getElementById('leaders-container');
  medalsContainer = document.getElementById('medals-container');
  vehiclesContainer = document.getElementById('vehicles-container');

  if (!stats || !extras) {
    return;
  }

  renderCompositionVisual(stats, extras.race_participant_groups || []);
  renderRacerCompositionVisual(stats);
  renderParticipationDepthVisual(extras.participation_depth || []);
  renderRaceFreshnessVisual(extras.race_freshness_distribution || []);
  renderRivalryIntensityVisual(extras.rivalry_intensity || []);
  renderSubmissionHeatmapVisual(extras.submission_heatmap || []);
  renderTopCreatorsSystemsVisual(stats);
  renderMedalsChartVisual(stats);
  renderVehiclePopularityVisual(stats);
  renderActiveRacersChartVisual(points || []);
}

function renderCompositionVisual(data, participantGroups) {
  if (!compositionContainer || !data) return;

  const totalRaces = Number(data.total_races || 0);
  const activeRaces = Number(data.active_races_30d || 0);
  const inactiveRaces = Math.max(totalRaces - activeRaces, 0);
  const groupLookup = {};
  (Array.isArray(participantGroups) ? participantGroups : []).forEach(row => {
    groupLookup[String(row.bucket)] = Number(row.count || 0);
  });

  compositionContainer.innerHTML = [
    '<div class="stacked-bars">',
    renderStackedBarVisual('DW3 vs Non-DW3', [
      { label: 'DW3', value: Number(data.dw3_races || 0), className: 'seg-dw3' },
      { label: 'Non-DW3', value: Number(data.non_dw3_races || 0), className: 'seg-nondw3' },
    ]),
    renderStackedBarVisual('Race Types', [
      { label: 'SRV', value: Number(data.srv_races || 0), className: 'seg-srv' },
      { label: 'Ship', value: Number(data.ship_races || 0), className: 'seg-ship' },
      { label: 'Fighter', value: Number(data.fighter_races || 0), className: 'seg-fighter' },
      { label: 'On Foot', value: Number(data.onfoot_races || 0), className: 'seg-onfoot' },
    ]),
    renderStackedBarVisual('Active vs Inactive (30d)', [
      { label: 'Active (30d)', value: activeRaces, className: 'seg-active' },
      { label: 'Inactive', value: inactiveRaces, className: 'seg-inactive' },
    ]),
    renderStackedBarVisual('Participants per Race', [
      { label: '0', value: groupLookup['0'] || 0, className: 'seg-part-0' },
      { label: '1', value: groupLookup['1'] || 0, className: 'seg-part-1' },
      { label: '2-4', value: groupLookup['2-4'] || 0, className: 'seg-part-2-4' },
      { label: '5-9', value: groupLookup['5-9'] || 0, className: 'seg-part-5-9' },
      { label: '10+', value: groupLookup['10+'] || 0, className: 'seg-part-10p' },
    ]),
    '</div>',
  ].join('');
}

function renderRacerCompositionVisual(data) {
  if (!racerCompositionContainer || !data) return;
  const totalRacers = Number(data.total_racers || 0);
  const activeRacers = Number(data.active_racers_30d || 0);
  const inactiveRacers = Math.max(totalRacers - activeRacers, 0);
  const dw3Racers = Number(data.dw3_racers || 0);
  const nonDw3Racers = Number(data.non_dw3_racers || 0);

  racerCompositionContainer.innerHTML = [
    '<div class="stacked-bars">',
    renderStackedBarVisual('Active vs Inactive Racers (30d)', [
      { label: 'Active (30d)', value: activeRacers, className: 'seg-active' },
      { label: 'Inactive (30d)', value: inactiveRacers, className: 'seg-inactive' },
    ]),
    renderScaledBarsVisual('DW3 Participation (of total racers)', totalRacers, [
      { label: 'DW3 Racers', value: dw3Racers, className: 'seg-dw3' },
      { label: 'Non-DW3 Racers', value: nonDw3Racers, className: 'seg-nondw3' },
    ], 'Commanders can be counted in both groups.'),
    '</div>',
  ].join('');
}

function renderParticipationDepthVisual(rows) {
  if (!participationContainer) return;
  participationContainer.innerHTML = renderHorizontalBarsCardVisual(
    'How many races each commander has entered',
    rows,
    row => `${row.bucket} race${String(row.bucket) === '1' ? '' : 's'}`,
    row => row.count,
    'seg-onfoot',
  );
}

function renderRaceFreshnessVisual(rows) {
  if (!freshnessContainer) return;
  freshnessContainer.innerHTML = renderHorizontalBarsCardVisual(
    'Races by days since last activity',
    rows,
    row => row.bucket,
    row => row.count,
    'seg-nondw3',
  );
}

function renderRivalryIntensityVisual(rows) {
  if (!rivalryContainer) return;
  rivalryContainer.innerHTML = renderHorizontalBarsCardVisual(
    'Most intense rivalries (last 30 days)',
    rows,
    row => row.race_name,
    row => row.intensity,
    'seg-fighter',
  );
}

function renderSubmissionHeatmapVisual(rows) {
  if (!heatmapContainer) return;
  if (!rows || rows.length === 0) {
    heatmapContainer.innerHTML = '<p class="empty-state">No heatmap data available.</p>';
    return;
  }
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const orderedRows = [...rows].sort((a, b) => (Number(a.dow || 0) || 0) - (Number(b.dow || 0) || 0));
  const withSundayBottom = orderedRows.sort((a, b) => {
    const aOrder = Number(a.dow) === 0 ? 7 : Number(a.dow);
    const bOrder = Number(b.dow) === 0 ? 7 : Number(b.dow);
    return aOrder - bOrder;
  });
  const max = Math.max(...rows.flatMap(r => r.hours || []), 1);
  const hourHeader = ['<div class="heatmap-row heatmap-header"><div class="heatmap-day-label"></div>']
    .concat(Array.from({ length: 24 }, (_, h) => `<div class="heatmap-hour">${h}</div>`))
    .concat(['</div>'])
    .join('');
  const body = withSundayBottom
    .map(r => {
      const cells = (r.hours || []).map(v => {
        const alpha = 0.1 + ((max > 0 ? v / max : 0) * 0.9);
        return `<div class="heatmap-cell" style="background: rgba(232,160,32,${alpha.toFixed(3)})" title="${v} activity"></div>`;
      }).join('');
      return `<div class="heatmap-row"><div class="heatmap-day-label">${dayLabels[r.dow] || r.dow}</div>${cells}</div>`;
    })
    .join('');
  heatmapContainer.innerHTML = `<div class="heatmap-wrap">${hourHeader}${body}</div>`;
}

function renderTopCreatorsSystemsVisual(data) {
  if (!leadersContainer) return;
  const creators = (data?.top_creators || []).slice(0, 10);
  const systems = (data?.top_systems || []).filter(row => Number(row.count || 0) > 1).slice(0, 10);
  leadersContainer.innerHTML = [
    renderHorizontalBarsCardVisual('Top Creators', creators, row => row.name, row => row.count, 'seg-dw3'),
    renderHorizontalBarsCardVisual('Top Systems', systems, row => row.system, row => row.count, 'seg-ship'),
  ].join('');
}

function renderMedalsChartVisual(data) {
  if (!medalsContainer) return;
  const rows = (data?.top_podium_finishes || []).slice(0, 15);
  if (!rows.length) {
    medalsContainer.innerHTML = '<p class="empty-state">No medals data available.</p>';
    return;
  }
  const maxTotal = Math.max(...rows.map(r => Number(r.count || 0)), 1);
  const bars = rows.map(row => {
    const total = Number(row.count || 0);
    const totalSafe = Math.max(total, 1);
    const scale = (total / maxTotal) * 100;
    const goldPct = (Number(row.gold || 0) / totalSafe) * 100;
    const silverPct = (Number(row.silver || 0) / totalSafe) * 100;
    const bronzePct = (Number(row.bronze || 0) / totalSafe) * 100;
    return [
      '<li class="hbar-row medals-row">',
      `<span class="hbar-label" title="${row.name}">${row.name}</span>`,
      '<span class="hbar-track medals-track">',
      `<span class="hbar-fill seg-gold" style="width:${(scale * goldPct / 100).toFixed(2)}%"></span>`,
      `<span class="hbar-fill seg-silver" style="width:${(scale * silverPct / 100).toFixed(2)}%"></span>`,
      `<span class="hbar-fill seg-bronze" style="width:${(scale * bronzePct / 100).toFixed(2)}%"></span>`,
      '</span>',
      `<span class="hbar-value">${total}</span>`,
      '</li>',
    ].join('');
  }).join('');
  medalsContainer.innerHTML = [
    '<ul class="hbar-list">',
    bars,
    '</ul>',
    '<div class="chart-legend medals-legend">',
    '<span class="chart-legend-item"><span class="stacked-swatch seg-gold"></span>Gold</span>',
    '<span class="chart-legend-item"><span class="stacked-swatch seg-silver"></span>Silver</span>',
    '<span class="chart-legend-item"><span class="stacked-swatch seg-bronze"></span>Bronze</span>',
    '</div>',
  ].join('');
}

function renderVehiclePopularityVisual(data) {
  if (!vehiclesContainer) return;
  const ships = (data?.top_ship_types || []).slice(0, 10);
  const fighters = (data?.top_fighter_types || []).slice(0, 10);
  vehiclesContainer.innerHTML = [
    renderHorizontalBarsCardVisual('Top Ship Types', ships, row => row.ship, row => row.count, 'seg-srv'),
    renderHorizontalBarsCardVisual('Top Fighter Types', fighters, row => row.ship, row => row.count, 'seg-fighter'),
  ].join('');
}

function renderHorizontalBarsCardVisual(title, rows, labelFn, valueFn, colorClass) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (safeRows.length === 0) {
    return `<div class="trend-composition-panel"><h3 class="stacked-title">${title}</h3><p class="empty-state">No data available.</p></div>`;
  }
  const maxValue = Math.max(...safeRows.map(r => Number(valueFn(r) || 0)), 1);
  const bars = safeRows.map(row => {
    const value = Number(valueFn(row) || 0);
    const pct = (value / maxValue) * 100;
    return `<li class="hbar-row"><span class="hbar-label">${labelFn(row)}</span><span class="hbar-track"><span class="hbar-fill ${colorClass}" style="width:${pct.toFixed(2)}%"></span></span><span class="hbar-value">${value}</span></li>`;
  }).join('');
  return `<div class="trend-composition-panel"><h3 class="stacked-title">${title}</h3><ul class="hbar-list">${bars}</ul></div>`;
}

function renderScaledBarsVisual(title, total, rows, note = '') {
  const totalSafe = Math.max(Number(total || 0), 1);
  const bars = rows.map(row => {
    const value = Number(row.value || 0);
    const pct = (value / totalSafe) * 100;
    return `<li class="hbar-row"><span class="hbar-label">${row.label}</span><span class="hbar-track"><span class="hbar-fill ${row.className}" style="width:${Math.min(pct, 100).toFixed(2)}%"></span></span><span class="hbar-value">${value} (${pct.toFixed(1)}%)</span></li>`;
  }).join('');
  return `<article class="stacked-card"><h3 class="stacked-title">${title}</h3><ul class="hbar-list">${bars}</ul>${note ? `<p class="chart-note">${note}</p>` : ''}</article>`;
}

function renderStackedBarVisual(title, segments) {
  const total = segments.reduce((sum, s) => sum + Number(s.value || 0), 0);
  const totalSafe = total > 0 ? total : 1;
  const bar = segments.map(seg => {
    const value = Number(seg.value || 0);
    const pct = (value / totalSafe) * 100;
    return `<div class="stacked-segment ${seg.className}" style="width:${pct.toFixed(2)}%" title="${seg.label}: ${value} (${pct.toFixed(1)}%)"></div>`;
  }).join('');
  const legend = segments.map(seg => {
    const value = Number(seg.value || 0);
    const pct = (value / totalSafe) * 100;
    return `<li class="stacked-legend-item"><span class="stacked-swatch ${seg.className}"></span><span class="stacked-legend-label">${seg.label}</span><span class="stacked-legend-value">${value} (${pct.toFixed(1)}%)</span></li>`;
  }).join('');
  return `<article class="stacked-card"><h3 class="stacked-title">${title}</h3><div class="stacked-track">${bar}</div><ul class="stacked-legend">${legend}</ul></article>`;
}

function renderActiveRacersChartVisual(data) {
  if (!graphContainer) return;
  if (!data || data.length === 0) {
    graphContainer.innerHTML = '<p class="empty-state">No graph data available.</p>';
    return;
  }
  const width = 960;
  const height = 420;
  const pad = { top: 20, right: 16, bottom: 56, left: 52 };
  const values = data.map(p => Number(p.active_racers || 0));
  const yMax = roundUpAxisVisual(Math.max(...values, 1));
  const xFor = i => (data.length <= 1 ? pad.left : pad.left + (i * (width - pad.left - pad.right)) / (data.length - 1));
  const yFor = value => pad.top + (1 - value / yMax) * (height - pad.top - pad.bottom);
  const pointsLine = data.map((p, i) => `${xFor(i).toFixed(2)},${yFor(Number(p.active_racers || 0)).toFixed(2)}`).join(' ');
  const areaPath = buildAreaPathVisual(data, xFor, yFor, height - pad.bottom);
  const yTicks = buildYTicksVisual(yMax, 5);
  const xTicks = buildXTicksVisual(data.length, xFor, height, pad.bottom);
  const lastIdx = data.length - 1;
  graphContainer.innerHTML = `
    <svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Active racers 7-day rolling average line chart">
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
      ${yTicks.grid}
      <path d="${areaPath}" class="trend-area"></path>
      <polyline points="${pointsLine}" class="trend-line"></polyline>
      <circle cx="${xFor(lastIdx)}" cy="${yFor(values[lastIdx] ?? 0)}" r="4" class="trend-dot"></circle>
      ${yTicks.labels}
      ${xTicks}
      <text x="${pad.left}" y="${height - 16}" class="trend-axis-text">${formatDayLabelVisual(data[0]?.day)}</text>
      <text x="${width - pad.right}" y="${height - 16}" class="trend-axis-text" text-anchor="end">${formatDayLabelVisual(data[lastIdx]?.day)}</text>
      <text x="${width - pad.right}" y="${pad.top + 14}" class="trend-axis-text" text-anchor="end">7-day rolling average</text>
    </svg>
  `;
}

function buildAreaPathVisual(data, xFor, yFor, baselineY) {
  if (data.length === 0) return '';
  let d = `M ${xFor(0).toFixed(2)} ${baselineY.toFixed(2)} L ${xFor(0).toFixed(2)} ${yFor(Number(data[0].active_racers || 0)).toFixed(2)} `;
  data.forEach((p, i) => {
    d += `L ${xFor(i).toFixed(2)} ${yFor(Number(p.active_racers || 0)).toFixed(2)} `;
  });
  d += `L ${xFor(data.length - 1).toFixed(2)} ${baselineY.toFixed(2)} Z`;
  return d;
}

function buildYTicksVisual(yMax, count, height = 420, pad = { top: 20, right: 16, bottom: 56, left: 52 }) {
  const step = yMax / count;
  const lines = [];
  const labels = [];
  for (let i = 0; i <= count; i += 1) {
    const value = step * i;
    const y = pad.top + (1 - value / yMax) * (height - pad.top - pad.bottom);
    lines.push(`<line x1="${pad.left}" y1="${y.toFixed(2)}" x2="${(960 - pad.right).toFixed(2)}" y2="${y.toFixed(2)}" class="trend-grid"></line>`);
    labels.push(`<text x="${(pad.left - 8).toFixed(2)}" y="${(y + 4).toFixed(2)}" class="trend-axis-text" text-anchor="end">${Math.round(value)}</text>`);
  }
  return { grid: lines.join(''), labels: labels.join('') };
}

function buildXTicksVisual(length, xFor, height, bottomPad) {
  if (!length) return '';
  const unique = [...new Set([0, Math.floor((length - 1) / 2), length - 1])];
  return unique.map(i => {
    const x = xFor(i);
    const y = height - bottomPad;
    return `<line x1="${x.toFixed(2)}" y1="${y}" x2="${x.toFixed(2)}" y2="${(y + 5).toFixed(2)}" class="trend-grid"></line>`;
  }).join('');
}

function roundUpAxisVisual(value) {
  if (value <= 10) return 10;
  if (value <= 25) return 25;
  if (value <= 50) return 50;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function formatDayLabelVisual(dayString) {
  if (!dayString) return '';
  const d = new Date(`${dayString}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dayString;
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

// ── Start ──────────────────────────────────────────────────────────────────
init();
