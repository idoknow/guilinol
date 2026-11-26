import * as THREE from 'three'
import {addOutline, streetShading} from '../../walk/creator-ink.ts'

export interface ColoredGeomPart {
  geom: THREE.BufferGeometry
  hex: string
}

export interface FingerPoseEntry {
  bone: THREE.Object3D
  restQuat: THREE.Quaternion
  relaxedQuat: THREE.Quaternion
  thumbsUpQuat: THREE.Quaternion
  gripQuat: THREE.Quaternion
}

export interface ArmOverrideEntry {
  bone: THREE.Object3D
  restQuat: THREE.Quaternion
  targetQuat: THREE.Quaternion
}

/**
 * Merges static low-poly colored parts into a single indexed BufferGeometry so `addOutline`
 * can weld normals cleanly and render both body + outline in 2 draw calls total (`metalness <= 0.05`, zero normal/spec maps).
 */
export function mergeFlatColoredParts(parts: readonly ColoredGeomPart[]): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const c = new THREE.Color()
  let vertexOffset = 0

  for (const part of parts) {
    const g = part.geom
    if (!g.getAttribute('normal')) g.computeVertexNormals()
    const pos = g.getAttribute('position') as THREE.BufferAttribute
    const norm = g.getAttribute('normal') as THREE.BufferAttribute
    const idx = g.getIndex()
    c.set(part.hex)

    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i))
      normals.push(norm.getX(i), norm.getY(i), norm.getZ(i))
      colors.push(c.r, c.g, c.b)
    }
    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices.push(vertexOffset + idx.getX(i))
      }
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices.push(vertexOffset + i)
      }
    }
    vertexOffset += pos.count
    g.dispose()
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  merged.setIndex(indices)
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

/**
 * Creates or reuses a bone-parented mount aligned to character space (`+X` right, `+Y` up, `-Z` forward).
 */
export function ensureCharacterAlignedBoneMount(
  figureRoot: THREE.Object3D,
  bone: THREE.Object3D,
  mountName: string,
): THREE.Object3D {
  const existing = bone.getObjectByName(mountName)
  if (existing) return existing

  figureRoot.updateWorldMatrix(true, true)
  const rootQuat = figureRoot.getWorldQuaternion(new THREE.Quaternion())
  const boneWorldQuat = bone.getWorldQuaternion(new THREE.Quaternion())
  const alignQuat = boneWorldQuat.clone().invert().multiply(rootQuat)

  const mount = new THREE.Group()
  mount.name = mountName
  mount.quaternion.copy(alignQuat)
  bone.add(mount)
  mount.updateWorldMatrix(true, false)
  return mount
}

function sampleHeadOrTorsoBounds(
  skinned: THREE.SkinnedMesh,
  mount: THREE.Object3D,
  allowedBones: ReadonlySet<string>,
): THREE.Box3 {
  skinned.skeleton?.update()
  skinned.updateWorldMatrix(true, false)
  mount.updateWorldMatrix(true, false)
  const toMount = mount.matrixWorld.clone().invert().multiply(skinned.matrixWorld)
  const pos = skinned.geometry.getAttribute('position') as THREE.BufferAttribute
  const si = skinned.geometry.getAttribute('skinIndex') as THREE.BufferAttribute | undefined
  const sw = skinned.geometry.getAttribute('skinWeight') as THREE.BufferAttribute | undefined
  const bones = skinned.skeleton?.bones ?? []
  const v = new THREE.Vector3()
  const box = new THREE.Box3()
  if (!pos || !si || !sw || !bones.length) return box

  for (let i = 0; i < pos.count; i++) {
    let bestIdx = si.getX(i)
    let bestW = sw.getX(i)
    if (sw.getY(i) > bestW) {
      bestIdx = si.getY(i)
      bestW = sw.getY(i)
    }
    if (sw.getZ(i) > bestW) {
      bestIdx = si.getZ(i)
      bestW = sw.getZ(i)
    }
    if (sw.getW(i) > bestW) {
      bestIdx = si.getW(i)
    }
    const bName = bones[Math.round(bestIdx)]?.name ?? ''
    if (!allowedBones.has(bName)) continue
    v.fromBufferAttribute(pos, i)
    skinned.applyBoneTransform(i, v)
    v.applyMatrix4(toMount)
    box.expandByPoint(v)
  }
  return box
}

/**
 * Builds the 4-piece cel-shaded police accessory kit (`officer_duty_kit` on `spine_03`, 1 Mesh + 1 ink outline = 2 draw calls)
 * strictly following `r10-officer-guide.md` & `docs/research/officer-r10/spec.md` §5.2:
 *  1. Left-shoulder tactical walkie-talkie (`-X` anatomical left shoulder slope, matte `#1c2128` + short `#161a20` antenna)
 *  2. Left-chest compliant dark-navy `交警` identification plate (`#162646` + crisp `#f4f8fc` geometric bars)
 *  3. Right-chest blank silver-blue placeholder plate (`#263954` frame + `#cfd9e4` blank face, zero numbers)
 *  4. Right-shoulder to right-chest matte white/silver whistle lanyard (`#e8edf0` cord + whistle head)
 *
 * Strictly zero normalMap, zero roughnessMap, `metalness: 0.04 <= 0.2`, shaded via `streetShading` + `addOutline(..., 0.004)`.
 */
export function buildOfficerUpperDutyKit(
  skinned: THREE.SkinnedMesh,
  torsoMount: THREE.Object3D,
): {mesh: THREE.Mesh; dispose(): void} {
  const torsoBox = sampleHeadOrTorsoBounds(
    skinned,
    torsoMount,
    new Set(['spine_03', 'spine_02', 'clavicle_l', 'clavicle_r']),
  )
  const frontChestZ = torsoBox.isEmpty() ? -0.112 : Math.min(-0.108, torsoBox.min.z - 0.004)
  const topShoulderY = torsoBox.isEmpty() ? 0.184 : Math.min(0.205, Math.max(0.165, torsoBox.max.y - 0.004))

  const parts: ColoredGeomPart[] = []

  // 1) Left-shoulder walkie-talkie (`spec.md` §5.2: anatomical left = -X, forward = -Z)
  const radioX = -0.132
  const radioY = topShoulderY + 0.006
  const radioZ = -0.036

  const radioBody = new THREE.BoxGeometry(0.026, 0.058, 0.020)
  radioBody.rotateZ(0.14)
  radioBody.rotateX(-0.12)
  radioBody.translate(radioX, radioY, radioZ)
  parts.push({geom: radioBody, hex: '#1c2128'})

  const radioClip = new THREE.BoxGeometry(0.018, 0.024, 0.006)
  radioClip.rotateZ(0.14)
  radioClip.rotateX(-0.12)
  radioClip.translate(radioX + 0.002, radioY - 0.004, radioZ - 0.012)
  parts.push({geom: radioClip, hex: '#586370'})

  const antenna = new THREE.CylinderGeometry(0.0032, 0.0045, 0.058, 7)
  antenna.rotateZ(0.10)
  antenna.translate(radioX - 0.005, radioY + 0.054, radioZ - 0.002)
  parts.push({geom: antenna, hex: '#161a20'})

  const ledDot = new THREE.BoxGeometry(0.004, 0.004, 0.004)
  ledDot.translate(radioX + 0.005, radioY + 0.022, radioZ - 0.012)
  parts.push({geom: ledDot, hex: '#48c97a'})

  // Sample actual chest front profile by height `y` in `torsoMount` space so the whistle lanyard hugs the sloped upper chest with 0 air gap!
  skinned.skeleton?.update()
  skinned.updateWorldMatrix(true, false)
  torsoMount.updateWorldMatrix(true, false)
  const toTorso = torsoMount.matrixWorld.clone().invert().multiply(skinned.matrixWorld)
  const skinPos = skinned.geometry.getAttribute('position') as THREE.BufferAttribute
  const torsoSamplePts: THREE.Vector3[] = []
  for (let i = 0; i < skinPos.count; i++) {
    const tv = new THREE.Vector3().fromBufferAttribute(skinPos, i)
    skinned.applyBoneTransform(i, tv)
    tv.applyMatrix4(toTorso)
    if (tv.z < 0.02 && Math.abs(tv.x) < 0.16 && tv.y > -0.05 && tv.y < 0.22) {
      torsoSamplePts.push(tv)
    }
  }
  const chestFrontZAt = (xVal: number, yVal: number): number => {
    let minZ = -0.092
    let hits = 0
    for (const p of torsoSamplePts) {
      if (Math.abs(p.y - yVal) <= 0.026 && Math.abs(p.x - xVal) <= 0.036) {
        if (p.z < minZ || hits === 0) minZ = p.z
        hits++
      }
    }
    if (hits === 0) {
      const slopeT = Math.max(0, Math.min(1, (topShoulderY - yVal) / Math.max(0.08, topShoulderY - 0.04)))
      return -0.048 + (frontChestZ - -0.048) * slopeT
    }
    return minZ
  }

  // 2) Left-chest dark-navy identification plate (`#162646` + crisp `#f4f8fc` geometric emblem bars, zero real numbers)
  // Centered at `y = +0.0675` (`rest.y = 1.3017`) & `x = -0.055` to align 1:1 with `outfits.ts` officer vest tab (`[0.030..0.080] x [1.285..1.318]`) and stay clear of `0.086` silver stripe.
  const plateY = 0.0675
  const leftPlateX = -0.055
  const leftPlateZ = chestFrontZAt(leftPlateX, plateY) - 0.004

  const leftPlate = new THREE.BoxGeometry(0.052, 0.033, 0.005)
  leftPlate.rotateY(0.12)
  leftPlate.translate(leftPlateX, plateY, leftPlateZ)
  parts.push({geom: leftPlate, hex: '#162646'})

  for (const dx of [-0.011, 0.011]) {
    const glyphBlock = new THREE.BoxGeometry(0.014, 0.011, 0.003)
    glyphBlock.rotateY(0.12)
    glyphBlock.translate(leftPlateX + dx, plateY, leftPlateZ - 0.003)
    parts.push({geom: glyphBlock, hex: '#f4f8fc'})
  }

  // 3) Right-chest blank silver-blue placeholder badge (`#263954` frame + `#cfd9e4` blank face, zero ID digits)
  // Aligned 1:1 with `outfits.ts` right-chest placeholder (`[-0.080..-0.032] x [1.287..1.316]`) inside `0.086` vertical reflective band.
  const rightPlateX = 0.056
  const rightPlateZ = chestFrontZAt(rightPlateX, plateY) - 0.004
  const rightFrame = new THREE.BoxGeometry(0.050, 0.031, 0.005)
  rightFrame.rotateY(-0.12)
  rightFrame.translate(rightPlateX, plateY, rightPlateZ)
  parts.push({geom: rightFrame, hex: '#263954'})

  const rightInner = new THREE.BoxGeometry(0.041, 0.021, 0.003)
  rightInner.rotateY(-0.12)
  rightInner.translate(rightPlateX, plateY, rightPlateZ - 0.003)
  parts.push({geom: rightInner, hex: '#cfd9e4'})

  // 4) Right-shoulder to outer-right pocket whistle lanyard (`#e8edf0` cord hugging chest contour, tucked at x=+0.096 clear of right plate!)
  const pocketX = 0.096
  const pocketY = 0.026
  const lanyardPts: THREE.Vector3[] = []
  for (let i = 0; i <= 16; i++) {
    const t = i / 16
    const lx = 0.104 + Math.sin(t * Math.PI) * 0.008 - t * (0.104 - pocketX)
    const ly = topShoulderY - 0.008 - t * (topShoulderY - 0.008 - pocketY)
    const surfZ = chestFrontZAt(lx, ly)
    const lz = i === 0 ? Math.min(-0.026, surfZ - 0.003) : surfZ - 0.0035
    lanyardPts.push(new THREE.Vector3(lx, ly, lz))
  }
  const lanyardGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(lanyardPts), 16, 0.0022, 6, false)
  parts.push({geom: lanyardGeo, hex: '#e8edf0'})

  const pocketZ = chestFrontZAt(pocketX, pocketY) - 0.004
  const whistleTip = new THREE.CylinderGeometry(0.0048, 0.0048, 0.018, 8)
  whistleTip.rotateZ(0.18)
  whistleTip.translate(pocketX, pocketY - 0.006, pocketZ)
  parts.push({geom: whistleTip, hex: '#dde4ec'})

  const mergedGeo = mergeFlatColoredParts(parts)
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.04,
    flatShading: true,
  })
  streetShading(mat)
  const mesh = new THREE.Mesh(mergedGeo, mat)
  mesh.name = 'officer_duty_kit'
  addOutline(mesh, 0.004)

  return {
    mesh,
    dispose() {
      mesh.traverse(child => {
        if (child instanceof THREE.Mesh && child !== mesh) {
          for (const m of Array.isArray(child.material) ? child.material : [child.material]) m.dispose()
        }
      })
      mesh.removeFromParent()
      mergedGeo.dispose()
      mat.dispose()
    },
  }
}

/**
 * Fallback cel-shaded peaked police cap (`#f4f5f2` crown, `#1d2b45` band, `#121417` visor, `#dfb64c` shield, `#1b1a1a` nape)
 * used ONLY if `applyOfficerLook` is called without `hat_traffic_police_cap` mounted by `outfits.ts`.
 */
export function buildFallbackPoliceCap(
  skinned: THREE.SkinnedMesh,
  headMount: THREE.Object3D,
): {mesh: THREE.Mesh; dispose(): void} {
  const headBox = sampleHeadOrTorsoBounds(skinned, headMount, new Set(['head']))
  const topCrownY = headBox.isEmpty() ? 0.168 : headBox.max.y
  const rimY = Math.max(0.095, topCrownY - 0.064)

  const parts: ColoredGeomPart[] = []
  const band = new THREE.CylinderGeometry(0.114, 0.110, 0.036, 18)
  band.scale(1, 1, 1.14)
  band.translate(0, rimY + 0.016, 0.010)
  parts.push({geom: band, hex: '#1d2b45'})

  const crown = new THREE.CylinderGeometry(0.136, 0.114, 0.044, 18)
  crown.scale(1, 1, 1.15)
  crown.rotateX(0.08)
  crown.translate(0, rimY + 0.054, 0.004)
  parts.push({geom: crown, hex: '#f4f5f2'})

  const visor = new THREE.BoxGeometry(0.175, 0.008, 0.056)
  visor.rotateX(-0.22)
  visor.translate(0, rimY + 0.002, -0.132)
  parts.push({geom: visor, hex: '#121417'})

  const shield = new THREE.OctahedronGeometry(0.015, 0)
  shield.scale(0.95, 1.15, 0.45)
  shield.translate(0, rimY + 0.048, -0.126)
  parts.push({geom: shield, hex: '#dfb64c'})

  const nape = new THREE.CylinderGeometry(0.106, 0.098, 0.058, 14, 1, false, -Math.PI * 0.65, Math.PI * 1.3)
  nape.scale(1, 1, 1.12)
  nape.translate(0, rimY - 0.014, 0.014)
  parts.push({geom: nape, hex: '#1b1a1a'})

  const geo = mergeFlatColoredParts(parts)
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.04,
    flatShading: true,
    side: THREE.DoubleSide,
  })
  streetShading(mat)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'officer_peaked_cap'
  addOutline(mesh, 0.004)

  return {
    mesh,
    dispose() {
      mesh.traverse(child => {
        if (child instanceof THREE.Mesh && child !== mesh) {
          for (const m of Array.isArray(child.material) ? child.material : [child.material]) m.dispose()
        }
      })
      mesh.removeFromParent()
      geo.dispose()
      mat.dispose()
    },
  }
}

function buildBindBoneMap(skinned: THREE.SkinnedMesh): Map<string, {pos: THREE.Vector3; rot: THREE.Quaternion}> {
  const map = new Map<string, {pos: THREE.Vector3; rot: THREE.Quaternion}>()
  const bones = skinned.skeleton?.bones ?? []
  const invs = skinned.skeleton?.boneInverses ?? []
  const m = new THREE.Matrix4()
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i]
    const inv = invs[i]
    if (!b || !inv) continue
    m.copy(inv).invert()
    map.set(b.name, {
      pos: new THREE.Vector3().setFromMatrixPosition(m),
      rot: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(m)),
    })
  }
  return map
}

/**
 * Precomputes natural relaxed finger curls & crisp upright thumbs-up pose on the latest `#389` hand rig
 * with 100% 1:1 bone scales (never squashing or stretching finger lengths!).
 */
export function buildOfficerFingerPoses(
  figureRoot: THREE.Object3D,
  skinned: THREE.SkinnedMesh,
): {
  left: FingerPoseEntry[]
  right: FingerPoseEntry[]
  armThumbsUpLeft: ArmOverrideEntry[]
  armThumbsUpRight: ArmOverrideEntry[]
} {
  const bindMap = buildBindBoneMap(skinned)
  const axisZ = new THREE.Vector3(0, 0, 1)
  const identity = new THREE.Quaternion()

  const makeLocalTarget = (
    boneName: string,
    parentName: string,
    delta: THREE.Quaternion,
    parentDelta: THREE.Quaternion,
  ): THREE.Quaternion | null => {
    const childB = bindMap.get(boneName)?.rot
    const parentB = bindMap.get(parentName)?.rot
    if (!childB || !parentB) return null
    return parentB
      .clone()
      .invert()
      .multiply(parentDelta.clone().invert())
      .multiply(delta)
      .multiply(childB)
  }

  const buildSide = (side: 'l' | 'r'): {fingers: FingerPoseEntry[]; armOverride: ArmOverrideEntry[]} => {
    const entries: FingerPoseEntry[] = []
    const armOverride: ArmOverrideEntry[] = []
    const sign = side === 'l' ? -1 : 1
    const sideX = side === 'l' ? 1 : -1
    const handName = `hand_${side}`

    const armAxis = new THREE.Vector3(sideX, 0, 0)
    const upperAim = new THREE.Quaternion().setFromUnitVectors(
      armAxis,
      new THREE.Vector3(sideX * 0.25, -0.80, 0.54).normalize(),
    )
    const lowerAim = new THREE.Quaternion().setFromUnitVectors(
      armAxis,
      new THREE.Vector3(-sideX * 0.05, 0.46, 0.88).normalize(),
    )
    const fingersDir = new THREE.Vector3(-sideX * 0.68, -0.06, 0.73).normalize()
    const dorsalOut = new THREE.Vector3(-sideX * 0.72, 0.06, -0.69).normalize()
    const bx = fingersDir.clone().multiplyScalar(sideX)
    const by = dorsalOut.clone().negate()
    by.addScaledVector(bx, -by.dot(bx)).normalize()
    const handAim = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(bx, by, new THREE.Vector3().crossVectors(bx, by)),
    )

    for (const [bName, pName, d, pd] of [
      [`upperarm_${side}`, `clavicle_${side}`, upperAim, identity],
      [`lowerarm_${side}`, `upperarm_${side}`, lowerAim, upperAim],
      [handName, `lowerarm_${side}`, handAim, lowerAim],
    ] as const) {
      const bone = figureRoot.getObjectByName(bName)
      const q = makeLocalTarget(bName, pName, d, pd)
      if (bone && q) {
        armOverride.push({bone, restQuat: bone.quaternion.clone(), targetQuat: q})
      }
    }

    const outAxis = new THREE.Vector3(sideX, 0, 0)
    for (const finger of ['index', 'middle', 'ring', 'pinky'] as const) {
      const p1 = bindMap.get(`${finger}_01_${side}`)?.pos
      const p2 = bindMap.get(`${finger}_02_${side}`)?.pos
      const adductDelta =
        p1 && p2
          ? new THREE.Quaternion().setFromUnitVectors(p2.clone().sub(p1).normalize(), outAxis)
          : identity.clone()

      let relParentDelta = identity.clone()
      let tuParentDelta = identity.clone()
      let gripParentDelta = identity.clone()
      let parentName = handName
      for (let k = 1; k <= 3; k++) {
        const bName = `${finger}_0${k}_${side}`
        const bone = figureRoot.getObjectByName(bName)
        if (!bone) continue

        const relAngle = sign * (k === 1 ? 0.30 : 0.36)
        const tuAngle = sign * (k === 1 ? 1.56 : k === 2 ? 1.52 : 1.24)
        const gripAngle = sign * (k === 1 ? 1.38 : k === 2 ? 1.44 : 1.16)

        const baseRel = k === 1 ? adductDelta : relParentDelta
        const baseTu = k === 1 ? adductDelta : tuParentDelta
        const baseGrip = k === 1 ? adductDelta : gripParentDelta
        const relDelta = baseRel.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axisZ, relAngle))
        const tuDelta = baseTu.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axisZ, tuAngle))
        const gripDelta = baseGrip.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axisZ, gripAngle))

        const relQ = makeLocalTarget(bName, parentName, relDelta, relParentDelta)
        const tuQ = makeLocalTarget(bName, parentName, tuDelta, tuParentDelta)
        const gripQ = makeLocalTarget(bName, parentName, gripDelta, gripParentDelta)
        if (relQ && tuQ && gripQ) {
          entries.push({
            bone,
            restQuat: bone.quaternion.clone(),
            relaxedQuat: relQ,
            thumbsUpQuat: tuQ,
            gripQuat: gripQ,
          })
        }
        relParentDelta = relDelta
        tuParentDelta = tuDelta
        gripParentDelta = gripDelta
        parentName = bName
      }
    }

    const t1 = bindMap.get(`thumb_01_${side}`)?.pos
    const t2 = bindMap.get(`thumb_02_${side}`)?.pos
    if (t1 && t2) {
      const seg1 = t2.clone().sub(t1).normalize()
      const relAim = new THREE.Quaternion().setFromUnitVectors(
        seg1,
        new THREE.Vector3(sideX * 0.88, -0.10, 0.46).normalize(),
      )
      const gripAim = new THREE.Quaternion().setFromUnitVectors(
        seg1,
        new THREE.Vector3(sideX * 0.86, -0.32, 0.40).normalize(),
      )
      const worldUpThumbInBind = new THREE.Vector3(sideX * 0.08, 0.96, 0.24)
        .normalize()
        .applyQuaternion(handAim.clone().invert())
      const tuAim = new THREE.Quaternion().setFromUnitVectors(seg1, worldUpThumbInBind)

      const b1 = figureRoot.getObjectByName(`thumb_01_${side}`)
      const rq1 = makeLocalTarget(`thumb_01_${side}`, handName, relAim, identity)
      const tq1 = makeLocalTarget(`thumb_01_${side}`, handName, tuAim, identity)
      const gq1 = makeLocalTarget(`thumb_01_${side}`, handName, gripAim, identity)
      if (b1 && rq1 && tq1 && gq1) {
        entries.push({bone: b1, restQuat: b1.quaternion.clone(), relaxedQuat: rq1, thumbsUpQuat: tq1, gripQuat: gq1})
      }

      let rPrev = relAim.clone()
      let tPrev = tuAim.clone()
      let gPrev = gripAim.clone()
      for (const [idx, pName] of [
        [2, `thumb_01_${side}`],
        [3, `thumb_02_${side}`],
      ] as const) {
        const bName = `thumb_0${idx}_${side}`
        const bone = figureRoot.getObjectByName(bName)
        if (!bone) continue
        const rNext = rPrev.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axisZ, sign * 0.18))
        const tNext = tPrev.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axisZ, sign * 0.08))
        const gNext = gPrev.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axisZ, sign * 0.56))
        const rq = makeLocalTarget(bName, pName, rNext, rPrev)
        const tq = makeLocalTarget(bName, pName, tNext, tPrev)
        const gq = makeLocalTarget(bName, pName, gNext, gPrev)
        if (rq && tq && gq) {
          entries.push({bone, restQuat: bone.quaternion.clone(), relaxedQuat: rq, thumbsUpQuat: tq, gripQuat: gq})
        }
        rPrev = rNext
        tPrev = tNext
        gPrev = gNext
      }
    }

    return {fingers: entries, armOverride}
  }

  const leftBuilt = buildSide('l')
  const rightBuilt = buildSide('r')
  return {
    left: leftBuilt.fingers,
    right: rightBuilt.fingers,
    armThumbsUpLeft: leftBuilt.armOverride,
    armThumbsUpRight: rightBuilt.armOverride,
  }
}
