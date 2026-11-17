// common.mjs: small helpers shared by the data tools (CSV in/out, argument parsing,
// listing a drop's files). No dependencies.

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'

export const ROOT = resolve(import.meta.dirname, '..', '..')

/** `--out dir --map X file` -> { _: ['file'], out: 'dir', map: 'X' }. Flags without a value are true. */
export function parseArgs (argv = process.argv.slice(2)) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else { out[key] = next; i++ }
  }
  return out
}

/** Every file under a folder, recursively, as sorted absolute paths (sorted = deterministic). */
export async function listFiles (dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await listFiles(p))
    else out.push(p)
  }
  return out.sort()
}

// ---------- CSV ----------

function cell (value) {
  if (value === null || value === undefined) return ''
  const s = Array.isArray(value) ? value.join(';') : typeof value === 'boolean' ? (value ? '1' : '0') : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

/** Rows (objects) -> CSV text with a header row, in the given column order. LF line endings. */
export function toCsv (columns, rows) {
  return [columns.join(','), ...rows.map(r => columns.map(c => cell(r[c])).join(','))].join('\n') + '\n'
}

/** CSV text -> array of objects keyed by the header. Handles quoted cells. */
export function parseCsv (text) {
  const rows = []
  let row = []; let field = ''; let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  const [head, ...body] = rows
  return body.filter(r => r.length > 1 || r[0] !== '').map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

export async function readCsv (file) {
  return parseCsv(await readFile(file, 'utf8'))
}

export async function writeText (file, text) {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, text)
}

/** ISO time without milliseconds: 2026-02-10T20:15:37Z. */
export const isoUtc = seconds => new Date(seconds * 1000).toISOString().replace('.000Z', 'Z')

/** Map settings from data/maps.json. */
export async function loadMaps () {
  return JSON.parse(await readFile(join(ROOT, 'data/maps.json'), 'utf8')).maps
}
