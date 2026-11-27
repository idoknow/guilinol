/**
 * 十字街四个地面楼梯井的地面版：和 B1 室内同一份楼梯几何（stairwell-geometry.ts），
 * 室内坐标生成后按各井口地面高平移，挂在世界场景里。底部平台尽头是关着的卷帘门，换场就在门前完成。
 */
import * as THREE from 'three'
import { SZJ_FRAME, SZJ_STAIRWELLS } from '../contract.ts'
import { SZJ_B1_CEILING_H, SZJ_DEPTH, SZJ_WELLS } from '../frame.ts'
import { createShizijieMaterials, type ShizijieMaterialPack } from './materials.ts'
import {
  buildMergedOrientedBoxes,
  createSzjNosingMaterial,
  createSzjStairBuckets,
  emitSzjStairwell,
  mergeBufferGeometries,
  uvScaleOf,
  type OrientedBoxSpec,
  type SzjStairBuckets,
} from './stairwell-geometry.ts'

export interface SzjSurfaceStairwells {
  readonly group: THREE.Group
  readonly drawCalls: number
  readonly triangles: number
  dispose(): void
}

type BoxKey = Exclude<keyof SzjStairBuckets, 'safetyExit'>

export function createSurfaceStairwells(pack: ShizijieMaterialPack = createShizijieMaterials()): SzjSurfaceStairwells {
  const nosing = createSzjNosingMaterial()
  const materials: Record<BoxKey, THREE.Material> = {
    floorTile: pack.floorCorridorTile,
    ceiling: pack.ceilingGrid,
    dado: pack.stairGranite,
    stairTread: pack.stairTread,
    stairNosing: nosing,
    handrail: pack.handrailSteel,
    canopyTruss: pack.canopyTrussDark,
    canopyGlass: pack.canopyGlassBlue,
    guardrailWhite: pack.canopyHandrailWhite,
    bollardRed: pack.bollardRedReflect,
    shutter: pack.rollerShutterSilver,
  }
  // One bucket set per well so each well can drop to its own street grade after its UVs are laid in B1 space.
  const perWell = SZJ_STAIRWELLS.map(st => {
    const b = createSzjStairBuckets()
    emitSzjStairwell(st, b, { floorY: SZJ_FRAME.indoorFloorY, ceilH: SZJ_B1_CEILING_H, world: true })
    const grade = SZJ_WELLS.find(w => w.id === st.id)?.grade ?? SZJ_FRAME.surfaceY
    return { b, dy: grade - SZJ_DEPTH }
  })

  const group = new THREE.Group()
  group.name = 'szj-surface-stairwells'
  group.position.set(SZJ_FRAME.originWorld.x, 0, SZJ_FRAME.originWorld.z)
  const geometries: THREE.BufferGeometry[] = []
  let triangles = 0
  const add = (name: string, geom: THREE.BufferGeometry, material: THREE.Material) => {
    geom.computeBoundingSphere()
    geometries.push(geom)
    triangles += (geom.index?.count ?? 0) / 3
    const mesh = new THREE.Mesh(geom, material)
    mesh.name = name
    mesh.receiveShadow = true
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    group.add(mesh)
  }
  for (const key of Object.keys(materials) as BoxKey[]) {
    const mat = materials[key]
    const parts = perWell
      .filter(w => w.b[key].length)
      .map(w => buildMergedOrientedBoxes(w.b[key] as OrientedBoxSpec[], uvScaleOf(mat)).geom.translate(0, w.dy, 0))
    if (parts.length) add(`szj-surface-${key}`, mergeBufferGeometries(parts).geom, mat)
  }
  const signs = perWell.flatMap(w => w.b.safetyExit.map(g => g.translate(0, w.dy, 0)))
  if (signs.length) add('szj-surface-safetyExit', mergeBufferGeometries(signs).geom, pack.signAtlasMat)
  group.updateMatrixWorld(true)

  return {
    group,
    drawCalls: group.children.length,
    triangles: Math.round(triangles),
    dispose() {
      group.removeFromParent()
      for (const g of geometries) g.dispose()
      nosing.dispose()
      pack.dispose()
    },
  }
}
