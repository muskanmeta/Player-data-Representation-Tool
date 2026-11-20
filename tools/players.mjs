// players.mjs: player-level numbers (outcomes by match number, coming back, requeue) for INSIGHTS.md.
// Reads the journeys table written by extract.mjs, so it works on any drop.
//
//   node tools/players.mjs out/feb [--out out/players]
//
// Writes players.json and players.md, and prints the tables. Humans only.
// "First match" means the first match recorded in the drop, not the player's first match ever.

import { join, resolve } from 'node:path'
import { parseArgs, readCsv, writeText } from './lib/common.mjs'

const args = parseArgs()
const dir = resolve(args._[0] ?? 'out/extract')
const outDir = resolve(args.out ?? 'out/players')
const REQUEUE_MIN = 30

const journeys = (await readCsv(join(dir, 'journeys.csv'))).filter(j => j.bot === '0')
const outcome = j => +j.killed_by_bot > 0 ? 'bot' : +j.storm_death > 0 ? 'storm' : +j.killed_by_player > 0 ? 'player' : 'no death'
const OUTCOMES = ['bot', 'storm', 'player', 'no death']
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0)
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = s.length >> 1; return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2 }
const ms = iso => Date.parse(iso)

// Each human's journeys in time order.
const byPlayer = new Map()
for (const j of journeys) {
  if (!byPlayer.has(j.user_id)) byPlayer.set(j.user_id, [])
  byPlayer.get(j.user_id).push(j)
}
for (const list of byPlayer.values()) list.sort((a, b) => a.start_utc.localeCompare(b.start_utc))
const players = [...byPlayer.values()]
const dates = [...new Set(journeys.map(j => j.date))].sort()

const share = (list, o) => ({ n: list.filter(j => outcome(j) === o).length, of: list.length, pct: pct(list.filter(j => outcome(j) === o).length, list.length) })
function byMatchNumber (lists, cap) {
  const rows = []
  for (let k = 1; k <= cap; k++) {
    const at = lists.map(l => k < cap ? l[k - 1] : l.slice(cap - 1)).flat().filter(Boolean)
    rows.push({
      match: k < cap ? String(k) : `${cap}+`,
      journeys: at.length,
      bot_death_pct: share(at, 'bot').pct,
      no_death_pct: share(at, 'no death').pct,
      bot_death_before_5min_pct: pct(at.filter(j => outcome(j) === 'bot' && +j.duration_s < 300).length, at.length),
      median_loot: median(at.map(j => +j.loot)),
      median_minutes: Math.round(median(at.map(j => +j.duration_s / 60)) * 10) / 10
    })
  }
  return rows
}

// Requeue: did the player start another match within REQUEUE_MIN minutes of this one ending?
// Journeys that end within REQUEUE_MIN of the last recorded end on their day are left out,
// because a requeue after them could fall outside the drop.
const dayEnd = new Map()
for (const j of journeys) dayEnd.set(j.date, Math.max(dayEnd.get(j.date) ?? 0, ms(j.end_utc)))
const requeue = Object.fromEntries(OUTCOMES.map(o => [o, { journeys: 0, requeued: 0, gaps: [] }]))
for (const list of players) {
  list.forEach((j, i) => {
    if (ms(j.end_utc) > dayEnd.get(j.date) - REQUEUE_MIN * 60000) return
    const r = requeue[outcome(j)]
    r.journeys++
    const next = list[i + 1]
    if (!next) return
    const gap = (ms(next.start_utc) - ms(j.end_utc)) / 60000
    if (gap <= REQUEUE_MIN) { r.requeued++; r.gaps.push(gap) }
  })
}

// Coming back on a later day: only players first seen in the first three days, so they had time to return.
const early = players.filter(l => dates.indexOf(l[0].date) <= 2)
const cameBack = Object.fromEntries(OUTCOMES.map(o => {
  const group = early.filter(l => outcome(l[0]) === o)
  const back = group.filter(l => new Set(l.map(j => j.date)).size > 1).length
  return [o, { players: group.length, came_back: back, pct: pct(back, group.length) }]
}))

const counts = players.map(l => l.length)
const firsts = players.map(l => l[0])
const laters = players.flatMap(l => l.slice(1))
const cohort = players.filter(l => l.length >= 5)

const result = {
  schema_version: 1,
  humans: players.length,
  human_journeys: journeys.length,
  unique_humans_per_day: Object.fromEntries(dates.map(d => [d, new Set(journeys.filter(j => j.date === d).map(j => j.user_id)).size])),
  matches_per_human: { one: counts.filter(c => c === 1).length, five_plus: counts.filter(c => c >= 5).length, mean: Math.round((journeys.length / players.length) * 10) / 10 },
  first_vs_later: {
    first: { bot_death: share(firsts, 'bot'), bot_death_before_5min_pct: pct(firsts.filter(j => outcome(j) === 'bot' && +j.duration_s < 300).length, firsts.length) },
    later: { bot_death: share(laters, 'bot'), bot_death_before_5min_pct: pct(laters.filter(j => outcome(j) === 'bot' && +j.duration_s < 300).length, laters.length) }
  },
  by_match_number_all: byMatchNumber(players, 5),
  by_match_number_5plus_cohort: { players: cohort.length, rows: byMatchNumber(cohort.map(l => l.slice(0, 5)), 6).slice(0, 5) },
  requeue_within_30min: Object.fromEntries(OUTCOMES.map(o => [o, { journeys: requeue[o].journeys, requeued: requeue[o].requeued, pct: pct(requeue[o].requeued, requeue[o].journeys), median_gap_min: requeue[o].gaps.length ? Math.round(median(requeue[o].gaps) * 10) / 10 : null }])),
  came_back_later_day_by_first_outcome: { first_seen_by: dates[2], ...cameBack }
}

const table = (rows, cols) => [
  `| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`,
  ...rows.map(r => `| ${cols.map(c => r[c] ?? '–').join(' | ')} |`)
].join('\n')
const md = [
  '# Player-level numbers (humans)',
  '',
  `${result.humans} humans, ${result.human_journeys} journeys. "First match" = first match recorded in this drop.`,
  '',
  '## Unique humans per day',
  table(Object.entries(result.unique_humans_per_day).map(([date, n]) => ({ date, n })), ['date', 'n']),
  '',
  `Matches per human: ${result.matches_per_human.one} played one match, ${result.matches_per_human.five_plus} played 5 or more, mean ${result.matches_per_human.mean}.`,
  '',
  '## Outcome by match number (all humans)',
  table(result.by_match_number_all, ['match', 'journeys', 'bot_death_pct', 'no_death_pct', 'bot_death_before_5min_pct', 'median_loot', 'median_minutes']),
  '',
  `## Same players only: the ${cohort.length} humans with 5+ matches, their matches 1–5`,
  table(result.by_match_number_5plus_cohort.rows, ['match', 'journeys', 'bot_death_pct', 'no_death_pct', 'bot_death_before_5min_pct', 'median_loot', 'median_minutes']),
  '',
  `## Started another match within ${REQUEUE_MIN} min, by how the match ended`,
  table(OUTCOMES.map(o => ({ ended: o, ...result.requeue_within_30min[o] })), ['ended', 'journeys', 'requeued', 'pct', 'median_gap_min']),
  '',
  `## Came back on a later day, by how the first match ended (players first seen by ${dates[2]})`,
  table(OUTCOMES.map(o => ({ first_match: o, ...cameBack[o] })), ['first_match', 'players', 'came_back', 'pct'])
].join('\n')

await writeText(join(outDir, 'players.json'), JSON.stringify(result, null, 2) + '\n')
await writeText(join(outDir, 'players.md'), md + '\n')
console.log(md)
