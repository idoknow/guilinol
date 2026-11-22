import * as T from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {clone} from 'three/addons/utils/SkeletonUtils.js'
import {AVATAR_KEY, hairColors, sanitizeAvatar, skinTones, type Avatar} from '../../../lib/avatar'
import {ensureAvatarRig, type AvatarRig} from './avatar-rig'
import {createAvatarOutfitController} from './outfits'
import {starterDetails} from './starter-details'
import {starterOutfit} from '../game/catalog'

export function currentAvatar() {
  try {
    return sanitizeAvatar(JSON.parse(localStorage.getItem(AVATAR_KEY) ?? 'null'))
  } catch {
    return undefined
  }
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
  scene.userData.creatorHair = hairstyle(a, hair.scene)
  scene.traverse((node) => {
    if (node instanceof T.SkinnedMesh) {
      node.geometry = node.geometry.clone()
      const p = node.geometry.getAttribute('position')
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i)
        if (y > 1.535 && y < 1.75 && Math.abs(p.getX(i)) < 0.13) {
          const jaw = Math.max(0, 1 - Math.abs(y - 1.565) / 0.065)
          p.setX(i, p.getX(i) * (a.face === 1 ? 0.94 - 0.1 * jaw : a.face === 2 ? 1 + 0.13 * jaw : 1))
        }
      }
      node.geometry.computeVertexNormals()
      node.material.flatShading = false
    }
  })
  return {...model, scene}
}

function material(color: string) {
  return new T.MeshStandardMaterial({color, roughness: 0.91, flatShading: true})
}
function oval(
  group: T.Object3D,
  mat: T.Material,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  tilt = 0,
) {
  const part = new T.Mesh(new T.SphereGeometry(1, 10, 7), mat)
  part.position.set(x, y, z)
  part.scale.set(w, h, d)
  part.rotation.z = tilt
  group.add(part)
  return part
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
  mat.side = T.DoubleSide
  mat.flatShading = false
  hair.traverse((n) => {
    if (n instanceof T.Mesh) {
      n.material = mat
      n.geometry = n.geometry.clone()
      n.geometry.computeVertexNormals()
    }
  })
  return hair
}
export function styleCharacter(scene: T.Group, rig: AvatarRig, a: Avatar) {
  const head = rig.attachments.head!
  scene.userData.characterSkin = skinTones[a.skin]
  head.add(scene.userData.creatorHair)
  delete scene.userData.creatorHair
  const face = new T.Group(),
    ink = material('#372e2a'),
    lips = material('#aa7967')
  face.name = 'creator-face'
  for (const side of [-1, 1]) {
    const eye = oval(
      face,
      material('#eee2d1'),
      side * 0.036,
      0.068,
      -0.075,
      0.016 + a.eyes * 0.001,
      0.0042 + a.eyes * 0.0009,
      0.004,
      side * [0, 0.04, -0.045][a.eyes],
    )
    oval(face, ink, side * 0.036, 0.069, -0.079, 0.0063, 0.0049, 0.002)
    oval(face, ink, side * 0.036, 0.072, -0.076, 0.015, 0.0015, 0.003, side * [0, 0.04, -0.045][a.eyes])
    eye.rotation.y = side * 0.32
    const brow = oval(
      face,
      material(hairColors[a.hairColor]),
      side * 0.037,
      0.083,
      -0.073,
      0.022,
      0.003 + a.brows * 0.0005,
      0.004,
      side * [0, -0.05, 0.12][a.brows],
    )
    brow.rotation.y = side * 0.3
  }
  oval(face, lips, 0, 0.017, -0.076, 0.021, 0.0027, 0.005)
  head.add(face)
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
      [0.993, 0.145],
      [0.965, 0.16],
      [0.896, 0.18],
      [0.55, 0.205],
      [0.2, 0.239],
    ]
    for (const [row, [height, radius]] of rings.entries())
      for (let i = 0; i < 48; i++) {
        const angle = (i * Math.PI) / 24,
          pleat = Math.abs(Math.sin(angle)) > 0.45 && i % 2 ? 0.016 : 0
        const x = Math.sin(angle) * (radius - pleat),
          z = Math.cos(angle) * (radius - pleat) * 0.78 - 0.022
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
    const cloth = material('#586967')
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
    if (!(node instanceof T.SkinnedMesh) || node.name === 'creator-skirt')
      for (const mat of Array.isArray(node.material) ? node.material : [node.material]) mat.dispose()
  })
}
export async function previewCharacter(a: Avatar) {
  const model = await characterModel(a),
    rig = ensureAvatarRig(model.scene)
  styleCharacter(model.scene, rig, a).applyEquipped(starterOutfit(a.look))
  return model
}
