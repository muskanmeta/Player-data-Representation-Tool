// storage.js: keeps the designer's own data in this browser (IndexedDB), so uploaded data
// is still there after a reload. One record holds the whole dataset.
//
// IndexedDB, not localStorage: localStorage holds ~5 MB of strings only, while a few days of
// telemetry is several MB. Every call is wrapped so a private window or blocked storage
// just means "nothing saved" instead of a broken app.

const DB_NAME = 'lila-player-journeys'
const STORE = 'datasets'
const KEY = 'current'

function open () {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function run (mode, action) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = action(tx.objectStore(STORE))
    tx.oncomplete = () => { db.close(); resolve(req?.result) }
    tx.onerror = () => { db.close(); reject(tx.error) }
  }))
}

/** The saved dataset, or null when there is none (or storage is unavailable). */
export async function loadSaved () {
  try { return (await run('readonly', s => s.get(KEY))) ?? null } catch { return null }
}

/** Saves the dataset. Returns false if the browser refused (quota, private mode). */
export async function save (dataset) {
  try { await run('readwrite', s => s.put(dataset, KEY)); return true } catch { return false }
}

/** Forgets the saved dataset, so the bundled sample loads next time. */
export async function clearSaved () {
  try { await run('readwrite', s => s.delete(KEY)) } catch { /* nothing saved anyway */ }
}
