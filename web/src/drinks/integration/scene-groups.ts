import * as THREE from 'three'
import { mainDetail } from '../../look/mirror-layer.ts'
import type { DrinksSiteCandidate } from '../site.ts'
import type { FitDrinksPlotResult } from '../terrain/index.ts'

export interface DrinksFourSceneGroups {
  readonly shopGroup: THREE.Group
  readonly plinthGroup: THREE.Group
  readonly staffGroup: THREE.Group
  readonly npcGroup: THREE.Group
}

export interface DrinksGroupAlignmentReport {
  readonly sameParent: boolean
  readonly parent: THREE.Object3D | null
  readonly maxOriginErrorM: number
  readonly maxSamplePointErrorM: number
  readonly maxYawErrorRad: number
}

const SAMPLE_LOCAL_POINTS: readonly [number, number, number][] = [
  [0, 0, 0],
  [0.2, 0, 2.8],
  [-1.42, 0, 4.38],
  [-1.35, 0.88, -2.35],
  [2.35, 0.96, -0.98],
]

function wrapAngleRad(rad: number): number {
  return Math.atan2(Math.sin(rad), Math.cos(rad))
}

/**
 * 统一同步 `shop`、`terrain.plinthGroup`、`staff`、`npc` 四组的世界位姿：
 * 四组均直接挂在同一世界原点父节点（`scene`）下，各自仅执行一次 `(worldX, plotY, worldZ)` + `worldYaw` 变换，
 * 杜绝二次偏移与叠加旋转。
 */
export function syncDrinksSceneGroups(
  site: Pick<DrinksSiteCandidate, 'worldX' | 'worldZ' | 'worldYaw'>,
  groundY: number,
  groups: DrinksFourSceneGroups,
): void {
  const { shopGroup, plinthGroup, staffGroup, npcGroup } = groups
  for (const g of [shopGroup, plinthGroup, staffGroup, npcGroup]) {
    g.position.set(site.worldX, groundY, site.worldZ)
    g.rotation.set(0, site.worldYaw, 0)
    g.scale.set(1, 1, 1)
    g.updateMatrixWorld(true)
  }
}

export function setDrinksSceneGroupsVisible(groups: DrinksFourSceneGroups, visible: boolean): void {
  groups.shopGroup.visible = visible
  groups.plinthGroup.visible = visible
  groups.staffGroup.visible = visible
  groups.npcGroup.visible = visible
}

/**
 * 包装 `terrain.refit`：无论内部自动贴地还是外部测试直接调用 `terrain.refit(...)`，
 * 重建台基网格后立即补齐 `MAIN_DETAIL_LAYER` 并同步四组高度与矩阵。
 */
export function bindTerrainRefitSync(
  terrain: FitDrinksPlotResult,
  site: Pick<DrinksSiteCandidate, 'worldX' | 'worldZ' | 'worldYaw'>,
  groups: DrinksFourSceneGroups,
  onRefitSynced?: (nextPlotY: number) => void,
): void {
  const rawRefit = terrain.refit.bind(terrain)
  terrain.refit = (nextSampleGroundY?: (x: number, z: number) => number, nextStreetElevationY?: number): void => {
    rawRefit(nextSampleGroundY, nextStreetElevationY)
    mainDetail(terrain.plinthGroup)
    const nextPlotY = terrain.plotY
    syncDrinksSceneGroups(site, nextPlotY, groups)
    onRefitSynced?.(nextPlotY)
  }
}

/**
 * 测量四组在世界空间中的父节点一致性、原点误差、多锚点世界坐标最大误差与朝向误差。
 */
export function measureSceneGroupsAlignment(groups: DrinksFourSceneGroups): DrinksGroupAlignmentReport {
  const list = [groups.shopGroup, groups.plinthGroup, groups.staffGroup, groups.npcGroup]
  for (const g of list) g.updateMatrixWorld(true)

  const firstParent = list[0].parent
  const sameParent = Boolean(firstParent) && list.every(g => g.parent === firstParent)

  const origins = list.map(g => g.getWorldPosition(new THREE.Vector3()))
  let maxOriginErrorM = 0
  for (let i = 0; i < origins.length; i++) {
    for (let j = i + 1; j < origins.length; j++) {
      const d = origins[i]!.distanceTo(origins[j]!)
      if (d > maxOriginErrorM) maxOriginErrorM = d
    }
  }

  let maxSamplePointErrorM = 0
  const tmp = new THREE.Vector3()
  for (const [lx, ly, lz] of SAMPLE_LOCAL_POINTS) {
    const worldPts = list.map(g => g.localToWorld(tmp.set(lx, ly, lz)).clone())
    for (let i = 0; i < worldPts.length; i++) {
      for (let j = i + 1; j < worldPts.length; j++) {
        const d = worldPts[i]!.distanceTo(worldPts[j]!)
        if (d > maxSamplePointErrorM) maxSamplePointErrorM = d
      }
    }
  }

  const yaws = list.map(g => {
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(g.getWorldQuaternion(new THREE.Quaternion()))
    return Math.atan2(dir.x, dir.z)
  })
  let maxYawErrorRad = 0
  for (let i = 0; i < yaws.length; i++) {
    for (let j = i + 1; j < yaws.length; j++) {
      const diff = Math.abs(wrapAngleRad(yaws[i]! - yaws[j]!))
      if (diff > maxYawErrorRad) maxYawErrorRad = diff
    }
  }

  return {
    sameParent,
    parent: firstParent,
    maxOriginErrorM,
    maxSamplePointErrorM,
    maxYawErrorRad,
  }
}
