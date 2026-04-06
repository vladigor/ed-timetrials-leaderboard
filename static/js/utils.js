/**
 * Shared utility functions for the Elite TT Leaderboard frontend.
 */

/**
 * Format milliseconds as m:ss.mmm
 * @param {number} ms
 * @returns {string}
 */
export function ordinal(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = ms % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * Format an improvement delta (positive = got faster, shown as green "-").
 * @param {number|null} ms
 * @returns {{ text: string, cls: string }}
 */
export function formatImprovement(ms) {
  if (ms == null) return { text: '—', cls: 'improvement-none' };
  if (ms === 0)   return { text: '—', cls: 'improvement-none' };
  if (ms > 0) {
    return { text: `▼ ${formatTime(ms)}`, cls: 'improvement-better' };
  }
  return { text: `▲ ${formatTime(Math.abs(ms))}`, cls: 'improvement-worse' };
}

/**
 * Format gap to the entry above (always positive, shown as "+X").
 * @param {number|null} ms
 * @returns {string}
 */
export function formatDelta(ms) {
  if (ms == null || ms === 0) return '';
  return `+${formatTime(ms)}`;
}

/**
 * Return relative time string e.g. "3 days ago".
 * @param {string} isoOrDatetime  datetime string from the API / DB
 * @returns {string}
 */
export function relativeTime(isoOrDatetime) {
  if (!isoOrDatetime) return '';
  // The DB stores "YYYY-MM-DD HH:MM:SS.ffffff" — normalise to ISO
  const normalised = isoOrDatetime.replace(' ', 'T').replace(/(\.\d{1,6}).*$/, '$1') + 'Z';
  const diff = Date.now() - new Date(normalised).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60)  return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)  return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)    return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Escape HTML special characters.
 * @param {string} str
 * @returns {string}
 */
export function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
