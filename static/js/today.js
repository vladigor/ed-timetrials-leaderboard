import { esc, computeDaynightInfo } from './utils.js';
import { getSelectedCommander } from './profile.js';
import { selectSuggestions, filterSuggestionResults, renderOpportunityRows, opportunityLegend, opportunityTableHead } from './opportunities.js';
import { getFavState } from './favourites.js';

const form = document.getElementById('today-form');
const fields = Object.fromEntries(
  ['vehicle', 'srv', 'ship', 'history', 'daylight', 'duration', 'distance', 'system']
    .map(name => [name, document.getElementById(`today-${name}`)])
);
const status = document.getElementById('today-status');
const results = document.getElementById('neidy-results');
const suggestions = document.getElementById('today-suggestions');
const systemStatus = document.getElementById('today-system-status');
let origin = null;
let debounce = null;
let suggestionRequest = null;
let activeSuggestion = -1;
let busy = false;
let matchedRaces = null;
let matchedOrigin = null;
const filterSearch = document.getElementById('filter-search');
const sortSelect = document.getElementById('sort-select');
const resultFilters = [
  ['filter-hide-dw3', 'tt_filter_hide_dw3'],
  ['filter-hide-horizons', 'tt_filter_hide_horizons'],
  ['filter-hide-ignored', 'tt_filter_hide_ignored'],
  ['filter-powerplay-only', 'tt_filter_powerplay_only'],
];

function featureEnabled(feature) {
  const flags = window.FEATURE_FLAGS || {};
  return !!flags[feature] || (flags[`${feature}_for`] || []).includes(getSelectedCommander().trim().toLowerCase());
}

for (const [id, key] of resultFilters) {
  const input = document.getElementById(id);
  if (!input) continue;
  input.checked = id === 'filter-hide-horizons' ? localStorage.getItem(key) !== '0' : localStorage.getItem(key) === '1';
  input.addEventListener('change', () => {
    localStorage.setItem(key, input.checked ? '1' : '0');
    renderMatches();
  });
}
filterSearch.addEventListener('input', renderMatches);
sortSelect.addEventListener('change', renderMatches);

function renderMatches() {
  if (matchedRaces === null) return;
  const favourites = featureEnabled('favourites');
  const matches = filterSuggestionResults(matchedRaces, {
    search: filterSearch.value,
    hideRemote: document.getElementById('filter-hide-dw3').checked,
    hideHorizons: document.getElementById('filter-hide-horizons').checked,
    hideIgnored: favourites && !!document.getElementById('filter-hide-ignored')?.checked,
    powerplayOnly: featureEnabled('powerplay') && !!document.getElementById('filter-powerplay-only')?.checked,
    order: sortSelect.value,
  }, getFavState);
  const distanceNote = matchedOrigin ? ` Distances from ${matchedOrigin.name}.` : ' Distances are N/A until you enter a system using a travel limit.';
  const order = sortSelect.selectedOptions[0].textContent.toLowerCase();
  status.textContent = `${matches.length} of ${matchedRaces.length} matching races shown. New-to-you races first; within each group, sorted by ${order}.${distanceNote}`;
  if (!matches.length) {
    results.innerHTML = '<p class="empty-state">No matching races. Try relaxing your preferences or the result filters.</p>';
    return;
  }
  results.innerHTML = `
    ${opportunityLegend}
    <p class="nendy-origin">New-to-you races appear above completed races. Races where you're already first have no catchability score (N/A) and follow scored completed races when sorting by catchability. Races without finishers are excluded when a duration is selected.</p>
    <table class="results-table">${opportunityTableHead}<tbody>${renderOpportunityRows(matches, key => favourites ? getFavState(key) : null)}</tbody></table>`;
}

fields.system.value = localStorage.getItem('tt_nendy_system') || '';

function updateQuestions() {
  const commander = getSelectedCommander();
  [...fields.history.options].forEach(option => { option.disabled = !!option.value && !commander; });
  if (!commander) fields.history.value = '';
  for (const [feature, id] of [['favourites', 'filter-hide-ignored-group'], ['powerplay', 'filter-powerplay-only-group']]) {
    const group = document.getElementById(id);
    if (group) group.style.display = featureEnabled(feature) ? '' : 'none';
  }
  const favouritesSort = sortSelect.querySelector('[value="favourites"]');
  if (favouritesSort) {
    favouritesSort.hidden = !featureEnabled('favourites');
    favouritesSort.disabled = !featureEnabled('favourites');
    if (favouritesSort.disabled && sortSelect.value === 'favourites') sortSelect.value = 'catchability';
  }
  document.getElementById('today-srv-question').hidden = fields.vehicle.value !== 'SRV';
  document.getElementById('today-ship-question').hidden = fields.vehicle.value !== 'SHIP';
  document.getElementById('today-daylight-question').hidden = fields.vehicle.value === 'SHIP' && fields.ship.value === 'multi';
  document.getElementById('today-system-question').hidden = !fields.distance.value;
  fields.system.required = !!fields.distance.value;
  if (!fields.distance.value) hideSuggestions();
}

form.addEventListener('change', updateQuestions);
window.addEventListener('storage', event => {
  if (event.key === 'tt_filter_cmdr') {
    updateQuestions();
    matchedRaces = null;
    results.innerHTML = '';
    status.textContent = 'Profile changed. Submit again to refresh your matches.';
  } else if (event.key === 'tt_race_prefs') {
    renderMatches();
  } else {
    const filter = resultFilters.find(([_id, key]) => key === event.key);
    if (filter) {
      const input = document.getElementById(filter[0]);
      if (input) input.checked = filter[0] === 'filter-hide-horizons' ? event.newValue !== '0' : event.newValue === '1';
      renderMatches();
    }
  }
});
updateQuestions();

async function fetchJSON(url, message, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    if (response.status === 404 && url.startsWith('/api/system-coords')) {
      throw new Error('System not found. Check the spelling or choose a suggestion.');
    }
    throw new Error(`${message} (HTTP ${response.status}). Please try again.`);
  }
  return response.json();
}

function hideSuggestions() {
  clearTimeout(debounce);
  suggestionRequest?.abort();
  suggestions.hidden = true;
  fields.system.setAttribute('aria-expanded', 'false');
  fields.system.removeAttribute('aria-activedescendant');
  activeSuggestion = -1;
}

function chooseSuggestion(name) {
  fields.system.value = name;
  hideSuggestions();
  systemStatus.textContent = '';
}

fields.system.addEventListener('input', () => {
  hideSuggestions();
  systemStatus.textContent = '';
  const query = fields.system.value.trim();
  if (query.length < 3) return;
  debounce = setTimeout(async () => {
    const request = new AbortController();
    suggestionRequest = request;
    try {
      const names = await fetchJSON(`/api/system-suggest?q=${encodeURIComponent(query)}`, 'Could not load system suggestions', { signal: request.signal });
      if (request.signal.aborted || fields.system.value.trim() !== query) return;
      suggestions.innerHTML = names.slice(0, 8).map((name, i) =>
        `<li id="today-system-option-${i}" role="option" aria-selected="false">${esc(name)}</li>`).join('');
      suggestions.querySelectorAll('li').forEach((item, i) => {
        item.addEventListener('mousedown', event => {
          event.preventDefault();
          chooseSuggestion(names[i]);
        });
      });
      suggestions.hidden = names.length === 0;
      fields.system.setAttribute('aria-expanded', String(!suggestions.hidden));
    } catch (err) {
      if (err.name !== 'AbortError') systemStatus.textContent = `${err.message} You can still enter a system manually.`;
    }
  }, 300);
});

fields.system.addEventListener('keydown', event => {
  if (event.key === 'Escape') hideSuggestions();
  const items = [...suggestions.querySelectorAll('li')];
  if (suggestions.hidden || !items.length) return;
  if (event.key === 'Enter' && activeSuggestion >= 0) {
    event.preventDefault();
    chooseSuggestion(items[activeSuggestion].textContent);
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    activeSuggestion = Math.max(0, Math.min(items.length - 1, activeSuggestion + step));
    items.forEach((item, i) => {
      item.classList.toggle('active', i === activeSuggestion);
      item.setAttribute('aria-selected', String(i === activeSuggestion));
    });
    fields.system.setAttribute('aria-activedescendant', items[activeSuggestion].id);
  }
});
fields.system.addEventListener('blur', () => { setTimeout(hideSuggestions, 150); });

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const preferences = Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.value]));
  const commander = getSelectedCommander();
  const systemName = fields.system.value.trim();
  if (preferences.distance && !systemName) {
    status.textContent = 'Enter your current system to filter by travel distance.';
    fields.system.focus();
    return;
  }
  busy = true;
  hideSuggestions();
  const controls = [...form.querySelectorAll('input, select, button')];
  controls.forEach(control => { control.disabled = true; });
  results.innerHTML = '';
  matchedRaces = null;
  status.textContent = 'Finding matching races...';
  results.setAttribute('aria-busy', 'true');
  try {
    if (preferences.distance) {
      const resolved = await fetchJSON(`/api/system-coords?name=${encodeURIComponent(systemName)}`, 'Could not look up system');
      if (![resolved.x, resolved.y, resolved.z].every(Number.isFinite)) throw new Error('System lookup returned invalid coordinates.');
      origin = resolved;
      fields.system.value = origin.name;
      localStorage.setItem('tt_nendy_system', origin.name);
    }
    const [races, daylight] = await Promise.all([
      fetchJSON(`/api/race-suggestions?commander=${encodeURIComponent(commander)}`, 'Could not load races'),
      fetchJSON('/api/daynight-bulk', 'Could not load daylight data'),
    ]);
    for (const race of races) {
      const current = daylight[race.key] ? computeDaynightInfo(daylight[race.key]).state : null;
      if (current !== null) race.daylight_state = current;
    }
    if (commander !== getSelectedCommander()) {
      status.textContent = 'Profile changed. Submit again to refresh your matches.';
      return;
    }
    matchedRaces = selectSuggestions(races, preferences, commander, origin);
    matchedOrigin = origin;
    renderMatches();
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  } finally {
    busy = false;
    controls.forEach(control => { control.disabled = false; });
    results.removeAttribute('aria-busy');
    updateQuestions();
  }
});
