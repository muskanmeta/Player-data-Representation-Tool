// build-dataset.js: parsed journey files -> one dataset the app can draw. Shared by the
// Node conversion tool and (later) the browser upload, so both give identical results.
//
// Handles the data's file-level traps:
//   - One file is duplicated across two day folders -> merge by (player, match), drop repeated rows.
//   - Day folders do not always match the UTC start date -> date = folder, else earliest folder,
//     else UTC start date; every mismatch is reported.
//   - Most matches have only one recorded journey -> counted, so the UI can filter for 2+ players.
// Nothing is silently fixed: every anomaly goes into `health`, shown in the app.

import { classifyPlayer, KNOWN_EVENTS, MOVEMENT_EVENTS } from './parse.js'
import { worldToUV, isInsideMap } from '../map/mapping.js'

export const SCHEMA_VERSION = 1
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december']

/** "February_10" + year 2026 -> "2026-02-10"; anything else -> null. */
export function folderToDate (folder, year) {
  const m = /^([a-z]+)_(\d{1,2})$/i.exec(folder ?? '')
  if (!m) return null
  const month = MONTHS.indexOf(m[1].toLowerCase())
  if (month < 0) return null
  return `${year}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

const utcDate = seconds => new Date(seconds * 1000).toISOString().slice(0, 10)
const round1 = v => Math.round(v * 10) / 10

/**
 * @param {{ file: string, folder: string | null, journey?: object, error?: string }[]} inputs
 *   one entry per raw file: `journey` from parseJourneyFile, or `error` when it failed
 * @param {{ maps?: Record<string, { scale: number, originX: number, originZ: number }> }} options
 *   map settings, used to flag points that fall outside the minimap
 */
export function buildDataset (inputs, { maps = {} } = {}) {
  const health = {
    failed_files: [],          // not parquet or could not be parsed
    repeated_journeys: [],     // same player + match in several files
    id_conflicts: [],          // numeric ID that behaves like a human (or the reverse)
    folder_date_mismatches: [],// folder date differs from the match's UTC start date
    multi_folder_matches: [],  // one match spread over several day folders
    mixed_maps: [],            // a match (or one file) that names more than one map_id
    unknown_maps: [],
    unknown_events: [],
    points_outside_map: 0,
    single_journey_matches: 0
  }
  let rowsIn = 0

  // 1. Group files by (player, match).
  const byJourney = new Map()
  for (const input of [...inputs].sort((a, b) => a.file.localeCompare(b.file))) {
    if (input.error) { health.failed_files.push({ file: input.file, error: input.error }); continue }
    const j = input.journey
    rowsIn += j.rows.length
    const key = `${j.userId}|${j.matchId}`
    if (!byJourney.has(key)) {
      byJourney.set(key, { ...j, rows: [], files: [], folders: new Set(), seen: new Set(), repeatedRows: 0 })
    }
    const entry = byJourney.get(key)

    // Rows already delivered by an earlier file of the same journey are repeats and dropped.
    // Identical rows inside ONE file are kept: two loot pickups in the same second are real.
    const fromThisFile = new Set()
    for (const r of j.rows) {
      const k = `${r.t}|${r.x}|${r.y}|${r.z}|${r.event}`
      if (entry.seen.has(k)) { entry.repeatedRows++; continue }
      fromThisFile.add(k)
      entry.rows.push(r)
    }
    for (const k of fromThisFile) entry.seen.add(k)
    entry.files.push(input.file)
    if (input.folder) entry.folders.add(input.folder)
  }

  // 2. Classify each journey and sort its rows by time (stable, so file order breaks ties).
  const byMatch = new Map()
  const unknownEvents = new Set()
  let rowsKept = 0
  for (const j of byJourney.values()) {
    j.rows.sort((a, b) => a.t - b.t)
    rowsKept += j.rows.length

    if (j.files.length > 1) {
      health.repeated_journeys.push({
        user_id: j.userId, match_id: j.matchId, files: j.files,
        repeated_rows: j.repeatedRows,
        kind: j.repeatedRows > 0 ? 'duplicate' : 'split' // overlapping rows vs. separate parts
      })
    }

    const eventNames = j.rows.map(r => r.event)
    for (const e of eventNames) if (!KNOWN_EVENTS.includes(e)) unknownEvents.add(e)
    j.player = classifyPlayer(j.userId, eventNames)
    if (j.player.conflict) {
      health.id_conflicts.push({ user_id: j.userId, match_id: j.matchId, events: [...new Set(eventNames)] })
    }

    if (!byMatch.has(j.matchId)) byMatch.set(j.matchId, [])
    byMatch.get(j.matchId).push(j)
  }
  health.unknown_events = [...unknownEvents].sort()

  // 3. Build matches.
  const matches = []
  const unknownMaps = new Set()
  for (const [matchId, journeys] of [...byMatch].sort((a, b) => a[0].localeCompare(b[0]))) {
    const mapId = journeys[0].mapId
    const map = maps[mapId]

    // One match, one map: every row of every journey should name the same map_id.
    const mapIdsSeen = [...new Set(journeys.flatMap(j => j.mapIds ?? [j.mapId]))].sort()
    if (mapIdsSeen.length > 1) health.mixed_maps.push({ match_id: matchId, map_ids: mapIdsSeen })
    if (!map) unknownMaps.add(mapId)

    let start = Infinity; let end = -Infinity
    for (const j of journeys) for (const r of j.rows) { start = Math.min(start, r.t); end = Math.max(end, r.t) }

    // Date rule: folder name, else earliest folder, else UTC start date.
    const year = new Date(start * 1000).getUTCFullYear()
    const folderDates = [...new Set(journeys.flatMap(j => [...j.folders]))]
      .map(f => folderToDate(f, year)).filter(Boolean).sort()
    const startDate = utcDate(start)
    const date = folderDates[0] ?? startDate
    if (folderDates.length > 1) health.multi_folder_matches.push({ match_id: matchId, folder_dates: folderDates })
    if (folderDates.length > 0 && folderDates[0] !== startDate) {
      health.folder_date_mismatches.push({ match_id: matchId, folder_date: folderDates[0], utc_start_date: startDate })
    }

    const counts = { Kill: 0, Killed: 0, BotKill: 0, BotKilled: 0, KilledByStorm: 0, Loot: 0 }
    const outJourneys = journeys
      .sort((a, b) => a.userId.localeCompare(b.userId))
      .map(j => {
        const path = []   // flat [t, x, z, t, x, z, ...], t in seconds from match start
        const events = [] // [event, t, x, z]
        for (const r of j.rows) {
          if (map && !isInsideMap(worldToUV(r.x, r.z, map))) health.points_outside_map++
          const t = Math.round(r.t - start)
          if (MOVEMENT_EVENTS.includes(r.event)) path.push(t, round1(r.x), round1(r.z))
          else {
            events.push([r.event, t, round1(r.x), round1(r.z)])
            if (r.event in counts) counts[r.event]++
          }
        }
        return {
          user_id: j.userId,
          bot: j.player.isBot,
          id_conflict: j.player.conflict,
          path,
          events
        }
      })

    const humans = outJourneys.filter(j => !j.bot).length
    if (outJourneys.length === 1) health.single_journey_matches++
    matches.push({
      id: matchId,
      map: mapId,
      date,
      start,
      duration: Math.round(end - start),
      humans,
      bots: outJourneys.length - humans,
      counts,
      journeys: outJourneys
    })
  }
  health.unknown_maps = [...unknownMaps].sort()

  return {
    schema_version: SCHEMA_VERSION,
    source: {
      files: inputs.length,
      files_failed: health.failed_files.length,
      rows: rowsIn,
      rows_after_dedupe: rowsKept,
      journeys: byJourney.size,
      matches: matches.length
    },
    maps: [...new Set(matches.map(m => m.map))].sort(),
    dates: [...new Set(matches.map(m => m.date))].sort(),
    matches,
    health
  }
}
