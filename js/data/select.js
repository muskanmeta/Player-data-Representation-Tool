// select.js: the view-model. Pure functions that answer "given the dataset and the current
// filters, what should be on screen?". No DOM and no drawing, so all of it is unit-tested.
//
// Time convention used everywhere in the app: t = seconds from the start of the match.
// In single-match view the playhead walks one match. In multi-match view the same playhead
// means "this far into each match", so the heatmaps can compare early and late game.

export const SORTS = {
  humans:   { label: 'Most humans',  key: m => m.humans },
  bots:     { label: 'Most bots',    key: m => m.bots },
  kills:    { label: 'Most kills',   key: m => m.counts.Kill + m.counts.BotKill },
  duration: { label: 'Longest',      key: m => m.duration },
  recent:   { label: 'Newest first', key: m => m.start }
}

/**
 * Matches for the match browser: on one map, on one date (or 'all'), with at least
 * `minPlayers` recorded journeys, whose id contains `search`, sorted (ties by id, so the
 * order never jumps around between renders).
 */
export function filterMatches (dataset, { map, date = 'all', minPlayers = 1, search = '', sort = 'humans' }) {
  const needle = search.trim().toLowerCase()
  const key = (SORTS[sort] ?? SORTS.humans).key
  return dataset.matches
    .filter(m => m.map === map &&
      (date === 'all' || m.date === date) &&
      m.journeys.length >= minPlayers &&
      (needle === '' || m.id.toLowerCase().includes(needle)))
    .sort((a, b) => key(b) - key(a) || a.id.localeCompare(b.id))
}

/** The matches drawn on the map: the chosen match, or every match the browser lists. */
export function viewMatches (dataset, state) {
  if (state.match) {
    const m = dataset.matches.find(x => x.id === state.match)
    return m ? [m] : []
  }
  return filterMatches(dataset, state)
}

/** Number of matches per date on one map, for the date chips ("Feb 13 · 41"). */
export function countByDate (dataset, map, minPlayers = 1) {
  const counts = Object.fromEntries(dataset.dates.map(d => [d, 0]))
  for (const m of dataset.matches) {
    if (m.map === map && m.journeys.length >= minPlayers) counts[m.date] = (counts[m.date] ?? 0) + 1
  }
  return counts
}

/** Number of matches per map, for the map switcher. */
export function countByMap (dataset) {
  const counts = Object.fromEntries(dataset.maps.map(id => [id, 0]))
  for (const m of dataset.matches) counts[m.map] = (counts[m.map] ?? 0) + 1
  return counts
}

/** Length of the timeline: the longest match in view, at least one second. */
export function viewDuration (matches) {
  return matches.reduce((max, m) => Math.max(max, m.duration), 1)
}

/**
 * How many points of a flat path [t, x, z, t, x, z, ...] happened at or before time t.
 * Binary search: paths are sorted by time, and this runs for every journey on every frame.
 */
export function pointsUntil (path, t) {
  let lo = 0
  let hi = path.length / 3
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (path[mid * 3] <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Where a player is at time t: interpolated between the two samples around t, so heads
 * glide instead of jumping every few seconds. Null before the first sample. After the
 * last sample the player stays at the last known position (`ended: true`).
 */
export function positionAt (path, t) {
  const n = pointsUntil(path, t)
  if (n === 0) return null
  const i = (n - 1) * 3
  if (n * 3 >= path.length) return { x: path[i + 1], z: path[i + 2], ended: true }
  const t0 = path[i]; const t1 = path[i + 3]
  const k = t1 > t0 ? (t - t0) / (t1 - t0) : 0
  return {
    x: path[i + 1] + (path[i + 4] - path[i + 1]) * k,
    z: path[i + 2] + (path[i + 5] - path[i + 2]) * k,
    ended: false
  }
}

/**
 * Counts for the summary panel, up to time t, skipping hidden players.
 * @returns {{ matches: number, humans: number, bots: number, events: Record<string, number> }}
 */
export function summarize (matches, t = Infinity, hidden = new Set()) {
  const out = { matches: matches.length, humans: 0, bots: 0, events: {} }
  for (const m of matches) {
    for (const j of m.journeys) {
      if (hidden.has(j.user_id)) continue
      if (j.bot) out.bots++
      else out.humans++
      for (const [type, et] of j.events) {
        if (et <= t) out.events[type] = (out.events[type] ?? 0) + 1
      }
    }
  }
  return out
}

/** Every event time in the given matches, for the ticks drawn on the timeline. */
export function eventTimes (matches, types) {
  const wanted = new Set(types)
  const out = []
  for (const m of matches) {
    for (const j of m.journeys) {
      for (const [type, t] of j.events) if (wanted.has(type)) out.push({ type, t })
    }
  }
  return out
}
