// merge.js: adds one dataset to another (the "Add to current data" upload mode).
//
// Datasets are merged by match id, and inside a match by player id, so uploading the same
// day twice changes nothing. A journey already present is kept as it is and counted as a
// repeat. Times inside a match are seconds from the match start, so when the new part of
// a match starts earlier than what we already have, every existing time is shifted.

const COUNTED = ['Kill', 'Killed', 'BotKill', 'BotKilled', 'KilledByStorm', 'Loot']

/** Shifts every time in a journey by `dt` seconds (returns a new journey). */
function shiftJourney (j, dt) {
  if (dt === 0) return j
  const path = j.path.slice()
  for (let i = 0; i < path.length; i += 3) path[i] += dt
  return { ...j, path, events: j.events.map(([type, t, x, z]) => [type, t + dt, x, z]) }
}

/** Recomputes a match's duration, humans, bots and event counts from its journeys. */
export function recount (match) {
  let end = 0
  const counts = Object.fromEntries(COUNTED.map(k => [k, 0]))
  for (const j of match.journeys) {
    if (j.path.length) end = Math.max(end, j.path[j.path.length - 3])
    for (const [type, t] of j.events) {
      end = Math.max(end, t)
      if (type in counts) counts[type]++
    }
  }
  const humans = match.journeys.filter(j => !j.bot).length
  return { ...match, duration: end, humans, bots: match.journeys.length - humans, counts }
}

/**
 * @returns {{ dataset: object, added: { matches: number, journeys: number }, repeated: number }}
 */
export function mergeDatasets (base, extra) {
  const byId = new Map(base.matches.map(m => [m.id, m]))
  let newMatches = 0; let newJourneys = 0; let repeated = 0

  for (const m of extra.matches) {
    const old = byId.get(m.id)
    if (!old) {
      byId.set(m.id, m)
      newMatches++
      newJourneys += m.journeys.length
      continue
    }
    const start = Math.min(old.start, m.start)
    const have = new Set(old.journeys.map(j => j.user_id))
    const fresh = m.journeys.filter(j => !have.has(j.user_id))
    repeated += m.journeys.length - fresh.length
    if (fresh.length === 0) continue
    newJourneys += fresh.length
    const journeys = [
      ...old.journeys.map(j => shiftJourney(j, old.start - start)),
      ...fresh.map(j => shiftJourney(j, m.start - start))
    ].sort((a, b) => a.user_id.localeCompare(b.user_id))
    byId.set(m.id, recount({ ...old, start, date: old.date < m.date ? old.date : m.date, journeys }))
  }

  const matches = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
  const health = { ...base.health }
  for (const [key, value] of Object.entries(extra.health ?? {})) {
    if (Array.isArray(value)) health[key] = [...(health[key] ?? []), ...value]
    else if (typeof value === 'number') health[key] = (health[key] ?? 0) + value
  }
  // Recount single-journey matches on the merged result rather than adding the two totals.
  health.single_journey_matches = matches.filter(m => m.journeys.length === 1).length

  return {
    dataset: {
      ...base,
      source: {
        ...base.source,
        files: (base.source?.files ?? 0) + (extra.source?.files ?? 0),
        journeys: matches.reduce((n, m) => n + m.journeys.length, 0),
        matches: matches.length
      },
      maps: [...new Set(matches.map(m => m.map))].sort(),
      dates: [...new Set(matches.map(m => m.date))].sort(),
      matches,
      health
    },
    added: { matches: newMatches, journeys: newJourneys },
    repeated
  }
}
