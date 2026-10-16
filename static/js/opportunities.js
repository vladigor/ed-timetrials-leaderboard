import { esc, formatTime, ordinal } from './utils.js';
import { matchesRaceFilters, compareRaceOrder } from './race-filters.js';

export function typeBadge(type) {
  if (!type) return '';
  const cls = { SHIP: 'badge-ship', SRV: 'badge-srv', FIGHTER: 'badge-fighter', ONFOOT: 'badge-onfoot' }[type] ?? 'badge-onfoot';
  return `<span class="badge ${cls}">${esc(type)}</span>`;
}

export function renderTypeTags(tags) {
  const tagList = (tags || '').split(',').map(t => t.trim()).filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  if (!tagList.length) return '';
  const classes = {
    DW3: 'info-badge-dw3', DR1: 'info-badge-dr1', Colonia: 'info-badge-colonia',
    Remote: 'info-badge-remote', Circuit: 'info-badge-circuit',
  };
  return `<div class="race-type-tags">${tagList.map(tag => {
    const title = tag === 'Inactive' ? "It's no longer possible to compete in this time trial" : `Tagged race: ${tag}`;
    return `<span class="info-badge ${classes[tag] || 'info-badge-inactive'}" title="${esc(title)}">${esc(tag)}</span>`;
  }).join('')}</div>`;
}

export function catchabilityScore(myTime, myPos, results) {
  const above = results.find(r => r.position === myPos - 1);
  const gapPct = above ? (myTime - above.time_ms) / myTime : 0;
  const leapable = results.filter(r => r.position < myPos && r.time_ms >= myTime * 0.90).length;
  return gapPct - leapable * 0.02;
}

export function scoreOpportunity(race, commander) {
  const results = race.results;
  const mine = commander ? results.find(r => r.name.toLowerCase() === commander.toLowerCase()) : null;
  const above = mine ? results.find(r => r.position === mine.position - 1) : null;
  return {
    race, total: results.length, myPos: mine?.position ?? null, myTime: mine?.time_ms ?? null,
    score: above ? catchabilityScore(mine.time_ms, mine.position, results) : null,
    gapMs: above ? mine.time_ms - above.time_ms : null,
    leapable: above ? results.filter(r => r.position < mine.position && r.time_ms >= mine.time_ms * 0.90).length : 0,
    above,
  };
}

export function renderOpportunityRows(scored, favouriteState = () => null) {
  return scored.map((s, i) => {
    const distStr = Number.isFinite(s.race.dist)
      ? (s.race.dist < 1 ? '&lt;1 ly' : `${Math.round(s.race.dist).toLocaleString()} ly`)
      : '<span class="muted">—</span>';
    const gapStr = s.gapMs != null ? formatTime(s.gapMs) : '—';
    const leapStr = s.leapable > 0 ? `+${s.leapable}` : '—';
    const barPct = Math.max(0, Math.min(100, Math.round((1 - Math.max(0, s.score + 0.1) / 0.6) * 100)));
    const daylightEmoji = s.race.daylight_state === 'day' ? '\u2600\ufe0f' : s.race.daylight_state === 'night' ? '\ud83c\udf19' : '';
    const favState = favouriteState(s.race.key);
    const favMarker = favState === 'fav' ? ' ❤️' : favState === 'ignored' ? ' 💔' : '';
    const position = s.myPos == null ? `Not raced / ${s.total}` : `${ordinal(s.myPos)} / ${s.total}`;
    const catchability = s.score == null
      ? '<span class="muted">N/A</span>'
      : `<div class="neidy-bar"><div class="neidy-bar-fill" style="width:${barPct}%"></div></div>`;
    return `
      <tr>
        <td class="num muted">${i + 1}</td>
        <td><a href="/race/${encodeURIComponent(s.race.key)}">${esc(s.race.name)}${favMarker}</a>${daylightEmoji ? `<span style="margin-left:1rem">${daylightEmoji}</span>` : ''}</td>
        <td class="type-col"><div class="race-type-cell">${typeBadge(s.race.type)}${renderTypeTags(s.race.tags)}</div></td>
        <td class="num">${position}</td>
        <td class="num neidy-gap">${gapStr}</td>
        <td class="num neidy-leap">${leapStr}</td>
        <td class="num">${distStr}</td>
        <td class="neidy-bar-cell">${catchability}</td>
      </tr>`;
  }).join('');
}

export const opportunityLegend = `
  <p class="neidy-legend">
    <span class="neidy-legend-item"><strong>Gap</strong> time between you and the position above</span>
    <span class="neidy-legend-item"><strong>Leap</strong> positions you'd gain with a 10% faster time</span>
    <span class="neidy-legend-item"><strong>Catchability</strong> combines Gap (as a proportion of your time) and Leap: a smaller gap and more leapable positions mean a better opportunity. A fuller bar means higher catchability, not a probability of winning. N/A means you haven't raced yet or are already first.</span>
  </p>`;

export const opportunityTableHead = `
  <thead><tr>
    <th class="num">#</th><th>Race</th><th class="type-col">Type</th><th class="num">Position</th>
    <th class="num">Gap</th><th class="num">Leap</th><th class="num">Distance</th><th>Catchability</th>
  </tr></thead>`;

export function isMultiPlanet(race) {
  return !!race.multi_planet || (race.tags || '').split(',').some(t => t.trim().toLowerCase() === 'multi-planet');
}

export function selectSuggestions(races, preferences, commander, origin) {
  return races.filter(race => {
    const tags = (race.tags || '').split(',').map(t => t.trim().toLowerCase());
    if (tags.includes('inactive')) return false;
    if (preferences.vehicle && race.type !== preferences.vehicle) return false;
    if (preferences.vehicle === 'SRV' && preferences.srv) {
      if (tags.includes('circuit') !== (preferences.srv === 'circuit')) return false;
    }
    if (preferences.vehicle === 'SHIP' && preferences.ship) {
      if (isMultiPlanet(race) !== (preferences.ship === 'multi')) return false;
    }
    const done = !!commander && race.results.some(r => r.name.toLowerCase() === commander.toLowerCase());
    if (preferences.history === 'new' && done) return false;
    if (preferences.history === 'done' && !done) return false;
    const daylightOnly = preferences.daylight === 'day' && !(preferences.vehicle === 'SHIP' && preferences.ship === 'multi');
    if (daylightOnly && !isMultiPlanet(race) && race.daylight_state !== 'day') return false;
    const time = race.median_time_ms;
    if (preferences.duration && time == null) return false;
    if (preferences.duration === 'short' && time >= 300000) return false;
    if (preferences.duration === 'medium' && (time < 300000 || time > 600000)) return false;
    if (preferences.duration === 'long' && time <= 600000) return false;
    return true;
  }).map(race => {
    let dist = Infinity;
    if (origin && race.coords) {
      const parts = race.coords.split(',').map(v => v.trim());
      if (parts.length === 3 && parts.every(v => v !== '' && Number.isFinite(Number(v)))) {
        const [x, y, z] = parts.map(Number);
        dist = Math.hypot(x - origin.x, y - origin.y, z - origin.z);
      }
    }
    return scoreOpportunity({ ...race, dist }, commander);
  }).filter(s => !preferences.distance || s.race.dist < Number(preferences.distance))
    .sort((a, b) => {
      if (a.myPos == null && b.myPos != null) return -1;
      if (a.myPos != null && b.myPos == null) return 1;
      if (a.score != null && b.score == null) return -1;
      if (a.score == null && b.score != null) return 1;
      if (a.score !== b.score) return a.score - b.score;
      if (a.race.dist !== b.race.dist) return a.race.dist - b.race.dist;
      return a.race.name.localeCompare(b.race.name) || a.race.key.localeCompare(b.race.key);
    });
}

export function filterSuggestionResults(matches, filters, favouriteState = () => null) {
  return matches.filter(s => matchesRaceFilters(s.race, filters, favouriteState))
    .sort((a, b) => {
      if (a.myPos == null && b.myPos != null) return -1;
      if (a.myPos != null && b.myPos == null) return 1;
      if (filters.order === 'catchability') return 0;
      return compareRaceOrder(a.race, b.race, filters.order, favouriteState);
    });
}
