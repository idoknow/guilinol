import * as THREE from 'three'
import { DRINK_CATALOG, DRINK_IDS, type DrinkId, type DrinkSpec } from './catalog.ts'
import {
  createCaramelSwirlTexture,
  createCupSleeveTexture,
  resolveDrinkSkin,
  type DrinkSkinConfig,
} from './skins.ts'

export interface DrinkBuildOptions {
  skin?: Partial<DrinkSkinConfig>
  includeSleeve?: boolean
  includeStraw?: boolean
}

export interface DrinkPropBounds {
  widthM: number
  heightM: number
  depthM: number
  minY: number
  maxY: number
}

export interface DrinkPropReportItem {
  id: DrinkId
  name: string
  category: DrinkSpec['category']
  stationKind: DrinkSpec['stationKind']
  silhouette: DrinkSpec['silhouette']
  lid: DrinkSpec['lid']
  cupMl: DrinkSpec['cupMl']
  triangles: number
  meshes: number
  bounds: DrinkPropBounds
}

export const DRINK_HAND_GRIP = {
  offset: [0, 0.015, 0.025] as const,
  rotation: [0.08, 0, -0.05] as const,
}

function makeMat(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    flatShading: true,
    roughness: 0.45,
    metalness: 0.04,
    ...params,
  })
}

function makeLemonSlice(rindHex: string, pulpHex: string): THREE.Group {
  const g = new THREE.Group()
  g.name = 'lemon_slice'
  const rind = new THREE.Mesh(
    new THREE.TorusGeometry(0.0185, 0.0028, 4, 10),
    makeMat({ color: rindHex, roughness: 0.45 }),
  )
  rind.rotation.x = Math.PI / 2
  const pulp = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0175, 0.0175, 0.0044, 10),
    makeMat({ color: pulpHex, roughness: 0.25, transparent: true, opacity: 0.9 }),
  )
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0035, 0.0035, 0.0048, 6),
    makeMat({ color: '#fffbe6', roughness: 0.4 }),
  )
  g.add(rind, pulp, core)
  return g
}

function makeLimeWedge(rindHex: string, pulpHex: string): THREE.Group {
  const g = new THREE.Group()
  g.name = 'lime_wedge'
  const outer = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.014, 0.004, 8, 1, false, 0, Math.PI),
    makeMat({ color: rindHex, roughness: 0.48 }),
  )
  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0118, 0.0118, 0.0044, 8, 1, false, 0, Math.PI),
    makeMat({ color: pulpHex, roughness: 0.25 }),
  )
  g.add(outer, inner)
  return g
}

function addIceCluster(group: THREE.Group, yCenter: number, radiusMax: number, count: number, colorHex = '#eefaff'): void {
  const iceGeom = new THREE.BoxGeometry(0.013, 0.0115, 0.013)
  const iceMat = makeMat({
    color: colorHex,
    roughness: 0.14,
    metalness: 0.05,
    transparent: true,
    opacity: 0.65,
  })
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + 0.4
    const r = radiusMax * (i % 2 === 0 ? 0.56 : 0.22)
    const cube = new THREE.Mesh(iceGeom, iceMat)
    cube.position.set(
      Math.cos(angle) * r,
      yCenter + ((i % 3) - 1) * 0.0085,
      Math.sin(angle) * r,
    )
    cube.rotation.set(0.32 * i, 0.55 * i, 0.24 * i)
    cube.renderOrder = 2
    group.add(cube)
  }
}

function addPearlLayer(
  group: THREE.Group,
  yBase: number,
  radius: number,
  count: number,
  colorHex: string,
  pearlRadius = 0.0052,
  scaleY = 1,
): void {
  const geom =
    pearlRadius < 0.004
      ? new THREE.OctahedronGeometry(pearlRadius, 0)
      : new THREE.SphereGeometry(pearlRadius, 5, 3)
  const mat = makeMat({ color: colorHex, roughness: 0.22, metalness: 0.04 })
  for (let i = 0; i < count; i++) {
    const ring = i < 4 ? 0.35 : 0.72
    const theta = (i * 2.39996) % (Math.PI * 2)
    const mesh = new THREE.Mesh(geom, mat)
    mesh.position.set(
      Math.cos(theta) * radius * ring,
      yBase + (i % 2) * 0.0055,
      Math.sin(theta) * radius * ring,
    )
    mesh.scale.set(1, scaleY, 1)
    group.add(mesh)
  }
}

function addDiceCubes(
  group: THREE.Group,
  yBase: number,
  spreadY: number,
  radiusMax: number,
  count: number,
  size: number,
  colorHex: string,
  opacity = 0.9,
): void {
  const geom = new THREE.BoxGeometry(size, size * 0.88, size)
  const mat = makeMat({
    color: colorHex,
    roughness: 0.28,
    transparent: opacity < 1,
    opacity,
  })
  for (let i = 0; i < count; i++) {
    const theta = i * 2.1 + 0.5
    const r = radiusMax * (0.28 + 0.45 * ((i % 3) / 2))
    const m = new THREE.Mesh(geom, mat)
    m.position.set(
      Math.cos(theta) * r,
      yBase + ((i % 4) / 3) * spreadY,
      Math.sin(theta) * r,
    )
    m.rotation.set(0.4 * i, 0.7 * i, 0.25 * i)
    group.add(m)
  }
}

function addHeatSealLid(group: THREE.Group, topY: number, topRadius: number, colorHex: string, translucent = false): void {
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(topRadius * 1.01, 0.0022, 4, 12),
    makeMat({ color: '#f3f7fa', roughness: 0.35 }),
  )
  rim.rotation.x = Math.PI / 2
  rim.position.y = topY
  group.add(rim)

  const film = new THREE.Mesh(
    new THREE.CylinderGeometry(topRadius * 0.99, topRadius * 0.99, 0.0018, 12),
    makeMat({
      color: colorHex,
      roughness: 0.25,
      transparent: translucent,
      opacity: translucent ? 0.58 : 0.96,
    }),
  )
  film.position.y = topY + 0.0008
  group.add(film)
}

function addFlipSipLid(group: THREE.Group, topY: number, topRadius: number): void {
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(topRadius * 1.04, topRadius * 1.05, 0.0085, 14),
    makeMat({ color: '#eef4fa', roughness: 0.22, transparent: true, opacity: 0.78 }),
  )
  collar.position.y = topY + 0.003
  const dome = new THREE.Mesh(
    new THREE.CylinderGeometry(topRadius * 0.88, topRadius * 1.02, 0.011, 14),
    makeMat({ color: '#f4f9fd', roughness: 0.2, transparent: true, opacity: 0.72 }),
  )
  dome.position.y = topY + 0.012
  const flipTab = new THREE.Mesh(
    new THREE.BoxGeometry(0.016, 0.006, 0.012),
    makeMat({ color: '#d9252e', roughness: 0.35 }),
  )
  flipTab.position.set(0, topY + 0.019, -topRadius * 0.45)
  flipTab.rotation.x = 0.25
  group.add(collar, dome, flipTab)
}

function addHemisphereDomeLid(group: THREE.Group, topY: number, topRadius: number): void {
  // 奶油玫瑰旋转顶（藏在半球顶盖内部，视觉辨识极强）
  const creamRosetteMat = makeMat({ color: '#ffeef3', roughness: 0.34 })
  const baseRosette = new THREE.Mesh(
    new THREE.CylinderGeometry(topRadius * 0.58, topRadius * 0.76, 0.015, 10),
    creamRosetteMat,
  )
  baseRosette.position.y = topY + 0.007
  const peakRosette = new THREE.Mesh(new THREE.ConeGeometry(topRadius * 0.46, 0.024, 10), creamRosetteMat)
  peakRosette.position.y = topY + 0.025
  group.add(baseRosette, peakRosette)

  // 透明高耸半球顶盖
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(topRadius * 1.04, topRadius * 1.05, 0.007, 14),
    makeMat({ color: '#fff4f7', roughness: 0.28 }),
  )
  ring.position.y = topY + 0.002
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(topRadius * 1.01, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.48),
    makeMat({
      color: '#f7fbff',
      roughness: 0.14,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
    }),
  )
  dome.position.y = topY + 0.004
  dome.renderOrder = 5
  group.add(ring, dome)
}

function addCoffeeSipLid(group: THREE.Group, topY: number, topRadius: number): void {
  const matDark = makeMat({ color: '#1b1817', roughness: 0.46 })
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(topRadius * 1.05, topRadius * 1.06, 0.01, 14), matDark)
  collar.position.y = topY + 0.003
  const step = new THREE.Mesh(new THREE.CylinderGeometry(topRadius * 0.92, topRadius * 1.01, 0.011, 14), matDark)
  step.position.y = topY + 0.013
  const sipSpout = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.009, 0.013), matDark)
  sipSpout.position.set(0, topY + 0.021, -topRadius * 0.56)
  group.add(collar, step, sipSpout)
}

function addHotSipLid(group: THREE.Group, topY: number, topRadius: number, accentHex: string): void {
  const creamMat = makeMat({ color: '#fff8ef', roughness: 0.42 })
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(topRadius * 1.05, topRadius * 1.06, 0.01, 14), creamMat)
  collar.position.y = topY + 0.003
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(topRadius * 0.92, topRadius * 1.01, 0.012, 14), creamMat)
  dome.position.y = topY + 0.013
  // 标志性防漏红塞小棒
  const plug = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.036, 8), makeMat({ color: accentHex, roughness: 0.35 }))
  plug.position.set(0, topY + 0.031, -topRadius * 0.52)
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.0048, 6, 4), makeMat({ color: accentHex, roughness: 0.3 }))
  knob.position.set(0, topY + 0.049, -topRadius * 0.52)
  group.add(collar, dome, plug, knob)
}

function addStraw(group: THREE.Group, bottomY: number, topY: number, radiusM: number, strawHex: string): void {
  const len = topY - bottomY + 0.048
  const straw = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusM, radiusM, len, 8),
    makeMat({ color: strawHex, roughness: 0.32 }),
  )
  straw.position.set(0.006, (bottomY + topY + 0.046) * 0.5, 0.004)
  straw.rotation.z = -0.09
  straw.rotation.x = 0.05
  group.add(straw)
}

function addSundaeSwirlAndPearls(
  group: THREE.Group,
  topY: number,
  topRadius: number,
  accentHex: string,
): void {
  const creamMat = makeMat({ color: '#fffaf0', roughness: 0.32 })
  const fudgeMat = makeMat({ color: '#4c2212', roughness: 0.24 })

  const tiers: Array<[number, number, number, number]> = [
    [topY + 0.009, topRadius * 0.84, topRadius * 0.68, 0.02],
    [topY + 0.027, topRadius * 0.66, topRadius * 0.48, 0.019],
    [topY + 0.044, topRadius * 0.46, topRadius * 0.19, 0.018],
  ]
  for (const [y, rBot, rTop, h] of tiers) {
    const swirl = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 14), creamMat)
    swirl.position.y = y
    group.add(swirl)
  }
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.022, 10), creamMat)
  tip.position.set(-0.002, topY + 0.06, 0.002)
  tip.rotation.z = 0.24
  group.add(tip)

  // 黑糖厚流心圈 + 外凸挂嵌黑糖珍珠（在奶霜底座与肩部明显突出可见）
  const drizzle = new THREE.Mesh(new THREE.TorusGeometry(topRadius * 0.84, 0.0052, 4, 10), fudgeMat)
  drizzle.rotation.x = Math.PI / 2 + 0.1
  drizzle.position.y = topY + 0.015
  group.add(drizzle)
  addPearlLayer(group, topY + 0.016, topRadius * 0.88, 7, '#1d0d06', 0.0062)
  addPearlLayer(group, topY + 0.032, topRadius * 0.72, 4, '#241108', 0.0052)

  // 红色扁平甜品小勺（与吸管杯完全不同）
  const spoonMat = makeMat({ color: accentHex, roughness: 0.35 })
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.0052, 0.072, 0.0024), spoonMat)
  handle.position.set(-0.017, topY + 0.036, 0.008)
  handle.rotation.z = 0.34
  handle.rotation.y = 0.24
  const scoop = new THREE.Mesh(new THREE.SphereGeometry(0.0068, 6, 4), spoonMat)
  scoop.scale.set(1, 0.35, 1.35)
  scoop.position.set(-0.006, topY + 0.004, 0.004)
  group.add(handle, scoop)
}

/**
 * 构建单杯饮品 3D 道具模型（以 `menu/menu.ts` 10 款饮品 ID 为唯一标准）：
 * - 局部原点 `(0, 0, 0)` 对齐右手掌心握持点
 * - `+Y` 朝杯口方向，`-Z` 为杯身主徽章正面
 */
export function buildDrinkProp(id: DrinkId, opts: DrinkBuildOptions = {}): THREE.Group {
  const spec = DRINK_CATALOG[id]
  const skin = resolveDrinkSkin(opts.skin)
  const root = new THREE.Group()
  root.name = `drink_prop_${id}`
  root.userData.drinkId = id
  root.userData.drinkName = spec.name
  root.userData.skinId = skin.id
  root.userData.silhouette = spec.silhouette
  root.userData.lid = spec.lid
  root.userData.handOffset = DRINK_HAND_GRIP.offset
  root.userData.handRotation = DRINK_HAND_GRIP.rotation

  const h = spec.cupHeightM
  const yCenter = -spec.handGripYOffsetM
  const bottomY = yCenter - h * 0.5
  const topY = yCenter + h * 0.5
  const rTop = spec.topRadiusM
  const rBot = spec.bottomRadiusM

  // 1) 外杯壳（磨砂/透明/防烫实心纸杯/敞口圣代碗）
  const isFrosted = spec.silhouette === 'frosted_slender'
  const isOpaqueCup = spec.silhouette === 'sundae_bowl' || spec.silhouette === 'corrugated_hot'
  const outerColor =
    spec.silhouette === 'corrugated_hot'
      ? '#f3e7d4'
      : spec.silhouette === 'sundae_bowl'
        ? skin.creamHex
        : skin.cupTintHex

  const cupOuterMat = makeMat({
    color: outerColor,
    roughness: isFrosted ? 0.52 : isOpaqueCup ? 0.48 : 0.14,
    transparent: !isOpaqueCup,
    opacity: isOpaqueCup ? 1 : isFrosted ? 0.46 : 0.28,
    depthWrite: isOpaqueCup,
    side: spec.lid === 'open_swirl' ? THREE.DoubleSide : THREE.FrontSide,
  })
  const cupShell = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBot, h, 12, 1, spec.lid === 'open_swirl'),
    cupOuterMat,
  )
  cupShell.position.y = yCenter
  cupShell.renderOrder = isOpaqueCup ? 1 : 3
  root.add(cupShell)

  if (spec.silhouette === 'sundae_bowl') {
    const baseDisk = new THREE.Mesh(
      new THREE.CylinderGeometry(rBot, rBot * 0.96, 0.004, 12),
      makeMat({ color: skin.creamHex, roughness: 0.45 }),
    )
    baseDisk.position.y = bottomY + 0.002
    root.add(baseDisk)
  }

  // 2) 内部饮品液面与层次
  const innerGroup = new THREE.Group()
  innerGroup.name = 'drink_contents'
  root.add(innerGroup)

  const fillFrac =
    spec.id === 'sundae_cup'
      ? 0.86
      : spec.id === 'taro_grape_tea'
        ? 0.72
        : spec.id === 'iced_americano'
          ? 0.82
          : 0.85
  const fillH = (h - 0.012) * fillFrac
  const rLiqTop = THREE.MathUtils.lerp(rBot, rTop, fillFrac) * 0.92
  const rLiqBot = rBot * 0.91

  let liqTex: THREE.Texture | null = null
  if (spec.id === 'shake_milkshake' || spec.id === 'sundae_cup' || spec.id === 'brown_sugar_milk') {
    liqTex = createCaramelSwirlTexture(spec.liquidHex, spec.liquidSecondaryHex)
  }

  if (spec.id === 'iced_americano') {
    // 美式上下双色冰水渐层：下层清冽冷萃冰水，上层浓黑意式萃取悬浮渐变
    const lowerH = fillH * 0.56
    const upperH = fillH * 0.44
    const lowerWater = new THREE.Mesh(
      new THREE.CylinderGeometry(THREE.MathUtils.lerp(rLiqBot, rLiqTop, 0.56), rLiqBot, lowerH, 12),
      makeMat({ color: '#b58453', roughness: 0.18, transparent: true, opacity: 0.62 }),
    )
    lowerWater.position.y = bottomY + 0.005 + lowerH * 0.5
    const upperEspresso = new THREE.Mesh(
      new THREE.CylinderGeometry(rLiqTop, THREE.MathUtils.lerp(rLiqBot, rLiqTop, 0.56), upperH, 12),
      makeMat({ color: '#2b160c', roughness: 0.22, transparent: true, opacity: 0.94 }),
    )
    upperEspresso.position.y = bottomY + 0.005 + lowerH + upperH * 0.5
    innerGroup.add(lowerWater, upperEspresso)
    addIceCluster(innerGroup, topY - 0.032, rLiqTop * 0.72, 6, '#eef8ff')
  } else {
    const liquidMat = makeMat({
      color: liqTex ? '#ffffff' : spec.liquidHex,
      ...(liqTex ? { map: liqTex } : {}),
      roughness: spec.id === 'sundae_cup' ? 0.36 : 0.24,
      transparent: spec.liquidOpacity < 1,
      opacity: spec.liquidOpacity,
    })
    const liquidMesh = new THREE.Mesh(new THREE.CylinderGeometry(rLiqTop, rLiqBot, fillH, 12), liquidMat)
    liquidMesh.position.y = bottomY + 0.005 + fillH * 0.5
    liquidMesh.renderOrder = 1
    innerGroup.add(liquidMesh)
  }

  // 3) 10 款全独立特征配料（确保零“两款同模换色”）
  if (spec.id === 'ice_lemon_water') {
    addIceCluster(innerGroup, topY - 0.036, rLiqTop * 0.72, 6, '#eefaff')
    const s1 = makeLemonSlice('#ebba00', '#fff078')
    s1.position.set(-0.01, yCenter + 0.024, 0.008)
    s1.rotation.set(0.92, 0.35, -0.48)
    const s2 = makeLemonSlice('#e5ae00', '#ffea66')
    s2.position.set(0.011, yCenter + 0.006, -0.009)
    s2.rotation.set(-0.78, 0.42, 0.55)
    innerGroup.add(s1, s2)
  } else if (spec.id === 'passion_fruit_cup') {
    addPearlLayer(innerGroup, bottomY + 0.011, rLiqBot * 0.76, 6, '#23150e', 0.0046)
    addDiceCubes(innerGroup, bottomY + 0.02, 0.025, rLiqBot * 0.78, 5, 0.007, '#fff6df', 0.88)
    addPearlLayer(innerGroup, yCenter - 0.01, rLiqTop * 0.76, 8, '#24140a', 0.0024, 0.65)
    const lime = makeLimeWedge('#59a92c', '#d5eb6e')
    lime.position.set(0.008, topY - 0.044, -0.008)
    lime.rotation.set(0.75, 0.4, 0.5)
    addIceCluster(innerGroup, topY - 0.036, rLiqTop * 0.62, 4, '#fff6d8')
    innerGroup.add(lime)
  } else if (spec.id === 'pearl_milk_tea') {
    // 珍珠奶茶：奶茶液柱抬升至珍珠床上方，让杯底 0..26mm 通透空间内的乌亮木薯珍珠一眼可见
    const teaBody = innerGroup.children[0] as THREE.Mesh | undefined
    if (teaBody) {
      teaBody.scale.y = 0.78
      teaBody.position.y = bottomY + 0.028 + fillH * 0.78 * 0.5
    }
    const syrupBase = new THREE.Mesh(
      new THREE.CylinderGeometry(rBot * 0.95, rBot * 0.9, 0.022, 12),
      makeMat({ color: '#4d2612', roughness: 0.22, transparent: true, opacity: 0.42 }),
    )
    syrupBase.position.y = bottomY + 0.015
    innerGroup.add(syrupBase)
    addPearlLayer(innerGroup, bottomY + 0.011, rBot * 0.88, 9, '#190b04', 0.0062)
    addPearlLayer(innerGroup, bottomY + 0.021, rBot * 0.86, 7, '#241208', 0.0058)
    const milkCap = new THREE.Mesh(
      new THREE.CylinderGeometry(rLiqTop * 0.99, rLiqTop * 0.97, 0.016, 12),
      makeMat({ color: '#fbf4e8', roughness: 0.32 }),
    )
    milkCap.position.y = bottomY + 0.028 + fillH * 0.78 + 0.004
    innerGroup.add(milkCap)
  } else if (spec.id === 'jasmine_milk_green') {
    // 茉莉奶绿：抹茶青顶环 + 轻浮白色茉莉花瓣细碎 + 磨砂修长体
    const greenRing = new THREE.Mesh(
      new THREE.CylinderGeometry(rLiqTop * 0.98, rLiqTop * 0.96, 0.014, 12),
      makeMat({ color: '#7ea565', roughness: 0.38 }),
    )
    greenRing.position.y = bottomY + 0.005 + fillH * 0.94
    innerGroup.add(greenRing)
    addDiceCubes(innerGroup, topY - 0.025, 0.008, rLiqTop * 0.65, 5, 0.0048, '#fffef7', 0.95)
  } else if (spec.id === 'taro_grape_tea') {
    // 紫葡萄果泥底 + 橙黄与淡紫双色软糯小芋圆 + 厚咸芝士奶盖
    const jamLayer = new THREE.Mesh(
      new THREE.CylinderGeometry(rLiqBot * 1.04, rLiqBot * 0.98, 0.028, 12),
      makeMat({ color: '#4d1852', roughness: 0.28 }),
    )
    jamLayer.position.y = bottomY + 0.02
    innerGroup.add(jamLayer)
    addPearlLayer(innerGroup, bottomY + 0.028, rLiqBot * 0.75, 5, '#f2a43a', 0.0062)
    addPearlLayer(innerGroup, bottomY + 0.036, rLiqBot * 0.72, 4, '#d9b5ec', 0.0058)
    const foamTopY = bottomY + 0.005 + fillH
    const foamH = 0.024
    const cheeseFoam = new THREE.Mesh(
      new THREE.CylinderGeometry(rTop * 0.93, rLiqTop * 0.98, foamH, 12),
      makeMat({ color: '#fff7e8', roughness: 0.36 }),
    )
    cheeseFoam.position.y = foamTopY + foamH * 0.5
    innerGroup.add(cheeseFoam)
  } else if (spec.id === 'mango_pomelo_sago') {
    const cocY = yCenter + 0.028
    const cocFracBot = (cocY - 0.015 - bottomY) / h
    const cocFracTop = (cocY + 0.015 - bottomY) / h
    const cocRBot = THREE.MathUtils.lerp(rBot, rTop, cocFracBot) * 0.945
    const cocRTop = THREE.MathUtils.lerp(rBot, rTop, cocFracTop) * 0.945
    const coconutBand = new THREE.Mesh(
      new THREE.CylinderGeometry(cocRTop, cocRBot, 0.03, 12),
      makeMat({ color: '#fffbf0', roughness: 0.3 }),
    )
    coconutBand.position.y = cocY
    coconutBand.renderOrder = 2
    innerGroup.add(coconutBand)
    addPearlLayer(innerGroup, bottomY + 0.011, rLiqBot * 0.78, 8, '#fffcf2', 0.0032)
    addDiceCubes(innerGroup, topY - 0.036, 0.016, rTop * 0.78, 5, 0.009, '#ff9d00', 1)
    addDiceCubes(innerGroup, topY - 0.032, 0.018, rTop * 0.8, 5, 0.0072, '#ff4538', 1)
  } else if (spec.id === 'shake_milkshake') {
    // 草莓果肉块藏于杯中及顶层草莓脆粒
    addDiceCubes(innerGroup, bottomY + 0.014, 0.022, rLiqBot * 0.78, 5, 0.008, '#d92848', 0.96)
    addIceCluster(innerGroup, topY - 0.036, rLiqTop * 0.62, 4, '#ffeef2')
  } else if (spec.id === 'sundae_cup') {
    addSundaeSwirlAndPearls(root, topY, rTop, spec.accentHex)
  } else if (spec.id === 'brown_sugar_milk') {
    // 防烫热饮杯顶沿露出黑糖波波，配防烫立体加厚瓦楞环
    addPearlLayer(innerGroup, topY - 0.026, rLiqTop * 0.7, 5, '#2b1308', 0.0054)
    const collarRim = new THREE.Mesh(
      new THREE.TorusGeometry(rTop * 1.02, 0.0032, 4, 12),
      makeMat({ color: '#d8b48c', roughness: 0.6 }),
    )
    collarRim.rotation.x = Math.PI / 2
    collarRim.position.y = yCenter + h * 0.06
    root.add(collarRim)
  }

  // 4) 原创皮肤杯套（可随皮肤配置切换或关闭）
  if (opts.includeSleeve !== false) {
    const sleeveH = spec.silhouette === 'corrugated_hot' ? h * 0.44 : h * 0.3
    const sleeveY = spec.silhouette === 'corrugated_hot' ? yCenter - h * 0.02 : yCenter - h * 0.09
    const fracBot = (sleeveY - sleeveH * 0.5 - bottomY) / h
    const fracTop = (sleeveY + sleeveH * 0.5 - bottomY) / h
    const sleeveRBot = THREE.MathUtils.lerp(rBot, rTop, fracBot) * 1.025
    const sleeveRTop = THREE.MathUtils.lerp(rBot, rTop, fracTop) * 1.025
    const sleeveTex = createCupSleeveTexture(spec, skin)
    const sleeveMat = makeMat({
      color: sleeveTex ? '#ffffff' : skin.primaryHex,
      ...(sleeveTex ? { map: sleeveTex } : {}),
      roughness: 0.55,
    })
    const sleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(sleeveRTop, sleeveRBot, sleeveH, 12, 1, true),
      sleeveMat,
    )
    sleeve.position.y = sleeveY
    sleeve.rotation.y = Math.PI * 0.5
    sleeve.renderOrder = 4
    root.add(sleeve)
  }

  // 5) 7 种差异化杯盖 + 吸管配置
  if (spec.lid === 'heat_seal_red') {
    addHeatSealLid(root, topY, rTop, skin.sealFilmHex, false)
  } else if (spec.lid === 'heat_seal_clear') {
    addHeatSealLid(root, topY, rTop, '#f8fff8', true)
  } else if (spec.lid === 'flip_cap_clear') {
    addFlipSipLid(root, topY, rTop)
  } else if (spec.lid === 'hemisphere_dome') {
    addHemisphereDomeLid(root, topY, rTop)
  } else if (spec.lid === 'coffee_sip_lid') {
    addCoffeeSipLid(root, topY, rTop)
  } else if (spec.lid === 'hot_sip_lid') {
    addHotSipLid(root, topY, rTop, spec.accentHex)
  }

  if (spec.strawHex && opts.includeStraw !== false) {
    const strawTopOffset =
      spec.lid === 'hemisphere_dome' ? 0.044 : spec.lid === 'flip_cap_clear' ? 0.015 : 0.002
    addStraw(root, bottomY + 0.015, topY + strawTopOffset, spec.strawRadiusM, spec.strawHex)
  }

  return root
}

/** 计算节点树中的真实三角面片总数 */
export function countObjectTriangles(root: THREE.Object3D): number {
  let tris = 0
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const g = mesh.geometry
    if (g.index) {
      tris += g.index.count / 3
    } else {
      const pos = g.getAttribute('position')
      if (pos) tris += pos.count / 3
    }
  })
  return Math.round(tris)
}

export function countObjectMeshes(root: THREE.Object3D): number {
  let count = 0
  root.traverse(obj => {
    if ((obj as THREE.Mesh).isMesh) count += 1
  })
  return count
}

export function measureDrinkBounds(root: THREE.Object3D): DrinkPropBounds {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const size = new THREE.Vector3()
  box.getSize(size)
  return {
    widthM: Number(size.x.toFixed(4)),
    heightM: Number(size.y.toFixed(4)),
    depthM: Number(size.z.toFixed(4)),
    minY: Number(box.min.y.toFixed(4)),
    maxY: Number(box.max.y.toFixed(4)),
  }
}

export function inspectDrinkCatalogProps(opts: DrinkBuildOptions = {}): DrinkPropReportItem[] {
  return DRINK_IDS.map(id => {
    const spec = DRINK_CATALOG[id]
    const mesh = buildDrinkProp(id, opts)
    const report: DrinkPropReportItem = {
      id,
      name: spec.name,
      category: spec.category,
      stationKind: spec.stationKind,
      silhouette: spec.silhouette,
      lid: spec.lid,
      cupMl: spec.cupMl,
      triangles: countObjectTriangles(mesh),
      meshes: countObjectMeshes(mesh),
      bounds: measureDrinkBounds(mesh),
    }
    disposeDrinkProp(mesh)
    return report
  })
}

export function buildAllDrinksShowcaseGroup(
  opts: DrinkBuildOptions & { spacingM?: number; columns?: number; rowSpacingM?: number } = {},
): THREE.Group {
  const spacing = opts.spacingM ?? 0.145
  const rowSpacing = opts.rowSpacingM ?? 0.19
  const cols = opts.columns ?? 10
  const group = new THREE.Group()
  group.name = 'drinks_showcase_menu'
  const totalCols = Math.min(cols, DRINK_IDS.length)
  const rows = Math.ceil(DRINK_IDS.length / totalCols)
  DRINK_IDS.forEach((id, idx) => {
    const col = idx % totalCols
    const row = Math.floor(idx / totalCols)
    const cup = buildDrinkProp(id, opts)
    const bounds = measureDrinkBounds(cup)
    const x = (col - (totalCols - 1) * 0.5) * spacing
    const z = (row - (rows - 1) * 0.5) * rowSpacing
    cup.position.set(x, -bounds.minY, z)
    cup.rotation.y = -0.18 + (idx % 3) * 0.1
    group.add(cup)
  })
  return group
}

export function attachDrinkToHand(
  drinkGroup: THREE.Group,
  handAnchor: THREE.Object3D,
  opts?: { offset?: readonly [number, number, number]; rotation?: readonly [number, number, number] },
): THREE.Group {
  const [ox, oy, oz] = opts?.offset ?? DRINK_HAND_GRIP.offset
  const [rx, ry, rz] = opts?.rotation ?? DRINK_HAND_GRIP.rotation
  drinkGroup.position.set(ox, oy, oz)
  drinkGroup.rotation.set(rx, ry, rz)
  handAnchor.add(drinkGroup)
  return drinkGroup
}

export function disposeDrinkProp(root: THREE.Object3D): void {
  root.removeFromParent()
  const disposedGeoms = new Set<THREE.BufferGeometry>()
  const disposedMats = new Set<THREE.Material>()
  const disposedTexs = new Set<THREE.Texture>()
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    if (mesh.geometry && !disposedGeoms.has(mesh.geometry)) {
      disposedGeoms.add(mesh.geometry)
      mesh.geometry.dispose()
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      if (!m || disposedMats.has(m)) continue
      disposedMats.add(m)
      const std = m as THREE.MeshStandardMaterial
      if (std.map && !disposedTexs.has(std.map)) {
        disposedTexs.add(std.map)
        std.map.dispose()
      }
      m.dispose()
    }
  })
}
