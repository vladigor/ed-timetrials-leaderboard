/**
 * Favourites / Ignored race preferences.
 *
 * State is persisted in localStorage under the key `tt_race_prefs` as a plain
 * JSON object mapping race key → 'fav' | 'ignored'.
 *
 * Exports:
 *   getFavState(key)         → 'fav' | 'ignored' | null
 *   setFavState(key, state)  → void  (state: 'fav' | 'ignored' | null)
 *   cycleFavState(key)       → new state string ('fav' | 'ignored' | null)
 *   getAllFavs()             → { [key]: 'fav' | 'ignored' }
 *   FAV_ICON / IGNORED_ICON / NEUTRAL_ICON  (display constants)
 */

const STORAGE_KEY = 'tt_race_prefs';

export const NEUTRAL_ICON = '🤍';
export const FAV_ICON     = '❤️';
export const IGNORED_ICON = '💔';

/** Read the full prefs object from localStorage. */
function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

/** Write the full prefs object to localStorage. */
function writePrefs(prefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

/**
 * Return the current fav state for a race key.
 * @param {string} key
 * @returns {'fav' | 'ignored' | null}
 */
export function getFavState(key) {
  return readPrefs()[key] ?? null;
}

/**
 * Set the fav state for a race key.
 * Pass null to remove the preference entirely.
 * @param {string} key
 * @param {'fav' | 'ignored' | null} state
 */
export function setFavState(key, state) {
  const prefs = readPrefs();
  if (state === null) {
    delete prefs[key];
  } else {
    prefs[key] = state;
  }
  writePrefs(prefs);
}

/**
 * Cycle through: null → 'fav' → 'ignored' → null
 * Returns the new state.
 * @param {string} key
 * @returns {'fav' | 'ignored' | null}
 */
export function cycleFavState(key) {
  const current = getFavState(key);
  const next = current === null ? 'fav'
             : current === 'fav' ? 'ignored'
             : null;
  setFavState(key, next);
  return next;
}

/**
 * Return the full prefs map for all races.
 * @returns {{ [key: string]: 'fav' | 'ignored' }}
 */
export function getAllFavs() {
  return readPrefs();
}

/**
 * Return the icon and tooltip for a given fav state.
 * @param {'fav' | 'ignored' | null} state
 * @returns {{ icon: string, title: string }}
 */
export function favDisplay(state) {
  if (state === 'fav')     return { icon: FAV_ICON,     title: 'Favourite — click to mark as 💔' };
  if (state === 'ignored') return { icon: IGNORED_ICON, title: '💔 — click to clear' };
  return                          { icon: NEUTRAL_ICON, title: 'Click to favourite' };
}
