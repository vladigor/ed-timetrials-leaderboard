import { esc } from './utils.js';

const container = document.getElementById('rivals-container');
const bubbleFilter = document.getElementById('filter-bubble-only');

async function loadRivals() {
  const commander = localStorage.getItem('tt_filter_cmdr') || '';
  if (!commander) {
    container.innerHTML = '<p class="empty-state">Select a commander profile to view rivalries. <a href="/">Choose profile</a></p>';
    return;
  }

  container.innerHTML = '<p class="loading-placeholder">Loading rivalries…</p>';
  try {
    const params = new URLSearchParams({ commander, bubble_only: String(bubbleFilter.checked) });
    const response = await fetch(`/api/rivals?${params}`);
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    render(await response.json());
  } catch (_) {
    container.innerHTML = '<p class="empty-state">Could not load rivalries.</p>';
  }
}

function render(categories) {
  container.innerHTML = categories.map(category => `
    <section class="rivals-category">
      <h2>${esc(category.label)}</h2>
      ${category.races_competed === 0
        ? '<p class="rivals-summary cmdr-type-stat">You haven\'t competed in any races in this category yet.</p>'
        : `<p class="rivals-summary cmdr-type-stat">You've competed in <strong class="pct-highlight">${category.races_competed}</strong> races, finishing ahead of <strong class="pct-highlight">${category.ahead_percentage}%</strong> of all cmdrs you've raced against.</p>`}
      ${category.rivals.length
        ? `${renderTable(category.rivals)}${category.races_competed >= 3 ? renderImprovementSuggestion(category.rivals) : ''}`
        : '<p class="empty-state">No rivalries in this category.</p>'}
    </section>
  `).join('');
}

function renderTable(rivals) {
  const rows = rivals.map(rival => `
    <tr>
      <td><a href="/cmdr/${encodeURIComponent(rival.commander)}">${esc(rival.commander)}</a></td>
      <td class="stats-rank">${rival.ahead_count}</td>
      <td class="stats-rank">${rival.behind_count}</td>
      <td>${rival.races_ahead.map(race => `<a href="/race/${encodeURIComponent(race.key)}">${esc(race.name)}</a>`).join(', ')}</td>
    </tr>
  `).join('');

  return `
    <div class="table-scroll">
      <table class="stats-table">
        <thead><tr><th>Commander</th><th>Races ahead of you</th><th>Races you're ahead</th><th>Races they lead</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderImprovementSuggestion(rivals) {
  const raceCounts = new Map();
  rivals.forEach(rival => {
    rival.races_ahead.forEach(race => {
      const current = raceCounts.get(race.key) || { ...race, count: 0 };
      current.count += 1;
      raceCounts.set(race.key, current);
    });
  });

  const mostFrequent = [...raceCounts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 2);
  if (!mostFrequent.length) return '';

  const raceLinks = mostFrequent.map(race =>
    `<a href="/race/${encodeURIComponent(race.key)}">${esc(race.name)}</a>`
  );
  const raceNames = raceLinks.length === 2
    ? `${raceLinks[0]} and ${raceLinks[1]}`
    : raceLinks[0];

  return `<p class="rivals-improvement">Based on this table it looks like you could make the most gains on ${raceNames}.</p>`;
}

bubbleFilter.addEventListener('change', loadRivals);
loadRivals();
