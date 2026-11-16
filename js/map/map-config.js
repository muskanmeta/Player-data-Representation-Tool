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
  return Object.fromEntries(Object.entries(maps).map(([id, map]) => [id, { id, ...map }]))
}
