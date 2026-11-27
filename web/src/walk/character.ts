import * as T from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {clone} from 'three/addons/utils/SkeletonUtils.js'
import {AVATAR_KEY, hairColors, sanitizeAvatar, skinTones, type Avatar} from '../../../lib/avatar'
import {ensureAvatarRig, type AvatarRig} from './avatar-rig'
import {createAvatarOutfitController} from './outfits'
import {facialFeatures} from './creator-face'
import {addOutline, streetShading} from './creator-ink'
import {starterDetails} from './starter-details'
import {starterOutfit, type EquippedOutfit} from '../game/catalog'

export function currentAvatar() {
  try {
    return sanitizeAvatar(JSON.parse(localStorage.getItem(AVATAR_KEY) ?? 'null'))
  } catch {
    return undefined
  }
}
/** Head-vertex morph per face shape: [x scale, chin lift (+ = shorter, − = longer)] at rest height y. */
function faceShape(face: number, y: number): [number, number] {
  const jaw = Math.max(0, 1 - Math.abs(y - 1.56) / 0.078)
  const cheek = Math.max(0, 1 - Math.abs(y - 1.615) / 0.06)
  const low = T.MathUtils.smoothstep(1.61 - y, 0, 0.1)
  switch (face) {
    case 0: return [1 + 0.23 * jaw, 0.12] // 圆脸
    case 1: return [0.98 - 0.11 * jaw, 0] // 鹅蛋脸
    case 2: return [1 + 0.55 * jaw ** 2, -0.1] // 方下颌
    case 3: return [1.03 - 0.3 * low, -0.07] // 瓜子脸: full cheeks tapering to a small pointed chin
    case 4: return [0.95 - 0.06 * jaw, -0.2] // 长脸
    default: return [1 + 0.11 * cheek - 0.15 * low, 0.02] // 宽颧脸: wide cheekbones, narrow jaw
  }
}
/**
 * IDOK-386 头身比：头放大 6%、颈收短 6%，只改骨骼静止姿态（ensureAvatarRig 读作 rest，applyBones 每帧还原）。
 * 动画只有 pelvis 位移和旋转轨，不会覆盖；头发、五官、帽子挂在头骨下同比跟随；三角面与 draw call 不变。
 * 手骨不缩：多处手持物（鱼竿、罚单、饮料）直接挂在 hand_* 骨骼上，缩手会连带缩小它们。
 */
function refineProportions(scene: T.Object3D) {
  const head = scene.getObjectByName('head')
  head?.scale.multiplyScalar(1.06)
  head?.position.multiplyScalar(0.94)
}
const models = new Map<string, ReturnType<GLTFLoader['loadAsync']>>()
export async function characterModel(a: Avatar) {
  let pending = models.get(a.body)
  if (!pending) {
    pending = new GLTFLoader().loadAsync('./avatar/figure_' + a.body + '.glb')
    models.set(a.body, pending)
    pending.catch(() => models.delete(a.body))
  }
  const [model, hair] = await Promise.all([pending, hairLibrary()])
  const scene = clone(model.scene) as T.Group
  refineProportions(scene)
  scene.userData.creatorHair = hairstyle(a, hair.scene)
  scene.traverse((node) => {
    if (node instanceof T.SkinnedMesh) {
      node.geometry = node.geometry.clone()
      const p = node.geometry.getAttribute('position')
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i)
        if (node.skeleton.bones[node.geometry.attributes.skinIndex.getX(i)]?.name === 'head' && y < 1.7) {
          const [width, chin] = faceShape(a.face, y)
          p.setX(i, p.getX(i) * width)
          if (chin && y < 1.61) p.setY(i, y + (1.61 - y) * chin)
        }
      }
      node.geometry.computeVertexNormals()
      node.material = node.material.clone()
      streetShading(node.material, true)
    }
  })
  return {...model, scene}
}

function material(color: string) {
  return new T.MeshStandardMaterial({color, roughness: 0.91, flatShading: true})
}
function hairLibrary() {
  let p = models.get('hair')
  if (!p) {
    p = new GLTFLoader().loadAsync('./avatar/creator-hair.glb')
    models.set('hair', p)
    p.catch(() => models.delete('hair'))
  }
  return p
}
export function hairstyle(a: Avatar, library: T.Object3D) {
  const hair = library.getObjectByName(a.hair)!.clone(),
    mat = material(hairColors[a.hairColor])
  hair.name = 'creator-hair'
  mat.vertexColors = true
  mat.roughness = 0.68
  mat.side = T.FrontSide
  streetShading(mat, false, true)
  hair.traverse((n) => {
    if (n instanceof T.Mesh) {
      n.material = mat
      n.geometry = n.geometry.clone()
      const tone = n.geometry.getAttribute('color'),
        colors: number[] = []
      const base = new T.Color(hairColors[a.hairColor]),
        scalp = new T.Color(skinTones[a.skin])
      for (let i = 0; i < tone.count; i++) {
        const shade = 0.68 + tone.getX(i) * 1.35
        const c = base
          .clone()
          .multiplyScalar(shade)
          .lerp(scalp, 0.21 * tone.getY(i))
        colors.push(c.r / base.r, c.g / base.g, c.b / base.b)
      }
      n.geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3))
      n.geometry.computeVertexNormals()
    }
  })
  return hair
}
export function styleCharacter(scene: T.Group, rig: AvatarRig, a: Avatar) {
  const head = rig.attachments.head!
  scene.userData.characterSkin = skinTones[a.skin]
  addOutline(rig.skinnedMesh!, 0.008)
  addOutline(scene.userData.creatorHair, 0.004)
  head.add(scene.userData.creatorHair)
  delete scene.userData.creatorHair
  scene.userData.creatorBody = a.body
  head.add(facialFeatures(rig.skinnedMesh!.geometry, a))
  if (a.body === 'f') {
    const base = rig.skinnedMesh!,
      skeleton = base.skeleton
    const bone = (name: string) => skeleton.bones.findIndex((b) => b.name === name)
    const pelvis = bone('pelvis'),
      thighL = bone('thigh_l'),
      thighR = bone('thigh_r'),
      calfL = bone('calf_l'),
      calfR = bone('calf_r')
    const positions: number[] = [],
      indices: number[] = [],
      joints: number[] = [],
      weights: number[] = []
    const rings = [
      [0.95, 0.165],
      [0.925, 0.173],
      [0.896, 0.18],
      [0.55, 0.205],
      [0.51, 0.205],
    ]
    for (const [row, [height, radius]] of rings.entries())
      for (let i = 0; i < 48; i++) {
        const angle = (i * Math.PI) / 24
        const x = Math.sin(angle) * radius,
          z = Math.cos(angle) * radius * 0.78 - 0.022
        positions.push(x, height, z)
        const left = T.MathUtils.smoothstep(x, -0.09, 0.09)
        if (height >= 0.55) {
          const drop = 1 - T.MathUtils.smoothstep(height, 0.55, 0.965)
          joints.push(pelvis, thighL, thighR, 0)
          weights.push(1 - drop, drop * left, drop * (1 - left), 0)
        } else {
          joints.push(thighL, thighR, calfL, calfR)
          weights.push(0.42 * left, 0.42 * (1 - left), 0.58 * left, 0.58 * (1 - left))
        }
        if (row) {
          const k = row * 48 + i,
            n = row * 48 + ((i + 1) % 48)
          indices.push(k - 48, k, n - 48, n - 48, k, n)
        }
      }
    const g = new T.BufferGeometry()
    g.setAttribute('position', new T.Float32BufferAttribute(positions, 3))
    g.setAttribute('skinIndex', new T.Uint16BufferAttribute(joints, 4))
    g.setAttribute('skinWeight', new T.Float32BufferAttribute(weights, 4))
    g.setIndex(indices)
    g.computeVertexNormals()
    const cloth = material('#72776d')
    streetShading(cloth)
    cloth.side = T.DoubleSide
    const skirt = new T.SkinnedMesh(g, cloth)
    skirt.name = 'creator-skirt'
    skirt.frustumCulled = false
    base.parent!.add(skirt)
    skirt.bind(skeleton, base.bindMatrix)
  }
  scene.userData.starterDetails?.dispose()
  scene.userData.starterDetails = starterDetails(rig, a)
  return createAvatarOutfitController(scene, rig)
}
export function disposeCharacterParts(root: T.Object3D) {
  root.traverse((node) => {
    if (!(node instanceof T.Mesh)) return
    node.geometry.dispose()
    if (
      !(node instanceof T.SkinnedMesh) ||
      node.material.userData?.clothing ||
      ['creator-skirt', 'creator-body-outline'].includes(node.name)
    )
      for (const mat of Array.isArray(node.material) ? node.material : [node.material]) mat.dispose()
  })
}
/** @param outfit 默认是该外形的初始穿搭；封面主角传专属一套 */
export async function previewCharacter(a: Avatar, outfit: EquippedOutfit = starterOutfit(a.look)) {
  const model = await characterModel(a),
    rig = ensureAvatarRig(model.scene)
  styleCharacter(model.scene, rig, a).applyEquipped(outfit)
  return model
}
