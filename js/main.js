// main.js: app entry point. Each feature branch adds its own wiring here.

import { setStageState } from './ui/stage-state.js'
import { loadMapConfigs } from './map/map-config.js'
import { MapCanvas } from './map/map-canvas.js'
import { checkOverlay } from './map/check-overlay.js'

const DEFAULT_MAP = 'AmbroseValley'

const params = new URLSearchParams(location.search)
const datasetChip = document.getElementById('dataset-chip')

// Preview any state screen while designing: ?state=loading | empty | error | ready
const PREVIEWABLE = ['loading', 'empty', 'error', 'ready']
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
    setStageState('error', { text: error.message })
    datasetChip.textContent = 'Could not start'
  })
}

async function start () {
  const maps = await loadMapConfigs()

  // ?map=GrandRift picks the map until the map switcher exists.
  const mapId = maps[params.get('map')] ? params.get('map') : DEFAULT_MAP
  const map = maps[mapId]

  const mapCanvas = new MapCanvas(document.getElementById('map-canvas'))
  if (params.get('check') === 'mapping') mapCanvas.overlays.push(checkOverlay(map))

  await mapCanvas.setMap(map)
  setStageState('ready')

  // No player data is loaded yet, so the chip says which map is shown and nothing more.
  datasetChip.textContent = `${map.name} · no player data loaded`
}
