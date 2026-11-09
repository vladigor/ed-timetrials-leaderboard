import assert from 'node:assert/strict';
import test from 'node:test';

test('Alpha Tested checkboxes persist by race key through toggles, filtering, sorting and reloads', async (t) => {
  const globals = ['document', 'window', 'localStorage'];
  const originals = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  t.after(() => globals.forEach((name, index) => {
    if (originals[index]) Object.defineProperty(globalThis, name, originals[index]);
    else delete globalThis[name];
  }));
  const storage = new Map();
  let writeFails = false;
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => {
      if (writeFails) throw new Error('Storage unavailable');
      storage.set(key, value);
    },
  };
  globalThis.window = { FEATURE_FLAGS: { alpha_time_trials: true } };
  const races = [
    { key: 'alpha"<1>', name: '<First>', creator: 'Zulu', system: 'Sol', type: 'SHIP' },
    { key: 'second', name: 'Second', creator: 'Alpha', system: 'Achenar', type: 'SRV' },
  ];
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(races)));
  const errors = t.mock.method(console, 'error', () => {});

  async function loadPage(id) {
    const handlers = {};
    const search = { value: '', addEventListener: (name, handler) => { handlers[`search-${name}`] = handler; } };
    const container = { innerHTML: '', addEventListener: (name, handler) => { handlers[name] = handler; } };
    const status = { hidden: true, textContent: '' };
    globalThis.document = {
      getElementById: name => ({
        'races-by-type': container,
        'race-count': {},
        'filter-search': search,
        'review-status': status,
      })[name],
    };
    await import(`../static/js/alphas.js?review-test=${id}`);
    await new Promise(resolve => setImmediate(resolve));
    return { handlers, search, container, status };
  }

  const page = await loadPage('initial');
  const toggle = (targetPage, key, checked) => {
    const checkbox = { dataset: { raceKey: key }, checked };
    targetPage.handlers.change({ target: { closest: () => checkbox } });
    return checkbox;
  };
  assert.equal(page.container.innerHTML.match(/type="checkbox"/g).length, 2);
  assert.ok(page.container.innerHTML.indexOf('Tested</th>') > page.container.innerHTML.indexOf('Location</th>'));
  assert.ok(page.container.innerHTML.includes('data-race-key="alpha&quot;&lt;1&gt;"'));
  assert.ok(page.container.innerHTML.includes('aria-label="Tested: &lt;First&gt;"'));
  assert.ok(!page.container.innerHTML.includes(' checked'));

  toggle(page, races[0].key, true);
  toggle(page, races[1].key, true);
  assert.deepEqual(JSON.parse(storage.get('tt_alpha_peer_reviews')), races.map(race => race.key));
  page.search.value = 'Sol';
  page.handlers['search-input']();
  assert.equal(page.container.innerHTML.match(/ checked/g).length, 1);
  page.search.value = '';
  page.handlers['search-input']();
  page.handlers.click({ target: { closest: selector => selector === '.th-sortable' ? { dataset: { sort: 'name' } } : null } });
  assert.equal(page.container.innerHTML.match(/ checked/g).length, 2);

  const reloaded = await loadPage('reload');
  assert.equal(reloaded.container.innerHTML.match(/ checked/g).length, 2);
  toggle(reloaded, races[0].key, false);
  assert.deepEqual(JSON.parse(storage.get('tt_alpha_peer_reviews')), ['second']);
  writeFails = true;
  assert.equal(toggle(reloaded, 'second', false).checked, true);
  assert.equal(reloaded.status.hidden, false);
  assert.deepEqual(JSON.parse(storage.get('tt_alpha_peer_reviews')), ['second']);
  writeFails = false;
  toggle(reloaded, 'second', false);
  assert.equal(reloaded.status.hidden, true);
  assert.deepEqual(JSON.parse(storage.get('tt_alpha_peer_reviews')), []);

  for (const [id, value] of [['malformed', '{'], ['invalid-shape', '{}'], ['invalid-keys', '[1]']]) {
    storage.set('tt_alpha_peer_reviews', value);
    const invalid = await loadPage(id);
    assert.equal(invalid.status.hidden, false);
    assert.equal(toggle(invalid, 'second', true).checked, false);
    assert.equal(storage.get('tt_alpha_peer_reviews'), value);
  }
  assert.equal(errors.mock.callCount(), 7);
});
