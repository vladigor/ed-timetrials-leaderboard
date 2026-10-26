import assert from 'node:assert/strict';
import test from 'node:test';

test('stats renders podium ship graphs below vehicle graphs, escapes names and handles empty sets', async (t) => {
  const globals = ['document', 'window', 'localStorage'];
  const originals = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  t.after(() => {
    globals.forEach((name, index) => {
      if (originals[index]) Object.defineProperty(globalThis, name, originals[index]);
      else delete globalThis[name];
    });
  });
  globalThis.window = { location: { search: '', hash: '' } };
  globalThis.localStorage = { getItem: () => null };

  for (const empty of [false, true]) {
    const stats = {
      top_podium_ship_types: empty ? [] : [{ ship: '<Eagle & Viper>', count: 4 }],
      top_podium_ship_types_multi: empty ? [] : [{ ship: 'Cobra', count: 2 }],
    };
    let resolveRendered;
    const rendered = new Promise(resolve => { resolveRendered = resolve; });
    const container = { set innerHTML(value) { resolveRendered(value); } };
    const vehicles = { innerHTML: '' };
    const podium = { innerHTML: '' };
    globalThis.document = {
      getElementById: id => ({
        'stats-container': container,
        'vehicles-container': vehicles,
        'podium-vehicles-container': podium,
      })[id] || null,
    };
    const fetchMock = t.mock.method(globalThis, 'fetch', async (url) => {
      const data = url.startsWith('/api/stats') ? stats
        : url.startsWith('/api/active-racers-graph') ? [] : {};
      return new Response(JSON.stringify(data), { status: 200 });
    });
    await import(`../static/js/stats.js?podium-test=${empty}`);
    const html = await rendered;
    const vehiclesIndex = html.indexOf('id="vehicles-container"');
    const headingIndex = html.indexOf('id="podium-ship-popularity"');
    const podiumIndex = html.indexOf('id="podium-vehicles-container"');
    assert.ok(vehiclesIndex >= 0 && headingIndex > vehiclesIndex && podiumIndex > headingIndex);
    assert.ok(vehicles.innerHTML.includes('Top Ship Types'));
    assert.ok(vehicles.innerHTML.includes('Top Fighter Types'));
    const section = podium.innerHTML;
    const planetsideIndex = section.indexOf('Planetside Ship Races');
    assert.ok(planetsideIndex >= 0 && planetsideIndex < section.indexOf('Multi-system / Multi-planet Ship Races'));
    assert.equal(section.match(/class="trend-composition-panel"/g)?.length, 2);
    assert.ok(!section.includes('<table'));
    if (empty) {
      assert.equal(section.match(/No data available\./g)?.length, 2);
    } else {
      assert.equal(section.match(/class="hbar-list"/g)?.length, 2);
      assert.ok(section.includes('&lt;Eagle &amp; Viper&gt;'));
      assert.ok(!section.includes('<Eagle & Viper>'));
      assert.ok(section.includes('Cobra'));
      assert.ok(section.includes('class="hbar-value">4</span>'));
      assert.ok(section.includes('class="hbar-value">2</span>'));
      assert.equal(section.match(/class="hbar-fill seg-srv" style="width:100.00%"/g)?.length, 2);
    }
    fetchMock.mock.restore();
  }
});
