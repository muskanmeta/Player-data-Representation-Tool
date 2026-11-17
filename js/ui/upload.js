// upload.js: the "Add data" dialog. Collects files (picker, folder picker, or drag and drop
// of files and whole folders), parses them in a Web Worker with a progress bar, shows an
// import report, then adds to or replaces the current data and saves it in this browser.

import { h, replace, fmt, plural, toast } from './dom.js'
import { mergeDatasets } from '../data/merge.js'
import { importSources } from '../data/import-files.js'
import { save } from '../data/storage.js'

const $ = id => document.getElementById(id)
let bound = false
let busy = false

export function open (app) {
  if (!bound) bind(app)
  $('upload-progress').hidden = true
  $('upload-report').hidden = true
  $('upload-dialog').showModal()
}

function bind (app) {
  bound = true
  const zone = $('dropzone')
  $('pick-files').addEventListener('change', e => run(app, [...e.target.files].map(f => ({ path: f.name, file: f }))))
  $('pick-folder').addEventListener('change', e => run(app, [...e.target.files].map(f => ({ path: f.webkitRelativePath || f.name, file: f }))))
  zone.addEventListener('click', () => $('pick-files').click())
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('pick-files').click() } })
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dropzone--over') })
  zone.addEventListener('dragleave', () => zone.classList.remove('dropzone--over'))
  zone.addEventListener('drop', async e => {
    e.preventDefault()
    zone.classList.remove('dropzone--over')
    run(app, await filesFromDrop(e.dataTransfer))
  })
  $('upload-dialog').addEventListener('cancel', e => { if (busy) e.preventDefault() })
}

/** Dropped items -> flat file list, walking into dropped folders (keeps "February_13/..." paths). */
async function filesFromDrop (dt) {
  const entries = [...dt.items].map(i => i.webkitGetAsEntry?.()).filter(Boolean)
  if (!entries.length) return [...dt.files].map(f => ({ path: f.name, file: f }))
  const out = []
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject))
      out.push({ path: prefix + entry.name, file })
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      // readEntries returns at most ~100 entries per call: keep reading until empty.
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))
        if (!batch.length) break
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`)
      }
    }
  }
  for (const entry of entries) await walk(entry, '')
  return out
}

/** Parses in a worker; falls back to the main thread (with yields) if a worker cannot start. */
function parse (files, maps, onProgress) {
  return new Promise((resolve, reject) => {
    let worker
    try {
      worker = new Worker(new URL('../data/import-worker.js', import.meta.url), { type: 'module' })
    } catch {
      return resolve(parseHere(files, maps, onProgress))
    }
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress(data.done, data.total, data.path)
      else { worker.terminate(); data.type === 'done' ? resolve(data) : reject(new Error(data.message)) }
    }
    worker.onerror = e => { worker.terminate(); e.preventDefault(); resolve(parseHere(files, maps, onProgress)) }
    worker.postMessage({ files, maps })
  })
}

async function parseHere (files, maps, onProgress) {
  const sources = files.map(({ path, file }) => ({ path, read: () => file.arrayBuffer() }))
  return importSources(sources, maps, async (done, total, path) => {
    onProgress(done, total, path)
    await new Promise(r => setTimeout(r, 0)) // let the page paint between batches
  })
}

async function run (app, files) {
  if (busy || !files.length) return
  busy = true
  const mode = document.querySelector('input[name="upload-mode"]:checked').value
  const bar = $('upload-bar')
  const status = $('upload-status')
  const report = $('upload-report')
  $('upload-progress').hidden = false
  report.hidden = true
  bar.value = 0
  status.textContent = `Reading ${fmt(files.length)} files…`
  const started = performance.now()

  try {
    const { dataset, report: r } = await parse(files, app.maps, (done, total, path) => {
      bar.value = total ? done / total : 1
      status.textContent = `Reading ${fmt(done)} of ${fmt(total)} · ${path.split('/').pop()}`
    })
    bar.value = 1

    let result = dataset
    let added = { matches: dataset.matches.length, journeys: dataset.source.journeys }
    let repeated = 0
    if (mode === 'add') ({ dataset: result, added, repeated } = mergeDatasets(app.dataset, dataset))

    if (result.matches.length === 0) {
      showReport(report, r, null, true)
      status.textContent = 'No player journeys found in these files.'
      return
    }
    const saved = await save(result)
    app.setDataset(result, 'saved')
    status.textContent = `Done in ${((performance.now() - started) / 1000).toFixed(1)} s.${saved ? ' Saved in this browser.' : ' Could not save in this browser (private window?), so it will be gone after a reload.'}`
    showReport(report, r, { added, repeated, mode, unknownMaps: dataset.health.unknown_maps })
    toast(`${mode === 'add' ? 'Added' : 'Loaded'} ${plural(added.matches, 'match')}`)
  } catch (e) {
    status.textContent = ''
    replace(report, h('p', { class: 'report--error' }, `Import failed: ${e.message}`))
    report.hidden = false
  } finally {
    busy = false
    $('pick-files').value = ''
    $('pick-folder').value = ''
  }
}

function showReport (el, r, result, empty = false) {
  replace(el,
    h('p', {}, h('b', {}, `${fmt(r.journeyFiles)} journey file${r.journeyFiles === 1 ? '' : 's'}`),
      r.datasets ? ` and ${r.datasets} exported dataset${r.datasets === 1 ? '' : 's'}` : '',
      ` read from ${fmt(r.files)} file${r.files === 1 ? '' : 's'}.`),
    result && h('p', {}, result.mode === 'add'
      ? `Added ${plural(result.added.matches, 'new match')} and ${plural(result.added.journeys, 'journey')}. ${plural(result.repeated, 'journey')} already loaded and skipped.`
      : `Replaced the data with ${fmt(result.added.matches)} matches.`),
    result?.unknownMaps?.length ? h('p', { class: 'report--error' }, `No minimap settings for: ${result.unknownMaps.join(', ')}. Shown on a grid.`) : null,
    empty ? h('p', { class: 'report--error' }, 'Nothing was loaded. Expected parquet journey files, CSV with the raw columns, or an exported dataset.') : null,
    r.skipped.length ? [
      h('p', {}, `${fmt(r.skipped.length)} file${r.skipped.length === 1 ? '' : 's'} skipped:`),
      h('ul', {}, r.skipped.slice(0, 10).map(s => h('li', {}, `${s.path}: ${s.reason}`)), r.skipped.length > 10 ? h('li', {}, `… and ${r.skipped.length - 10} more`) : null)
    ] : null,
    h('p', { class: 'hint' }, 'Details are in the Data health panel.'))
  el.hidden = false
}
