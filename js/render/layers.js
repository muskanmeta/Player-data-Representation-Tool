// layers.js: the overlays drawn on the map canvas every frame, in this order:
//   1. heatmap (or the ignored-areas hatch)
//   2. bot paths (dashed grey), then human paths (solid colour)
//   3. event markers up to the playhead
//   4. player "heads" during playback
// Each overlay reads a `scene` object that the app rebuilds when filters change, and
// records what it drew into scene.hits, so hovering can find the marker under the cursor
// without a second pass over the data.

import { pointsUntil, positionAt } from '../data/select.js'
import { drawMarkerBatch } from './markers.js'

export const BOT_COLOR = 'rgba(200, 206, 218, 0.55)'
export const HUMAN_COLOR = 'rgba(79, 195, 255, 0.6)'
const TRAIL_SECONDS = 30

// Per-player colours for the single-match view: distinct hues that read on the minimaps.
const PALETTE = ['#4fc3ff', '#ff7ab6', '#7cf29c', '#ffb347', '#b39dff', '#ff6b6b', '#5ce1e6', '#f9f871', '#ff9a76', '#9ad0ff']
export const colorFor = index => PALETTE[index % PALETTE.length]

// ---------- heatmap ----------

/** Draws the current heatmap: a small coloured grid scaled up with smoothing, or hatched ignored cells. */
export function heatLayer (scene) {
  let hatch = null
  return (ctx, { rect }) => {
    const heat = scene.heat
    if (!heat) return
    ctx.save()
    if (heat.kind === 'density') {
      ctx.globalAlpha = scene.heatOpacity
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(heat.canvas, rect.x, rect.y, rect.width, rect.height)
    } else if (heat.kind === 'ignored') {
      hatch ??= makeHatch(ctx)
      const { mask, size } = heat
      const cw = rect.width / size; const ch = rect.height / size
      ctx.globalAlpha = Math.min(1, scene.heatOpacity + 0.2)
      ctx.fillStyle = hatch
      ctx.strokeStyle = 'rgba(255, 92, 184, 0.9)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue
        ctx.rect(rect.x + (i % size) * cw, rect.y + Math.floor(i / size) * ch, cw, ch)
      }
      ctx.fill()
    }
    ctx.restore()
  }
}

/** Diagonal magenta stripes: reads as "nobody here" and shows in greyscale too. */
function makeHatch (ctx) {
  const c = document.createElement('canvas')
  c.width = c.height = 8
  const g = c.getContext('2d')
  g.fillStyle = 'rgba(255, 92, 184, 0.18)'
  g.fillRect(0, 0, 8, 8)
  g.strokeStyle = 'rgba(255, 92, 184, 0.95)'
  g.lineWidth = 2
  g.beginPath(); g.moveTo(-2, 10); g.lineTo(10, -2); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(6, 10); g.lineTo(10, 6); g.stroke()
  return ctx.createPattern(c, 'repeat')
}

// ---------- paths, markers, heads ----------

/**
 * scene: { matches, t, single, off: Set, hidden: Set, focus, trail, colors: Map<user_id, css>,
 *          showHeads, hits: [] }
 */
export function journeysLayer (scene) {
  return (ctx, { toCanvas, zoom, moving }) => {
    scene.hits = []
    const { matches, t, off, hidden, focus, single } = scene
    const showHumans = !off.has('humans')
    const showBots = !off.has('bots')
    const showPaths = !off.has('paths')
    const visible = j => !hidden.has(j.user_id) && (j.bot ? showBots : showHumans)
    const dim = j => (focus && j.user_id !== focus ? 0.18 : 1)
    const from = j => (scene.trail ? pointsUntil(j.path, t - TRAIL_SECONDS) : 0)

    // Density-aware opacity: with hundreds of journeys overlaid, full-strength lines become
    // a solid blanket. Fading each line by ~1/sqrt(count) keeps busy routes brighter than
    // rare ones, which is the point of overlaying them.
    let drawn = 0
    for (const m of matches) for (const j of m.journeys) if (visible(j)) drawn++
    // With a heatmap on, the heatmap is the subject: paths step back to half strength.
    const density = (single ? 1 : Math.min(1, Math.max(0.12, Math.sqrt(40 / Math.max(1, drawn))))) * (scene.heat ? 0.5 : 1)

    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    if (showPaths) {
      // Bots first, so human paths sit on top.
      ctx.setLineDash([4, 3])
      ctx.lineWidth = single ? 1.5 : 1
      ctx.strokeStyle = BOT_COLOR
      for (const m of matches) {
        for (const j of m.journeys) {
          if (!j.bot || !visible(j)) continue
          ctx.globalAlpha = dim(j) * density
          strokePath(ctx, j.path, from(j), pointsUntil(j.path, t), toCanvas)
        }
      }
      ctx.setLineDash([])
      ctx.lineWidth = single ? 2.25 : 1.25
      for (const m of matches) {
        for (const j of m.journeys) {
          if (j.bot || !visible(j)) continue
          ctx.globalAlpha = dim(j) * density
          ctx.strokeStyle = single ? scene.colors.get(j.user_id) : HUMAN_COLOR
          strokePath(ctx, j.path, from(j), pointsUntil(j.path, t), toCanvas)
        }
      }
      ctx.globalAlpha = 1
    }

    // Markers: bigger in the single-match view, and growing a little when zoomed in.
    // Collected per event type (and per dimmed/not), then drawn in one batch each:
    // loot first (the most common event), kills and deaths on top of it.
    const r = (single ? 5.5 : 3.2) * Math.min(1.8, Math.sqrt(zoom))
    const batches = new Map() // `${type}|${alpha}` -> [x, y, ...]
    // While panning or zooming a busy view, skip markers; they return when the view settles.
    const skipMarkers = moving && !single
    for (const m of skipMarkers ? [] : matches) {
      for (const j of m.journeys) {
        if (!visible(j)) continue
        const alpha = dim(j)
        for (const e of j.events) {
          const [type, et, x, z] = e
          if (et > t) break // events are sorted by time
          if (off.has(type)) continue
          if (scene.trail && et < t - TRAIL_SECONDS) continue
          const p = toCanvas(x, z)
          const key = `${type}|${alpha}`
          if (!batches.has(key)) batches.set(key, [])
          batches.get(key).push(p.x, p.y)
          if (alpha === 1) scene.hits.push({ x: p.x, y: p.y, r: r + 3, kind: 'event', match: m, journey: j, event: e })
        }
      }
    }
    const order = key => (key.startsWith('Loot|') ? 0 : 1) + (key.endsWith('|1') ? 2 : 0) // dimmed first, loot under the rest
    for (const key of [...batches.keys()].sort((a, b) => order(a) - order(b))) {
      const [type, alpha] = key.split('|')
      drawMarkerBatch(ctx, type, batches.get(key), type === 'Loot' && !single ? r * 0.7 : r, Number(alpha))
    }

    // Heads: where each player is at the playhead.
    if (scene.showHeads) {
      for (const m of matches) {
        for (const j of m.journeys) {
          if (!visible(j)) continue
          const pos = positionAt(j.path, t)
          if (!pos || (pos.ended && t - j.path[j.path.length - 3] > 3)) continue
          const p = toCanvas(pos.x, pos.z)
          const hr = single ? 6 : 4
          ctx.globalAlpha = dim(j)
          ctx.beginPath()
          ctx.arc(p.x, p.y, hr, 0, Math.PI * 2)
          ctx.fillStyle = j.bot ? '#c8ceda' : (single ? scene.colors.get(j.user_id) : '#4fc3ff')
          ctx.fill()
          ctx.lineWidth = 2
          ctx.strokeStyle = j.bot ? '#3a4150' : '#ffffff'
          ctx.stroke()
          ctx.globalAlpha = 1
          if (!focus || j.user_id === focus) scene.hits.push({ x: p.x, y: p.y, r: hr + 3, kind: 'head', match: m, journey: j })
        }
      }
    }
    ctx.restore()
  }
}

/** Strokes points [from, to) of a flat path as one polyline. */
function strokePath (ctx, path, from, to, toCanvas) {
  if (to - from < 2) return
  ctx.beginPath()
  for (let n = from; n < to; n++) {
    const p = toCanvas(path[n * 3 + 1], path[n * 3 + 2])
    if (n === from) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  }
  ctx.stroke()
}
