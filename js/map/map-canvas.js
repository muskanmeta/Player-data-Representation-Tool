// map-canvas.js: draws a minimap on a <canvas>, sharp on high-DPI screens, and keeps it
// fitted to the stage when the window is resized.
//
// Later features draw on top through the `overlays` list; each overlay receives the
// context and a toCanvas(x, z) function, so no other module needs to know about pixels.

import { worldToUV, uvToPixel } from './mapping.js'

const PADDING = 16 // CSS px kept free around the map

export class MapCanvas {
  /** @param {HTMLCanvasElement} canvas */
  constructor (canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.map = null        // current map settings from maps.json
    this.image = null      // its loaded minimap image
    this.rect = null       // where the image is drawn, in CSS px: { x, y, width, height }
    this.overlays = []     // functions (ctx, view) => void, drawn after the minimap

    // Redraw whenever the canvas changes size (window resize, sidebar change, ...).
    new ResizeObserver(() => this.draw()).observe(canvas)
  }

  /** Switches to a map and resolves once its image is loaded and drawn. */
  async setMap (map) {
    this.map = map
    this.image = await loadImage(map.image)
    this.draw()
  }

  /** World (x, z) -> canvas position in CSS px for the current map and size. */
  toCanvas (x, z) {
    return uvToPixel(worldToUV(x, z, this.map), this.rect)
  }

  draw () {
    const { canvas, ctx } = this

    // High-DPI: the canvas bitmap gets devicePixelRatio times more pixels than its CSS size,
    // and the transform scales drawing back, so all code below works in CSS px but stays sharp.
    const dpr = window.devicePixelRatio || 1
    const cssWidth = canvas.clientWidth
    const cssHeight = canvas.clientHeight
    if (cssWidth === 0 || cssHeight === 0) return

    const bitmapWidth = Math.round(cssWidth * dpr)
    const bitmapHeight = Math.round(cssHeight * dpr)
    if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
      canvas.width = bitmapWidth   // resizing also clears the canvas
      canvas.height = bitmapHeight
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssWidth, cssHeight)

    if (!this.image) return

    this.rect = fitRect(this.image.naturalWidth, this.image.naturalHeight, cssWidth, cssHeight, PADDING)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(this.image, this.rect.x, this.rect.y, this.rect.width, this.rect.height)

    const view = { rect: this.rect, toCanvas: (x, z) => this.toCanvas(x, z) }
    for (const overlay of this.overlays) overlay(ctx, view)
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
