// stats.mjs: per-map numbers for level design questions, computed from a converted dataset.
// The evidence behind INSIGHTS.md comes from here, so every number can be re-run on a new drop.
//
//   node tools/stats.mjs [data/default/dataset.json] [--out out/stats]
//
// Writes stats.json (all numbers) and stats.md (readable tables). Uses the same grid code
// as the app's heatmaps (js/data/heatmap.js), so "ignored area" means the same thing here
// and on screen.

import { readFile } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
import { countGrid, reachableCells, IGNORE_GRID } from '../js/data/heatmap.js'
import { worldToUV } from '../js/map/mapping.js'
import { parseArgs, writeText, loadMaps, ROOT } from './lib/common.mjs'

const args = parseArgs()
const input = resolve(args._[0] ?? join(ROOT, 'data/default/dataset.json'))
const outDir = resolve(args.out ?? join(ROOT, 'out/stats'))
const dataset = JSON.parse(await readFile(input, 'utf8'))
const maps = await loadMaps()

const DEATHS = ['Killed', 'BotKilled', 'KilledByStorm']
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = s.length >> 1; return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2 }
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0)
const round = (v, k = 2) => Math.round(v * 10 ** k) / 10 ** k

/** Share of the total held by the busiest `frac` of the non-zero cells. */
function topShare (grid, frac) {
  const vals = [...grid].filter(v => v > 0).sort((a, b) => b - a)
  const total = vals.reduce((s, v) => s + v, 0)
  const top = vals.slice(0, Math.max(1, Math.round(vals.length * frac))).reduce((s, v) => s + v, 0)
  return pct(top, total)
}

/** Which third of the map (left/centre/right, top/middle/bottom) holds most of the points. */
function zoneOf (points, map) {
  const cols = ['west', 'centre', 'east']; const rows = ['north', 'middle', 'south']
  const counts = new Map()
  for (const [x, z] of points) {
    const { u, v } = worldToUV(x, z, map)
    const key = `${rows[Math.min(2, Math.max(0, Math.floor(v * 3)))]}-${cols[Math.min(2, Math.max(0, Math.floor(u * 3)))]}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([zone, n]) => ({ zone, n, share: pct(n, points.length) }))
}

const result = { schema_version: 1, input: relative(ROOT, input).replaceAll('\\', '/'), maps: {} }

for (const mapId of dataset.maps) {
  const map = maps[mapId]
  if (!map) continue
  const ms = dataset.matches.filter(m => m.map === mapId)
  const humans = ms.flatMap(m => m.journeys.filter(j => !j.bot).map(j => ({ ...j, duration: m.duration })))
  const bots = ms.flatMap(m => m.journeys.filter(j => j.bot))
  const ev = type => humans.flatMap(j => j.events.filter(e => e[0] === type))

  // How each human journey ended.
  const endings = { storm: 0, bot: 0, player: 0, survived: 0 }
  for (const j of humans) {
    const death = j.events.find(e => DEATHS.includes(e[0]))
    if (!death) endings.survived++
    else endings[{ KilledByStorm: 'storm', BotKilled: 'bot', Killed: 'player' }[death[0]]]++
  }

  // When fights happen: kills split into thirds of each match's length.
  const thirds = [0, 0, 0]
  for (const m of ms) {
    for (const j of m.journeys) {
      if (j.bot) continue
      for (const [type, t] of j.events) {
        if (type === 'BotKill' || type === 'Kill') thirds[Math.min(2, Math.floor((t / Math.max(1, m.duration)) * 3))]++
      }
    }
  }

  // Traffic concentration and ignored ground, on the same 64 x 64 grid as the app.
  const reach = reachableCells(ms, map, IGNORE_GRID)
  const traffic = countGrid(ms, map, 'traffic', { size: IGNORE_GRID })
  let reachable = 0; let unvisited = 0; let botOnly = 0
  const botTraffic = countGrid(ms, map, 'botTraffic', { size: IGNORE_GRID })
  for (let i = 0; i < reach.length; i++) {
    if (!reach[i]) continue
    reachable++
    if (traffic[i] === 0) { unvisited++; if (botTraffic[i] > 0) botOnly++ }
  }

  const storm = ev('KilledByStorm')
  const loot = ev('Loot')
  result.maps[mapId] = {
    name: map.name,
    matches: ms.length,
    matches_2plus_players: ms.filter(m => m.journeys.length >= 2).length,
    human_journeys: humans.length,
    bot_journeys: bots.length,
    median_match_s: median(ms.map(m => m.duration)),
    endings,
    endings_pct: Object.fromEntries(Object.entries(endings).map(([k, v]) => [k, pct(v, humans.length)])),
    kills: { pvp: ev('Kill').length, bots: ev('BotKill').length, per_human_journey: round(ev('BotKill').length / Math.max(1, humans.length)) },
    kills_by_match_third_pct: thirds.map(n => pct(n, thirds[0] + thirds[1] + thirds[2])),
    storm_deaths: {
      count: storm.length,
      median_t_s: median(storm.map(e => e[1])),
      zones: zoneOf(storm.map(e => [e[2], e[3]]), map).slice(0, 3)
    },
    loot: {
      count: loot.length,
      per_human_journey: round(loot.length / Math.max(1, humans.length), 1),
      top_10pct_cells_share: topShare(countGrid(ms, map, 'loot', { size: IGNORE_GRID }), 0.1)
    },
    traffic: {
      top_10pct_cells_share: topShare(traffic, 0.1),
      reachable_cells: reachable,
      cells_no_human_visit: unvisited,
      cells_no_human_visit_pct: pct(unvisited, reachable),
      cells_bots_only: botOnly
    },
    deaths_by_zone: zoneOf(humans.flatMap(j => j.events.filter(e => DEATHS.includes(e[0])).map(e => [e[2], e[3]])), map).slice(0, 3)
  }
}

await writeText(join(outDir, 'stats.json'), JSON.stringify(result, null, 2) + '\n')

const rows = (label, f) => `| ${label} | ${Object.values(result.maps).map(f).join(' | ')} |`
const md = [
  '# Map stats', '', `From \`${result.input}\`. Human journeys unless stated.`, '',
  `| | ${Object.values(result.maps).map(m => m.name).join(' | ')} |`,
  `|---|${Object.keys(result.maps).map(() => '---:').join('|')}|`,
  rows('Matches (2+ players)', m => `${m.matches} (${m.matches_2plus_players})`),
  rows('Human / bot journeys', m => `${m.human_journeys} / ${m.bot_journeys}`),
  rows('Median match length', m => `${Math.round(m.median_match_s / 60)} min`),
  rows('Survived (no death logged)', m => `${m.endings_pct.survived}%`),
  rows('Died to bots / storm / players', m => `${m.endings_pct.bot}% / ${m.endings_pct.storm}% / ${m.endings_pct.player}%`),
  rows('Bot kills per human journey', m => m.kills.per_human_journey),
  rows('PvP kills', m => m.kills.pvp),
  rows('Kills in 1st / 2nd / 3rd of match', m => m.kills_by_match_third_pct.map(v => `${v}%`).join(' / ')),
  rows('Storm deaths (median time)', m => `${m.storm_deaths.count} (${m.storm_deaths.median_t_s == null ? '–' : Math.round(m.storm_deaths.median_t_s / 60) + ' min'})`),
  rows('Storm deaths, top zone', m => m.storm_deaths.zones[0] ? `${m.storm_deaths.zones[0].zone} ${m.storm_deaths.zones[0].share}%` : '–'),
  rows('Loot per human journey', m => m.loot.per_human_journey),
  rows('Loot in busiest 10% of cells', m => `${m.loot.top_10pct_cells_share}%`),
  rows('Traffic in busiest 10% of cells', m => `${m.traffic.top_10pct_cells_share}%`),
  rows('Reachable ground never visited by humans', m => `${m.traffic.cells_no_human_visit_pct}% (${m.traffic.cells_no_human_visit} of ${m.traffic.reachable_cells} cells)`),
  rows('Deaths, top zone', m => m.deaths_by_zone[0] ? `${m.deaths_by_zone[0].zone} ${m.deaths_by_zone[0].share}%` : '–'),
  ''
].join('\n')
await writeText(join(outDir, 'stats.md'), md)
console.log(md)
