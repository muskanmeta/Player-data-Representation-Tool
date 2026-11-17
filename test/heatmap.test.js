// Tests for js/data/heatmap.js: binning, blur, colour, and ignored areas.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countGrid, blur, densityGrid, colorize, rampColor, reachableCells, ignoredCells } from '../js/data/heatmap.js'

// A 100 x 100 world mapped onto the unit square: x in [0, 100), z in [0, 100).
const map = { scale: 100, originX: 0, originZ: 0 }
const match = journeys => ({ journeys })
const human = (user_id, path, events = []) => ({ user_id, bot: false, path, events })
const bot = (user_id, path) => ({ user_id, bot: true, path, events: [] })

test('countGrid bins human path samples into the right cell (z flipped: high z = top row)', () => {
  // size 2: x 75 -> column 1; z 75 -> v = 1 - 0.75 = 0.25 -> row 0
  const g = countGrid([match([human('h', [0, 75, 75, 5, 75, 75])])], map, 'traffic', { size: 2 })
  assert.deepEqual([...g], [0, 2, 0, 0])
})

test('countGrid respects the playhead, bot/human split, hidden players and off-map points', () => {
  const ms = [match([
    human('h', [0, 10, 10, 50, 10, 10, 60, 500, 500]),
    bot('b', [0, 10, 10])
  ])]
  assert.equal(sum(countGrid(ms, map, 'traffic', { size: 2, t: 10 })), 1)
  assert.equal(sum(countGrid(ms, map, 'traffic', { size: 2 })), 2) // the off-map point is dropped
  assert.equal(sum(countGrid(ms, map, 'botTraffic', { size: 2 })), 1)
  assert.equal(sum(countGrid(ms, map, 'traffic', { size: 2, hidden: new Set(['h']) })), 0)
})

test('countGrid counts only the event types of the mode', () => {
  const ms = [match([human('h', [], [['BotKill', 1, 10, 10], ['Loot', 2, 10, 10], ['KilledByStorm', 3, 10, 10]])])]
  assert.equal(sum(countGrid(ms, map, 'kills', { size: 2 })), 1)
  assert.equal(sum(countGrid(ms, map, 'deaths', { size: 2 })), 1)
  assert.equal(sum(countGrid(ms, map, 'loot', { size: 2 })), 1)
})

test('blur spreads a single value but keeps the total for interior cells', () => {
  const g = new Float32Array(25); g[12] = 9
  const b = blur(g, 5)
  assert.equal(b[12], 1)
  assert.ok(Math.abs(sum(b) - 9) < 1e-6)
})

test('densityGrid reports the raw total before blurring', () => {
  const d = densityGrid([match([human('h', [0, 10, 10, 1, 90, 90])])], map, 'traffic', { size: 8 })
  assert.equal(d.total, 2)
  assert.ok(d.max > 0)
})

test('colorize leaves empty cells transparent and makes the hottest cell opaque red', () => {
  const px = colorize({ grid: Float32Array.from([0, 4, 0, 0]), size: 2, max: 4 })
  assert.deepEqual([...px.slice(0, 4)], [0, 0, 0, 0])
  assert.deepEqual([...px.slice(4, 8)], [255, 60, 40, 255])
  assert.deepEqual(rampColor(0), [30, 60, 160])
})

test('ignored cells are reachable cells with no human sample in or next to them', () => {
  // size 4. A bot walked the whole top row; a human only the left end of it.
  const all = [match([bot('b', [0, 10, 90, 1, 35, 90, 2, 60, 90, 3, 90, 90])])]
  const view = [match([human('h', [0, 10, 90])])]
  const reach = reachableCells(all, map, 4)
  assert.deepEqual([...reach.slice(0, 4)], [1, 1, 1, 1])
  const { mask, ignored, reachable } = ignoredCells(view, map, reach, { size: 4 })
  assert.equal(reachable, 4)
  assert.deepEqual([...mask.slice(0, 4)], [0, 0, 1, 1]) // column 1 is next to the human, so not ignored
  assert.equal(ignored, 2)
})

function sum (a) { let s = 0; for (const v of a) s += v; return s }

test('event heatmaps count human journeys only (bot events mirror human ones)', () => {
  const ms = [match([
    human('h', [], [['BotKill', 1, 10, 10]]),
    { user_id: '7', bot: true, path: [], events: [['BotKilled', 1, 10, 10]] }
  ])]
  assert.equal(sum(countGrid(ms, map, 'kills', { size: 2 })), 1)
  assert.equal(sum(countGrid(ms, map, 'deaths', { size: 2 })), 0)
})
