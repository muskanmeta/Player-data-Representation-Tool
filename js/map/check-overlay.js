// check-overlay.js: a developer overlay for checking the coordinate mapping by eye.
// Turn it on with ?check=mapping in the URL. It draws:
//   - the map frame (UV 0..1) and its world-coordinate corners
//   - the data README's worked example point on Ambrose Valley

const README_EXAMPLE = { mapId: 'AmbroseValley', x: -301.45, z: -355.55 }

export function checkOverlay (map) {
  return (ctx, { rect, toCanvas }) => {
    ctx.save()
    ctx.strokeStyle = '#ffd166'
    ctx.fillStyle = '#ffd166'
    ctx.lineWidth = 1
    ctx.font = '12px system-ui, sans-serif'
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1)

    // World corners: origin is bottom-left, origin + scale is top-right.
    const corners = [
      [map.originX, map.originZ, 'left', 'bottom'],
      [map.originX + map.scale, map.originZ + map.scale, 'right', 'top']
    ]
    for (const [x, z, align, baseline] of corners) {
      const p = toCanvas(x, z)
      ctx.textAlign = align
      ctx.textBaseline = baseline
      ctx.fillText(`(${x}, ${z})`, p.x + (align === 'left' ? 6 : -6), p.y + (baseline === 'top' ? 6 : -6))
    }

    if (map.id === README_EXAMPLE.mapId) {
      const p = toCanvas(README_EXAMPLE.x, README_EXAMPLE.z)
      ctx.beginPath()
      ctx.moveTo(p.x - 10, p.y); ctx.lineTo(p.x + 10, p.y)
      ctx.moveTo(p.x, p.y - 10); ctx.lineTo(p.x, p.y + 10)
      ctx.stroke()
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText('README example (-301.45, -355.55)', p.x + 14, p.y)
    }
    ctx.restore()
  }
}
