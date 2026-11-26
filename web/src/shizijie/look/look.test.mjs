import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'

import {
  SZJ_BUDGET,
  SZJ_STAIRWELLS,
} from '../contract.ts'
import { SHIZIJIE_B1_LAYOUT } from '../layout/index.ts'
import { buildSzjWayfinding, SZJ_SIGN_SPEC } from '../wayfinding/index.ts'
import {
  SHIZIJIE_ATLAS_MAX_SHEETS,
  SHIZIJIE_PALETTE,
  SHIZIJIE_PUBLIC_TEXTURE_URLS,
  SHIZIJIE_SIGN_FONTS,
  SHIZIJIE_TEXTURE_BUDGET_BYTES,
  SHIZIJIE_UI_TOKENS,
  SHIZIJIE_WAYFINDING_PALETTE,
  SZJ_SIGN_ATLAS_RECTS,
  SZJ_SIGN_META,
  WAYFINDING_ATLAS_HEIGHT,
  WAYFINDING_ATLAS_WIDTH,
  WAYFINDING_ROW_PX,
  WAYFINDING_TEXELS_PER_METER,
  applySignAtlasRect,
  buildWayfindingFaceGeometry,
  createShizijieMaterials,
  createSurfaceStairwellHoods,
  createTextureUploadCache,
  createWayfindingSignsGroup,
  resolveShopLook,
} from './index.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../../..')
const PUBLIC_SZJ_DIR = path.join(REPO_ROOT, 'web/public/shizijie')

function readPngDimensions(filePath) {
  const buf = fs.readFileSync(filePath)
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${filePath} must have PNG header`)
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  }
}

function walkDiskBytes(dir) {
  const files = []
  let totalBytes = 0
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      const sub = walkDiskBytes(full)
      files.push(...sub.files)
      totalBytes += sub.totalBytes
    } else if (ent.isFile()) {
      files.push(full)
      totalBytes += fs.statSync(full).size
    }
  }
  return { files, totalBytes }
}

test('k6: GPU texture budget stays strictly <= 8 MiB (raw & mipmapped), <=2 atlas sheets, 0 duplicate uploads', () => {
  const shared = createTextureUploadCache()
  const packA = createShizijieMaterials({ cache: shared, preserveExternalCacheOnDispose: true })
  const firstBudget = packA.getTextureBudget()

  assert.equal(SHIZIJIE_TEXTURE_BUDGET_BYTES, SZJ_BUDGET.indoorTextureBytesMax)
  assert.equal(firstBudget.limitBytes, 8 * 1024 * 1024)
  assert.ok(firstBudget.uniqueTextureCount >= 20, `expected >=20 unique textures, got ${firstBudget.uniqueTextureCount}`)
  assert.ok(firstBudget.atlasSheetCount <= SHIZIJIE_ATLAS_MAX_SHEETS, `atlas sheets ${firstBudget.atlasSheetCount} > 2`)
  assert.ok(firstBudget.rawBytes > 2 * 1024 * 1024, 'real texture resolution required')
  assert.ok(firstBudget.rawBytes <= SZJ_BUDGET.indoorTextureBytesMax, `rawBytes ${firstBudget.rawBytes} > 8MiB`)
  assert.ok(firstBudget.mipmappedBytes <= SZJ_BUDGET.indoorTextureBytesMax, `mipBytes ${firstBudget.mipmappedBytes} > 8MiB`)
  assert.equal(firstBudget.duplicateUploadCount, 0)

  // Shared texture reuse & opaque PBR alpha check (IDOK-385 §5.3)
  assert.equal(packA.rollerShutterSilver.normalMap, packA.rollerShutterCream.normalMap)
  assert.equal(packA.rollerShutterSilver.roughnessMap, packA.rollerShutterCream.roughnessMap)
  assert.notEqual(packA.rollerShutterSilver.map, packA.rollerShutterCream.map)
  assert.equal(packA.lightStripCool.map, packA.lightStripWarm.map)
  assert.equal(packA.stairGranite.map, packA.columnStone.map)
  assert.ok(packA.wallCorridor.normalMap, 'wallCorridor must expose micro stucco normalMap')

  const canopyAlpha = packA.canopyGlassBlue.map.image.data
  for (let i = 3; i < canopyAlpha.length; i += 4) {
    assert.equal(canopyAlpha[i], 255, 'PBR canopy glass texture must be pure opaque RGB (alpha=255)')
  }

  // 1:1 native pixel parity between albedo & emissive on both sign atlases
  assert.equal(packA.signAtlasMat.map, packA.signAtlasMat.emissiveMap)
  assert.equal(packA.wayfindingMat.map, packA.wayfindingMat.emissiveMap)
  assert.equal(packA.wayfindingMat.map.image.width, WAYFINDING_ATLAS_WIDTH)
  assert.equal(packA.wayfindingMat.map.image.height, WAYFINDING_ATLAS_HEIGHT)

  const packB = createShizijieMaterials({ cache: shared, preserveExternalCacheOnDispose: true })
  try {
    assert.equal(packA.floorTerrazzo.map, packB.floorTerrazzo.map)
    assert.equal(packA.ceilingGrid.map, packB.ceilingGrid.map)
    assert.equal(packA.signAtlasMat.map, packB.signAtlasMat.map)
    assert.equal(packA.wayfindingMat.map, packB.wayfindingMat.map)
    const afterBudget = shared.getSnapshot()
    assert.equal(afterBudget.uniqueTextureCount, firstBudget.uniqueTextureCount)
    assert.equal(afterBudget.duplicateUploadCount, 0)
    assert.ok(afterBudget.cacheHits >= firstBudget.uniqueTextureCount)
  } finally {
    packA.dispose()
    packB.dispose()
    shared.releaseAll()
  }
})

test('pixel synthesis covers glossy terrazzo, sparse linear ceiling troffers (no checkerboard), bottom wall dado, and yellow stair nosing', () => {
  const pack = createShizijieMaterials()
  try {
    const tz = pack.floorTerrazzo.map.image.data
    let minLum = 255
    let maxLum = 0
    for (let i = 0; i < tz.length; i += 4) {
      const lum = (tz[i] + tz[i + 1] + tz[i + 2]) / 3
      if (lum < minLum) minLum = lum
      if (lum > maxLum) maxLum = lum
    }
    assert.ok(maxLum - minLum > 60, `terrazzo contrast too flat: ${maxLum - minLum}`)

    // Floor roughness must stay in glossy semi-polished range (< 0.35 average) for ceiling reflections
    const tzRough = pack.floorTerrazzo.roughnessMap.image.data
    let roughSum = 0
    for (let i = 0; i < tzRough.length; i += 4) roughSum += tzRough[i]
    const avgRough = roughSum / (tzRough.length / 4) / 255
    assert.ok(avgRough < 0.35, `floor terrazzo too matte (${avgRough}), real floor reflects ceiling lights`)

    // Ceiling must be pale aluminum plank with sparse slim linear troffer (~8-24% lit, NOT 50% checkerboard)
    const ceilEm = pack.ceilingGrid.emissiveMap.image.data
    let darkPx = 0
    let litPx = 0
    for (let i = 0; i < ceilEm.length; i += 4) {
      if (ceilEm[i] === 0 && ceilEm[i + 1] === 0) darkPx++
      else if (ceilEm[i] > 170) litPx++
    }
    assert.ok(darkPx > 1000 && litPx > 1000)
    const litRatio = litPx / (darkPx + litPx)
    assert.ok(litRatio > 0.07 && litRatio < 0.25, `ceiling lit ratio ${litRatio.toFixed(3)} should reflect sparse slim troffers`)

    // Upper wall mineral plaster carries vertical panel reveal grooves at x=0/128 (lum dip) and bright plaster above
    // while stairGranite carries the lower 1.04m dark slate-granite dado (lum < 140)
    const wall = pack.wallCorridor.map.image.data
    const wallW = pack.wallCorridor.map.image.width
    const sampleLum = (row, col) => {
      const p = (row * wallW + col) * 4
      return (wall[p] + wall[p + 1] + wall[p + 2]) / 3
    }
    assert.ok(sampleLum(100, 0) < sampleLum(100, 40) - 12, 'upper wall panel seam must show crisp architectural reveal')
    assert.ok(sampleLum(180, 40) > 180, 'upper mineral plaster must stay clean bright neutral above dadoSpecs')

    const gran = pack.stairGranite.map.image.data
    let gLum = 0
    for (let i = 0; i < gran.length; i += 4) gLum += (gran[i] + gran[i + 1] + gran[i + 2]) / 3
    assert.ok(gLum / (gran.length / 4) < 140, 'stairGranite dado skirt must hold deep slate-granite midtone')

    const shNorm = pack.rollerShutterSilver.normalMap.image.data
    let minNy = 255
    let maxNy = 0
    for (let i = 0; i < shNorm.length; i += 4) {
      const ny = shNorm[i + 1]
      if (ny < minNy) minNy = ny
      if (ny > maxNy) maxNy = ny
    }
    assert.ok(maxNy - minNy > 90)

    // Stair tread top rows must encode yellow tactile nosing (#d8ad38)
    const tread = pack.stairTread.map.image.data
    assert.ok(tread[0] > 190 && tread[1] > 140 && tread[2] < 90, 'stair tread yellow nosing missing')

    const baseCeil = pack.ceilingGrid.emissiveIntensity
    pack.setLightingBoost(1.0)
    assert.ok(pack.ceilingGrid.emissiveIntensity > baseCeil)
    pack.setLightingBoost(0)
    assert.equal(pack.ceilingGrid.emissiveIntensity, baseCeil)
  } finally {
    pack.dispose()
  }
})

test('k7: data-driven wayfinding ceiling sign atlas uses 1:1 texel density for every exit, arrow, and distance', () => {
  const wf = buildSzjWayfinding(SHIZIJIE_B1_LAYOUT)
  assert.ok(wf.signs.length >= 60, `expected full wayfinding signs, got ${wf.signs.length}`)

  const pack = createShizijieMaterials({ wayfinding: wf })
  try {
    const layout = pack.wayfindingAtlas
    assert.equal(layout.texelsPerMeter, WAYFINDING_TEXELS_PER_METER)
    assert.equal(WAYFINDING_ROW_PX, 104)
    assert.equal(WAYFINDING_ATLAS_HEIGHT, 512)
    assert.equal(WAYFINDING_TEXELS_PER_METER, 400)

    // Verify separated exit nameplates (248x96), landscape crimson code badges (120x76), 84x104 arrows, and 73x72 distances
    const nwRect = layout.exits.nw
    const exitPxW = Math.round((nwRect[2] - nwRect[0]) * WAYFINDING_ATLAS_WIDTH)
    const exitPxH = Math.round((nwRect[3] - nwRect[1]) * WAYFINDING_ATLAS_HEIGHT)
    assert.equal(exitPxW, 248)
    assert.equal(exitPxH, 96)

    const nwBadgeRect = layout.exitBadges.nw
    assert.equal(Math.round((nwBadgeRect[2] - nwBadgeRect[0]) * WAYFINDING_ATLAS_WIDTH), 120)
    assert.equal(Math.round((nwBadgeRect[3] - nwBadgeRect[1]) * WAYFINDING_ATLAS_HEIGHT), 76)

    const straightRect = layout.arrows.straight
    assert.equal(Math.round((straightRect[2] - straightRect[0]) * WAYFINDING_ATLAS_WIDTH), 84)
    assert.equal(Math.round((straightRect[3] - straightRect[1]) * WAYFINDING_ATLAS_HEIGHT), WAYFINDING_ROW_PX)

    const sampleDistRect = layout.distances.get(50)
    assert.ok(sampleDistRect)
    assert.equal(Math.round((sampleDistRect[2] - sampleDistRect[0]) * WAYFINDING_ATLAS_WIDTH), 85)
    assert.equal(Math.round((sampleDistRect[3] - sampleDistRect[1]) * WAYFINDING_ATLAS_HEIGHT), 54)

    // Every single shownM in wf.signs exists in the atlas distance table
    for (const s of wf.signs) {
      for (const f of s.faces) {
        for (const r of f.rows) {
          assert.equal(layout.distances.has(r.shownM), true, `missing distance slot for ${r.shownM}m`)
        }
      }
    }

    // Check every sign face (all 1..4 rows): zero vertex overflow, full-height arrows in 2-col cards, clean 10m sizing
    for (const s of wf.signs) {
      for (const f of s.faces) {
        const fg = buildWayfindingFaceGeometry(f, s.width, s.height, layout)
        try {
          const pos = fg.getAttribute('position')
          const uv = fg.getAttribute('uv')
          const nrm = fg.getAttribute('normal')
          assert.ok(pos.count >= 24)
          for (let i = 0; i < pos.count; i++) {
            assert.ok(Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)), 'NaN vertex in wayfinding face')
            assert.ok(Math.abs(pos.getX(i)) <= s.width * 0.5 + 1e-4, `${s.id} face X overflow`)
            assert.ok(Math.abs(pos.getY(i)) <= s.height * 0.5 + 1e-4, `${s.id} face Y overflow`)
            assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1, 'wayfinding UV X out of [0,1]')
            assert.ok(uv.getY(i) >= 0 && uv.getY(i) <= 1, 'wayfinding UV Y out of [0,1]')
            assert.equal(nrm.getZ(i), 1, 'front face normals must point +Z before rotation.y = face.yaw')
          }
          const contentStartQuadIdx = f.rows.length === 3 ? 7 : f.rows.length >= 2 ? 6 : 5
          const arrowV0Idx = contentStartQuadIdx * 4
          const arrowQuadH = pos.getY(arrowV0Idx + 2) - pos.getY(arrowV0Idx)
          assert.ok(arrowQuadH >= 0.2, `${s.id} rowH=${arrowQuadH.toFixed(3)}m too small for 10m legibility`)
          if (f.rows.length === 1) {
            const min1Row = s.width >= 2.6 && f.rows[0].arrow !== 'back' ? 0.37 : 0.31
            assert.ok(arrowQuadH >= min1Row, `${s.id} 1-row arrowH=${arrowQuadH.toFixed(3)}m < ${min1Row}`)
          }
          if (s.id === 'szj-sign-038') {
            assert.ok(arrowQuadH >= 0.45, `szj-sign-038 2-tier arrowH=${arrowQuadH.toFixed(3)}m must hit >=0.45m`)
          }
        } finally {
          fg.dispose()
        }
      }
    }

    const batch = createWayfindingSignsGroup(
      wf,
      pack.wayfindingMat,
      pack.canopyTrussDark,
      pack.handrailSteel,
      layout,
    )
    try {
      assert.equal(batch.drawCalls, 3)
      assert.equal(batch.signCount, wf.signs.length)
      assert.equal(batch.boxMesh.count, wf.signs.length)
      assert.equal(batch.rodMesh.count, wf.signs.length * 2)
      assert.ok(batch.triangles > wf.signs.length * 20)
    } finally {
      batch.dispose()
    }
  } finally {
    pack.dispose()
  }
})

test('sign atlas has 30 non-overlapping slots, resolves all 9 contract categories & layout keys, and builds 4 stair hoods', () => {
  const entries = Object.entries(SZJ_SIGN_ATLAS_RECTS)
  assert.equal(entries.length, 30)
  assert.equal(SZJ_SIGN_META.length, 30)

  for (let i = 0; i < entries.length; i++) {
    const [nameA, a] = entries[i]
    assert.ok(a[0] >= 0 && a[1] >= 0 && a[2] <= 1 && a[3] <= 1 && a[2] > a[0] && a[3] > a[1], nameA)
    for (let j = i + 1; j < entries.length; j++) {
      const [nameB, b] = entries[j]
      const overlap = a[0] < b[2] - 1e-6 && a[2] > b[0] + 1e-6 && a[1] < b[3] - 1e-6 && a[3] > b[1] + 1e-6
      assert.equal(overlap, false, `${nameA} overlaps ${nameB}`)
    }
  }

  const geom = new THREE.PlaneGeometry(3.2, 0.5)
  applySignAtlasRect(geom, 'portalMain')
  const uv = geom.getAttribute('uv')
  const r = SZJ_SIGN_ATLAS_RECTS.portalMain
  for (let i = 0; i < uv.count; i++) {
    assert.ok(uv.getX(i) >= r[0] && uv.getX(i) <= r[2])
    assert.ok(uv.getY(i) >= 1 - r[3] && uv.getY(i) <= 1 - r[1])
  }

  const pack = createShizijieMaterials()
  try {
    const categories = [
      'clothing',
      'phone',
      'snack',
      'drink',
      'accessory',
      'shoes',
      'beauty',
      'toy',
      'other',
    ]
    for (const cat of categories) {
      const resolved = resolveShopLook(pack, undefined, cat, 0)
      assert.equal(resolved.kind, 'sign-atlas')
      assert.equal(resolved.isFallback, false)
    }
    const fallback = resolveShopLook(pack, 'unknown-slot')
    assert.equal(fallback.isFallback, true)

    const hoods = createSurfaceStairwellHoods(pack, { worldSpace: false })
    assert.equal(hoods.children.length, SZJ_STAIRWELLS.length)
    assert.deepEqual(
      hoods.children.map(c => c.name),
      SZJ_STAIRWELLS.map(s => s.pipelineId),
    )

    for (const hood of hoods.children) {
      const bollards = hood.children.filter(ch => ch.name === 'szj_bollard_shaft')
      assert.equal(bollards.length, 4, `${hood.name} should have 4 symmetrical bollards leaving x=0 aisle clear`)
      for (const b of bollards) {
        assert.ok(Math.abs(b.position.x) >= 0.45, `${hood.name} bollard ${b.position.x} blocks center aisle`)
      }
    }

    const packDefaultA = createShizijieMaterials()
    const packDefaultB = createShizijieMaterials()
    try {
      assert.equal(packDefaultA.signAtlasMat.map, packDefaultB.signAtlasMat.map)
      assert.equal(packDefaultA.wayfindingMat.map, packDefaultB.wayfindingMat.map)
      assert.equal(packDefaultA.floorCorridorTile.map, packDefaultB.floorCorridorTile.map)
      assert.equal(packDefaultA.canopyGlassBlue.depthWrite, false)
      assert.equal(packDefaultB.getTextureBudget().duplicateUploadCount, 0)
      packDefaultA.dispose()
      packDefaultA.dispose()
      assert.ok(packDefaultB.getTextureBudget().uniqueTextureCount >= 20)
    } finally {
      packDefaultA.dispose()
      packDefaultB.dispose()
    }

    for (const shop of SHIZIJIE_B1_LAYOUT.shops ?? []) {
      const res = resolveShopLook(pack, shop.lookKey, shop.category, 0)
      assert.equal(res.isFallback, false, `shop ${shop.id} lookKey/category failed`)
    }
  } finally {
    pack.dispose()
  }
})

test('zero real-world commercial brand logos and full docs/design-rules.md UI compliance', () => {
  const serialized = JSON.stringify({
    SZJ_SIGN_META,
    SHIZIJIE_UI_TOKENS,
    SHIZIJIE_SIGN_FONTS,
    SHIZIJIE_WAYFINDING_PALETTE,
  })
  const forbiddenBrands = [
    '微笑堂',
    '大商',
    '南方大厦',
    '王城商厦',
    '肯德基',
    'KFC',
    '麦当劳',
    'McDonald',
    '星巴克',
    'Starbucks',
    '屈臣氏',
    'watsons',
    '周大福',
    '华为',
    'OPPO',
    '工商银行',
    'ICBC',
    '中国移动',
    '中国电信',
    '瑞幸',
    '塔斯汀',
    '柏曼',
    '好記',
    'innisfree',
    'TUDOR',
    'JACK & JONES',
    'CONVERSE',
  ]
  for (const brand of forbiddenBrands) {
    assert.equal(serialized.includes(brand), false, `forbidden real brand found in look config: ${brand}`)
  }

  const uiSerialized = JSON.stringify(SHIZIJIE_UI_TOKENS)
  assert.equal(/提示|Tip|小贴士|linear-gradient|[!！]|[\p{Emoji_Presentation}]/u.test(uiSerialized), false)
  assert.equal(SHIZIJIE_UI_TOKENS.fontFamily, 'var(--ui-serif)')
  assert.equal(SHIZIJIE_UI_TOKENS.accentPrimary, 'var(--ui-seal)')
  assert.equal(SHIZIJIE_UI_TOKENS.surfaceGlass, 'var(--ui-glass-solid)')
})

test('web/public/shizijie disk budget <=8MiB, atlas <=2 sheets, PNG headers valid, and manifest has zero unknown license/URL', () => {
  const manifestPath = path.join(PUBLIC_SZJ_DIR, 'manifest.json')
  const readmePath = path.join(PUBLIC_SZJ_DIR, 'README.md')
  assert.equal(fs.existsSync(manifestPath), true, 'manifest.json missing')
  assert.equal(fs.existsSync(readmePath), true, 'README.md missing')

  const { totalBytes } = walkDiskBytes(PUBLIC_SZJ_DIR)
  assert.ok(totalBytes > 100 * 1024, 'public/shizijie assets missing or stubbed')
  assert.ok(totalBytes <= 8 * 1024 * 1024, `disk bytes ${totalBytes} exceeded 8 MiB`)

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.atlasSheetsCount <= 2, true, `atlasSheetsCount ${manifest.atlasSheetsCount} > 2`)
  assert.equal(manifest.realBrandLogosIncluded, false)
  assert.ok(manifest.totalGpuRawBytes <= 8 * 1024 * 1024)
  assert.ok(manifest.totalGpuMipmappedBytes <= 8 * 1024 * 1024)

  const atlasFiles = fs
    .readdirSync(path.join(PUBLIC_SZJ_DIR, 'textures'))
    .filter(f => f.startsWith('atlas-'))
  assert.ok(atlasFiles.length <= 2, `atlas PNG count ${atlasFiles.length} > 2`)

  for (const asset of manifest.assets) {
    assert.ok(typeof asset.license === 'string' && asset.license.length > 0 && !/unknown/i.test(asset.license))
    assert.ok(typeof asset.sourceUrl === 'string' && asset.sourceUrl.startsWith('https://'))
    const filePath = path.join(PUBLIC_SZJ_DIR, asset.file)
    assert.equal(fs.existsSync(filePath), true, `missing asset file ${asset.file}`)
    if (asset.file.endsWith('.png')) {
      const dims = readPngDimensions(filePath)
      assert.equal(dims.width, asset.width)
      assert.equal(dims.height, asset.height)
    }
  }

  assert.ok(Array.isArray(manifest.externalReferences) && manifest.externalReferences.length >= 6)
  for (const ref of manifest.externalReferences) {
    assert.ok(typeof ref.license === 'string' && ref.license.length > 0 && !/unknown/i.test(ref.license))
    assert.ok(typeof ref.sourceUrl === 'string' && ref.sourceUrl.startsWith('https://'))
  }

  for (const href of Object.values(SHIZIJIE_PUBLIC_TEXTURE_URLS)) {
    const p = fileURLToPath(href)
    assert.equal(fs.existsSync(p), true, `SHIZIJIE_PUBLIC_TEXTURE_URLS missing file ${p}`)
  }
})

test('integrate: floor & sign onBeforeCompile chain THREE.Material.prototype.onBeforeCompile and use vertex view varying', () => {
  const prevProtoCompile = THREE.Material.prototype.onBeforeCompile
  let protoCalls = 0
  THREE.Material.prototype.onBeforeCompile = function (shader) {
    protoCalls += 1
    shader.uniforms.uHostAtmoProbe = { value: 1 }
  }
  const pack = createShizijieMaterials()
  try {
    for (const mat of [pack.floorTerrazzo, pack.floorCorridorTile]) {
      const shader = {
        uniforms: {},
        vertexShader: THREE.ShaderLib.standard.vertexShader,
        fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      }
      mat.onBeforeCompile(shader, {})
      assert.ok(shader.uniforms.uHostAtmoProbe, `${mat.name} dropped prototype shareAtmosphere hook`)
      assert.equal(shader.vertexShader.includes('vSzjFloorViewVec = cameraPosition - szjWp.xyz;'), true)
      assert.equal(shader.fragmentShader.includes('vec3 viewW = normalize(vSzjFloorViewVec);'), true)
      assert.equal(shader.fragmentShader.includes('cameraPosition'), false, `${mat.name} fragment must not read cameraPosition directly`)
      assert.ok(
        shader.fragmentShader.indexOf('reflectedLight.indirectSpecular +=') >
          shader.fragmentShader.indexOf('#include <lights_fragment_end>'),
      )
      assert.ok(
        shader.fragmentShader.indexOf('reflectedLight.indirectSpecular +=') <
          shader.fragmentShader.indexOf('#include <opaque_fragment>'),
      )
    }

    const signShader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    }
    pack.signAtlasMat.onBeforeCompile(signShader, {})
    assert.ok(signShader.uniforms.uHostAtmoProbe, 'signAtlasMat dropped prototype shareAtmosphere hook')
    assert.equal(signShader.fragmentShader.includes('totalEmissiveRadiance = vec3(0.0);'), true)
    assert.equal(protoCalls, 3)
  } finally {
    THREE.Material.prototype.onBeforeCompile = prevProtoCompile
    pack.dispose()
  }
})
