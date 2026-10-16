import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catchabilityScore, scoreOpportunity, selectSuggestions, filterSuggestionResults, renderOpportunityRows,
} from '../static/js/opportunities.js';
import { matchesRaceFilters, compareRaceOrder } from '../static/js/race-filters.js';

const origin = { x: 0, y: 0, z: 0 };
function race(key, changes = {}) {
  return {
    key, name: key, type: 'SRV', tags: '', multi_planet: 0,
    coords: '10,0,0', median_time_ms: 400000, daylight_state: 'day',
    results: [], ...changes,
  };
}
function keys(races, preferences = {}, commander = 'Me', from = origin) {
  return selectSuggestions(races, preferences, commander, from).map(s => s.race.key);
}
const finishers = [
  { name: 'Leader', position: 1, time_ms: 90000 },
  { name: 'Next', position: 2, time_ms: 95000 },
  { name: 'Me', position: 3, time_ms: 100000 },
];

test('vehicle and Circuit filters are conditional and use exact tags', () => {
  const races = [race('circuit', { tags: 'Remote, Circuit' }), race('offroad'),
    race('ship', { type: 'SHIP' }), race('fighter', { type: 'FIGHTER' }),
    race('foot', { type: 'ONFOOT' }), race('inactive', { tags: 'Inactive' })];
  assert.deepEqual(keys(races, { vehicle: 'SRV', srv: 'circuit' }), ['circuit']);
  assert.deepEqual(keys(races, { vehicle: 'SRV', srv: 'offroad' }), ['offroad']);
  assert.deepEqual(keys(races, { vehicle: 'FIGHTER', srv: 'circuit' }), ['fighter']);
  assert.deepEqual(keys(races, { vehicle: 'ONFOOT' }), ['foot']);
  assert.equal(keys(races, { srv: 'circuit' }).length, 5);
});

test('ship classification uses Multi-planet metadata or tag; daylight skips multi-planet', () => {
  const races = [race('planet', { type: 'SHIP' }),
    race('between', { type: 'SHIP', multi_planet: 1, daylight_state: 'night' }),
    race('tagged', { type: 'SHIP', tags: 'Multi-planet', daylight_state: null }),
    race('night', { daylight_state: 'night' }), race('unknown', { daylight_state: null })];
  assert.deepEqual(keys(races, { vehicle: 'SHIP', ship: 'planet' }), ['planet']);
  assert.deepEqual(keys(races, { vehicle: 'SHIP', ship: 'multi' }), ['between', 'tagged']);
  assert.deepEqual(keys(races, { daylight: 'day' }), ['between', 'planet', 'tagged']);
});

test('personal race history is case insensitive and first-place races remain eligible', () => {
  const races = [race('new'), race('done', { results: finishers }),
    race('first', { results: [{ name: 'ME', position: 1, time_ms: 90000 }] })];
  assert.deepEqual(keys(races, { history: 'new' }, 'me'), ['new']);
  assert.deepEqual(keys(races, { history: 'done' }, 'me'), ['done', 'first']);
  assert.deepEqual(keys(races, {}, ''), ['done', 'first', 'new']);
});

test('duration bands include exactly 5 and 10 minutes in the middle band', () => {
  const races = [race('short', { median_time_ms: 299999 }), race('five', { median_time_ms: 300000 }),
    race('ten', { median_time_ms: 600000 }), race('long', { median_time_ms: 600001 }),
    race('empty', { median_time_ms: null })];
  assert.deepEqual(keys(races, { duration: 'short' }), ['short']);
  assert.deepEqual(keys(races, { duration: 'medium' }), ['five', 'ten']);
  assert.deepEqual(keys(races, { duration: 'long' }), ['long']);
  assert.equal(keys(races).length, 5);
});

test('travel limits are strict, use 3D distance and exclude missing or malformed coordinates', () => {
  const races = [race('near', { coords: '0,0,99.9' }), race('hundred', { coords: '100,0,0' }),
    race('diagonal', { coords: '300,400,0' }), race('inside', { coords: '0,499.9,0' }),
    race('missing', { coords: '' }), race('blank', { coords: '1,,3' }),
    race('invalid', { coords: 'NaN,0,0' })];
  assert.deepEqual(keys(races, { distance: '100' }), ['near']);
  assert.deepEqual(keys(races, { distance: '500' }), ['near', 'hundred', 'inside']);
  assert.equal(keys(races).length, 7);
  assert.equal(keys(races, {}, 'Me', null).length, 7);
});

test('new races come first, then completed races by catchability and distance', () => {
  assert.ok(Math.abs(catchabilityScore(100000, 3, finishers) - 0.01) < 1e-10);
  const races = [
    race('far', { coords: '400,0,0', results: finishers }),
    race('close', { coords: '20,0,0', results: finishers }),
    race('better', { coords: '450,0,0', results: [
      { name: 'Leader', position: 1, time_ms: 99000 }, { name: 'Me', position: 2, time_ms: 100000 },
    ] }),
    race('new', { coords: '0,0,0' }),
    race('new-far', { coords: '500,0,0' }),
    race('first', { coords: '5,0,0', results: [{ name: 'Me', position: 1, time_ms: 100000 }] }),
  ];
  assert.deepEqual(keys(races), ['new', 'new-far', 'better', 'close', 'far', 'first']);
  const opportunity = scoreOpportunity(races[0], 'Me');
  assert.equal(opportunity.gapMs, 5000);
  assert.equal(opportunity.leapable, 2);
  assert.equal(opportunity.total, 3);
});

test('index filters match remote tags, Horizons, ignored races and Powerplay', () => {
  for (const tag of ['Remote', 'DW3', 'DR1', 'Colonia']) {
    assert.equal(matchesRaceFilters(race(tag, { tags: `Circuit, ${tag}` }), { hideRemote: true }), false);
  }
  assert.equal(matchesRaceFilters(race('local', { tags: 'Circuit' }), { hideRemote: true }), true);
  assert.equal(matchesRaceFilters(race('old', { version: 'HORIZONS' }), { hideHorizons: true }), false);
  assert.equal(matchesRaceFilters(race('new', { version: 'ODYSSEY' }), { hideHorizons: true }), true);
  assert.equal(matchesRaceFilters(race('ignored'), { hideIgnored: true }, () => 'ignored'), false);
  assert.equal(matchesRaceFilters(race('fav'), { hideIgnored: true }, () => 'fav'), true);
  assert.equal(matchesRaceFilters(race('none'), { powerplayOnly: true }), false);
  assert.equal(matchesRaceFilters(race('power', { powerplay: 'A Power' }), { powerplayOnly: true }), true);
  assert.equal(matchesRaceFilters(race('night', { daylight_state: 'night' }), { daytimeOnly: true }), false);
});

test('shared search covers index fields, tags and generated badges', () => {
  for (const field of ['name', 'system', 'station', 'type', 'version', 'tags']) {
    assert.equal(matchesRaceFilters(race('test', { [field]: 'UniqueTerm' }), { search: 'uniqueterm' }), true);
  }
  assert.equal(matchesRaceFilters(race('test', { tags: ['Remote', 'Circuit'] }), { search: 'circuit' }), true);
  for (const badge of ['multi-mode', 'multi-planet', 'multi-system']) {
    assert.equal(matchesRaceFilters(race('test', { [badge.replace('-', '_')]: 1 }), { search: badge }), true);
  }
  assert.equal(matchesRaceFilters(race('test'), { search: 'absent' }), false);
  assert.equal(matchesRaceFilters(race('test'), { search: '  ' }), true);
});

test('result-bar filtering is immediate, reversible and retains query constraints', () => {
  const matches = selectSuggestions([
    race('new', { name: 'New Circuit', tags: 'Circuit', type: 'SRV' }),
    race('remote', { tags: 'Remote' }),
    race('done', { name: 'Done Circuit', tags: 'Circuit', results: finishers }),
    race('ship', { name: 'Ship Circuit', tags: 'Circuit', type: 'SHIP' }),
  ], { vehicle: 'SRV' }, 'Me', origin);
  const originalKeys = matches.map(s => s.race.key);
  assert.deepEqual(filterSuggestionResults(matches, { search: 'circuit', order: 'catchability' }).map(s => s.race.key), ['new', 'done']);
  assert.deepEqual(filterSuggestionResults(matches, { hideRemote: true, order: 'catchability' }).map(s => s.race.key), ['new', 'done']);
  assert.deepEqual(filterSuggestionResults(matches, { search: 'no matches', order: 'name' }), []);
  assert.deepEqual(filterSuggestionResults(matches, { order: 'catchability' }).map(s => s.race.key), originalKeys);
  assert.deepEqual(matches.map(s => s.race.key), originalKeys);
});

test('all index sort choices keep new-to-you races above completed races', () => {
  const dates = { old: '2026-01-01 00:00:00', recent: '2026-10-01 00:00:00' };
  const races = [
    race('new-z', { name: 'The Z Race', last_activity: dates.old, created_at: dates.recent }),
    race('new-a', { name: 'A Race', last_activity: dates.recent, created_at: dates.old }),
    race('done-a', { name: 'A Done', results: finishers, last_activity: dates.recent }),
  ];
  const matches = selectSuggestions(races, {}, 'Me', origin);
  const fav = key => key === 'new-z' || key === 'done-a' ? 'fav' : null;
  for (const order of ['name', 'activity', 'created', 'favourites', 'catchability']) {
    const sorted = filterSuggestionResults(matches, { order }, fav);
    assert.equal(sorted[2].race.key, 'done-a');
  }
  assert.deepEqual(filterSuggestionResults(matches, { order: 'name' }).map(s => s.race.key), ['new-a', 'new-z', 'done-a']);
  assert.deepEqual(filterSuggestionResults(matches, { order: 'created' }).map(s => s.race.key), ['new-z', 'new-a', 'done-a']);
  assert.deepEqual(filterSuggestionResults(matches, { order: 'favourites' }, fav).map(s => s.race.key), ['new-z', 'new-a', 'done-a']);
  assert.equal([...races].sort((a, b) => compareRaceOrder(a, b, 'activity'))[0].key, 'new-a');
  assert.equal([...races].sort((a, b) => compareRaceOrder(a, b, 'name'))[0].key, 'done-a');
});

test('shared table escapes names and tags and renders unscored races explicitly', () => {
  const entries = selectSuggestions([race('unsafe/key', {
    name: '<script>alert(1)</script>', tags: '<img src=x onerror=alert(1)>',
  })], {}, '', null);
  const html = renderOpportunityRows(entries);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('/race/unsafe%2Fkey'));
  assert.ok(html.includes('N/A'));
  assert.ok(!html.includes('<script>'));
});
