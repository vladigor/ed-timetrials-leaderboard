import { esc } from './utils.js';

const challengesContainer = document.getElementById('challenges-container');
const noCmdrSection = document.getElementById('challenges-no-cmdr');
const summaryBar = document.getElementById('challenges-summary');

const modalOverlay = document.getElementById('challenge-modal-overlay');
const modalCloseBtn = document.getElementById('challenge-modal-close');
const modalTitle = document.getElementById('challenge-modal-title');
const modalSubtitle = document.getElementById('challenge-modal-subtitle');
const modalList = document.getElementById('challenge-modal-list');

const challengeById = new Map();
let hideCompleted = localStorage.getItem('tt_filter_hide_completed') === '1';
let allChallenges = [];

const ENGINEER_SYSTEMS = [
  'ACHENAR', 'ALIOTH', 'ARQUE', 'ASURA', 'BETA-3 TUCANI', 'DECIAT', 'EURYBIA', 'GIRYAK',
  'KHUN', 'KUK', 'KUWEMAKI', 'LAKSAK', 'LEESTI', 'LOS', 'MEENE', 'MUANG', 'ORISHIS',
  'SHINRARTA DEZHRA', 'SIRIUS', 'SIRIS', 'SOL', 'SHENVE', 'TIR', 'WOLF 397', 'WYRD', 'YORU'
];

const PERMIT_SYSTEMS = [
  'ACHENAR', 'ALIOTH', 'BETA HYDRI', 'CD-43 11917', 'CROM', 'EXBEUR', 'FACECE', 'HODACK',
  'HORS', 'ISINOR', 'JAROUA', 'JOTUN', 'LTT 198', 'LUYTEN 347-14', 'MBOONI', 'NASTROND',
  'PEREGRINA', 'PI MENSAE', 'PLX 695', 'ROSS 128', 'SHINRARTA DEZHRA', 'SIRIUS', 'SOL',
  'SUMMERLAND', 'TERRA MATER', 'TILIALA', "VAN MAANEN'S STAR", 'VANAYEQUI', 'VEGA'
];

const TITAN_CUP_3311 = [
  "Bustos's Canyon",
  'Raijin Rumble',
  'Taranis Tussle',
  'The Fort Asch SRV circuit (1 pip, 3 x laps)',
  'The Wregoe Battlefield (SRV 38km)'
];

const WINTER_OLYMPICS_3310 = [
  'Cayley SRV Road Circuit - 2 lap',
  'Skiff Survey SRV Parkour',
  'Carrasco Canyon'
];

const MOUNTAIN_GROUPS = [
  ['Argon Ice Climb', 'Argon Ice Descent'],
  ['DW3 Rendezvous Rally 4 pt. 1: The Climb', 'DW3 Rendezvous Rally 4 pt. 2: The Descent'],
  ['DW3 Syrenthis Verge mountain climb', 'DW3 Syrenthis Verge mountain descent'],
  ['The Camp Bucky hill climb'],
  ['The Kumay Chimney Stacks'],
  ['The Distant Worlds 3 HQ Crater Cross'],
  ['Kawasaki Town Down and Back'],
  ['Kawasaki Town Uphill Battle', 'Kawasaki Town Downhill Dash'],

];

const SNAKE_SHIPS = [
  'Viper Mark III', 'Viper Mark IV', 'Cobra Mark V', 'Cobra Mark IV', 'Cobra Mark III',
  'Sidewinder Mark 1', 'Diamondback Explorer', 'Diamondback Scout', 'Asp Explorer', 'Asp Scout',
  'Adder', 'Krait Phantom', 'Krait Mark II', 'Mamba', 'Python', 'Python Mark II', 'Keelback',
  'Mandalay', 'Fer-de-lance', 'Anaconda'
];

async function init() {
  const selectedCmdr = localStorage.getItem('tt_filter_cmdr') || '';
  if (!selectedCmdr) {
    noCmdrSection.style.display = '';
    challengesContainer.innerHTML = '';
    return;
  }

  try {
    const [cmdrRes, racesRes] = await Promise.all([
      fetch(`/api/cmdr/${encodeURIComponent(selectedCmdr)}`),
      fetch(`/api/races?commander_pos=${encodeURIComponent(selectedCmdr)}`),
    ]);

    if (!cmdrRes.ok || !racesRes.ok) {
      throw new Error('Failed to load data');
    }

    const cmdrStats = await cmdrRes.json();
    const allRaces = await racesRes.json();

    allChallenges = buildChallenges(cmdrStats, allRaces);
    renderSummary(allChallenges);
    renderChallenges(allChallenges);
    bindModal();
    bindFilterControls();
  } catch (_) {
    challengesContainer.innerHTML = '<p class="empty-state">Could not load challenges right now.</p>';
  }
}

function buildChallenges(cmdrStats, allRaces) {
  const doneRaces = cmdrStats.races || [];
  const doneKeySet = new Set(doneRaces.map(r => r.key));
  const doneNames = doneRaces.map(r => r.race_name || '');
  const allDoneNameNormSet = new Set(doneNames.map(normalise));

  const challenges = [
    challengeNamedAndMatchingPercent(
      'alcoholic',
      'I\'m Not As Think As You Drunk I Am',
      'Do a booze cruise, Broo\'s cruise, and every race that ends at a bar',
      [
      'The Light of the Galaxy',
      "Broo's cruise",
      ],
      ['bar dash'],
      doneRaces,
      allRaces
    ),

    challengeContainsNameBool(
      'cant-park-there-mate',
      "You Can't Park There Mate",
      'Race at The Light of the Galaxy',
      'the light of the galaxy',
      doneRaces,
      allRaces
    ),

    challengeSystemCoverage('souped-up-racer', 'The Torque of the Galaxy', 'Complete every race in engineer inhabited systems', ENGINEER_SYSTEMS, doneKeySet, allRaces),

    challengeSystemCoverage('multipass', 'Multipass?', 'Complete every race in permit-locked systems', PERMIT_SYSTEMS, doneKeySet, allRaces),

    challengeBool(
      'guardian-slf',
      "I'll Try Spinning - That's a Good Trick!",
      'Set a PB in a Guardian SLF',
      doneRaces.some(r => String(r.type || '').toUpperCase() === 'FIGHTER' && containsAny(r.ship, ['Lance', 'Javelin', 'Trident'])),
      racesFromDonePredicate(doneRaces, r => String(r.type || '').toUpperCase() === 'FIGHTER' && containsAny(r.ship, ['Lance', 'Javelin', 'Trident']))
    ),

    challengeContainsNameBool('hole-in-one', 'Hole in One', 'Use your SRV as a golf ball', 'golf', doneRaces, allRaces),
    challengeContainsNameBool('squeaky-clean', 'Squeaky Clean', 'Clean the muck off your SRV using a geyser', 'geyser', doneRaces, allRaces),

    challengeCounterPercent('rookie-numbers', 'Those Are Rookie Numbers', 'Complete at least 50 races', doneRaces.length, 50),

    challengePositionCount(
      'always-the-bridesmaid',
      'Always the bridesmaid',
      'Be in 4th place in at least 4 races',
      4,
      4,
      doneRaces
    ),

    challengeBool(
      'unfair-horizons',
      'I\'m sorry, Dave. I\'m afraid I can\'t do that',
      'Set a time in an inactive or legacy Horizons race',
      doneRaces.some(r => {
        const race = allRaces.find(a => a.key === r.key);
        if (!race) return false;
        return hasTag(race, 'Inactive') || String(race.version || '').toUpperCase() === 'HORIZONS';
      }),
      racesFromDonePredicate(doneRaces, r => {
        const race = allRaces.find(a => a.key === r.key);
        if (!race) return false;
        return hasTag(race, 'Inactive') || String(race.version || '').toUpperCase() === 'HORIZONS';
      })
    ),

    challengeContainsAnyNamePercent(
      'rallying-to-new-heights',
      "Rallying to new heights",
      'Compete in every DW3 rendezvous rally',
      ['dw3 rendezvous rally', 'dws rendezvous rally'],
      doneKeySet,
      allRaces
    ),

    challengeContainsNameOrDescriptionPercent(
      'inspired',
      'I\'ve seen things you people wouldn\'t believe',
      'Race at Thargoid spire sites',
      'thargoid spire',
      doneKeySet,
      allRaces,
      ['Indra Spire Site Scramble']
    ),

    challengeContainsAnyNameOrDescriptionCountPercent(
      'guardians-of-the-galaxy',
      'Guardians of the galaxy',
      'Visit 3 Guardian sites',
      ['Guardians', 'Guardian ruin', 'Guardian site'],
      3,
      doneKeySet,
      allRaces
    ),

    challengeContainsNameOrDescriptionPercent(
      'supermassive-blackhole-and-back',
      'I love you to the supermassive blackhole and back',
      'Race to the Void Hearts',
      'voidhearts',
      doneKeySet,
      allRaces
    ),

    challengeConstraintBool(
      'space-is-big',
      "Space is big. You just won't believe how vastly, hugely, mind-bogglingly big it is",
      'Complete "DW3 The Race" or a planetary circumnavigation',
      allRaces,
      doneKeySet,
      (race) => {
        const nameText = normalise(race.name || '');
        const descriptionText = normalise(race.description || '');
        return nameText === normalise('DW3 The Race')
          || nameText.includes(normalise('circumnavigation'))
          || descriptionText.includes(normalise('circumnavigation'));
      }
    ),

    challengeConstraintBool(
      'goddammit-donut',
      'Goddammit Donut!',
      'Complete a motordrome or death wall circuit',
      allRaces,
      doneKeySet,
      (race) => {
        if (!isActive(race)) return false;
        const nameText = normalise(race.name || '');
        const descriptionText = normalise(race.description || '');
        return nameText.includes(normalise('motordrome'))
          || descriptionText.includes(normalise('motordrome'))
          || nameText.includes(normalise('death wall'))
          || descriptionText.includes(normalise('death wall'))
          || nameText.includes(normalise('wall of death'))
          || descriptionText.includes(normalise('wall of death'));
      }
    ),

    challengeConstraintBool(
      'womp-rats-speedball',
      "It's not impossible. I used to bullseye womp rats in my T-16 back home, they're not much bigger than two meters",
      'Complete a speedbowling race',
      allRaces,
      doneKeySet,
      (race) => {
        if (!isActive(race)) return false;
        const nameText = normalise(race.name || '');
        const descriptionText = normalise(race.description || '');
        return nameText.includes(normalise('speedbowl'))
          || descriptionText.includes(normalise('speedbowl'));
      }
    ),

    challengeTaggedPercent(
      'dw3-completionist',
      'Oh great. Yet another place to add to our ever-growing list of places with no Wi-Fi',
      'Finish every DW3 race',
      'DW3',
      doneKeySet,
      allRaces,
      false,
      ['DW3 - The Race', 'DW3 The Race']
    ),

    challengeFixedSetPercent('titan-cup-3311', 'The 3311 Titan Cup', 'Relive the 3311 Titan Cup races that are available as time trials', TITAN_CUP_3311, doneRaces, allRaces),
    challengeFixedSetPercent('winter-olympics-3310', 'The 3310 Winter Olympics', 'Relive the 3310 Winter Olympics races that are available as time trials', WINTER_OLYMPICS_3310, doneRaces, allRaces),

    challengeContainsAnyNamePercent(
      'rooftop-parkour',
      'Hey! Get Down from There!',
      'Complete every rooftop and parkour race',
      ['rooftop', 'parkour'],
      doneKeySet,
      allRaces
    ),

    challengeContainsNameOrDescriptionPercent(
      'penal-colonies',
      'One Piece at a Time',
      'Complete every penal colony race',
      'penal',
      doneKeySet,
      allRaces
    ),

    challengeConstraintBool(
      'jedi-reflexes',
      'You must have Jedi reflexes if you race pods',
      'Take part in a pod race',
      allRaces,
      doneKeySet,
      (race) => {
        if (!isActive(race)) return false;
        const nameText = normalise(race.name || '');
        const descriptionText = normalise(race.description || '');
        return nameText.includes(normalise('pod race')) || nameText.includes(normalise('pod racing')) || descriptionText.includes(normalise('pod race')) || descriptionText.includes(normalise('pod racing'));
      }
    ),

    challengeConstraintCountPercent(
      'gotta-hurt',
      "I don't care what universe you're from. That's gotta hurt!",
      'Dive off the edge of 3 craters',
      allRaces,
      doneKeySet,
      3,
      (race) => {
        if (!isActive(race)) return false;
        const nameText = normalise(race.name || '');
        const descriptionText = normalise(race.description || '');
        const explicitCraterRaces = [
          "Calico's Crater (extreme challenge)",
          'Sitterly Crater Cross',
          'DW3 Stuemeae crater traverse',
        ];
        const isExplicitCraterRace = explicitCraterRaces.some(name => nameText.includes(normalise(name)));
        return isExplicitCraterRace
          || nameText.includes(normalise('dive'))
          || descriptionText.includes(normalise('dive'))
          || nameText.includes(normalise('plung'))
          || descriptionText.includes(normalise('plung'));
      }
    ),

    challengeConstraintBool(
      'ludicrous-speed',
      'No, no, no, light speed is too slow! We\'re gonna have to go right to... Ludicrous Speed!',
      'Complete a multi-system race',
      allRaces,
      doneKeySet,
      (race) => isActive(race) && !!race.multi_system
    ),

    challengeConstraintBool(
      'fly-higher-dead',
      "You fly any higher, you're dead",
      'Complete a low altitude canyon race',
      allRaces,
      doneKeySet,
      (race) => isActive(race) && isCanyonRaceWithLowHeightLimit(race)
    ),

    challengeContainsAnyNameCountPercent(
      'kawasaki',
      'The Ninja Dash',
      'Complete 5 Kawasaki races',
      ['kawasaki'],
      5,
      doneKeySet,
      allRaces
    ),

    challengeConstraintBool(
      'bane-of-my-existence',
      'You are the bane of my existence and the object of all my desires',
      'Complete a race at Bridgerton, err I mean Bridger Town',
      allRaces,
      doneKeySet,
      (race) => normalise(race.system || '') === normalise('Bridger Town')
    ),

    challengeBool(
      'mouth-breather',
      'Mouth Breather',
      'Complete an on-foot race',
      doneRaces.some(r => String(r.type || '').toUpperCase() === 'ONFOOT'),
      racesFromDonePredicate(doneRaces, r => String(r.type || '').toUpperCase() === 'ONFOOT')
    ),

    challengeContainsNameBool('kessel-run', 'Less Than 12 Parsecs', 'Complete the Kessel run in less than 12 parsecs', 'kessel run', doneRaces, allRaces),
    challengeContainsNameBool('bar-dash', 'Shaken, Not Stirred', 'Complete in a race that ends at a bar', 'bar dash', doneRaces, allRaces),

    challengeFixedSetBool('cliffhanger', 'They were so preoccupied with whether or not they *could*, they didn’t stop to think if they *should*', 'Climb a sheer cliff or wall', [
      'NRC Lookout Plunge',
      'Westerfeld Tower Climb (1 lap)',
      "Calico's Crater (extreme challenge)"
    ], doneRaces, allRaces, false),

    challengeBool(
      'wind-of-change',
      'The Wind of Change',
      'Either: Follow the Moskva down to Gorky Park. Or: Finish an SRV race in a Scorpion',
      doneRaces.some(r => String(r.type || '').toUpperCase() === 'SRV' && containsAny(r.ship, ['Scorpion'])),
      racesFromDonePredicate(doneRaces, r => String(r.type || '').toUpperCase() === 'SRV' && containsAny(r.ship, ['Scorpion']))
    ),

    challengeFixedSetBool('lets-go', "Let's Go!", 'Embrace your inner lemming and leap off a mountain.', [
      'Argon Ice Descent',
      'DW3 Rendezvous Rally 4 pt. 2: The Descent',
      'DW3 Syrenthis Verge mountain descent',
      'The Camp Bucky hill climb',
      'The Kumay Chimney Stacks',
      'The Distant Worlds 3 HQ Crater Cross',
      'DW3 Rendezvous Rally 6'
    ], doneRaces, allRaces, false),

    challengeMountainTrip('there-and-back', 'I\'ll Be Back', 'Complete at least one climb/descent mountain route pair', MOUNTAIN_GROUPS, allDoneNameNormSet),

    challengeMountainTripCount('there-and-back-3', 'There and Back Again', 'Complete five different mountain route groups', MOUNTAIN_GROUPS, allDoneNameNormSet, 5),

    challengeSnakeEyes('snake-eyes', 'Snake Eyes', 'Set a PB in 5 different snake ships', doneRaces),

    challengeBool(
      'bigger-fish',
      "There's Always a Bigger Fish",
      'Set a PB in a Dolphin, Orca, or Beluga Liner',
      doneRaces.some(r => containsAny(r.ship, ['Dolphin', 'Orca', 'Beluga'])),
      racesFromDonePredicate(doneRaces, r => containsAny(r.ship, ['Dolphin', 'Orca', 'Beluga']))
    ),

    challengeBool(
      'bigger-boat',
      "We're Gonna Need a Bigger Boat",
      'Set a PB in an Anaconda',
      doneRaces.some(r => containsAny(r.ship, ['Anaconda'])),
      racesFromDonePredicate(doneRaces, r => containsAny(r.ship, ['Anaconda']))
    ),

    challengeLetterE('eeee', 'eeee', 'Complete 4 races that begin with E', doneRaces),
    challengeAlphabet('alphabeteer', 'Alphabeteer', 'Complete races beginning with each letter of the alphabet', doneRaces),

    challengeSystemAreaPercent('colonial-rush', 'Colonial Rush', 'Complete races in Colonia', ['COLONIA', 'TIR'], doneKeySet, allRaces),
    challengeAnyNInSystems('beagle-landed', 'The Beagle Has Landed', 'Complete any 5 races at Beagle Point', ['BEAGLE POINT'], 5, doneKeySet, allRaces),
    challengeAnyNInSystems('black-hole-sun', 'Black Hole Sun', 'Complete any 5 races at Sag A*', ['STUEMEAE EG-Y D4548'], 5, doneKeySet, allRaces),
    challengeAnyNInSystems('speak-friend-enter', 'Speak Friend and Enter', "Complete at least 3 races at Rainbow's End", ['ROEFOO ZE-H D10-0'], 3, doneKeySet, allRaces),

    challengeJetsetter('jetsetter', 'Jetsetter', "Race in Colonia, Beagle Point, Sag A*, and Rainbow's End regions", doneKeySet, allRaces),

    challengeConstraintBool(
      'one-pip-engines',
      'Are We Nearly There Yet?',
      'Compete in a race with 1 pip to engines',
      allRaces,
      doneKeySet,
      (race) => hasConstraintValue(race, 'MaxSRVPips', 2)
    ),

    challengeConstraintBool(
      'no-repairs',
      "You will not break me",
      'Compete in a race with repair penalties',
      allRaces,
      doneKeySet,
      (race) => hasConstraintKey(race, 'NoHullRepair')
    ),
  ];

  return challenges.filter(Boolean);
}

function challengeBool(id, label, description, done, doneRaceItems) {
  return {
    id,
    label,
    description,
    type: 'bool',
    done: !!done,
    progressText: done ? 'Completed' : 'Not completed',
    detailsItems: (doneRaceItems || []).map(toDoneRaceItem),
  };
}

function challengeCounterPercent(id, label, description, count, total) {
  const bounded = Math.min(count, total);
  return {
    id,
    label,
    description,
    type: 'percent',
    count: bounded,
    total,
    percent: Math.round((bounded / total) * 100),
    detailsItems: [],
  };
}

function challengePositionCount(id, label, description, position, targetCount, doneRaces) {
  const matching = doneRaces.filter(r => Number(r.position) === Number(position));
  const bounded = Math.min(matching.length, targetCount);
  return {
    id,
    label,
    description,
    type: 'percent',
    count: bounded,
    total: targetCount,
    percent: Math.round((bounded / targetCount) * 100),
    detailsItems: matching.map(toDoneRaceItem),
  };
}

function challengeContainsNameBool(id, label, description, needle, doneRaces, allRaces) {
  const done = doneRaces.filter(r => normalise(r.race_name).includes(normalise(needle)));
  const matches = allRaces.filter(r => normalise(r.name).includes(normalise(needle)));
  return {
    id,
    label,
    description,
    type: 'bool',
    done: done.length > 0,
    progressText: done.length > 0 ? 'Completed' : 'Not completed',
    detailsItems: toRaceItems(matches, new Set(doneRaces.map(r => r.key))),
  };
}

function challengeContainsAnyNamePercent(id, label, description, needles, doneKeySet, allRaces, includeInactive = false) {
  const required = allRaces.filter(r => {
    const nameMatches = needles.some(n => normalise(r.name).includes(normalise(n)));
    if (!nameMatches) return false;
    if (includeInactive) return true;
    return isActive(r);
  });
  const done = required.filter(r => doneKeySet.has(r.key)).length;
  const total = required.length;
  return {
    id,
    label,
    description,
    type: 'percent',
    count: done,
    total,
    percent: total ? Math.round((done / total) * 100) : 0,
    detailsItems: toRaceItems(required, doneKeySet),
  };
}

function challengeContainsAnyNameCountPercent(id, label, description, needles, targetCount, doneKeySet, allRaces, includeInactive = false) {
  const required = allRaces.filter(r => {
    const nameMatches = needles.some(n => normalise(r.name).includes(normalise(n)));
    if (!nameMatches) return false;
    if (includeInactive) return true;
    return isActive(r);
  });
  const done = required.filter(r => doneKeySet.has(r.key)).length;
  const bounded = Math.min(done, targetCount);
  return {
    id,
    label,
    description,
    type: 'percent',
    count: bounded,
    total: targetCount,
    percent: Math.round((bounded / targetCount) * 100),
    detailsItems: toRaceItems(required, doneKeySet),
  };
}

function challengeContainsAnyNameOrDescriptionCountPercent(id, label, description, needles, targetCount, doneKeySet, allRaces, includeInactive = false) {
  const required = allRaces.filter(r => {
    const nameText = normalise(r.name || '');
    const descriptionText = normalise(r.description || '');
    const matches = needles.some(n => {
      const needle = normalise(n);
      return nameText.includes(needle) || descriptionText.includes(needle);
    });
    if (!matches) return false;
    if (includeInactive) return true;
    return isActive(r);
  });
  const done = required.filter(r => doneKeySet.has(r.key)).length;
  const bounded = Math.min(done, targetCount);
  return {
    id,
    label,
    description,
    type: 'percent',
    count: bounded,
    total: targetCount,
    percent: Math.round((bounded / targetCount) * 100),
    detailsItems: toRaceItems(required, doneKeySet),
  };
}

function challengeContainsNameOrDescriptionPercent(id, label, description, needle, doneKeySet, allRaces, namedRaces = []) {
  const needleNorm = normalise(needle);
  const seenKeys = new Set();
  const required = [];

  // Add specific named races
  for (const raceName of namedRaces) {
    const match = allRaces.find(r => normalise(r.name) === normalise(raceName))
      || allRaces.find(r => normalise(r.name).includes(normalise(raceName)));
    if (match && !seenKeys.has(match.key)) {
      seenKeys.add(match.key);
      required.push(match);
    }
  }

  // Add races matching pattern in name or description
  for (const race of allRaces) {
    if (seenKeys.has(race.key)) continue;
    const nameText = normalise(race.name || '');
    const descriptionText = normalise(race.description || '');
    if (nameText.includes(needleNorm) || descriptionText.includes(needleNorm)) {
      seenKeys.add(race.key);
      required.push(race);
    }
  }

  const done = required.filter(r => doneKeySet.has(r.key)).length;
  const total = required.length;
  return {
    id,
    label,
    description,
    type: 'percent',
    count: done,
    total,
    percent: total ? Math.round((done / total) * 100) : 0,
    detailsItems: toRaceItems(required, doneKeySet),
  };
}

function challengeTaggedPercent(id, label, description, tag, doneKeySet, allRaces, includeInactive = false, excludedNames = []) {
  const excludedNormSet = new Set(excludedNames.map(n => normalise(n)));
  const required = allRaces.filter(r => {
    if (!hasTag(r, tag)) return false;
    if (excludedNormSet.has(normalise(r.name || ''))) return false;
    if (includeInactive) return true;
    return isActive(r);
  });
  const done = required.filter(r => doneKeySet.has(r.key)).length;
  const total = required.length;
  return {
    id,
    label,
    description,
    type: 'percent',
    count: done,
    total,
    percent: total ? Math.round((done / total) * 100) : 0,
    detailsItems: toRaceItems(required, doneKeySet),
  };
}

function challengeSystemCoverage(id, label, description, systems, doneKeySet, allRaces) {
  const required = racesInSystems(allRaces, systems);
  const done = required.filter(r => doneKeySet.has(r.key)).length;
  const total = required.length;
  return {
    id,
    label,
    description,
    type: 'percent',
    count: done,
    total,
    percent: total ? Math.round((done / total) * 100) : 0,
    detailsItems: toRaceItems(required, doneKeySet),
  };
}

function challengeSystemAreaPercent(id, label, description, systems, doneKeySet, allRaces) {
  const required = racesInSystems(allRaces, systems);
  const done = required.filter(r => doneKeySet.has(r.key)).length;
  const total = required.length;
  return {
    id,
    label,
    description,
    type: 'percent',
    count: done,
    total,
    percent: total ? Math.round((done / total) * 100) : 0,
    detailsItems: toRaceItems(required, doneKeySet),
  };
}

function challengeAnyNInSystems(id, label, description, systems, n, doneKeySet, allRaces) {
  const required = racesInSystems(allRaces, systems);
  const done = required.filter(r => doneKeySet.has(r.key)).length;
  const bounded = Math.min(done, n);
  return {
    id,
    label,
    description,
    type: 'percent',
    count: bounded,
    total: n,
    percent: Math.round((bounded / n) * 100),
    detailsItems: toRaceItems(required, doneKeySet),
  };
}

function challengeJetsetter(id, label, description, doneKeySet, allRaces) {
  const regions = [
    { label: 'Colonia', systems: ['COLONIA', 'TIR'] },
    { label: 'Beagle Point', systems: ['BEAGLE POINT'] },
    { label: 'Sag A*', systems: ['STUEMEAE EG-Y D4548'] },
    { label: "Rainbow's End", systems: ['ROEFOO ZE-H D10-0'] },
  ];

  const regionItems = regions.map(region => {
    const races = racesInSystems(allRaces, region.systems);
    const done = races.some(r => doneKeySet.has(r.key));
    return { label: region.label, done };
  });

  const doneCount = regionItems.filter(i => i.done).length;
  return {
    id,
    label,
    description,
    type: 'percent',
    count: doneCount,
    total: regionItems.length,
    percent: Math.round((doneCount / regionItems.length) * 100),
    detailsItems: regionItems,
  };
}

function challengeConstraintBool(id, label, description, allRaces, doneKeySet, predicate) {
  const required = allRaces.filter(predicate);
  const done = required.filter(r => doneKeySet.has(r.key));
  return {
    id,
    label,
    description,
    type: 'bool',
    done: done.length > 0,
    progressText: done.length > 0 ? 'Completed' : 'Not completed',
    detailsItems: toRaceItems(required, doneKeySet),
  };
}

function challengeConstraintCountPercent(id, label, description, allRaces, doneKeySet, targetCount, predicate) {
  const required = allRaces.filter(predicate);
  const done = required.filter(r => doneKeySet.has(r.key)).length;
  const bounded = Math.min(done, targetCount);
  return {
    id,
    label,
    description,
    type: 'percent',
    count: bounded,
    total: targetCount,
    percent: Math.round((bounded / targetCount) * 100),
    detailsItems: toRaceItems(required, doneKeySet),
  };
}

function challengeFixedSetBool(id, label, description, requiredNamePatterns, doneRaces, allRaces, requireAll) {
  const items = requiredNamePatterns.map(pattern => {
    const done = doneRaces.some(r => normalise(r.race_name).includes(normalise(pattern)));
    const match = allRaces.find(r => normalise(r.name).includes(normalise(pattern)));
    return {
      label: match ? `${match.name}${match.system ? ` (${match.system})` : ''}` : pattern,
      done,
      key: match?.key || null,
    };
  });

  const doneCount = items.filter(i => i.done).length;
  const target = requireAll ? items.length : 1;
  return {
    id,
    label,
    description,
    type: 'bool',
    done: doneCount >= target,
    progressText: `${doneCount}/${items.length} requirements`,
    detailsItems: items,
  };
}

function challengeFixedSetPercent(id, label, description, requiredNames, doneRaces, allRaces) {
  const items = requiredNames.map(name => {
    const done = doneRaces.some(r => normalise(r.race_name) === normalise(name));
    const match = allRaces.find(r => normalise(r.name) === normalise(name)) || allRaces.find(r => normalise(r.name).includes(normalise(name)));
    return {
      label: match ? `${match.name}${match.system ? ` (${match.system})` : ''}` : name,
      done,
      key: match?.key || null,
    };
  });

  const doneCount = items.filter(i => i.done).length;
  return {
    id,
    label,
    description,
    type: 'percent',
    count: doneCount,
    total: items.length,
    percent: Math.round((doneCount / items.length) * 100),
    detailsItems: items,
  };
}

function challengeNamedAndMatchingPercent(
  id,
  label,
  description,
  requiredNames,
  matchPatterns,
  doneRaces,
  allRaces,
) {
  const items = [];
  const seenKeys = new Set();
  const seenLabels = new Set();

  for (const name of requiredNames) {
    const done = doneRaces.some(r => normalise(r.race_name) === normalise(name));
    const match = allRaces.find(r => normalise(r.name) === normalise(name))
      || allRaces.find(r => normalise(r.name).includes(normalise(name)));
    const key = match?.key || null;
    const labelText = match ? `${match.name}${match.system ? ` (${match.system})` : ''}` : name;
    if (key && seenKeys.has(key)) continue;
    if (!key && seenLabels.has(labelText)) continue;
    if (key) seenKeys.add(key);
    seenLabels.add(labelText);
    items.push({
      label: labelText,
      done,
      key,
    });
  }

  for (const pattern of matchPatterns) {
    const matches = allRaces.filter(r => normalise(r.name).includes(normalise(pattern)));
    for (const match of matches) {
      const key = match.key;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const labelText = `${match.name}${match.system ? ` (${match.system})` : ''}`;
      seenLabels.add(labelText);
      items.push({
        label: labelText,
        done: doneRaces.some(r => r.key === key),
        key,
      });
    }
  }

  const doneCount = items.filter(i => i.done).length;
  return {
    id,
    label,
    description,
    type: 'percent',
    count: doneCount,
    total: items.length,
    percent: items.length ? Math.round((doneCount / items.length) * 100) : 0,
    detailsItems: items,
  };
}

function challengeMountainTrip(id, label, description, groups, doneNameNormSet) {
  const completeGroups = groups.filter(group => group.every(name => doneNameNormSet.has(normalise(name))));
  const detailsItems = groups.map(group => {
    const label = group.length > 1 ? `${group[0]} + ${group[group.length - 1]}` : group[0];
    const done = group.every(name => doneNameNormSet.has(normalise(name)));
    return { label, done };
  });

  return {
    id,
    label,
    description,
    type: 'bool',
    done: completeGroups.length >= 1,
    progressText: `${completeGroups.length}/${groups.length} groups`,
    detailsItems,
  };
}

function challengeMountainTripCount(id, label, description, groups, doneNameNormSet, neededGroups) {
  const completeGroups = groups.filter(group => group.every(name => doneNameNormSet.has(normalise(name))));
  const detailsItems = groups.map(group => {
    const label = group.length > 1 ? `${group[0]} + ${group[group.length - 1]}` : group[0];
    const done = group.every(name => doneNameNormSet.has(normalise(name)));
    return { label, done };
  });

  return {
    id,
    label,
    description,
    type: 'bool',
    done: completeGroups.length >= neededGroups,
    progressText: `${completeGroups.length}/${neededGroups} groups`,
    detailsItems,
  };
}

function challengeSnakeEyes(id, label, description, doneRaces) {
  const shipMap = new Map();
  for (const shipName of SNAKE_SHIPS) {
    shipMap.set(shipName, false);
  }

  for (const race of doneRaces) {
    const raceShip = normalise(race.ship || '');
    for (const shipName of SNAKE_SHIPS) {
      if (raceShip.includes(normalise(shipName))) {
        shipMap.set(shipName, true);
      }
    }
  }

  const count = [...shipMap.values()].filter(Boolean).length;
  const capped = Math.min(count, 5);

  return {
    id,
    label,
    description,
    type: 'percent',
    count: capped,
    total: 5,
    percent: Math.round((capped / 5) * 100),
    detailsItems: [...shipMap.entries()].map(([ship, done]) => ({ label: ship, done })),
  };
}

function challengeLetterE(id, label, description, doneRaces) {
  const eRaces = doneRaces.filter(r => getInitialLetter(r.race_name) === 'E');
  const count = Math.min(eRaces.length, 4);
  return {
    id,
    label,
    description,
    type: 'percent',
    count,
    total: 4,
    percent: Math.round((count / 4) * 100),
    detailsItems: eRaces.map(toDoneRaceItem),
  };
}

function challengeAlphabet(id, label, description, doneRaces) {
  const letters = new Set();
  for (const race of doneRaces) {
    const letter = getInitialLetter(race.race_name);
    if (letter) letters.add(letter);
  }

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const detailsItems = alphabet.map(letter => ({ label: letter, done: letters.has(letter) }));

  return {
    id,
    label,
    description,
    type: 'percent',
    count: letters.size,
    total: 26,
    percent: Math.round((letters.size / 26) * 100),
    detailsItems,
  };
}

function renderSummary(challenges) {
  const completeBool = challenges.filter(c => c.type === 'bool' && c.done).length;
  const totalBool = challenges.filter(c => c.type === 'bool').length;

  summaryBar.style.display = '';
  summaryBar.innerHTML = `
    <span><strong>${completeBool}/${totalBool}</strong> checkbox challenges complete</span>
  `;
}

function renderChallenges(challenges) {
  challengeById.clear();
  for (const challenge of challenges) {
    challengeById.set(challenge.id, challenge);
  }

  const sortKey = label => label.replace(/^the\s+/i, '').toLowerCase();
  const visible = challenges
    .filter(c => !hideCompleted || !(c.done || c.percent >= 100))
    .slice()
    .sort((a, b) => sortKey(a.label).localeCompare(sortKey(b.label)));

  const emptyMsg = hideCompleted && !visible.length && challenges.length
    ? '<p class="empty-state">All challenges completed! ✓</p>'
    : '<p class="empty-state">No challenges configured.</p>';
  challengesContainer.innerHTML = visible.map(challengeCard).join('') || emptyMsg;
}

function challengeCard(challenge) {
  const detailsBtn = challenge.detailsItems && challenge.detailsItems.length
    ? `<button class="btn-chip challenge-details-btn" data-challenge-id="${esc(challenge.id)}">Details</button>`
    : '';

  if (challenge.type === 'bool') {
    const bar = challenge.done
      ? `<div class="participation-bar-wrapper challenge-bar-row">
          <div class="neidy-bar"><div class="neidy-bar-fill" style="width:100%"></div></div>
          <span class="participation-bar-pct">100%</span>
        </div>`
      : '';
    return `
      <article class="challenge-card${challenge.done ? ' is-complete' : ''}">
        <header class="challenge-card-header">
          <h2>${esc(challenge.label)}</h2>
          <span class="challenge-check" aria-label="${challenge.done ? 'Completed' : 'Not completed'}">${challenge.done ? '☑' : '☐'}</span>
        </header>
        <p class="challenge-desc">${esc(challenge.description)}</p>
        ${bar}
        <footer class="challenge-card-footer">
          <span class="challenge-progress-text">${esc(challenge.progressText || (challenge.done ? 'Completed' : 'Not completed'))}</span>
          ${detailsBtn}
        </footer>
      </article>
    `;
  }

  const pct = Number(challenge.percent || 0);
  return `
    <article class="challenge-card${pct >= 100 ? ' is-complete' : ''}">
      <header class="challenge-card-header">
        <h2>${esc(challenge.label)}</h2>
        <span class="challenge-pct">${pct}%</span>
      </header>
      <p class="challenge-desc">${esc(challenge.description)}</p>
      <div class="participation-bar-wrapper challenge-bar-row">
        <div class="neidy-bar"><div class="neidy-bar-fill" style="width:${pct}%"></div></div>
        <span class="participation-bar-pct">${esc(String(challenge.count))}/${esc(String(challenge.total))}</span>
      </div>
      <footer class="challenge-card-footer">
        <span class="challenge-progress-text">Progress</span>
        ${detailsBtn}
      </footer>
    </article>
  `;
}

function bindModal() {
  challengesContainer.addEventListener('click', (event) => {
    const btn = event.target.closest('.challenge-details-btn');
    if (!btn) return;
    const challengeId = btn.dataset.challengeId;
    const challenge = challengeById.get(challengeId);
    if (!challenge) return;
    openModal(challenge);
  });

  modalCloseBtn.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (event) => {
    if (event.target === modalOverlay) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });
}

function bindFilterControls() {
  const filterBar = document.getElementById('challenges-filter-bar');
  const checkbox = document.getElementById('challenge-hide-completed');
  if (!filterBar || !checkbox) return;
  filterBar.style.display = '';
  checkbox.checked = hideCompleted;
  checkbox.addEventListener('change', () => {
    hideCompleted = checkbox.checked;
    localStorage.setItem('tt_filter_hide_completed', hideCompleted ? '1' : '0');
    renderChallenges(allChallenges);
  });
}

function openModal(challenge) {
  modalTitle.textContent = challenge.label;
  if (challenge.type === 'bool') {
    modalSubtitle.textContent = challenge.progressText || (challenge.done ? 'Completed' : 'Not completed');
  } else {
    modalSubtitle.textContent = `${challenge.count}/${challenge.total} complete`;
  }

  const items = challenge.detailsItems || [];
  if (!items.length) {
    modalList.innerHTML = '<li class="challenge-modal-item"><span class="muted">No detailed requirements available for this challenge.</span></li>';
  } else {
    modalList.innerHTML = items
      .slice()
      .sort((a, b) => {
        if (a.done === b.done) return String(a.label).localeCompare(String(b.label));
        return a.done ? 1 : -1;
      })
      .map(item => {
        const check = item.done ? '☑' : '☐';
        const label = item.key
          ? `<a href="/race/${encodeURIComponent(item.key)}">${esc(item.label)}</a>`
          : esc(item.label);
        return `<li class="challenge-modal-item"><span class="challenge-modal-check">${check}</span><span>${label}</span></li>`;
      })
      .join('');
  }

  modalOverlay.style.display = 'flex';
  requestAnimationFrame(() => modalOverlay.classList.add('visible'));
}

function closeModal() {
  modalOverlay.classList.remove('visible');
  modalOverlay.addEventListener('transitionend', () => {
    modalOverlay.style.display = 'none';
  }, { once: true });
}

function toRaceItems(races, doneKeySet) {
  return races
    .slice()
    .sort((a, b) => String(a.system || '').localeCompare(String(b.system || '')) || String(a.name || '').localeCompare(String(b.name || '')))
    .map(r => ({
      label: `${r.name}${r.system ? ` (${r.system})` : ''}`,
      done: doneKeySet.has(r.key),
      key: r.key,
    }));
}

function toDoneRaceItem(race) {
  return {
    label: `${race.race_name}${race.system ? ` (${race.system})` : ''}`,
    done: true,
    key: race.key,
  };
}

function racesFromDonePredicate(doneRaces, predicate) {
  return doneRaces.filter(predicate);
}

function racesInSystems(allRaces, systems, includeInactive = false) {
  const set = new Set(systems.map(s => normalise(s)));
  return allRaces.filter(r => {
    const inSystem = set.has(normalise(r.system || ''));
    if (!inSystem) return false;
    if (includeInactive) return true;
    return isActive(r);
  });
}

function isActive(race) {
  const isInactive = hasTag(race, 'Inactive');
  const isHorizons = String(race.version || '').toUpperCase() === 'HORIZONS';
  return !isInactive && !isHorizons;
}

function hasTag(race, tag) {
  const tags = String(race.tags || '')
    .split(',')
    .map(t => t.trim().toUpperCase())
    .filter(Boolean);
  return tags.includes(String(tag || '').trim().toUpperCase());
}

function hasConstraintKey(race, key) {
  const constraints = race.constraints || [];
  return constraints.some(c => String(c.key || '').toUpperCase() === String(key || '').toUpperCase());
}

function hasConstraintValue(race, key, value) {
  const constraints = race.constraints || [];
  return constraints.some(c => String(c.key || '').toUpperCase() === String(key || '').toUpperCase() && Number(c.value) === Number(value));
}

function isCanyonRaceWithLowHeightLimit(race) {
  const nameText = normalise(race.name || '');
  const descriptionText = normalise(race.description || '');
  const isCanyon = nameText.includes('canyon') || descriptionText.includes('canyon');
  if (!isCanyon) return false;

  const hasLowAltitudeHint = nameText.includes('low altitude')
    || descriptionText.includes('low altitude')
    || descriptionText.includes('200m')
    || descriptionText.includes('100m');

  return hasLowAltitudeHint;
}

function containsAny(source, options) {
  const src = normalise(source || '');
  return options.some(opt => src.includes(normalise(opt)));
}

function normalise(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getInitialLetter(name) {
  let clean = String(name || '').trim();
  clean = clean.replace(/^dw3\s+the\s+/i, '');
  clean = clean.replace(/^dw3\s+/i, '');
  clean = clean.replace(/^the\s+/i, '');
  const match = clean.match(/[A-Za-z]/);
  return match ? match[0].toUpperCase() : '';
}

init();
