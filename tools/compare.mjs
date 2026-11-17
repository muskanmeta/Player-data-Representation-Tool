// compare.mjs: what does a new drop add, change or repeat compared with an old one?
//
//   node tools/compare.mjs out/feb out/mar [--out out/mar]
//
// Reads matches.csv and journeys.csv from both extract folders and writes
//   compare.csv  one row per match: added | removed | changed | same, with both sides' counts
//   compare.md   totals, per map and per date, and how many players are new
// Run it before loading a new drop into the tool, so overlaps are expected, not a surprise.

import { join, resolve, relative } from 'node:path'
import { parseArgs, readCsv, toCsv, writeText } from './lib/common.mjs'

const args = parseArgs()
const [a, b] = args._.map(p => resolve(p))
if (!a || !b) {
  console.error('Usage: node tools/compare.mjs <old extract folder> <new extract folder> [--out folder]')
  process.exit(2)
}
const outDir = resolve(args.out ?? b)

const load = async dir => ({
  matches: new Map((await readCsv(join(dir, 'matches.csv'))).map(m => [m.match_id, m])),
  journeys: await readCsv(join(dir, 'journeys.csv'))
})
const [A, B] = await Promise.all([load(a), load(b)])

const rows = []
for (const id of [...new Set([...A.matches.keys(), ...B.matches.keys()])].sort()) {
  const x = A.matches.get(id); const y = B.matches.get(id)
  const status = !x ? 'added' : !y ? 'removed'
    : (x.journeys !== y.journeys || x.duration_s !== y.duration_s) ? 'changed' : 'same'
  rows.push({
    match_id: id, status, map_id: (y ?? x).map_id, date: (y ?? x).date,
    journeys_old: x?.journeys ?? '', journeys_new: y?.journeys ?? '',
    humans_old: x?.humans ?? '', humans_new: y?.humans ?? ''
  })
}
await writeText(join(outDir, 'compare.csv'), toCsv(Object.keys(rows[0] ?? { match_id: '' }), rows))

const count = (list, s) => list.filter(r => r.status === s).length
const usersA = new Set(A.journeys.filter(j => j.bot === '0').map(j => j.user_id))
const usersB = new Set(B.journeys.filter(j => j.bot === '0').map(j => j.user_id))
const newPlayers = [...usersB].filter(u => !usersA.has(u)).length
const groups = key => [...Map.groupBy(rows, r => r[key])].sort((p, q) => String(p[0]).localeCompare(q[0]))

const md = [
  '# Drop comparison', '',
  `Old: \`${relative(process.cwd(), a)}\` (${A.matches.size} matches) · New: \`${relative(process.cwd(), b)}\` (${B.matches.size} matches)`, '',
  '| Added | Removed | Changed | Same | New human players | Returning human players |', '|---:|---:|---:|---:|---:|---:|',
  `| ${count(rows, 'added')} | ${count(rows, 'removed')} | ${count(rows, 'changed')} | ${count(rows, 'same')} | ${newPlayers} | ${usersB.size - newPlayers} |`, '',
  ...['map_id', 'date'].flatMap(key => [
    `## By ${key === 'map_id' ? 'map' : 'date'}`, '',
    '| | Added | Removed | Changed | Same |', '|---|---:|---:|---:|---:|',
    ...groups(key).map(([k, list]) => `| ${k} | ${count(list, 'added')} | ${count(list, 'removed')} | ${count(list, 'changed')} | ${count(list, 'same')} |`), ''
  ])
].join('\n')
await writeText(join(outDir, 'compare.md'), md)

console.log(`added ${count(rows, 'added')} · removed ${count(rows, 'removed')} · changed ${count(rows, 'changed')} · same ${count(rows, 'same')} · new human players ${newPlayers}`)
console.log(`Wrote compare.md and compare.csv to ${relative(process.cwd(), outDir) || '.'}`)
