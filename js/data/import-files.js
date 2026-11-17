// import-files.js: whatever a designer drops into the app -> one dataset.
//
// Accepts raw parquet journey files (any name; detected by their "PAR1" bytes), folders of
// them, .zip archives, CSV files with the raw columns, and dataset JSON files exported from
// this tool. Everything goes through the same parse.js and build-dataset.js as the bundled
// sample, so an upload gives exactly the result tools/convert.mjs would.
//
// No DOM here: it runs inside the Web Worker (import-worker.js), and on the main thread
// only as a fallback if a worker cannot start.

import { unzipSync } from '../../vendor/fflate.js'
import { isParquet, parseJourneyFile, toUnixSeconds, cleanMatchId } from './parse.js'
import { buildDataset, SCHEMA_VERSION } from './build-dataset.js'
import { mergeDatasets } from './merge.js'

const textDecoder = new TextDecoder()
// Files that ship with a drop but hold no telemetry. Skipped without a warning.
const QUIET_SKIP = /(^|\/)(readme(\.md|\.txt)?|\.ds_store|thumbs\.db)$|\.(png|jpe?g|webp|md|txt)$|(^|\/)__MACOSX\//i

/** "player_data/February_13/abc_def.nakama-0" -> "February_13" (null at top level). */
export function parentFolder (path) {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 2] : null
}

/** Opens .zip entries into the same { path, read } shape as plain files. */
function expandZip (path, bytes) {
  const out = []
  const entries = unzipSync(bytes)
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue
    out.push({ path: `${path.replace(/\.zip$/i, '')}/${name}`, read: async () => data })
  }
  return out
}

/** CSV with a header row (user_id, match_id, map_id, x, y, z, ts, event) -> journeys. */
export function journeysFromCsv (text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '')
  const head = lines.shift().split(',').map(h => h.trim().toLowerCase())
  const col = name => head.indexOf(name)
  for (const name of ['user_id', 'match_id', 'map_id', 'x', 'z', 'ts', 'event']) {
    if (col(name) < 0) throw new Error(`CSV is missing the "${name}" column`)
  }
  const groups = new Map()
  for (const line of lines) {
    const c = line.split(',')
    const userId = c[col('user_id')].trim()
    const matchId = cleanMatchId(c[col('match_id')].trim())
    const key = `${userId}|${matchId}`
    if (!groups.has(key)) groups.set(key, { userId, matchId, mapIds: new Set(), tsUnit: 's', rows: [] })
    const g = groups.get(key)
    const mapId = c[col('map_id')].trim()
    g.mapIds.add(mapId)
    const rawTs = Number(c[col('ts')])
    if (rawTs >= 1e11) g.tsUnit = 'ms'
    g.rows.push({
      t: toUnixSeconds(rawTs),
      x: Number(c[col('x')]),
      y: col('y') >= 0 ? Number(c[col('y')]) : 0,
      z: Number(c[col('z')]),
      event: c[col('event')].trim()
    })
  }
  return [...groups.values()].map(g => ({ ...g, mapId: [...g.mapIds][0], mapIds: [...g.mapIds].sort() }))
}

/**
 * @param {{ path: string, read: () => Promise<ArrayBuffer | Uint8Array> }[]} sources
 * @param {Record<string, object>} maps   map settings from data/maps.json
 * @param {(done: number, total: number, path: string) => void} onProgress
 * @returns {Promise<{ dataset: object, report: { files: number, journeyFiles: number,
 *   datasets: number, skipped: { path: string, reason: string }[] } }>}
 */
export async function importSources (sources, maps, onProgress = () => {}) {
  const report = { files: 0, journeyFiles: 0, datasets: 0, skipped: [] }
  const inputs = []      // for buildDataset
  const exported = []    // dataset JSON files found in the upload

  // Zips are opened first, so their entries are counted in the progress total.
  const queue = []
  for (const src of sources) {
    if (!/\.zip$/i.test(src.path)) { queue.push(src); continue }
    try {
      queue.push(...expandZip(src.path, new Uint8Array(await src.read())))
    } catch (e) {
      report.skipped.push({ path: src.path, reason: `could not open the zip (${e.message})` })
    }
  }

  for (let i = 0; i < queue.length; i++) {
    const { path, read } = queue[i]
    if (i % 20 === 0) onProgress(i, queue.length, path)
    if (QUIET_SKIP.test(path)) continue
    report.files++
    const folder = parentFolder(path)
    let bytes
    try {
      const raw = await read()
      bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
    } catch (e) {
      report.skipped.push({ path, reason: 'could not read the file' })
      continue
    }

    try {
      if (isParquet(bytes)) {
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        inputs.push({ file: path, folder, journey: await parseJourneyFile(buffer) })
        report.journeyFiles++
        continue
      }
      const text = textDecoder.decode(bytes.subarray(0, 4096)).trimStart()
      if (text.startsWith('{')) {
        const obj = JSON.parse(textDecoder.decode(bytes))
        if (obj.schema_version !== SCHEMA_VERSION || !Array.isArray(obj.matches)) {
          throw new Error(`not a dataset file from this tool (schema ${obj.schema_version ?? 'missing'})`)
        }
        exported.push(obj)
        report.datasets++
        continue
      }
      if (/^user_id|,user_id/i.test(text.split(/\r?\n/)[0])) {
        for (const journey of journeysFromCsv(textDecoder.decode(bytes))) {
          inputs.push({ file: `${path}#${journey.userId}`, folder, journey })
        }
        report.journeyFiles++
        continue
      }
      report.skipped.push({ path, reason: 'not a parquet, CSV or dataset JSON file' })
    } catch (e) {
      report.skipped.push({ path, reason: e.message })
      inputs.push({ file: path, folder, error: e.message })
    }
  }
  onProgress(queue.length, queue.length, '')

  let dataset = buildDataset(inputs, { maps })
  for (const extra of exported) dataset = mergeDatasets(dataset, extra).dataset
  return { dataset, report }
}
