import * as THREE from 'three'
import { DRINK_CATALOG, DRINK_IDS, resolveDrinkPropId, type DrinkId, type DrinkSpec } from './catalog.ts'
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
    opacity: 0.62,
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
      opacity: translucent ? 0.55 : 0.96,
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

function addSundaeSwirlAndToppings(
  group: THREE.Group,
  topY: number,
  topRadius: number,
  accentHex: string,
): void {
  const creamMat = makeMat({ color: '#fff9ed', roughness: 0.32 })
  const fudgeMat = makeMat({ color: '#4c2212', roughness: 0.24 })

  // 3 圈盘旋柔和奶霜塔顶
  const tiers: Array<[number, number, number, number]> = [
    [topY + 0.008, topRadius * 0.82, topRadius * 0.66, 0.02],
    [topY + 0.026, topRadius * 0.64, topRadius * 0.46, 0.019],
    [topY + 0.043, topRadius * 0.44, topRadius * 0.18, 0.018],
  ]
  for (const [y, rBot, rTop, h] of tiers) {
    const swirl = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 14), creamMat)
    swirl.position.y = y
    group.add(swirl)
  }
  // 顶尖俏皮弯曲收尖
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.022, 10), creamMat)
  tip.position.set(-0.002, topY + 0.058, 0.002)
  tip.rotation.z = 0.24
  group.add(tip)

  // 黑曲奇碎末点缀奶霜腰线
  addDiceCubes(group, topY - 0.008, 0.012, topRadius * 0.72, 7, 0.0065, '#2b1f1a', 1)

  // 一抹深巧克酱滴流圈
  const drizzle = new THREE.Mesh(new THREE.TorusGeometry(topRadius * 0.68, 0.0032, 4, 10), fudgeMat)
  drizzle.rotation.x = Math.PI / 2 + 0.08
  drizzle.position.y = topY + 0.013
  group.add(drizzle)

  // 斜插酥脆蛋卷饼干棒
  const wafer = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0055, 0.005, 0.058, 6),
    makeMat({ color: '#ce8f45', roughness: 0.58 }),
  )
  wafer.position.set(0.014, topY + 0.036, -0.006)
  wafer.rotation.z = -0.44
  wafer.rotation.x = -0.18
  group.add(wafer)

  // 原创红色扁平甜品小勺（与 7 款吸管杯一眼区分）
  const spoonMat = makeMat({ color: accentHex, roughness: 0.35 })
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.068, 0.0022), spoonMat)
  handle.position.set(-0.018, topY + 0.033, 0.008)
  handle.rotation.z = 0.36
  handle.rotation.y = 0.25
  const scoop = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 6, 4), spoonMat)
  scoop.scale.set(1, 0.35, 1.35)
  scoop.position.set(-0.006, topY + 0.003, 0.004)
  group.add(handle, scoop)
}

/**
 * 构建单杯饮品 3D 道具模型：
 * - 局部原点 `(0, 0, 0)` 对齐右手掌心握持点
 * - `+Y` 朝杯口方向，`-Z` 为杯身主徽章正面
 */
export function buildDrinkProp(idOrSku: DrinkId | (string & {}), opts: DrinkBuildOptions = {}): THREE.Group {
  const id: DrinkId = resolveDrinkPropId(idOrSku) ?? 'lemonade'
  const spec = DRINK_CATALOG[id]
  const skin = resolveDrinkSkin(opts.skin)
  const root = new THREE.Group()
  root.name = `drink_prop_${id}`
  root.userData.drinkId = id
  root.userData.drinkName = spec.name
  root.userData.skinId = skin.id
  root.userData.handOffset = DRINK_HAND_GRIP.offset
  root.userData.handRotation = DRINK_HAND_GRIP.rotation

  const h = spec.cupHeightM
  const yCenter = -spec.handGripYOffsetM
  const bottomY = yCenter - h * 0.5
  const topY = yCenter + h * 0.5
  const rTop = spec.topRadiusM
  const rBot = spec.bottomRadiusM

  // 1) 外杯壳（透明 PET / 磨砂 PP 材质，renderOrder = 3，depthWrite = false 避免遮挡内部水果珍珠）
  const isFrosted = spec.silhouette === 'frosted_slender'
  const isOpaqueCup = spec.silhouette === 'sundae_bowl'
  const cupOuterMat = makeMat({
    color: isOpaqueCup ? skin.creamHex : skin.cupTintHex,
    roughness: isFrosted ? 0.48 : isOpaqueCup ? 0.42 : 0.14,
    transparent: !isOpaqueCup,
    opacity: isOpaqueCup ? 1 : isFrosted ? 0.42 : 0.28,
    depthWrite: isOpaqueCup,
    side: isOpaqueCup ? THREE.DoubleSide : THREE.FrontSide,
  })
  const cupRadiusSegments = 12
  const cupShell = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, cupRadiusSegments, 1, spec.lid === 'open_swirl'), cupOuterMat)
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

  // 2) 内部饮品液面 / 基底层次
  const innerGroup = new THREE.Group()
  innerGroup.name = 'drink_contents'
  root.add(innerGroup)

  const fillFrac = spec.id === 'sundae_cone' ? 0.88 : spec.id === 'grape_cheesefoam' ? 0.72 : 0.84
  const fillH = (h - 0.012) * fillFrac
  const rLiqTop = THREE.MathUtils.lerp(rBot, rTop, fillFrac) * 0.92
  const rLiqBot = rBot * 0.91

  let liqTex: THREE.Texture | null = null
  if (spec.id === 'brown_sugar_boba' || spec.id === 'sundae_cone') {
    liqTex = createCaramelSwirlTexture(spec.liquidHex, spec.liquidSecondaryHex)
  }
  const liquidMat = makeMat({
    color: liqTex ? '#ffffff' : spec.liquidHex,
    ...(liqTex ? { map: liqTex } : {}),
    roughness: spec.id === 'sundae_cone' ? 0.36 : 0.24,
    transparent: spec.liquidOpacity < 1,
    opacity: spec.liquidOpacity,
  })
  const liquidMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(rLiqTop, rLiqBot, fillH, 12),
    liquidMat,
  )
  liquidMesh.position.y = bottomY + 0.005 + fillH * 0.5
  liquidMesh.renderOrder = 1
  innerGroup.add(liquidMesh)

  // 3) 专属配料 & 分层识别特征（确保 8 款饮品从任何视角都能一眼分辨）
  if (spec.id === 'lemonade') {
    addIceCluster(innerGroup, topY - 0.036, rLiqTop * 0.72, 6, '#eefaff')
    const s1 = makeLemonSlice('#ebba00', '#fff078')
    s1.position.set(-0.01, yCenter + 0.024, 0.008)
    s1.rotation.set(0.92, 0.35, -0.48)
    const s2 = makeLemonSlice('#e5ae00', '#ffea66')
    s2.position.set(0.011, yCenter + 0.006, -0.009)
    s2.rotation.set(-0.78, 0.42, 0.55)
    innerGroup.add(s1, s2)
  } else if (spec.id === 'passion_fruit') {
    addPearlLayer(innerGroup, bottomY + 0.011, rLiqBot * 0.76, 6, '#23150e', 0.0046)
    addDiceCubes(innerGroup, bottomY + 0.02, 0.025, rLiqBot * 0.78, 5, 0.007, '#fff6df', 0.88)
    // 悬浮百香果黑籽（分布于中上层）
    addPearlLayer(innerGroup, yCenter - 0.01, rLiqTop * 0.76, 8, '#24140a', 0.0024, 0.65)
    const lime = makeLimeWedge('#59a92c', '#d5eb6e')
    lime.position.set(0.008, topY - 0.044, -0.008)
    lime.rotation.set(0.75, 0.4, 0.5)
    addIceCluster(innerGroup, topY - 0.036, rLiqTop * 0.62, 4, '#fff6d8')
    innerGroup.add(lime)
  } else if (spec.id === 'mango_pomelo') {
    // 明确包裹于茶液外围的厚奶白椰浆中上层环带（避免被同半径芒果液柱遮挡）
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
    // 底部西米白珠 + 上层外沿鲜橙芒果块与高对比珊瑚红西柚果粒
    addPearlLayer(innerGroup, bottomY + 0.011, rLiqBot * 0.78, 8, '#fffcf2', 0.0032)
    addDiceCubes(innerGroup, topY - 0.036, 0.016, rTop * 0.78, 5, 0.009, '#ff9d00', 1)
    addDiceCubes(innerGroup, topY - 0.032, 0.018, rTop * 0.8, 5, 0.0072, '#ff4538', 1)
  } else if (spec.id === 'brown_sugar_boba') {
    addPearlLayer(innerGroup, bottomY + 0.012, rLiqBot * 0.76, 9, '#1f120b', 0.0056)
    const milkCap = new THREE.Mesh(
      new THREE.CylinderGeometry(rLiqTop * 0.99, rLiqTop * 0.97, 0.016, 12),
      makeMat({ color: '#fbf4e8', roughness: 0.32 }),
    )
    milkCap.position.y = bottomY + 0.005 + fillH + 0.004
    innerGroup.add(milkCap)
  } else if (spec.id === 'four_seasons_milk') {
    // 底部水晶脆波波 + 椰果丁
    addPearlLayer(innerGroup, bottomY + 0.011, rLiqBot * 0.75, 7, '#f5efe2', 0.0044)
    addDiceCubes(innerGroup, bottomY + 0.018, 0.016, rLiqBot * 0.75, 5, 0.0065, '#f2e8c9', 0.85)
    // 茶青标示环带
    const oolongRing = new THREE.Mesh(
      new THREE.CylinderGeometry(rLiqTop * 0.98, rLiqTop * 0.96, 0.014, 12),
      makeMat({ color: spec.accentHex, roughness: 0.42 }),
    )
    oolongRing.position.y = bottomY + 0.005 + fillH * 0.94
    innerGroup.add(oolongRing)
  } else if (spec.id === 'grape_cheesefoam') {
    // 底层深紫葡萄果酱 + 整颗剥皮葡萄球
    const jamLayer = new THREE.Mesh(
      new THREE.CylinderGeometry(rLiqBot * 1.04, rLiqBot * 0.98, 0.028, 12),
      makeMat({ color: '#4d1852', roughness: 0.28 }),
    )
    jamLayer.position.y = bottomY + 0.02
    innerGroup.add(jamLayer)
    addPearlLayer(innerGroup, bottomY + 0.028, rLiqBot * 0.72, 6, '#6d2573', 0.0068)
    // 顶部厚厚一层咸甜芝士奶盖
    const foamTopY = bottomY + 0.005 + fillH
    const foamH = 0.024
    const cheeseFoam = new THREE.Mesh(
      new THREE.CylinderGeometry(rTop * 0.93, rLiqTop * 0.98, foamH, 12),
      makeMat({ color: '#fff7e8', roughness: 0.36 }),
    )
    cheeseFoam.position.y = foamTopY + foamH * 0.5
    innerGroup.add(cheeseFoam)
  } else if (spec.id === 'peach_oolong') {
    addDiceCubes(innerGroup, bottomY + 0.011, 0.018, rLiqBot * 0.84, 5, 0.009, '#e93860', 1)
    addDiceCubes(innerGroup, topY - 0.044, 0.018, rLiqTop * 0.82, 5, 0.009, '#fff1df', 1)
    addDiceCubes(innerGroup, yCenter + 0.024, 0.014, rLiqTop * 0.8, 4, 0.008, '#ff738f', 1)
    addIceCluster(innerGroup, topY - 0.03, rLiqTop * 0.64, 4, '#fff6f8')
  } else if (spec.id === 'sundae_cone') {
    addSundaeSwirlAndToppings(root, topY, rTop, spec.accentHex)
  }

  // 4) 隔离皮肤杯套贴花（默认居中偏下，可通过 includeSleeve: false 关闭）
  if (spec.hasSleeve && opts.includeSleeve !== false) {
    const sleeveH = h * 0.3
    const sleeveY = yCenter - h * 0.09
    const fracBot = (sleeveY - sleeveH * 0.5 - bottomY) / h
    const fracTop = (sleeveY + sleeveH * 0.5 - bottomY) / h
    const sleeveRBot = THREE.MathUtils.lerp(rBot, rTop, fracBot) * 1.022
    const sleeveRTop = THREE.MathUtils.lerp(rBot, rTop, fracTop) * 1.022
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

  // 5) 杯盖与吸管
  if (spec.lid === 'heat_seal_red') {
    addHeatSealLid(root, topY, rTop, skin.sealFilmHex, false)
  } else if (spec.lid === 'heat_seal_clear') {
    addHeatSealLid(root, topY, rTop, '#ffffff', true)
  } else if (spec.lid === 'flip_cap_clear') {
    addFlipSipLid(root, topY, rTop)
  }

  if (spec.strawHex && opts.includeStraw !== false) {
    addStraw(root, bottomY + 0.015, topY + (spec.lid === 'flip_cap_clear' ? 0.014 : 0.002), spec.strawRadiusM, spec.strawHex)
  }

  return root
}

/** 计算节点树中的真实三角面片总数（含缩放与子网格） */
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
  opts: DrinkBuildOptions & { spacingM?: number; columns?: number } = {},
): THREE.Group {
  const spacing = opts.spacingM ?? 0.145
  const cols = opts.columns ?? 8
  const group = new THREE.Group()
  group.name = 'drinks_showcase_8'
  const totalCols = Math.min(cols, DRINK_IDS.length)
  const rows = Math.ceil(DRINK_IDS.length / totalCols)
  DRINK_IDS.forEach((id, idx) => {
    const col = idx % totalCols
    const row = Math.floor(idx / totalCols)
    const cup = buildDrinkProp(id, opts)
    const bounds = measureDrinkBounds(cup)
    const x = (col - (totalCols - 1) * 0.5) * spacing
    const z = (row - (rows - 1) * 0.5) * spacing
    cup.position.set(x, -bounds.minY, z)
    cup.rotation.y = -0.22 + (idx % 3) * 0.11
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
