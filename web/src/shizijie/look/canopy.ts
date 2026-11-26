/**
 * 十字街 4 处地面下沉楼梯井入口罩几何生成器（路线 A：零挖地，地面只放入口罩）。
 *
 * 对齐 web/src/shizijie/contract.ts `SZJ_STAIRWELLS`：
 * - `mesh/group.name = st.pipelineId`（`shizijie_stair_nw` / `ne` / `se` / `sw`）。
 * - 造型对照 shizijie-ref-pack 及 fetch_city_ref.py 补空全景：
 *   粗面花岗岩三围矮墙、白色烤漆防护栏、深灰黑钢斜坡三角架 + 灰蓝夹胶玻璃人字折线顶、
 *   红白警示防电驴立柱阵列（留足正中人行净宽）与出口门头/独立“地下通道 TUNNEL ↓”导视牌。
 */

import * as THREE from 'three'
import { SZJ_STAIRWELLS, type SzjStairwell } from '../contract.ts'
import { applySignAtlasRect, getStairExitSignSlot } from './palette.ts'
import type { ShizijieMaterialPack } from './materials.ts'

export interface SurfaceHoodBuildOptions {
  /** true 时按 world=(x, groundY, z) 落位；false 按 indoor 坐标 y=0 落位 */
  readonly worldSpace?: boolean
}

export function createStairwellHood(
  st: SzjStairwell,
  pack: ShizijieMaterialPack,
  opts: SurfaceHoodBuildOptions = {},
): THREE.Group {
  const worldSpace = opts.worldSpace ?? true
  const group = new THREE.Group()
  group.name = st.pipelineId
  const pos = worldSpace ? st.world : st.indoor
  group.position.set(pos.x, worldSpace ? st.groundY : 0, pos.z)
  group.rotation.y = st.yaw

  const w = st.width
  const len = st.length
  const hw = w * 0.5
  const hl = len * 0.5
  const wallT = 0.24
  const curbH = 0.54
  const railH = 0.52

  const addBox = (
    gx: number,
    gy: number,
    gz: number,
    bw: number,
    bh: number,
    bd: number,
    mat: THREE.Material,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat)
    mesh.position.set(gx, gy + bh * 0.5, gz)
    group.add(mesh)
    return mesh
  }

  // 三围花岗岩矮墙基座（-Z 入口保持敞开，+Z 为楼梯深端闭合端；底部下延 0.12m 抵消微坡路缘防浮空）
  const skirtDepth = 0.12
  addBox(-hw - wallT * 0.5, -skirtDepth, 0, wallT, curbH + skirtDepth, len + wallT, pack.stairGranite)
  addBox(hw + wallT * 0.5, -skirtDepth, 0, wallT, curbH + skirtDepth, len + wallT, pack.stairGranite)
  addBox(0, -skirtDepth, hl + wallT * 0.5, w + wallT * 2, curbH + 0.48 + skirtDepth, wallT, pack.stairGranite)

  // 两侧白色烤漆方管防护栏 + 钢柱
  for (const sx of [-hw - wallT * 0.5, hw + wallT * 0.5]) {
    addBox(sx, curbH + railH - 0.06, 0, 0.08, 0.06, len + wallT, pack.canopyHandrailWhite)
    addBox(sx, curbH + railH * 0.48, 0, 0.05, 0.04, len, pack.canopyHandrailWhite)
    for (let i = 0; i < 5; i++) {
      const zp = -hl + 0.2 + (i / 4) * (len - 0.4)
      addBox(sx, curbH, zp, 0.07, railH, 0.07, pack.canopyHandrailWhite)
    }
  }

  // 斜坡灰蓝夹胶玻璃雨棚与闭合深灰钢构桁架（两点精确矢量连杆，零悬空端头）
  const upVec = new THREE.Vector3(0, 1, 0)
  const addStrut = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    wThick = 0.06,
    dThick = 0.06,
  ): void => {
    const a = new THREE.Vector3(ax, ay, az)
    const b = new THREE.Vector3(bx, by, bz)
    const dir = b.clone().sub(a)
    const dist = dir.length()
    if (dist < 1e-4) return
    const strut = new THREE.Mesh(new THREE.BoxGeometry(wThick, dist, dThick), pack.canopyTrussDark)
    strut.position.copy(a).addScaledVector(dir, 0.5)
    strut.quaternion.setFromUnitVectors(upVec, dir.normalize())
    group.add(strut)
  }

  const frontY = 3.16
  const backY = 2.26
  const spanY = frontY - backY
  const canopyLen = len + 0.7
  const slopeAngle = Math.atan2(spanY, canopyLen)
  const colFracs = [0.06, 0.36, 0.68, 0.96]
  for (const t of colFracs) {
    const zc = -hl + t * len
    const topY = frontY - t * spanY
    for (const sx of [-hw - wallT * 0.5, hw + wallT * 0.5]) {
      addBox(sx, curbH, zc, 0.12, topY - curbH - 0.02, 0.12, pack.canopyTrussDark)
      const inSign = -Math.sign(sx)
      addStrut(sx, topY - 0.58, zc, sx + inSign * 0.58, topY - 0.04, zc, 0.055, 0.055)
    }
    const purlin = new THREE.Mesh(new THREE.BoxGeometry(w + wallT * 2 + 0.32, 0.08, 0.09), pack.canopyTrussDark)
    purlin.position.set(0, topY - 0.04, zc)
    group.add(purlin)
  }

  // 两侧斜坡纵梁贯通各立柱顶端与前/后悬挑檐口，形成完整钢架屋面枠
  const frontTopY = frontY - 0.04 + 0.35 * (spanY / len)
  const backTopY = backY - 0.04 - 0.35 * (spanY / len)
  for (const sx of [-hw - wallT * 0.5, hw + wallT * 0.5]) {
    addStrut(sx, frontTopY, -hl - 0.35, sx, backTopY, hl + 0.35, 0.09, 0.09)
  }

  const canopyRoof = new THREE.Mesh(
    new THREE.PlaneGeometry(w + wallT * 2 + 0.36, canopyLen),
    pack.canopyGlassBlue,
  )
  canopyRoof.position.set(0, (frontY + backY) * 0.5, 0)
  canopyRoof.rotation.x = -Math.PI * 0.5 + slopeAngle
  group.add(canopyRoof)

  // 门头横梁导视牌（宽扁比匹配图集子格）
  addBox(0, frontY - 0.54, -hl - 0.22, w + wallT * 2 + 0.3, 0.52, 0.14, pack.canopyTrussDark)
  const portalGeo = applySignAtlasRect(new THREE.PlaneGeometry(2.4, 0.48), getStairExitSignSlot(st.id))
  const portalFace = new THREE.Mesh(portalGeo, pack.signAtlasMat)
  portalFace.position.set(0, frontY - 0.28, -hl - 0.296)
  portalFace.rotation.y = Math.PI
  group.add(portalFace)

  // 入口一侧双立柱横幅“地下通道 · TUNNEL ↓”导视立牌（前后双单面贴片+实心金属盒，3.85:1 对齐图集槽位）
  const totemX = -hw - 0.72
  const totemZ = -hl - 0.38
  addBox(totemX - 0.48, -skirtDepth, totemZ, 0.06, 1.88 + skirtDepth, 0.06, pack.canopyTrussDark)
  addBox(totemX + 0.48, -skirtDepth, totemZ, 0.06, 1.88 + skirtDepth, 0.06, pack.canopyTrussDark)
  addBox(totemX, 1.48, totemZ, 1.04, 0.30, 0.10, pack.canopyTrussDark)
  const totemGeo = applySignAtlasRect(new THREE.PlaneGeometry(1.0, 0.26), 'canopyHeader')
  const totemFace = new THREE.Mesh(totemGeo, pack.signAtlasMat)
  totemFace.position.set(totemX, 1.63, totemZ - 0.056)
  totemFace.rotation.y = Math.PI
  group.add(totemFace)
  const totemBack = new THREE.Mesh(totemGeo.clone(), pack.signAtlasMat)
  totemBack.position.set(totemX, 1.63, totemZ + 0.056)
  group.add(totemBack)

  // 口部对称 4 根禁入电驴反光警示防撞柱（两侧拦车、正中留 ~0.96m 通道防走入穿模；底座埋深抵消路面坡度）
  const outerBollardX = Math.min(1.12, hw - 0.25)
  for (const bx of [-outerBollardX, -0.48, 0.48, outerBollardX]) {
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.085, 0.56 + skirtDepth, 12),
      pack.handrailSteel,
    )
    shaft.name = 'szj_bollard_shaft'
    shaft.position.set(bx, (0.56 - skirtDepth) * 0.5, -hl - 0.36)
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.12, 12), pack.canopyHandrailWhite)
    collar.position.set(bx, 0.62, -hl - 0.36)
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.18, 12), pack.bollardRedReflect)
    cap.position.set(bx, 0.77, -hl - 0.36)
    group.add(shaft, collar, cap)
  }

  return group
}

export function createSurfaceStairwellHoods(
  pack: ShizijieMaterialPack,
  opts: SurfaceHoodBuildOptions = {},
): THREE.Group {
  const root = new THREE.Group()
  root.name = 'shizijie_surface_stairwell_hoods'
  for (const st of SZJ_STAIRWELLS) {
    root.add(createStairwellHood(st, pack, opts))
  }
  return root
}
