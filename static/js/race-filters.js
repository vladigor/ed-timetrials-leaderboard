export function matchesRaceFilters(race, filters, favouriteState = () => null) {
  if (filters.hideRemote) {
    const tags = (race.tags || '').split(',').map(tag => tag.trim());
    if (tags.some(tag => ['Remote', 'DW3', 'DR1', 'Colonia'].includes(tag))) return false;
  }
  if (filters.hideHorizons && race.version === 'HORIZONS') return false;
  if (filters.daytimeOnly && race.daylight_state !== 'day') return false;
  if (filters.powerplayOnly && !race.powerplay) return false;
  if (filters.hideIgnored && favouriteState(race.key) === 'ignored') return false;
  if (filters.search?.trim()) {
    const query = filters.search.toLowerCase();
    if (['name', 'system', 'station', 'type', 'version'].some(field => race[field]?.toLowerCase().includes(query))) return true;
    const tags = Array.isArray(race.tags) ? race.tags : [race.tags || ''];
    if (tags.some(tag => String(tag).toLowerCase().includes(query))) return true;
    return ['multi-mode', 'multi-planet', 'multi-system'].some(
      badge => race[badge.replace('-', '_')] && badge.includes(query)
    );
  }
  return true;
}

export function compareRaceOrder(a, b, order, favouriteState = () => null) {
  const activityMs = ts => ts ? new Date(ts.replace(' ', 'T').replace(/(\..{1,6}).*$/, '$1') + 'Z').getTime() : 0;
  const activity = () => activityMs(b.last_activity) - activityMs(a.last_activity);
  if (order === 'name') {
    const sortName = name => (name || '').trimStart().replace(/^The\s+/i, '');
    return sortName(a.name).localeCompare(sortName(b.name)) || activity();
  }
  if (order === 'created') return activityMs(b.created_at) - activityMs(a.created_at) || activity();
  if (order === 'favourites') {
    const ranks = { fav: 0, null: 1, ignored: 2 };
    return (ranks[favouriteState(a.key)] ?? 1) - (ranks[favouriteState(b.key)] ?? 1) || activity();
  }
  return activity();
}
