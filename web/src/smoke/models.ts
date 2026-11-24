/**
 * 香烟 / 烟盒 / 打火机的程序化建模。
 *
 * 全部在运行时用 three.js 画出来，不依赖任何美术资源（烟盒上的包装是 Canvas 画的），
 * 这样和项目里 qingju 电车那套「零二进制素材」的做法一致。
 *
 * 尺寸全部按真实毫米换算成米：
 *   香烟 Ø7.9 mm × 84.5 mm，过滤嘴 25 mm；
 *   软包烟盒 58 × 89 × 23 mm；
 *   一次性打火机 24.5 × 48 × 11.8 mm。
 *
 * 局部坐标约定：
 *   香烟 —— 原点在手指夹住的位置，+Z 指向燃烧的那一头；
 *   烟盒 —— 原点在盒子中心，+Y 朝上，+Z 是包装正面；
 *   打火机 —— 原点在机身中心，+Y 朝上（火焰方向）。
 */

import * as THREE from 'three'
import {type BrandDef} from './data'

export const CIG_LENGTH = 0.0845
export const CIG_RADIUS = 0.00395
export const CIG_FILTER = 0.025
/** 手指夹持点在过滤嘴中间，所以纸烟从 z=0.005 开始 */
const PAPER_START = 0.005
const PAPER_FULL = CIG_LENGTH - CIG_FILTER
export const PACK_W = 0.058
export const PACK_H = 0.089
export const PACK_D = 0.023
export const LIGHTER_H = 0.048
export const LIGHTER_W = 0.0245
export const LIGHTER_D = 0.0118
/** 打火机火焰尖端相对机身中心的高度 */
export const LIGHTER_NOZZLE_Y = 0.0345
export const LIGHTER_FLAME_TIP = 0.062

/* --------------------------------------------------------------------- 贴图 */

let glowTexture: THREE.Texture | undefined
/** 和导出的 filterTexture() 同名会撞声明，这里用缓存变量 */
let cachedFilterTexture: THREE.Texture | undefined

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

/** 过滤嘴的软木纹 */
export function filterTexture(): THREE.Texture {
  if (cachedFilterTexture) return cachedFilterTexture
  const size = 64
  const canvas = makeCanvas(size, size)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#d9b98d'
  ctx.fillRect(0, 0, size, size)
  let seed = 20240211
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let i = 0; i < 420; i++) {
    const shade = random()
    ctx.fillStyle = shade < 0.5 ? `rgba(150,110,64,${0.25 + random() * 0.5})` : `rgba(255,238,205,${0.2 + random() * 0.4})`
    ctx.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(2, 1)
  texture.needsUpdate = true
  cachedFilterTexture = texture
  return texture
}

/** 加法混合用的软光斑（火星、火苗的辉光） */
export function glowSpriteTexture(): THREE.Texture {
  if (glowTexture) return glowTexture
  const size = 128
  const canvas = makeCanvas(size, size)
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.22, 'rgba(255,236,196,0.72)')
  gradient.addColorStop(0.55, 'rgba(255,168,88,0.22)')
  gradient.addColorStop(1, 'rgba(255,140,60,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  glowTexture = texture
  return texture
}

/* --------------------------------------------------------------- 资源回收表 */

/** 一堆几何体 + 材质 + 纹理，dispose 时统一释放 */
export class Parts {
  private textures: THREE.Texture[] = []
  texture(t:THREE.Texture){this.textures.push(t);return t}
  private geometries: THREE.BufferGeometry[] = []
  private materials: THREE.Material[] = []

  geo<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry)
    return geometry
  }

  mat<T extends THREE.Material>(material: T): T {
    this.materials.push(material)
    return material
  }

  dispose() {
    for(const t of this.textures)t.dispose()
    this.textures.length=0
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
    this.geometries.length = 0
    this.materials.length = 0
  }
}

/* ----------------------------------------------------------------- 烟盒 */

export interface PackModel {
  group: THREE.Group
  /** 盖子节点：绕 X 轴正转 = 打开 */
  lid: THREE.Group
  /** 从盒口探出来的那根烟（取烟时露头） */
  filters: THREE.Mesh[]
  seal: THREE.Mesh
  peek: THREE.Object3D
  parts: Parts
}

export function createPack(brand: BrandDef, parts = new Parts()): PackModel {
  const group = new THREE.Group()
  group.name = 'smoke-pack'

  const canvas=makeCanvas(192,288)
  const ctx=canvas.getContext('2d')!
  ctx.fillStyle=brand.pack;ctx.fillRect(0,0,192,288)
  ctx.fillStyle=brand.accent;ctx.font='bold 32px serif';ctx.textAlign='center';ctx.fillText(brand.name,96,165)
  const face=parts.texture(brand.faceTexture?new THREE.TextureLoader().load(brand.faceTexture):new THREE.CanvasTexture(canvas))
  face.colorSpace=THREE.SRGBColorSpace
  const front = parts.mat(
    new THREE.MeshStandardMaterial({map: face, roughness: 0.82, metalness: 0.04}),
  )
  const side = parts.mat(
    new THREE.MeshStandardMaterial({color: brand.pack, roughness: 0.86, metalness: 0.02}),
  )
  const top = parts.mat(new THREE.MeshStandardMaterial({color: brand.lid, roughness: 0.88}))
  const bottom = parts.mat(new THREE.MeshStandardMaterial({color: brand.pack, roughness: 0.9}))
  // BoxGeometry 的材质顺序：+X, -X, +Y, -Y, +Z(正面), -Z(背面)
  const bodyGeometry = parts.geo(new THREE.BoxGeometry(PACK_W, PACK_H - 0.006, PACK_D))
  const body = new THREE.Mesh(bodyGeometry, [side, side, top, bottom, front, side])
  body.position.y = -0.003
  group.add(body)

  // 盖子：铰链在后上方，绕 X 轴负向转起来（往背后翻）
  const lidHeight = 0.019
  const lid = new THREE.Group()
  lid.position.set(0, PACK_H / 2 - 0.003 - lidHeight, PACK_D / 2)
  const lidGeometry = parts.geo(new THREE.BoxGeometry(PACK_W + 0.0006, lidHeight, PACK_D + 0.0006))
  const lidMesh = new THREE.Mesh(lidGeometry, [side, side, top, top, front, side])
  lidMesh.position.set(0, lidHeight / 2, -PACK_D / 2)
  lid.add(lidMesh)
  group.add(lid)

  // 盒口探出的烟头：取烟动画时露出来，平时缩进去
  const peek = new THREE.Group()
  peek.position.set(0.006, PACK_H / 2 - 0.004, 0)
  const peekPaper = new THREE.Mesh(
    parts.geo(new THREE.CylinderGeometry(CIG_RADIUS, CIG_RADIUS, 0.02, 8, 1, true)),
    parts.mat(new THREE.MeshStandardMaterial({color: 0xf2ece0, roughness: 0.94, side: THREE.DoubleSide})),
  )
  // 圆柱默认沿 +Y，往上一挪就有一截烟头从盒口探出来
  peekPaper.position.y = 0.008
  peek.add(peekPaper)
  peek.visible = false
  group.add(peek)

  const seal=new THREE.Mesh(parts.geo(new THREE.BoxGeometry(.003,PACK_H,.0006)),
    parts.mat(new THREE.MeshStandardMaterial({color:0xf5ecc4,transparent:true,opacity:.65})))
  seal.position.set(.018,0,PACK_D/2+.001);group.add(seal)
  const filterGeo=parts.geo(new THREE.CylinderGeometry(.00325,.00325,.008,12))
  const filterMat=parts.mat(new THREE.MeshStandardMaterial({color:brand.tip}))
  const filters:THREE.Mesh[]=[]
  for(let i=0;i<20;i++){
    const row=Math.floor(i/7), col=i%7
    const filter=new THREE.Mesh(filterGeo,filterMat)
    filter.position.set((col-3+(row===2?.5:0))*.0073,.038,row*.007-.007)
    filters.push(filter);group.add(filter)
  }
  const tip=new THREE.Mesh(filterGeo,filterMat)
  tip.position.y=.022;peek.add(tip)
  return {group, lid, peek, seal, filters,parts}
}

/* --------------------------------------------------------------- 一根香烟 */

export interface CigaretteModel {
  group: THREE.Group
  /** 0..1：烟身还剩多少（1 = 全长，0 = 只剩过滤嘴） */
  setLength(t: number): void
  /** 0..1：火星亮度 */
  setEmber(on: number): void
  /** 火星的世界坐标（发烟的点） */
  tipWorld(out: THREE.Vector3): THREE.Vector3
  parts: Parts
}

export function createCigarette(brand: BrandDef, parts = new Parts()): CigaretteModel {
  const group = new THREE.Group()
  group.name = 'smoke-cigarette'

  // 过滤嘴：从 z=-0.020 到 z=0.005（正好接上烟纸），手指夹在原点附近
  const filter = new THREE.Mesh(
    parts.geo(new THREE.CylinderGeometry(CIG_RADIUS, CIG_RADIUS, CIG_FILTER, 10, 1).rotateX(Math.PI / 2)),
    parts.mat(new THREE.MeshStandardMaterial({map: filterTexture(), color: brand.tip, roughness: 0.95})),
  )
  filter.position.z = PAPER_START - CIG_FILTER / 2
  group.add(filter)

  // 过滤嘴和烟纸之间的金圈
  const band = new THREE.Mesh(
    parts.geo(new THREE.CylinderGeometry(CIG_RADIUS * 1.04, CIG_RADIUS * 1.04, 0.0022, 10, 1).rotateX(Math.PI / 2)),
    parts.mat(new THREE.MeshStandardMaterial({color: 0xd8b878, roughness: 0.45, metalness: 0.55})),
  )
  band.position.z = PAPER_START + 0.0011
  group.add(band)

  // 烟纸：单位烟囱从 z=0 到 z=1，靠 scale.z 缩短
  const paper = new THREE.Mesh(
    parts.geo(new THREE.CylinderGeometry(CIG_RADIUS, CIG_RADIUS, 1, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5)),
    parts.mat(new THREE.MeshStandardMaterial({color: 0xf6f1e6, roughness: 0.96, side: THREE.DoubleSide})),
  )
  paper.position.z = PAPER_START
  group.add(paper)

  // 焦黑的一小段，紧贴火星后面（半径比烟纸略大，才不会被烟纸盖住）
  const char = new THREE.Mesh(
    parts.geo(new THREE.CylinderGeometry(CIG_RADIUS * 1.03, CIG_RADIUS * 1.03, 1, 8, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5)),
    parts.mat(
      new THREE.MeshStandardMaterial({color: 0x2a2420, roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.92}),
    ),
  )
  group.add(char)

  // 火星：一个朝 +Z 的圆面 + 一圈辉光
  const emberMaterial = parts.mat(new THREE.MeshBasicMaterial({color: brand.ember, toneMapped: false}))
  const ember = new THREE.Mesh(parts.geo(new THREE.CircleGeometry(CIG_RADIUS * 0.94, 12)), emberMaterial)
  group.add(ember)
  const emberRing = new THREE.Mesh(
    parts.geo(new THREE.RingGeometry(CIG_RADIUS * 0.9, CIG_RADIUS * 1.08, 12)),
    parts.mat(new THREE.MeshBasicMaterial({color: 0x8a3a12, transparent: true, opacity: 0.9, toneMapped: false})),
  )
  emberRing.position.z = -0.0002
  group.add(emberRing)

  const glow = new THREE.Sprite(
    parts.mat(
      new THREE.SpriteMaterial({
        fog: false,
        map: glowSpriteTexture(),
        color: brand.ember,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    ),
  )
  glow.scale.setScalar(0.03)
  group.add(glow)

  let emberStrength = 0
  let paperLength = PAPER_FULL
  let lastLength = 1

  function layout() {
    const length = Math.max(0.0004, paperLength)
    paper.scale.z = length
    char.scale.z = Math.min(0.006, length)
    const tipZ = PAPER_START + length
    char.position.z = tipZ - Math.min(0.006, length)
    ember.position.z = tipZ + 0.0001
    emberRing.position.z = tipZ - 0.0002
    glow.position.z = tipZ + 0.001
    paper.visible = paperLength > 0.0012
    char.visible = paper.visible
    ember.visible = paper.visible && emberStrength > 0.01
    emberRing.visible = paper.visible
  }

  layout()

  return {
    group,
    setLength(t: number) {
      const next = Math.max(0, Math.min(1, t))
      if (Math.abs(next - lastLength) < 0.0015) return
      lastLength = next
      paperLength = PAPER_FULL * next
      layout()
    },
    setEmber(on: number) {
      emberStrength = Math.max(0, Math.min(1.6, on))
      const bright = Math.min(1, emberStrength)
      emberMaterial.color.setHex(brand.ember)
      emberMaterial.color.multiplyScalar(0.55 + bright * 1.1)
      ;(ember.material as THREE.MeshBasicMaterial).opacity = 1
      const glowMaterial = glow.material as THREE.SpriteMaterial
      glowMaterial.opacity = Math.min(1, emberStrength * 0.85)
      glow.scale.setScalar(0.022 + emberStrength * 0.026)
      layout()
    },
    tipWorld(out: THREE.Vector3) {
      group.updateWorldMatrix(true, false)
      out.set(0, 0, PAPER_START + Math.max(0.0004, paperLength))
      return group.localToWorld(out)
    },
    parts,
  }
}

/* --------------------------------------------------------------- 打火机 */

export interface LighterModel {
  group: THREE.Group
  /** 0..1 火焰强度 */
  setFlame(value: number): void
  /** 火焰尖端（点烟时用来对齐香烟） */
  tipWorld(out: THREE.Vector3): THREE.Vector3
  parts: Parts
}

export function createLighter(parts = new Parts()): LighterModel {
  const group = new THREE.Group()
  group.name = 'smoke-lighter'

  const shell = parts.mat(new THREE.MeshStandardMaterial({color: 0xb4413a, roughness: 0.42, metalness: 0.08}))
  const shellDark = parts.mat(new THREE.MeshStandardMaterial({color: 0x8d322d, roughness: 0.55}))
  const metal = parts.mat(new THREE.MeshStandardMaterial({color: 0xb9c2c6, roughness: 0.3, metalness: 0.85}))
  const glass = parts.mat(
    new THREE.MeshStandardMaterial({color: 0xf0d9b8, roughness: 0.3, transparent: true, opacity: 0.42}),
  )

  const body = new THREE.Mesh(parts.geo(new THREE.BoxGeometry(LIGHTER_W, LIGHTER_H, LIGHTER_D)), shell)
  group.add(body)
  // 底盖
  const cap = new THREE.Mesh(parts.geo(new THREE.BoxGeometry(LIGHTER_W * 1.02, 0.006, LIGHTER_D * 1.02)), shellDark)
  cap.position.y = -LIGHTER_H / 2 + 0.003
  group.add(cap)
  // 油窗
  const sight = new THREE.Mesh(
    parts.geo(new THREE.BoxGeometry(LIGHTER_W * 0.52, LIGHTER_H * 0.52, 0.0012)),
    glass,
  )
  sight.position.set(0, -0.004, LIGHTER_D / 2 + 0.0002)
  group.add(sight)
  // 金属防风罩
  const hood = new THREE.Mesh(parts.geo(new THREE.BoxGeometry(LIGHTER_W * 0.78, 0.011, LIGHTER_D * 0.9)), metal)
  hood.position.set(0, LIGHTER_H / 2 + 0.0055, 0.001)
  group.add(hood)
  // 擦火轮
  const wheel = new THREE.Mesh(
    parts.geo(new THREE.CylinderGeometry(0.0042, 0.0042, 0.0095, 12).rotateZ(Math.PI / 2)),
    metal,
  )
  wheel.position.set(0, LIGHTER_H / 2 + 0.0125, 0.001)
  group.add(wheel)
  // 出气嘴
  const nozzle = new THREE.Mesh(parts.geo(new THREE.BoxGeometry(0.005, 0.005, 0.005)), metal)
  nozzle.position.set(0, LIGHTER_H / 2 + 0.0115, -0.0045)
  group.add(nozzle)

  // 火焰：内外两层锥体 + 一圈辉光
  const flame = new THREE.Group()
  flame.position.set(0, LIGHTER_H / 2 + 0.012, -0.0045)
  const outer = new THREE.Mesh(
    parts.geo(new THREE.ConeGeometry(0.0062, 0.026, 8, 1, true)),
    parts.mat(
      new THREE.MeshBasicMaterial({
        color: 0xff9d3c,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    ),
  )
  outer.position.y = 0.013
  flame.add(outer)
  const inner = new THREE.Mesh(
    parts.geo(new THREE.ConeGeometry(0.0032, 0.016, 8, 1, true)),
    parts.mat(
      new THREE.MeshBasicMaterial({
        color: 0xfff0c0,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    ),
  )
  inner.position.y = 0.009
  flame.add(inner)
  const flare = new THREE.Sprite(
    parts.mat(
      new THREE.SpriteMaterial({
        fog: false,
        map: glowSpriteTexture(),
        color: 0xffb066,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    ),
  )
  flare.scale.setScalar(0.055)
  flare.position.y = 0.012
  flame.add(flare)
  flame.visible = false
  group.add(flame)

  let intensity = 0
  function apply() {
    const on = intensity > 0.01
    flame.visible = on
    if (!on) return
    const wobble = 0.86 + Math.sin(performance.now() * 0.021) * 0.08 + Math.sin(performance.now() * 0.037) * 0.05
    outer.scale.set(0.8 + intensity * 0.35, intensity * wobble, 0.8 + intensity * 0.35)
    inner.scale.set(0.85 + intensity * 0.25, intensity * wobble * 1.1, 0.85 + intensity * 0.25)
    ;(outer.material as THREE.MeshBasicMaterial).opacity = 0.72 * Math.min(1, intensity)
    ;(inner.material as THREE.MeshBasicMaterial).opacity = 0.9 * Math.min(1, intensity)
    ;(flare.material as THREE.SpriteMaterial).opacity = Math.min(1, intensity) * 0.75
    flare.scale.setScalar(0.04 + intensity * 0.03)
  }

  return {
    group,
    setFlame(value: number) {
      intensity = Math.max(0, Math.min(1, value))
      apply()
    },
    tipWorld(out: THREE.Vector3) {
      group.updateWorldMatrix(true, false)
      out.set(0, LIGHTER_H / 2 + 0.012 + 0.024 * Math.max(0.2, intensity), -0.0045)
      return group.localToWorld(out)
    },
    parts,
  }
}

/* ------------------------------------------------------------- 掉地上的烟蒂 */

export function createStub(brand: BrandDef, parts = new Parts()): THREE.Group {
  const group = new THREE.Group()
  group.name = 'smoke-stub'
  const filter = new THREE.Mesh(
    parts.geo(new THREE.CylinderGeometry(CIG_RADIUS, CIG_RADIUS, CIG_FILTER, 8).rotateZ(Math.PI / 2)),
    parts.mat(new THREE.MeshStandardMaterial({map: filterTexture(), color: brand.tip, roughness: 0.95})),
  )
  group.add(filter)
  const charred = new THREE.Mesh(
    parts.geo(new THREE.CylinderGeometry(CIG_RADIUS * 0.96, CIG_RADIUS * 0.96, 0.008, 8).rotateZ(Math.PI / 2)),
    parts.mat(new THREE.MeshStandardMaterial({color: 0x241f1b, roughness: 1})),
  )
  charred.position.x = CIG_FILTER / 2 + 0.004
  group.add(charred)
  // 躺在地上，稍微歪一点才不像尺子
  group.rotation.z = 0.02
  return group
}

/* --------------------------------------------------------- 第一人称的假手 */

/** 视角里那只握着东西的手：手掌 + 拇指，够用了 */
export function createMitt(skin: string, mirror = false, parts = new Parts()): THREE.Group {
  const group = new THREE.Group()
  group.name = 'smoke-mitt'
  const material = parts.mat(new THREE.MeshStandardMaterial({color: skin, roughness: 0.86}))
  const palm = new THREE.Mesh(parts.geo(new THREE.CapsuleGeometry(0.028, 0.052, 4, 12)), material)
  palm.rotation.z = Math.PI / 2
  palm.scale.set(.82,.68,.55)
  group.add(palm)
  const thumb = new THREE.Mesh(parts.geo(new THREE.CapsuleGeometry(0.011, 0.026, 3, 8)), material)
  thumb.scale.set(.76,.76,.76)
  thumb.position.set(mirror ? -.017 : .017, .021, .006)
  thumb.rotation.z = mirror ? -0.7 : 0.7
  group.add(thumb)
  const digit=parts.geo(new THREE.CapsuleGeometry(.006,.021,3,8))
  for(let i=0;i<4;i++){
    const finger=new THREE.Mesh(digit,material)
    finger.position.set((mirror?-1:1)*(.023-i*.012),.008,.015)
    finger.rotation.x=-.95+i*.16
    if(mirror&&i===0){finger.rotation.z=.76;finger.position.x=-.026}
    group.add(finger)
  }
  return group
}

/* ----------------------------------------------------------------- 烟雾 */

const SMOKE_MAX = 26

const SMOKE_VERTEX = /* glsl */ `
  attribute vec3 aOffset;
  attribute vec3 aTint;
  attribute float aSize;
  attribute float aAlpha;
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    // viewMatrix 的三列就是相机的 right / up / forward，直接用它们做广告牌，
    // 这样不必知道画布分辨率，也不会被父节点的旋转带跑偏。
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 world = aOffset + right * position.x * aSize + up * position.y * aSize;
    // PlaneGeometry(1,1) 的 position.xy 在 -0.5..0.5，直接拿它算 UV，省得依赖 uv 属性
    vUv = position.xy + 0.5;
    vAlpha = aAlpha;
    vTint = aTint;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`

const SMOKE_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;
    float soft = smoothstep(1.0, 0.05, r);
    if (soft <= 0.004) discard;
    gl_FragColor = vec4(vTint, vAlpha * soft);
  }
`

export interface SmokePlume {
  mesh: THREE.Mesh
  /** 在 world 位置放 strength 强度的一缕烟 */
  emit(position: THREE.Vector3, count: number, strength: number): void
  update(dt: number): void
  /** 立刻清空（掐灭 / 烧完） */
  clear(): void
  dispose(): void
}

/**
 * 一小团循环复用的烟。用 InstancedBufferGeometry 手动做广告牌，
 * 一个发射器只有 1 个 draw call，26 个粒子上限足够表现烟头。
 */
export function createSmokePlume(scene: THREE.Scene, warm: number): SmokePlume {
  const geometry = new THREE.InstancedBufferGeometry()
  const quad = new THREE.PlaneGeometry(1, 1)
  geometry.index = quad.index
  geometry.setAttribute('position', quad.getAttribute('position'))
  geometry.instanceCount = SMOKE_MAX

  const offsets = new Float32Array(SMOKE_MAX * 3)
  const tints = new Float32Array(SMOKE_MAX * 3)
  const sizes = new Float32Array(SMOKE_MAX)
  const alphas = new Float32Array(SMOKE_MAX)
  const offsetAttribute = new THREE.InstancedBufferAttribute(offsets, 3)
  const tintAttribute = new THREE.InstancedBufferAttribute(tints, 3)
  const sizeAttribute = new THREE.InstancedBufferAttribute(sizes, 1)
  const alphaAttribute = new THREE.InstancedBufferAttribute(alphas, 1)
  offsetAttribute.setUsage(THREE.DynamicDrawUsage)
  sizeAttribute.setUsage(THREE.DynamicDrawUsage)
  alphaAttribute.setUsage(THREE.DynamicDrawUsage)
  tintAttribute.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('aOffset', offsetAttribute)
  geometry.setAttribute('aTint', tintAttribute)
  geometry.setAttribute('aSize', sizeAttribute)
  geometry.setAttribute('aAlpha', alphaAttribute)
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)

  const material = new THREE.ShaderMaterial({
    vertexShader: SMOKE_VERTEX,
    fragmentShader: SMOKE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'smoke-plume'
  mesh.frustumCulled = false
  mesh.renderOrder = 6
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()
  scene.add(mesh)

  // 粒子状态：位置 / 速度 / 年龄 / 寿命 / 大小 / 色调
  const px = new Float32Array(SMOKE_MAX)
  const py = new Float32Array(SMOKE_MAX)
  const pz = new Float32Array(SMOKE_MAX)
  const vx = new Float32Array(SMOKE_MAX)
  const vy = new Float32Array(SMOKE_MAX)
  const vz = new Float32Array(SMOKE_MAX)
  const age = new Float32Array(SMOKE_MAX)
  const life = new Float32Array(SMOKE_MAX)
  const baseSize = new Float32Array(SMOKE_MAX)
  const growth = new Float32Array(SMOKE_MAX)
  const warmth = new Float32Array(SMOKE_MAX)
  let cursor = 0

  for (let i = 0; i < SMOKE_MAX; i++) {
    life[i] = -1
    alphas[i] = 0
    sizes[i] = 0
  }
  offsetAttribute.needsUpdate = true
  alphaAttribute.needsUpdate = true
  sizeAttribute.needsUpdate = true

  const warmColor = new THREE.Color(warm)
  const greyColor = new THREE.Color(0xd7dcdd)
  const scratch = new THREE.Color()

  return {
    mesh,
    emit(position, count, strength) {
      for (let n = 0; n < count; n++) {
        const i = cursor
        cursor = (cursor + 1) % SMOKE_MAX
        px[i] = position.x + (Math.random() - 0.5) * 0.004
        py[i] = position.y + (Math.random() - 0.5) * 0.004
        pz[i] = position.z + (Math.random() - 0.5) * 0.004
        // 烟头附近热气流往上走，被吸的时候更冲
        vy[i] = 0.055 + Math.random() * 0.05 + strength * 0.09
        vx[i] = (Math.random() - 0.5) * 0.05 + strength * 0.04
        vz[i] = (Math.random() - 0.5) * 0.05
        age[i] = 0
        life[i] = 1.5 + Math.random() * 1.5 + strength * 0.7
        baseSize[i] = 0.009 + Math.random() * 0.007 + strength * 0.012
        growth[i] = 0.035 + Math.random() * 0.03 + strength * 0.05
        warmth[i] = Math.max(0, 1 - n / Math.max(1, count))
      }
    },
    update(dt) {
      const step = Math.min(0.2, Math.max(0, dt))
      let dirty = false
      for (let i = 0; i < SMOKE_MAX; i++) {
        if (life[i] < 0) continue
        dirty = true
        age[i] += step
        if (age[i] >= life[i]) {
          life[i] = -1
          alphas[i] = 0
          sizes[i] = 0
          continue
        }
        const t = age[i] / life[i]
        // 上升 + 侧向飘散（越老越散），再叠一点抖动
        py[i] += vy[i] * step
        px[i] += (vx[i] + Math.sin(age[i] * 3.1 + i) * 0.012) * step
        pz[i] += (vz[i] + Math.cos(age[i] * 2.7 + i) * 0.012) * step
        vy[i] *= 1 - 0.6 * step
        offsets[i * 3] = px[i]
        offsets[i * 3 + 1] = py[i]
        offsets[i * 3 + 2] = pz[i]
        sizes[i] = baseSize[i] + growth[i] * t
        // 出生时略透，之后淡出
        alphas[i] = Math.min(1, t * 6) * (1 - t) * 0.55
        scratch.copy(greyColor).lerp(warmColor, warmth[i] * Math.max(0, 0.35 - t))
        tints[i * 3] = scratch.r
        tints[i * 3 + 1] = scratch.g
        tints[i * 3 + 2] = scratch.b
      }
      if (dirty) {
        offsetAttribute.needsUpdate = true
        sizeAttribute.needsUpdate = true
        alphaAttribute.needsUpdate = true
        tintAttribute.needsUpdate = true
      }
    },
    clear() {
      for (let i = 0; i < SMOKE_MAX; i++) {
        life[i] = -1
        alphas[i] = 0
        sizes[i] = 0
      }
      alphaAttribute.needsUpdate = true
      sizeAttribute.needsUpdate = true
    },
    dispose() {
      scene.remove(mesh)
      geometry.dispose()
      material.dispose()
      quad.dispose()
    },
  }
}
