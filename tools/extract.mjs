// extract.mjs: organises any raw telemetry drop into four plain CSV tables.
//
//   node tools/extract.mjs <player_data folder> --out out/feb
//
// Writes (columns described in tools/README.md):
//   files.csv     one row per raw file      (hash, parse result, ts unit, map ids, event types)
//   journeys.csv  one row per player+match  (bot by ID vs by events, counts, anomalies)
//   matches.csv   one row per match         (map, date, length, humans, bots, event counts)
//   events.csv    one row per non-movement event (kills, deaths, loot) with time and position
//
// Uses the app's own parser and dataset builder (js/data/), so the tables and the app can
// never disagree. Deterministic: same input -> byte-identical files. Next step: tools/audit.mjs.

import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative, resolve } from 'node:path'
import { parseJourneyFile, classifyPlayer } from '../js/data/parse.js'
import { buildDataset } from '../js/data/build-dataset.js'
import { parentFolder } from '../js/data/import-files.js'
import { worldToUV, isInsideMap } from '../js/map/mapping.js'
import { parseArgs, listFiles, toCsv, writeText, isoUtc, loadMaps } from './lib/common.mjs'

const DEATHS = new Set(['Killed', 'BotKilled', 'KilledByStorm'])
const SKIP = /\.(md|png|jpe?g|webp|txt)$/i

const args = parseArgs()
const input = args._[0]
if (!input) {
  console.error('Usage: node tools/extract.mjs <player_data folder> --out out/<name>')
  process.exit(2)
}
const inputDir = resolve(input)
const outDir = resolve(args.out ?? 'out/extract')
const started = Date.now()

// ---------- 1. read every file ----------
const fileRows = []
const inputs = []
for (const file of (await listFiles(inputDir)).filter(f => !SKIP.test(f))) {
  const rel = relative(inputDir, file).replaceAll('\\', '/')
  const folder = parentFolder(rel)
  const bytes = await readFile(file)
  const row = {
    path: rel, folder, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    user_id: '', match_id: '', map_ids: '', ts_unit: '', rows: 0, ts_backwards: 0, event_types: '',
    parsed_ok: false, error: ''
  }
  try {
    const journey = await parseJourneyFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length))
    let backwards = 0
    for (let i = 1; i < journey.rows.length; i++) if (journey.rows[i].t < journey.rows[i - 1].t) backwards++
    Object.assign(row, {
      user_id: journey.userId, match_id: journey.matchId, map_ids: journey.mapIds,
      ts_unit: journey.tsUnit, rows: journey.rows.length, ts_backwards: backwards,
      event_types: [...new Set(journey.rows.map(r => r.event))].sort(), parsed_ok: true
    })
    inputs.push({ file: rel, folder, journey })
  } catch (e) {
    row.error = e.message
    inputs.push({ file: rel, folder, error: e.message })
  }
  fileRows.push(row)
}

// ---------- 2. build the dataset with the app's rules ----------
const maps = await loadMaps()
const dataset = buildDataset(inputs, { maps })

// Per-journey facts the dataset does not keep: which files and folders it came from,
// and the two bot classifications side by side.
const sourceOf = new Map()
for (const i of inputs) {
  if (!i.journey) continue
  const key = `${i.journey.userId}|${i.journey.matchId}`
  if (!sourceOf.has(key)) sourceOf.set(key, { files: [], folders: new Set(), events: new Set() })
  const s = sourceOf.get(key)
  s.files.push(i.file)
  if (i.folder) s.folders.add(i.folder)
  for (const r of i.journey.rows) s.events.add(r.event)
}
const repeatedRows = new Map(dataset.health.repeated_journeys.map(r => [`${r.user_id}|${r.match_id}`, r.repeated_rows]))

// ---------- 3. tables ----------
const journeyRows = []
const matchRows = []
const eventRows = []
for (const m of dataset.matches) {
  const map = maps[m.map]
  matchRows.push({
    match_id: m.id, map_id: m.map, date: m.date,
    start_utc: isoUtc(m.start), end_utc: isoUtc(m.start + m.duration), duration_s: m.duration,
    folder_dates: [...new Set(m.journeys.flatMap(j => [...sourceOf.get(`${j.user_id}|${m.id}`).folders]))].sort(),
    journeys: m.journeys.length, humans: m.humans, bots: m.bots,
    kills: m.counts.Kill, bot_kills: m.counts.BotKill, killed_by_player: m.counts.Killed,
    killed_by_bot: m.counts.BotKilled, storm_deaths: m.counts.KilledByStorm, loot: m.counts.Loot
  })

  for (const j of m.journeys) {
    const src = sourceOf.get(`${j.user_id}|${m.id}`)
    const cls = classifyPlayer(j.user_id, [...src.events])
    const count = type => j.events.filter(e => e[0] === type).length
    const times = [j.path[0], j.path.at(-3), ...j.events.map(e => e[1])].filter(Number.isFinite)
    const firstDeath = Math.min(...j.events.filter(e => DEATHS.has(e[0])).map(e => e[1]))
    let outside = 0; let afterDeath = 0
    for (let i = 0; i < j.path.length; i += 3) {
      if (map && !isInsideMap(worldToUV(j.path[i + 1], j.path[i + 2], map))) outside++
      if (j.path[i] > firstDeath) afterDeath++
    }
    for (const [type, t, x, z] of j.events) {
      const uv = map ? worldToUV(x, z, map) : { u: '', v: '' }
      if (map && !isInsideMap(uv)) outside++
      eventRows.push({
        match_id: m.id, map_id: m.map, date: m.date, user_id: j.user_id, bot: j.bot,
        t_s: t, event: type, x, z,
        u: uv.u === '' ? '' : uv.u.toFixed(4), v: uv.v === '' ? '' : uv.v.toFixed(4)
      })
    }
    journeyRows.push({
      user_id: j.user_id, match_id: m.id, map_id: m.map, date: m.date,
      bot: j.bot, bot_by_id: cls.botById, bot_by_events: cls.botByEvents ?? '', id_conflict: j.id_conflict,
      start_utc: isoUtc(m.start + Math.min(...times)), end_utc: isoUtc(m.start + Math.max(...times)),
      duration_s: Math.max(...times) - Math.min(...times),
      positions: j.path.length / 3, loot: count('Loot'), kills: count('Kill'), bot_kills: count('BotKill'),
      killed_by_player: count('Killed'), killed_by_bot: count('BotKilled'), storm_death: count('KilledByStorm'),
      points_outside: outside, moves_after_death: afterDeath,
      files: src.files.length, repeated_rows: repeatedRows.get(`${j.user_id}|${m.id}`) ?? 0,
      folders: [...src.folders].sort()
    })
  }
}
eventRows.sort((a, b) => a.match_id.localeCompare(b.match_id) || a.t_s - b.t_s || a.user_id.localeCompare(b.user_id) || a.event.localeCompare(b.event))

// ---------- 4. write ----------
const write = (name, columns, rows) => writeText(join(outDir, name), toCsv(columns, rows))
await write('files.csv', ['path', 'folder', 'bytes', 'sha256', 'user_id', 'match_id', 'map_ids', 'ts_unit', 'rows', 'ts_backwards', 'event_types', 'parsed_ok', 'error'], fileRows)
await write('journeys.csv', ['user_id', 'match_id', 'map_id', 'date', 'bot', 'bot_by_id', 'bot_by_events', 'id_conflict', 'start_utc', 'end_utc', 'duration_s', 'positions', 'loot', 'kills', 'bot_kills', 'killed_by_player', 'killed_by_bot', 'storm_death', 'points_outside', 'moves_after_death', 'files', 'repeated_rows', 'folders'], journeyRows)
await write('matches.csv', ['match_id', 'map_id', 'date', 'start_utc', 'end_utc', 'duration_s', 'folder_dates', 'journeys', 'humans', 'bots', 'kills', 'bot_kills', 'killed_by_player', 'killed_by_bot', 'storm_deaths', 'loot'], matchRows)
await write('events.csv', ['match_id', 'map_id', 'date', 'user_id', 'bot', 't_s', 'event', 'x', 'z', 'u', 'v'], eventRows)

console.log([
  `Extracted ${fileRows.length} files (${fileRows.filter(f => !f.parsed_ok).length} failed) in ${((Date.now() - started) / 1000).toFixed(1)} s`,
  `  journeys ${journeyRows.length} · matches ${matchRows.length} · events ${eventRows.length}`,
  `Wrote files.csv, journeys.csv, matches.csv, events.csv to ${relative(process.cwd(), outDir) || '.'}`,
  `Next: node tools/audit.mjs ${relative(process.cwd(), outDir) || '.'}`
].join('\n'))
