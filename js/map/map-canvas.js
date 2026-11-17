// map-canvas.js: draws a minimap on a <canvas>, sharp on high-DPI screens, with zoom and
// pan, and keeps it fitted to the stage when the window is resized.
//
// Two layers, so playback stays smooth:
//   - base: the minimap image (or a grid for a map with no image), rendered once into an
//     offscreen canvas and only re-rendered when the size, zoom or pan changes;
//   - overlays: heatmap, paths, markers, heads, redrawn on every frame on top of the base.
// Overlays receive the context and a toCanvas(x, z) function, so no other module needs to
// know about pixels, zoom or devicePixelRatio.

import { worldToUV, uvToPixel } from './mapping.js'

const PADDING = 16 // CSS px kept free around the map
export const MIN_ZOOM = 1
export const MAX_ZOOM = 12

export class MapCanvas {
  /** @param {HTMLCanvasElement} canvas */
  constructor (canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.map = null        // current map settings
    this.image = null      // its loaded minimap image (null = draw a grid)
    this.rect = null       // where the map is drawn, in CSS px, zoom and pan included
    this.zoom = 1
    this.pan = { x: 0, y: 0 } // CSS px offset of the map from its fitted position
    this.overlays = []     // functions (ctx, view) => void, drawn after the base layer
    this.onViewChange = () => {}
    this.base = document.createElement('canvas') // cached base layer
    this.baseKey = ''
    this.frame = 0

    // Redraw whenever the canvas changes size (window resize, sidebar change, ...).
    new ResizeObserver(() => this.draw()).observe(canvas)
  }

  /** Switches to a map and resolves once its image is loaded and drawn. */
  async setMap (map) {
    // Load first, then switch map and image together: switching the map before its image
    // has arrived would draw (and cache) one frame of the new map on a blank background.
    // `pending` makes sure a slow image never overwrites a map chosen after it.
    this.pending = map
    const image = map.image ? await loadImage(map.image) : null
    if (this.pending !== map) return
    this.map = map
    this.image = image
    this.resetView()
  }

  /** World (x, z) -> canvas position in CSS px for the current map, size, zoom and pan. */
  toCanvas (x, z) {
    return uvToPixel(worldToUV(x, z, this.map), this.rect)
  }

  /** Canvas CSS px -> UV (0..1 inside the map). */
  toUV (px, py) {
    return { u: (px - this.rect.x) / this.rect.width, v: (py - this.rect.y) / this.rect.height }
  }

  /** Zooms by `factor` keeping the map point under (px, py) where it is. */
  zoomAt (px, py, factor) {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor))
    if (next === this.zoom || !this.rect) return
    const { u, v } = this.toUV(px, py)
    const fit = this.fitted()
    const width = fit.width * next; const height = fit.height * next
    this.pan = { x: px - u * width - fit.x, y: py - v * height - fit.y }
    this.zoom = next
    this.clampPan()
    this.changed()
  }

  panBy (dx, dy) {
    if (this.zoom === 1) return
    this.pan = { x: this.pan.x + dx, y: this.pan.y + dy }
    this.clampPan()
    this.changed()
  }

  resetView () {
    this.zoom = 1
    this.pan = { x: 0, y: 0 }
    this.changed()
  }

  /** Never let the map slide fully out of view. */
  clampPan () {
    const fit = this.fitted()
    const w = fit.width * this.zoom; const h = fit.height * this.zoom
    const cw = this.canvas.clientWidth; const ch = this.canvas.clientHeight
    const keep = 80 // px of map that always stays on screen
    this.pan.x = Math.min(cw - keep - fit.x, Math.max(keep - w - fit.x, this.pan.x))
    this.pan.y = Math.min(ch - keep - fit.y, Math.max(keep - h - fit.y, this.pan.y))
  }

  changed () {
    // Level of detail: while the view is moving, overlays may skip expensive detail
    // (see `moving` in layers.js). Full detail returns 150 ms after the last change.
    this.moving = true
    clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => { this.moving = false; this.requestDraw() }, 150)
    this.requestDraw()
    this.onViewChange()
  }

  /** Coalesces many redraw requests into one per animation frame. */
  requestDraw () {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw() })
  }

  /** Where the map sits at zoom 1 ("contain" fit, aspect ratio kept). */
  fitted () {
    const iw = this.image?.naturalWidth ?? 1000
    const ih = this.image?.naturalHeight ?? 1000
    return fitRect(iw, ih, this.canvas.clientWidth, this.canvas.clientHeight, PADDING)
  }

  draw () {
    const { canvas, ctx } = this

    // High-DPI: the canvas bitmap gets devicePixelRatio times more pixels than its CSS size,
    // and the transform scales drawing back, so all code below works in CSS px but stays sharp.
    const dpr = window.devicePixelRatio || 1
    const cssWidth = canvas.clientWidth
    const cssHeight = canvas.clientHeight
    if (cssWidth === 0 || cssHeight === 0 || !this.map) return

    const bitmapWidth = Math.round(cssWidth * dpr)
    const bitmapHeight = Math.round(cssHeight * dpr)
    if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
      canvas.width = bitmapWidth   // resizing also clears the canvas
      canvas.height = bitmapHeight
    }

    const fit = this.fitted()
    this.rect = {
      x: fit.x + this.pan.x,
      y: fit.y + this.pan.y,
      width: fit.width * this.zoom,
      height: fit.height * this.zoom
    }

    // Base layer: re-render only when something that changes its pixels changed.
    const key = [bitmapWidth, bitmapHeight, this.map.id, this.image?.src ?? 'grid', this.rect.x, this.rect.y, this.rect.width].join('|')
    if (key !== this.baseKey) {
      this.renderBase(bitmapWidth, bitmapHeight, dpr)
      this.baseKey = key
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, bitmapWidth, bitmapHeight)
    ctx.drawImage(this.base, 0, 0)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const view = { rect: this.rect, zoom: this.zoom, moving: Boolean(this.moving), toCanvas: (x, z) => this.toCanvas(x, z) }
    for (const overlay of this.overlays) overlay(ctx, view)
  }

  renderBase (w, h, dpr) {
    this.base.width = w
    this.base.height = h
    const b = this.base.getContext('2d')
    b.setTransform(dpr, 0, 0, dpr, 0, 0)
    const r = this.rect
    if (this.image) {
      b.imageSmoothingQuality = 'high'
      b.drawImage(this.image, r.x, r.y, r.width, r.height)
      return
    }
    // No minimap for this map: a neutral grid, one line per tenth of the map.
    b.fillStyle = '#161b24'
    b.fillRect(r.x, r.y, r.width, r.height)
    b.strokeStyle = '#2a3140'
    b.lineWidth = 1
    b.beginPath()
    for (let i = 0; i <= 10; i++) {
      const x = r.x + (r.width * i) / 10; const y = r.y + (r.height * i) / 10
      b.moveTo(x, r.y); b.lineTo(x, r.y + r.height)
      b.moveTo(r.x, y); b.lineTo(r.x + r.width, y)
    }
    b.stroke()
  }
}

/**
 * Largest rectangle with the image's aspect ratio that fits inside the area, centred
 * ("contain" fit). Keeping the aspect ratio is what keeps world distances undistorted.
 */
export function fitRect (imageWidth, imageHeight, areaWidth, areaHeight, padding = 0) {
  const availableWidth = Math.max(areaWidth - padding * 2, 1)
  const availableHeight = Math.max(areaHeight - padding * 2, 1)
  const scale = Math.min(availableWidth / imageWidth, availableHeight / imageHeight)
  const width = imageWidth * scale
  const height = imageHeight * scale
  return { x: (areaWidth - width) / 2, y: (areaHeight - height) / 2, width, height }
}

function loadImage (src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Could not load the minimap image: ${src}`))
    image.src = src
  })
}
