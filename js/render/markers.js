// markers.js: draws the event marker shapes. Used on the map canvas and, as small
// <canvas> icons, in the legend, so the legend always matches what is on the map.
//
// Every event type has its own SHAPE as well as its own colour (see events.js), and every
// shape has a dark outline so it stays readable on bright and dark parts of a minimap.

import { EVENT_TYPES } from '../data/events.js'

const OUTLINE = 'rgba(8, 10, 14, 0.9)'

/** Traces a shape centred on (x, y) with "radius" r into the current path. */
function trace (ctx, shape, x, y, r) {
  switch (shape) {
    case 'diamond':
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath()
      break
    case 'square':
      ctx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6)
      break
    case 'triangle':
      ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.95, y + r * 0.75); ctx.lineTo(x - r * 0.95, y + r * 0.75); ctx.closePath()
      break
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const rr = i % 2 ? r * 0.45 : r * 1.15
        if (i === 0) ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a))
        else ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a))
      }
      ctx.closePath()
      break
    case 'cross': {
      // A thick "X" made as one polygon, so it can be filled and outlined like the others.
      const a = r * 0.38
      const pts = [[0, -a], [r - a, -r], [r, -r + a], [a, 0], [r, r - a], [r - a, r], [0, a], [-r + a, r], [-r, r - a], [-a, 0], [-r, -r + a], [-r + a, -r]]
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px, y + py) : ctx.moveTo(x + px, y + py)))
      ctx.closePath()
      break
    }
    default: // circle, and unknown event types
      ctx.moveTo(x + r, y)
      ctx.arc(x, y, r, 0, Math.PI * 2)
  }
}

/** Draws one marker for an event type. Unknown types get a white circle. */
export function drawMarker (ctx, type, x, y, r = 5, alpha = 1) {
  const spec = EVENT_TYPES[type] ?? { shape: 'circle', color: '#ffffff' }
  ctx.globalAlpha = alpha
  ctx.beginPath()
  trace(ctx, spec.shape, x, y, r)
  ctx.fillStyle = spec.color
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = OUTLINE
  ctx.stroke()
  ctx.globalAlpha = 1
}

// Sprite cache: each (type, size, pixel ratio) is drawn once into a tiny offscreen canvas
// and then stamped with drawImage. With ~16,000 markers on screen (every match overlaid)
// this takes the marker pass from ~80 ms to a few ms per frame: copying a small bitmap is
// far cheaper than building, filling and outlining a vector shape each time.
const sprites = new Map()

function sprite (type, r, dpr) {
  const key = `${type}|${r.toFixed(2)}|${dpr}`
  let s = sprites.get(key)
  if (!s) {
    const half = Math.ceil(r * 1.25 + 2) // room for the star's points and the outline
    const c = document.createElement('canvas')
    c.width = c.height = Math.ceil(half * 2 * dpr)
    const g = c.getContext('2d')
    g.scale(dpr, dpr)
    drawMarker(g, type, half, half, r)
    s = { canvas: c, half }
    if (sprites.size > 200) sprites.clear() // sizes change with zoom; keep the cache small
    sprites.set(key, s)
  }
  return s
}

/**
 * Draws many markers of ONE type and size by stamping a cached sprite.
 * @param {number[]} points  flat [x, y, x, y, ...] in CSS px
 */
export function drawMarkerBatch (ctx, type, points, r, alpha = 1) {
  if (points.length === 0) return
  const dpr = window.devicePixelRatio || 1
  const { canvas, half } = sprite(type, r, dpr)
  const size = half * 2
  ctx.globalAlpha = alpha
  for (let i = 0; i < points.length; i += 2) {
    ctx.drawImage(canvas, points[i] - half, points[i + 1] - half, size, size)
  }
  ctx.globalAlpha = 1
}

/** A small canvas showing one marker, for legends and tooltips. */
export function markerIcon (type, size = 16) {
  const c = document.createElement('canvas')
  const dpr = window.devicePixelRatio || 1
  c.width = c.height = Math.round(size * dpr)
  c.style.width = c.style.height = `${size}px`
  c.className = 'marker-icon'
  c.setAttribute('aria-hidden', 'true')
  const ctx = c.getContext('2d')
  ctx.scale(dpr, dpr)
  drawMarker(ctx, type, size / 2, size / 2, size * 0.36)
  return c
}
