// app.js: the app's state and the one place that changes it.
//
// Data flow, one direction only:
//   user input -> app.set(patch) -> state -> derived view (select.js) -> UI panels + map redraw
// Panels never change each other; they call app.set() and get re-rendered. This keeps a
// plain-JavaScript app predictable without a framework.

import { filterMatches, viewMatches, viewDuration } from './data/select.js'
import { densityGrid, colorize, reachableCells, ignoredCells, HEAT_GRID } from './data/heatmap.js'
import { HEATMAPS } from './data/events.js'
import { fallbackMap } from './map/map-config.js'
import { MapCanvas } from './map/map-canvas.js'
import { heatLayer, journeysLayer, colorFor } from './render/layers.js'
import { viewToQuery } from './ui/url-state.js'
import { setStageState } from './ui/stage-state.js'
import * as sidebar from './ui/sidebar.js'
import * as timeline from './ui/timeline.js'
import * as inspect from './ui/inspect.js'
import { checkOverlay } from './map/check-overlay.js'

// Which parts of the screen depend on which state keys.
const FILTER_KEYS = ['map', 'date', 'match', 'minPlayers', 'sort', 'search']
const HEAT_KEYS = ['heat', 'map', 'date', 'match', 'minPlayers', 'search', 'hidden', 't']

export class App {
  constructor ({ maps, dataset, source }) {
    this.maps = maps                // settings from maps.json, keyed by map_id
    this.dataset = null
    this.source = source            // 'sample' | 'saved'
    this.state = {
      map: null, date: 'all', match: null, minPlayers: 1, sort: 'humans', search: '',
      heat: 'none', heatOpacity: 0.75, off: new Set(), trail: false,
      t: null, playing: false, speed: 10, hidden: new Set(), focus: null
    }
    this.list = []                  // matches in the match browser
    this.view = []                  // matches drawn on the map
    this.duration = 1
    this.reachable = new Map()      // map_id -> reachable-cell mask, for ignored areas
    this.heatKey = ''

    // What the render layers read every frame.
    this.scene = {
      matches: [], t: 0, single: false, off: this.state.off, hidden: this.state.hidden, focus: null,
      trail: false, colors: new Map(), showHeads: false, heat: null, heatOpacity: 0.75, hits: []
    }

    this.mapCanvas = new MapCanvas(document.getElementById('map-canvas'))
    this.mapCanvas.overlays.push(heatLayer(this.scene), journeysLayer(this.scene))
    if (new URLSearchParams(location.search).get('check') === 'mapping') {
      this.mapCanvas.overlays.push((ctx, view) => checkOverlay(this.mapCanvas.map)(ctx, view))
    }

    sidebar.init(this)
    timeline.init(this)
    inspect.init(this)
    this.setDataset(dataset, source)
  }

  /** Map settings for a map id; a fitted grid frame when maps.json has no entry. */
  mapConfig (mapId) {
    return this.maps[mapId] ?? fallbackMap(mapId, this.dataset.matches)
  }

  /** Loads a whole dataset (startup, upload, reset) and keeps the view where it can. */
  setDataset (dataset, source = this.source) {
    this.dataset = dataset
    this.source = source
    this.reachable.clear()
    this.heatKey = ''
    sidebar.renderHealth(this)
    sidebar.renderDatasetChip(this)
    const map = dataset.maps.includes(this.state.map) ? this.state.map : this.defaultMap()
    this.set({ map, match: null, date: dataset.dates.includes(this.state.date) ? this.state.date : 'all' }, { force: true })
  }

  /** The map with the most matches. */
  defaultMap () {
    const counts = new Map()
    for (const m of this.dataset.matches) counts.set(m.map, (counts.get(m.map) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  }

  /**
   * The only way state changes. `patch` holds the keys that change.
   * Side effects follow from what changed: new map -> new image, new match -> reset players, ...
   */
  set (patch, { force = false, url = true } = {}) {
    const prev = this.state
    const next = { ...prev, ...patch }
    const changed = new Set(Object.keys(patch).filter(k => force || patch[k] !== prev[k]))
    if (changed.size === 0) return

    if (changed.has('map')) {
      next.match = patch.match ?? null
      next.hidden = new Set()
      next.focus = null
      if (!('t' in patch)) next.t = null
      changed.add('match').add('hidden')
    }
    if (changed.has('match') && !changed.has('map')) {
      next.hidden = new Set()
      next.focus = null
      if (!('t' in patch)) next.t = null
      changed.add('hidden')
    }
    if ((changed.has('match') || changed.has('map') || changed.has('date')) && !('playing' in patch)) {
      next.playing = false
    }
    this.state = next

    if (changed.has('map')) {
      const config = this.mapConfig(next.map)
      this.mapCanvas.setMap(config).catch(e => setStageState('error', { text: e.message }))
      const warning = document.getElementById('stage-warning')
      warning.hidden = config.known !== false
      warning.textContent = `No minimap settings for "${next.map}". Paths are drawn on a grid fitted to the data, so shapes are right but there is no map image. Add the map to data/maps.json.`
    }

    if (FILTER_KEYS.some(k => changed.has(k))) this.derive()
    if ([...changed].some(k => HEAT_KEYS.includes(k)) || changed.has('heatOpacity')) this.updateHeat()
    this.syncScene()

    if (FILTER_KEYS.some(k => changed.has(k))) sidebar.renderFilters(this)
    if (['off', 'match', 'map', 'date', 'minPlayers', 'search', 'heat'].some(k => changed.has(k))) sidebar.renderLayers(this)
    if (['match', 'hidden', 'focus', 'map'].some(k => changed.has(k))) sidebar.renderPlayers(this)
    sidebar.renderSummary(this)
    timeline.render(this)
    this.renderStage()
    this.mapCanvas.requestDraw()
    if (url && !next.playing) this.writeUrl()
  }

  /** Recomputes the match list and the matches in view. */
  derive () {
    const s = this.state
    if (!s.map) { this.list = []; this.view = []; return }
    this.list = filterMatches(this.dataset, s)
    this.view = viewMatches(this.dataset, s)
    this.duration = viewDuration(this.view)
    // One colour per human in the single-match view, in a stable order.
    this.scene.colors = new Map()
    if (s.match) {
      this.view[0]?.journeys.filter(j => !j.bot).forEach((j, i) => this.scene.colors.set(j.user_id, colorFor(i)))
    }
  }

  /** The playhead in seconds; null in state means "the end" (everything visible). */
  get time () {
    return this.state.t == null ? this.duration : Math.min(this.state.t, this.duration)
  }

  syncScene () {
    const s = this.state
    Object.assign(this.scene, {
      matches: this.view,
      t: this.time,
      single: Boolean(s.match),
      off: s.off,
      hidden: s.hidden,
      focus: s.focus,
      trail: s.trail,
      heatOpacity: s.heatOpacity,
      showHeads: s.t != null && this.time < this.duration + 3
    })
  }

  /** Rebuilds the heatmap when its inputs changed. Rounded time keeps playback cheap. */
  updateHeat () {
    const s = this.state
    const spec = HEATMAPS[s.heat]
    if (!spec?.source || this.view.length === 0) { this.scene.heat = null; this.heatKey = ''; sidebar.renderHeatLegend(this, null); return }
    const tBucket = Math.floor(this.time)
    const key = [s.heat, s.map, s.date, s.match, s.minPlayers, s.search, [...s.hidden].join(','), tBucket].join('|')
    if (key === this.heatKey) return
    this.heatKey = key
    const map = this.mapConfig(s.map)
    const options = { t: this.time, hidden: s.hidden }

    if (spec.source === 'ignored') {
      if (!this.reachable.has(s.map)) {
        this.reachable.set(s.map, reachableCells(this.dataset.matches.filter(m => m.map === s.map), map))
      }
      const result = ignoredCells(this.view, map, this.reachable.get(s.map), options)
      this.scene.heat = { kind: 'ignored', ...result }
      sidebar.renderHeatLegend(this, result)
      return
    }

    const grid = densityGrid(this.view, map, s.heat, { ...options, size: HEAT_GRID })
    const canvas = this.scene.heat?.canvas ?? document.createElement('canvas')
    canvas.width = canvas.height = grid.size
    canvas.getContext('2d').putImageData(new ImageData(colorize(grid), grid.size, grid.size), 0, 0)
    this.scene.heat = { kind: 'density', canvas, ...grid }
    sidebar.renderHeatLegend(this, grid)
  }

  /** Fast path used by playback: only time-dependent parts change. */
  setTime (t, { url = false } = {}) {
    this.state = { ...this.state, t }
    this.syncScene()
    if (this.state.heat !== 'none') {
      this.updateHeat()
    }
    timeline.render(this)
    sidebar.renderSummary(this, { throttle: this.state.playing })
    this.mapCanvas.requestDraw()
    if (url) this.writeUrl()
  }

  renderStage () {
    const s = this.state
    const title = document.getElementById('stage-title')
    const config = s.map ? this.mapConfig(s.map) : null
    if (!s.map) {
      setStageState('empty', { title: 'No player data loaded', text: 'Use "Add data" to load a telemetry drop.' })
      title.textContent = ''
      return
    }
    if (this.view.length === 0) {
      setStageState('empty', {
        title: 'No matches for these filters',
        text: s.minPlayers > 1 || s.search
          ? 'Try another date, clear the search, or turn off "2+ players only".'
          : 'This map has no matches on this date. Pick another date.'
      })
    } else {
      setStageState('ready')
    }
    const m = s.match ? this.view[0] : null
    title.textContent = m
      ? `${config.name} · match ${m.id.slice(0, 8)} · ${m.humans} human${m.humans === 1 ? '' : 's'}, ${m.bots} bot${m.bots === 1 ? '' : 's'}`
      : `${config.name} · ${this.view.length} match${this.view.length === 1 ? '' : 'es'} overlaid`
  }

  writeUrl () {
    clearTimeout(this.urlTimer)
    this.urlTimer = setTimeout(() => {
      const s = this.state
      const query = viewToQuery({ ...s, off: [...s.off], t: s.t == null ? null : this.time })
      history.replaceState(null, '', `${location.pathname}?${query}`)
    }, 250)
  }
}
