// Tests for the view-model (js/data/select.js) and the display helpers (js/data/events.js).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  filterMatches, viewMatches, countByDate, pointsUntil, positionAt, summarize, viewDuration
} from '../js/data/select.js'
import { formatClock, formatDay, eventLabel } from '../js/data/events.js'

const counts = (k = 0) => ({ Kill: 0, Killed: 0, BotKill: k, BotKilled: 0, KilledByStorm: 0, Loot: 0 })
const journey = (user_id, bot, path = [], events = []) => ({ user_id, bot, path, events })
const dataset = {
  dates: ['2026-02-10', '2026-02-11'],
  maps: ['A', 'B'],
  matches: [
    { id: 'm1', map: 'A', date: '2026-02-10', start: 1, duration: 300, humans: 1, bots: 0, counts: counts(2), journeys: [journey('h1', false)] },
    { id: 'm2', map: 'A', date: '2026-02-11', start: 2, duration: 600, humans: 2, bots: 1, counts: counts(0), journeys: [journey('h1', false), journey('h2', false), journey('9', true)] },
    { id: 'm3', map: 'B', date: '2026-02-10', start: 3, duration: 100, humans: 1, bots: 0, counts: counts(0), journeys: [journey('h3', false)] }
  ]
}

test('filterMatches keeps one map and date, and sorts by the chosen key', () => {
  assert.deepEqual(filterMatches(dataset, { map: 'A' }).map(m => m.id), ['m2', 'm1'])
  assert.deepEqual(filterMatches(dataset, { map: 'A', sort: 'kills' }).map(m => m.id), ['m1', 'm2'])
  assert.deepEqual(filterMatches(dataset, { map: 'A', date: '2026-02-10' }).map(m => m.id), ['m1'])
})

test('filterMatches "2+ players" drops single-journey matches; search matches the id', () => {
  assert.deepEqual(filterMatches(dataset, { map: 'A', minPlayers: 2 }).map(m => m.id), ['m2'])
  assert.deepEqual(filterMatches(dataset, { map: 'A', search: 'M1' }).map(m => m.id), ['m1'])
})

test('viewMatches shows the chosen match only, or the filtered list', () => {
  assert.deepEqual(viewMatches(dataset, { map: 'A', match: 'm3' }).map(m => m.id), ['m3'])
  assert.deepEqual(viewMatches(dataset, { map: 'A', match: 'missing' }), [])
  assert.equal(viewMatches(dataset, { map: 'A', match: null }).length, 2)
})

test('countByDate counts matches per date on one map, with zeros kept', () => {
  assert.deepEqual(countByDate(dataset, 'B'), { '2026-02-10': 1, '2026-02-11': 0 })
})

test('viewDuration is the longest match in view', () => {
  assert.equal(viewDuration(dataset.matches), 600)
  assert.equal(viewDuration([]), 1)
})

const path = [0, 0, 0, 10, 100, 0, 20, 100, 50]

test('pointsUntil counts samples at or before t (binary search)', () => {
  assert.equal(pointsUntil(path, -1), 0)
  assert.equal(pointsUntil(path, 0), 1)
  assert.equal(pointsUntil(path, 15), 2)
  assert.equal(pointsUntil(path, 20), 3)
  assert.equal(pointsUntil(path, 999), 3)
})

test('positionAt interpolates between samples and holds the last one', () => {
  assert.equal(positionAt(path, -1), null)
  assert.deepEqual(positionAt(path, 5), { x: 50, z: 0, ended: false })
  assert.deepEqual(positionAt(path, 15), { x: 100, z: 25, ended: false })
  assert.deepEqual(positionAt(path, 30), { x: 100, z: 50, ended: true })
})

test('summarize counts players and events up to t, skipping hidden players', () => {
  const m = { journeys: [
    journey('h1', false, [], [['Loot', 5, 0, 0], ['BotKill', 50, 0, 0]]),
    journey('7', true, [], [['BotKilled', 10, 0, 0]])
  ] }
  assert.deepEqual(summarize([m], 20), { matches: 1, humans: 1, bots: 1, events: { Loot: 1, BotKilled: 1 } })
  assert.deepEqual(summarize([m], Infinity, new Set(['7'])).events, { Loot: 1, BotKill: 1 })
})

test('formatClock reads as match time, not epoch numbers', () => {
  assert.equal(formatClock(0), '0:00')
  assert.equal(formatClock(192), '3:12')
  assert.equal(formatClock(3725), '1:02:05')
})

test('formatDay and eventLabel use designer language', () => {
  assert.equal(formatDay('2026-02-13'), 'Feb 13')
  assert.equal(eventLabel('KilledByStorm'), 'Storm death')
  assert.equal(eventLabel('BotKilled'), 'Killed by a bot')
  assert.equal(eventLabel('Jump'), 'Other event (Jump)')
  assert.equal(eventLabel('BotKilled', true), 'Bot was killed')
})
