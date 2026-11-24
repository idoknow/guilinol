import * as T from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import type {CameraBody} from './cameras'

// 相机机身模型（IDOK-182）。
//
// 两套来源：
//   1. 程序化占位（下面这些 build* 函数）——细节按真机特征堆：机身分色、拨盘、快门键、
//      热靴、镜头对焦环/光圈环、卡口、屏幕、麦克风孔、接口盖、云台三轴、磁吸夹。
//   2. glTF 覆盖——`public/models/cameras/<id>.glb` 存在就用它（sg claude 交付的高模），
//      按 `manifest.json` 里的 scale / handOffset / handRot 应用；加载失败就静默回落到占位。
//
// 坐标约定：原点 = 握持点，镜头朝 -Z，机身顶面朝 +Y，右手柄在 +X。单位是米。

const CAMERA_MODEL_ROOT = './models/cameras/'

type ManifestEntry = {scale?: number; handOffset?: [number, number, number]; handRot?: [number, number, number]}
type Manifest = Record<string, ManifestEntry>

let manifestPromise: Promise<Manifest> | undefined

function loadManifest(): Promise<Manifest> {
  manifestPromise ??= fetch(`${CAMERA_MODEL_ROOT}manifest.json`)
    .then(response => (response.ok ? response.json() : {}))
    .catch(() => ({}))
  return manifestPromise
}

const materialCache = new Map<string, T.MeshStandardMaterial>()

function tuneCameraMaterial(material: T.MeshStandardMaterial) {
  // 主场景无 IBL envMap，高 metalness 会把漫反射压到近黑；压低金属度并加柔和自色底亮，保证白天与夜晚轮廓均清晰可辨。
  material.metalness = Math.min(material.metalness, 0.22)
  material.roughness = Math.max(material.roughness, 0.16)
  material.emissive.copy(material.color)
  material.emissiveIntensity = 0.28
}

function mat(color: string, roughness: number, metalness = 0.2): T.MeshStandardMaterial {
  const cappedMetal = Math.min(metalness, 0.28)
  const key = `${color}|${roughness}|${cappedMetal}`
  let material = materialCache.get(key)
  if (!material) {
    material = new T.MeshStandardMaterial({color, roughness, metalness: cappedMetal, envMapIntensity: 0.8})
    tuneCameraMaterial(material)
    materialCache.set(key, material)
  }
  return material
}

function box(w: number, h: number, d: number, color: string, roughness = 0.62, metalness = 0.2): T.Mesh {
  return new T.Mesh(new T.BoxGeometry(w, h, d), mat(color, roughness, metalness))
}

function cyl(radius: number, height: number, color: string, segments = 20, roughness = 0.5, metalness = 0.35): T.Mesh {
  return new T.Mesh(new T.CylinderGeometry(radius, radius, height, segments), mat(color, roughness, metalness))
}

/** 拨盘：圆柱 + 顶部滚花（8 个薄片，够远看有“齿”） */
function dial(radius: number, height: number, color: string, knurl: string): T.Group {
  const group = new T.Group()
  group.add(cyl(radius, height, color, 18, 0.55, 0.4))
  for (let i = 0; i < 8; i += 1) {
    const tooth = box(radius * 0.28, height * 0.7, radius * 0.22, knurl, 0.7, 0.15)
    const angle = (i / 8) * Math.PI * 2
    tooth.position.set(Math.cos(angle) * radius * 0.92, 0, Math.sin(angle) * radius * 0.92)
    tooth.rotation.y = -angle
    group.add(tooth)
  }
  return group
}

/** 镜头筒：镜身 + 对焦环 + 光圈环 + 前口 + 镜片 + 遮光罩 */
function lensBarrel(body: CameraBody): T.Group {
  const group = new T.Group()
  const radius = body.lens?.radius ?? 0.03
  const length = body.lens?.length ?? 0.06
  const shell = cyl(radius, length, body.color.body, 28, 0.42, 0.45)
  shell.rotation.x = Math.PI / 2
  group.add(shell)
  const focus = cyl(radius * 1.06, length * 0.2, body.color.grip, 26, 0.85, 0.1)
  focus.rotation.x = Math.PI / 2
  focus.position.z = length * 0.24
  group.add(focus)
  const apertureRing = cyl(radius * 1.03, length * 0.09, body.color.metal, 26, 0.4, 0.7)
  apertureRing.rotation.x = Math.PI / 2
  apertureRing.position.z = -length * 0.16
  group.add(apertureRing)
  const front = cyl(radius * 1.12, length * 0.06, body.color.metal, 28, 0.35, 0.8)
  front.rotation.x = Math.PI / 2
  front.position.z = -length / 2
  group.add(front)
  const glass = new T.Mesh(new T.SphereGeometry(radius * 0.78, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2.1), mat('#101820', 0.06, 0.95))
  glass.rotation.x = -Math.PI / 2
  glass.position.z = -length / 2 - radius * 0.18
  group.add(glass)
  for (const side of [-1, 1]) {
    const gripRib = box(radius * 0.14, radius * 0.5, length * 0.5, body.color.grip, 0.9, 0.05)
    gripRib.position.set(side * radius * 0.98, 0, length * 0.1)
    group.add(gripRib)
  }
  return group
}

function buildMirrorless(body: CameraBody): T.Group {
  const root = new T.Group()
  const [w, h, d] = body.size
  const shell = box(w, h, d, body.color.body, 0.5, 0.35)
  root.add(shell)
  // 顶盖（金属色）+ 底盖
  const plate = box(w * 0.99, h * 0.1, d * 0.99, body.color.accent, 0.42, 0.55)
  plate.position.y = h / 2 - h * 0.05
  root.add(plate)
  const base = box(w * 0.96, h * 0.06, d * 0.96, body.color.metal, 0.5, 0.6)
  base.position.y = -h / 2 + h * 0.03
  root.add(base)
  // 右手柄（比机身厚，往前凸）
  const grip = box(w * 0.26, h * 0.86, d * 1.36, body.color.grip, 0.9, 0.05)
  grip.position.set(w * 0.34, -h * 0.02, -d * 0.06)
  root.add(grip)
  for (let i = 0; i < 5; i += 1) {
    const rib = box(w * 0.24, h * 0.02, d * 0.12, body.color.body, 0.95, 0.05)
    rib.position.set(w * 0.34, -h * 0.36 + i * h * 0.14, -d * 0.6)
    root.add(rib)
  }
  // 军舰部 / 取景器
  const hump = box(w * 0.3, h * 0.19, d * 0.62, body.color.body, 0.5, 0.35)
  hump.position.set(0, h / 2 + h * 0.06, d * 0.12)
  root.add(hump)
  const eyepiece = box(w * 0.18, h * 0.11, d * 0.09, body.color.grip, 0.7, 0.1)
  eyepiece.position.set(0, h / 2 + h * 0.05, d * 0.46)
  root.add(eyepiece)
  // 热靴
  const shoe = box(w * 0.09, h * 0.03, d * 0.24, body.color.metal, 0.3, 0.85)
  shoe.position.set(0, h / 2 + h * 0.17, d * 0.06)
  root.add(shoe)
  for (const side of [-1, 1]) {
    const rail = box(w * 0.012, h * 0.05, d * 0.22, body.color.metal, 0.3, 0.9)
    rail.position.set(side * w * 0.042, h / 2 + h * 0.19, d * 0.06)
    root.add(rail)
  }
  // 拨盘组
  const modeDial = dial(h * 0.19, h * 0.07, body.color.metal, body.color.body)
  modeDial.position.set(w * 0.3, h / 2 + h * 0.1, -d * 0.18)
  root.add(modeDial)
  const evDial = dial(h * 0.15, h * 0.06, body.color.metal, body.color.body)
  evDial.position.set(w * 0.12, h / 2 + h * 0.09, -d * 0.24)
  root.add(evDial)
  // 快门键 + 电源
  const shutter = cyl(h * 0.06, h * 0.05, body.color.metal, 16, 0.4, 0.6)
  shutter.position.set(w * 0.4, h / 2 + h * 0.05, -d * 0.2)
  root.add(shutter)
  const power = cyl(h * 0.035, h * 0.03, body.color.accent, 14, 0.5, 0.3)
  power.position.set(w * 0.44, h / 2 + h * 0.04, -d * 0.02)
  root.add(power)
  // 背面屏 + 按钮
  const screen = box(w * 0.62, h * 0.62, d * 0.03, '#0c0f12', 0.22, 0.1)
  screen.position.set(-w * 0.1, h * 0.02, d * 0.5)
  root.add(screen)
  const screenFrame = box(w * 0.68, h * 0.68, d * 0.02, body.color.body, 0.6, 0.2)
  screenFrame.position.set(-w * 0.1, h * 0.02, d * 0.49)
  root.add(screenFrame)
  for (const [i, y] of [-0.16, 0, 0.16].entries()) {
    const key = cyl(h * 0.04, h * 0.02, body.color.metal, 12, 0.45, 0.5)
    key.rotation.x = Math.PI / 2
    key.position.set(w * 0.34, y * h, d * 0.52)
    root.add(key)
    if (i === 2) key.position.x += w * 0.02
  }
  // 卡口 + 镜头
  const mount = cyl(w * 0.16, d * 0.06, body.color.metal, 26, 0.32, 0.8)
  mount.rotation.x = Math.PI / 2
  mount.position.set(-w * 0.02, h * 0.02, -d * 0.52)
  root.add(mount)
  const lens = lensBarrel(body)
  lens.position.set(-w * 0.02, h * 0.02, -d * 0.52 - (body.lens?.length ?? 0.06) / 2)
  root.add(lens)
  // 麦克风孔 / 接口盖 / 挂绳孔 / AF 辅助灯
  for (let i = 0; i < 6; i += 1) {
    const hole = cyl(w * 0.006, h * 0.01, '#0c0f12', 8, 0.9, 0.05)
    hole.rotation.x = Math.PI / 2
    hole.position.set(-w * 0.28 + i * w * 0.035, h / 2 + h * 0.055, -d * 0.2)
    root.add(hole)
  }
  const door = box(w * 0.02, h * 0.34, d * 0.5, body.color.grip, 0.75, 0.1)
  door.position.set(-w * 0.5, 0, d * 0.06)
  root.add(door)
  for (const side of [-1, 1]) {
    const lug = cyl(w * 0.014, w * 0.02, body.color.metal, 10, 0.4, 0.7)
    lug.rotation.z = Math.PI / 2
    lug.position.set(side * w * 0.49, h / 2 - h * 0.12, d * 0.1)
    root.add(lug)
  }
  const af = box(w * 0.05, h * 0.03, d * 0.02, '#b8532f', 0.35, 0.1)
  af.position.set(w * 0.28, h / 2 - h * 0.04, -d * 0.52)
  root.add(af)
  root.userData.grip = [w * 0.34, -h * 0.02, -d * 0.06]
  return root
}

function buildAction(body: CameraBody): T.Group {
  const root = new T.Group()
  const [w, h, d] = body.size
  root.add(box(w, h, d, body.color.body, 0.55, 0.3))
  const edge = box(w * 1.01, h * 0.1, d * 1.01, body.color.accent, 0.6, 0.2)
  edge.position.y = h * 0.44
  root.add(edge)
  // 正面镜头：外圈 + 玻璃 + 螺纹
  const ring = cyl(w * 0.42, d * 0.12, body.color.metal, 24, 0.35, 0.85)
  ring.rotation.x = Math.PI / 2
  ring.position.set(0, 0, -d * 0.55)
  root.add(ring)
  const glass = new T.Mesh(new T.SphereGeometry(w * 0.32, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2.2), mat('#0b1016', 0.05, 0.98))
  glass.rotation.x = -Math.PI / 2
  glass.position.set(0, 0, -d * 0.6)
  root.add(glass)
  const iris = cyl(w * 0.16, d * 0.02, '#05070a', 18, 0.3, 0.6)
  iris.rotation.x = Math.PI / 2
  iris.position.set(0, 0, -d * 0.62)
  root.add(iris)
  // 背面触摸屏
  const screen = box(w * 0.66, h * 0.56, d * 0.04, '#0d1116', 0.2, 0.1)
  screen.position.set(0, -h * 0.02, d * 0.52)
  root.add(screen)
  const frame = box(w * 0.72, h * 0.62, d * 0.02, body.color.grip, 0.7, 0.15)
  frame.position.set(0, -h * 0.02, d * 0.5)
  root.add(frame)
  // 顶部快门（红圈，录制指示灯）
  const shutter = cyl(w * 0.16, h * 0.08, body.color.metal, 16, 0.4, 0.6)
  shutter.position.set(w * 0.16, h * 0.55, 0)
  root.add(shutter)
  const led = cyl(w * 0.045, h * 0.05, '#c8402c', 10, 0.4, 0.2)
  led.position.set(-w * 0.12, h * 0.55, d * 0.1)
  root.add(led)
  // 散热槽 / 侧盖 / 底座
  for (let i = 0; i < 4; i += 1) {
    const groove = box(w * 0.7, h * 0.02, d * 0.02, body.color.grip, 0.9, 0.05)
    groove.position.set(0, -h * 0.3 + i * h * 0.08, -d * 0.5)
    root.add(groove)
  }
  const door = box(w * 0.02, h * 0.5, d * 0.42, body.color.grip, 0.8, 0.1)
  door.position.set(-w * 0.5, 0, d * 0.1)
  root.add(door)
  const foot = box(w * 0.62, h * 0.07, d * 0.62, body.color.metal, 0.45, 0.7)
  foot.position.y = -h * 0.56
  root.add(foot)
  const screw = cyl(w * 0.09, h * 0.07, body.color.accent, 12, 0.5, 0.5)
  screw.position.y = -h * 0.6
  root.add(screw)
  root.userData.grip = [0, 0, 0]
  return root
}

function buildPocket(body: CameraBody): T.Group {
  const root = new T.Group()
  const [w, h, d] = body.size
  const handle = cyl(w * 0.36, h * 0.72, body.color.body, 22, 0.45, 0.35)
  handle.position.y = -h * 0.14
  root.add(handle)
  for (let i = 0; i < 3; i += 1) {
    const band = cyl(w * 0.375, h * 0.05, body.color.grip, 22, 0.9, 0.05)
    band.position.y = -h * 0.3 + i * h * 0.12
    root.add(band)
  }
  const cap = cyl(w * 0.34, h * 0.04, body.color.accent, 20, 0.4, 0.5)
  cap.position.y = h * 0.2
  root.add(cap)
  // 云台：仰俯轴 + 横滚臂 + 镜头头
  const yawJoint = cyl(w * 0.16, h * 0.05, body.color.metal, 16, 0.35, 0.75)
  yawJoint.position.y = h * 0.22
  root.add(yawJoint)
  const arm = box(w * 0.1, h * 0.16, d * 0.3, body.color.metal, 0.35, 0.8)
  arm.position.set(0, h * 0.3, -d * 0.22)
  root.add(arm)
  const headY = h * 0.37
  const head = box(w * 0.34, h * 0.07, d * 0.42, body.color.body, 0.5, 0.35)
  head.position.set(0, headY, -d * 0.3)
  root.add(head)
  const lensRing = cyl(w * 0.13, d * 0.12, body.color.metal, 18, 0.3, 0.85)
  lensRing.rotation.x = Math.PI / 2
  lensRing.position.set(0, headY, -d * 0.5)
  root.add(lensRing)
  const glass = new T.Mesh(new T.SphereGeometry(w * 0.1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.2), mat('#0a0f14', 0.05, 0.98))
  glass.rotation.x = -Math.PI / 2
  glass.position.set(0, headY, -d * 0.54)
  root.add(glass)
  const headScreen = box(w * 0.26, h * 0.04, d * 0.2, '#0c1015', 0.2, 0.1)
  headScreen.position.set(0, headY + h * 0.04, -d * 0.18)
  root.add(headScreen)
  // 摇杆 + 两颗按键 + 小屏
  const stick = cyl(w * 0.07, h * 0.03, body.color.grip, 12, 0.6, 0.2)
  stick.rotation.x = Math.PI / 2
  stick.position.set(0, h * 0.12, -d * 0.5)
  root.add(stick)
  for (const side of [-1, 1]) {
    const button = cyl(w * 0.05, h * 0.02, body.color.accent, 12, 0.5, 0.3)
    button.rotation.x = Math.PI / 2
    button.position.set(side * w * 0.09, h * 0.04, -d * 0.5)
    root.add(button)
  }
  const rear = box(w * 0.5, h * 0.2, d * 0.06, '#0d1116', 0.22, 0.1)
  rear.position.set(0, -h * 0.08, d * 0.5)
  root.add(rear)
  root.userData.grip = [0, -h * 0.14, 0]
  return root
}

function buildThumb(body: CameraBody): T.Group {
  const root = new T.Group()
  const [w, h, d] = body.size
  const shell = box(w, h, d, body.color.body, 0.7, 0.15)
  root.add(shell)
  // 圆角观感：两端各贴一个扁圆柱
  for (const side of [-1, 1]) {
    const cap = cyl(h * 0.5, d * 1.01, body.color.body, 18, 0.72, 0.12)
    cap.rotation.z = Math.PI / 2
    cap.rotation.x = Math.PI / 2
    cap.position.x = side * (w / 2 - h * 0.06)
    cap.scale.z = 0.5
    root.add(cap)
  }
  const faceP = box(w * 0.9, h * 0.86, d * 0.1, body.color.grip, 0.85, 0.08)
  faceP.position.set(0, 0, d * 0.42)
  root.add(faceP)
  const lensRing = cyl(h * 0.3, d * 0.2, body.color.metal, 18, 0.35, 0.8)
  lensRing.rotation.x = Math.PI / 2
  lensRing.position.set(-w * 0.26, h * 0.02, -d * 0.55)
  root.add(lensRing)
  const glass = new T.Mesh(new T.SphereGeometry(h * 0.24, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.2), mat('#080c10', 0.05, 0.98))
  glass.rotation.x = -Math.PI / 2
  glass.position.set(-w * 0.26, h * 0.02, -d * 0.6)
  root.add(glass)
  const button = cyl(h * 0.16, d * 0.08, body.color.accent, 12, 0.5, 0.3)
  button.position.set(w * 0.3, h * 0.28, d * 0.45)
  root.add(button)
  // 磁吸背夹
  const clip = box(w * 0.72, h * 0.16, d * 0.22, body.color.metal, 0.4, 0.75)
  clip.position.set(0, -h * 0.3, d * 0.55)
  root.add(clip)
  const magnet = box(w * 0.5, h * 0.5, d * 0.06, '#3a4048', 0.6, 0.6)
  magnet.position.set(0, 0, d * 0.55)
  root.add(magnet)
  const led = box(w * 0.05, h * 0.05, d * 0.04, '#d44a2f', 0.4, 0.2)
  led.position.set(w * 0.3, h * 0.1, d * 0.5)
  root.add(led)
  root.userData.grip = [0, 0, 0]
  return root
}

const builders: Record<CameraBody['id'], (body: CameraBody) => T.Group> = {
  mirrorless: buildMirrorless,
  action: buildAction,
  pocket: buildPocket,
  thumb: buildThumb,
  // IDOK-188：三台新机身先复用同类外形（尺寸/配色按机身表走），等 sg claude 的 glTF 到货自动替换。
  a7r2: buildMirrorless,
  action6: buildAction,
  pocket4pro: buildPocket,
}

/** 程序化机身：origin = 握持点（子节点整体偏移），lens 朝 -Z。 */
export function buildCameraProp(body: CameraBody): T.Group {
  const model = builders[body.id](body)
  const grip = (model.userData.grip as [number, number, number] | undefined) ?? [0, 0, 0]
  const root = new T.Group()
  model.position.set(-grip[0], -grip[1], -grip[2])
  root.add(model)
  root.name = `camera-${body.id}`
  root.userData.source = 'procedural'
  return root
}

/** 优先用 glTF 高模；没有/加载失败就用程序化机身。 */
export async function buildCameraPropAsync(body: CameraBody): Promise<T.Group> {
  try {
    const manifest = await loadManifest()
    const entry = manifest[body.id]
    const gltf = await new GLTFLoader().loadAsync(`${CAMERA_MODEL_ROOT}${body.id}.glb`)
    const root = new T.Group()
    const scene = gltf.scene
    scene.traverse(node => {
      if (!(node instanceof T.Mesh)) return
      const mats = Array.isArray(node.material) ? node.material : [node.material]
      for (const m of mats) {
        if (m instanceof T.MeshStandardMaterial) tuneCameraMaterial(m)
      }
    })
    scene.scale.setScalar(entry?.scale ?? 1)
    if (entry?.handOffset) scene.position.fromArray(entry.handOffset)
    if (entry?.handRot) scene.rotation.fromArray(entry.handRot)
    root.add(scene)
    root.name = `camera-${body.id}`
    root.userData.source = 'glb'
    return root
  } catch {
    return buildCameraProp(body)
  }
}

export function disposeCameraProp(root: T.Object3D) {
  root.traverse(object => {
    const mesh = object as T.Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    // 材质是全局缓存共享的，机身之间互相复用，这里不能 dispose。
  })
  root.removeFromParent()
}
