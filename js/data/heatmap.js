// heatmap.js: turns points on the map into a density grid, and a grid into coloured pixels.
// Pure functions (typed arrays in, typed arrays out), so they are unit-tested in Node and
// the renderer only has to put the result on screen.
//
// How a heatmap is made:
//   1. Bin: every point -> UV (0..1) -> one cell of a size x size grid, +1.
//   2. Blur: two box-blur passes smooth single samples into readable blobs.
//   3. Colour: sqrt(value / max) picks a colour on a ramp; zero stays transparent.
// sqrt instead of linear so one very hot spot does not wash every other area out.
//
// Ignored areas use the same grid without blur (see ignoredCells).

import { worldToUV } from '../map/mapping.js'
import { HEATMAPS } from './events.js'

export const HEAT_GRID = 128    // cells per side for density heatmaps
export const IGNORE_GRID = 64   // coarser grid for ignored areas: ~14 world units per cell on Ambrose Valley

/** Adds one point to a grid. Points outside the map are ignored. */
function bin (grid, size, x, z, map) {
  const { u, v } = worldToUV(x, z, map)
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return
  grid[Math.floor(v * size) * size + Math.floor(u * size)]++
}

/**
 * Raw counts for one heatmap mode.
 * @param {object[]} matches   matches in view
 * @param {object} map         map settings (scale, originX, originZ)
 * @param {string} mode        a key of HEATMAPS other than 'none' / 'ignored'
 * @param {number} t           only count what happened at or before t seconds into the match
 * @param {Set<string>} hidden user_ids to leave out
 */
export function countGrid (matches, map, mode, { t = Infinity, hidden = new Set(), size = HEAT_GRID } = {}) {
  const spec = HEATMAPS[mode]
  const grid = new Float32Array(size * size)
  if (!spec || !spec.source) return grid
  const types = spec.types ? new Set(spec.types) : null
  for (const m of matches) {
    for (const j of m.journeys) {
      if (hidden.has(j.user_id)) continue
      if (spec.source === 'path') {
        if (j.bot !== spec.bots) continue
        const p = j.path
        for (let i = 0; i < p.length && p[i] <= t; i += 3) bin(grid, size, p[i + 1], p[i + 2], map)
      } else if (spec.source === 'events') {
        if (j.bot) continue // see HEATMAPS in events.js: bots' events mirror humans' ones
        for (const [type, et, x, z] of j.events) {
          if (et <= t && types.has(type)) bin(grid, size, x, z, map)
        }
      }
    }
  }
  return grid
}

/** Box blur, radius r, applied horizontally then vertically. Returns a new grid. */
export function blur (grid, size, r = 1) {
  const tmp = new Float32Array(grid.length)
  const out = new Float32Array(grid.length)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let s = 0
      for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < size) s += grid[y * size + xx] }
      tmp[y * size + x] = s
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let s = 0
      for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < size) s += tmp[yy * size + x] }
      out[y * size + x] = s / ((2 * r + 1) ** 2)
    }
  }
  return out
}

/** Density heatmap ready to colour: counts, blurred twice, plus its max and total. */
export function densityGrid (matches, map, mode, options = {}) {
  const size = options.size ?? HEAT_GRID
  const counts = countGrid(matches, map, mode, { ...options, size })
  let total = 0
  for (const c of counts) total += c
  const grid = blur(blur(counts, size), size)
  let max = 0
  for (const v of grid) if (v > max) max = v
  return { grid, size, max, total }
}

// Colour ramp, low -> high. Chosen to stay readable on both dark and bright minimap areas.
const RAMP = [
  [0.00, [30, 60, 160]],
  [0.30, [0, 170, 200]],
  [0.55, [120, 220, 90]],
  [0.80, [255, 200, 40]],
  [1.00, [255, 60, 40]]
]

/** Colour for a value in 0..1, as [r, g, b]. */
export function rampColor (k) {
  for (let i = 1; i < RAMP.length; i++) {
    const [k1, c1] = RAMP[i]
    if (k <= k1) {
      const [k0, c0] = RAMP[i - 1]
      const f = (k - k0) / (k1 - k0)
      return c0.map((c, n) => Math.round(c + (c1[n] - c) * f))
    }
  }
  return RAMP[RAMP.length - 1][1]
}

/** CSS gradient matching the ramp, for the legend. */
export const RAMP_CSS = `linear-gradient(90deg, ${RAMP.map(([k, c]) => `rgb(${c.join(' ')}) ${k * 100}%`).join(', ')})`

/** Grid -> RGBA pixels (one pixel per cell). Empty cells are fully transparent. */
export function colorize ({ grid, size, max }) {
  const px = new Uint8ClampedArray(size * size * 4)
  if (max <= 0) return px
  for (let i = 0; i < grid.length; i++) {
    const k = Math.sqrt(grid[i] / max)
    if (k < 0.04) continue
    const [r, g, b] = rampColor(k)
    px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b
    px[i * 4 + 3] = Math.round(90 + 165 * k)
  }
  return px
}

/**
 * Reachable cells of a map: any cell that any player, human or bot, has a position sample
 * in, across ALL matches on the map (every date, whole match). It stands in for a
 * walkability mask, which the telemetry does not include.
 */
export function reachableCells (allMatchesOnMap, map, size = IGNORE_GRID) {
  const grid = new Float32Array(size * size)
  for (const m of allMatchesOnMap) {
    for (const j of m.journeys) {
      const p = j.path
      for (let i = 0; i < p.length; i += 3) bin(grid, size, p[i + 1], p[i + 2], map)
    }
  }
  return Uint8Array.from(grid, v => (v > 0 ? 1 : 0))
}

/**
 * Ignored cells: reachable, but no human position sample in the cell or any of its 8
 * neighbours in the current view. Returns a 0/1 mask plus counts for the legend.
 */
export function ignoredCells (viewMatches, map, reachable, { t = Infinity, hidden = new Set(), size = IGNORE_GRID } = {}) {
  const human = countGrid(viewMatches, map, 'traffic', { t, hidden, size })
  const mask = new Uint8Array(size * size)
  let ignored = 0; let reachableCount = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      if (!reachable[i]) continue
      reachableCount++
      let near = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy; const xx = x + dx
          if (yy >= 0 && yy < size && xx >= 0 && xx < size) near += human[yy * size + xx]
        }
      }
      if (near === 0) { mask[i] = 1; ignored++ }
    }
  }
  return { mask, size, ignored, reachable: reachableCount }
}
