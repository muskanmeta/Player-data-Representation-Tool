// parse.js: turns one raw telemetry file into a clean journey. Shared by the browser and
// the Node tools, so the app and the conversion can never disagree about the data.
//
// The rules here are the data's traps, each checked by test/parse.test.js:
//   1. Files are parquet without a .parquet extension -> detect by the first bytes, "PAR1".
//   2. `event` is raw bytes (no UTF-8 annotation)      -> decode with TextDecoder if needed.
//   3. `ts` is labelled milliseconds but holds seconds  -> detect the unit by magnitude.
//   4. A numeric user_id does not always mean a bot     -> classify by events, flag conflicts.

import { parquetReadObjects } from '../../vendor/hyparquet/index.js'

const PARQUET_MAGIC = [0x50, 0x41, 0x52, 0x31] // "PAR1"
const textDecoder = new TextDecoder('utf-8')

// Unix time in seconds stays below 1e11 until the year 5138; in milliseconds it has been
// above 1e11 since 1973. So the magnitude tells the unit.
const SECONDS_LIMIT = 1e11

export const MOVEMENT_EVENTS = ['Position', 'BotPosition']
export const KNOWN_EVENTS = [
  'Position', 'BotPosition', 'Kill', 'Killed', 'BotKill', 'BotKilled', 'KilledByStorm', 'Loot'
]

/** True when the bytes start with the parquet magic number "PAR1". */
export function isParquet (bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return view.length >= 4 && PARQUET_MAGIC.every((byte, i) => view[i] === byte)
}

/** Event value as text, whether the reader returned a string or raw bytes. */
export function decodeEvent (value) {
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return textDecoder.decode(value)
  if (value instanceof ArrayBuffer) return textDecoder.decode(new Uint8Array(value))
  return String(value)
}

/**
 * A raw ts value (Date, bigint or number) -> Unix seconds.
 * The parquet reader turns a TIMESTAMP_MILLIS column into a Date, so a value stored as
 * 1770754537 (really seconds) arrives as a Date 1,770,754,537 ms after 1970, i.e. Jan 1970.
 * We take that raw number back and decide its unit by size.
 */
export function toUnixSeconds (raw) {
  const n = raw instanceof Date ? raw.getTime() : Number(raw)
  return n < SECONDS_LIMIT ? n : n / 1000
}

/** "1440" -> true. Humans have UUIDs. */
export function isNumericId (userId) {
  return /^\d+$/.test(userId)
}

/**
 * Bot or human. The movement events are the most reliable signal: bots log BotPosition,
 * humans log Position. The ID rule from the README is only the fallback.
 *
 * @returns {{ isBot: boolean, botById: boolean, botByEvents: boolean | null, conflict: boolean }}
 */
export function classifyPlayer (userId, eventNames) {
  const botById = isNumericId(userId)
  const events = new Set(eventNames)
  let botByEvents = null
  if (events.has('BotPosition') && !events.has('Position')) botByEvents = true
  else if (events.has('Position') && !events.has('BotPosition')) botByEvents = false

  const isBot = botByEvents ?? botById
  return { isBot, botById, botByEvents, conflict: botByEvents !== null && botByEvents !== botById }
}

/** "abc.nakama-0" -> "abc". The README says match_id carries the server-instance suffix. */
export function cleanMatchId (matchId) {
  return String(matchId).replace(/\.nakama-\d+$/, '')
}

/**
 * Parses one journey file.
 *
 * @param {ArrayBuffer} buffer  the whole file
 * @returns {Promise<{ userId: string, matchId: string, mapId: string,
 *   rows: { t: number, x: number, y: number, z: number, event: string }[] }>}
 *   t is Unix seconds; rows keep file order (several samples can share one second).
 */
export async function parseJourneyFile (buffer) {
  if (!isParquet(buffer)) throw new Error('Not a parquet file (missing PAR1 header)')

  const raw = await parquetReadObjects({ file: buffer })
  if (raw.length === 0) throw new Error('Parquet file has no rows')

  const first = raw[0]
  for (const column of ['user_id', 'match_id', 'map_id', 'x', 'z', 'ts', 'event']) {
    if (!(column in first)) throw new Error(`Missing column: ${column}`)
  }

  return {
    userId: String(first.user_id),
    matchId: cleanMatchId(first.match_id),
    mapId: String(first.map_id),
    rows: raw.map(r => ({
      t: toUnixSeconds(r.ts),
      x: Number(r.x),
      y: Number(r.y),
      z: Number(r.z),
      event: decodeEvent(r.event)
    }))
  }
}
