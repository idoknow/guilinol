import {after, before, test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'

const requireFromCwd = createRequire(join(process.cwd(), 'package.json'))
const threeEntryUrl = import.meta.resolve('three')

let tempDir
let officerMod
let hairLibraryScene

async function loadRealGlbFromAvatarDir(file = 'figure_m') {
  const bytes = await readFile(`public/avatar/${file}.glb`)
  let data = bytes.buffer.slice(bytes.byteOffset, bytes.byteLength + bytes.byteOffset)
  const jsonLen = bytes.readUInt32LE(12)
  const doc = JSON.parse(bytes.subarray(20, 20 + jsonLen))
  if (doc.buffers?.[0]?.uri) {
    const bin = await readFile(`public/avatar/${doc.buffers[0].uri}`)
    delete doc.buffers[0].uri
    const json = Buffer.from(JSON.stringify(doc))
    const length = (json.length + 3) & ~3
    const packed = Buffer.alloc(28 + length + bin.length)
    bytes.copy(packed, 0, 0, 20)
    packed.writeUInt32LE(packed.length, 8)
    packed.writeUInt32LE(length, 12)
    packed.fill(0x20, 20, 20 + length)
    json.copy(packed, 20)
    packed.writeUInt32LE(bin.length, 20 + length)
    packed.write('BIN\0', 24 + length)
    bin.copy(packed, 28 + length)
    data = packed.buffer
  }
  const {scene} = await new GLTFLoader().parseAsync(data, '')
  return scene
}

before(async () => {
  hairLibraryScene = await loadRealGlbFromAvatarDir('creator-hair')

  tempDir = await mkdtemp(join(tmpdir(), 'glol-officer-look-test-'))
  const outfile = join(tempDir, 'officer-look.mjs')
  await build({
    entryPoints: ['web/src/traffic-duty/officer-look/index.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    plugins: [
      {
        name: 'resolve-three-from-cwd',
        setup(ctx) {
          ctx.onResolve({filter: /^three$/}, () => ({path: threeEntryUrl, external: true}))
          ctx.onResolve({filter: /^three\/.*/}, args => ({
            path: pathToFileURL(requireFromCwd.resolve(args.path)).href,
            external: true,
          }))
        },
      },
    ],
  })
  officerMod = await import(pathToFileURL(outfile).href)
})

after(async () => {
  if (tempDir) await rm(tempDir, {recursive: true, force: true})
})

function computeSkinnedBoneVertexWorldBox(skinnedMesh, boneName) {
  const pos = skinnedMesh.geometry.getAttribute('position')
  const si = skinnedMesh.geometry.getAttribute('skinIndex')
  const sw = skinnedMesh.geometry.getAttribute('skinWeight')
  const drawCount = Number.isFinite(skinnedMesh.geometry.drawRange.count)
    ? Math.min(
        skinnedMesh.geometry.index ? skinnedMesh.geometry.index.count : pos.count,
        skinnedMesh.geometry.drawRange.count,
      )
    : skinnedMesh.geometry.index
      ? skinnedMesh.geometry.index.count
      : pos.count

  const activeVerts = new Set()
  if (skinnedMesh.geometry.index) {
    for (let i = 0; i < drawCount; i++) {
      activeVerts.add(skinnedMesh.geometry.index.getX(i))
    }
  } else {
    for (let i = 0; i < drawCount; i++) activeVerts.add(i)
  }

  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  let count = 0
  for (const vi of activeVerts) {
    let bestIdx = si.getX(vi)
    let bestW = sw.getX(vi)
    if (sw.getY(vi) > bestW) {
      bestIdx = si.getY(vi)
      bestW = sw.getY(vi)
    }
    if (sw.getZ(vi) > bestW) {
      bestIdx = si.getZ(vi)
      bestW = sw.getZ(vi)
    }
    if (sw.getW(vi) > bestW) {
      bestIdx = si.getW(vi)
    }
    if (skinnedMesh.skeleton.bones[Math.round(bestIdx)]?.name !== boneName) continue
    skinnedMesh.getVertexPosition(vi, v)
    v.applyMatrix4(skinnedMesh.matrixWorld)
    box.expandByPoint(v)
    count++
  }
  return {box, count}
}

test('r10 player-pipeline officer-look (k4): preserves creator-face, creator-hair, creator-body-outline & uniform; <=20k tris, <=10 draw calls', async () => {
  for (const [glbName, body] of [
    ['figure', 'm'],
    ['figure_m', 'm'],
    ['figure_f', 'f'],
  ]) {
    const figureRoot = await loadRealGlbFromAvatarDir(glbName)
    const avatar = {
      ...officerMod.DEFAULT_OFFICER_AVATAR,
      body,
      hair: body === 'f' ? 'f_lob' : 'm_crop',
    }
    const look = officerMod.applyOfficerLook(figureRoot, {
      avatar,
      hairLibraryScene,
      expression: 'serious',
    })
    const metrics = look.getMetrics()

    // 1. Core k4 player-pipeline node assertions
    assert.ok(figureRoot.getObjectByName('creator-face'), `[${glbName}] must contain creator-face`)
    assert.ok(figureRoot.getObjectByName('creator-hair'), `[${glbName}] must contain creator-hair`)
    assert.ok(figureRoot.getObjectByName('creator-body-outline'), `[${glbName}] must contain creator-body-outline`)
    assert.equal(metrics.hasCreatorFace, true)
    assert.equal(metrics.hasCreatorHair, true)
    assert.equal(metrics.hasCreatorBodyOutline, true)
    assert.equal(metrics.hasUniformOutfit, true, `[${glbName}] must apply OFFICER_UNIFORM_OUTFIT`)

    const expectedUniform = officerMod.resolveOfficerUniformOutfit()
    assert.deepEqual(
      metrics.appliedOutfit,
      expectedUniform,
      `[${glbName}] appliedOutfit must match OFFICER_UNIFORM_OUTFIT`,
    )
    assert.equal(expectedUniform.top, 'top_traffic_police_shirt')
    assert.equal(expectedUniform.bottom, 'bottom_police_trousers')
    assert.equal(expectedUniform.hat, 'hat_traffic_police_cap')

    // 2. Budget assertions (k4): triangles <= 20,000, draw calls <= 10, dynamic lights === 0
    assert.ok(
      metrics.triangleCount > 5000 && metrics.triangleCount <= 20000,
      `[${glbName}] triangles=${metrics.triangleCount} must be <= 20000`,
    )
    assert.ok(
      metrics.estimatedDrawCalls >= 5 && metrics.estimatedDrawCalls <= 10,
      `[${glbName}] estimatedDrawCalls=${metrics.estimatedDrawCalls} must be <= 10`,
    )
    assert.equal(metrics.dynamicLightCount, 0, `[${glbName}] must add 0 dynamic lights`)

    // 3. Verify r10 style rules: zero normalMap / roughnessMap, metalness <= 0.2, streetShading + outline on dutyKit
    const kitMat = look.parts.dutyKitUnit.material
    assert.equal(kitMat.normalMap, null, `[${glbName}] dutyKit must not use normalMap`)
    assert.equal(kitMat.roughnessMap, null, `[${glbName}] dutyKit must not use roughnessMap`)
    assert.ok(kitMat.metalness <= 0.2, `[${glbName}] dutyKit metalness (${kitMat.metalness}) must be <= 0.2`)
    assert.ok(look.parts.dutyKitUnit.getObjectByName('creator-outline'), `[${glbName}] dutyKit must have creator-outline`)

    // 4. Bone mounts & 4 accessories (walkie-talkie, chest badge, matte white gloves, whistle chain)
    assert.equal(metrics.boneMounts.cap, 'head')
    assert.equal(metrics.boneMounts.dutyKit, 'spine_03')
    assert.equal(metrics.boneMounts.radio, 'spine_03')
    assert.equal(metrics.boneMounts.badge, 'spine_03')
    assert.equal(metrics.boneMounts.whistleChain, 'spine_03')
    assert.equal(metrics.boneMounts.gloveL, 'hand_l')
    assert.equal(metrics.boneMounts.gloveR, 'hand_r')

    // 5. Verify matte white cloth gloves (#f2f2ee) on #389 hand vertices & natural 1:1 finger bone scales
    const colAttr = look.parts.bodyMesh.geometry.getAttribute('color')
    const posAttr = look.parts.bodyMesh.geometry.getAttribute('position')
    let whiteHandVerts = 0
    for (let i = 0; i < posAttr.count; i++) {
      if (Math.abs(posAttr.getX(i)) > 0.74 && colAttr.getX(i) > 0.8) whiteHandVerts++
    }
    assert.ok(whiteHandVerts >= 40, `[${glbName}] hand/finger vertices must be tinted matte white #f2f2ee (got ${whiteHandVerts})`)

    for (const bName of ['thumb_01_l', 'thumb_02_l', 'index_01_l', 'index_02_r']) {
      const b = figureRoot.getObjectByName(bName)
      assert.ok(b, `[${glbName}] expected #389 finger bone ${bName}`)
      assert.ok(
        Math.abs(b.scale.x - 1) < 1e-4 && Math.abs(b.scale.y - 1) < 1e-4 && Math.abs(b.scale.z - 1) < 1e-4,
        `[${glbName}] finger bone ${bName} must keep natural 1:1 scale`,
      )
    }

    look.dispose()
  }
})

test('r10 anti-clipping & bounding-box integrity across 6 gesture poses on latest #389 GLB (k4)', async () => {
  for (const glbName of ['figure', 'figure_m']) {
    const figureRoot = await loadRealGlbFromAvatarDir(glbName)
    const look = officerMod.applyOfficerLook(figureRoot, {
      hairLibraryScene,
      expression: 'serious',
    })
    const rig = look.rig

    const poses = [
      {
        name: 'idle_stand',
        Torso: [0, 0, 0],
        Head: [0, 0, 0],
        ArmL: [0.06, 0, -0.14],
        ForearmL: [0.18, 0, 0],
        ArmR: [0.06, 0, 0.14],
        ForearmR: [0.18, 0, 0],
        ThighL: [0, 0, -0.02],
        ThighR: [0, 0, 0.02],
      },
      {
        name: 'stop_command_overhead',
        Torso: [-0.03, 0.05, 0],
        Head: [0, -0.12, 0],
        ArmL: [0.08, 0, -0.16],
        ForearmL: [0.22, 0, 0],
        ArmR: [1.46, 0.08, 0.16],
        ForearmR: [0.54, 0, 0],
        ThighL: [0, 0, -0.03],
        ThighR: [0, 0, 0.03],
      },
      {
        name: 'go_lateral_sweep',
        Torso: [0, -0.08, 0],
        Head: [0, 0.22, 0],
        ArmL: [0.22, 0, -1.18],
        ForearmL: [0.2, 0, 0],
        ArmR: [1.02, -0.28, 0.24],
        ForearmR: [0.82, 0.25, 0],
        ThighL: [0, 0, -0.02],
        ThighR: [0, 0, 0.02],
      },
      {
        name: 'salute_visor',
        Torso: [0.02, 0, 0],
        Head: [0, 0, 0],
        ArmL: [0.04, 0, -0.1],
        ForearmL: [0.12, 0, 0],
        ArmR: [1.32, -0.35, 0.44],
        ForearmR: [1.82, 0.22, 0],
        ThighL: [0, 0, 0],
        ThighR: [0, 0, 0],
      },
      {
        name: 'walk_stride',
        Torso: [0.04, 0.14, 0.02],
        Head: [-0.02, -0.1, 0],
        ArmL: [0.42, 0, -0.12],
        ForearmL: [0.35, 0, 0],
        ArmR: [-0.36, 0, 0.12],
        ForearmR: [0.28, 0, 0],
        ThighL: [-0.45, 0, 0],
        ThighR: [0.42, 0, 0],
      },
      {
        name: 'thumbs_up_praise',
        Torso: [0.03, -0.06, 0],
        Head: [0.04, 0.05, 0.03],
        ArmL: [0.68, 0.12, -0.22],
        ForearmL: [0.95, 0.1, 0],
        ArmR: [0.16, 0, 0.15],
        ForearmR: [0.34, 0, 0],
        ThighL: [0, 0, -0.02],
        ThighR: [0, 0, 0.02],
      },
    ]

    const headBone = figureRoot.getObjectByName('head')
    const spine3Bone = figureRoot.getObjectByName('spine_03')
    const handLBone = figureRoot.getObjectByName('hand_l')
    const handRBone = figureRoot.getObjectByName('hand_r')
    const creatorHair = figureRoot.getObjectByName('creator-hair')

    for (const pose of poses) {
      rig.joints.Torso.rotation.set(...pose.Torso)
      rig.joints.Head.rotation.set(...pose.Head)
      rig.joints.ArmL.rotation.set(...pose.ArmL)
      rig.joints.ForearmL.rotation.set(...pose.ForearmL)
      rig.joints.ArmR.rotation.set(...pose.ArmR)
      rig.joints.ForearmR.rotation.set(...pose.ForearmR)
      rig.joints.ThighL.rotation.set(...pose.ThighL)
      rig.joints.ThighR.rotation.set(...pose.ThighR)
      if (pose.name === 'thumbs_up_praise') {
        look.setExpression('thumbs_up')
        look.poseThumbsUp(true, 'left')
      } else {
        look.setExpression('serious')
        look.poseThumbsUp(false, 'left')
        rig.syncPose()
      }
      figureRoot.updateMatrixWorld(true)

      // 1. Head skin & creator-hair never poke above peaked cap crown
      const headSkin = computeSkinnedBoneVertexWorldBox(look.parts.bodyMesh, 'head')
      const capBox = new THREE.Box3().setFromObject(look.parts.headUnit)
      const headPos = headBone.getWorldPosition(new THREE.Vector3())
      assert.ok(
        headSkin.box.max.y <= capBox.max.y + 0.002,
        `[${glbName}/${pose.name}] head crown (${headSkin.box.max.y.toFixed(3)}) must not poke above cap (${capBox.max.y.toFixed(3)})`,
      )
      if (creatorHair && creatorHair.visible) {
        const hairBox = new THREE.Box3().setFromObject(creatorHair)
        assert.ok(
          hairBox.max.y <= capBox.max.y + 0.002,
          `[${glbName}/${pose.name}] creator-hair (${hairBox.max.y.toFixed(3)}) must stay tucked under cap (${capBox.max.y.toFixed(3)})`,
        )
      }
      assert.ok(
        capBox.getCenter(new THREE.Vector3()).distanceTo(headPos) < 0.18,
        `[${glbName}/${pose.name}] cap must track head bone tightly`,
      )

      // 2. Duty kit (shoulder radio + chest badges + whistle lanyard) tracks spine_03 without burying inside torso core
      const spine3Torso = computeSkinnedBoneVertexWorldBox(look.parts.bodyMesh, 'spine_03')
      const kitBox = new THREE.Box3().setFromObject(look.parts.dutyKitUnit)
      const spine3Pos = spine3Bone.getWorldPosition(new THREE.Vector3())
      assert.ok(
        kitBox.getCenter(new THREE.Vector3()).distanceTo(spine3Pos) < 0.22,
        `[${glbName}/${pose.name}] dutyKitUnit must stay anchored to spine_03`,
      )
      if (pose.name === 'idle_stand') {
        assert.ok(
          kitBox.min.z <= spine3Torso.box.min.z + 0.015,
          `[${glbName}] chest plates & whistle lanyard must sit proud in front of chest shirt without Z-burying`,
        )
      }

      // 3. White-gloved #389 hands never penetrate torso core across any of the 6 gestures
      const torsoCore = spine3Torso.box.clone().expandByScalar(-0.035)
      for (const [bName, bone] of [
        ['hand_l', handLBone],
        ['hand_r', handRBone],
      ]) {
        const handBox = computeSkinnedBoneVertexWorldBox(look.parts.bodyMesh, bName)
        const handCenter = handBox.count > 0 ? handBox.box.getCenter(new THREE.Vector3()) : bone.getWorldPosition(new THREE.Vector3())
        assert.equal(
          torsoCore.containsPoint(handCenter),
          false,
          `[${glbName}/${pose.name}] ${bName} must not penetrate inside torso core`,
        )
      }
    }

    look.dispose()
  }
})

test('r10 creator-face 5 expressions (neutral, serious, smile, remind, thumbs_up) are pairwise distinct & idempotent', async () => {
  const figureRoot = await loadRealGlbFromAvatarDir('figure_m')
  const look1 = officerMod.applyOfficerLook(figureRoot, {hairLibraryScene, expression: 'neutral'})
  const baselineNeutral = Float32Array.from(look1.parts.faceUnit.geometry.getAttribute('position').array)

  const look = officerMod.applyOfficerLook(figureRoot, {hairLibraryScene, expression: 'neutral'})
  assert.ok(look.getMetrics().estimatedDrawCalls <= 10)
  let outlineCount = 0
  figureRoot.traverse(n => {
    if (n.name === 'creator-body-outline') outlineCount++
  })
  assert.equal(outlineCount, 1, 're-applying applyOfficerLook must not duplicate creator-body-outline')

  const snapshots = new Map()
  for (const expr of officerMod.OFFICER_ALL_EXPRESSION_IDS) {
    assert.equal(look.setExpression(expr), expr)
    assert.equal(look.getExpression(), expr)
    const posArr = Float32Array.from(look.parts.faceUnit.geometry.getAttribute('position').array)
    snapshots.set(expr, posArr)
  }

  const neutralSnap = snapshots.get('neutral')
  let neutralDelta = 0
  for (let k = 0; k < neutralSnap.length; k++) {
    neutralDelta += Math.abs(neutralSnap[k] - baselineNeutral[k])
  }
  assert.ok(neutralDelta < 1e-6, `neutral expression must preserve original creator-face geometry (delta=${neutralDelta})`)

  const ids = [...officerMod.OFFICER_ALL_EXPRESSION_IDS]
  assert.equal(ids.length, 5)
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = snapshots.get(ids[i])
      const b = snapshots.get(ids[j])
      let posDeltaSum = 0
      for (let k = 0; k < a.length; k++) posDeltaSum += Math.abs(a[k] - b[k])
      assert.ok(
        posDeltaSum > 0.015,
        `expression pair (${ids[i]} vs ${ids[j]}) must differ in creator-face 3D geometry (got ${posDeltaSum.toFixed(4)})`,
      )
    }
  }

  look.dispose()
})
