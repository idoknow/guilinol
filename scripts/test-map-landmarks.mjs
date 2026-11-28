import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import test from 'node:test'
import {mapLandmarks, LANDMARK_KIND_LABEL} from '../web/src/play/map-landmarks.ts'
import {spots} from '../web/src/play/spots.ts'
import {inRegion} from '../lib/play-region.ts'

const REQUIRED_REGIONS = ['临桂', '城西', '城北', '城南', '城东', '东拓']
const BLOCKED_BRANDS = ['万达', '万象城', '恒大', '海底捞', '星巴克', '肯德基', '麦当劳']

test('mapLandmarks covers all six outer open regions with clean metadata', () => {
  assert.ok(mapLandmarks.length >= 30, `expected >= 30 regional landmarks, got ${mapLandmarks.length}`)
  const ids = new Set()
  const spotIds = new Set(spots.map(s => s.id))
  const regionCounts = new Map()
  const tier1Regions = new Set()

  for (const lm of mapLandmarks) {
    assert.ok(lm.id && !ids.has(lm.id), `duplicate or empty landmark id: ${lm.id}`)
    assert.ok(!spotIds.has(lm.id), `landmark id collides with central spots: ${lm.id}`)
    ids.add(lm.id)
    assert.ok(lm.name.length >= 2, `invalid name: ${lm.id}`)
    assert.equal([...lm.glyph].length, 1, `glyph must be 1 character: ${lm.id}`)
    assert.ok(lm.kind in LANDMARK_KIND_LABEL, `unknown kind: ${lm.kind}`)
    assert.ok(lm.tier === 1 || lm.tier === 2, `invalid tier: ${lm.id}`)
    assert.ok(Number.isFinite(lm.x) && Number.isFinite(lm.z), `invalid coords: ${lm.id}`)
    assert.ok(lm.sub.length >= 4, `sub too short: ${lm.id}`)
    for (const brand of BLOCKED_BRANDS) {
      assert.ok(!lm.name.includes(brand) && !lm.sub.includes(brand), `commercial trademark "${brand}" in ${lm.id}`)
    }
    regionCounts.set(lm.region, (regionCounts.get(lm.region) ?? 0) + 1)
    if (lm.tier === 1) tier1Regions.add(lm.region)
  }

  for (const region of REQUIRED_REGIONS) {
    assert.ok((regionCounts.get(region) ?? 0) >= 5, `region ${region} should have >= 5 landmarks`)
    assert.ok(tier1Regions.has(region), `region ${region} must have at least one Tier-1 overview landmark`)
  }
})

test('mapLandmarks avoids crowding pairs (<250m) and stays inside full open region when manifest exists', () => {
  for (let i = 0; i < mapLandmarks.length; i++) {
    for (let j = i + 1; j < mapLandmarks.length; j++) {
      const a = mapLandmarks[i], b = mapLandmarks[j]
      const dist = Math.hypot(a.x - b.x, a.z - b.z)
      assert.ok(dist >= 250, `landmarks too close (${dist.toFixed(0)}m): ${a.name} <-> ${b.name}`)
    }
  }

  const manifestPath = 'public/world/manifest.json'
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.region) {
      for (const lm of mapLandmarks) {
        assert.ok(inRegion(manifest, lm.x, lm.z), `landmark outside open region: ${lm.name} (${lm.x}, ${lm.z})`)
      }
    }
  }
})
