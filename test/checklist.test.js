// checklist.test.js: the brief's "Quick checklist before you submit", one test group per item,
// run against the real bundled dataset (data/default/dataset.json) and the real docs.
//
// Rendering is checked with a recording canvas: a fake 2D context that logs what the app
// actually strokes, fills and stamps, so "humans look different from bots" is tested on the
// drawing calls, not on a screenshot.
//
// The live-site check needs the network and runs only with CHECK_LIVE=1:
//   CHECK_LIVE=1 npm test

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// ---------- minimal browser stand-ins, so render modules run in Node ----------

/** A fake CanvasRenderingContext2D that records state at every stroke, fill and stamp. */
function recordingContext () {
  const log = { strokes: [], fills: [], stamps: 0, shapes: [] }
  let dash = []
  const ctx = {
    log,
    strokeStyle: '', fillStyle: '', lineWidth: 1, globalAlpha: 1, lineJoin: '', lineCap: '',
    save () {}, restore () {}, scale () {}, setTransform () {}, beginPath () {}, closePath () {},
    moveTo () { log.shapes.push('moveTo') }, lineTo () { log.shapes.push('lineTo') },
    arc () { log.shapes.push('arc') }, rect () { log.shapes.push('rect') },
    setLineDash (d) { dash = [...d] }, getLineDash () { return dash },
    stroke () { log.strokes.push({ style: this.strokeStyle, dash: [...dash] }) },
    fill () { log.fills.push(this.fillStyle) },
    drawImage () { log.stamps++ },
    clearRect () {}, fillRect () {}
  }
  return ctx
}

globalThis.window ??= { devicePixelRatio: 1 }
globalThis.document ??= {
  createElement: () => {
    const c = { width: 0, height: 0, style: {}, setAttribute () {} }
    c.getContext = () => recordingContext()
    return c
  }
}

const { EVENT_TYPES, HEATMAPS } = await import('../js/data/events.js')
const { drawMarker } = await import('../js/render/markers.js')
const { journeysLayer, BOT_COLOR, HUMAN_COLOR } = await import('../js/render/layers.js')
const { filterMatches, viewMatches, summarize, positionAt, viewDuration, pointsUntil } = await import('../js/data/select.js')
const { densityGrid } = await import('../js/data/heatmap.js')
const { worldToUV, uvToPixel, isInsideMap } = await import('../js/map/mapping.js')

const readText = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const dataset = JSON.parse(await readText('data/default/dataset.json'))
const { maps } = JSON.parse(await readText('data/maps.json'))
const README = await readText('README.md')
const ARCHITECTURE = await readText('ARCHITECTURE.md')
const INSIGHTS = await readText('INSIGHTS.md')

// A match with both humans and bots recorded, used for the single-match checks.
const mixedMatch = dataset.matches
  .filter(m => m.humans > 0 && m.bots > 0)
  .sort((a, b) => b.journeys.length - a.journeys.length || a.id.localeCompare(b.id))[0]

const liveUrl = README.match(/\*\*Live:\*\*\s*\[?<?(https:\/\/[^\s>)\]]+)/)?.[1]

// ---------------------------------------------------------------------------------------

describe('1. Tool is live at the hosted URL', () => {
  test('README states the live URL', () => {
    assert.ok(liveUrl, 'README "**Live:**" line has no https:// URL yet')
  })

  test('the live site and its dataset respond', { skip: process.env.CHECK_LIVE ? false : 'set CHECK_LIVE=1 (needs network)' }, async () => {
    assert.ok(liveUrl, 'no live URL in README')
    const page = await fetch(liveUrl)
    assert.equal(page.status, 200, `${liveUrl} returned ${page.status}`)
    const data = await fetch(new URL('data/default/dataset.json', liveUrl))
    assert.equal(data.status, 200, 'dataset.json is not served')
  })
})

describe('2. Player paths render correctly on the minimap', () => {
  test('README worked example lands at (78, 890) on a 1024 px Ambrose Valley minimap', () => {
    const p = uvToPixel(worldToUV(-301.45, -355.55, maps.AmbroseValley), { width: 1024, height: 1024 })
    assert.deepEqual([Math.round(p.x), Math.round(p.y)], [78, 890])
  })

  test('every match is on a map that has minimap settings', () => {
    for (const m of dataset.matches) assert.ok(maps[m.map], `match ${m.id} is on unknown map ${m.map}`)
  })

  test('every recorded position (89k rows) falls inside its own minimap', () => {
    let points = 0
    for (const m of dataset.matches) {
      for (const j of m.journeys) {
        for (let i = 0; i < j.path.length; i += 3) {
          points++
          assert.ok(isInsideMap(worldToUV(j.path[i + 1], j.path[i + 2], maps[m.map])),
            `${m.map} match ${m.id}: (${j.path[i + 1]}, ${j.path[i + 2]}) is off the map`)
        }
      }
    }
    assert.ok(points > 70000, `expected the full sample, saw ${points} positions`)
  })
})

describe('3. Humans can be told apart from bots visually', () => {
  test('the sample has both humans and bots, and the per-match counts add up', () => {
    let humans = 0; let bots = 0
    for (const m of dataset.matches) {
      assert.equal(m.humans + m.bots, m.journeys.length, m.id)
      humans += m.humans; bots += m.bots
    }
    assert.ok(humans > 0 && bots > 0)
  })

  test('drawn paths: bots dashed grey, humans solid in a different colour', () => {
    const ctx = recordingContext()
    const colors = new Map(mixedMatch.journeys.filter(j => !j.bot).map(j => [j.user_id, '#ff00aa']))
    const scene = {
      matches: [mixedMatch], t: Infinity, single: true, off: new Set(), hidden: new Set(),
      focus: null, trail: false, colors, showHeads: false, heat: null
    }
    journeysLayer(scene)(ctx, { toCanvas: (x, z) => ({ x, y: z }), zoom: 1, moving: false })

    const botStrokes = ctx.log.strokes.filter(s => s.style === BOT_COLOR)
    const humanStrokes = ctx.log.strokes.filter(s => s.style !== BOT_COLOR)
    assert.equal(botStrokes.length, mixedMatch.bots, 'one dashed stroke per bot')
    assert.equal(humanStrokes.length, mixedMatch.humans, 'one solid stroke per human')
    for (const s of botStrokes) assert.ok(s.dash.length > 0, 'bot paths are dashed')
    for (const s of humanStrokes) assert.deepEqual(s.dash, [], 'human paths are solid')
    assert.notEqual(BOT_COLOR, HUMAN_COLOR)
  })
})

describe('4. Kill, death, loot and storm events are marked', () => {
  const required = ['Kill', 'Killed', 'BotKill', 'BotKilled', 'KilledByStorm', 'Loot']

  test('every event type has its own marker shape AND its own colour', () => {
    for (const type of required) assert.ok(EVENT_TYPES[type], `${type} has no marker`)
    const shapes = required.map(t => EVENT_TYPES[t].shape)
    const colors = required.map(t => EVENT_TYPES[t].color.toLowerCase())
    assert.equal(new Set(shapes).size, required.length, `shapes repeat: ${shapes}`)
    assert.equal(new Set(colors).size, required.length, `colours repeat: ${colors}`)
  })

  test('markers are drawn in their own colour', () => {
    for (const type of required) {
      const ctx = recordingContext()
      drawMarker(ctx, type, 10, 10, 5)
      assert.deepEqual(ctx.log.fills, [EVENT_TYPES[type].color], type)
    }
  })

  test('labels use designer language, not raw event names', () => {
    for (const type of required) {
      const { label } = EVENT_TYPES[type]
      assert.notEqual(label, type, `${type} shows its raw name`)
      assert.doesNotMatch(label, /[a-z][A-Z]/, `"${label}" looks like a CamelCase code name`)
    }
  })

  test('each event type occurs in the sample, and one marker is stamped per event', () => {
    const seen = new Set(dataset.matches.flatMap(m => m.journeys.flatMap(j => j.events.map(e => e[0]))))
    for (const type of required) assert.ok(seen.has(type), `no ${type} in the sample`)

    const ctx = recordingContext()
    const scene = {
      matches: [mixedMatch], t: Infinity, single: true, off: new Set(), hidden: new Set(),
      focus: null, trail: false, colors: new Map(), showHeads: false, heat: null
    }
    journeysLayer(scene)(ctx, { toCanvas: (x, z) => ({ x, y: z }), zoom: 1, moving: false })
    const events = mixedMatch.journeys.reduce((n, j) => n + j.events.length, 0)
    assert.equal(ctx.log.stamps, events)
  })
})

describe('5. Filtering by map, date and match works', () => {
  test('map + date filters return only that map and date, and together cover every match', () => {
    let total = 0
    for (const map of dataset.maps) {
      for (const date of dataset.dates) {
        const list = filterMatches(dataset, { map, date })
        for (const m of list) assert.ok(m.map === map && m.date === date)
        total += list.length
      }
      assert.equal(filterMatches(dataset, { map }).length, dataset.matches.filter(m => m.map === map).length)
    }
    assert.equal(total, dataset.matches.length)
  })

  test('choosing a match shows exactly that match', () => {
    const view = viewMatches(dataset, { map: mixedMatch.map, date: 'all', match: mixedMatch.id })
    assert.deepEqual(view.map(m => m.id), [mixedMatch.id])
  })

  test('"2+ players" keeps only matches with several recorded journeys', () => {
    for (const map of dataset.maps) {
      for (const m of filterMatches(dataset, { map, minPlayers: 2 })) assert.ok(m.journeys.length >= 2)
    }
  })
})

describe('6. Timeline / playback shows match progression', () => {
  test('the timeline spans the match and events accumulate as the playhead moves', () => {
    const duration = viewDuration([mixedMatch])
    assert.equal(duration, mixedMatch.duration)
    let previous = -1
    for (let t = 0; t <= duration; t += Math.max(1, Math.floor(duration / 20))) {
      const s = summarize([mixedMatch], t)
      const events = Object.values(s).filter(v => typeof v === 'number').reduce((a, b) => a + b, 0)
      assert.ok(events >= previous, `counts went down at t=${t}`)
      previous = events
    }
  })

  test('players move along their paths as time passes', () => {
    const j = mixedMatch.journeys.find(x => x.path.length >= 9)
    const start = positionAt(j.path, j.path[0])
    const end = positionAt(j.path, j.path.at(-3))
    assert.ok(start.x !== end.x || start.z !== end.z, 'position did not change over the journey')
    assert.ok(pointsUntil(j.path, 0) <= pointsUntil(j.path, mixedMatch.duration))
  })
})

describe('7. Heatmaps show kill zones, death zones and traffic', () => {
  for (const mode of ['kills', 'deaths', 'traffic']) {
    test(`"${HEATMAPS[mode].label}" heatmap has hot spots on every map`, () => {
      for (const mapId of dataset.maps) {
        const onMap = dataset.matches.filter(m => m.map === mapId)
        const grid = densityGrid(onMap, maps[mapId], mode)
        assert.ok(grid.max > 0, `${mode} on ${mapId} is empty`)
      }
    })
  }
})

describe('8. Architecture doc covers the coordinate mapping approach', () => {
  const section = ARCHITECTURE.split(/^## /m).find(s => /^Coordinate mapping/i.test(s)) ?? ''

  test('ARCHITECTURE.md has a coordinate mapping section with the formula and the y-flip', () => {
    assert.ok(section, 'no "## Coordinate mapping" section')
    assert.match(section, /originX/)
    assert.match(section, /scale/)
    assert.match(section, /1\s*[−-]\s*v/, 'the y-flip (1 − v) is not explained')
  })

  test('it explains the real image sizes and the y = height detail', () => {
    assert.match(section, /1024/)
    assert.match(section, /UV/)
    assert.match(section, /height|elevation/i)
  })

  test('the other required sections exist: stack, data flow, assumptions, trade-offs', () => {
    for (const heading of [/^## .*built with/im, /^## Data flow/im, /^## Assumptions/im, /^## Trade-offs/im]) {
      assert.match(ARCHITECTURE, heading)
    }
  })
})

describe('9. Three insights with supporting evidence', () => {
  const insights = INSIGHTS.split(/^## \d+\. /m).slice(1)

  test('INSIGHTS.md has exactly three insights', () => {
    assert.equal(insights.length, 3)
  })

  test('each insight answers the brief: what caught my eye, evidence, actions + metrics, why a designer cares', () => {
    insights.forEach((text, i) => {
      assert.match(text, /\*\*What caught my eye/i, `insight ${i + 1}`)
      assert.match(text, /\*\*Evidence/i, `insight ${i + 1}`)
      assert.match(text, /\*\*Actions/i, `insight ${i + 1}`)
      assert.match(text, /Metrics?:/i, `insight ${i + 1} names no metric`)
      assert.match(text, /\*\*Why a level designer should care/i, `insight ${i + 1}`)
      assert.match(text, /\d/, `insight ${i + 1} has no numbers`)
    })
  })
})

describe('10. Walkthrough covers all major features', () => {
  test('README links the walkthrough video', () => {
    assert.match(README, /walkthrough[^\n]*https:\/\//i, 'README has no walkthrough link yet')
  })
})
