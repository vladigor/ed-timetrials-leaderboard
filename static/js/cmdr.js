import { formatTime, formatImprovement, relativeTime, esc, ordinal } from './utils.js';

// ── State ──────────────────────────────────────────────────────────────────
const cmdrName   = decodeURIComponent(location.pathname.split('/cmdr/')[1] ?? '');
let   stats      = null;   // full API response
let   sortBy     = 'percentile';  // 'percentile' | 'recent'
let   filterRecent = false;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

// ── DOM refs ───────────────────────────────────────────────────────────────
const breadcrumb    = document.getElementById('cmdr-breadcrumb');
const title         = document.getElementById('cmdr-title');
const summaryEl     = document.getElementById('cmdr-summary');
const tablesEl      = document.getElementById('cmdr-tables');
const legendEl      = document.getElementById('cmdr-legend');
const trophyEl      = document.getElementById('trophy-case');
const sortPctBtn    = document.getElementById('sort-pct');
const sortRecBtn    = document.getElementById('sort-recent');
const filterCheck   = document.getElementById('filter-recent');
const nendyInput    = document.getElementById('nendy-system');
const nendyFindBtn  = document.getElementById('nendy-find');
const nendyResults  = document.getElementById('nendy-results');

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

  // NENDY: restore last-used system from localStorage
  const savedSystem = localStorage.getItem('tt_nendy_system');
  if (savedSystem) nendyInput.value = savedSystem;
  nendyFindBtn.addEventListener('click', nendyFind);
  nendyInput.addEventListener('keydown', e => { if (e.key === 'Enter') nendyFind(); });

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
  renderTrophyCase();
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
    FIGHTER: 'SLF (Fighter) Races',
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
          <td class="num ${percentileClass(r.percentile)}">${r.position === 1 ? '#1 — top' : `top ${r.percentile}%`}</td>
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

function renderTrophyCase() {
  const gold   = stats.races.filter(r => r.position === 1).length;
  const silver = stats.races.filter(r => r.position === 2).length;
  const bronze = stats.races.filter(r => r.position === 3).length;

  if (gold + silver + bronze === 0) {
    trophyEl.style.display = 'none';
    return;
  }

  const items = [
    { count: gold,   cls: 'trophy-gold',   label: '1st place', emoji: '\uD83C\uDFC6' },
    { count: silver, cls: 'trophy-silver', label: '2nd place', emoji: '\uD83E\uDD48' },
    { count: bronze, cls: 'trophy-bronze', label: '3rd place', emoji: '\uD83E\uDD49' },
  ]
  .filter(t => t.count > 0)
  .map(t => `
    <div class="trophy-item ${t.cls}">
      <span class="trophy-icon" aria-hidden="true">${t.emoji}</span>
      <span class="trophy-count">${t.count}</span>
      <span class="trophy-label">${t.label}</span>
    </div>`)
  .join('');

  trophyEl.style.display = '';
  trophyEl.innerHTML = `
    <h2 class="cmdr-type-heading">Trophy Case</h2>
    <div class="trophy-row">${items}</div>
  `;
}

// ── NENDY ──────────────────────────────────────────────────────────────────
let allRacesCache = null;

async function fetchAllRaces() {
  if (allRacesCache) return allRacesCache;
  const res = await fetch('/api/races');
  if (!res.ok) throw new Error('Failed to fetch race list');
  allRacesCache = await res.json();
  return allRacesCache;
}

function typeBadge(type) {
  if (!type) return '';
  const cls = { SHIP: 'badge-ship', SRV: 'badge-srv', FIGHTER: 'badge-fighter', ONFOOT: 'badge-onfoot' }[type] ?? 'badge-onfoot';
  return `<span class="badge ${cls}">${esc(type)}</span>`;
}

// ── Autocomplete ────────────────────────────────────────────────────────────
const nendySuggEl = document.getElementById('nendy-suggestions');
let acDebounce = null;
let acActive   = -1;

nendyInput.addEventListener('input', () => {
  clearTimeout(acDebounce);
  const q = nendyInput.value.trim();
  if (q.length < 3) { hideSuggestions(); return; }
  acDebounce = setTimeout(() => fetchSuggestions(q), 300);
});

nendyInput.addEventListener('keydown', e => {
  if (e.key === 'Enter')  { hideSuggestions(); nendyFind(); return; }
  if (e.key === 'Escape') { hideSuggestions(); return; }
  const items = [...nendySuggEl.querySelectorAll('li')];
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    acActive = Math.min(acActive + 1, items.length - 1);
    applySuggestionHighlight(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    acActive = Math.max(acActive - 1, -1);
    applySuggestionHighlight(items);
  }
});

nendyInput.addEventListener('blur', () => setTimeout(hideSuggestions, 150));

async function fetchSuggestions(q) {
  try {
    const res = await fetch(`/api/system-suggest?q=${encodeURIComponent(q)}`);
    if (!res.ok) return;
    const names = await res.json();
    showSuggestions(Array.isArray(names) ? names.slice(0, 8) : []);
  } catch { /* ignore */ }
}

function showSuggestions(names) {
  if (!names.length) { hideSuggestions(); return; }
  acActive = -1;
  nendySuggEl.innerHTML = names.map(n => `<li>${esc(n)}</li>`).join('');
  nendySuggEl.querySelectorAll('li').forEach((li, i) => {
    li.addEventListener('mousedown', e => {
      e.preventDefault(); // prevent blur stealing click
      nendyInput.value = names[i];
      hideSuggestions();
      nendyFind();
    });
  });
  nendySuggEl.hidden = false;
}

function hideSuggestions() {
  nendySuggEl.hidden = true;
  acActive = -1;
}

function applySuggestionHighlight(items) {
  items.forEach((li, i) => li.classList.toggle('active', i === acActive));
  if (acActive >= 0) nendyInput.value = items[acActive].textContent;
}

// ── Find nearest ────────────────────────────────────────────────────────────
async function nendyFind() {
  const systemName = nendyInput.value.trim();
  if (!systemName) return;

  localStorage.setItem('tt_nendy_system', systemName);
  nendyResults.innerHTML = '<p class="empty-state nendy-loading">Looking up system…</p>';
  nendyFindBtn.disabled = true;

  try {
    // 1. Resolve current system coords via EDSM proxy
    const coordsRes = await fetch(`/api/system-coords?name=${encodeURIComponent(systemName)}`);
    if (coordsRes.status === 404) {
      nendyResults.innerHTML = `<p class="empty-state">System "<strong>${esc(systemName)}</strong>" not found. Check the spelling.</p>`;
      return;
    }
    if (!coordsRes.ok) throw new Error('EDSM lookup failed');
    const { name: resolvedName, x, y, z } = await coordsRes.json();

    // 2. Fetch all races
    const races = await fetchAllRaces();

    // 3. Build set of done race keys
    const doneKeys = new Set((stats?.races ?? []).map(r => r.key));

    // 4. Find undone races, compute distance (races without valid coords sort to end)
    const undone = races
      .filter(r => !doneKeys.has(r.key))
      .map(r => {
        if (r.coords) {
          const parts = r.coords.split(',').map(v => Number(v.trim()));
          if (parts.length === 3 && !parts.some(isNaN)) {
            const [rx, ry, rz] = parts;
            return { ...r, dist: Math.sqrt((rx - x) ** 2 + (ry - y) ** 2 + (rz - z) ** 2) };
          }
        }
        return { ...r, dist: Infinity };
      })
      .sort((a, b) => a.dist - b.dist);

    if (undone.length === 0) {
      nendyResults.innerHTML = `<p class="empty-state">You've done every race — nothing left to find!</p>`;
      return;
    }

    const top = undone.slice(0, 15);
    const remaining = undone.length - top.length;

    const rows = top.map((r, i) => {
      const distStr = r.dist === Infinity
        ? '<span class="muted">—</span>'
        : (r.dist < 1 ? '&lt;1 ly' : `${Math.round(r.dist).toLocaleString()} ly`);
      return `
        <tr>
          <td class="num muted">${i + 1}</td>
          <td><a href="/race/${encodeURIComponent(r.key)}">${esc(r.name)}</a></td>
          <td>${typeBadge(r.type)}</td>
          <td class="muted">${esc(r.system)}</td>
          <td class="num">${distStr}</td>
        </tr>`;
    }).join('');

    const moreNote = remaining > 0
      ? `<p class="nendy-more">… and ${remaining} more undone race${remaining !== 1 ? 's' : ''} further away.</p>`
      : '';

    nendyResults.innerHTML = `
      <p class="nendy-origin">From <strong>${esc(resolvedName)}</strong> — ${undone.length} undone race${undone.length !== 1 ? 's' : ''}</p>
      <table class="results-table">
        <thead>
          <tr>
            <th class="num">#</th>
            <th>Race</th>
            <th>Type</th>
            <th>System</th>
            <th class="num">Distance</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${moreNote}`;
  } catch (err) {
    nendyResults.innerHTML = `<p class="empty-state">Error: ${esc(String(err))}</p>`;
  } finally {
    nendyFindBtn.disabled = false;
  }
}

init();
