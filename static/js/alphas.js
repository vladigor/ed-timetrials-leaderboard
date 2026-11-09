import { esc } from './utils.js';

const flags = window.FEATURE_FLAGS || {};
const commander = (localStorage.getItem('tt_filter_cmdr') || '').trim();
const allowedCommanders = (flags.alpha_time_trials_for || []).map(name => name.toLowerCase());
const enabled = flags.alpha_time_trials || (commander && allowedCommanders.includes(commander.toLowerCase()));
const tableContainer = document.getElementById('races-by-type');
const countLabel = document.getElementById('race-count');
const searchInput = document.getElementById('filter-search');
let allRaces = [];
let sortBy = 'creator';
let sortDir = 'asc';

async function loadAlphaTimeTrials() {
  if (!enabled) {
    tableContainer.innerHTML = '<p class="empty-state">Alpha time trials are not enabled for the selected commander.</p>';
    return;
  }

  try {
    const response = await fetch(`/api/alpha-time-trials?commander=${encodeURIComponent(commander)}`);
    if (!response.ok) {
      throw new Error(`Alpha time trials request failed (${response.status})`);
    }
    allRaces = await response.json();
    renderTables();
  } catch (error) {
    console.error('Failed to load Alpha time trials:', error);
    tableContainer.innerHTML = '<p class="empty-state">Unable to load Alpha time trials. Please try again later.</p>';
  }
}

function renderTables() {
  const search = searchInput.value.trim().toLowerCase();
  const races = allRaces.filter(race =>
    [race.name, race.key, race.system, race.station, race.type, race.version]
      .some(value => String(value || '').toLowerCase().includes(search))
  );
  countLabel.textContent = `Displaying ${races.length} Alpha race${races.length === 1 ? '' : 's'}`;

  if (!races.length) {
    tableContainer.innerHTML = `<p class="empty-state">${allRaces.length ? 'No Alpha races match the current filter.' : 'No Alpha time trials found.'}</p>`;
    return;
  }

  const typeOrder = ['SHIP', 'FIGHTER', 'SRV', 'ONFOOT'];
  const grouped = new Map();
  for (const race of races) {
    const type = race.type || 'UNKNOWN';
    if (!grouped.has(type)) grouped.set(type, []);
    grouped.get(type).push(race);
  }

  const types = [...grouped.keys()].sort((a, b) => {
    const aIndex = typeOrder.indexOf(a);
    const bIndex = typeOrder.indexOf(b);
    return (aIndex < 0 ? typeOrder.length : aIndex) - (bIndex < 0 ? typeOrder.length : bIndex)
      || a.localeCompare(b);
  });

  tableContainer.innerHTML = types.map(type => {
    const rows = grouped.get(type).slice().sort(compareRaces).map(renderRow).join('');
    const typeLabel = { SHIP: 'Ship Races', FIGHTER: 'Fighter Races', SRV: 'SRV Races', ONFOOT: 'On Foot Races' }[type] || type;

    return `
      <section style="margin-bottom: 2rem;">
        <h2 class="cmdr-section-heading">${esc(typeLabel)}</h2>
        <table class="results-table" style="width: 100%">
          <thead>
            <tr>
              ${sortHeader('creator', 'CMDR')}
              ${sortHeader('name', 'Race')}
              ${sortHeader('location', 'Location')}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }).join('');
}

function sortHeader(column, label) {
  const active = sortBy === column;
  const indicator = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
  return `<th class="th-sortable${active ? ' th-active' : ''}" data-sort="${column}">${label}${indicator}</th>`;
}

function compareRaces(a, b) {
  const value = race => {
    if (sortBy === 'location') return `${race.system || ''} ${race.station || ''}`;
    return race[sortBy] || '';
  };
  const comparison = value(a).localeCompare(value(b), undefined, { sensitivity: 'base' });
  return sortDir === 'asc' ? comparison : -comparison;
}

function renderRow(race) {
  const location = race.station
    ? `${esc(race.system)} • ${esc(race.station)}`
    : esc(race.system);

  return `
    <tr>
      <td>${esc(race.creator)}</td>
      <td style="max-width: 250px; overflow-wrap: break-word; word-break: break-word; white-space: normal;">${esc(race.name)}</td>
      <td style="max-width: 250px; overflow-wrap: break-word; word-break: break-word; white-space: normal;">${location}</td>
    </tr>`;
}

tableContainer.addEventListener('click', event => {
  const header = event.target.closest('.th-sortable');
  if (!header) return;

  const column = header.dataset.sort;
  if (sortBy === column) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortBy = column;
    sortDir = 'asc';
  }
  renderTables();
});

searchInput.addEventListener('input', renderTables);
loadAlphaTimeTrials();
