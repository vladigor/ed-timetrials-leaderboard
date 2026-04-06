import { formatTime, formatImprovement, formatDelta, relativeTime, esc } from './utils.js';
import { ChangePoller } from './poller.js';

// ── State ──────────────────────────────────────────────────────────────────
const raceKey        = decodeURIComponent(location.pathname.split('/race/')[1] || '');
const selectedCmdr   = localStorage.getItem('tt_filter_cmdr') || '';
let race          = null;
let poller        = null;
let isOffline     = false;
let chartInstance = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
const titleEl      = document.getElementById('race-title');
const breadcrumbEl = document.getElementById('race-breadcrumb');
const metaEl       = document.getElementById('race-meta');
const constrEl     = document.getElementById('race-constraints');
const layoutEl     = document.getElementById('results-layout');
const statusDot    = document.getElementById('status-dot');
const statusText   = document.getElementById('status-text');
const backLink     = document.getElementById('back-link');

backLink.href = '/';

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  if (!raceKey) {
    showError('No race key in URL.');
    return;
  }

  await loadRace();

  // Seed poller – only refresh if this specific race changed
  poller = new ChangePoller(60_000, async (snapshot) => {
    if (snapshot[raceKey] !== undefined) {
      setStatus('updating');
      await loadRace();
      setStatus('live');
    }
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

// ── Data loading ───────────────────────────────────────────────────────────
async function loadRace() {
  try {
    race = await fetch(`/api/races/${encodeURIComponent(raceKey)}`).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    renderRace();
  } catch (err) {
    showError('Could not load race data.');
    setStatus('error');
  }
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderRace() {
  document.title = `${race.name} — Elite TT Leaderboard`;

  // Header
  titleEl.textContent      = race.name;
  breadcrumbEl.textContent = race.name;

  const versionCls = race.version === 'ODYSSEY' ? 'badge-odyssey' : 'badge-horizons';
  metaEl.innerHTML = `
    ${race.type ? `<span class="badge ${{ SHIP: 'badge-ship', SRV: 'badge-srv', FIGHTER: 'badge-fighter', ONFOOT: 'badge-onfoot' }[race.type] ?? 'badge-onfoot'}">${esc(race.type)}</span>` : ''}
    <span>${esc(race.system)}</span>
    ${race.station ? `<span>· ${esc(race.station)}</span>` : ''}
    ${race.address ? `<span>· ${esc(race.address)}</span>` : ''}
  `;

  if (race.constraints && race.constraints.length) {
    constrEl.innerHTML = race.constraints.map(
      c => `<span class="constraint-tag">${esc(c.key)}: ${esc(String(c.value))}</span>`
    ).join('');
  } else {
    constrEl.innerHTML = '';
  }

  if (!race.results || race.results.length === 0) {
    if (chartInstance) { chartInstance.dispose(); chartInstance = null; }
    layoutEl.innerHTML = '<p class="empty-state">No results recorded yet.</p>';
    return;
  }

  const results    = race.results;
  const isOdyssey  = race.version === 'ODYSSEY';
  const chartHeight = Math.max(240, results.length * 22 + 50);

  // Build table rows
  const tableRows = results.map(entry => {
    const imp = formatImprovement(entry.improvement_ms);
    const posCls = entry.position <= 3 ? ` pos-${entry.position}` : '';
    const rowClasses = [
      entry.position <= 3 ? `row-pos-${entry.position}` : '',
      (selectedCmdr && entry.name === selectedCmdr) ? 'row-cmdr' : '',
    ].filter(Boolean).join(' ');
    return `
      <tr${rowClasses ? ` class="${rowClasses}"` : ''}>
        <td class="pos${posCls}">${entry.position}</td>
        <td class="cmdr-name">${esc(entry.name)}</td>
        <td class="time-cell">${formatTime(entry.time_ms)}</td>
        <td class="delta-cell">${formatDelta(entry.delta_ms)}</td>
        <td class="improvement-cell ${imp.cls}">${imp.text}</td>
        <td style="color:var(--text-muted);font-size:.8rem">${esc(entry.ship)}</td>
        <td style="color:var(--text-muted);font-size:.8rem">${entry.updated ? relativeTime(entry.updated) : ''}</td>
      </tr>`;
  });

  // Render containers (old chart is disposed before innerHTML wipes its element)
  if (chartInstance) { chartInstance.dispose(); chartInstance = null; }

  layoutEl.innerHTML = `
    <div id="race-chart" style="height:${chartHeight}px"></div>
    <div class="results-table-panel">
      <table class="results-table">
        <thead>
          <tr>
            <th>#</th><th>Commander</th><th>Time</th>
            <th>Gap</th><th>Improvement</th><th>Ship</th><th>Updated</th>
          </tr>
        </thead>
        <tbody>${tableRows.join('')}</tbody>
      </table>
    </div>`;

  // Initialise ECharts
  const chartEl = document.getElementById('race-chart');
  chartInstance = window.echarts.init(chartEl, null, { renderer: 'canvas' });
  chartInstance.setOption(_buildChartOption(results, isOdyssey));

  // Keep chart sized to its container on window resize
  if (window._chartRO) window._chartRO.disconnect();
  window._chartRO = new ResizeObserver(() => chartInstance && chartInstance.resize());
  window._chartRO.observe(chartEl);
}

// ── ECharts option builder ─────────────────────────────────────────────────
function _buildChartOption(results, isOdyssey) {
  const medals      = ['🥇', '🥈', '🥉'];
  const defaultClr  = isOdyssey ? '#1a6ebd' : '#7b3fa0';

  // ECharts category axis goes bottom→top, so reverse so #1 sits at the top
  const reversed = [...results].reverse();

  const yData = reversed.map(r => {
    const medal = r.position <= 3 ? medals[r.position - 1] + ' ' : `${r.position}. `;
    return medal + r.name;
  });

  const seriesData = reversed.map(r => {
    let color = defaultClr;
    if      (r.position === 1)                               color = '#ffd700';
    else if (r.position === 2)                               color = '#b8b8b8';
    else if (r.position === 3)                               color = '#cd7f32';
    else if (selectedCmdr && r.name === selectedCmdr)        color = '#e8a020';
    const dimmed = selectedCmdr && r.name !== selectedCmdr && r.position > 3;
    return { value: r.time_ms, itemStyle: { color, opacity: dimmed ? 0.55 : 1 } };
  });

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#1f2535',
      borderColor: '#2a3048',
      textStyle: { color: '#d4dbe8', fontSize: 13 },
      formatter(params) {
        const r = reversed[params[0].dataIndex];
        const imp = formatImprovement(r.improvement_ms);
        const medal = r.position <= 3 ? medals[r.position - 1] + ' ' : '';
        const impColor = imp.cls === 'improvement-better' ? '#3fb97a' : '#d94f4f';
        return `<div style="font-family:monospace;line-height:1.7">
          <div style="font-weight:700;font-size:14px;margin-bottom:2px">${medal}${esc(r.name)}</div>
          <div>Position: <b>#${r.position}</b></div>
          <div>Time: <b>${formatTime(r.time_ms)}</b></div>
          ${r.delta_ms ? `<div style="color:#6b7799">Gap to above: ${formatDelta(r.delta_ms)}</div>` : ''}
          ${r.improvement_ms != null ? `<div>Improvement: <span style="color:${impColor}">${imp.text}</span></div>` : ''}
          <div style="color:#6b7799">Ship: ${esc(r.ship)}</div>
        </div>`;
      },
    },
    grid: { left: '230px', right: '50px', top: '12px', bottom: '62px' },
    xAxis: {
      type: 'value',
      min: v => Math.max(0, v.min - (v.max - v.min) * 0.08),
      axisLabel: {
        formatter: val => formatTime(val),
        rotate: 30,
        color: '#6b7799',
        fontSize: 11,
      },
      splitLine: { lineStyle: { color: '#2a3048' } },
      axisLine:  { lineStyle: { color: '#2a3048' } },
    },
    yAxis: {
      type: 'category',
      data: yData,
      axisLabel: {
        color: '#d4dbe8',
        fontSize: 12,
        interval: 0,
        overflow: 'truncate',
        width: 200,
      },
      axisLine: { lineStyle: { color: '#2a3048' } },
      axisTick: { lineStyle: { color: '#2a3048' } },
    },
    series: [{ type: 'bar', data: seriesData, barMaxWidth: 14 }],
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────
function showError(msg) {
  titleEl.textContent = 'Error';
  if (breadcrumbEl) breadcrumbEl.textContent = 'Error';
  layoutEl.innerHTML = `<p class="empty-state">${esc(msg)}</p>`;
}

function setStatus(state) {
  statusDot.className = 'dot';
  if (state === 'live')    { statusDot.classList.add('live');    statusText.textContent = 'Live (up to 1min delay)'; }
  if (state === 'offline') { statusDot.classList.add('offline'); statusText.textContent = 'Offline — local data'; }
  if (state === 'updating'){ statusText.textContent = 'Updating…'; }
  if (state === 'error')   { statusDot.classList.add('error');   statusText.textContent = 'Connection error'; }
}

// Refresh on tab focus (skipped in offline mode)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !isOffline) {
    loadRace(); // immediate refresh on return
  }
});

init();
