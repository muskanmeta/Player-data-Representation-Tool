// inspect.js: everything you can do with the mouse or keys on the map itself.
//   wheel / + - : zoom around the cursor      drag: pan      double-click / 0: reset view
//   hover a marker or player: tooltip          click a marker: open its match at that moment
//   (inside one match, click a marker or player to focus on that player; Esc clears it)
// Hit-testing uses scene.hits, which the render layer fills while drawing, so what you can
// hover is always exactly what is on screen.

import { h, replace } from './dom.js'
import { eventLabel, formatClock, formatDay, playerName } from '../data/events.js'
import { markerIcon } from '../render/markers.js'

const $ = id => document.getElementById(id)

export function init (app) {
  const canvas = $('map-canvas')
  const tip = $('tooltip')
  const mc = app.mapCanvas
  let drag = null      // { x, y, moved } while the pointer is down
  let hoverFrame = 0
  let pointer = null

  const local = e => {
    const r = canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  canvas.addEventListener('wheel', e => {
    e.preventDefault()
    const p = local(e)
    mc.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015))
  }, { passive: false })

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return
    drag = { ...local(e), moved: false }
    canvas.setPointerCapture(e.pointerId)
  })

  canvas.addEventListener('pointermove', e => {
    const p = local(e)
    if (drag) {
      const dx = p.x - drag.x; const dy = p.y - drag.y
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
      if (drag.moved) {
        mc.panBy(dx, dy)
        drag.x = p.x; drag.y = p.y
        canvas.style.cursor = mc.zoom > 1 ? 'grabbing' : ''
        hideTip()
        return
      }
    }
    pointer = p
    if (!hoverFrame) hoverFrame = requestAnimationFrame(() => { hoverFrame = 0; hover() })
  })

  canvas.addEventListener('pointerup', e => {
    const wasDrag = drag?.moved
    drag = null
    canvas.style.cursor = ''
    if (wasDrag) return
    click(hitAt(local(e)))
  })

  canvas.addEventListener('pointerleave', () => { pointer = null; hideTip() })
  canvas.addEventListener('dblclick', () => mc.resetView())

  $('zoom-in').addEventListener('click', () => zoomCentre(1.5))
  $('zoom-out').addEventListener('click', () => zoomCentre(1 / 1.5))
  $('zoom-reset').addEventListener('click', () => mc.resetView())

  document.addEventListener('keydown', e => {
    const tag = e.target.tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.ctrlKey || e.metaKey) return
    if (e.key === '+' || e.key === '=') zoomCentre(1.5)
    else if (e.key === '-' || e.key === '_') zoomCentre(1 / 1.5)
    else if (e.key === '0') mc.resetView()
    else if (e.key === 'Escape' && app.state.focus) app.set({ focus: null }, { url: false })
  })

  // Zooming or panning moves everything under the cursor, so an open tooltip would be stale.
  mc.onViewChange = () => hideTip()

  function zoomCentre (factor) {
    mc.zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, factor)
  }

  /** The nearest hit within its radius; later (top-most) hits win ties. */
  function hitAt (p) {
    let best = null; let bestD = Infinity
    for (const hit of app.scene.hits) {
      const d = Math.hypot(hit.x - p.x, hit.y - p.y)
      if (d <= hit.r && d <= bestD) { best = hit; bestD = d }
    }
    return best
  }

  function hover () {
    if (!pointer) return
    const hit = hitAt(pointer)
    canvas.style.cursor = hit ? 'pointer' : (mc.zoom > 1 ? 'grab' : '')
    if (!hit) { hideTip(); return }
    showTip(hit, pointer)
  }

  function showTip (hit, p) {
    const { match: m, journey: j, event: e } = hit
    const single = Boolean(app.state.match)
    const kind = j.bot ? 'Bot' : (j.id_conflict ? 'Human (numeric ID)' : 'Human')
    replace(tip,
      h('div', { class: 'tooltip__title' }, e ? markerIcon(e[0], 14) : null, e ? eventLabel(e[0], j.bot) : playerName(j)),
      h('div', { class: 'tooltip__line' }, e ? `${playerName(j)} · ${kind}` : kind),
      h('div', { class: 'tooltip__line' }, e ? `${formatClock(e[1])} into the match` : `${formatClock(app.time)} into the match`),
      h('div', { class: 'tooltip__line' }, `${formatDay(m.date)} · match ${m.id.slice(0, 8)}`),
      h('div', { class: 'tooltip__action' }, single ? 'Click to focus on this player' : 'Click to open this match at this moment'))
    tip.hidden = false
    // Place it beside the cursor, never under it, and flip at the stage edges.
    const stage = $('stage').getBoundingClientRect()
    const w = tip.offsetWidth; const hgt = tip.offsetHeight
    let x = p.x + 16; let y = p.y + 16
    if (x + w > stage.width - 8) x = p.x - w - 16
    if (y + hgt > stage.height - 8) y = p.y - hgt - 16
    tip.style.left = `${Math.max(8, x)}px`
    tip.style.top = `${Math.max(8, y)}px`
  }

  function hideTip () { tip.hidden = true }

  function click (hit) {
    hideTip()
    if (!hit) {
      if (app.state.focus) app.set({ focus: null }, { url: false })
      return
    }
    if (!app.state.match) {
      // Open the match, with the playhead on the clicked event (or the current time for a head).
      app.set({ match: hit.match.id, t: hit.event ? hit.event[1] : app.time })
      app.set({ focus: hit.journey.user_id }, { url: false })
    } else {
      const id = hit.journey.user_id
      app.set({ focus: app.state.focus === id ? null : id }, { url: false })
    }
  }
}
