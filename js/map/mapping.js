// mapping.js: game world coordinates -> minimap coordinates. Pure functions, no DOM,
// so the same code runs in the browser and in Node tests.
//
// The data README gives:
//   u = (x - originX) / scale        v = (z - originZ) / scale
//   pixel = (u * width, (1 - v) * height)      <- image Y points down, so v is flipped
//
// Two details matter:
//   - The 2D plane is x and z. The y column is height and is ignored.
//   - The README says the minimaps are 1024 px, but the real images are 4320, 2160x2158 and
//     9000 px (our web copies are ~2048 px). So we never compute pixels for a fixed size.
//     We stop at UV (0..1 across the image) and multiply by whatever size is actually drawn.

/**
 * World (x, z) -> UV, with v already flipped into image space (0 = top edge, 1 = bottom edge).
 * A point inside the map gives values in 0..1; outside the map gives values beyond that range.
 *
 * @param {number} x  world X
 * @param {number} z  world Z
 * @param {{ scale: number, originX: number, originZ: number }} map  settings from maps.json
 * @returns {{ u: number, v: number }}
 */
export function worldToUV (x, z, map) {
  return {
    u: (x - map.originX) / map.scale,
    v: 1 - (z - map.originZ) / map.scale
  }
}

/**
 * UV -> pixel position inside an image or a drawn rectangle.
 *
 * @param {{ u: number, v: number }} uv
 * @param {{ x?: number, y?: number, width: number, height: number }} rect  where the map is drawn
 * @returns {{ x: number, y: number }}
 */
export function uvToPixel ({ u, v }, rect) {
  return {
    x: (rect.x ?? 0) + u * rect.width,
    y: (rect.y ?? 0) + v * rect.height
  }
}

/** True when a UV point lies on the map image (edges included). */
export function isInsideMap ({ u, v }) {
  return u >= 0 && u <= 1 && v >= 0 && v <= 1
}

/**
 * Checks one map entry from maps.json and returns a list of problems (empty when valid).
 * A bad config would put every path in the wrong place, so it is better to fail loudly.
 */
export function validateMapConfig (id, map) {
  const problems = []
  if (!(typeof map.scale === 'number' && map.scale > 0)) problems.push(`${id}: scale must be a positive number`)
  if (!Number.isFinite(map.originX)) problems.push(`${id}: originX must be a number`)
  if (!Number.isFinite(map.originZ)) problems.push(`${id}: originZ must be a number`)
  if (typeof map.image !== 'string' || map.image === '') problems.push(`${id}: image path is missing`)
  return problems
}
