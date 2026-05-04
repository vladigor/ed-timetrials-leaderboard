import { ordinal, formatTime, formatImprovement, formatDelta, relativeTime, esc } from './utils.js';
import { ChangePoller } from './poller.js';

// ── State ──────────────────────────────────────────────────────────────────
const raceKey        = decodeURIComponent(location.pathname.split('/race/')[1] || '');
const selectedCmdr   = localStorage.getItem('tt_filter_cmdr') || '';
const FRESH_MS       = 60 * 60 * 1000;

function isFresh(ts) {
  if (!ts) return false;
  const norm = ts.replace(' ', 'T').replace(/(\.(\d{1,6})).*$/, '$1') + 'Z';
  return Date.now() - new Date(norm).getTime() < FRESH_MS;
}
let race          = null;
let poller        = null;
let isOffline     = false;
let chartInstance = null;
let timeUpdater   = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
const titleEl      = document.getElementById('race-title');
const breadcrumbEl = document.getElementById('race-breadcrumb');
const metaEl       = document.getElementById('race-meta');
const constrEl     = document.getElementById('race-constraints');
const infoEl       = document.getElementById('race-info');
const descEl       = document.getElementById('race-description');
const layoutEl     = document.getElementById('results-layout');
const rivalryEl    = document.getElementById('race-rivalry');
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

  // Setup add media link handler (if present in dev mode)
  const addMediaLink = document.getElementById('add-media-link');
  if (addMediaLink) {
    addMediaLink.href = `/race/${encodeURIComponent(raceKey)}/add-media`;
  }

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

  // Start periodic time updater for relative times
  startTimeUpdater();
}

// ── Data loading ───────────────────────────────────────────────────────────
async function loadRace() {
  try {
    race = await fetch(`/api/races/${encodeURIComponent(raceKey)}`).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    renderRace();
    await loadRaceMap();
  } catch (err) {
    showError('Could not load race data.');
    setStatus('error');
  }
}

async function loadRaceMap() {
  try {
    const mediaData = await fetch(`/api/race-map/${encodeURIComponent(raceKey)}`).then(r => r.json());

    let allLinks = [...(mediaData.links || [])];

    // Handle map thumbnail if present
    if (mediaData.map) {
      const container = document.getElementById('race-map-container');
      const link = document.getElementById('race-map-link');
      const thumbnail = document.getElementById('race-map-thumbnail');

      const { thumbnail: thumbPath, target: targetPath } = mediaData.map;

      // Handle both relative and absolute URLs for thumbnail
      const thumbnailUrl = thumbPath.startsWith('http') ? thumbPath : `/${thumbPath}`;
      // Handle both relative and absolute URLs for target
      const targetUrl = targetPath.startsWith('http') ? targetPath : `/${targetPath}`;

      link.href = targetUrl;
      thumbnail.src = thumbnailUrl;

      // Open external links in new tab
      if (targetPath.startsWith('http')) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      } else {
        link.target = '_blank';
      }

      container.style.display = 'block';

      // Add map as a link at the beginning for mobile view
      allLinks.unshift({
        label: 'Map',
        url: targetUrl,
        type: 'image',
        mobileOnly: true
      });
    }

    // Render links if present (includes map link on mobile + any additional links)
    if (allLinks.length > 0) {
      const linksContainer = document.getElementById('race-media-links');
      if (linksContainer) {
        const listItems = allLinks.map(linkItem => {
          // Select icon based on link type
          let icon = '<i class="fa-solid fa-link"></i>'; // default
          if (linkItem.type === 'video') icon = '<i class="fa-brands fa-youtube"></i>';
          else if (linkItem.type === 'image') icon = '<i class="fa-solid fa-image"></i>';
          else if (linkItem.type === 'info') icon = 'ℹ️';

          const mobileClass = linkItem.mobileOnly ? ' class="mobile-only-link"' : '';

          // If URL is empty, render as plain text instead of a link
          if (!linkItem.url || linkItem.url.trim() === '') {
            return `<li${mobileClass}><span class="link-text">${icon}${esc(linkItem.label)}</span></li>`;
          }

          return `<li${mobileClass}><a href="${linkItem.url}" target="_blank" rel="noopener noreferrer">${icon}${esc(linkItem.label)}</a></li>`;
        }).join('');
        linksContainer.innerHTML = `<ul class="new-races-list">${listItems}</ul>`;
        linksContainer.style.display = 'block';
      }
    }
  } catch (err) {
    // Silently fail if map loading fails - not critical
    console.warn('Could not load race map:', err);
  }
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderRace() {
  document.title = `${race.name} — Elite TT Leaderboard`;

  // Header
  titleEl.textContent      = race.name;
  breadcrumbEl.textContent = race.name;

  const _versionCls = race.version === 'ODYSSEY' ? 'badge-odyssey' : 'badge-horizons';
  const creatorHtml = race.creator
    ? (race.creator_is_cmdr
        ? `<span>· Created by <a href="/creator/${encodeURIComponent(race.creator)}" class="cmdr-link">${esc(race.creator)}</a></span>`
        : `<span>· Created by ${esc(race.creator)}</span>`)
    : '';
  metaEl.innerHTML = `
    ${race.type ? `<span class="badge ${{ SHIP: 'badge-ship', SRV: 'badge-srv', FIGHTER: 'badge-fighter', ONFOOT: 'badge-onfoot' }[race.type] ?? 'badge-onfoot'}">${esc(race.type)}</span>` : ''}
    <span>${esc(race.system)} <button class="copy-btn" data-copy="${esc(race.system)}" title="Copy system name" aria-label="Copy system name"><svg class="copy-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="currentColor" d="M384 336H192c-8.8 0-16-7.2-16-16V64c0-8.8 7.2-16 16-16l140.1 0L400 115.9V320c0 8.8-7.2 16-16 16zM192 384H384c35.3 0 64-28.7 64-64V115.9c0-12.7-5.1-24.9-14.1-33.9L366.1 14.1c-9-9-21.2-14.1-33.9-14.1H192c-35.3 0-64 28.7-64 64V320c0 35.3 28.7 64 64 64zM64 128c-35.3 0-64 28.7-64 64V448c0 35.3 28.7 64 64 64H256c35.3 0 64-28.7 64-64V416H272v32c0 8.8-7.2 16-16 16H64c-8.8 0-16-7.2-16-16V192c0-8.8 7.2-16 16-16H96V128H64z"></path></svg></button></span>
    ${race.station ? `<span>· ${esc(race.station)}</span>` : ''}
    ${race.address ? `<span>· ${esc(race.address)}</span>` : ''}
    ${creatorHtml}
  `;

  // Attach copy handler
  const copyBtn = metaEl.querySelector('.copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', handleCopySystemName);
  }

  if (race.constraints && race.constraints.length) {
    const descriptions = formatConstraintsUserFriendly(race.constraints);
    constrEl.innerHTML = `<div class="constraints-label">Race constraints:</div><ul class="constraints-list">${descriptions}</ul>`;
  } else {
    constrEl.innerHTML = '';
  }

  // Info badges: checkpoints, multi-system, multi-planet, multi-vessel
  const infoBadges = [];
  if (race.version === 'HORIZONS') {
    infoBadges.push('<span class="info-badge info-badge-horizons">Horizons</span>');
  }
  if (race.num_checkpoints > 0) {
    infoBadges.push(`<span class="info-badge">🏁 ${race.num_checkpoints} checkpoint${race.num_checkpoints !== 1 ? 's' : ''}</span>`);
  }
  if (race.multi_system) infoBadges.push('<span class="info-badge info-badge-accent">Multi-system</span>');
  if (race.multi_planet) infoBadges.push('<span class="info-badge info-badge-accent">Multi-planet</span>');
  if (race.multi_mode) infoBadges.push('<span class="info-badge info-badge-accent">Multi-mode</span>');
  infoEl.innerHTML = infoBadges.join('');

  if (race.description) {
    descEl.textContent = race.description;
    descEl.style.display = '';
  } else {
    descEl.style.display = 'none';
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
      isFresh(entry.updated) ? 'row-fresh' : '',
    ].filter(Boolean).join(' ');

    // Format ship display: "Ship Type" or "Ship Type · Ship Name"
    const shipDisplay = entry.shipname
      ? `${esc(entry.ship)} · <span style="font-style:italic">${esc(entry.shipname)}</span>`
      : esc(entry.ship);

    return `
      <tr${rowClasses ? ` class="${rowClasses}"` : ''}>
        <td class="pos${posCls}">${entry.position}</td>
        <td class="cmdr-name"><a href="/cmdr/${encodeURIComponent(entry.name)}" class="cmdr-link">${esc(entry.name)}</a></td>
        <td class="time-cell">${formatTime(entry.time_ms)}</td>
        <td class="delta-cell">${formatDelta(entry.delta_ms)}</td>
        <td class="improvement-cell ${imp.cls}">${imp.text}</td>
        <td style="color:var(--text-muted);font-size:.8rem">${shipDisplay}</td>
        <td class="updated-cell" style="font-size:.8rem" data-timestamp="${entry.updated || ''}">${entry.updated ? relativeTime(entry.updated) : ''}</td>
      </tr>`;
  });

  // Render containers (old chart is disposed before innerHTML wipes its element)
  if (chartInstance) { chartInstance.dispose(); chartInstance = null; }

  const isSmallScreen = window.innerWidth <= 950;
  const commanderLabel = isSmallScreen ? 'Cmdr' : 'Commander';
  const improvementLabel = isSmallScreen ? 'Imprvmnt' : 'Improvement';
  const updatedLabel = isSmallScreen ? 'When' : 'Updated';

  layoutEl.innerHTML = `
    <div id="race-chart" style="height:${chartHeight}px"></div>
    <div class="results-table-panel">
      <table class="results-table">
        <thead>
          <tr>
            <th>#</th><th>${commanderLabel}</th><th>Time</th>
            <th>Gap</th><th>${improvementLabel}</th><th>Ship / Name</th><th>${updatedLabel}</th>
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

  renderRivalry(race.results, race.rivalry);
}

// ── Rivalry panel ──────────────────────────────────────────────────────────
function _isRecent(ts) {
  if (!ts) return false;
  const norm = ts.replace(' ', 'T').replace(/(\.\d{1,6}).*$/, '$1') + 'Z';
  return Date.now() - new Date(norm).getTime() < 24 * 60 * 60 * 1000;
}

function _cmdrLink(n) {
  const highlight = selectedCmdr && n === selectedCmdr ? ' cmdr-link-self' : '';
  return `<a href="/cmdr/${encodeURIComponent(n)}" class="cmdr-link${highlight}">${esc(n)}</a>`;
}

function _fmt(ms) {
  let text;
  if (ms < 1000) {
    text = `${ms}ms`;
  } else if (ms < 60_000) {
    const secs   = Math.floor(ms / 1000);
    const millis = ms % 1000;
    text = `${secs}.${String(millis).padStart(3, '0')}s`;
  } else {
    text = `${(ms / 60_000).toFixed(1)}min`;
  }
  return `<strong>${text}</strong>`;
}

function _buildRivalryStatements(results, rivalry) {
  const statements = [];
  const n = results.length;
  if (n < 2) return statements;

  const p1Time = results[0].time_ms;

  // Score a gap: smaller gap → higher score (0–100). Returns -1 if above threshold.
  function gapScore(gapMs, threshold) {
    const ratio = gapMs / p1Time;
    if (ratio >= threshold) return -1;
    return Math.round((threshold - ratio) / threshold * 100);
  }

  // 1. Lead swap — uses existing rivalry object
  if (rivalry && rivalry.switches >= 2) {
    const { switches, window: win, contenders } = rivalry;
    const windowLabel = win === 'day' ? 'past 24 hours' : 'past week';
    const timesLabel  = `${switches} time${switches !== 1 ? 's' : ''}`;
    const names = contenders.map(_cmdrLink);
    const nameList = names.length === 2
      ? `${names[0]} and ${names[1]}`
      : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    statements.push({
      score: Math.min(100, 40 + switches * 12),
      icon: '⚔️',
      text: `The lead has changed <strong>${timesLabel}</strong> in the ${windowLabel}. CMDRs ${nameList} are fighting for the top spot.`,
    });
  }

  // 2. Near-tie at top (P1 vs P2) — threshold 1.5% of P1 time
  if (n >= 2) {
    const gap = results[1].time_ms - p1Time;
    const score = gapScore(gap, 0.015);
    if (score >= 0) {
      statements.push({
        score,
        icon: '🎯',
        text: `Only ${_fmt(gap)} separates ${_cmdrLink(results[0].name)} (${ordinal(1)}) and ${_cmdrLink(results[1].name)} (${ordinal(2)}) — an incredibly tight top two.`,
      });
    }
  }

  // 3. Commanding leader — P1→P2 gap much larger than the average inter-position gap
  if (n >= 3) {
    const gapP1P2   = results[1].time_ms - p1Time;
    const restSpread = results[n - 1].time_ms - results[1].time_ms;
    const avgRestGap = restSpread / Math.max(1, n - 2);
    const refGap     = Math.max(results[2].time_ms - results[1].time_ms, avgRestGap);
    if (refGap > 0 && gapP1P2 / refGap > 3) {
      const ratio = gapP1P2 / refGap;
      statements.push({
        score: Math.min(80, Math.round(20 + ratio * 4)),
        icon: '👑',
        text: `${_cmdrLink(results[0].name)} leads by ${_fmt(gapP1P2)} — a commanding margin the rest of the field has yet to match.`,
      });
    }
  }

  // 4. Imminent podium threat — P4 within 1.5% of P1 time behind P3
  if (n >= 4) {
    const gap   = results[3].time_ms - results[2].time_ms;
    const score = gapScore(gap, 0.015);
    if (score >= 0) {
      statements.push({
        score: Math.round(score * 0.85),
        icon: '🔥',
        text: `${_cmdrLink(results[3].name)} in ${ordinal(4)} place is just ${_fmt(gap)} off the podium.`,
      });
    }
  }

  // 5. Tightest cluster of 3+ consecutive positions anywhere in the results
  let bestCluster = null;
  let bestClusterScore = -1;
  for (let s = 0; s < n - 2; s++) {
    for (let e = s + 2; e < n; e++) {
      const spread = results[e].time_ms - results[s].time_ms;
      const ratio  = spread / p1Time;
      if (ratio >= 0.02) break; // spread only grows as e increases
      const count        = e - s + 1;
      const tightness    = (0.02 - ratio) / 0.02 * 70;
      const countBonus   = (count - 3) * 6;
      const posBonus     = Math.max(0, 8 - results[s].position) * 2;
      const clusterScore = Math.round(tightness + countBonus + posBonus);
      if (clusterScore > bestClusterScore) {
        bestClusterScore = clusterScore;
        bestCluster = { count, spread, startPos: results[s].position, endPos: results[e].position };
      }
    }
  }
  if (bestCluster) {
    const { count, spread, startPos, endPos } = bestCluster;
    // Skip trivially small ranges already covered by statements 2 and 4
    const trivial = (startPos === 1 && endPos === 2) || (startPos === 3 && endPos === 4);
    if (!trivial) {
      statements.push({
        score: bestClusterScore,
        icon: '🏎️',
        text: `The ${count} commanders between ${ordinal(startPos)} and ${ordinal(endPos)} place are separated by just ${_fmt(spread)} — there's intense competition for the ${ordinal(startPos)} spot!`,
      });
    }
  }

  // 6. Recent significant improvement
  let bestMover = null;
  let bestMoverScore = -1;
  for (const entry of results) {
    if (!(entry.improvement_ms > 0 && _isRecent(entry.updated))) continue;
    const score = Math.min(85, Math.round((entry.improvement_ms / entry.time_ms) * 1500));
    if (score > bestMoverScore) { bestMoverScore = score; bestMover = entry; }
  }
  if (bestMover && bestMoverScore >= 10) {
    const above      = bestMover.position > 1 ? results[bestMover.position - 2] : null;
    const gapToAbove = above ? bestMover.time_ms - above.time_ms : 0;
    const closingText = gapToAbove > 0 && gapToAbove / p1Time < 0.015
      ? `, just ${_fmt(gapToAbove)} behind ${ordinal(bestMover.position - 1)} place`
      : '';
    statements.push({
      score: bestMoverScore,
      icon: '📈',
      text: `Look out! ${_cmdrLink(bestMover.name)} improved their time by ${_fmt(bestMover.improvement_ms)} in their latest run${closingText}!`,
    });
  }

  statements.sort((a, b) => b.score - a.score);
  return statements.slice(0, 4);
}

function renderRivalry(results, rivalry) {
  const statements = _buildRivalryStatements(results, rivalry);
  if (statements.length === 0) { rivalryEl.style.display = 'none'; return; }

  const rows = statements.map(s =>
    `<div class="rivalry-row"><span class="rivalry-icon">${s.icon}</span><span>${s.text}</span></div>`
  ).join('');

  rivalryEl.innerHTML = `<div class="rivalry-panel">${rows}</div>`;
  rivalryEl.style.display = '';
}

// ── Constraint formatting ──────────────────────────────────────────────────
/**
 * Converts raw constraint objects into human-friendly descriptions.
 * Combines related constraints (e.g., pip limits + penalties) into single items.
 * @param {Array<{key: string, value: number}>} constraints
 * @returns {string} HTML string with <li> elements
 */
function formatConstraintsUserFriendly(constraints) {
  if (!constraints || !constraints.length) return '';

  // Build a map for easy lookup
  const cmap = {};
  constraints.forEach(c => { cmap[c.key] = c.value; });

  const items = [];
  const processed = new Set(); // Track which constraints we've already handled

  // 1. Handle pip-related constraints as a combined item
  if ('MaxSRVPips' in cmap) {
    const maxPips = cmap.MaxSRVPips / 2; // stored doubled in DB
    const faultLimit = cmap.SRVPipFaultLimit;
    const penalty = cmap.SRVPipPenalty;
    const disqualify = cmap.SRVPipDisqualify;

    let desc = `Maximum SRV engine pips allowed = ${maxPips.toFixed(1)}`;

    // Build penalty/disqualification details
    const details = [];

    if (penalty !== undefined && faultLimit !== undefined) {
      const penaltyWord = penalty !== 1 ? 'seconds' : 'second';
      details.push(`you will incur a ${penalty} ${penaltyWord} penalty every ${faultLimit} pip fault${faultLimit !== 1 ? 's' : ''}`);
    } else if (penalty !== undefined) {
      const penaltyWord = penalty !== 1 ? 'seconds' : 'second';
      details.push(`${penalty} ${penaltyWord} penalty per pip violation`);
    } else if (faultLimit !== undefined) {
      details.push(`you are allowed ${faultLimit} pip fault${faultLimit !== 1 ? 's' : ''}`);
    }

    if (disqualify !== undefined) {
      details.push(`you will be disqualified after ${disqualify} pip violation${disqualify !== 1 ? 's' : ''}`);
    }

    if (details.length > 0) {
      desc += ' : ' + details.join(' and ');
    }

    items.push(`<li>${esc(desc)}</li>`);
    processed.add('MaxSRVPips');
    processed.add('SRVPipFaultLimit');
    processed.add('SRVPipPenalty');
    processed.add('SRVPipDisqualify');
  }

  // 2. NoShipDocking constraint
  if ('NoShipDocking' in cmap && !processed.has('NoShipDocking')) {
    const value = cmap.NoShipDocking;
    const desc = value === 1
      ? 'You may not return to your ship to dock'
      : `${value} ${value !== 1 ? 'seconds' : 'second'} penalty for returning to ship to dock`;
    items.push(`<li>${esc(desc)}</li>`);
    processed.add('NoShipDocking');
  }

  // 3. NoHullRepair constraint
  if ('NoHullRepair' in cmap && !processed.has('NoHullRepair')) {
    const value = cmap.NoHullRepair;
    const desc = value === 1
      ? 'You may not repair hull damage'
      : `${value} ${value !== 1 ? 'seconds' : 'second'} penalty for repairing hull damage`;
    items.push(`<li>${esc(desc)}</li>`);
    processed.add('NoHullRepair');
  }

  // 4. PauseResume constraint
  if ('PauseResume' in cmap && !processed.has('PauseResume')) {
    items.push(`<li>You may pause and resume this race</li>`);
    processed.add('PauseResume');
  }

  // 5. Handle any remaining unprocessed constraints (fallback for unknown types)
  constraints.forEach(c => {
    if (!processed.has(c.key)) {
      const val = c.key === 'MaxSRVPips' ? c.value / 2 : c.value;
      items.push(`<li>${esc(camelToWords(c.key))}: ${esc(String(val))}</li>`);
    }
  });

  return items.join('');
}

// ── ECharts option builder ─────────────────────────────────────────────────
function camelToWords(str) {
  // Insert a space before sequences: uppercase after lowercase, uppercase before
  // uppercase+lowercase (e.g. SRVPip → SRV Pip), digits adjacent to letters.
  return str
    .replace(/([a-z])([A-Z])/g, '$1 $2')          // camelCase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')    // abbreviation boundary (SRVPip → SRV Pip)
    .replace(/([a-zA-Z])([0-9])/g, '$1 $2')        // letter→digit
    .replace(/([0-9])([a-zA-Z])/g, '$1 $2');       // digit→letter
}

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
      axisLabel: { show: false },
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

// ── Dynamic time updater ───────────────────────────────────────────────────
/**
 * Update all relative time displays every minute to keep them current.
 */
function updateRelativeTimes() {
  const cells = document.querySelectorAll('.updated-cell[data-timestamp]');

  cells.forEach(cell => {
    const timestamp = cell.dataset.timestamp;
    if (!timestamp) return;

    cell.textContent = relativeTime(timestamp);
  });
}

/**
 * Start the periodic time updater (runs every 60 seconds)
 */
function startTimeUpdater() {
  if (timeUpdater) clearInterval(timeUpdater);

  timeUpdater = setInterval(() => {
    updateRelativeTimes();
  }, 60_000); // Every 60 seconds
}

/**
 * Stop the periodic time updater
 */
function _stopTimeUpdater() {
  if (timeUpdater) {
    clearInterval(timeUpdater);
    timeUpdater = null;
  }
}

// ── Copy to clipboard handler ──────────────────────────────────────────────
/**
 * Copy system name to clipboard and show visual feedback
 */
async function handleCopySystemName(evt) {
  const btn = evt.currentTarget;
  const text = btn.dataset.copy;

  try {
    await navigator.clipboard.writeText(text);

    // Visual feedback: change icon to checkmark
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<svg class="copy-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="currentColor" d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"></path></svg>';
    btn.classList.add('copied');

    setTimeout(() => {
      btn.innerHTML = originalContent;
      btn.classList.remove('copied');
    }, 1500);
  } catch (err) {
    console.error('Failed to copy:', err);
    // Fallback: show error state briefly
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<svg class="copy-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><path fill="currentColor" d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z"></path></svg>';
    setTimeout(() => {
      btn.innerHTML = originalContent;
    }, 1500);
  }
}

// Refresh on tab focus (skipped in offline mode)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !isOffline) {
    loadRace(); // immediate refresh on return
  }
});

init();
