import * as T from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {clone} from 'three/addons/utils/SkeletonUtils.js'
import {AVATAR_KEY, hairColors, sanitizeAvatar, skinTones, type Avatar} from '../../../lib/avatar'
import {ensureAvatarRig, type AvatarRig} from './avatar-rig'
import {createAvatarOutfitController} from './outfits'
import {facialFeatures} from './creator-face'
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
      node.material.onBeforeCompile = (shader: T.WebGLProgramParametersWithUniforms) => {
        shader.vertexShader =
          'varying float smoothHead;\n' +
          shader.vertexShader.replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\nsmoothHead = step(1.521,position.y)*step(abs(position.x),0.115);',
          )
        shader.fragmentShader =
          'varying float smoothHead;\n' +
          shader.fragmentShader.replace(
            '#include <normal_fragment_begin>',
            '#include <normal_fragment_begin>\nif(smoothHead<0.5) normal=normalize(cross(dFdx(vViewPosition),dFdy(vViewPosition)));',
          )
      }
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
  mat.flatShading = false
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
  head.add(scene.userData.creatorHair)
  delete scene.userData.creatorHair
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
