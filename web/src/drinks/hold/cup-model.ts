import * as THREE from 'three'
import type { DrinkCatalogItem } from '../menu/menu.ts'
import { createPropsDrinkSkin, DEFAULT_MASTER_DRINKS_SKIN, type DrinksMasterSkin } from '../menu/skin.ts'
import { DRINK_CATALOG, type DrinkId, type DrinkLidKind, type DrinkSpec } from '../props/catalog.ts'
import { createCaramelSwirlTexture, createCupSleeveTexture } from '../props/skins.ts'

export interface DrinkCupVisual {
  readonly group: THREE.Group
  setDrink(
    item: Pick<
      DrinkCatalogItem,
      'id' | 'category' | 'cupColor' | 'accentColor' | 'hasCreamCrown' | 'hasPearls' | 'hot'
    >,
  ): void
  setFillRatio(ratio: number): void
  setSipTilt(progress: number): void
  dispose(): void
}

const DEFAULT_TOP_R = 0.042
const DEFAULT_BOT_R = 0.030
const DEFAULT_H = 0.152
const LIQUID_BOTTOM_OFFSET = 0.008
const LIQUID_HEADROOM = 0.016

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * 精细程序化手持饮品 3D 模型（零外部二进制资产、零动态光源）：
 * - 对齐 `DRINK_CATALOG` 杯型轮廓、卷边杯口、原创皇冠徽标杯套、热封/穹顶/直饮盖、条纹吸管、冰块与配料
 * - 液柱与浮冰/奶盖表面随 `setFillRatio(0..1)` 沿着杯壁锥度同步下降并收缩半径，真实现实喝空效果
 * - 挂接于角色右手骨锚点 `attach_hand_r`（本地 +Y 朝上，-Z 朝角色前方）
 */
export function createDrinkCupModel(
  masterSkin: DrinksMasterSkin = DEFAULT_MASTER_DRINKS_SKIN,
): DrinkCupVisual {
  const propSkin = createPropsDrinkSkin(masterSkin, 'props')
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const textures: THREE.Texture[] = []

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
  pivot.position.set(0, -0.055, -0.012)
  root.add(pivot)

  let cupH = DEFAULT_H
  let rTop = DEFAULT_TOP_R
  let rBot = DEFAULT_BOT_R
  let liquidMaxH = cupH - LIQUID_BOTTOM_OFFSET - LIQUID_HEADROOM
  let curRatio = 1
  let curIsSundae = false

  // 外杯壁与卷边杯沿
  const cupWallMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: propSkin.cupTintHex,
      roughness: 0.18,
      metalness: 0.04,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    }),
  )
  const cupShell = new THREE.Mesh(
    ownGeo(new THREE.CylinderGeometry(1, 1, 1, 16, 1, true)),
    cupWallMat,
  )
  cupShell.renderOrder = 3
  pivot.add(cupShell)

  const rimMat = ownMat(new THREE.MeshStandardMaterial({ color: propSkin.creamHex, roughness: 0.42 }))
  const rimTorus = new THREE.Mesh(ownGeo(new THREE.TorusGeometry(1, 0.06, 6, 18)), rimMat)
  rimTorus.rotation.x = Math.PI / 2
  pivot.add(rimTorus)

  const baseDisk = new THREE.Mesh(
    ownGeo(new THREE.CylinderGeometry(1, 0.96, 1, 16)),
    ownMat(new THREE.MeshStandardMaterial({ color: '#e9e2d4', roughness: 0.68 })),
  )
  pivot.add(baseDisk)

  // 动态缩放液柱（锚在底部，y 轴 scale = fillRatio）
  const liquidMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: '#f6df6e',
      roughness: 0.22,
      metalness: 0.02,
      transparent: true,
      opacity: 0.88,
    }),
  )
  const liquidGeo = ownGeo(new THREE.CylinderGeometry(0.92, 0.89, 1, 16).translate(0, 0.5, 0))
  const liquidMesh = new THREE.Mesh(liquidGeo, liquidMat)
  liquidMesh.renderOrder = 1
  pivot.add(liquidMesh)

  // 随液面同步下沉的浮顶层（微弧液面反光 + 碎冰簇 + 芝士/抹茶奶盖层 + 柠檬片）
  const floatingSurface = new THREE.Group()
  floatingSurface.name = 'drinks-floating-surface'
  pivot.add(floatingSurface)

  const meniscusMat = ownMat(
    new THREE.MeshStandardMaterial({ color: '#fffef8', roughness: 0.14, transparent: true, opacity: 0.55 }),
  )
  const meniscusDisc = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(0.91, 0.91, 0.0025, 16)), meniscusMat)
  floatingSurface.add(meniscusDisc)

  const iceCluster = new THREE.Group()
  const iceMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: '#eefaff',
      roughness: 0.14,
      metalness: 0.04,
      transparent: true,
      opacity: 0.68,
    }),
  )
  const iceGeo = ownGeo(new THREE.BoxGeometry(0.0115, 0.01, 0.0115))
  const iceCoords: readonly [number, number, number, number][] = [
    [0.013, -0.004, 0.008, 0.28],
    [-0.012, -0.005, -0.009, 0.72],
    [0.004, -0.006, -0.014, 1.15],
    [-0.006, -0.004, 0.013, 1.6],
  ]
  for (const [ix, iy, iz, rot] of iceCoords) {
    const ice = new THREE.Mesh(iceGeo, iceMat)
    ice.position.set(ix, iy, iz)
    ice.rotation.set(rot * 0.4, rot, rot * 0.3)
    iceCluster.add(ice)
  }
  floatingSurface.add(iceCluster)

  const cheeseFoamMat = ownMat(new THREE.MeshStandardMaterial({ color: '#fff8ec', roughness: 0.34 }))
  const cheeseFoamCap = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(0.93, 0.92, 0.014, 16)), cheeseFoamMat)
  cheeseFoamCap.position.y = -0.006
  cheeseFoamCap.visible = false
  floatingSurface.add(cheeseFoamCap)

  const lemonSliceGroup = new THREE.Group()
  const lemonRindMat = ownMat(new THREE.MeshStandardMaterial({ color: '#f1c200', roughness: 0.45 }))
  const lemonPulpMat = ownMat(new THREE.MeshStandardMaterial({ color: '#fff282', roughness: 0.28 }))
  const lRind = new THREE.Mesh(ownGeo(new THREE.TorusGeometry(0.015, 0.0024, 5, 10)), lemonRindMat)
  lRind.rotation.x = Math.PI / 2
  const lPulp = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.0036, 10)), lemonPulpMat)
  lemonSliceGroup.add(lRind, lPulp)
  lemonSliceGroup.position.set(-0.006, -0.012, 0.005)
  lemonSliceGroup.rotation.set(0.75, 0.4, -0.35)
  lemonSliceGroup.visible = false
  floatingSurface.add(lemonSliceGroup)

  // 杯底珍珠 / 果粒层（驻留杯底，喝干过程透过透明杯壁越发明显）
  const bottomToppings = new THREE.Group()
  const pearlMat = ownMat(new THREE.MeshStandardMaterial({ color: '#261308', roughness: 0.42 }))
  const pearlGeo = ownGeo(new THREE.SphereGeometry(0.006, 7, 5))
  const pearlOffsets: readonly [number, number, number][] = [
    [-0.013, 0.005, -0.009],
    [0.014, 0.005, -0.007],
    [0.001, 0.006, 0.014],
    [-0.01, 0.012, 0.009],
    [0.01, 0.012, 0.01],
    [-0.002, 0.014, -0.012],
    [0.004, 0.005, -0.001],
  ]
  for (const [px, py, pz] of pearlOffsets) {
    const p = new THREE.Mesh(pearlGeo, pearlMat)
    p.position.set(px, py, pz)
    bottomToppings.add(p)
  }
  bottomToppings.visible = false
  pivot.add(bottomToppings)

  // 皇冠纹理腰封杯套 + 防烫热饮波纹环
  const sleeveMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: propSkin.primaryHex,
      roughness: 0.72,
      metalness: 0.02,
    }),
  )
  const sleeve = new THREE.Mesh(
    ownGeo(new THREE.CylinderGeometry(1.028, 1.028, 1, 16, 1, true)),
    sleeveMat,
  )
  sleeve.rotation.y = Math.PI * 0.5
  sleeve.renderOrder = 4
  pivot.add(sleeve)

  const hotCollar = new THREE.Mesh(
    ownGeo(new THREE.TorusGeometry(1.03, 0.06, 5, 16)),
    ownMat(new THREE.MeshStandardMaterial({ color: '#d8b48c', roughness: 0.6 })),
  )
  hotCollar.rotation.x = Math.PI / 2
  hotCollar.visible = false
  pivot.add(hotCollar)

  // 多盖型组件：平封膜盖 / 透明拱顶盖 / 奶昔圣代螺旋奶霜 + 小勺
  const sealMat = ownMat(new THREE.MeshStandardMaterial({ color: propSkin.sealFilmHex, roughness: 0.42 }))
  const flatLid = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(1.05, 1.05, 0.009, 16)), sealMat)
  pivot.add(flatLid)

  const domeLidMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.16,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    }),
  )
  const domeLid = new THREE.Mesh(
    ownGeo(new THREE.SphereGeometry(1.01, 16, 9, 0, Math.PI * 2, 0, Math.PI * 0.5)),
    domeLidMat,
  )
  domeLid.visible = false
  pivot.add(domeLid)

  const creamGroup = new THREE.Group()
  const creamMat = ownMat(new THREE.MeshStandardMaterial({ color: masterSkin.mascot.baseCreamColor, roughness: 0.48 }))
  for (let tier = 0; tier < 3; tier++) {
    const tr = 0.72 - tier * 0.19
    const torus = new THREE.Mesh(ownGeo(new THREE.TorusGeometry(tr, 0.17, 6, 12)), creamMat)
    torus.rotation.x = Math.PI / 2
    torus.position.y = tier * 0.011
    creamGroup.add(torus)
  }
  const creamPeak = new THREE.Mesh(ownGeo(new THREE.ConeGeometry(0.24, 0.022, 8)), creamMat)
  creamPeak.position.y = 0.032
  creamGroup.add(creamPeak)
  creamGroup.visible = false
  pivot.add(creamGroup)

  // 带固定圈与斜角吸管
  const strawMat = ownMat(new THREE.MeshStandardMaterial({ color: propSkin.primaryHex, roughness: 0.5 }))
  const straw = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(1, 1, 1, 10)), strawMat)
  straw.rotation.x = -0.14
  straw.rotation.z = -0.07
  pivot.add(straw)

  const strawRing = new THREE.Mesh(
    ownGeo(new THREE.TorusGeometry(0.0068, 0.0018, 5, 10)),
    ownMat(new THREE.MeshStandardMaterial({ color: propSkin.goldHex, roughness: 0.35 })),
  )
  strawRing.rotation.x = Math.PI / 2 - 0.14
  pivot.add(strawRing)

  const spoonGroup = new THREE.Group()
  const spoonMat = ownMat(new THREE.MeshStandardMaterial({ color: propSkin.primaryHex, roughness: 0.38 }))
  const spoonHandle = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.005, 0.068, 0.0022)), spoonMat)
  spoonHandle.position.set(-0.014, 0.032, 0.008)
  spoonHandle.rotation.z = 0.34
  spoonGroup.add(spoonHandle)
  spoonGroup.visible = false
  pivot.add(spoonGroup)

  let activeSleeveTex: THREE.Texture | null = null
  let activeLiquidTex: THREE.Texture | null = null
  let disposed = false

  function updateLayout(): void {
    const ratio = Math.max(0, Math.min(1, curRatio))
    const visibleFill = ratio <= 0.002 ? 0 : Math.max(0.02, ratio)
    const surfY = LIQUID_BOTTOM_OFFSET + visibleFill * liquidMaxH
    const rAtSurface = lerp(rBot, rTop, (surfY / cupH)) * 0.91

    liquidMesh.position.y = LIQUID_BOTTOM_OFFSET
    liquidMesh.scale.set(rTop, visibleFill * liquidMaxH, rTop)
    liquidMesh.visible = ratio > 0.004

    floatingSurface.position.y = surfY
    floatingSurface.scale.set(rAtSurface / 0.91, 1, rAtSurface / 0.91)
    floatingSurface.visible = ratio > 0.015

    if (curIsSundae && creamGroup.visible) {
      creamGroup.scale.set(rTop * (0.45 + 0.55 * Math.max(0.15, ratio)), 0.4 + 0.6 * ratio, rTop * (0.45 + 0.55 * Math.max(0.15, ratio)))
      creamGroup.position.y = cupH + 0.005 - (1 - ratio) * 0.018
    }

    bottomToppings.visible = bottomToppings.userData.enabled === true
  }

  function applyLidKind(lid: DrinkLidKind, spec: DrinkSpec | undefined): void {
    const isDome = lid === 'flip_cap_clear' || lid === 'hemisphere_dome'
    const isOpen = lid === 'open_swirl'
    const hasCream = isOpen || lid === 'hemisphere_dome'

    flatLid.visible = !isDome && !isOpen
    flatLid.position.y = cupH + 0.003
    flatLid.scale.set(rTop, 1, rTop)
    sealMat.color.set(
      lid === 'heat_seal_clear'
        ? '#f5faf6'
        : lid === 'coffee_sip_lid'
          ? '#242930'
          : lid === 'hot_sip_lid'
            ? spec?.accentHex ?? propSkin.primaryHex
            : propSkin.sealFilmHex,
    )

    domeLid.visible = isDome
    domeLid.position.y = cupH + 0.001
    domeLid.scale.set(rTop, rTop * 0.85, rTop)

    creamGroup.visible = hasCream
    if (hasCream) {
      creamGroup.position.y = cupH + 0.005
      creamGroup.scale.set(rTop, 1, rTop)
    }

    const showStraw = !isOpen && (spec ? Boolean(spec.strawHex) : true)
    const strawR = spec?.strawRadiusM ?? 0.0046
    const strawLen = cupH + (isDome ? 0.056 : 0.036)
    straw.visible = showStraw
    straw.scale.set(strawR, strawLen, strawR)
    straw.position.set(0.008, strawLen * 0.5 + 0.008, -0.007)
    strawMat.color.set(spec?.strawHex ?? (spec?.id === 'brown_sugar_milk' ? '#d9c8b4' : propSkin.primaryHex))

    strawRing.visible = showStraw
    strawRing.position.set(0.008, cupH + (isDome ? 0.025 : 0.008), -0.007)

    spoonGroup.visible = isOpen
    spoonGroup.position.set(0, cupH, 0)
  }

  return {
    group: root,

    setDrink(item) {
      if (disposed) return
      const spec = item.id in DRINK_CATALOG ? DRINK_CATALOG[item.id as DrinkId] : undefined

      cupH = spec?.cupHeightM ?? DEFAULT_H
      rTop = spec?.topRadiusM ?? DEFAULT_TOP_R
      rBot = spec?.bottomRadiusM ?? DEFAULT_BOT_R
      liquidMaxH = Math.max(0.06, cupH - LIQUID_BOTTOM_OFFSET - LIQUID_HEADROOM)
      curIsSundae = spec?.id === 'sundae_cup' || item.category === 'ice_cream'

      const isHot = Boolean(item.hot || spec?.silhouette === 'corrugated_hot')
      const isFrosted = spec?.silhouette === 'frosted_slender'
      const isOpaque = spec?.silhouette === 'sundae_bowl' || isHot

      cupShell.position.y = cupH * 0.5
      cupShell.scale.set((rTop + rBot) * 0.5, cupH, (rTop + rBot) * 0.5)
      cupWallMat.color.set(isHot ? '#f3e7d4' : spec?.silhouette === 'sundae_bowl' ? propSkin.creamHex : propSkin.cupTintHex)
      cupWallMat.transparent = !isOpaque
      cupWallMat.opacity = isOpaque ? 1 : isFrosted ? 0.46 : 0.28
      cupWallMat.depthWrite = isOpaque

      rimTorus.position.y = cupH
      rimTorus.scale.set(rTop * 1.01, rTop * 1.01, 0.04)
      rimMat.color.set(isHot ? '#d8b48c' : propSkin.creamHex)

      baseDisk.position.y = 0.003
      baseDisk.scale.set(rBot, 0.006, rBot)

      // 杯身双面/螺旋纹液柱贴图
      if (activeLiquidTex) {
        activeLiquidTex.dispose()
        activeLiquidTex = null
      }
      if (spec && (spec.id === 'shake_milkshake' || spec.id === 'sundae_cup' || spec.id === 'brown_sugar_milk')) {
        activeLiquidTex = createCaramelSwirlTexture(spec.liquidHex, spec.liquidSecondaryHex)
        if (activeLiquidTex) textures.push(activeLiquidTex)
      }
      liquidMat.map = activeLiquidTex
      liquidMat.color.set(activeLiquidTex ? '#ffffff' : item.cupColor)
      liquidMat.opacity = spec?.liquidOpacity ?? 0.88
      liquidMat.transparent = (spec?.liquidOpacity ?? 0.88) < 1
      liquidMat.needsUpdate = true

      // 动态表面配色
      meniscusMat.color.set(spec?.liquidSecondaryHex ?? '#fffef8')
      iceCluster.visible = !isHot && !curIsSundae
      cheeseFoamCap.visible = spec?.id === 'taro_grape_tea' || spec?.id === 'pearl_milk_tea' || spec?.id === 'jasmine_milk_green'
      cheeseFoamMat.color.set(spec?.id === 'jasmine_milk_green' ? '#7ea565' : '#fff8ec')
      lemonSliceGroup.visible = spec?.id === 'ice_lemon_water' || spec?.id === 'passion_fruit_cup'
      lemonRindMat.color.set(spec?.id === 'passion_fruit_cup' ? '#59a92c' : '#ebba00')

      bottomToppings.userData.enabled = Boolean(
        item.hasPearls || spec?.id === 'mango_pomelo_sago' || spec?.id === 'passion_fruit_cup',
      )
      pearlMat.color.set(
        spec?.id === 'taro_grape_tea'
          ? '#f2a43a'
          : spec?.id === 'mango_pomelo_sago'
            ? '#ff9d00'
            : '#261308',
      )

      // 腰封杯套贴图（基于 menu/skin.ts 生成）
      const sleeveH = isHot ? cupH * 0.42 : cupH * 0.3
      const sleeveY = isHot ? cupH * 0.48 : cupH * 0.36
      const sleeveR = lerp(rBot, rTop, sleeveY / cupH)
      sleeve.position.y = sleeveY
      sleeve.scale.set(sleeveR, sleeveH, sleeveR)

      if (activeSleeveTex) {
        activeSleeveTex.dispose()
        activeSleeveTex = null
      }
      if (spec) {
        activeSleeveTex = createCupSleeveTexture(spec, propSkin)
        if (activeSleeveTex) textures.push(activeSleeveTex)
      }
      sleeveMat.map = activeSleeveTex
      sleeveMat.color.set(activeSleeveTex ? '#ffffff' : item.accentColor)
      sleeveMat.needsUpdate = true

      hotCollar.visible = isHot
      if (isHot) {
        hotCollar.position.y = cupH * 0.58
        hotCollar.scale.set(lerp(rBot, rTop, 0.58) * 1.02, lerp(rBot, rTop, 0.58) * 1.02, 0.045)
      }

      const lidKind: DrinkLidKind =
        spec?.lid ?? (item.hasCreamCrown || item.category === 'ice_cream' ? 'hemisphere_dome' : 'heat_seal_red')
      applyLidKind(lidKind, spec)
      updateLayout()
    },

    setFillRatio(ratio) {
      if (disposed) return
      curRatio = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 1
      updateLayout()
    },

    setSipTilt(progress) {
      if (disposed) return
      const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0))
      pivot.rotation.x = p * 0.42
      pivot.rotation.z = p * 0.08
    },

    dispose() {
      if (disposed) return
      disposed = true
      root.removeFromParent()
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
      for (const t of textures) t.dispose()
    },
  }
}
