/**
 * Polling helper: calls /api/poll periodically and invokes a callback when
 * the last-updated snapshot diverges from what we last saw.
 */
export class ChangePoller {
  /**
   * @param {number}   intervalMs  How often to poll (default 60 000)
   * @param {Function} onChange    Called with the new snapshot when a change is detected
   */
  constructor(intervalMs = 60_000, onChange) {
    this._interval = intervalMs;
    this._onChange = onChange;
    this._snapshot = null;
    this._timerId = null;
    this._active = false;
  }

  start() {
    if (this._active) return;
    this._active = true;
    this._schedule();
  }

  stop() {
    this._active = false;
    if (this._timerId) clearTimeout(this._timerId);
  }

  _schedule() {
    if (!this._active) return;
    this._timerId = setTimeout(() => this._tick(), this._interval);
  }

  async _tick() {
    if (!this._active) return;
    try {
      const res = await fetch('/api/poll');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const fresh = body.last_updated ?? body; // backwards compat
      if (this._snapshot !== null && this._diverges(this._snapshot, fresh)) {
        this._onChange(fresh);
      }
      this._snapshot = fresh;
    } catch (err) {
      console.warn('[poller] poll failed:', err);
    } finally {
      this._schedule();
    }
  }

  /** Returns true if the two snapshots differ. */
  _diverges(a, b) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return true;
    for (const k of keysA) {
      if (a[k] !== b[k]) return true;
    }
    return false;
  }

  /** Seed the initial snapshot without triggering onChange. */
  seed(snapshot) {
    this._snapshot = snapshot;
  }
}
