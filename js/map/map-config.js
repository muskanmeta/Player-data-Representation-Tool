// map-config.js: loads data/maps.json and checks every entry before anything is drawn.

import { validateMapConfig } from './mapping.js'

/**
 * @returns {Promise<Record<string, { id: string, name: string, image: string,
 *   scale: number, originX: number, originZ: number }>>}  map settings keyed by map_id
 */
export async function loadMapConfigs (url = 'data/maps.json') {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load map settings (${url}: HTTP ${response.status})`)

  const { maps } = await response.json()
  const problems = Object.entries(maps).flatMap(([id, map]) => validateMapConfig(id, map))
  if (problems.length > 0) throw new Error(`Map settings are invalid: ${problems.join('; ')}`)

  // Keep the id inside each entry too, so a config can be passed around on its own.
  return Object.fromEntries(Object.entries(maps).map(([id, map]) => [id, { id, known: true, ...map }]))
}

/**
 * Settings for a map that has no entry in maps.json (new data with a new map). The frame is
 * fitted around the data with a 10% margin, so paths still render, on a grid instead of an
 * image. `known: false` lets the app show a warning: positions are relative only.
 */
export function fallbackMap (mapId, matches) {
  let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity
  for (const m of matches) {
    if (m.map !== mapId) continue
    for (const j of m.journeys) {
      for (let i = 0; i < j.path.length; i += 3) {
        x0 = Math.min(x0, j.path[i + 1]); x1 = Math.max(x1, j.path[i + 1])
        z0 = Math.min(z0, j.path[i + 2]); z1 = Math.max(z1, j.path[i + 2])
      }
    }
  }
  if (!Number.isFinite(x0)) { x0 = z0 = -500; x1 = z1 = 500 }
  const scale = Math.max(x1 - x0, z1 - z0, 1) * 1.1
  return {
    id: mapId,
    name: `${mapId} (no minimap)`,
    image: null,
    known: false,
    scale,
    originX: (x0 + x1) / 2 - scale / 2,
    originZ: (z0 + z1) / 2 - scale / 2
  }
}
