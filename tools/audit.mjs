// audit.mjs: checks an extracted drop for every data problem we know about.
//
//   node tools/audit.mjs out/feb
//
// Reads the CSVs written by tools/extract.mjs (plus data/maps.json) and writes
//   audit.json  machine-readable: { schema_version, checks: [{ id, title, severity, count, examples }] }
//   audit.md    the same as a short report to read or share
// Exit code 1 when a critical check fails (unreadable files, unknown maps, a match on two
// maps), so a build script stops on bad data. Everything else is reported, not fatal.

import { join, relative, resolve } from 'node:path'
import { readCsv, writeText, loadMaps, parseArgs } from './lib/common.mjs'
import { KNOWN_EVENTS } from '../js/data/parse.js'

const dir = resolve(parseArgs()._[0] ?? 'out/extract')
const [files, journeys, matches] = await Promise.all(['files', 'journeys', 'matches'].map(n => readCsv(join(dir, `${n}.csv`))))
const maps = await loadMaps()
const list = s => (s ? s.split(';') : [])
const num = s => Number(s) || 0
const checks = []

function check (id, title, severity, items, meaning) {
  checks.push({ id, title, severity, count: items.length, meaning, examples: items.slice(0, 20) })
}

// 1. Files that are not parquet or fail to parse
check('parse_failures', 'Files that could not be read', 'critical',
  files.filter(f => f.parsed_ok !== '1').map(f => ({ path: f.path, error: f.error })),
  'Not parquet (no PAR1 header) or broken. Their journeys are missing from the tool.')

// 2. Byte-identical files
const byHash = Map.groupBy(files, f => f.sha256)
check('identical_files', 'Byte-identical files', 'warning',
  [...byHash.values()].filter(g => g.length > 1).map(g => ({ sha256: g[0].sha256.slice(0, 12), paths: g.map(f => f.path) })),
  'The same file delivered twice. Merged by (player, match), so nothing is counted twice.')

// 3. Same player + match in several files: duplicate (rows overlap) or split (rows differ)
check('repeated_journeys', 'Journeys spread over several files', 'warning',
  journeys.filter(j => num(j.files) > 1).map(j => ({
    user_id: j.user_id, match_id: j.match_id, files: num(j.files),
    kind: num(j.repeated_rows) > 0 ? 'duplicate' : 'split', folders: list(j.folders)
  })),
  'Merged into one journey; rows already seen are dropped.')

// 4. Bot by ID disagrees with bot by events
check('bot_id_conflicts', 'Numeric IDs that behave like humans (or the reverse)', 'warning',
  journeys.filter(j => j.id_conflict === '1').map(j => ({ user_id: j.user_id, match_id: j.match_id, bot_by_events: j.bot_by_events })),
  'Classified by what they log (Position = human, BotPosition = bot), not by the ID rule.')

// 5. Timestamp unit, and time running backwards inside a file
const secondsFiles = files.filter(f => f.ts_unit === 's')
check('ts_seconds', 'Files storing seconds in the millisecond ts column', 'info',
  secondsFiles.map(f => ({ path: f.path })),
  'Detected by size (below 1e11 = seconds) and read as seconds.')
check('time_backwards', 'Files whose time runs backwards', 'warning',
  files.filter(f => num(f.ts_backwards) > 0).map(f => ({ path: f.path, steps_back: num(f.ts_backwards) })),
  'Rows are sorted by time before drawing.')

// 6. Folder date vs match start date; matches over several folders
check('folder_date_mismatch', 'Matches filed under a different day than their UTC start', 'info',
  matches.filter(m => m.date !== m.start_utc.slice(0, 10)).map(m => ({ match_id: m.match_id, folder_date: m.date, start_utc: m.start_utc })),
  'The folder date wins: it is how the data team splits days.')
check('multi_folder_matches', 'Matches spread over several day folders', 'info',
  matches.filter(m => list(m.folder_dates).length > 1).map(m => ({ match_id: m.match_id, folders: list(m.folder_dates) })),
  'Dated by the earliest folder.')

// 7. Coordinates outside the map
const outside = journeys.filter(j => num(j.points_outside) > 0)
check('points_outside_map', 'Journeys with points outside the minimap', 'warning',
  outside.map(j => ({ user_id: j.user_id, match_id: j.match_id, map_id: j.map_id, points: num(j.points_outside) })),
  'Usually a wrong scale or origin in data/maps.json. Off-map points are not drawn.')

// 8. Unknown map IDs or event types
check('unknown_maps', 'Map IDs with no settings in data/maps.json', 'critical',
  [...new Set(matches.map(m => m.map_id))].filter(id => !maps[id]).map(mapId => ({ map_id: mapId, matches: matches.filter(m => m.map_id === mapId).length })),
  'Drawn on a grid with a warning until an entry is added to data/maps.json.')
const unknownEvents = new Map()
for (const f of files) for (const e of list(f.event_types)) if (!KNOWN_EVENTS.includes(e)) unknownEvents.set(e, (unknownEvents.get(e) ?? 0) + 1)
check('unknown_events', 'Event types the tool does not know', 'warning',
  [...unknownEvents].sort().map(([event, files]) => ({ event, files })),
  'Shown as "Other event" markers.')

// 9. Journeys with no movement, or movement after a death
check('no_movement', 'Journeys with no position samples', 'warning',
  journeys.filter(j => num(j.positions) === 0).map(j => ({ user_id: j.user_id, match_id: j.match_id })),
  'Only their events can be drawn, no path.')
check('moves_after_death', 'Journeys that keep moving after dying', 'info',
  journeys.filter(j => num(j.moves_after_death) > 0).map(j => ({ user_id: j.user_id, match_id: j.match_id, samples: num(j.moves_after_death) })),
  'Possibly a respawn or spectating; drawn as recorded.')

// 10. Matches with only one recorded journey
check('single_journey_matches', 'Matches with only one recorded journey', 'info',
  matches.filter(m => num(m.journeys) === 1).map(m => ({ match_id: m.match_id, map_id: m.map_id })),
  'Most of the drop is partial. The match browser can hide them ("2+ players").')

// 11. One match, one map
const mixedFiles = files.filter(f => list(f.map_ids).length > 1).map(f => ({ path: f.path, map_ids: list(f.map_ids) }))
const mapsPerMatch = Map.groupBy(journeys, j => j.match_id)
const mixedMatches = [...mapsPerMatch].filter(([, js]) => new Set(js.map(j => j.map_id)).size > 1).map(([match_id, js]) => ({ match_id, map_ids: [...new Set(js.map(j => j.map_id))] }))
check('mixed_maps', 'A file or match that names more than one map', 'critical',
  [...mixedFiles, ...mixedMatches],
  'Every row of a match must be on the same map, or its paths would be drawn on the wrong image.')

// ---------- write ----------
const critical = checks.filter(c => c.severity === 'critical' && c.count > 0)
await writeText(join(dir, 'audit.json'), JSON.stringify({
  schema_version: 1,
  totals: { files: files.length, journeys: journeys.length, matches: matches.length },
  passed: critical.length === 0,
  checks
}, null, 2) + '\n')

const icon = c => (c.count === 0 ? 'OK ' : c.severity === 'critical' ? 'FAIL' : c.severity === 'warning' ? 'WARN' : 'INFO')
const md = [
  '# Data audit', '',
  `${files.length} files · ${journeys.length} journeys · ${matches.length} matches. ` +
  (critical.length ? `**${critical.length} critical check(s) failed.**` : 'No critical problems.'), '',
  '| | Check | Count | What it means |', '|---|---|---:|---|',
  ...checks.map(c => `| ${icon(c)} | ${c.title} | ${c.count} | ${c.meaning} |`), '',
  ...checks.filter(c => c.count > 0).flatMap(c => [
    `## ${c.title} (${c.count})`, '',
    ...c.examples.map(e => `- ${Object.entries(e).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ')}`),
    c.count > c.examples.length ? `- … and ${c.count - c.examples.length} more (see audit.json / the CSVs)` : '', ''
  ])
].join('\n')
await writeText(join(dir, 'audit.md'), md)

console.log(checks.map(c => `${icon(c).padEnd(4)}  ${String(c.count).padStart(5)}  ${c.title}`).join('\n'))
console.log(`Wrote audit.md and audit.json to ${relative(process.cwd(), dir) || '.'}`)
process.exit(critical.length ? 1 : 0)
