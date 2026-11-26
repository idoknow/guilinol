import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'

import {
  XXG_TEXTURE_BUDGET_BYTES,
  XXG_PALETTE,
  XXG_SIGN_FONTS,
  XXG_UI_TOKENS,
  SIGN_ATLAS_RECTS,
  XXG_PHOTO_COMPARISON_PAIRS,
  applySignAtlasRect,
  createTextureUploadCache,
  createXiaoxianggangMaterials,
  resolveShopLook,
} from './index.ts'
import { XXG_BUDGET } from '../contract.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../../..')
const REFS_DIR = path.join(REPO_ROOT, 'docs/xiaoxianggang/refs')

test('texture budget stays strictly <= 8 MiB (both raw and mipmapped) with real pixel buffers', () => {
  const pack = createXiaoxianggangMaterials()
  try {
    const budget = pack.getTextureBudget()
    assert.equal(budget.limitBytes, 8 * 1024 * 1024)
    assert.ok(budget.uniqueTextureCount >= 18, `expected >=18 unique textures, got ${budget.uniqueTextureCount}`)
    assert.ok(budget.rawBytes > 1024 * 1024, 'textures must have real resolution rather than 1x1 stubs')
    assert.ok(
      budget.rawBytes <= XXG_TEXTURE_BUDGET_BYTES,
      `raw texture bytes ${budget.rawBytes} exceeded 8 MiB limit ${XXG_TEXTURE_BUDGET_BYTES}`,
    )
    assert.ok(
      budget.mipmappedBytes <= XXG_TEXTURE_BUDGET_BYTES,
      `mipmapped texture bytes ${budget.mipmappedBytes} exceeded 8 MiB limit ${XXG_TEXTURE_BUDGET_BYTES}`,
    )
    assert.equal(budget.duplicateUploadCount, 0)

    const seenTextures = new Set()
    for (const mat of [
      pack.floorTerrazzo,
      pack.floorRenovated,
      pack.wallCorridor,
      pack.wallBoutiquePink,
      pack.ceilingGrid,
      pack.lightStripCool,
      pack.lightStripWarm,
      pack.rollerShutterSilver,
      pack.rollerShutterCream,
      pack.stairGranite,
      pack.skylightGlass,
      pack.signAtlasMat,
    ]) {
      for (const slot of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) {
        const tex = mat[slot]
        if (!tex) continue
        seenTextures.add(tex)
        assert.ok(tex.image && tex.image.data instanceof Uint8Array, `${mat.name}.${slot} has backing Uint8Array`)
        assert.equal(tex.image.data.byteLength, tex.image.width * tex.image.height * 4)
      }
    }
    assert.equal(seenTextures.size, budget.uniqueTextureCount)
  } finally {
    pack.dispose()
  }
})

test('zero duplicate GPU texture uploads across variants and shared cache re-mounts', () => {
  const sharedCache = createTextureUploadCache()
  const packA = createXiaoxianggangMaterials({ cache: sharedCache, preserveExternalCacheOnDispose: true })
  const firstCount = sharedCache.getSnapshot().uniqueTextureCount
  const firstAcquires = sharedCache.getSnapshot().acquireCalls

  // 内部共用检查：两款卷帘门共享法线/粗糙度，两面墙共享基底纹理，两条灯带共享漫射格纹
  assert.equal(packA.rollerShutterSilver.normalMap, packA.rollerShutterCream.normalMap)
  assert.equal(packA.rollerShutterSilver.roughnessMap, packA.rollerShutterCream.roughnessMap)
  assert.notEqual(packA.rollerShutterSilver.map, packA.rollerShutterCream.map)
  assert.equal(packA.wallCorridor.map, packA.wallBoutiquePink.map)
  assert.equal(packA.wallCorridor.roughnessMap, packA.wallBoutiquePink.roughnessMap)
  assert.equal(packA.lightStripCool.map, packA.lightStripWarm.map)

  const packB = createXiaoxianggangMaterials({ cache: sharedCache, preserveExternalCacheOnDispose: true })
  try {
    assert.equal(packA.floorTerrazzo.map, packB.floorTerrazzo.map)
    assert.equal(packA.ceilingGrid.map, packB.ceilingGrid.map)
    assert.equal(packA.signAtlasMat.map, packB.signAtlasMat.map)
    assert.equal(packA.rollerShutterSilver.map, packB.rollerShutterSilver.map)

    const snap = sharedCache.getSnapshot()
    assert.equal(snap.uniqueTextureCount, firstCount)
    assert.equal(snap.duplicateUploadCount, 0)
    assert.equal(snap.cacheHits, snap.acquireCalls - snap.uniqueTextureCount)
    assert.ok(firstAcquires >= firstCount)
    assert.ok(snap.cacheHits >= firstCount, 'second mount must hit cache on every shared texture')
    // 验证 signAtlas albeo(1024x512) 与 emissive(512x256) 同 2:1 比例避免重影错位
    assert.equal(
      packA.signAtlasMat.map.image.width / packA.signAtlasMat.map.image.height,
      packA.signAtlasMat.emissiveMap.image.width / packA.signAtlasMat.emissiveMap.image.height,
    )
  } finally {
    packA.dispose()
    packB.dispose()
    sharedCache.releaseAll()
  }
})

test('material pixel synthesis encodes real terrazzo chips, ceiling boards with T-rails, and corrugated shutter normals', () => {
  const pack = createXiaoxianggangMaterials()
  try {
    // 1. 水磨石地砖：底色与分格缝及骨料碎点有真实方差
    const tz = pack.floorTerrazzo.map.image.data
    let minLum = 255
    let maxLum = 0
    for (let i = 0; i < tz.length; i += 4) {
      const lum = (tz[i] + tz[i + 1] + tz[i + 2]) / 3
      if (lum < minLum) minLum = lum
      if (lum > maxLum) maxLum = lum
    }
    assert.ok(maxLum - minLum > 90, `terrazzo contrast should exceed 90, got ${maxLum - minLum}`)

    // 2. 吊顶：方灯改由场景几何嵌入，贴图只剩龙骨 (0) 与带柔光的矿棉板；不再烘焙亮灯格
    const ceilEm = pack.ceilingGrid.emissiveMap.image.data
    let railPx = 0
    let boardPx = 0
    let bakedLampPx = 0
    for (let i = 0; i < ceilEm.length; i += 4) {
      if (ceilEm[i] === 0 && ceilEm[i + 1] === 0) railPx++
      else if (ceilEm[i] >= 150 && ceilEm[i] <= 220) boardPx++
      if (ceilEm[i] > 230) bakedLampPx++
    }
    assert.ok(railPx > 1000 && boardPx > 20000, `ceiling must contain dark T-rails (${railPx}) and softly lit boards (${boardPx})`)
    assert.equal(bakedLampPx, 0, 'lamp panels belong to the geometry lamp matrix, not the ceiling texture')

    // 3. 金属波纹卷帘门法线：垂直 Y 分量应因水平波纹反复正负起伏
    const shNorm = pack.rollerShutterSilver.normalMap.image.data
    let minNy = 255
    let maxNy = 0
    for (let i = 0; i < shNorm.length; i += 4) {
      const ny = shNorm[i + 1]
      if (ny < minNy) minNy = ny
      if (ny > maxNy) maxNy = ny
    }
    assert.ok(maxNy - minNy > 90, `roller shutter normal Y swing should exceed 90, got ${maxNy - minNy}`)

    // 4. 照明增益调节不越界且按基准值联动
    const baseCeil = pack.ceilingGrid.emissiveIntensity
    pack.setLightingBoost(1.0)
    assert.ok(pack.ceilingGrid.emissiveIntensity > baseCeil)
    pack.setLightingBoost(0)
    assert.equal(pack.ceilingGrid.emissiveIntensity, baseCeil)
  } finally {
    pack.dispose()
  }
})

test('sign atlas rects stay non-overlapping and remap PlaneGeometry UVs cleanly', () => {
  const entries = Object.entries(SIGN_ATLAS_RECTS)
  assert.ok(entries.length >= 12)
  for (let i = 0; i < entries.length; i++) {
    const [nameA, a] = entries[i]
    assert.ok(a[0] >= 0 && a[1] >= 0 && a[2] <= 1 && a[3] <= 1 && a[2] > a[0] && a[3] > a[1], `invalid rect ${nameA}`)
    for (let j = i + 1; j < entries.length; j++) {
      const [nameB, b] = entries[j]
      const overlap = a[0] < b[2] - 1e-6 && a[2] > b[0] + 1e-6 && a[1] < b[3] - 1e-6 && a[3] > b[1] + 1e-6
      assert.equal(overlap, false, `atlas rects ${nameA} and ${nameB} overlap`)
    }
  }

  const geom = new THREE.PlaneGeometry(4.2, 1.4)
  applySignAtlasRect(geom, 'portal18Navy')
  const uv = geom.getAttribute('uv')
  const rect = SIGN_ATLAS_RECTS.portal18Navy
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i)
    const v = uv.getY(i)
    assert.ok(u >= rect[0] && u <= rect[2], `remapped u=${u} outside [${rect[0]}, ${rect[2]}]`)
    assert.ok(v >= 1 - rect[3] && v <= 1 - rect[1], `remapped v=${v} outside [${1 - rect[3]}, ${1 - rect[1]}]`)
  }
})

test('UI tokens and signage config comply with docs/design-rules.md (no emojis, gradients, tips, or !) ', () => {
  const serialized = JSON.stringify({ XXG_UI_TOKENS, XXG_PALETTE, XXG_SIGN_FONTS })
  assert.equal(/提示|Tip|小贴士|linear-gradient|[!！]|[\p{Emoji_Presentation}]/u.test(serialized), false)
  assert.equal(XXG_UI_TOKENS.fontFamily, 'var(--ui-serif)')
  assert.equal(XXG_UI_TOKENS.accentPrimary, 'var(--ui-seal)')
  assert.equal(XXG_UI_TOKENS.surfaceGlass, 'var(--ui-glass-solid)')
})

test('docs/xiaoxianggang/refs manifest & >=3 material-vs-photo comparison sets exist with full provenance', () => {
  const manifestPath = path.join(REFS_DIR, 'manifest.json')
  const readmePath = path.join(REFS_DIR, 'README.md')
  assert.equal(fs.existsSync(manifestPath), true, 'refs/manifest.json must exist')
  assert.equal(fs.existsSync(readmePath), true, 'refs/README.md must exist')

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  assert.ok(Array.isArray(manifest) && manifest.length >= 10, `expected >=10 real photos, got ${manifest.length}`)
  for (const row of manifest) {
    assert.ok(typeof row.platform === 'string' && row.platform.length > 0)
    assert.ok(typeof row.pageUrl === 'string' && row.pageUrl.startsWith('https://'))
    assert.ok(typeof row.origUrl === 'string' && row.origUrl.startsWith('https://'))
    assert.ok(typeof row.description === 'string' && row.description.length > 0)
    const imgPath = path.join(REFS_DIR, row.filename)
    assert.equal(fs.existsSync(imgPath), true, `missing ref photo ${row.filename}`)
  }

  assert.ok(XXG_PHOTO_COMPARISON_PAIRS.length >= 3, 'need >= 3 material-vs-photo comparison pairs')
  const readmeText = fs.readFileSync(readmePath, 'utf8')
  for (const pair of XXG_PHOTO_COMPARISON_PAIRS) {
    assert.equal(fs.existsSync(path.join(REFS_DIR, pair.compareImage)), true, `missing comparison sheet ${pair.compareImage}`)
    assert.ok(readmeText.includes(pair.compareImage), `refs/README.md must document ${pair.compareImage}`)
    for (const ref of pair.refImages) {
      assert.equal(fs.existsSync(path.join(REFS_DIR, ref)), true, `missing comparison ref ${ref}`)
    }
  }
})

test('aligns with contract.ts XXG_BUDGET and resolves every shop lookKey cleanly', () => {
  assert.equal(XXG_TEXTURE_BUDGET_BYTES, XXG_BUDGET.indoorTextureBytesMax)
  const pack = createXiaoxianggangMaterials()
  try {
    for (const slot of Object.keys(SIGN_ATLAS_RECTS)) {
      const resolved = resolveShopLook(pack, slot)
      assert.equal(resolved.kind, 'sign-atlas')
      assert.equal(resolved.material, pack.signAtlasMat)
      assert.equal(resolved.isFallback, false)
    }

    const layoutPath = path.join(REPO_ROOT, 'web/src/xiaoxianggang/layout/xiaoxianggang-b1.layout.json')
    if (fs.existsSync(layoutPath)) {
      const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'))
      const keys = new Set(layout.shops.map(s => s.lookKey).filter(Boolean))
      assert.ok(keys.size >= 10, 'layout should reference rich Stage 2 look keys')
      for (const k of keys) {
        const res = resolveShopLook(pack, k)
        assert.equal(res.isFallback, false, `layout lookKey "${k}" must resolve without fallback`)
      }
    }

    const fallback = resolveShopLook(pack, 'nonexistent-key')
    assert.equal(fallback.kind, 'material')
    assert.equal(fallback.isFallback, true)
    assert.equal(fallback.material, pack.rollerShutterSilver)
  } finally {
    pack.dispose()
  }
})
