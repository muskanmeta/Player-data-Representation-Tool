// paths-overlay.js: draws every journey of the given matches on the map.
// Humans: solid light-blue lines. Bots: dashed grey lines. This is the first view of the
// data; the journeys feature later adds per-player colours, markers and toggles.

const HUMAN = 'rgba(79, 195, 255, 0.55)'
const BOT = 'rgba(195, 202, 214, 0.35)'

export function pathsOverlay (getMatches) {
  return (ctx, { toCanvas }) => {
    ctx.save()
    ctx.lineWidth = 1.25
    ctx.lineJoin = 'round'

    // Bots first, so human paths sit on top.
    for (const drawBots of [true, false]) {
      ctx.strokeStyle = drawBots ? BOT : HUMAN
      ctx.setLineDash(drawBots ? [4, 3] : [])
      ctx.beginPath()
      for (const match of getMatches()) {
        for (const journey of match.journeys) {
          if (journey.bot !== drawBots) continue
          const p = journey.path // flat [t, x, z, ...]
          for (let i = 0; i < p.length; i += 3) {
            const { x, y } = toCanvas(p[i + 1], p[i + 2])
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
        }
      }
      ctx.stroke()
    }
    ctx.restore()
  }
}
