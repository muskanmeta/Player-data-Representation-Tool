// Tests for merging datasets (js/data/merge.js), share-link state (js/ui/url-state.js)
// and the upload helpers (js/data/import-files.js).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeDatasets } from '../js/data/merge.js'
import { viewToQuery, queryToView, DEFAULT_VIEW } from '../js/ui/url-state.js'
import { journeysFromCsv, parentFolder, importSources } from '../js/data/import-files.js'

const emptyCounts = { Kill: 0, Killed: 0, BotKill: 0, BotKilled: 0, KilledByStorm: 0, Loot: 0 }
const ds = matches => ({
  schema_version: 1, source: { files: 1 }, maps: ['A'], dates: ['2026-02-10'], health: { id_conflicts: [], single_journey_matches: 0 }, matches
})
const m = (id, start, journeys) => ({ id, map: 'A', date: '2026-02-10', start, duration: 0, humans: 0, bots: 0, counts: emptyCounts, journeys })

test('mergeDatasets adds new matches and new players, and skips repeats', () => {
  const base = ds([m('m1', 100, [{ user_id: 'a', bot: false, path: [0, 1, 1, 10, 2, 2], events: [] }])])
  const extra = ds([
    m('m1', 100, [{ user_id: 'a', bot: false, path: [0, 1, 1], events: [] }]),
    m('m2', 500, [{ user_id: 'b', bot: true, path: [0, 5, 5], events: [] }])
  ])
  const r = mergeDatasets(base, extra)
  assert.deepEqual(r.added, { matches: 1, journeys: 1 })
  assert.equal(r.repeated, 1)
  assert.equal(r.dataset.matches.length, 2)
  assert.equal(r.dataset.health.single_journey_matches, 2)
})

test('mergeDatasets shifts times when the new part of a match starts earlier', () => {
  const base = ds([m('m1', 100, [{ user_id: 'a', bot: false, path: [0, 1, 1], events: [['Loot', 5, 1, 1]] }])])
  const extra = ds([m('m1', 90, [{ user_id: 'b', bot: false, path: [0, 2, 2], events: [] }])])
  const merged = mergeDatasets(base, extra).dataset.matches[0]
  assert.equal(merged.start, 90)
  assert.deepEqual(merged.journeys[0].path, [10, 1, 1])     // a: shifted by 10 s
  assert.deepEqual(merged.journeys[0].events, [['Loot', 15, 1, 1]])
  assert.deepEqual(merged.journeys[1].path, [0, 2, 2])      // b: already from 90
  assert.equal(merged.duration, 15)
  assert.equal(merged.humans, 2)
  assert.equal(merged.counts.Loot, 1)
})

test('share links round-trip and stay short for the default view', () => {
  assert.equal(viewToQuery({ ...DEFAULT_VIEW, map: 'A' }), 'map=A')
  const view = { ...DEFAULT_VIEW, map: 'GrandRift', date: '2026-02-13', match: 'abc', heat: 'kills', t: 192.4, minPlayers: 2, sort: 'kills', off: ['bots', 'Loot'] }
  assert.deepEqual(queryToView(viewToQuery(view)), { ...view, t: 192, off: ['Loot', 'bots'] })
})

test('share links ignore malformed values instead of failing', () => {
  const v = queryToView('date=yesterday&heat=lava&t=-4&min=7&sort=random')
  assert.deepEqual(v, { ...DEFAULT_VIEW, off: [] })
})

test('parentFolder gives the day folder used for the date rule', () => {
  assert.equal(parentFolder('player_data/February_13/a_b.nakama-0'), 'February_13')
  assert.equal(parentFolder('a_b.nakama-0'), null)
})

test('journeysFromCsv groups rows by player and match and fixes the ts unit', () => {
  const csv = 'user_id,match_id,map_id,x,y,z,ts,event\n' +
    'u1,m1.nakama-0,A,1,0,2,1770754537,Position\n' +
    'u1,m1.nakama-0,A,3,0,4,1770754547000,Loot\n' +
    '1440,m1.nakama-0,A,5,0,6,1770754540,BotPosition\n'
  const js = journeysFromCsv(csv)
  assert.equal(js.length, 2)
  assert.equal(js[0].matchId, 'm1')
  assert.deepEqual(js[0].rows.map(r => r.t), [1770754537, 1770754547])
  assert.deepEqual(js[0].mapIds, ['A'])
})

test('importSources builds a dataset from CSV and reports files it cannot use', async () => {
  const enc = s => async () => new TextEncoder().encode(s)
  const { dataset, report } = await importSources([
    { path: 'drop/February_12/rows.csv', read: enc('user_id,match_id,map_id,x,y,z,ts,event\nu1,m1,A,1,0,2,1770854537,Position\n') },
    { path: 'drop/notes.bin', read: enc('hello') },
    { path: 'drop/README.md', read: enc('# readme') }
  ], { A: { scale: 100, originX: 0, originZ: 0 } })
  assert.equal(dataset.matches.length, 1)
  assert.equal(dataset.matches[0].date, '2026-02-12')
  assert.equal(report.files, 2) // README is skipped quietly
  assert.deepEqual(report.skipped.map(s => s.path), ['drop/notes.bin'])
})
