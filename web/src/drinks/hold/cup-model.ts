import * as THREE from 'three'
import type { DrinkCatalogItem } from '../menu/menu.ts'
import { DEFAULT_MASTER_DRINKS_SKIN, type DrinksMasterSkin } from '../menu/skin.ts'

export interface DrinkCupVisual {
  readonly group: THREE.Group
  setDrink(item: Pick<DrinkCatalogItem, 'id' | 'category' | 'cupColor' | 'accentColor' | 'hasCreamCrown' | 'hasPearls' | 'hot'>): void
  setFillRatio(ratio: number): void
  setSipTilt(progress: number): void
  dispose(): void
}

const CUP_RADIUS_TOP = 0.043
const CUP_RADIUS_BOTTOM = 0.030
const CUP_HEIGHT = 0.145
const LIQUID_MAX_HEIGHT = 0.122
const LIQUID_BASE_Y = 0.011

/**
 * 程序化低多边形手持饮品杯（零外部二进制资产、零动态光源）：
 * 挂接于角色右手骨锚点 `attach_hand_r`（本地 +Y 朝上，-Z 朝角色前方）。
 */
export function createDrinkCupModel(masterSkin: DrinksMasterSkin = DEFAULT_MASTER_DRINKS_SKIN): DrinkCupVisual {
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []

  const ownGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g)
    return g
  }
  const ownMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m)
    return m
  }

  const root = new THREE.Group()
  root.name = 'drinks-held-cup'

  const pivot = new THREE.Group()
  pivot.name = 'drinks-cup-pivot'
  // 让手掌正好握在杯身腰部
  pivot.position.set(0, -0.055, -0.012)
  root.add(pivot)

  const cupWallMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: 0xf4efe2,
      roughness: 0.35,
      metalness: 0.02,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    }),
  )
  const cupShell = new THREE.Mesh(
    ownGeo(new THREE.CylinderGeometry(CUP_RADIUS_TOP, CUP_RADIUS_BOTTOM, CUP_HEIGHT, 14, 1, false)),
    cupWallMat,
  )
  cupShell.position.y = CUP_HEIGHT / 2
  pivot.add(cupShell)

  // 杯底厚实压边
  const baseMat = ownMat(new THREE.MeshStandardMaterial({ color: 0xe6dfd0, roughness: 0.72 }))
  const baseDisk = new THREE.Mesh(
    ownGeo(new THREE.CylinderGeometry(CUP_RADIUS_BOTTOM * 0.98, CUP_RADIUS_BOTTOM * 0.94, 0.008, 14)),
    baseMat,
  )
  baseDisk.position.y = 0.004
  pivot.add(baseDisk)

  // 饮品液柱：锚在底部，随喝水进度缩减 scale.y
  const liquidMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: 0xf6df6e,
      roughness: 0.25,
      metalness: 0.02,
    }),
  )
  const liquidGeo = ownGeo(
    new THREE.CylinderGeometry(CUP_RADIUS_TOP * 0.89, CUP_RADIUS_BOTTOM * 0.88, LIQUID_MAX_HEIGHT, 14)
      .translate(0, LIQUID_MAX_HEIGHT / 2, 0),
  )
  const liquid = new THREE.Mesh(liquidGeo, liquidMat)
  liquid.position.y = LIQUID_BASE_Y
  pivot.add(liquid)

  // 珍珠 / 小料底团（按饮品开关显示）
  const pearlMat = ownMat(new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.65 }))
  const pearlsGroup = new THREE.Group()
  pearlsGroup.position.y = LIQUID_BASE_Y + 0.008
  const pearlGeo = ownGeo(new THREE.SphereGeometry(0.0075, 6, 5))
  const pearlOffsets: readonly [number, number, number][] = [
    [-0.011, 0, -0.008],
    [0.012, 0.002, -0.005],
    [0, 0.003, 0.012],
    [-0.008, 0.008, 0.007],
    [0.009, 0.009, 0.008],
  ]
  for (const [px, py, pz] of pearlOffsets) {
    const p = new THREE.Mesh(pearlGeo, pearlMat)
    p.position.set(px, py, pz)
    pearlsGroup.add(p)
  }
  pearlsGroup.visible = false
  pivot.add(pearlsGroup)

  // 原创皮肤腰封杯套（主色来自 menu/skin.ts，随饮品 accentColor 或皮肤底色渲染）
  const sleeveMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: masterSkin.sleeve.primaryHex,
      roughness: 0.82,
      metalness: 0.02,
    }),
  )
  const sleeve = new THREE.Mesh(
    ownGeo(new THREE.CylinderGeometry(CUP_RADIUS_TOP * 0.92, CUP_RADIUS_BOTTOM * 1.07, 0.044, 14, 1, true)),
    sleeveMat,
  )
  sleeve.position.y = 0.068
  pivot.add(sleeve)

  // 平盖 + 吸管
  const lidMat = ownMat(new THREE.MeshStandardMaterial({ color: masterSkin.sleeve.creamHex, roughness: 0.45 }))
  const flatLid = new THREE.Mesh(
    ownGeo(new THREE.CylinderGeometry(CUP_RADIUS_TOP * 1.04, CUP_RADIUS_TOP * 1.04, 0.011, 14)),
    lidMat,
  )
  flatLid.position.y = CUP_HEIGHT + 0.004
  pivot.add(flatLid)

  // 半球奶盖 / 圣代顶（仅冰沙/圣代类显示）
  const domeLid = new THREE.Mesh(
    ownGeo(new THREE.SphereGeometry(CUP_RADIUS_TOP * 0.98, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5)),
    cupWallMat,
  )
  domeLid.position.y = CUP_HEIGHT + 0.004
  domeLid.visible = false
  pivot.add(domeLid)

  const creamSwirlMat = ownMat(new THREE.MeshStandardMaterial({ color: masterSkin.mascot.baseCreamColor, roughness: 0.52 }))
  const creamSwirl = new THREE.Mesh(
    ownGeo(new THREE.ConeGeometry(CUP_RADIUS_TOP * 0.65, 0.042, 10)),
    creamSwirlMat,
  )
  creamSwirl.position.y = CUP_HEIGHT + 0.019
  creamSwirl.visible = false
  pivot.add(creamSwirl)

  // 吸管（略向前上方斜出，方便啜饮动画对齐嘴边）
  const strawMat = ownMat(new THREE.MeshStandardMaterial({ color: masterSkin.sleeve.primaryHex, roughness: 0.55 }))
  const straw = new THREE.Mesh(
    ownGeo(new THREE.CylinderGeometry(0.0045, 0.0045, 0.165, 8)),
    strawMat,
  )
  straw.position.set(0.008, CUP_HEIGHT - 0.01, -0.008)
  straw.rotation.x = -0.14
  straw.rotation.z = -0.08
  pivot.add(straw)

  let disposed = false

  return {
    group: root,

    setDrink(item) {
      if (disposed) return
      liquidMat.color.set(item.cupColor)
      sleeveMat.color.set(item.accentColor)
      strawMat.color.set(item.hot ? 0xd9c8b4 : 0xa9503c)
      pearlsGroup.visible = Boolean(item.hasPearls)
      const hasDome = Boolean(item.hasCreamCrown || item.category === 'ice_cream')
      domeLid.visible = hasDome
      creamSwirl.visible = hasDome
      flatLid.visible = !hasDome
      cupWallMat.opacity = item.hot ? 0.58 : 0.34
    },

    setFillRatio(ratio) {
      if (disposed) return
      const clamped = Math.max(0.02, Math.min(1, Number.isFinite(ratio) ? ratio : 1))
      liquid.scale.y = clamped
      liquid.visible = ratio > 0.005
      if (pearlsGroup.visible) {
        pearlsGroup.visible = ratio > 0.08
      }
    },

    setSipTilt(progress) {
      if (disposed) return
      const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0))
      // 喝的时候杯口向嘴唇方向（+Z 后倾）微抬
      pivot.rotation.x = p * 0.42
      pivot.rotation.z = p * 0.08
    },

    dispose() {
      if (disposed) return
      disposed = true
      root.removeFromParent()
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
    },
  }
}
