// Tests for js/data/parse.js. Run with: npm test
//
// The rule tests use small hand-made inputs, so they run anywhere. The real-file tests need
// the raw data drop, which never enters the repo; point to it with LILA_DATA, e.g.
//   LILA_DATA="C:/path/to/player_data" npm test
// Without it they are skipped (shown as "skipped", never as passed).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  isParquet, decodeEvent, toUnixSeconds, classifyPlayer, cleanMatchId, parseJourneyFile
} from '../js/data/parse.js'

// ---------- data detail 4: no .parquet extension, detect by bytes ----------

test('isParquet detects the PAR1 header', () => {
  assert.equal(isParquet(new TextEncoder().encode('PAR1....')), true)
  assert.equal(isParquet(new TextEncoder().encode('{"json": true}')), false)
  assert.equal(isParquet(new Uint8Array([0x50, 0x41])), false) // too short
})

// ---------- data detail 3: event column is raw bytes ----------

test('decodeEvent reads strings and raw UTF-8 bytes alike', () => {
  assert.equal(decodeEvent('Loot'), 'Loot')
  assert.equal(decodeEvent(new TextEncoder().encode('KilledByStorm')), 'KilledByStorm')
  assert.equal(decodeEvent(new TextEncoder().encode('BotKill').buffer), 'BotKill')
})

// ---------- data detail 1: ts labelled ms but holds seconds ----------

test('toUnixSeconds: a value stored as seconds stays seconds (README sample = 10 Feb 2026)', () => {
  // The reader turns TIMESTAMP_MILLIS into a Date, so seconds arrive as a Jan-1970 Date.
  const fromReader = new Date(1770754537)
  const seconds = toUnixSeconds(fromReader)
  assert.equal(seconds, 1770754537)
  assert.equal(new Date(seconds * 1000).toISOString().slice(0, 10), '2026-02-10')
})

test('toUnixSeconds: a real millisecond value is converted to seconds', () => {
  assert.equal(toUnixSeconds(1770754537000), 1770754537)
  assert.equal(toUnixSeconds(1770754537000n), 1770754537)
})

// ---------- data detail 5: numeric ID does not always mean bot ----------

test('classifyPlayer: UUID with Position is a human, numeric with BotPosition is a bot', () => {
  const human = classifyPlayer('f4e072fa-b7af-4761-b567-1d95b7ad0108', ['Position', 'Loot'])
  assert.deepEqual(human, { isBot: false, botById: false, botByEvents: false, conflict: false })
  const bot = classifyPlayer('1440', ['BotPosition'])
  assert.deepEqual(bot, { isBot: true, botById: true, botByEvents: true, conflict: false })
})

test('classifyPlayer: numeric ID that logs Position and Loot is a human, flagged as a conflict', () => {
  const r = classifyPlayer('1429', ['Position', 'Loot', 'BotKill'])
  assert.equal(r.isBot, false)
  assert.equal(r.conflict, true)
})

test('classifyPlayer: no movement events falls back to the ID rule', () => {
  assert.equal(classifyPlayer('382', ['Loot']).isBot, true)
  assert.equal(classifyPlayer('382', ['Loot']).conflict, false)
})

test('cleanMatchId removes the .nakama-0 server suffix', () => {
  assert.equal(cleanMatchId('b71aaad8-aa62-4b3a-8534-927d4de18f22.nakama-0'), 'b71aaad8-aa62-4b3a-8534-927d4de18f22')
  assert.equal(cleanMatchId('plain-id'), 'plain-id')
})

test('parseJourneyFile rejects a file that is not parquet', async () => {
  await assert.rejects(parseJourneyFile(new TextEncoder().encode('not parquet').buffer), /PAR1/)
})

// ---------- real sample files (skipped without LILA_DATA) ----------

const DATA = process.env.LILA_DATA
const skip = DATA ? false : 'set LILA_DATA to the raw player_data folder to run'

async function readJourney (day, name) {
  const b = await readFile(join(DATA, day, name))
  return parseJourneyFile(b.buffer.slice(b.byteOffset, b.byteOffset + b.length))
}

test('real file: README human sample decodes ts as Feb 2026 seconds and events as text', { skip }, async () => {
  const day = 'February_10'
  const name = (await readdir(join(DATA, day))).find(f => f.startsWith('f4e072fa-b7af-4761-b567-1d95b7ad0108_b71aaad8'))
  const j = await readJourney(day, name)
  assert.equal(j.userId, 'f4e072fa-b7af-4761-b567-1d95b7ad0108')
  assert.equal(j.mapId, 'AmbroseValley')
  assert.ok(!j.matchId.endsWith('.nakama-0'))
  for (const r of j.rows) {
    assert.ok(r.t > 1.77e9 && r.t < 1.78e9, `ts ${r.t} should be Feb 2026 in seconds`)
    assert.equal(typeof r.event, 'string')
  }
})

// ID 1429 appears both as a real bot and in journeys that log human events; this file is one
// of the human ones (Position, Loot, BotKilled).
test('real file: numeric ID 1429 logging Position and Loot is classified as human', { skip }, async () => {
  const j = await readJourney('February_10', '1429_41d4555d-1ca9-4e3d-b82f-168bef19d865.nakama-0')
  const c = classifyPlayer(j.userId, j.rows.map(r => r.event))
  assert.equal(c.isBot, false)
  assert.equal(c.conflict, true)
})
