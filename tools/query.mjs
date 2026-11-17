// query.mjs: pulls a slice of the extracted tables as CSV, for INSIGHTS.md or a spreadsheet.
//
//   node tools/query.mjs out/feb --table events --map AmbroseValley --event KilledByStorm
//   node tools/query.mjs out/feb --table matches --date 2026-02-13 --min-humans 2 --out out/slice.csv
//   node tools/query.mjs out/feb --table events --event BotKill --group-by map_id
//
// Filters (all optional, combined with AND):
//   --table events|journeys|matches   (default events)
//   --map <map_id>  --date <YYYY-MM-DD>  --match <match_id>
//   --event <type[,type]>             events table only
//   --bot 0|1                         events and journeys tables
//   --min-humans <n>                  only matches with at least n humans
//   --from <s> --to <s>               events table: seconds into the match
//   --group-by <column>               print counts per value instead of rows
// Writes to --out, or prints to the terminal.

import { join, resolve } from 'node:path'
import { parseArgs, readCsv, toCsv, writeText } from './lib/common.mjs'

const args = parseArgs()
const dir = resolve(args._[0] ?? 'out/extract')
const table = args.table ?? 'events'
if (!['events', 'journeys', 'matches'].includes(table)) {
  console.error('--table must be events, journeys or matches')
  process.exit(2)
}

let rows = await readCsv(join(dir, `${table}.csv`))
const columns = rows.length ? Object.keys(rows[0]) : []

if (args['min-humans']) {
  const keep = new Set((await readCsv(join(dir, 'matches.csv')))
    .filter(m => Number(m.humans) >= Number(args['min-humans'])).map(m => m.match_id))
  rows = rows.filter(r => keep.has(r.match_id))
}
if (args.map) rows = rows.filter(r => r.map_id === args.map)
if (args.date) rows = rows.filter(r => r.date === args.date)
if (args.match) rows = rows.filter(r => r.match_id === args.match)
if (args.bot !== undefined) rows = rows.filter(r => r.bot === String(args.bot))
if (args.event) {
  const wanted = new Set(String(args.event).split(','))
  rows = rows.filter(r => wanted.has(r.event))
}
if (args.from) rows = rows.filter(r => Number(r.t_s) >= Number(args.from))
if (args.to) rows = rows.filter(r => Number(r.t_s) <= Number(args.to))

let out
if (args['group-by']) {
  const key = args['group-by']
  const counts = new Map()
  for (const r of rows) counts.set(r[key], (counts.get(r[key]) ?? 0) + 1)
  out = toCsv([key, 'count'], [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(b[0])).map(([k, n]) => ({ [key]: k, count: n })))
} else {
  out = toCsv(columns, rows)
}

if (args.out) {
  await writeText(resolve(args.out), out)
  console.log(`${rows.length} rows -> ${args.out}`)
} else {
  process.stdout.write(out)
}
