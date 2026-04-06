import { formatTime, formatImprovement, relativeTime, esc, ordinal } from './utils.js';

// ── State ──────────────────────────────────────────────────────────────────
const cmdrName   = decodeURIComponent(location.pathname.split('/cmdr/')[1] ?? '');
let   stats      = null;   // full API response
let   sortBy     = 'percentile';  // 'percentile' | 'recent'
let   filterRecent = false;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

// ── DOM refs ───────────────────────────────────────────────────────────────
const breadcrumb  = document.getElementById('cmdr-breadcrumb');
const title       = document.getElementById('cmdr-title');
const summaryEl   = document.getElementById('cmdr-summary');
const tablesEl    = document.getElementById('cmdr-tables');
const legendEl    = document.getElementById('cmdr-legend');
const sortPctBtn  = document.getElementById('sort-pct');
const sortRecBtn  = document.getElementById('sort-recent');
const filterCheck = document.getElementById('filter-recent');

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  if (!cmdrName) {
    title.textContent = 'Commander not found';
    return;
  }
  breadcrumb.textContent = `CMDR ${cmdrName}`;
  title.textContent      = `CMDR ${cmdrName}`;

  try {
    const res = await fetch(`/api/cmdr/${encodeURIComponent(cmdrName)}`);
    if (!res.ok) throw new Error(res.status);
    stats = await res.json();
  } catch {
    tablesEl.innerHTML = '<p class="empty-state">Could not load commander data.</p>';
    return;
  }

  sortPctBtn.addEventListener('click', () => setSort('percentile'));
  sortRecBtn.addEventListener('click', () => setSort('recent'));
  filterCheck.addEventListener('change', () => {
    filterRecent = filterCheck.checked;
    render();
  });

  render();
}

function setSort(s) {
  sortBy = s;
  sortPctBtn.classList.toggle('active', s === 'percentile');
  sortRecBtn.classList.toggle('active', s === 'recent');
  render();
}

// ── Render ─────────────────────────────────────────────────────────────────
function render() {
  renderSummary();
  renderTables();
}

function renderSummary() {
  const overall = stats.overall_percentile;
  const byType  = stats.by_type_percentile;

  const typeLabels = {
    SHIP:    'Ship',
    SRV:     'SRV',
    FIGHTER: 'Fighter',
    ONFOOT:  'On Foot',
  };

  const typeStatements = Object.entries(byType)
    .map(([t, pct]) => `<span class="cmdr-type-stat"><strong>${typeLabels[t] ?? t}</strong> top ${pct}%</span>`)
    .join('');

  summaryEl.innerHTML = `
    <div class="cmdr-overall-pct">
      You are in the <strong>top ${overall}%</strong> of pilots overall.
    </div>
    ${typeStatements ? `<div class="cmdr-type-stats">${typeStatements}</div>` : ''}
  `;
}

function renderTables() {
  let races = stats.races;

  if (filterRecent) {
    const cutoff = Date.now() - SEVEN_DAYS;
    races = races.filter(r => {
      if (!r.last_competed) return false;
      const norm = r.last_competed.replace(' ', 'T').replace(/(\.\d{1,6}).*$/, '$1') + 'Z';
      return new Date(norm).getTime() >= cutoff;
    });
  }

  const types = [...new Set(stats.races.map(r => r.type))].sort();
  const hasHighlight = races.some(r => {
    const typeAvg = stats.by_type_percentile[r.type];
    return typeAvg !== undefined && r.percentile > typeAvg;
  });
  legendEl.style.display = hasHighlight ? 'flex' : 'none';

  const typeLabels = {
    SHIP:    'Ship Races',
    SRV:     'SRV Races',
    FIGHTER: 'Fighter Races',
    ONFOOT:  'On Foot Races',
  };

  let html = '';
  for (const type of types) {
    let typeRaces = races.filter(r => r.type === type);
    if (typeRaces.length === 0) continue;

    const typeAvgPct = stats.by_type_percentile[type];

    if (sortBy === 'percentile') {
      typeRaces = typeRaces.slice().sort((a, b) => a.percentile - b.percentile);
    } else {
      typeRaces = typeRaces.slice().sort((a, b) => {
        const ta = a.last_competed ?? '';
        const tb = b.last_competed ?? '';
        return tb.localeCompare(ta);
      });
    }

    const rows = typeRaces.map(r => {
      const isOpportunity = typeAvgPct !== undefined && r.percentile > typeAvgPct;
      const imp = r.improvement_ms != null ? formatImprovement(r.improvement_ms) : null;
      const shipLabel = [r.ship, r.shipname].filter(Boolean).join(' — ');
      return `
        <tr class="${isOpportunity ? 'row-opportunity' : ''}">
          <td><a href="/race/${encodeURIComponent(r.key)}">${esc(r.race_name)}</a></td>
          <td class="num">${ordinal(r.position)} of ${r.total_entries}</td>
          <td class="num ${percentileClass(r.percentile)}">top ${r.percentile}%</td>
          <td class="num ${imp ? imp.cls : ''}">${imp ? imp.text : '—'}</td>
          <td class="muted">${esc(shipLabel) || '—'}</td>
          <td class="muted">${r.last_competed ? relativeTime(r.last_competed) : '—'}</td>
        </tr>`;
    }).join('');

    html += `
      <section class="cmdr-type-section">
        <h2 class="cmdr-type-heading">
          ${esc(typeLabels[type] ?? type)}
          <span class="cmdr-type-avg">avg top ${typeAvgPct}%</span>
        </h2>
        <table class="results-table">
          <thead>
            <tr>
              <th>Race</th>
              <th class="num">Position</th>
              <th class="num">Percentile</th>
              <th class="num">Improvement</th>
              <th>Ship</th>
              <th>Last competed</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }

  if (!html) {
    tablesEl.innerHTML = '<p class="empty-state">No races match the current filter.</p>';
    return;
  }

  tablesEl.innerHTML = html;
}

function percentileClass(pct) {
  if (pct <= 10) return 'pct-elite';
  if (pct <= 25) return 'pct-good';
  if (pct <= 50) return 'pct-mid';
  return 'pct-low';
}

init();
