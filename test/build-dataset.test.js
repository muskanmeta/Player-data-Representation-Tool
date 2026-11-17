// Tests for js/data/build-dataset.js. Run with: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDataset, folderToDate } from '../js/data/build-dataset.js'

const MAPS = { AmbroseValley: { scale: 900, originX: -370, originZ: -473 } }
const T0 = 1770754537 // 2026-02-10 in Unix seconds

function journey (userId, matchId, rows) {
  return { userId, matchId, mapId: 'AmbroseValley', rows }
}
const row = (dt, event = 'Position', x = 0, z = 0) => ({ t: T0 + dt, x, y: 0, z, event })

test('folderToDate turns a day folder into an ISO date', () => {
  assert.equal(folderToDate('February_10', 2026), '2026-02-10')
  assert.equal(folderToDate('march_3', 2026), '2026-03-03')
  assert.equal(folderToDate('misc', 2026), null)
})

test('data detail 6: the same journey in two folders is merged and its repeated rows dropped', () => {
  const rows = [row(0), row(5, 'Loot')]
  const d = buildDataset([
    { file: 'February_10/a_m1', folder: 'February_10', journey: journey('a', 'm1', rows) },
    { file: 'February_11/a_m1', folder: 'February_11', journey: journey('a', 'm1', rows) }
  ], { maps: MAPS })
  assert.equal(d.source.journeys, 1)
  assert.equal(d.source.rows_after_dedupe, 2)
  assert.equal(d.health.repeated_journeys[0].kind, 'duplicate')
  assert.equal(d.matches[0].counts.Loot, 1)
})

test('identical rows inside one file are kept (two pickups in the same second are real)', () => {
  const d = buildDataset([
    { file: 'February_10/a_m1', folder: 'February_10', journey: journey('a', 'm1', [row(0), row(3, 'Loot'), row(3, 'Loot')]) }
  ], { maps: MAPS })
  assert.equal(d.matches[0].counts.Loot, 2)
})

test('data detail 7: date is the folder name, and a mismatch with the UTC start date is reported', () => {
  const d = buildDataset([
    { file: 'February_11/a_m1', folder: 'February_11', journey: journey('a', 'm1', [row(0)]) }
  ], { maps: MAPS })
  assert.equal(d.matches[0].date, '2026-02-11')
  assert.deepEqual(d.health.folder_date_mismatches, [
    { match_id: 'm1', folder_date: '2026-02-11', utc_start_date: '2026-02-10' }
  ])
})

test('without a folder, the date falls back to the UTC start date', () => {
  const d = buildDataset([{ file: 'a_m1', folder: null, journey: journey('a', 'm1', [row(0)]) }], { maps: MAPS })
  assert.equal(d.matches[0].date, '2026-02-10')
  assert.equal(d.health.folder_date_mismatches.length, 0)
})

test('match times are seconds from match start; events are split from movement', () => {
  const d = buildDataset([
    { file: 'F/a', folder: null, journey: journey('a', 'm1', [row(10, 'Position', 1.26, 2.24), row(70, 'KilledByStorm', 3, 4)]) },
    { file: 'F/b', folder: null, journey: journey('1440', 'm1', [row(0, 'BotPosition')]) }
  ], { maps: MAPS })
  const m = d.matches[0]
  assert.equal(m.duration, 70)
  assert.equal(m.humans, 1)
  assert.equal(m.bots, 1)
  const human = m.journeys.find(j => j.user_id === 'a')
  assert.deepEqual(human.path, [10, 1.3, 2.2])
  assert.deepEqual(human.events, [['KilledByStorm', 70, 3, 4]])
})

test('failed files, unknown maps and single-journey matches are reported, not hidden', () => {
  const d = buildDataset([
    { file: 'bad', folder: null, error: 'Not a parquet file' },
    { file: 'x', folder: null, journey: { userId: 'a', matchId: 'm9', mapId: 'NewMap', rows: [row(0)] } }
  ], { maps: MAPS })
  assert.equal(d.health.failed_files.length, 1)
  assert.deepEqual(d.health.unknown_maps, ['NewMap'])
  assert.equal(d.health.single_journey_matches, 1)
})

test('the output is deterministic regardless of input order', () => {
  const a = { file: 'F/a', folder: null, journey: journey('a', 'm1', [row(0)]) }
  const b = { file: 'F/b', folder: null, journey: journey('b', 'm2', [row(1)]) }
  assert.equal(JSON.stringify(buildDataset([a, b], { maps: MAPS })), JSON.stringify(buildDataset([b, a], { maps: MAPS })))
})
