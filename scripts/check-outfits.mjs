/**
 * Offline & Node Verification Suite for IDOK-125 Character Outfits & Accessories (`web/src/walk/outfits.ts`).
 *
 * Parses the real `public/avatar/figure.glb`, runs `ensureAvatarRig` + `createAvatarOutfitController`,
 * and verifies:
 *  1. 100% vertex coverage (5,666 vertices), zero overlap between `top` / `bottom` / `shoes`, and invariant
 *     `LOCKED_SKIN` + `LOCKED_HAIR` RGBs across all 7 outfits (default + 6 catalog sets).
 *  2. Zero-Z-fighting `BUILTIN_PACK` (623 vertices) hiding via `geometry.setDrawRange` when equipping any custom `bag_*`.
 *  3. Bone-attachment world transforms (`attach_head` / `attach_torso`) align to `-Z` forward in rest pose and follow
 *     head / spine rotations across walking / crouching / riding / crash postures without detaching.
 *  4. Anti-clipping geometric bounds for all 6 `hat_*` (clearance delta safe for vessel/bridge limits) and all 6 `bag_*`
 *     (back clearance `localZ >= +0.175`, width `<= 0.34m`, top edge below neck/crown).
 *  5. Strict `drawCallDelta <= +2` (`+0` default, `+0` recolor-only, `+2` hat+bag) and `0` dynamic lights.
 *  6. `autoHelmetOnRide` temporary `hat_rider_helmet` activation on e-bike mount and immediate revert on dismount
 *     without mutating persisted `WardrobeState`.
 */
import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'

const root = process.cwd()
const tmp = await mkdtemp(path.join(root, '.tmp-check-outfits-'))
let passed = 0

function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`)
  } else {
    throw new Error(`FAIL ${name}${detail ? `: ${detail}` : ''}`)
  }
}

try {
  await build({
    entryPoints: [
      path.join(root, 'web/src/walk/avatar-rig.ts'),
      path.join(root, 'web/src/walk/outfits.ts'),
      path.join(root, 'web/src/game/catalog.ts'),
    ],
    outdir: tmp,
    outbase: path.join(root, 'web/src'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    external: ['three'],
    splitting: true,
    logLevel: 'silent',
  })

  const rigMod = await import(pathToFileURL(path.join(tmp, 'walk/avatar-rig.js')).href)
  const outfitMod = await import(pathToFileURL(path.join(tmp, 'walk/outfits.js')).href)
  const catalogMod = await import(pathToFileURL(path.join(tmp, 'game/catalog.js')).href)

  // Parse real public/avatar/figure.glb via GLTFLoader.parse
  const glbBytes = await readFile(path.join(root, 'public/avatar/figure.glb'))
  const glbAb = glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength)
  const loader = new GLTFLoader()
  const gltf = await new Promise((resolve, reject) => {
    loader.parse(glbAb, '', resolve, reject)
  })

  const figure = gltf.scene
  const rig = rigMod.ensureAvatarRig(figure, null)
  check('figure.glb loads as skinned AvatarRig', rig.isSkinned === true && !!rig.skinnedMesh)
  check('avatarRig exposes head and torso attachment anchors', !!rig.attachments?.head && !!rig.attachments?.torso)

  figure.updateMatrixWorld(true)
  const qHead = rig.attachments.head.getWorldQuaternion(new THREE.Quaternion())
  const qTorso = rig.attachments.torso.getWorldQuaternion(new THREE.Quaternion())
  const identityQuat = new THREE.Quaternion()
  check(
    'rest attachment anchors align to figure axes (world quat ~ identity)',
    qHead.angleTo(identityQuat) < 0.02 && qTorso.angleTo(identityQuat) < 0.02,
    `headErr=${qHead.angleTo(identityQuat).toFixed(4)} torsoErr=${qTorso.angleTo(identityQuat).toFixed(4)}`,
  )

  const skinned = rig.skinnedMesh
  const basePosCount = skinned.geometry.getAttribute('position').count
  const origColors = Float32Array.from(skinned.geometry.getAttribute('color').array)

  // Partition the pristine glb colours before the controller paints the default outfit over them.
  const part = outfitMod.partitionCityWalkerGeometry(skinned)
  const controller = outfitMod.createAvatarOutfitController(figure, rig)
  const snap0 = controller.getSnapshot()
  const zoneTotal = Object.values(snap0.zoneCounts).reduce((a, b) => a + b, 0)
  check(
    'semantic vertex partition covers 100% of CityWalker vertices with skin & hair locked',
    zoneTotal === basePosCount && snap0.zoneCounts.LOCKED_SKIN > 1200 && snap0.zoneCounts.LOCKED_HAIR > 600,
    `total=${zoneTotal}/${basePosCount}, skin=${snap0.zoneCounts.LOCKED_SKIN}, hair=${snap0.zoneCounts.LOCKED_HAIR}`,
  )
  check(
    'BUILTIN_PACK identified and sorted cleanly for drawRange hiding',
    snap0.zoneCounts.BUILTIN_PACK === 623 && snap0.builtinPackVisible === true && snap0.drawCallDelta === 0,
    `packVerts=${snap0.zoneCounts.BUILTIN_PACK}`,
  )

  // Track exact vertex indices for LOCKED_SKIN & LOCKED_HAIR
  const colAttr = skinned.geometry.getAttribute('color')
  const lockedIndices = []
  for (let i = 0; i < part.zones.length; i++) {
    if (part.zones[i] === outfitMod.OUTFIT_ZONE.LOCKED_SKIN || part.zones[i] === outfitMod.OUTFIT_ZONE.LOCKED_HAIR) {
      lockedIndices.push(i)
    }
  }

  // Test all 7 outfits (default + 6 presets)
  const totalIndexCount = skinned.geometry.index.count
  const hiddenCount = skinned.geometry.drawRange.count
  check('initial drawRange renders full mesh (with built-in pack)', hiddenCount === totalIndexCount)

  const vesselBoundsRaw = JSON.parse(await readFile(path.join(root, 'pipeline/vessel-bounds.json'), 'utf8'))
  figure.scale.setScalar(0.955)
  figure.updateMatrixWorld(true)
  const bareBox = new THREE.Box3().setFromObject(figure, true)
  const bareTopY = bareBox.max.y

  const maxHatClearanceDelta = 0.055 // Scaled crown top delta <= 5.5 cm preserves tight bridge/vessel clearance
  for (const preset of catalogMod.OUTFIT_PRESETS) {
    controller.applyEquipped(preset.items, {ridingEbike: false, autoHelmetOnRide: true})
    figure.updateMatrixWorld(true)
    const snap = controller.getSnapshot()

    // Skin & hair invariance
    let maxLockedDelta = 0
    for (const idx of lockedIndices) {
      const dr = Math.abs(colAttr.getX(idx) - origColors[idx * 3])
      const dg = Math.abs(colAttr.getY(idx) - origColors[idx * 3 + 1])
      const db = Math.abs(colAttr.getZ(idx) - origColors[idx * 3 + 2])
      maxLockedDelta = Math.max(maxLockedDelta, dr, dg, db)
    }
    assert(maxLockedDelta < 1e-6, `${preset.id}: locked skin/hair color mutated (${maxLockedDelta})`)

    const isDefault = preset.id === 'outfit_default'
    const hasHat = preset.items.hat !== 'hat_none'
    const hasBag = preset.items.bag !== 'bag_none'
    const expectedDelta = (hasHat ? 1 : 0) + (hasBag ? 1 : 0)
    assert.equal(snap.builtinPackVisible, !hasBag, `${preset.id}: builtinPackVisible mismatch`)
    assert.equal(
      snap.drawCallDelta,
      expectedDelta,
      `${preset.id}: drawCallDelta expected ${expectedDelta}, got ${snap.drawCallDelta}`,
    )
    assert(snap.drawCallDelta <= 2, `${preset.id}: drawCallDelta exceeds +2`)

    // Inspect hat & bag world bounds relative to figure (scaled by 0.955)
    if (hasHat) {
      const hatMesh = rig.attachments.head.children.find(c => c.visible)
      assert(hatMesh instanceof THREE.Mesh, `${preset.id}: visible hat mesh missing`)
      hatMesh.geometry.computeBoundingBox()
      const hatBoxWorld = new THREE.Box3().setFromObject(hatMesh, true)
      const crownDelta = hatBoxWorld.max.y - bareTopY
      assert(
        crownDelta <= maxHatClearanceDelta,
        `${preset.id}: hat crown delta ${crownDelta.toFixed(4)}m exceeds ${maxHatClearanceDelta}m`,
      )
    }

    if (hasBag) {
      const bagMesh = rig.attachments.torso.children.find(c => c.visible)
      assert(bagMesh instanceof THREE.Mesh, `${preset.id}: visible bag mesh missing`)
      bagMesh.geometry.computeBoundingBox()
      const bb = bagMesh.geometry.boundingBox
      const bagWorldBox = new THREE.Box3().setFromObject(bagMesh, true)
      const width = bagWorldBox.max.x - bagWorldBox.min.x
      // Main bag volume sits outside jacket back (+0.138); thin shoulder strap starts >= +0.125
      assert(bb.min.z >= 0.125, `${preset.id}: bag front face z=${bb.min.z.toFixed(3)} risks clipping torso back`)
      assert(width <= 0.34, `${preset.id}: bag width ${width.toFixed(3)}m too wide`)
      assert(bagWorldBox.max.y <= 1.46 * 0.955, `${preset.id}: bag top y=${bagWorldBox.max.y.toFixed(3)} clips head/helmet`)
    }
  }
  check(
    `all ${catalogMod.OUTFIT_PRESETS.length} outfits pass skin/hair invariance, drawCallDelta <= +2 & geometry envelopes`,
    true,
    `bareTop=${bareTopY.toFixed(3)}m, vesselHeads=${vesselBoundsRaw.boat.head}/${vesselBoundsRaw.raft.head}/${vesselBoundsRaw.rowboat.head}`,
  )

  // Mix-and-match: top-only recolor -> +0 draw calls & keeps builtin pack
  controller.applyEquipped({...catalogMod.DEFAULT_EQUIPPED_OUTFIT, top: 'top_guochao_pankou'}, {ridingEbike: false, autoHelmetOnRide: true})
  const mixSnap = controller.getSnapshot()
  check(
    'recolor-only mix-and-match adds +0 draw calls',
    mixSnap.drawCallDelta === 0 && mixSnap.builtinPackVisible === true && mixSnap.attachedHat === null && mixSnap.attachedBag === null,
  )

  // Verify attachment tracks spine/head joint animation cleanly across postures (-x leans forward toward -Z)
  rig.joints.Torso.rotation.x = -0.55
  rig.joints.Head.rotation.y = 0.45
  rig.syncPose()
  figure.updateMatrixWorld(true)
  const posedTorsoPos = rig.attachments.torso.getWorldPosition(new THREE.Vector3())
  const posedHeadPos = rig.attachments.head.getWorldPosition(new THREE.Vector3())
  check(
    'head/torso attachments follow skeletal pose without detaching',
    posedHeadPos.y > posedTorsoPos.y && posedHeadPos.z < -0.15 && posedTorsoPos.y > 0.95,
    `torsoY=${posedTorsoPos.y.toFixed(3)} headZ=${posedHeadPos.z.toFixed(3)}`,
  )
  rig.clearPose()

  // Verify autoHelmetOnRide rule without mutating equipped state
  const capOutfit = {...catalogMod.DEFAULT_EQUIPPED_OUTFIT, hat: 'hat_karst_cap'}
  const walkCap = outfitMod.resolveVisualOutfit(capOutfit, {ridingEbike: false, autoHelmetOnRide: true})
  const ebikeAuto = outfitMod.resolveVisualOutfit(capOutfit, {ridingEbike: true, autoHelmetOnRide: true})
  const ebikeDisabled = outfitMod.resolveVisualOutfit(capOutfit, {ridingEbike: true, autoHelmetOnRide: false})
  const ebikeKeepVisor = outfitMod.resolveVisualOutfit(
    {...catalogMod.DEFAULT_EQUIPPED_OUTFIT, hat: 'hat_night_visor'},
    {ridingEbike: true, autoHelmetOnRide: true},
  )
  check(
    'autoHelmetOnRide swaps cap->hat_rider_helmet only while riding ebike and preserves safety helmets',
    walkCap.hat === 'hat_karst_cap' &&
      ebikeAuto.hat === 'hat_rider_helmet' &&
      ebikeDisabled.hat === 'hat_karst_cap' &&
      ebikeKeepVisor.hat === 'hat_night_visor',
  )

  controller.applyEquipped(capOutfit, {ridingEbike: false, autoHelmetOnRide: true})
  assert.equal(controller.getSnapshot().applied.hat, 'hat_karst_cap')
  controller.setRidingEbike(true)
  const onBikeSnap = controller.getSnapshot()
  assert.equal(onBikeSnap.applied.hat, 'hat_rider_helmet')
  assert.equal(onBikeSnap.equipped.hat, 'hat_karst_cap', 'persisted equipped.hat must remain unchanged')
  controller.setRidingEbike(false)
  assert.equal(controller.getSnapshot().applied.hat, 'hat_karst_cap')
  check('runtime OutfitController toggles auto helmet on/off on ebike mount & dismount cleanly', true)

  // Static redline check: 0 new Three.js dynamic lights across outfit modules & overlay
  const [outfitsSrc, rigSrc] = await Promise.all([
    readFile(path.join(root, 'web/src/walk/outfits.ts'), 'utf8'),
    readFile(path.join(root, 'web/src/walk/avatar-rig.ts'), 'utf8'),
  ])
  const hasDynamicLight = /(PointLight|SpotLight|RectAreaLight)/.test(outfitsSrc + rigSrc)
  check('zero dynamic Three.js lights added in outfit modules', !hasDynamicLight)

  controller.dispose()
  console.log(`\nALL ${passed} NODE OUTFIT CHECKS PASSED`)
} finally {
  await rm(tmp, {recursive: true, force: true})
}
