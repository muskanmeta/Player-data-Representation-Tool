// load-dataset.js: fetches the converted dataset (made by tools/convert.mjs) and checks
// that it is a version this app understands before anything is drawn.

import { SCHEMA_VERSION } from './build-dataset.js'

export async function loadDataset (url = 'data/default/dataset.json') {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load player data (${url}: HTTP ${response.status})`)

  const dataset = await response.json()
  if (dataset.schema_version !== SCHEMA_VERSION) {
    throw new Error(`Player data has schema version ${dataset.schema_version}; this app reads version ${SCHEMA_VERSION}. Re-run tools/convert.mjs.`)
  }
  return dataset
}
