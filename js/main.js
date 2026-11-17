// main.js: app entry point. Loads map settings and data, restores the view from the URL,
// and hands over to App (js/app.js).

import { setStageState } from './ui/stage-state.js'
import { loadMapConfigs } from './map/map-config.js'
import { loadDataset } from './data/load-dataset.js'
import { SCHEMA_VERSION } from './data/build-dataset.js'
import { loadSaved } from './data/storage.js'
import { queryToView } from './ui/url-state.js'
import { App } from './app.js'

const params = new URLSearchParams(location.search)
const datasetChip = document.getElementById('dataset-chip')

// Preview any state screen while designing: ?state=loading | empty | error
const PREVIEWABLE = ['loading', 'empty', 'error']
const preview = params.get('state')

if (PREVIEWABLE.includes(preview)) {
  setStageState(preview, {
    title: 'No matches for these filters',
    text: 'Example error or empty message, shown here so the screen can be checked.'
  })
  datasetChip.textContent = `Previewing the "${preview}" screen`
} else {
  start().catch(error => {
    console.error(error)
    setStageState('error', { text: `${error.message} Try reloading the page.` })
    datasetChip.textContent = 'Could not start'
  })
}

async function start () {
  // Map settings, the saved dataset (if the designer added data before) and the bundled
  // sample load in parallel; the sample is only used when nothing valid was saved.
  const [maps, saved] = await Promise.all([loadMapConfigs(), loadSaved()])
  const useSaved = saved?.schema_version === SCHEMA_VERSION && Array.isArray(saved.matches)
  const dataset = useSaved ? saved : await loadDataset()

  const app = new App({ maps, dataset, source: useSaved ? 'saved' : 'sample' })
  window.app = app // handy in the browser console while developing

  restoreView(app, queryToView(location.search))
  showFirstVisitHint()
}

/** Applies a shared link, ignoring parts that do not exist in the loaded data. */
function restoreView (app, view) {
  const ds = app.dataset
  const patch = {}
  if (view.map && ds.maps.includes(view.map)) patch.map = view.map
  const map = patch.map ?? app.state.map
  if (view.date === 'all' || ds.dates.includes(view.date)) patch.date = view.date
  const match = view.match && ds.matches.find(m => m.id === view.match && m.map === map)
  patch.match = match ? match.id : null
  patch.heat = view.heat
  patch.minPlayers = view.minPlayers
  patch.sort = view.sort
  patch.off = new Set(view.off)
  if (view.t != null) patch.t = view.t
  app.set(patch, { force: true, url: false })
}

function showFirstVisitHint () {
  const KEY = 'lila-journeys-hint-seen'
  let seen = false
  try { seen = localStorage.getItem(KEY) === '1' } catch { /* storage blocked: show it */ }
  if (seen) return
  const card = document.getElementById('first-visit')
  card.hidden = false
  document.getElementById('first-visit-ok').addEventListener('click', () => {
    card.hidden = true
    try { localStorage.setItem(KEY, '1') } catch { /* fine: it shows again next time */ }
    document.getElementById('stage').focus()
  })
}
