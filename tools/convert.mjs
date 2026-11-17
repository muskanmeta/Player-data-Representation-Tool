// convert.mjs: converts a raw telemetry drop (folders of parquet files) into the JSON
// dataset the web app loads. Uses the same parser as the app (js/data/parse.js).
//
//   node tools/convert.mjs <player_data folder> [--out data/default/dataset.json]
//
// Output is deterministic: the same input gives a byte-identical file, so two runs or two
// drops can be compared with a plain diff. A one-screen summary is printed; the full list of
// anomalies is in the dataset's `health` section and in out/convert-report.json.
// Exit code 1 when a critical check fails (unreadable files or a map with no settings).

import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { join, relative, dirname, basename, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { parseJourneyFile } from '../js/data/parse.js'
import { buildDataset } from '../js/data/build-dataset.js'

const ROOT = resolve(import.meta.dirname, '..')

const args = process.argv.slice(2)
const input = args.find(a => !a.startsWith('--'))
const outIndex = args.indexOf('--out')
const outFile = resolve(outIndex >= 0 ? args[outIndex + 1] : join(ROOT, 'data/default/dataset.json'))

if (!input) {
  console.error('Usage: node tools/convert.mjs <player_data folder> [--out data/default/dataset.json]')
  process.exit(2)
}

async function listFiles (dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await listFiles(p))
    else out.push(p)
  }
  return out
}

const started = Date.now()
const inputDir = resolve(input)
// Raw journey files only: skip the README and the minimap images that ship in the same zip.
const files = (await listFiles(inputDir))
  .filter(f => !/\.(md|png|jpe?g|webp|txt)$/i.test(f))
  .sort()

const inputs = []
for (const file of files) {
  const rel = relative(inputDir, file).replaceAll('\\', '/')
  const folder = rel.includes('/') ? basename(dirname(file)) : null
  try {
    const b = await readFile(file)
    const journey = await parseJourneyFile(b.buffer.slice(b.byteOffset, b.byteOffset + b.length))
    inputs.push({ file: rel, folder, journey })
  } catch (error) {
    inputs.push({ file: rel, folder, error: error.message })
  }
}

const { maps } = JSON.parse(await readFile(join(ROOT, 'data/maps.json'), 'utf8'))
const dataset = buildDataset(inputs, { maps })

const json = JSON.stringify(dataset)
await mkdir(dirname(outFile), { recursive: true })
await writeFile(outFile, json)

const reportFile = join(ROOT, 'out/convert-report.json')
await mkdir(dirname(reportFile), { recursive: true })
await writeFile(reportFile, JSON.stringify({ source: dataset.source, health: dataset.health }, null, 2) + '\n')

// ---------- one-screen summary ----------
const h = dataset.health
const s = dataset.source
const kb = n => `${(n / 1024).toFixed(0)} KB`
const lines = [
  `Converted ${s.files} files (${s.files_failed} failed) in ${((Date.now() - started) / 1000).toFixed(1)} s`,
  `  rows            ${s.rows} read, ${s.rows_after_dedupe} after removing repeats`,
  `  journeys        ${s.journeys}`,
  `  matches         ${s.matches} on ${dataset.maps.join(', ')}`,
  `  dates           ${dataset.dates.join(', ')}`,
  'Data health',
  `  repeated journeys       ${h.repeated_journeys.length} (${h.repeated_journeys.filter(r => r.kind === 'duplicate').length} duplicate, ${h.repeated_journeys.filter(r => r.kind === 'split').length} split)`,
  `  bot ID conflicts        ${h.id_conflicts.length}`,
  `  folder/date mismatches  ${h.folder_date_mismatches.length}`,
  `  multi-folder matches    ${h.multi_folder_matches.length}`,
  `  single-journey matches  ${h.single_journey_matches}`,
  `  points outside map      ${h.points_outside_map}`,
  `  matches with 2+ maps    ${h.mixed_maps.length}`,
  `  unknown maps / events   ${h.unknown_maps.length} / ${h.unknown_events.length}`,
  `Wrote ${relative(ROOT, outFile)}: ${kb(json.length)} (${kb(gzipSync(json).length)} gzipped)`,
  `Details: ${relative(ROOT, reportFile)}`
]
console.log(lines.join('\n'))

const critical = s.files_failed > 0 || h.unknown_maps.length > 0 || h.mixed_maps.length > 0
if (critical) console.error('Critical: some files failed, a map has no settings in data/maps.json, or a match names two maps')
process.exit(critical ? 1 : 0)
