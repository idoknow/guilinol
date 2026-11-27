/**
 * 十字街楼梯井几何：B1 室内与地面世界共用同一份盒体清单，室内坐标生成，地面按井口地面高平移。
 * 两边网格、UV、材质完全一致，玩家在底部平台换场时看到的楼梯不会跳。
 */
import * as THREE from 'three'
import { SZJ_FRAME, stairLocalToIndoor, type SzjStairwell } from '../contract.ts'
import { SZJ_LANDING } from '../frame.ts'
import { SHIZIJIE_PALETTE, applySignAtlasRect, type SzjSignAtlasSlot } from './palette.ts'

export interface OrientedBoxSpec {
  readonly cx: number
  readonly cy: number
  readonly cz: number
  readonly sx: number
  readonly sy: number
  readonly sz: number
  readonly yaw?: number
  readonly pitch?: number
}

export function buildMergedOrientedBoxes(
  specs: readonly OrientedBoxSpec[],
  uvScale: readonly [number, number] = [1, 1],
): { geom: THREE.BufferGeometry; triangles: number } {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let vertexOffset = 0
  const [su, sv] = uvScale
  const euler = new THREE.Euler(0, 0, 0, 'YXZ')
  const mat4 = new THREE.Matrix4()

  for (const b of specs) {
    if (b.sx <= 0 || b.sy <= 0 || b.sz <= 0) continue
    const box = new THREE.BoxGeometry(b.sx, b.sy, b.sz)
    if (b.yaw || b.pitch) {
      euler.set(b.pitch ?? 0, b.yaw ?? 0, 0, 'YXZ')
      mat4.makeRotationFromEuler(euler)
      box.applyMatrix4(mat4)
    }
    box.translate(b.cx, b.cy, b.cz)

    const pos = box.getAttribute('position')
    const norm = box.getAttribute('normal')
    const idx = box.getIndex()

    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i)
      const py = pos.getY(i)
      const pz = pos.getZ(i)
      const nx = norm.getX(i)
      const ny = norm.getY(i)
      const nz = norm.getZ(i)
      positions.push(px, py, pz)
      normals.push(nx, ny, nz)
      if (Math.abs(ny) > 0.5) {
        uvs.push(px * su, pz * sv)
      } else if (Math.abs(nx) > Math.abs(nz)) {
        uvs.push(pz * su, py * sv)
      } else {
        uvs.push(px * su, py * sv)
      }
    }
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(vertexOffset + idx.getX(i))
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(vertexOffset + i)
    }
    vertexOffset += pos.count
    box.dispose()
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  merged.setIndex(indices)
  merged.computeBoundingSphere()
  return { geom: merged, triangles: Math.floor(indices.length / 3) }
}

export function mergeBufferGeometries(parts: readonly THREE.BufferGeometry[]): {
  geom: THREE.BufferGeometry
  triangles: number
} {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let vertexOffset = 0

  for (const part of parts) {
    const pos = part.getAttribute('position')
    const norm = part.getAttribute('normal')
    const uv = part.getAttribute('uv')
    const idx = part.getIndex()
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i))
      normals.push(norm ? norm.getX(i) : 0, norm ? norm.getY(i) : 1, norm ? norm.getZ(i) : 0)
      uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0)
    }
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(vertexOffset + idx.getX(i))
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(vertexOffset + i)
    }
    vertexOffset += pos.count
    part.dispose()
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  merged.setIndex(indices)
  merged.computeBoundingSphere()
  return { geom: merged, triangles: Math.floor(indices.length / 3) }
}

export function makeSignPlane(
  cx: number,
  cy: number,
  cz: number,
  width: number,
  height: number,
  yawRad: number,
  slot: SzjSignAtlasSlot,
): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, height)
  applySignAtlasRect(g, slot, 2)
  g.rotateY(yawRad)
  g.translate(cx, cy, cz)
  return g
}

export function makeDoubleSidedSignPlanes(
  cx: number,
  cy: number,
  cz: number,
  width: number,
  height: number,
  yawRad: number,
  thickness: number,
  slot: SzjSignAtlasSlot,
): THREE.BufferGeometry[] {
  const sinY = Math.sin(yawRad)
  const cosY = Math.cos(yawRad)
  const halfT = thickness * 0.5 + 0.016
  return [
    makeSignPlane(cx + sinY * halfT, cy, cz + cosY * halfT, width, height, yawRad, slot),
    makeSignPlane(cx - sinY * halfT, cy, cz - cosY * halfT, width, height, yawRad + Math.PI, slot),
  ]
}

/** Texture period (m) stored on a material → box UV scale. */
export function uvScaleOf(mat: THREE.Material): readonly [number, number] {
  const p = (mat.userData?.periodM as readonly [number, number] | undefined) ?? [1, 1]
  return [1 / Math.max(0.1, p[0]), 1 / Math.max(0.1, p[1])]
}

/** Safety-yellow tread nosing (not in the shared pack: it is the only emissive-lipped box). */
export function createSzjNosingMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    name: 'szj_stair_nosing_yellow',
    color: SHIZIJIE_PALETTE.stairNosingYellow.hex,
    emissive: SHIZIJIE_PALETTE.stairNosingYellow.hex,
    emissiveIntensity: 0.34,
    roughness: 0.44,
    metalness: 0.08,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  })
}

/** B1 roller shutter closing the bottom landing (stair-local z = length/2 + SZJ_LANDING.door). */
export const SZJ_STAIR_DOOR = {
  /** Clear opening height (m); the coil housing fills the rest up to the collar ceiling. */
  height: 2.4,
  thickness: 0.06,
  /** Full open/close travel (s). */
  travelS: 0.45,
  /** Opens while the player is within this distance of the door centre (m). */
  triggerM: 2.2,
  /** Passable once the shutter has risen this far (fraction of travel, eased). */
  passOpen: 0.82,
} as const

/** Door centre on the floor, indoor coordinates. */
export function szjDoorCentre(st: SzjStairwell): { x: number; z: number } {
  return stairLocalToIndoor(st, { x: 0, z: st.length * 0.5 + SZJ_LANDING.door })
}

/** Closed shutter as one box (indoor coordinates). */
export function szjShutterBox(st: SzjStairwell, floorY: number): OrientedBoxSpec {
  const c = szjDoorCentre(st)
  const H = SZJ_STAIR_DOOR.height
  return { cx: c.x, cy: floorY + H * 0.5, cz: c.z, sx: st.width, sy: H, sz: SZJ_STAIR_DOOR.thickness, yaw: st.yaw }
}

/** One merged batch per material; indoor-scene and the surface mount map each key to the same material. */
export interface SzjStairBuckets {
  readonly floorTile: OrientedBoxSpec[]
  readonly ceiling: OrientedBoxSpec[]
  readonly dado: OrientedBoxSpec[]
  readonly stairTread: OrientedBoxSpec[]
  readonly stairNosing: OrientedBoxSpec[]
  readonly handrail: OrientedBoxSpec[]
  readonly canopyTruss: OrientedBoxSpec[]
  readonly canopyGlass: OrientedBoxSpec[]
  readonly guardrailWhite: OrientedBoxSpec[]
  readonly bollardRed: OrientedBoxSpec[]
  readonly safetyExit: THREE.BufferGeometry[]
  /** Surface copy only: the closed B1 shutter (indoors each shutter is its own animated mesh). */
  readonly shutter: OrientedBoxSpec[]
}

export function createSzjStairBuckets(): SzjStairBuckets {
  return {
    floorTile: [], ceiling: [], dado: [], stairTread: [], stairNosing: [], handrail: [],
    canopyTruss: [], canopyGlass: [], guardrailWhite: [], bollardRed: [], safetyExit: [], shutter: [],
  }
}

export interface EmitSzjStairwellOptions {
  readonly floorY: number
  readonly ceilH: number
  /**
   * Surface copy: the street already paves the top landing and there is no B1 ceiling plenum or corridor,
   * so the apron, side ceiling collars and wing walls are left out; the bottom landing gets its own floor.
   */
  readonly world?: boolean
  /** B1 only: wing walls joining the granite well to the wider corridor walls. */
  readonly splitWall?: (cx: number, cz: number, sx: number, sz: number, yaw: number) => void
}

/** Pushes one stairwell into the buckets (indoor coordinates); returns the wall safety-exit plaque count. */
export function emitSzjStairwell(st: SzjStairwell, b: SzjStairBuckets, o: EmitSzjStairwellOptions): number {
  const { floorY, ceilH } = o
  let plaques = 0
  const hw = st.width * 0.5
  const hl = st.length * 0.5
  const topLanding = st.profile.landingTop
  const footLanding = st.profile.landingFoot
  const riser = st.profile.riser
  const tread = st.profile.tread
  const count = st.profile.count
  const topY = SZJ_FRAME.depth

  const toWorld = (lx: number, lz: number) => stairLocalToIndoor(st, { x: lx, z: lz })

  if (!o.world) {
    // Top landing slab & open street-level sidewalk plaza apron outside -Z mouth
    const streetApron = toWorld(0, -hl + topLanding * 0.5 - 3.1)
    b.floorTile.push({
      cx: streetApron.x,
      cy: topY - 0.06,
      cz: streetApron.z,
      sx: st.width + 6.4,
      sy: 0.12,
      sz: topLanding + 6.8,
      yaw: st.yaw,
    })

    // Rotated stairwell ceiling perimeter collars sealing shaft opening to ceiling plenum without Z-fighting
    for (const side of [-1, 1] as const) {
      const collarPos = toWorld(side * (hw + 0.96), 0)
      b.ceiling.push({
        cx: collarPos.x,
        cy: floorY + ceilH + 0.068,
        cz: collarPos.z,
        sx: 1.88,
        sy: 0.11,
        sz: st.length + 1.6,
        yaw: st.yaw,
      })
    }
  } else {
    // Bottom landing floor up to the B1 shutter (the street copy has no B1 slab under it).
    const doorLz = hl + SZJ_LANDING.door
    const slab = toWorld(0, (hl - 0.3 + doorLz + 0.2) * 0.5)
    b.floorTile.push({
      cx: slab.x,
      cy: floorY - 0.06,
      cz: slab.z,
      sx: st.width + 0.48,
      sy: 0.12,
      sz: doorLz + 0.2 - (hl - 0.3),
      yaw: st.yaw,
    })
    b.shutter.push(szjShutterBox(st, floorY))
  }
  const footCollar = toWorld(0, hl + 0.95)
  b.ceiling.push({
    cx: footCollar.x,
    cy: floorY + ceilH + 0.068,
    cz: footCollar.z,
    sx: st.width + 3.6,
    sy: 0.11,
    sz: 1.75,
    yaw: st.yaw,
  })

  // 28 physical granite steps + front-lip L-profile safety yellow nosings (+Z front edge so all 28 steps stay crisp from bottom & top)
  const topEdgeLz = -hl + topLanding
  const topLipNose = toWorld(0, topEdgeLz - 0.02)
  const topLipBack = toWorld(0, topEdgeLz - 0.07)
  b.canopyTruss.push({
    cx: topLipBack.x,
    cy: topY + 0.004,
    cz: topLipBack.z,
    sx: st.width - 0.04,
    sy: 0.012,
    sz: 0.044,
    yaw: st.yaw,
  })
  b.stairNosing.push({
    cx: topLipNose.x,
    cy: topY - 0.011,
    cz: topLipNose.z,
    sx: st.width - 0.06,
    sy: 0.038,
    sz: 0.056,
    yaw: st.yaw,
  })

  for (let i = 0; i < count; i++) {
    const stepTopY = topY - (i + 1) * riser
    const lzFront = -hl + topLanding + (i + 1) * tread
    const lzCenter = lzFront - tread * 0.5
    const pStep = toWorld(0, lzCenter - 0.006)
    const stepH = riser + 0.08
    b.stairTread.push({
      cx: pStep.x,
      cy: stepTopY - stepH * 0.5,
      cz: pStep.z,
      sx: st.width,
      sy: stepH,
      sz: tread + 0.012,
      yaw: st.yaw,
    })

    const pBack = toWorld(0, lzFront - 0.07)
    b.canopyTruss.push({
      cx: pBack.x,
      cy: stepTopY + 0.004,
      cz: pBack.z,
      sx: st.width - 0.04,
      sy: 0.012,
      sz: 0.044,
      yaw: st.yaw,
    })

    const pNose = toWorld(0, lzFront - 0.02)
    b.stairNosing.push({
      cx: pNose.x,
      cy: stepTopY - 0.011,
      cz: pNose.z,
      sx: st.width - 0.06,
      sy: 0.038,
      sz: 0.056,
      yaw: st.yaw,
    })
  }

  // Below-grade granite retaining walls + low 0.22m street curb & B1 inner throat spandrel
  const wallThick = 0.24
  const curbH = 0.22
  const retainTopY = topY + curbH
  const totalStairLen = st.length + footLanding + 0.6
  const midWallLz = (-hl - 0.4 + hl + footLanding + 0.2) * 0.5
  const wallTopY = topY + 2.75
  const spandrelLen = footLanding + 2.4
  const spandrelMidLz = hl + footLanding + 0.2 - spandrelLen * 0.5
  for (const side of [-1, 1] as const) {
    const pw = toWorld(side * (hw + wallThick * 0.5), midWallLz)
    b.dado.push({
      cx: pw.x,
      cy: retainTopY * 0.5,
      cz: pw.z,
      sx: wallThick,
      sy: retainTopY,
      sz: totalStairLen,
      yaw: st.yaw,
    })
    const spPos = toWorld(side * (hw + wallThick * 0.5), spandrelMidLz)
    b.dado.push({
      cx: spPos.x,
      cy: retainTopY + (wallTopY - retainTopY) * 0.5,
      cz: spPos.z,
      sx: wallThick,
      sy: wallTopY - retainTopY,
      sz: spandrelLen,
      yaw: st.yaw,
    })
  }

  // Prominent above-grade white protective balustrades + street-mouth return wing rails
  const railH = 0.88
  const sideRailLen = st.length * 0.82
  const sideRailMidLz = -hl - 0.18 + sideRailLen * 0.5
  for (const side of [-1, 1] as const) {
    const rx = side * (hw + 0.04)
    const railCenter = toWorld(rx, sideRailMidLz)
    b.guardrailWhite.push(
      {
        cx: railCenter.x,
        cy: retainTopY + railH - 0.035,
        cz: railCenter.z,
        sx: 0.09,
        sy: 0.07,
        sz: sideRailLen,
        yaw: st.yaw,
      },
      {
        cx: railCenter.x,
        cy: retainTopY + railH * 0.56,
        cz: railCenter.z,
        sx: 0.06,
        sy: 0.05,
        sz: sideRailLen,
        yaw: st.yaw,
      },
      {
        cx: railCenter.x,
        cy: retainTopY + railH * 0.24,
        cz: railCenter.z,
        sx: 0.05,
        sy: 0.04,
        sz: sideRailLen,
        yaw: st.yaw,
      },
    )
    for (let pi = 0; pi < 8; pi++) {
      const zp = -hl - 0.16 + (pi / 7) * (sideRailLen - 0.08)
      const postPos = toWorld(rx, zp)
      b.guardrailWhite.push({
        cx: postPos.x,
        cy: retainTopY + railH * 0.5,
        cz: postPos.z,
        sx: 0.075,
        sy: railH,
        sz: 0.075,
        yaw: st.yaw,
      })
    }

    // Street-mouth return wing white balustrade visibly framing left & right corners of top landing
    const wingW = 0.72
    const wingCenterLx = side * (hw - 0.24 + wingW * 0.5)
    const wingCenter = toWorld(wingCenterLx, -hl - 0.18)
    const innerPost = toWorld(side * (hw - 0.24), -hl - 0.18)
    b.guardrailWhite.push(
      {
        cx: wingCenter.x,
        cy: retainTopY + railH - 0.035,
        cz: wingCenter.z,
        sx: wingW,
        sy: 0.07,
        sz: 0.09,
        yaw: st.yaw,
      },
      {
        cx: wingCenter.x,
        cy: retainTopY + railH * 0.56,
        cz: wingCenter.z,
        sx: wingW,
        sy: 0.05,
        sz: 0.06,
        yaw: st.yaw,
      },
      {
        cx: innerPost.x,
        cy: retainTopY + railH * 0.5,
        cz: innerPost.z,
        sx: 0.075,
        sy: railH,
        sz: 0.075,
        yaw: st.yaw,
      },
    )
  }

  // Steel canopy columns, transverse purlins & longitudinal rafters supporting sloped blue-glass canopy roof
  const canopyFrontLz = -hl - 0.55
  const canopyBackLz = hl * 0.62
  const canopyLen = canopyBackLz - canopyFrontLz
  const canopyMidLz = (canopyFrontLz + canopyBackLz) * 0.5
  const frontRoofY = topY + 2.24
  const backRoofY = topY + 1.66
  const roofSpanY = frontRoofY - backRoofY
  const canopySlope = Math.atan2(roofSpanY, canopyLen)
  const canopyDiagLen = Math.hypot(canopyLen, roofSpanY)
  const canopyMidY = (frontRoofY + backRoofY) * 0.5

  for (const frac of [0, 0.25, 0.5, 0.75, 1] as const) {
    const zc = canopyFrontLz + frac * canopyLen
    const colTopY = frontRoofY - frac * roofSpanY
    const colH = colTopY - retainTopY
    for (const side of [-1, 1] as const) {
      const cPos = toWorld(side * (hw + wallThick * 0.5), zc)
      b.canopyTruss.push({
        cx: cPos.x,
        cy: retainTopY + colH * 0.5,
        cz: cPos.z,
        sx: 0.11,
        sy: colH,
        sz: 0.11,
        yaw: st.yaw,
      })
    }
    const purlinPos = toWorld(0, zc)
    b.canopyTruss.push({
      cx: purlinPos.x,
      cy: colTopY - 0.045,
      cz: purlinPos.z,
      sx: st.width + wallThick * 2 + 0.32,
      sy: 0.09,
      sz: 0.11,
      yaw: st.yaw,
    })
  }

  for (const rafterLx of [-hw * 0.66, 0, hw * 0.66] as const) {
    const rPos = toWorld(rafterLx, canopyMidLz)
    b.canopyTruss.push({
      cx: rPos.x,
      cy: canopyMidY - 0.04,
      cz: rPos.z,
      sx: 0.08,
      sy: 0.08,
      sz: canopyDiagLen,
      yaw: st.yaw,
      pitch: canopySlope,
    })
  }

  // Sloped stainless steel double handrails + 7 vertical stanchion posts & wall-mount brackets per side
  const flightLen = count * tread
  const flightDiag = Math.hypot(flightLen, topY - floorY)
  const flightPitch = Math.atan2(topY - floorY, flightLen)
  const midFlightLz = -hl + topLanding + flightLen * 0.5
  const midFlightY = (topY + floorY) * 0.5
  const postStepIndices = [0, 4, 9, 14, 18, 23, 27] as const
  for (const side of [-1, 1] as const) {
    const railLx = side * (hw - 0.08)
    const pr = toWorld(railLx, midFlightLz)
    b.handrail.push(
      {
        cx: pr.x,
        cy: midFlightY + 0.92,
        cz: pr.z,
        sx: 0.05,
        sy: 0.05,
        sz: flightDiag,
        yaw: st.yaw,
        pitch: flightPitch,
      },
      {
        cx: pr.x,
        cy: midFlightY + 0.54,
        cz: pr.z,
        sx: 0.035,
        sy: 0.035,
        sz: flightDiag,
        yaw: st.yaw,
        pitch: flightPitch,
      },
    )
    for (const siStep of postStepIndices) {
      const sTopY = topY - (siStep + 1) * riser
      const sLz = -hl + topLanding + (siStep + 0.5) * tread
      const postWorld = toWorld(railLx, sLz)
      const postH = 0.92 + riser * 0.5
      const bracketWorld = toWorld(side * (hw - 0.04), sLz)
      b.handrail.push(
        {
          cx: postWorld.x,
          cy: sTopY + postH * 0.5,
          cz: postWorld.z,
          sx: 0.042,
          sy: postH,
          sz: 0.042,
          yaw: st.yaw,
        },
        {
          cx: bracketWorld.x,
          cy: sTopY + 0.9,
          cz: bracketWorld.z,
          sx: 0.1,
          sy: 0.04,
          sz: 0.045,
          yaw: st.yaw,
        },
        {
          cx: bracketWorld.x,
          cy: sTopY + 0.52,
          cz: bracketWorld.z,
          sx: 0.1,
          sy: 0.035,
          sz: 0.04,
          yaw: st.yaw,
        },
      )
    }
  }

  // Open sloped blue-glass surface canopy roof + street fascia + 3 red-and-white striped safety bollards
  const canopyCenter = toWorld(0, canopyMidLz)
  b.canopyGlass.push({
    cx: canopyCenter.x,
    cy: canopyMidY + 0.02,
    cz: canopyCenter.z,
    sx: st.width + wallThick * 2 + 0.36,
    sy: 0.05,
    sz: canopyDiagLen + 0.2,
    yaw: st.yaw,
    pitch: canopySlope,
  })

  const mouthBeamPos = toWorld(0, canopyFrontLz)
  b.canopyTruss.push({
    cx: mouthBeamPos.x,
    cy: frontRoofY - 0.14,
    cz: mouthBeamPos.z,
    sx: st.width + wallThick * 2 + 0.34,
    sy: 0.24,
    sz: 0.13,
    yaw: st.yaw,
  })
  for (const bx of [-0.88, 0, 0.88] as const) {
    const bPos = toWorld(bx, -hl - 0.42)
    b.handrail.push({
      cx: bPos.x,
      cy: topY + 0.46,
      cz: bPos.z,
      sx: 0.14,
      sy: 0.92,
      sz: 0.14,
      yaw: st.yaw,
    })
    b.bollardRed.push(
      {
        cx: bPos.x,
        cy: topY + 0.32,
        cz: bPos.z,
        sx: 0.156,
        sy: 0.18,
        sz: 0.156,
        yaw: st.yaw,
      },
      {
        cx: bPos.x,
        cy: topY + 0.72,
        cz: bPos.z,
        sx: 0.156,
        sy: 0.18,
        sz: 0.156,
        yaw: st.yaw,
      },
    )
    b.guardrailWhite.push(
      {
        cx: bPos.x,
        cy: topY + 0.52,
        cz: bPos.z,
        sx: 0.152,
        sy: 0.15,
        sz: 0.152,
        yaw: st.yaw,
      },
      {
        cx: bPos.x,
        cy: topY + 0.87,
        cz: bPos.z,
        sx: 0.152,
        sy: 0.1,
        sz: 0.152,
        yaw: st.yaw,
      },
    )
  }

  // Overhead structural soffit header at B1 stairwell throat (wayfinding signs inside B1 come 100% from wayfinding.signs)
  const portalPos = toWorld(0, hl + 0.15)
  const soffitH = Math.max(0.45, wallTopY - ceilH)
  b.canopyTruss.push({
    cx: portalPos.x,
    cy: ceilH + soffitH * 0.5 - 0.04,
    cz: portalPos.z,
    sx: st.width + wallThick * 2,
    sy: soffitH + 0.12,
    sz: 0.24,
    yaw: st.yaw,
  })

  // B1 roller shutter at the end of the bottom landing: coil housing up to the collar ceiling + two guide rails.
  const doorLz = hl + SZJ_LANDING.door
  const housing = toWorld(0, doorLz)
  const housingH = floorY + ceilH + 0.068 - (floorY + SZJ_STAIR_DOOR.height)
  b.canopyTruss.push({
    cx: housing.x,
    cy: floorY + SZJ_STAIR_DOOR.height + housingH * 0.5,
    cz: housing.z,
    sx: st.width + wallThick * 2,
    sy: housingH,
    sz: 0.32,
    yaw: st.yaw,
  })
  for (const side of [-1, 1] as const) {
    const rail = toWorld(side * (hw - 0.03), doorLz)
    b.handrail.push({
      cx: rail.x,
      cy: floorY + SZJ_STAIR_DOOR.height * 0.5,
      cz: rail.z,
      sx: 0.06,
      sy: SZJ_STAIR_DOOR.height,
      sz: 0.14,
      yaw: st.yaw,
    })
  }

  // Wing wall seals bridging narrower stairwell granite walls to wider entry corridor walls
  for (const side of [-1, 1] as const) {
    const wingPos = toWorld(side * (hw + wallThick + 0.52), hl + 0.08)
    o.splitWall?.(wingPos.x, wingPos.z, 1.06, 0.22, st.yaw)
  }

  // Mid-flight stairwell safety/caution bar (green safetyExit + yellow stairCaution) with steel cross-beam & 4 rods
  const midLz = -0.35
  const midSignPos = toWorld(0, midLz)
  const midSignY = 4.44
  const midCrossBeamY = 5.18
  const midRoofFrac = Math.max(0, Math.min(1, (midLz - canopyFrontLz) / canopyLen))
  const midRoofY = frontRoofY - midRoofFrac * roofSpanY
  const midRodBottomY = midSignY + 0.2
  const midRodH = Math.max(0.25, midRoofY - midRodBottomY)
  b.canopyTruss.push(
    {
      cx: midSignPos.x,
      cy: midSignY,
      cz: midSignPos.z,
      sx: st.width - 0.14,
      sy: 0.4,
      sz: 0.08,
      yaw: st.yaw,
    },
    {
      cx: midSignPos.x,
      cy: midCrossBeamY,
      cz: midSignPos.z,
      sx: st.width + wallThick * 2,
      sy: 0.095,
      sz: 0.11,
      yaw: st.yaw,
    },
  )
  for (const rodLx of [-1.1, -0.34, 0.38, 1.1] as const) {
    const mRod = toWorld(rodLx, midLz)
    b.canopyTruss.push({
      cx: mRod.x,
      cy: midRodBottomY + midRodH * 0.5,
      cz: mRod.z,
      sx: 0.065,
      sy: midRodH,
      sz: 0.065,
      yaw: st.yaw,
    })
  }
  const midLeft = toWorld(-0.96, midLz)
  const midCenter = toWorld(0.04, midLz)
  const midRight = toWorld(0.96, midLz)
  b.safetyExit.push(
    ...makeDoubleSidedSignPlanes(midLeft.x, midSignY, midLeft.z, 1.08, 0.38, st.yaw, 0.08, 'safetyExit'),
    ...makeDoubleSidedSignPlanes(midCenter.x, midSignY, midCenter.z, 0.78, 0.38, st.yaw, 0.08, 'stairCaution'),
    ...makeDoubleSidedSignPlanes(midRight.x, midSignY, midRight.z, 0.9, 0.38, st.yaw, 0.08, 'safetyExit'),
  )

  // Wall-mounted backlit green safetyExit plaques along lower stair granite walls (+0.039m normal offset)
  for (const side of [-1, 1] as const) {
    const wallSignPos = toWorld(side * (hw - 0.03), hl - 1.1)
    const wallYaw = st.yaw + (side > 0 ? -Math.PI * 0.5 : Math.PI * 0.5)
    const wNormX = Math.sin(wallYaw)
    const wNormZ = Math.cos(wallYaw)
    const wFrontOff = 0.039
    b.canopyTruss.push({
      cx: wallSignPos.x,
      cy: floorY + 1.85,
      cz: wallSignPos.z,
      sx: 0.92,
      sy: 0.34,
      sz: 0.05,
      yaw: wallYaw,
    })
    b.safetyExit.push(
      makeSignPlane(
        wallSignPos.x + wNormX * wFrontOff,
        floorY + 1.85,
        wallSignPos.z + wNormZ * wFrontOff,
        0.86,
        0.3,
        wallYaw,
        'safetyExit',
      ),
    )
    plaques += 1
  }

  return plaques
}
