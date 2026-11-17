// import-worker.js: runs the import off the main thread, so the page keeps responding
// (and the progress bar keeps moving) while hundreds of parquet files are decoded.
//
// Message in:  { files: { path: string, file: File }[], maps }
// Messages out: { type: 'progress', done, total, path }
//               { type: 'done', dataset, report }   or   { type: 'error', message }

import { importSources } from './import-files.js'

self.onmessage = async ({ data }) => {
  try {
    const sources = data.files.map(({ path, file }) => ({ path, read: () => file.arrayBuffer() }))
    const result = await importSources(sources, data.maps, (done, total, path) => {
      self.postMessage({ type: 'progress', done, total, path })
    })
    self.postMessage({ type: 'done', ...result })
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message })
  }
}
