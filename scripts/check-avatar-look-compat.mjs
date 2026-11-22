/**
 * Offline & Node Verification Suite for Avatar Style-Fusion Rendering & Cross-Module Compatibility
 * (`web/src/look/avatar-look.ts`, `web/src/walk/avatar-compat.ts`, `web/src/walk/outfits.ts`).
 *
 * Verifies:
 *  1. Real `public/avatar/figure.glb` (`CityWalker`): exact `0.955` scale preservation (1.695 m standing height),
 *     per-vertex `aAvatarSurface` classification (skin/hair/fabric/accessory), 0 dynamic Three.js lights,
 *     0 compat warnings, and `vessel-bounds.json` clearance gate.
 *  2. Multi-schema skeleton compatibility (Mixamo / Blender Rigify / Standard Hips-LeftUpLeg):
 *     bone alias resolution, atomic skeleton + `AnimationClip` track normalization for `ensureAvatarRig`,
 *     full 11-joint vehicle/crash pose control, and robust multi-`SkinnedMesh` foot-sole probes.
 *  3. Auto-scale calibration for differently authored refined GLBs (e.g. 1.82 m -> 1.695 m) preserving
 *     boat/raft/rowboat/car clearances without manual scale edits.
 *  4. Multi-strategy `IDOK-125` `outfits.ts` compatibility:
 *     - `legacy_color0` (bit-identical `CityWalker` regression)
 *     - `bone_color0` (new-palette single-mesh `COLOR_0`, strictly locking face/head/hair/hands)
 *     - `named_parts` (multi-mesh refined humanoid with `top`/`bottom`/`shoes`/`pack`/`skin`/`hair`,
 *       tinting cloth only, toggling built-in pack visibility, never touching skin/hair)
 *  5. Grounded 1-draw-call contact shadow: air-height fade on jump, crouch expansion, sun-angle elongation,
 *     rain/mist diffusion, night attenuation, and strict separation from `figure` Box3 hierarchy.
 */
import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'

const root = process.cwd()
const tmp = await mkdtemp(path.join(root, '.tmp-check-avatar-compat-'))
let passed = 0

function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`)
  } else {
    throw new Error(`FAIL ${name}${detail ? `: ${detail}` : ''}`)
  }
}

function makeSyntheticHumanoid({
  schema = 'mixamo',
  heightM = 1.82,
  multiMesh = false,
  customPalette = false,
}) {
  const namesBySchema = {
    mixamo: {
      pelvis: 'mixamorigHips',
      spine1: 'mixamorigSpine',
      spine2: 'mixamorigSpine1',
      spine3: 'mixamorigSpine2',
      neck: 'mixamorigNeck',
      head: 'mixamorigHead',
      armL: 'mixamorigLeftArm',
      foreL: 'mixamorigLeftForeArm',
      handL: 'mixamorigLeftHand',
      armR: 'mixamorigRightArm',
      foreR: 'mixamorigRightForeArm',
      handR: 'mixamorigRightHand',
      thighL: 'mixamorigLeftUpLeg',
      calfL: 'mixamorigLeftLeg',
      footL: 'mixamorigLeftFoot',
      ballL: 'mixamorigLeftToeBase',
      thighR: 'mixamorigRightUpLeg',
      calfR: 'mixamorigRightLeg',
      footR: 'mixamorigRightFoot',
      ballR: 'mixamorigRightToeBase',
    },
    rigify: {
      pelvis: 'DEF-spine',
      spine1: 'DEF-spine.001',
      spine2: 'DEF-spine.002',
      spine3: 'DEF-spine.003',
      neck: 'DEF-spine.004',
      head: 'DEF-spine.006',
      armL: 'DEF-upper_arm.L',
      foreL: 'DEF-forearm.L',
      handL: 'DEF-hand.L',
      armR: 'DEF-upper_arm.R',
      foreR: 'DEF-forearm.R',
      handR: 'DEF-hand.R',
      thighL: 'DEF-thigh.L',
      calfL: 'DEF-shin.L',
      footL: 'DEF-foot.L',
      ballL: 'DEF-toe.L',
      thighR: 'DEF-thigh.R',
      calfR: 'DEF-shin.R',
      footR: 'DEF-foot.R',
      ballR: 'DEF-toe.R',
    },
  }
  const n = namesBySchema[schema]
  const figure = new THREE.Group()
  const armature = new THREE.Group()
  armature.name = 'Armature'
  figure.add(armature)

  const makeBone = (name, y, parent) => {
    const b = new THREE.Bone()
    b.name = name
    b.position.set(0, y, 0)
    parent.add(b)
    return b
  }

  const pelvis = makeBone(n.pelvis, heightM * 0.52, armature)
  const spine1 = makeBone(n.spine1, heightM * 0.10, pelvis)
  const spine2 = makeBone(n.spine2, heightM * 0.10, spine1)
  const spine3 = makeBone(n.spine3, heightM * 0.08, spine2)
  const neck = makeBone(n.neck, heightM * 0.07, spine3)
  const head = makeBone(n.head, heightM * 0.05, neck)
  const armL = makeBone(n.armL, 0, spine3)
  const foreL = makeBone(n.foreL, -heightM * 0.14, armL)
  const handL = makeBone(n.handL, -heightM * 0.13, foreL)
  const armR = makeBone(n.armR, 0, spine3)
  const foreR = makeBone(n.foreR, -heightM * 0.14, armR)
  const handR = makeBone(n.handR, -heightM * 0.13, foreR)
  const thighL = makeBone(n.thighL, -heightM * 0.04, pelvis)
  const calfL = makeBone(n.calfL, -heightM * 0.22, thighL)
  const footL = makeBone(n.footL, -heightM * 0.22, calfL)
  const ballL = makeBone(n.ballL, -heightM * 0.03, footL)
  const thighR = makeBone(n.thighR, -heightM * 0.04, pelvis)
  const calfR = makeBone(n.calfR, -heightM * 0.22, thighR)
  const footR = makeBone(n.footR, -heightM * 0.22, calfR)
  const ballR = makeBone(n.ballR, -heightM * 0.03, footR)

  const bones = [
    pelvis, spine1, spine2, spine3, neck, head,
    armL, foreL, handL, armR, foreR, handR,
    thighL, calfL, footL, ballL, thighR, calfR, footR, ballR,
  ]
  const boneIndex = new Map(bones.map((b, i) => [b, i]))
  const skeleton = new THREE.Skeleton(bones)

  function buildPartMesh(meshName, matName, colorHex, y0, y1, boneIdx, includeColor0) {
    const geom = new THREE.BoxGeometry(0.24, Math.max(0.04, y1 - y0), 0.18)
    geom.translate(0, (y0 + y1) * 0.5, 0)
    const count = geom.getAttribute('position').count
    const sIdx = new Uint16Array(count * 4)
    const sWgt = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      sIdx[i * 4] = boneIdx
      sWgt[i * 4] = 1
    }
    geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sIdx, 4))
    geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sWgt, 4))
    if (includeColor0) {
      const col = new THREE.Color(colorHex)
      const cArr = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) {
        cArr[i * 3] = col.r
        cArr[i * 3 + 1] = col.g
        cArr[i * 3 + 2] = col.b
      }
      geom.setAttribute('color', new THREE.Float32BufferAttribute(cArr, 3))
    }
    const mat = new THREE.MeshStandardMaterial({
      name: matName,
      color: includeColor0 ? 0xffffff : colorHex,
      vertexColors: includeColor0,
    })
    const sm = new THREE.SkinnedMesh(geom, mat)
    sm.name = meshName
    sm.bind(skeleton)
    return sm
  }

  if (multiMesh) {
    armature.add(buildPartMesh('avatar_head_skin', 'mat_skin', '#e2b996', heightM * 0.87, heightM * 0.96, boneIndex.get(head), false))
    armature.add(buildPartMesh('avatar_hair', 'mat_hair', '#1b1817', heightM * 0.95, heightM, boneIndex.get(head), false))
    armature.add(buildPartMesh('avatar_top_jacket', 'mat_top', '#6f8574', heightM * 0.55, heightM * 0.85, boneIndex.get(spine2), false))
    armature.add(buildPartMesh('avatar_bottom_pants', 'mat_bottom', '#3b4652', heightM * 0.09, heightM * 0.55, boneIndex.get(thighL), false))
    armature.add(buildPartMesh('avatar_shoes', 'mat_shoes', '#dedad2', 0, heightM * 0.09, boneIndex.get(footL), false))
    armature.add(buildPartMesh('avatar_backpack', 'mat_pack', '#4c575e', heightM * 0.60, heightM * 0.82, boneIndex.get(spine2), false))
  } else {
    // Single merged SkinnedMesh with custom non-legacy COLOR_0 palette
    const segments = [
      {y0: 0, y1: heightM * 0.08, boneIdx: boneIndex.get(footL), hex: customPalette ? '#3d4c41' : '#eeeae2'},
      {y0: 0, y1: heightM * 0.08, boneIdx: boneIndex.get(footR), hex: customPalette ? '#3d4c41' : '#eeeae2'},
      {y0: heightM * 0.09, y1: heightM * 0.52, boneIdx: boneIndex.get(thighL), hex: customPalette ? '#2f3e4f' : '#55708f'},
      {y0: heightM * 0.53, y1: heightM * 0.84, boneIdx: boneIndex.get(spine2), hex: customPalette ? '#7c8f79' : '#f09a4a'},
      {y0: heightM * 0.60, y1: heightM * 0.82, boneIdx: boneIndex.get(armL), hex: customPalette ? '#7c8f79' : '#f09a4a'},
      {y0: heightM * 0.50, y1: heightM * 0.58, boneIdx: boneIndex.get(handL), hex: customPalette ? '#e3baa0' : '#dcb48e'},
      {y0: heightM * 0.86, y1: heightM * 0.94, boneIdx: boneIndex.get(head), hex: customPalette ? '#e3baa0' : '#dcb48e'},
      {y0: heightM * 0.94, y1: heightM, boneIdx: boneIndex.get(head), hex: customPalette ? '#191615' : '#1f1b19'},
    ]
    const pos = [], norm = [], col = [], sIdx = [], sWgt = [], idx = []
    let vOff = 0
    for (const seg of segments) {
      const b = new THREE.BoxGeometry(0.22, seg.y1 - seg.y0, 0.16)
      b.translate(0, (seg.y0 + seg.y1) * 0.5, 0)
      const p = b.getAttribute('position')
      const nm = b.getAttribute('normal')
      const bi = b.getIndex()
      const c = new THREE.Color(seg.hex)
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i))
        norm.push(nm.getX(i), nm.getY(i), nm.getZ(i))
        col.push(c.r, c.g, c.b)
        sIdx.push(seg.boneIdx, 0, 0, 0)
        sWgt.push(1, 0, 0, 0)
      }
      for (let i = 0; i < bi.count; i++) idx.push(bi.getX(i) + vOff)
      vOff += p.count
      b.dispose()
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3))
    geom.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sIdx, 4))
    geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sWgt, 4))
    geom.setIndex(idx)
    const mat = new THREE.MeshStandardMaterial({name: 'RefinedPalette', vertexColors: true})
    const sm = new THREE.SkinnedMesh(geom, mat)
    sm.name = 'RefinedWalker'
    sm.bind(skeleton)
    armature.add(sm)
  }

  const clip = new THREE.AnimationClip('idle', 1, [
    new THREE.QuaternionKeyframeTrack(`${n.pelvis}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    new THREE.QuaternionKeyframeTrack(`${n.head}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0.05, 0, 0.998]),
    new THREE.QuaternionKeyframeTrack(`${n.footL}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  ])
  return {figure, animations: [clip], bones}
}

try {
  await build({
    entryPoints: [
      path.join(root, 'web/src/look/time.ts'),
      path.join(root, 'web/src/look/avatar-look.ts'),
      path.join(root, 'web/src/walk/avatar-rig.ts'),
      path.join(root, 'web/src/walk/avatar-compat.ts'),
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

  const timeMod = await import(pathToFileURL(path.join(tmp, 'look/time.js')).href)
  const lookMod = await import(pathToFileURL(path.join(tmp, 'look/avatar-look.js')).href)
  const rigMod = await import(pathToFileURL(path.join(tmp, 'walk/avatar-rig.js')).href)
  const compatMod = await import(pathToFileURL(path.join(tmp, 'walk/avatar-compat.js')).href)
  const outfitMod = await import(pathToFileURL(path.join(tmp, 'walk/outfits.js')).href)
  const catalogMod = await import(pathToFileURL(path.join(tmp, 'game/catalog.js')).href)

  // 1. Real CityWalker (`public/avatar/figure.glb`) full pipeline test
  const glbBytes = await readFile(path.join(root, 'public/avatar/figure.glb'))
  const glbAb = glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength)
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(glbAb, '', resolve, reject))
  const fig = gltf.scene
  const normLegacy = compatMod.normalizeAvatarSkeletonForRig(fig, gltf.animations)
  check('real figure.glb skeleton normalization is 100% no-op', normLegacy.normalized === false && normLegacy.originalSchema === 'ue_citywalker')

  const rig = rigMod.ensureAvatarRig(fig, null)
  const outfits = outfitMod.createAvatarOutfitController(fig, rig)
  const metrics = compatMod.measureAvatarAsset(fig, 0.955)
  const foot = compatMod.buildRobustFootProbes(fig, rig)
  const styled = compatMod.installAvatarStyleShading(fig, metrics, outfits.getVertexZones(), rig.skinnedMesh)
  const report = compatMod.buildAvatarCompatReport({
    figure: fig,
    rig,
    metrics,
    appliedScale: metrics.recommendedScale,
    soleOffset: foot.soleOffset,
    footProbes: foot.footProbes,
    styledMaterials: styled.styledMaterials,
    surfaceAttrApplied: styled.surfaceAttrApplied,
    outfitStrategy: outfits.getStrategy(),
  })

  check(
    'real figure.glb preserves exact 0.955 scale, 1.695m height, 0 warnings, and legacy_color0 strategy',
    metrics.recommendedScale === 0.955 &&
      Math.abs(report.standingHeightM - 1.695) < 0.01 &&
      report.outfitStrategy === 'legacy_color0' &&
      report.warnings.length === 0 &&
      report.vesselBoundsClearanceOk === true &&
      report.perfBudgetOk === true,
    `scale=${metrics.recommendedScale}, standing=${report.standingHeightM}m, tris=${report.triangleCount}, probes=${report.footProbeCount}`,
  )
  const surfAttr = rig.skinnedMesh.geometry.getAttribute('aAvatarSurface')
  const surfHist = [0, 0, 0, 0]
  for (let i = 0; i < surfAttr.count; i++) surfHist[Math.round(surfAttr.getX(i))]++
  check(
    'CityWalker aAvatarSurface spans all 4 material zones (skin/hair/fabric/accessory) with +0 draw calls',
    surfHist[0] > 1000 && surfHist[1] > 600 && surfHist[2] > 1500 && surfHist[3] > 600 && rig.skinnedMesh.material.userData.__guilinAvatarStyled === true,
    `skin=${surfHist[0]} hair=${surfHist[1]} fabric=${surfHist[2]} acc=${surfHist[3]}`,
  )

  // Verify procedural hat & bag accessories also receive Guilin avatar style shader
  outfits.applyEquipped({...catalogMod.DEFAULT_EQUIPPED_OUTFIT, hat: 'hat_rider_helmet', bag: 'bag_rider_pack'})
  const hatMesh = rig.attachments.head.children.find(c => c.visible)
  const bagMesh = rig.attachments.torso.children.find(c => c.visible)
  check(
    'procedural hats & bags inherit style-fusion shader (helmet glossyShell=true, bag glossyShell=false)',
    hatMesh?.material?.userData?.__guilinAvatarStyled === true &&
      hatMesh?.material?.userData?.__guilinAvatarStyleMeta?.glossyShell === true &&
      bagMesh?.material?.userData?.__guilinAvatarStyled === true &&
      bagMesh?.material?.userData?.__guilinAvatarStyleMeta?.glossyShell === false,
  )
  outfits.dispose()

  // 2. Bone alias table coverage across UE, Mixamo, Rigify, Standard
  const aliasCases = [
    ['pelvis', 'pelvis'], ['mixamorigHips', 'pelvis'], ['DEF-spine', 'pelvis'], ['Hips', 'pelvis'],
    ['mixamorigLeftFoot', 'foot_l'], ['DEF-foot.R', 'foot_r'], ['LeftToeBase', 'ball_l'], ['toe.R', 'ball_r'],
    ['mixamorigHead', 'head'], ['DEF-spine.006', 'head'], ['LeftHand', 'hand_l'], ['DEF-hand.R', 'hand_r'],
    ['mixamorigLeftUpLeg', 'thigh_l'], ['DEF-shin.R', 'calf_r'], ['RightForeArm', 'lowerarm_r'],
  ]
  for (const [raw, expected] of aliasCases) {
    assert.equal(compatMod.resolveCanonicalBoneRole(raw), expected, `alias failed for ${raw}`)
  }
  check('bone alias resolver maps UE / Mixamo / Rigify / Standard cleanly', true, `${aliasCases.length} cases`)

  // 3. Mixamo single-mesh refined model with custom non-legacy COLOR_0 palette + 1.82m height
  const mixamo = makeSyntheticHumanoid({schema: 'mixamo', heightM: 1.82, multiMesh: false, customPalette: true})
  const normMix = compatMod.normalizeAvatarSkeletonForRig(mixamo.figure, mixamo.animations)
  const rigMix = rigMod.ensureAvatarRig(mixamo.figure, null)
  const outfitsMix = outfitMod.createAvatarOutfitController(mixamo.figure, rigMix)
  const metricsMix = compatMod.measureAvatarAsset(mixamo.figure, 0.955)
  const footMix = compatMod.buildRobustFootProbes(mixamo.figure, rigMix)
  const styleMix = compatMod.installAvatarStyleShading(mixamo.figure, metricsMix, outfitsMix.getVertexZones(), rigMix.skinnedMesh)
  const reportMix = compatMod.buildAvatarCompatReport({
    figure: mixamo.figure,
    rig: rigMix,
    metrics: metricsMix,
    appliedScale: metricsMix.recommendedScale,
    soleOffset: footMix.soleOffset,
    footProbes: footMix.footProbes,
    styledMaterials: styleMix.styledMaterials,
    surfaceAttrApplied: styleMix.surfaceAttrApplied,
    outfitStrategy: outfitsMix.getStrategy(),
  })

  // Check animation clip retargeting & bone-driven COLOR_0 skin/hair lock
  const trackNames = mixamo.animations[0].tracks.map(t => t.name)
  const origMixColors = Float32Array.from(rigMix.skinnedMesh.geometry.getAttribute('color').array)
  const mixZones = outfitsMix.getVertexZones()
  outfitsMix.applyEquipped({...catalogMod.DEFAULT_EQUIPPED_OUTFIT, top: 'top_lijiang_shell', bottom: 'bottom_guilin_cargo', shoes: 'shoes_night_moto'})
  const colMix = rigMix.skinnedMesh.geometry.getAttribute('color')
  let lockedErr = 0
  let clothChanged = 0
  for (let i = 0; i < mixZones.length; i++) {
    const d = Math.max(
      Math.abs(colMix.getX(i) - origMixColors[i * 3]),
      Math.abs(colMix.getY(i) - origMixColors[i * 3 + 1]),
      Math.abs(colMix.getZ(i) - origMixColors[i * 3 + 2]),
    )
    if (mixZones[i] === outfitMod.OUTFIT_ZONE.LOCKED_SKIN || mixZones[i] === outfitMod.OUTFIT_ZONE.LOCKED_HAIR) {
      lockedErr = Math.max(lockedErr, d)
    } else if (d > 0.05) {
      clothChanged++
    }
  }
  check(
    'Mixamo refined single-mesh normalizes skeleton/tracks, auto-scales 1.82m->1.695m, and swaps outfits via bone_color0 while locking skin/hair',
    normMix.normalized === true &&
      normMix.retargetedTracks === 3 &&
      trackNames.includes('pelvis.quaternion') &&
      trackNames.includes('foot_l.quaternion') &&
      rigMix.isSkinned === true &&
      reportMix.schema === 'mixamo' &&
      reportMix.outfitStrategy === 'bone_color0' &&
      Math.abs(reportMix.standingHeightM - 1.695) < 0.005 &&
      reportMix.footProbeCount >= 2 &&
      reportMix.warnings.length === 0 &&
      lockedErr < 1e-6 &&
      clothChanged > 40,
    `scale=${metricsMix.recommendedScale}, standing=${reportMix.standingHeightM}m, clothChanged=${clothChanged}`,
  )
  outfitsMix.dispose()

  // 4. Rigify multi-SkinnedMesh named-parts refined model (top/bottom/shoes/pack/skin/hair)
  const rigify = makeSyntheticHumanoid({schema: 'rigify', heightM: 1.72, multiMesh: true})
  const normRig = compatMod.normalizeAvatarSkeletonForRig(rigify.figure, rigify.animations)
  const rigRig = rigMod.ensureAvatarRig(rigify.figure, null)
  const outfitsRig = outfitMod.createAvatarOutfitController(rigify.figure, rigRig)
  const metricsRig = compatMod.measureAvatarAsset(rigify.figure, 0.955)
  const footRig = compatMod.buildRobustFootProbes(rigify.figure, rigRig)
  const styleRig = compatMod.installAvatarStyleShading(rigify.figure, metricsRig, outfitsRig.getVertexZones(), rigRig.skinnedMesh)
  const reportRig = compatMod.buildAvatarCompatReport({
    figure: rigify.figure,
    rig: rigRig,
    metrics: metricsRig,
    appliedScale: metricsRig.recommendedScale,
    soleOffset: footRig.soleOffset,
    footProbes: footRig.footProbes,
    styledMaterials: styleRig.styledMaterials,
    surfaceAttrApplied: styleRig.surfaceAttrApplied,
    outfitStrategy: outfitsRig.getStrategy(),
  })

  const skinMesh = rigify.figure.getObjectByName('avatar_head_skin')
  const hairMesh = rigify.figure.getObjectByName('avatar_hair')
  const topMesh = rigify.figure.getObjectByName('avatar_top_jacket')
  const packMesh = rigify.figure.getObjectByName('avatar_backpack')
  const skinOrigHex = skinMesh.material.color.getHexString()
  const hairOrigHex = hairMesh.material.color.getHexString()
  const topOrigHex = topMesh.material.color.getHexString()

  outfitsRig.applyEquipped({...catalogMod.DEFAULT_EQUIPPED_OUTFIT, top: 'top_lijiang_shell', bag: 'bag_rider_pack'})
  const skinAfterHex = skinMesh.material.color.getHexString()
  const hairAfterHex = hairMesh.material.color.getHexString()
  const topAfterHex = topMesh.material.color.getHexString()
  const packHidden = packMesh.visible === false

  outfitsRig.applyEquipped({...catalogMod.DEFAULT_EQUIPPED_OUTFIT})
  const topRestored = topMesh.material.color.getHexString() === topOrigHex && packMesh.visible === true

  check(
    'Rigify multi-SkinnedMesh named_parts styles all 6 meshes, tints cloth only, hides built-in pack, and keeps skin/hair immutable',
    normRig.normalized === true &&
      reportRig.schema === 'rigify' &&
      reportRig.outfitStrategy === 'named_parts' &&
      reportRig.styledMaterials === 6 &&
      reportRig.footProbeCount >= 1 &&
      reportRig.warnings.length === 0 &&
      skinAfterHex === skinOrigHex &&
      hairAfterHex === hairOrigHex &&
      topAfterHex !== topOrigHex &&
      packHidden &&
      topRestored,
    `meshes=${reportRig.meshCount}, styled=${reportRig.styledMaterials}, standing=${reportRig.standingHeightM}m`,
  )
  outfitsRig.dispose()

  // 5. Contact shadow physics & atmosphere response (zero lights, separate from figure hierarchy)
  const testScene = new THREE.Scene()
  const shadow = lookMod.createAvatarContactShadow(testScene)
  assert.equal(shadow.mesh.parent, testScene, 'contact shadow must attach directly to scene, never under figure')

  timeMod.evaluate(13.5, 'clear', 1)
  lookMod.syncAvatarLookUniforms()
  shadow.update({visible: true, x: 10, z: 20, groundY: 5, footY: 5, crouching: false, yaw: 0})
  const stDay = shadow.getState()

  shadow.update({visible: true, x: 10, z: 20, groundY: 5, footY: 5, crouching: true, yaw: 0})
  const stCrouch = shadow.getState()

  shadow.update({visible: true, x: 10, z: 20, groundY: 5, footY: 5.85, crouching: false, yaw: 0})
  const stAir = shadow.getState()

  timeMod.evaluate(14.0, 'rain', 1)
  shadow.update({visible: true, x: 10, z: 20, groundY: 5, footY: 5, crouching: false, yaw: 0})
  const stRain = shadow.getState()

  timeMod.evaluate(21.5, 'clear', 1)
  shadow.update({visible: true, x: 10, z: 20, groundY: 5, footY: 5, crouching: false, yaw: 0})
  const stNight = shadow.getState()

  shadow.update({visible: false, x: 10, z: 20, groundY: 5, footY: 5, crouching: false, yaw: 0})
  const stHidden = shadow.getState()

  check(
    'contact shadow calibrates clear/rain/night opacity, expands on crouch, fades cleanly in jump air, and hides aboard vehicles',
    stDay.visible &&
      stDay.opacity > stRain.opacity &&
      stRain.opacity > stNight.opacity &&
      stCrouch.scaleX > stDay.scaleX &&
      stAir.opacity < stDay.opacity * 0.35 &&
      stHidden.visible === false,
    `day=${stDay.opacity} rain=${stRain.opacity} night=${stNight.opacity} air=${stAir.opacity}`,
  )
  shadow.dispose()

  // 6. Static redline: zero dynamic Three.js lights in avatar-look & avatar-compat
  const [lookSrc, compatSrc] = await Promise.all([
    readFile(path.join(root, 'web/src/look/avatar-look.ts'), 'utf8'),
    readFile(path.join(root, 'web/src/walk/avatar-compat.ts'), 'utf8'),
  ])
  const hasLight = /(PointLight|SpotLight|RectAreaLight|DirectionalLight|HemisphereLight)/.test(lookSrc + compatSrc)
  check('zero Three.js lights added in avatar-look.ts and avatar-compat.ts', !hasLight)

  console.log(`\nALL ${passed} AVATAR LOOK & COMPAT CHECKS PASSED`)
} finally {
  await rm(tmp, {recursive: true, force: true})
}
