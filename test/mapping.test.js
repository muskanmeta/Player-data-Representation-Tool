// Tests for js/map/mapping.js. Run with: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { worldToUV, uvToPixel, isInsideMap, validateMapConfig } from '../js/map/mapping.js'

const { maps } = JSON.parse(await readFile(new URL('../data/maps.json', import.meta.url), 'utf8'))

test('README worked example: (-301.45, -355.55) on Ambrose Valley lands at pixel (78, 890) on 1024 px', () => {
  const uv = worldToUV(-301.45, -355.55, maps.AmbroseValley)
  const px = uvToPixel(uv, { width: 1024, height: 1024 })
  assert.equal(Math.round(px.x), 78)
  assert.equal(Math.round(px.y), 890)
})

test('the same point lands proportionally on any image size (2048 px web copy)', () => {
  const uv = worldToUV(-301.45, -355.55, maps.AmbroseValley)
  const small = uvToPixel(uv, { width: 1024, height: 1024 })
  const large = uvToPixel(uv, { width: 2048, height: 2048 })
  assert.ok(Math.abs(large.x - small.x * 2) < 1e-9)
  assert.ok(Math.abs(large.y - small.y * 2) < 1e-9)
})

test('the world origin maps to the bottom-left corner (image Y is flipped)', () => {
  for (const [id, map] of Object.entries(maps)) {
    const uv = worldToUV(map.originX, map.originZ, map)
    assert.deepEqual(uv, { u: 0, v: 1 }, id)
  }
})

test('origin + scale maps to the top-right corner', () => {
  for (const [id, map] of Object.entries(maps)) {
    const uv = worldToUV(map.originX + map.scale, map.originZ + map.scale, map)
    assert.deepEqual(uv, { u: 1, v: 0 }, id)
  }
})

test('moving north (larger z) moves up the image (smaller pixel y)', () => {
  const map = maps.Lockdown
  const south = uvToPixel(worldToUV(0, -100, map), { width: 1000, height: 1000 })
  const north = uvToPixel(worldToUV(0, 100, map), { width: 1000, height: 1000 })
  assert.ok(north.y < south.y)
})

test('a drawn rectangle offset is added to the pixel position', () => {
  const px = uvToPixel({ u: 0.5, v: 0.5 }, { x: 100, y: 40, width: 200, height: 200 })
  assert.deepEqual(px, { x: 200, y: 140 })
})

test('isInsideMap accepts the edges and rejects points outside', () => {
  assert.equal(isInsideMap({ u: 0, v: 0 }), true)
  assert.equal(isInsideMap({ u: 1, v: 1 }), true)
  assert.equal(isInsideMap({ u: -0.01, v: 0.5 }), false)
  assert.equal(isInsideMap({ u: 0.5, v: 1.01 }), false)
})

test('every map in maps.json has a valid config', () => {
  for (const [id, map] of Object.entries(maps)) {
    assert.deepEqual(validateMapConfig(id, map), [])
  }
})

test('validateMapConfig reports a broken entry', () => {
  const problems = validateMapConfig('Broken', { scale: 0, originX: 'a', image: '' })
  assert.equal(problems.length, 4)
})

// fitRect lives in map-canvas.js, which only touches the DOM inside the class, so it imports in Node.
const { fitRect } = await import('../js/map/map-canvas.js')

test('fitRect keeps the image aspect ratio and centres it', () => {
  const r = fitRect(2048, 2046, 1000, 600, 16)
  assert.ok(Math.abs(r.width / r.height - 2048 / 2046) < 1e-9)
  assert.ok(r.height <= 600 - 32 + 1e-9)
  assert.ok(Math.abs(r.x - (1000 - r.width) / 2) < 1e-9)
})
