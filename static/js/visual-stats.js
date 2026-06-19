import { ChangePoller } from './poller.js';

let points = [];
let stats = null;
let extras = null;
let poller = null;
let isOffline = false;

const rangeSelect = document.getElementById('graph-range-days');
const graphContainer = document.getElementById('graph-container');
const compositionContainer = document.getElementById('composition-container');
const racerCompositionContainer = document.getElementById('racer-composition-container');
const participationContainer = document.getElementById('participation-container');
const freshnessContainer = document.getElementById('freshness-container');
const rivalryContainer = document.getElementById('rivalry-container');
const heatmapContainer = document.getElementById('heatmap-container');
const leadersContainer = document.getElementById('leaders-container');
const medalsContainer = document.getElementById('medals-container');
const vehiclesContainer = document.getElementById('vehicles-container');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

async function init() {
  rangeSelect.addEventListener('change', async () => {
    await loadAndRender();
  });

  await loadAndRender();

  poller = new ChangePoller(60_000, async () => {
    setStatus('updating');
    await loadAndRender();
    setStatus(isOffline ? 'offline' : 'live');
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
}

async function loadAndRender() {
  const days = Number(rangeSelect.value || 180);
  setStatus('updating');

  try {
    const [trendRes, statsRes, extrasRes] = await Promise.all([
      fetch(`/api/active-racers-graph?days=${days}`),
      fetch('/api/stats?limit=20'),
      fetch(`/api/visual-stats-extras?days=${days}&months=12`),
    ]);
    if (!trendRes.ok) throw new Error(String(trendRes.status));
    if (!statsRes.ok) throw new Error(String(statsRes.status));
    if (!extrasRes.ok) throw new Error(String(extrasRes.status));

    points = await trendRes.json();
    stats = await statsRes.json();
    extras = await extrasRes.json();

    renderActiveRacersChart(points);
    renderComposition(stats, extras?.race_participant_groups || []);
    renderRacerComposition(stats);
    renderParticipationDepth(extras?.participation_depth || []);
    renderRaceFreshness(extras?.race_freshness_distribution || []);
    renderRivalryIntensity(extras?.rivalry_intensity || []);
    renderSubmissionHeatmap(extras?.submission_heatmap || []);
    renderTopCreatorsSystems(stats);
    renderMedalsChart(stats);
    renderVehiclePopularity(stats);
    setStatus(isOffline ? 'offline' : 'live');
  } catch (_) {
    graphContainer.innerHTML = '<p class="empty-state">Could not load active racers graph.</p>';
    compositionContainer.innerHTML = '<p class="empty-state">Could not load race composition.</p>';
    racerCompositionContainer.innerHTML = '<p class="empty-state">Could not load racer composition.</p>';
    participationContainer.innerHTML = '<p class="empty-state">Could not load participation depth.</p>';
    freshnessContainer.innerHTML = '<p class="empty-state">Could not load race freshness.</p>';
    rivalryContainer.innerHTML = '<p class="empty-state">Could not load rivalry intensity.</p>';
    heatmapContainer.innerHTML = '<p class="empty-state">Could not load activity heatmap.</p>';
    leadersContainer.innerHTML = '<p class="empty-state">Could not load top creators/systems.</p>';
    medalsContainer.innerHTML = '<p class="empty-state">Could not load medals chart.</p>';
    vehiclesContainer.innerHTML = '<p class="empty-state">Could not load vehicle popularity.</p>';
    setStatus('error');
  }
}

function renderComposition(data, participantGroups) {
  if (!data) {
    compositionContainer.innerHTML = '<p class="empty-state">No composition data available.</p>';
    return;
  }

  const totalRaces = Number(data.total_races || 0);
  const activeRaces = Number(data.active_races_30d || 0);
  const inactiveRaces = Math.max(totalRaces - activeRaces, 0);

  const dw3 = Number(data.dw3_races || 0);
  const nonDw3 = Number(data.non_dw3_races || 0);

  const srv = Number(data.srv_races || 0);
  const ship = Number(data.ship_races || 0);
  const fighter = Number(data.fighter_races || 0);
  const onfoot = Number(data.onfoot_races || 0);

  const groupLookup = {};
  (Array.isArray(participantGroups) ? participantGroups : []).forEach(row => {
    groupLookup[String(row.bucket)] = Number(row.count || 0);
  });

  compositionContainer.innerHTML = [
    '<div class="stacked-bars">',
    renderStackedBar('DW3 vs Non-DW3', [
      { label: 'DW3', value: dw3, className: 'seg-dw3' },
      { label: 'Non-DW3', value: nonDw3, className: 'seg-nondw3' },
    ]),
    renderStackedBar('Race Types', [
      { label: 'SRV', value: srv, className: 'seg-srv' },
      { label: 'Ship', value: ship, className: 'seg-ship' },
      { label: 'Fighter', value: fighter, className: 'seg-fighter' },
      { label: 'On Foot', value: onfoot, className: 'seg-onfoot' },
    ]),
    renderStackedBar('Active vs Inactive (30d)', [
      { label: 'Active (30d)', value: activeRaces, className: 'seg-active' },
      { label: 'Inactive', value: inactiveRaces, className: 'seg-inactive' },
    ]),
    renderStackedBar('Participants per Race', [
      { label: '0', value: groupLookup['0'] || 0, className: 'seg-part-0' },
      { label: '1', value: groupLookup['1'] || 0, className: 'seg-part-1' },
      { label: '2-4', value: groupLookup['2-4'] || 0, className: 'seg-part-2-4' },
      { label: '5-9', value: groupLookup['5-9'] || 0, className: 'seg-part-5-9' },
      { label: '10+', value: groupLookup['10+'] || 0, className: 'seg-part-10p' },
    ]),
    '</div>',
  ].join('');
}

function renderRacerComposition(data) {
  if (!data) {
    racerCompositionContainer.innerHTML = '<p class="empty-state">No racer composition data available.</p>';
    return;
  }

  const totalRacers = Number(data.total_racers || 0);
  const activeRacers = Number(data.active_racers_30d || 0);
  const inactiveRacers = Math.max(totalRacers - activeRacers, 0);
  const dw3Racers = Number(data.dw3_racers || 0);
  const nonDw3Racers = Number(data.non_dw3_racers || 0);

  racerCompositionContainer.innerHTML = [
    '<div class="stacked-bars">',
    renderStackedBar('Active vs Inactive Racers (30d)', [
      { label: 'Active (30d)', value: activeRacers, className: 'seg-active' },
      { label: 'Inactive (30d)', value: inactiveRacers, className: 'seg-inactive' },
    ]),
    renderScaledBars('DW3 Participation (of total racers)', totalRacers, [
      { label: 'DW3 Racers', value: dw3Racers, className: 'seg-dw3' },
      { label: 'Non-DW3 Racers', value: nonDw3Racers, className: 'seg-nondw3' },
    ], 'Commanders can be counted in both groups.'),
    '</div>',
  ].join('');
}

function renderScaledBars(title, total, rows, note = '') {
  const totalSafe = Math.max(Number(total || 0), 1);
  const bars = rows
    .map(row => {
      const value = Number(row.value || 0);
      const pct = (value / totalSafe) * 100;
      return [
        '<li class="hbar-row">',
        `<span class="hbar-label">${row.label}</span>`,
        '<span class="hbar-track">',
        `<span class="hbar-fill ${row.className}" style="width:${Math.min(pct, 100).toFixed(2)}%"></span>`,
        '</span>',
        `<span class="hbar-value">${value} (${pct.toFixed(1)}%)</span>`,
        '</li>',
      ].join('');
    })
    .join('');

  return [
    '<article class="stacked-card">',
    `<h3 class="stacked-title">${title}</h3>`,
    `<ul class="hbar-list">${bars}</ul>`,
    note ? `<p class="chart-note">${note}</p>` : '',
    '</article>',
  ].join('');
}

function renderStackedBar(title, segments) {
  const total = segments.reduce((sum, s) => sum + Number(s.value || 0), 0);
  const totalSafe = total > 0 ? total : 1;

  const bar = segments
    .map(seg => {
      const value = Number(seg.value || 0);
      const pct = (value / totalSafe) * 100;
      return `<div class="stacked-segment ${seg.className}" style="width:${pct.toFixed(2)}%" title="${seg.label}: ${value} (${pct.toFixed(1)}%)"></div>`;
    })
    .join('');

  const legend = segments
    .map(seg => {
      const value = Number(seg.value || 0);
      const pct = (value / totalSafe) * 100;
      return [
        `<li class="stacked-legend-item">`,
        `<span class="stacked-swatch ${seg.className}"></span>`,
        `<span class="stacked-legend-label">${seg.label}</span>`,
        `<span class="stacked-legend-value">${value} (${pct.toFixed(1)}%)</span>`,
        '</li>',
      ].join('');
    })
    .join('');

  return [
    '<article class="stacked-card">',
    `<h3 class="stacked-title">${title}</h3>`,
    `<div class="stacked-track">${bar}</div>`,
    '<ul class="stacked-legend">',
    legend,
    '</ul>',
    '</article>',
  ].join('');
}

function renderTopCreatorsSystems(data) {
  const creators = (data?.top_creators || []).slice(0, 10);
  const systems = (data?.top_systems || [])
    .filter(row => Number(row.count || 0) > 1)
    .slice(0, 10);

  leadersContainer.innerHTML = [
    renderHorizontalBarsCard('Top Creators', creators, row => row.name, row => row.count, 'seg-dw3'),
    renderHorizontalBarsCard('Top Systems', systems, row => row.system, row => row.count, 'seg-ship'),
  ].join('');
}

function renderMedalsChart(data) {
  const rows = (data?.top_podium_finishes || []).slice(0, 15);
  if (!rows.length) {
    medalsContainer.innerHTML = '<p class="empty-state">No medals data available.</p>';
    return;
  }

  const maxTotal = Math.max(...rows.map(r => Number(r.count || 0)), 1);
  const bars = rows
    .map(row => {
      const name = row.name;
      const gold = Number(row.gold || 0);
      const silver = Number(row.silver || 0);
      const bronze = Number(row.bronze || 0);
      const total = Number(row.count || (gold + silver + bronze));
      const scale = (total / maxTotal) * 100;
      const totalSafe = Math.max(total, 1);

      const goldPct = (gold / totalSafe) * 100;
      const silverPct = (silver / totalSafe) * 100;
      const bronzePct = (bronze / totalSafe) * 100;

      return [
        '<li class="hbar-row medals-row">',
        `<span class="hbar-label" title="${name}">${name}</span>`,
        '<span class="hbar-track medals-track">',
        `<span class="hbar-fill seg-gold" style="width:${(scale * goldPct / 100).toFixed(2)}%" title="Gold: ${gold}"></span>`,
        `<span class="hbar-fill seg-silver" style="width:${(scale * silverPct / 100).toFixed(2)}%" title="Silver: ${silver}"></span>`,
        `<span class="hbar-fill seg-bronze" style="width:${(scale * bronzePct / 100).toFixed(2)}%" title="Bronze: ${bronze}"></span>`,
        '</span>',
        `<span class="hbar-value">${total}</span>`,
        '</li>',
      ].join('');
    })
    .join('');

  medalsContainer.innerHTML = [
    '<ul class="hbar-list">',
    bars,
    '</ul>',
    '<div class="chart-legend medals-legend">',
    '<span class="chart-legend-item"><span class="stacked-swatch seg-gold"></span>Gold</span>',
    '<span class="chart-legend-item"><span class="stacked-swatch seg-silver"></span>Silver</span>',
    '<span class="chart-legend-item"><span class="stacked-swatch seg-bronze"></span>Bronze</span>',
    '</div>',
    '<p class="chart-note">Bar length scales by total podiums. Segment colors show medal mix.</p>',
  ].join('');
}

function renderVehiclePopularity(data) {
  const ships = (data?.top_ship_types || []).slice(0, 10);
  const fighters = (data?.top_fighter_types || []).slice(0, 10);

  vehiclesContainer.innerHTML = [
    renderHorizontalBarsCard('Top Ship Types', ships, row => row.ship, row => row.count, 'seg-srv'),
    renderHorizontalBarsCard('Top Fighter Types', fighters, row => row.ship, row => row.count, 'seg-fighter'),
  ].join('');
}

function renderParticipationDepth(rows) {
  if (!rows || rows.length === 0) {
    participationContainer.innerHTML = '<p class="empty-state">No participation depth data available.</p>';
    return;
  }

  participationContainer.innerHTML = renderHorizontalBarsCard(
    'How many races each commander has entered',
    rows,
    row => `${row.bucket} race${String(row.bucket) === '1' ? '' : 's'}`,
    row => row.count,
    'seg-onfoot',
  );
}

function renderRaceFreshness(rows) {
  if (!rows || rows.length === 0) {
    freshnessContainer.innerHTML = '<p class="empty-state">No race freshness data available.</p>';
    return;
  }
  freshnessContainer.innerHTML = renderHorizontalBarsCard(
    'Races by days since last activity',
    rows,
    row => row.bucket,
    row => row.count,
    'seg-nondw3',
  );
}

function renderRivalryIntensity(rows) {
  if (!rows || rows.length === 0) {
    rivalryContainer.innerHTML = '<p class="empty-state">No rivalry intensity data available.</p>';
    return;
  }

  rivalryContainer.innerHTML = renderHorizontalBarsCard(
    'Most intense rivalries (last 30 days)',
    rows,
    row => row.race_name,
    row => row.intensity,
    'seg-fighter',
  );
}

function renderSubmissionHeatmap(rows) {
  if (!rows || rows.length === 0) {
    heatmapContainer.innerHTML = '<p class="empty-state">No heatmap data available.</p>';
    return;
  }

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const orderedRows = [...rows].sort((a, b) => {
    const aDow = Number(a?.dow ?? 0);
    const bDow = Number(b?.dow ?? 0);
    const aOrder = aDow === 0 ? 7 : aDow;
    const bOrder = bDow === 0 ? 7 : bDow;
    return aOrder - bOrder;
  });
  const max = Math.max(...rows.flatMap(r => r.hours || []), 1);

  const hourHeader = ['<div class="heatmap-row heatmap-header"><div class="heatmap-day-label"></div>']
    .concat(Array.from({ length: 24 }, (_, h) => `<div class="heatmap-hour">${h}</div>`))
    .concat(['</div>'])
    .join('');

  const body = orderedRows
    .map(r => {
      const cells = (r.hours || [])
        .map(v => {
          const intensity = max > 0 ? v / max : 0;
          const alpha = 0.1 + intensity * 0.9;
          return `<div class="heatmap-cell" style="background: rgba(232,160,32,${alpha.toFixed(3)})" title="${v} activity"></div>`;
        })
        .join('');
      return `<div class="heatmap-row"><div class="heatmap-day-label">${dayLabels[r.dow] || r.dow}</div>${cells}</div>`;
    })
    .join('');

  heatmapContainer.innerHTML = `<div class="heatmap-wrap">${hourHeader}${body}</div>`;
}

function renderHorizontalBarsCard(title, rows, labelFn, valueFn, colorClass) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (safeRows.length === 0) {
    return [
      '<div class="trend-composition-panel">',
      `<h3 class="stacked-title">${title}</h3>`,
      '<p class="empty-state">No data available.</p>',
      '</div>',
    ].join('');
  }

  const maxValue = Math.max(...safeRows.map(r => Number(valueFn(r) || 0)), 1);
  const bars = safeRows
    .map(row => {
      const value = Number(valueFn(row) || 0);
      const pct = (value / maxValue) * 100;
      return [
        '<li class="hbar-row">',
        `<span class="hbar-label">${labelFn(row)}</span>`,
        '<span class="hbar-track">',
        `<span class="hbar-fill ${colorClass}" style="width:${pct.toFixed(2)}%"></span>`,
        '</span>',
        `<span class="hbar-value">${value}</span>`,
        '</li>',
      ].join('');
    })
    .join('');

  return [
    '<div class="trend-composition-panel">',
    `<h3 class="stacked-title">${title}</h3>`,
    `<ul class="hbar-list">${bars}</ul>`,
    '</div>',
  ].join('');
}

function statCard(label, value) {
  return [
    '<article class="stat-card">',
    `<div class="stat-card-label">${label}</div>`,
    `<div class="stat-card-value">${value}</div>`,
    '</article>',
  ].join('');
}

function renderActiveRacersChart(data) {
  if (!data || data.length === 0) {
    graphContainer.innerHTML = '<p class="empty-state">No graph data available.</p>';
    return;
  }

  const width = 960;
  const height = 420;
  const pad = { top: 20, right: 16, bottom: 56, left: 52 };

  const values = data.map(p => Number(p.active_racers || 0));
  const rawMax = Math.max(...values, 1);
  const yMax = roundUpAxis(rawMax);

  const xFor = i => {
    if (data.length <= 1) return pad.left;
    return pad.left + (i * (width - pad.left - pad.right)) / (data.length - 1);
  };

  const yFor = value => {
    const chartH = height - pad.top - pad.bottom;
    return pad.top + (1 - value / yMax) * chartH;
  };

  const pointsLine = data
    .map((p, i) => `${xFor(i).toFixed(2)},${yFor(Number(p.active_racers || 0)).toFixed(2)}`)
    .join(' ');

  const areaPath = buildAreaPath(data, xFor, yFor, height - pad.bottom);
  const yTicks = buildYTicks(yMax, 5);
  const xTicks = buildXTicks(data.length, xFor, height, pad.bottom);

  const lastIdx = data.length - 1;
  const lastX = xFor(lastIdx);
  const lastY = yFor(values[lastIdx] ?? 0);

  graphContainer.innerHTML = `
    <svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Active racers 7-day rolling average line chart">
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
      ${yTicks.grid}
      <path d="${areaPath}" class="trend-area"></path>
      <polyline points="${pointsLine}" class="trend-line"></polyline>
      <circle cx="${lastX}" cy="${lastY}" r="4" class="trend-dot"></circle>
      ${yTicks.labels}
      ${xTicks}
      <text x="${pad.left}" y="${height - 16}" class="trend-axis-text">${formatDayLabel(data[0]?.day)}</text>
      <text x="${width - pad.right}" y="${height - 16}" class="trend-axis-text" text-anchor="end">${formatDayLabel(data[lastIdx]?.day)}</text>
      <text x="${width - pad.right}" y="${pad.top + 14}" class="trend-axis-text" text-anchor="end">7-day rolling average</text>
    </svg>
  `;
}

function renderMultiLineChart(container, config) {
  const data = config.data || [];
  const series = config.series || [];
  if (data.length === 0 || series.length === 0) {
    container.innerHTML = '<p class="empty-state">No chart data available.</p>';
    return;
  }

  const width = 960;
  const height = 340;
  const pad = { top: 20, right: 16, bottom: 56, left: 52 };

  const allValues = [];
  data.forEach(row => {
    series.forEach(s => allValues.push(Number(row[s.key] || 0)));
  });
  const yMax = roundUpAxis(Math.max(...allValues, 1));

  const xFor = i => {
    if (data.length <= 1) return pad.left;
    return pad.left + (i * (width - pad.left - pad.right)) / (data.length - 1);
  };

  const yFor = value => {
    const chartH = height - pad.top - pad.bottom;
    return pad.top + (1 - value / yMax) * chartH;
  };

  const yTicks = buildYTicks(yMax, 5, height, pad);
  const xTicks = buildXTicks(data.length, xFor, height, pad.bottom);

  const lines = series
    .map(s => {
      const pointsLine = data
        .map((row, i) => `${xFor(i).toFixed(2)},${yFor(Number(row[s.key] || 0)).toFixed(2)}`)
        .join(' ');
      return `<polyline points="${pointsLine}" class="${s.className}"></polyline>`;
    })
    .join('');

  const legend = series
    .map(s => `<span class="chart-legend-item"><span class="chart-legend-swatch ${s.className}"></span>${s.label}</span>`)
    .join('');

  container.innerHTML = `
    <svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${config.ariaLabel}">
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
      ${yTicks.grid}
      ${lines}
      ${yTicks.labels}
      ${xTicks}
      <text x="${pad.left}" y="${height - 16}" class="trend-axis-text">${config.xStartLabel || ''}</text>
      <text x="${width - pad.right}" y="${height - 16}" class="trend-axis-text" text-anchor="end">${config.xEndLabel || ''}</text>
    </svg>
    <div class="chart-legend">${legend}</div>
  `;
}

function buildAreaPath(data, xFor, yFor, baselineY) {
  if (data.length === 0) return '';

  const firstY = yFor(Number(data[0].active_racers || 0));
  let d = `M ${xFor(0).toFixed(2)} ${baselineY.toFixed(2)} `;
  d += `L ${xFor(0).toFixed(2)} ${firstY.toFixed(2)} `;

  data.forEach((p, i) => {
    d += `L ${xFor(i).toFixed(2)} ${yFor(Number(p.active_racers || 0)).toFixed(2)} `;
  });

  d += `L ${xFor(data.length - 1).toFixed(2)} ${baselineY.toFixed(2)} Z`;
  return d;
}

function buildYTicks(yMax, count, height = 420, pad = { top: 20, right: 16, bottom: 56, left: 52 }) {
  const step = yMax / count;
  const lines = [];
  const labels = [];

  for (let i = 0; i <= count; i += 1) {
    const value = step * i;
    const y = pad.top + (1 - value / yMax) * (height - pad.top - pad.bottom);
    lines.push(`<line x1="${pad.left}" y1="${y.toFixed(2)}" x2="${(960 - pad.right).toFixed(2)}" y2="${y.toFixed(2)}" class="trend-grid"></line>`);
    labels.push(`<text x="${(pad.left - 8).toFixed(2)}" y="${(y + 4).toFixed(2)}" class="trend-axis-text" text-anchor="end">${Math.round(value)}</text>`);
  }

  return {
    grid: lines.join(''),
    labels: labels.join(''),
  };
}

function buildXTicks(length, xFor, height, bottomPad) {
  if (!length) return '';

  const indices = [0, Math.floor((length - 1) / 2), length - 1];
  const unique = [...new Set(indices)];

  return unique
    .map(i => {
      const x = xFor(i);
      const y = height - bottomPad;
      return `<line x1="${x.toFixed(2)}" y1="${y}" x2="${x.toFixed(2)}" y2="${(y + 5).toFixed(2)}" class="trend-grid"></line>`;
    })
    .join('');
}

function roundUpAxis(value) {
  if (value <= 10) return 10;
  if (value <= 25) return 25;
  if (value <= 50) return 50;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function formatDayLabel(dayString) {
  if (!dayString) return '';
  const d = new Date(`${dayString}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dayString;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

function formatMonthLabel(monthString) {
  if (!monthString) return '';
  const d = new Date(`${monthString}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return monthString;
  return new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

function setStatus(state) {
  statusDot.className = 'dot';
  if (state === 'live') {
    statusDot.classList.add('live');
    statusText.textContent = 'Live (up to 1min delay)';
  }
  if (state === 'offline') {
    statusDot.classList.add('offline');
    statusText.textContent = 'Offline - local data';
  }
  if (state === 'updating') {
    statusText.textContent = 'Updating...';
  }
  if (state === 'error') {
    statusDot.classList.add('error');
    statusText.textContent = 'Connection error';
  }
}

init();
