import * as THREE from 'three'
import type { ObstacleBox, ObstacleVolumeSpec } from '../../walk/obstacle-volumes.ts'
import { DRINKS_SHOP_DOORWAY, DRINKS_SHOP_INTERIOR } from '../shop/index.ts'
import { worldToShopLocal, type DrinksSiteCandidate } from '../site.ts'

export const DRINKS_OBSTACLE_VOLUME_ID = 'wangcheng_drinks_shop'

export interface ObstacleAwareWalker {
  syncObstacleVolume?: (spec: ObstacleVolumeSpec) => void
  removeObstacleVolume?: (id: string) => void
}

export interface HostWorldBridgeOptions {
  readonly scene: THREE.Scene
  readonly site: DrinksSiteCandidate
  readonly getGroundY: () => number
  readonly getWalker: () => ObstacleAwareWalker | null | undefined
  /** 仅挂载在店铺根节点以作排除判定 */
  readonly excludedRoots: readonly THREE.Object3D[]
}

export interface HostWorldBridge {
  sync(visualActive: boolean): void
  dispose(): void
}

interface CarvedMeshRecord {
  readonly mesh: THREE.Mesh
  readonly originalGeometry: THREE.BufferGeometry
  readonly carvedGeometry: THREE.BufferGeometry
}

/**
 * 构建王城蜜雪冰城物理碰撞与承重台面体积：
 * 1) `floor:plinth`：在 `[-0.24, -0.005]` 铺设与解放东路人行道齐平的承重薄板，消除北侧 4.3m DEM 凹坑坠落，
 *    且因 `maxY < 0` 不会触发 `resolveObstacleVolumesStep` 水平阻挡；
 * 2) 外墙与前立面幕墙精确留出 `x ∈ [-1.25, +1.65]`（净宽 2.90m，适配 2.80m 双开门洞）的无障碍入口；
 * 3) 前台点单取餐吧台与水吧岛台保留两侧宽敞员工通道，防止穿模同时保证全工位顺畅可达。
 */
export function buildDrinksShopObstacleVolume(
  site: Pick<DrinksSiteCandidate, 'worldX' | 'worldZ' | 'worldYaw'>,
  groundY: number,
): ObstacleVolumeSpec {
  const inMinX = DRINKS_SHOP_INTERIOR.minX
  const inMaxX = DRINKS_SHOP_INTERIOR.maxX
  const inMinZ = DRINKS_SHOP_INTERIOR.minZ
  const doorZ = DRINKS_SHOP_DOORWAY.z
  const doorMinX = DRINKS_SHOP_DOORWAY.minX - 0.05
  const doorMaxX = DRINKS_SHOP_DOORWAY.maxX + 0.05

  const boxes: ObstacleBox[] = [
    // 室内与门前外摆齐平承重板（消除王城北侧 4.3m DEM 凹坑坠落）
    { minX: -7.4, maxX: 7.4, minZ: -6.8, maxZ: 5.5, minY: -0.24, maxY: -0.005, label: 'floor:plinth' },
    // 东西侧翼缓坡过渡托板
    { minX: -12.0, maxX: 12.0, minZ: 3.4, maxZ: 5.8, minY: -0.28, maxY: -0.02, label: 'floor:apron' },
    // 建筑外围实心墙（门洞 [-1.25, +1.65] 敞开）
    { minX: inMinX - 0.3, maxX: inMinX, minZ: inMinZ - 0.3, maxZ: doorZ + 0.2, minY: -0.4, maxY: 6.0, label: 'wall:west' },
    { minX: inMaxX, maxX: inMaxX + 0.3, minZ: inMinZ - 0.3, maxZ: doorZ + 0.2, minY: -0.4, maxY: 6.0, label: 'wall:east' },
    { minX: inMinX - 0.3, maxX: inMaxX + 0.3, minZ: inMinZ - 0.3, maxZ: inMinZ, minY: -0.4, maxY: 6.0, label: 'wall:back' },
    { minX: inMinX - 0.3, maxX: doorMinX, minZ: doorZ - 0.12, maxZ: doorZ + 0.16, minY: -0.4, maxY: 6.0, label: 'glass:front-west' },
    { minX: doorMaxX, maxX: inMaxX + 0.3, minZ: doorZ - 0.12, maxZ: doorZ + 0.16, minY: -0.4, maxY: 6.0, label: 'glass:front-east' },
    { minX: doorMinX, maxX: doorMaxX, minZ: doorZ - 0.12, maxZ: doorZ + 0.16, minY: DRINKS_SHOP_DOORWAY.heightM, maxY: 6.0, label: 'door:lintel' },
    // 前台收银取餐吧台（x ∈ [-3.65, +4.45], z ∈ [-0.76, -0.16]，西侧 [-6.5, -3.7] 与东侧 [4.5, 6.5] 留出宽敞员工通道）
    { minX: -3.65, maxX: 4.45, minZ: -0.76, maxZ: -0.16, minY: 0.02, maxY: 1.05, label: 'counter:front' },
    // 中央水吧岛台（x ∈ [-3.75, +4.35], z ∈ [-3.60, -2.84]，前侧 z ∈ [-2.84, -0.76] 为 2.08m 宽员工操作走廊）
    { minX: -3.75, maxX: 4.35, minZ: -3.6, maxZ: -2.84, minY: 0.02, maxY: 1.05, label: 'counter:prep-island' },
  ]

  return {
    id: DRINKS_OBSTACLE_VOLUME_ID,
    origin: [site.worldX, groundY, site.worldZ],
    rotationY: site.worldYaw,
    boxes,
  }
}

/**
 * 在局部范围内剔除旧 `wangcheng_mall` 地标与 1:1 蜜雪旗舰裙房重叠的三角面（视觉+碰撞），
 * 防止旧商厦 7m 实心米黄裙房墙横切蜜雪水吧（z ≈ -1.15m）并阻断员工走向制作台；
 * `dispose()` 时 100% 无损恢复原几何体。
 */
function carveOverlappingTriangles(
  geometry: THREE.BufferGeometry,
  meshMatrixWorld: THREE.Matrix4,
  site: DrinksSiteCandidate,
  groundY: number,
): THREE.BufferGeometry | null {
  const posAttr = geometry.getAttribute('position')
  if (!posAttr || posAttr.count < 3) return null

  const vWorld = new THREE.Vector3()
  const isInsideCarveBox = (vertIdx: number): boolean => {
    vWorld.fromBufferAttribute(posAttr, vertIdx).applyMatrix4(meshMatrixWorld)
    const local = worldToShopLocal(site, vWorld.x, vWorld.z)
    const relY = vWorld.y - groundY
    // 仅裁剪王城西北转角蜜雪 1:1 复刻体量覆盖区，保留王城商厦南向与东翼主楼体
    return local.x >= -7.4 && local.x <= 8.2 && local.z >= -6.8 && local.z <= 5.8 && relY >= -6.0 && relY <= 27.0
  }

  const indexAttr = geometry.index
  const triCount = indexAttr ? Math.floor(indexAttr.count / 3) : Math.floor(posAttr.count / 3)
  const keptIndices: number[] = []
  let removedCount = 0

  for (let t = 0; t < triCount; t++) {
    const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3
    const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1
    const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2
    if (isInsideCarveBox(i0) || isInsideCarveBox(i1) || isInsideCarveBox(i2)) {
      removedCount++
      continue
    }
    keptIndices.push(i0, i1, i2)
  }

  if (removedCount === 0) return null
  const cloned = geometry.clone()
  cloned.setIndex(keptIndices)
  return cloned
}

export function createDrinksHostWorldBridge(opts: HostWorldBridgeOptions): HostWorldBridge {
  const excluded = new Set<THREE.Object3D>(opts.excludedRoots)
  let boundWalker: ObstacleAwareWalker | null = null
  let lastVolumeKey = ''

  let carvedRoot: THREE.Object3D | null = null
  let savedRootPos: THREE.Vector3 | null = null
  let physicsEvictPending = false
  const carvedRecords: CarvedMeshRecord[] = []
  let disposed = false

  function findHostWangchengRoot(): THREE.Object3D | null {
    if (opts.site.id !== 'wangcheng_mall') return null
    for (const child of opts.scene.children) {
      if (excluded.has(child)) continue
      const dx = child.position.x - opts.site.centroidWorldX
      const dz = child.position.z - opts.site.centroidWorldZ
      if (Math.hypot(dx, dz) > 12) continue
      let hasLandmarkStructure = false
      child.traverse(node => {
        if (hasLandmarkStructure) return
        if (/^(lod0|lod1|collision)/i.test(node.name)) hasLandmarkStructure = true
      })
      if (hasLandmarkStructure) return child
    }
    return null
  }

  function restoreCarvedLandmark(): void {
    if (carvedRoot && savedRootPos && physicsEvictPending) {
      carvedRoot.position.copy(savedRootPos)
      carvedRoot.updateMatrixWorld(true)
    }
    physicsEvictPending = false
    for (const rec of carvedRecords) {
      rec.mesh.geometry = rec.originalGeometry
      rec.carvedGeometry.dispose()
    }
    carvedRecords.length = 0
    carvedRoot = null
    savedRootPos = null
  }

  function ensureHostLandmarkCarved(): void {
    if (opts.site.id !== 'wangcheng_mall') return
    if (carvedRoot && !carvedRoot.parent) {
      restoreCarvedLandmark()
    }
    if (carvedRoot) {
      if (physicsEvictPending && savedRootPos) {
        // 第 2 拍：恢复地标原位，让 walk/physics.ts 用裁剪后的 collision_* 重建无阻挡碰撞体
        carvedRoot.position.copy(savedRootPos)
        carvedRoot.updateMatrixWorld(true)
        physicsEvictPending = false
      }
      return
    }

    const candidate = findHostWangchengRoot()
    if (!candidate) return

    candidate.updateMatrixWorld(true)
    const groundY = opts.getGroundY()
    candidate.traverse(node => {
      if (!(node instanceof THREE.Mesh) || !node.geometry) return
      if (node instanceof THREE.InstancedMesh) return
      const carved = carveOverlappingTriangles(node.geometry, node.matrixWorld, opts.site, groundY)
      if (!carved) return
      carvedRecords.push({
        mesh: node,
        originalGeometry: node.geometry,
        carvedGeometry: carved,
      })
      node.geometry = carved
    })

    carvedRoot = candidate
    if (carvedRecords.length > 0) {
      // 第 1 拍：短暂远移 1 帧使 walk/physics.ts 卸载旧的未裁剪碰撞体，下一帧立即归位重建
      savedRootPos = candidate.position.clone()
      candidate.position.set(savedRootPos.x + 50000, savedRootPos.y, savedRootPos.z + 50000)
      candidate.updateMatrixWorld(true)
      physicsEvictPending = true
    }
  }

  function removeWalkerVolume(): void {
    if (boundWalker?.removeObstacleVolume) {
      boundWalker.removeObstacleVolume(DRINKS_OBSTACLE_VOLUME_ID)
    }
    boundWalker = null
    lastVolumeKey = ''
  }

  return {
    sync(visualActive: boolean): void {
      if (disposed) return
      if (!visualActive) {
        if (lastVolumeKey) removeWalkerVolume()
        return
      }

      const walker = opts.getWalker() ?? null
      const groundY = opts.getGroundY()
      if (walker !== boundWalker) {
        if (boundWalker?.removeObstacleVolume && lastVolumeKey) {
          boundWalker.removeObstacleVolume(DRINKS_OBSTACLE_VOLUME_ID)
        }
        boundWalker = walker
        lastVolumeKey = ''
      }
      if (walker?.syncObstacleVolume) {
        const key = `${opts.site.id}:${opts.site.worldX.toFixed(3)},${groundY.toFixed(3)},${opts.site.worldZ.toFixed(3)}:${opts.site.worldYaw.toFixed(5)}`
        if (key !== lastVolumeKey) {
          lastVolumeKey = key
          walker.syncObstacleVolume(buildDrinksShopObstacleVolume(opts.site, groundY))
        }
      }

      ensureHostLandmarkCarved()
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      removeWalkerVolume()
      restoreCarvedLandmark()
    },
  }
}
