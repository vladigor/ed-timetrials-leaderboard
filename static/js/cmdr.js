import { formatTime, formatImprovement, relativeTime, esc, ordinal } from './utils.js';

// ── State ──────────────────────────────────────────────────────────────────
const cmdrName   = decodeURIComponent(location.pathname.split('/cmdr/')[1] ?? '');
const isSelf     = !!cmdrName && cmdrName.toUpperCase() === (localStorage.getItem('tt_filter_cmdr') || '').toUpperCase();
let   stats      = null;   // full API response
let   sortBy     = 'percentile';
let   sortDir    = 'asc';         // 'asc' | 'desc'
let   filterRecent = false;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

// NEIDY filter state
let neidyScoredCache  = null;
let neidySourceSystem = '';
let neidyTypeFilter   = '';   // '' = All
let neidyDistFilter   = 1000; // default < 1000ly

// NENDY filter state
let nendyUndoneCache  = null;
let nendySourceSystem = '';
let nendyTypeFilter   = '';   // '' = All
let nendyDistFilter   = 1000; // default < 1000ly

// ── DOM refs ───────────────────────────────────────────────────────────────
const breadcrumb    = document.getElementById('cmdr-breadcrumb');
const title         = document.getElementById('cmdr-title');
const summaryEl     = document.getElementById('cmdr-summary');
const tablesEl      = document.getElementById('cmdr-tables');
const trophyEl      = document.getElementById('trophy-case');
const sortPctBtn    = document.getElementById('sort-pct');
const sortRecBtn    = document.getElementById('sort-recent');
const filterCheck   = document.getElementById('filter-recent');
const nendyInput    = document.getElementById('nendy-system');
const nendyFindBtn  = document.getElementById('nendy-find');

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

  tablesEl.addEventListener('click', e => {
    const th = e.target.closest('.th-sortable');
    if (th) setSort(th.dataset.sort);
  });

  // NENDY: restore last-used system from localStorage
  const savedSystem = localStorage.getItem('tt_nendy_system');
  if (savedSystem) {
    nendyInput.value = savedSystem;
    // Auto-expand Opportunities section by running the search
    nearbyFind();
  }
  nendyFindBtn.addEventListener('click', nearbyFind);
  nendyInput.addEventListener('keydown', e => { if (e.key === 'Enter') nearbyFind(); });

  render();
}

const SORT_DEFAULTS = { name: 'asc', position: 'asc', percentile: 'asc', trend: 'desc', improvement: 'desc', recent: 'desc' };

function setSort(col) {
  if (sortBy === col) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortBy  = col;
    sortDir = SORT_DEFAULTS[col] ?? 'asc';
  }
  sortPctBtn.classList.toggle('active', sortBy === 'percentile');
  sortRecBtn.classList.toggle('active', sortBy === 'recent');
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
    .map(([t, pct]) => `<span class="cmdr-type-stat"><strong>${typeLabels[t] ?? t}</strong> — ahead of <strong class="pct-highlight">${pct}%</strong></span>`)
    .join('');

  summaryEl.innerHTML = `
    <div class="cmdr-overall-pct">
      ${isSelf
        ? `You've finished ahead of <strong>${overall}%</strong> of all pilots you've raced against.`
        : `CMDR ${esc(cmdrName)} has finished ahead of <strong>${overall}%</strong> of all pilots they've raced against.`
      }
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

    typeRaces = typeRaces.slice().sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name':        cmp = a.race_name.localeCompare(b.race_name); break;
        case 'position':    cmp = a.position - b.position; break;
        case 'percentile':  cmp = (a.position === 1 ? 0 : (100 - a.percentile)) - (b.position === 1 ? 0 : (100 - b.percentile)); break;
        case 'improvement': cmp = (a.improvement_ms ?? 0) - (b.improvement_ms ?? 0); break;
        case 'recent': {
          const ta = a.last_competed ?? '';
          const tb = b.last_competed ?? '';
          cmp = ta.localeCompare(tb);
          break;
        }
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    const rows = typeRaces.map(r => {
      // For table display, convert back to "top X%" format
      const topPct = 100 - r.percentile;
      // Opportunity: when top % is higher than type average (room for improvement)
      const typeAvgTop = typeAvgPct !== undefined ? 100 - typeAvgPct : undefined;
      const isOpportunity = typeAvgTop !== undefined && topPct > typeAvgTop;
      const imp = r.improvement_ms != null ? formatImprovement(r.improvement_ms) : null;
      const shipLabel = [r.ship, r.shipname].filter(Boolean).join(' — ');
      return `
        <tr class="${isOpportunity ? 'row-opportunity' : ''}">
          <td><a href="/race/${encodeURIComponent(r.key)}">${esc(r.race_name)}</a></td>
          <td class="num">${ordinal(r.position)} of ${r.total_entries}</td>
          <td class="num ${percentileClass(topPct)}">${r.position === 1 ? '#1 — top' : `top ${topPct.toFixed(1)}%`}</td>
          <td class="num ${imp ? imp.cls : ''}">${imp ? imp.text : '—'}</td>
          <td class="muted">${esc(shipLabel) || '—'}</td>
          <td class="muted">${r.last_competed ? relativeTime(r.last_competed) : '—'}</td>
        </tr>`;
    }).join('');

    html += `
      <section class="cmdr-type-section">
        <h3 class="cmdr-type-heading">
          ${esc(typeLabels[type] ?? type)}
          <span class="cmdr-type-avg">avg top ${(100 - typeAvgPct).toFixed(1)}%</span>
        </h3>
        <table class="results-table">
          <thead>
            <tr>
              ${thSort('name', 'Race')}
              ${thSort('position', 'Position', 'num')}
              ${thSort('percentile', 'Percentile', 'num')}
              ${thSort('improvement', 'Improvement', 'num')}
              <th>Ship</th>
              ${thSort('recent', 'Last competed')}
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

function thSort(col, label, extraClass = '') {
  const isActive = sortBy === col;
  const indicator = isActive ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
  const cls = ['th-sortable', isActive ? 'th-active' : '', extraClass].filter(Boolean).join(' ');
  return `<th class="${cls}" data-sort="${col}">${label}${indicator}</th>`;
}

function percentileClass(pct) {
  // pct is "top X%" — lower is better
  if (pct <= 10) return 'pct-elite';
  if (pct <= 25) return 'pct-good';
  if (pct <= 50) return 'pct-mid';
  return 'pct-low';
}

function _formatPositionDelta(delta) {
  if (delta == null || delta === 0) return { text: '—', cls: 'muted' };
  if (delta > 0) return { text: `▲${delta}`, cls: 'delta-up' };
  return { text: `▼${Math.abs(delta)}`, cls: 'delta-down' };
}

function renderTrophyCase() {
  const gold   = stats.races.filter(r => r.position === 1).length;
  const silver = stats.races.filter(r => r.position === 2).length;
  const bronze = stats.races.filter(r => r.position === 3).length;
  const thefts = stats.podium_thefts ?? [];

  if (gold + silver + bronze === 0 && thefts.length === 0) {
    trophyEl.style.display = 'none';
    return;
  }

  trophyEl.style.display = '';
  let html = '';

  if (gold + silver + bronze > 0) {
    const items = [
      { count: gold,   cls: 'trophy-gold',   label: '1st place', img: '/static/trophy_gold_150.png'   },
      { count: silver, cls: 'trophy-silver', label: '2nd place', img: '/static/trophy_silver_150.png' },
      { count: bronze, cls: 'trophy-bronze', label: '3rd place', img: '/static/trophy_bronze_150.png' },
    ]
    .filter(t => t.count > 0)
    .map(t => `
      <div class="trophy-item ${t.cls}">
        <span class="trophy-label">${t.label}</span>
        <img class="trophy-icon" src="${t.img}" alt="${t.label} trophy" width="150" height="150">
        <span class="trophy-count">${t.count}</span>
      </div>`)
    .join('');

    html += `
      <h2 class="cmdr-section-heading">Trophy Case</h2>
      <div class="trophy-row">${items}</div>
    `;
  }

  if (thefts.length > 0) {
    html += renderThievses(thefts);
  }

  trophyEl.innerHTML = html;
}

// ── Thievses Character Personalities ─────────────────────────────────────────
// Add new characters here! Each character needs:
//   - heading: Section heading with emojis
//   - quotes: Array indexed 0-10 (0=all reclaimed, 1=one theft, ..., 10+=many thefts)
//             Each entry can be a string or array of strings (random selection)
//   - rogueQuotes.many: Function returning quote for prolific thief (3+ thefts)
//   - rogueQuotes.few: Function returning quote for occasional thief (2 thefts)
//
// Example to add a new character:
//   yoda: {
//     heading: 'Stolen, my trophies have been! 🏆⚔️',
//     quotes: [ ... ],
//     rogueQuotes: {
//       many: (name) => ` Strong with theft, <strong>${esc(name)}</strong> is. Much anger I feel!`,
//       few: (name) => ` Beware of <strong>${esc(name)}</strong>, you must. The dark side, they follow.`,
//     }
//   },
//
const THIEVSES_CHARACTERS = {
  gollum: {
    heading: 'Thievses! 🏆🏃💨',
    quotes: [
      'We won them all back, precious! Every single one! Sweet, sweet revenge! They thought they could keep them, but we showed them, yes we did!',
      [
        'They stealses it from us, precious. One precious trophy, gone!',
        'One! One thief, precious, and they takes our trophy just like that!',
        'Sneaky, tricksy, it stealses from us! One precious position, gone forever!',
        'We had it, precious. We HAD it. And now it is gone. One terrible theft.',
        'Lost it, precious. Lost our precious spot to a nasty thief!',
      ],
      [
        'Two times! Two precious positions stolen! Nasty tricksy commanderses!',
        'Twice they does it, precious! Twice! We is beside ourselves with grief!',
        'Two thefts, precious. Two! First one, then another — wicked, horrible commanderses!',
        'We counts on our fingerses, precious — two. Two stolen positionses. We hatesss them.',
        'Not once but twice! Sneaking up behind us and taking what is ourses!',
      ],
      [
        'Three... three thievses, precious! We hatesss them, we does!',
        'Three times stolen from! Three! Is nothing sacred, precious?',
        'They comes and they steals, precious — three precious positionses, just gone!',
        'Three thefts! Our trophy case is looking very empty, precious. Very empty indeed.',
        'First, second, third — all of them stolen! Three times, precious, THREE!',
      ],
      [
        'Four timeses they stealses from us! Mean and horrible! Cruelses, like Baggins!',
        'Four precious trophies stolen! We remembers each one, precious. Each terrible theft!',
        'We counts them on our fingerses — four! Four times they takes from us!',
      ],
      [
        'FIVE! We is counting, precious — five precious positions, all gone! NASTY THIEVSES!',
        'Five stolen positionses! Is we cursed, precious? Is the world against us?',
        'Five times, precious! Five! They just keeps coming and stealing! Wicked!',
      ],
      [
        'Six! Six precious positions stolen! We is overwhelmed with griefs, precious!',
        'Half a dozen thefts, precious! We is drowning in sorrowses!',
        'Six thievses! Too many to bear, precious, too many!',
      ],
      [
        "Seven times! SEVEN! We doesn't even wantsss to count anymore, precious!",
        'Seven precious trophies, all gone! What did we do to deserve this, precious?',
        'They stealses seven times from us! SEVEN! Is nothing sacred?',
      ],
      [
        'Eight precious positionses, gone forever! They is destroying us!',
        'Eight thefts, precious... eight! We is losing our mind!',
        'Counted to eight, we has. Eight times stolen! Wicked, horrible commanderses!',
      ],
      [
        'Nine thefts, precious... nine! We is running out of words for how much we hatesss them...',
        'Nine times they does it! Nine! Soon there will be nothing left for us, precious!',
        'Almost ten, precious! Nine stolen positionses! The pain, the griefs!',
      ],
      [
        'SO MANY PRECIOUS POSITIONSES STOLEN! We loses count, precious. We gives up. They winsss.',
        'Too many to counts, precious! Our trophy case is empty! They takes everything!',
        'We hates them all, precious! So many thievses! Forever will we remembers this!',
      ],
    ],
    rogueQuotes: {
      many: (name) => ` Especially that wicked <strong>${esc(name)}</strong>! We hatesss <strong>${esc(name)}</strong> most of all, precious!`,
      few: (name) => ` That nasty <strong>${esc(name)}</strong>, precious — always them!`,
    }
  },

  cartman: {
    heading: 'Respect my authoritah! 😡',
    quotes: [
      'I got them ALL back! Every single one! You guys thought you could steal from me? SCREW YOU GUYS!',
      [
        'Are you SERIOUS right now? Someone stole my trophy? That is SO not cool!',
        'ONE trophy stolen! Screw you guys! This is seriously weak!',
        'Oh my God, they took my position! You bastards!',
        'What the hell?! I had that spot and some asshole took it from me!',
        'This is bullcrap! ONE trophy gone and I am seriously pissed off right now!',
      ],
      [
        'TWO trophies?! TWO?! That is IT! I am going to kick someone in the nuts!',
        'Oh, real mature guys. Steal from me TWICE. You will ALL respect my authority!',
        'Two times! Seriously?! What is wrong with you people?!',
        'This is such CRAP! Two of my trophies, just GONE!',
        'TWO stolen positions! I swear to God I will get you guys back for this!',
      ],
      [
        'Three trophies stolen! THREE! That is seriously not cool you guys!',
        'Oh my God! Three times?! I am going to lose my mind here!',
        'Three thefts! What am I, running a charity here?! SCREW YOU GUYS!',
        'Seriously?! Three positions stolen?! You will ALL pay for this!',
        'This is ridiculous! Three trophies gone! I am so seriously pissed right now!',
      ],
      [
        'FOUR stolen trophies! That is IT! No more Mister Nice Guy! You guys are all assholes!',
        'Oh my God, FOUR?! What is this, pick on Cartman day?! WEAK!',
        'Four times! This is seriously getting old! I am going to kick ALL your asses!',
      ],
      [
        'FIVE?! FIVE TROPHIES?! Oh that is IT! I am going to go home and complain about this SO HARD!',
        'Five stolen positions! This is such BS! You will ALL respect my authority!',
        'FIVE! Are you freaking KIDDING me right now?! I hate you guys!',
      ],
      [
        'Six trophies stolen! This is such BULLCRAP! I hate you guys SO much right now!',
        'Oh my God, SIX?! That is IT! No more playing nice! WAR is declared!',
        'Six thefts! What am I, a joke to you guys?! This is seriously messed up!',
      ],
      [
        'SEVEN times?! SERIOUSLY?! Whatever! I do what I want anyway! ...But this still sucks!',
        'Seven stolen trophies! SEVEN! You guys are SO gonna pay for this!',
        'Oh, real nice! Seven times! I hope you\'re all proud of yourselves!',
      ],
      [
        'Eight stolen trophies! That is IT! You guys are the worst! THE WORST!',
        'EIGHT?! How is this even happening?! This is such total crap!',
        'Eight times stolen from! I am SO mad right now I could just... ARGH!',
      ],
      [
        'Nine thefts?! Oh my God, just leave me ALONE already! This is so totally weak!',
        'NINE! That\'s it, I quit! ...No I don\'t, but I am SERIOUSLY pissed!',
        'Nine stolen positions! You guys SUCK! All of you! THE WORST!',
      ],
      [
        'SO MANY STOLEN TROPHIES! SCREW YOU GUYS, I\'M GOING HOME! ...Actually no, I\'m staying, but I am SUPER MAD!',
        'I can\'t even COUNT how many times you\'ve stolen from me! This is BULLCRAP!',
        'Too many thefts! WAY too many! Whatever! I don\'t even care anymore!',
      ],
    ],
    rogueQuotes: {
      many: (name) => ` And <strong>${esc(name)}</strong>! Oh my God, <strong>${esc(name)}</strong> is the WORST! I hate them SO MUCH!`,
      few: (name) => ` Especially that asshole <strong>${esc(name)}</strong>! Seriously, <strong>${esc(name)}</strong>, screw you!`,
    }
  },

  yoda: {
    heading: 'Stolen, my trophies have been! 🏆⚔️',
    quotes: [
      'Reclaimed them all, I have! Hmm. Strong in the Force, my resolve was. Defeated, the thieves are!',
      [
        'Stolen from me, one trophy was. Disturbing, this is. Hmm.',
        'Lost one position, I have. A great disturbance in the Force, I sense.',
        'One theft... patience, I must have. Return, it will. Or not. Hmm.',
        'Taken it was, yes. One precious trophy. Anger leads to suffering, but annoyed I am!',
        'Gone, my first place is. Stolen by another. The dark side, I sense in this.',
      ],
      [
        'Two times stolen from me! Strong with the dark side, these thieves are.',
        'Twice they strike! Powerful, their speed is. Troubling, this pattern becomes.',
        'Two positions lost. Train harder, I must. Yes. Hmmm.',
        'Count them I do — one, two. Two thefts! The Force, unbalanced it is.',
        'Stolen twice from me, they have. Much anger, this causes. Control it, I must... but difficult it is!',
      ],
      [
        'Three trophies gone. A pattern, I sense. The dark side grows stronger.',
        'Three times! Three! Troubling this is. Hmm. Patience wears thin, mine does.',
        'Lost three positions, I have. To the dark side, these commanderses belong, yes.',
        'Theft, theft, theft — three times it happens. When nine hundred years old you reach, this frustration you will understand!',
        'Three stolen from me. Much to learn, these thieves still have... but fast they are. Hmm.',
      ],
      [
        'Four thefts, there are. No more, no less. A Sith Lord, this thief could be! Troubling, yes.',
        'Four positions lost. Always in motion, the future is. But stolen, my past glories are!',
        'Count to four, I can. Four thefts! Train harder, I must. Yes. Hmmm.',
      ],
      [
        'Five positions lost! Strong, the dark side is in these races. Meditate on this, I must.',
        'Five times stolen from me! Much to learn, I still have. Or faster ships, I need. Hmm.',
        'Five thefts, there are. Patience, I am losing. The Jedi way, this anger is not!',
      ],
      [
        'Six times stolen from! The Force, it abandons me. Or focus more, I must. Difficult to say.',
        'Six losses to thieves. When nine hundred years old you reach, accept defeat easier you will not!',
        'Half dozen thefts! Much disturbance in the Force, this causes. Troubling, yes.',
      ],
      [
        'Seven thefts! When nine hundred years old you reach, remember every stolen trophy, you will. Hmm!',
        'Seven times they strike! A pattern, I sense. The dark side, strong it is in these pilots.',
        'Lucky number seven, this is not! Unlucky, more like. Frustrating, these thefts are!',
      ],
      [
        'Eight losses to thieves. Size matters not... but speed matters. MUCH speed matters! Yes.',
        'Eight stolen positions! Do or do not, there is no try... but trying, I am! Still losing, I am!',
        'Count to eight, I must. One, two, three... hmm, lost my place. Too many thefts, there are!',
      ],
      [
        'Nine stolen trophies. Clouded, the future is. Return them, I shall... or die trying, I will. Hmm.',
        'Nine thefts! Nearly ten! Control, control... you must learn control! But angry, I am!',
        'Three times three equals nine. Mathematical, I am... and frustrated! Much speed, these thieves have!',
      ],
      [
        'So many thefts! Lost count, I have. Too old for this, I am. Retire to Dagobah, perhaps I should. Yes, hmm.',
        'Countless, the thefts are! In the swamp, hide I should. Fewer thieves there would be!',
        'Many, many stolen positions! The dark side, everywhere it is! Much fear, this brings. Much anger!',
      ],
    ],
    rogueQuotes: {
      many: (name) => ` Especially <strong>${esc(name)}</strong>, yes! Strong with theft, this one is. Fear leads to anger, anger leads to hate, and hate <strong>${esc(name)}</strong>, I do!`,
      few: (name) => ` Beware of <strong>${esc(name)}</strong>, you must. Twice they strike. The dark side, strong in this one it is.`,
    }
  },
};

function renderThievses(thefts) {
  const posLabel = { 1: 'Gold', 2: 'Silver', 3: 'Bronze' };
  const posCls   = { 1: 'theft-pos-1', 2: 'theft-pos-2', 3: 'theft-pos-3' };

  // Count only truly active thefts (not reclaimed, redeemed, or lost by thief) for the character quotes
  const activeThefts = thefts.filter(t => !t.reclaimed && !t.redeemed && !t.thief_lost);

  // Find the most prolific thief (among active thefts only)
  const counts = {};
  activeThefts.forEach(t => { if (t.thief_name) counts[t.thief_name] = (counts[t.thief_name] || 0) + 1; });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const rogue      = sorted.length && sorted[0][1] >= 2 ? sorted[0][0] : null;
  const rogueCount = rogue ? sorted[0][1] : 0;

  // Randomly select a character personality
  const characterKeys = Object.keys(THIEVSES_CHARACTERS);
  const selectedKey = characterKeys[Math.floor(Math.random() * characterKeys.length)];
  const character = THIEVSES_CHARACTERS[selectedKey];

  const n = activeThefts.length;
  const raw = character.quotes[Math.min(n, 10)];
  let quote = Array.isArray(raw) ? raw[Math.floor(Math.random() * raw.length)] : raw;

  // Add rogue thief quote if applicable
  if (rogue) {
    const rogueQuote = rogueCount >= 3 ? character.rogueQuotes.many : character.rogueQuotes.few;
    quote += rogueQuote(rogue);
  }

  const rows = thefts.map(t => {
    const cls   = posCls[t.stolen_position] ?? '';
    const label = posLabel[t.stolen_position] ?? `P${t.stolen_position}`;
    const thief = t.thief_name
      ? `<a href="/cmdr/${encodeURIComponent(t.thief_name)}">${esc(t.thief_name)}</a>`
      : '<span class="muted">unknown CMDR</span>';

    let statusBadge = '';
    if (t.reclaimed) {
      statusBadge = '<span class="reclaimed-badge" title="Trophy reclaimed!">🏆 Reclaimed</span>';
    } else if (t.redeemed) {
      statusBadge = '<span class="redeemed-badge" title="Thief lost the trophy and you\'re ahead of them now!">✨ Redeemed</span>';
    } else if (t.thief_lost) {
      statusBadge = '<span class="thief-lost-badge" title="Thief no longer holds this trophy">📉 Dropped</span>';
    }

    const rowClass = t.reclaimed ? 'reclaimed-theft' : (t.redeemed ? 'redeemed-theft' : (t.thief_lost ? 'thief-lost-theft' : ''));

    return `
      <tr class="${rowClass}">
        <td class="num ${cls}">${label}</td>
        <td>CMDR ${thief}</td>
        <td><a href="/race/${encodeURIComponent(t.race_key)}">${esc(t.race_name)}</a></td>
        <td class="muted">${relativeTime(t.stolen_at)}</td>
        <td>${statusBadge}</td>
      </tr>`;
  }).join('');

  return `
    <div class="thievses-section">
      <h2 class="cmdr-section-heading">${character.heading}</h2>
      <p class="thievses-gollum">${quote}</p>
      <table class="results-table">
        <thead><tr>
          <th class="num">Lost</th><th>Stolen by</th><th>Race</th><th>When</th><th>Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Nearby Races (NENDY + NEIDY) ───────────────────────────────────────────
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

// ── Autocomplete ─────────────────────────────────────────────────────────────
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
  if (e.key === 'Enter')  { hideSuggestions(); nearbyFind(); return; }
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
      e.preventDefault();
      nendyInput.value = names[i];
      hideSuggestions();
      nearbyFind();
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

// ── Tab switching ─────────────────────────────────────────────────────────────
const nearbyTabsEl  = document.getElementById('nearby-tabs');
const neidyPanel    = document.getElementById('neidy-panel');
const nendyPanel    = document.getElementById('nendy-panel');
const neidyResults  = document.getElementById('neidy-results');
const nendyResults  = document.getElementById('nendy-results');
const neidyFiltersEl  = document.getElementById('neidy-filters');
const nendyFiltersEl  = document.getElementById('nendy-filters');

document.getElementById('tab-neidy').addEventListener('click', () => switchTab('neidy'));
document.getElementById('tab-nendy').addEventListener('click', () => switchTab('nendy'));

function switchTab(tab) {
  document.getElementById('tab-neidy').classList.toggle('active', tab === 'neidy');
  document.getElementById('tab-nendy').classList.toggle('active', tab === 'nendy');
  neidyPanel.style.display = tab === 'neidy' ? '' : 'none';
  nendyPanel.style.display = tab === 'nendy' ? '' : 'none';
}

// ── NEIDY filters ─────────────────────────────────────────────────────────────
document.getElementById('neidy-type-btns').addEventListener('click', e => {
  const btn = e.target.closest('[data-type]');
  if (!btn) return;
  neidyTypeFilter = btn.dataset.type;
  document.querySelectorAll('#neidy-type-btns .btn-toggle').forEach(b => b.classList.toggle('active', b === btn));
  applyNeidyFilters();
});

document.getElementById('neidy-dist-btns').addEventListener('click', e => {
  const btn = e.target.closest('[data-dist]');
  if (!btn) return;
  neidyDistFilter = Number(btn.dataset.dist);
  document.querySelectorAll('#neidy-dist-btns .btn-toggle').forEach(b => b.classList.toggle('active', b === btn));
  applyNeidyFilters();
});

document.getElementById('nendy-type-btns').addEventListener('click', e => {
  const btn = e.target.closest('[data-type]');
  if (!btn) return;
  nendyTypeFilter = btn.dataset.type;
  document.querySelectorAll('#nendy-type-btns .btn-toggle').forEach(b => b.classList.toggle('active', b === btn));
  applyNendyFilters();
});

document.getElementById('nendy-dist-btns').addEventListener('click', e => {
  const btn = e.target.closest('[data-dist]');
  if (!btn) return;
  nendyDistFilter = Number(btn.dataset.dist);
  document.querySelectorAll('#nendy-dist-btns .btn-toggle').forEach(b => b.classList.toggle('active', b === btn));
  applyNendyFilters();
});

function applyNendyFilters() {
  if (!nendyUndoneCache) return;

  let filtered = nendyUndoneCache;
  if (nendyTypeFilter) filtered = filtered.filter(r => r.type === nendyTypeFilter);
  if (nendyDistFilter) filtered = filtered.filter(r => r.dist !== Infinity && r.dist <= nendyDistFilter);

  if (filtered.length === 0) {
    nendyResults.innerHTML = `<p class="empty-state">No races match the current filters.</p>`;
    return;
  }

  const top       = filtered.slice(0, 15);
  const remaining = filtered.length - top.length;

  const rows = top.map((r, i) => {
    const distStr = r.dist === Infinity
      ? '<span class="muted">\u2014</span>'
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

  const totalNote = filtered.length < nendyUndoneCache.length
    ? `${filtered.length} of ${nendyUndoneCache.length} undone races`
    : `${nendyUndoneCache.length} undone race${nendyUndoneCache.length !== 1 ? 's' : ''}`;

  const moreNote = remaining > 0
    ? `<p class="nendy-more">\u2026 and ${remaining} more undone race${remaining !== 1 ? 's' : ''} further away.</p>`
    : '';

  nendyResults.innerHTML = `
    <p class="nendy-origin">From <strong>${esc(nendySourceSystem)}</strong> \u2014 ${totalNote}</p>
    <table class="results-table">
      <thead><tr>
        <th class="num">#</th><th>Race</th><th>Type</th><th>System</th><th class="num">Distance</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${moreNote}`;
}

function applyNeidyFilters() {
  if (!neidyScoredCache) return;

  let filtered = neidyScoredCache;
  if (neidyTypeFilter) filtered = filtered.filter(s => s.race.type === neidyTypeFilter);
  if (neidyDistFilter) filtered = filtered.filter(s => s.race.dist !== Infinity && s.race.dist <= neidyDistFilter);

  if (filtered.length === 0) {
    neidyResults.innerHTML = `<p class="empty-state">No races match the current filters.</p>`;
    return;
  }

  const rows = filtered.map((s, i) => {
    const distStr = s.race.dist === Infinity
      ? '<span class="muted">—</span>'
      : (s.race.dist < 1 ? '&lt;1 ly' : `${Math.round(s.race.dist).toLocaleString()} ly`);
    const gapStr  = s.gapMs != null ? formatTime(s.gapMs) : '—';
    const leapStr = s.leapable > 0 ? `+${s.leapable}` : '—';
    const barPct  = Math.max(0, Math.min(100, Math.round((1 - Math.max(0, s.score + 0.1) / 0.6) * 100)));
    return `
      <tr>
        <td class="num muted">${i + 1}</td>
        <td><a href="/race/${encodeURIComponent(s.race.key)}">${esc(s.race.name)}</a></td>
        <td>${typeBadge(s.race.type)}</td>
        <td class="num">${ordinal(s.myPos)} / ${s.total}</td>
        <td class="num neidy-gap">${gapStr}</td>
        <td class="num neidy-leap">${leapStr}</td>
        <td class="num">${distStr}</td>
        <td class="neidy-bar-cell"><div class="neidy-bar"><div class="neidy-bar-fill" style="width:${barPct}%"></div></div></td>
      </tr>`;
  }).join('');

  const countNote = filtered.length < neidyScoredCache.length
    ? `showing ${filtered.length} of ${neidyScoredCache.length}`
    : `${neidyScoredCache.length} race${neidyScoredCache.length !== 1 ? 's' : ''}`;

  neidyResults.innerHTML = `
    <p class="nendy-origin">From <strong>${esc(neidySourceSystem)}</strong> — ${countNote}, sorted by catchability</p>
    <p class="neidy-legend">
      <span class="neidy-legend-item"><strong>Gap</strong> time between you and the position above</span>
      <span class="neidy-legend-item"><strong>Leap</strong> positions you'd gain with a 10% faster time</span>
    </p>
    <table class="results-table">
      <thead><tr>
        <th class="num">#</th><th>Race</th><th>Type</th><th class="num">Position</th>
        <th class="num">Gap</th><th class="num">Leap</th><th class="num">Distance</th><th>Catchability</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Catchability score ────────────────────────────────────────────────────────
// Lower score = better opportunity.
// Factors:
//   gapPct    — gap to the person directly above as % of cmdr's time (lower = closer to beating them)
//   leapable  — number of positions catchable with a 10% time improvement (more = bigger payoff)
//   percentile — higher % position = more room to improve (converted from % beaten in backend)
function catchabilityScore(myTime, myPos, results) {
  // Gap to person above
  const above = results.find(r => r.position === myPos - 1);
  const gapPct = above ? (myTime - above.time_ms) / myTime : 0;

  // How many positions could be gained with a 10% faster time
  const improved = myTime * 0.90;
  const leapable = results.filter(r => r.position < myPos && r.time_ms >= improved).length;

  // Weighted score: prioritise small gap but also reward high-leapable races
  // score = gapPct - (leapable * 0.02) — lower is better catchability
  return gapPct - leapable * 0.02;
}

// ── Main find ─────────────────────────────────────────────────────────────────
async function nearbyFind() {
  const systemName = nendyInput.value.trim();
  if (!systemName) return;

  localStorage.setItem('tt_nendy_system', systemName);

  neidyResults.innerHTML = '<p class="empty-state">Looking up system…</p>';
  nendyResults.innerHTML = '';
  nendyFindBtn.disabled = true;
  nearbyTabsEl.style.display = 'none';
  neidyFiltersEl.style.display = 'none';
  neidyScoredCache = null;
  nendyFiltersEl.style.display = 'none';
  nendyUndoneCache = null;

  let resolvedName, x, y, z;
  try {
    const coordsRes = await fetch(`/api/system-coords?name=${encodeURIComponent(systemName)}`);
    if (coordsRes.status === 404) {
      neidyResults.innerHTML = `<p class="empty-state">System "<strong>${esc(systemName)}</strong>" not found. Check the spelling.</p>`;
      return;
    }
    if (!coordsRes.ok) throw new Error('EDSM lookup failed');
    ({ name: resolvedName, x, y, z } = await coordsRes.json());
  } catch (err) {
    neidyResults.innerHTML = `<p class="empty-state">Error: ${esc(String(err))}</p>`;
    nendyFindBtn.disabled = false;
    return;
  }

  const allRaces = await fetchAllRaces();
  const doneKeys = new Set((stats?.races ?? []).map(r => r.key));

  // Attach distances to all races
  function withDist(r) {
    if (r.coords) {
      const parts = r.coords.split(',').map(v => Number(v.trim()));
      if (parts.length === 3 && !parts.some(isNaN)) {
        const [rx, ry, rz] = parts;
        return { ...r, dist: Math.sqrt((rx - x) ** 2 + (ry - y) ** 2 + (rz - z) ** 2) };
      }
    }
    return { ...r, dist: Infinity };
  }

  // ── NENDY (not done) ─────────────────────────────────────────────────────
  const undone = allRaces
    .filter(r => !doneKeys.has(r.key))
    .map(withDist)
    .sort((a, b) => a.dist - b.dist);
  renderNendy(resolvedName, undone);

  // ── NEIDY (done, nearby, fetch full results) ──────────────────────────────
  const NEIDY_LIMIT = 20; // fetch up to this many nearby done races
  const done = allRaces
    .filter(r => doneKeys.has(r.key))
    .map(withDist)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, NEIDY_LIMIT);

  neidyResults.innerHTML = `<p class="empty-state">Analysing ${done.length} nearby races…</p>`;

  // Fetch full results in parallel, max 5 at a time to be polite
  const raceDetails = [];
  for (let i = 0; i < done.length; i += 5) {
    const batch = done.slice(i, i + 5);
    const fetched = await Promise.all(
      batch.map(r => fetch(`/api/races/${encodeURIComponent(r.key)}`).then(res => res.ok ? res.json() : null))
    );
    raceDetails.push(...fetched);
  }

  nearbyTabsEl.style.display = '';
  renderNeidy(resolvedName, done, raceDetails);
  nendyFindBtn.disabled = false;
}

function renderNendy(resolvedName, undone) {
  if (undone.length === 0) {
    nendyFiltersEl.style.display = 'none';
    nendyResults.innerHTML = `<p class="empty-state">${isSelf ? "You've" : 'This commander has'} done every race \u2014 nothing left to find!</p>`;
    return;
  }

  nendyUndoneCache  = undone;
  nendySourceSystem = resolvedName;
  nendyFiltersEl.style.display = '';
  applyNendyFilters();
}

function renderNeidy(resolvedName, done, raceDetails) {
  // Build scored list
  const scored = [];
  for (let i = 0; i < done.length; i++) {
    const race = done[i];
    const detail = raceDetails[i];
    if (!detail?.results?.length) continue;

    const cmdrResult = detail.results.find(r => r.name.toUpperCase() === cmdrName.toUpperCase());
    if (!cmdrResult) continue;

    const myPos  = cmdrResult.position;
    const myTime = cmdrResult.time_ms;
    const total  = detail.results.length;

    if (myPos === 1) continue; // already at the top, skip

    const score   = catchabilityScore(myTime, myPos, detail.results);
    const above   = detail.results.find(r => r.position === myPos - 1);
    const gapMs   = above ? myTime - above.time_ms : null;

    // Positions catchable with 10% improvement
    const improved  = myTime * 0.90;
    const leapable  = detail.results.filter(r => r.position < myPos && r.time_ms >= improved).length;

    scored.push({ race, myPos, myTime, total, score, gapMs, leapable, above });
  }

  if (scored.length === 0) {
    neidyFiltersEl.style.display = 'none';
    neidyResults.innerHTML = `<p class="empty-state">No improvement data available for nearby races.</p>`;
    return;
  }

  // Lower score = better opportunity
  scored.sort((a, b) => a.score - b.score);

  // Cache for filter re-use
  neidyScoredCache  = scored;
  neidySourceSystem = resolvedName;
  neidyFiltersEl.style.display = '';
  applyNeidyFilters();
}

init();
