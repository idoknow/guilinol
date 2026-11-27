import * as T from 'three'
import {characterLight} from './character-light'
import {hairColors, skinTones, type Avatar} from '../../../lib/avatar'

export type CreatorExpression = 'neutral' | 'serious' | 'smile' | 'remind' | 'thumbs_up'

export const CREATOR_EXPRESSIONS: readonly CreatorExpression[] = Object.freeze([
  'neutral',
  'serious',
  'smile',
  'remind',
  'thumbs_up',
])

export function normalizeCreatorExpression(raw?: string | null): CreatorExpression {
  if (raw === 'serious' || raw === 'smile' || raw === 'remind' || raw === 'thumbs_up' || raw === 'neutral') {
    return raw
  }
  if (raw === 'curious') return 'remind'
  if (raw === 'handoff') return 'smile'
  return 'neutral'
}

let sharedLaugh: T.CanvasTexture | undefined
function laughTexture(): T.CanvasTexture | undefined {
  if (sharedLaugh) return sharedLaugh
  if (typeof document === 'undefined') return undefined
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 192
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  ctx.strokeStyle = '#392b26'
  ctx.lineWidth = 8
  ctx.lineCap = 'round'
  for (const x of [64, 192]) {
    ctx.beginPath()
    ctx.moveTo(x - 21, 68)
    ctx.quadraticCurveTo(x, 43, x + 21, 68)
    ctx.stroke()
  }
  ctx.fillStyle = '#763f3c'
  ctx.beginPath()
  ctx.moveTo(73, 119)
  ctx.quadraticCurveTo(128, 136, 183, 119)
  ctx.bezierCurveTo(172, 183, 91, 183, 73, 119)
  ctx.fill()
  ctx.fillStyle = '#f4e5cf'
  ctx.beginPath()
  ctx.moveTo(80, 124)
  ctx.quadraticCurveTo(128, 137, 176, 124)
  ctx.quadraticCurveTo(128, 153, 80, 124)
  ctx.fill()
  sharedLaugh = new T.CanvasTexture(canvas)
  sharedLaugh.colorSpace = T.SRGBColorSpace
  return sharedLaugh
}

// Match the contours of the selected face, including the square/oval jaw morph.
function frontOfFace(geometry: T.BufferGeometry) {
  const positions = geometry.getAttribute('position'),
    index = geometry.index!
  const triangles: T.Triangle[] = []
  for (let i = 0; i < index.count; i += 3) {
    const a = new T.Vector3().fromBufferAttribute(positions, index.getX(i))
    if (a.y < 1.54 || a.y > 1.69 || Math.abs(a.x) > 0.11 || a.z < 0) continue
    triangles.push(
      new T.Triangle(
        a,
        new T.Vector3().fromBufferAttribute(positions, index.getX(i + 1)),
        new T.Vector3().fromBufferAttribute(positions, index.getX(i + 2)),
      ),
    )
  }
  const ray = new T.Ray(new T.Vector3(), new T.Vector3(0, 0, -1)),
    hit = new T.Vector3()
  return (x: number, y: number) => {
    ray.origin.set(-x, 1.56849 + y, 0.3)
    let z = 0
    for (const t of triangles) if (ray.intersectTriangle(t.a, t.b, t.c, false, hit)) z = Math.max(z, hit.z)
    return 0.0114245 - z
  }
}

interface ExpressionBufferData {
  readonly positions: Float32Array
  readonly colors: Float32Array
  readonly indices: number[]
}

interface CreatorFaceStore {
  readonly front: (x: number, y: number) => number
  readonly avatar: Avatar
  readonly cache: Partial<Record<CreatorExpression, {positions: Float32Array; colors: Float32Array}>>
  current: CreatorExpression
}

function buildExpressionBuffers(
  front: (x: number, y: number) => number,
  a: Avatar,
  expr: CreatorExpression,
): ExpressionBufferData {
  const positions: number[] = [],
    colors: number[] = [],
    indices: number[] = []
  // Taper each contour to its corners and curve the surface around the cheeks.
  function ribbon(color: T.ColorRepresentation, point: (t: number, v: number) => [number, number, number]) {
    const pigment = new T.Color(color)
    const start = positions.length / 3
    for (let i = 0; i <= 18; i++)
      for (let j = 0; j < 3; j++) {
        const [x, y, lift] = point(i / 18, j / 2)
        colors.push(pigment.r, pigment.g, pigment.b)
        positions.push(x, y, front(x, y) - lift)
        const k = start + i * 3 + j
        if (i && j) indices.push(k - 4, k - 1, k, k - 4, k, k - 3)
      }
  }

  // A small light-coloured glint on the upper outer iris: same mesh/draw, makes the eyes read as alive.
  // Squinting expressions shrink it with the eye so it never spills past the lids.
  function catchlight(side: number, centerY: number, halfWidth: number, eyeH: number) {
    const size = Math.min(1, eyeH / 0.012)
    ribbon('#f6efe4', (t, v) => [
      side * (0.034 - halfWidth * 0.22 + (2 * t - 1) * 0.0021 * size),
      centerY + eyeH * 0.16 + (v - 0.5) * 0.0036 * size * Math.sin(Math.PI * t),
      0.0021,
    ])
  }

  for (const side of [-1, 1]) {
    const eyeY = 0.065,
      baseHalfWidth = a.eyes === 3 ? 0.009 : 0.0075 + 0.001 * a.eyes,
      baseEyeH = a.eyes === 3 ? 0.0165 : 0.011 + 0.001 * a.eyes

    if (expr === 'neutral') {
      ribbon('#302622', (t, v) => {
        const angle = Math.PI * t
        return [
          side * (0.034 - baseHalfWidth * Math.cos(angle)),
          eyeY + (v - 0.5) * baseEyeH * Math.sin(angle),
          0.0018,
        ]
      })
      catchlight(side, eyeY, baseHalfWidth, baseEyeH)
      ribbon('#4a352b', (t, v) => [
        side * (0.034 + (2 * t - 1) * (baseHalfWidth + 0.002)),
        eyeY + 0.005 + (0.003 + 0.0016 * v) * Math.sin(Math.PI * t),
        0.0015,
      ])
      ribbon(new T.Color(hairColors[a.hairColor]), (t, v) => [
        side * (0.018 + 0.041 * t),
        0.082 +
          [0.001, 0.01, 0.003, 0.001][a.brows] * Math.sin(Math.PI * t) +
          [0, -0.002, -0.012, 0.007][a.brows] * t +
          [0.003, 0.004, 0.005, 0.0062][a.brows] * v * Math.sin(Math.PI * t) ** (a.brows === 3 ? 0.2 : 0.4),
        0.0016,
      ])
    } else {
      const eyeWScale =
        expr === 'thumbs_up' ? 1.14 : expr === 'smile' ? 1.07 : expr === 'remind' ? 1.04 : 0.98
      const eyeHScale =
        expr === 'thumbs_up' ? 0.58 : expr === 'serious' ? 0.74 : expr === 'smile' ? 0.84 : 1.22
      const eyeYShift =
        expr === 'thumbs_up' ? 0.0024 : expr === 'smile' ? 0.0014 : expr === 'remind' ? 0.0010 : -0.0014
      const eyeCurveLift =
        expr === 'thumbs_up' ? 0.0046 : expr === 'smile' ? 0.0024 : expr === 'serious' ? -0.0010 : 0.0004
      const halfWidth = baseHalfWidth * eyeWScale
      const eyeH = baseEyeH * eyeHScale

      ribbon('#302622', (t, v) => {
        const angle = Math.PI * t
        const s = Math.sin(angle)
        return [
          side * (0.034 - halfWidth * Math.cos(angle)),
          eyeY + eyeYShift + eyeCurveLift * s + (v - 0.5) * eyeH * s,
          0.0018,
        ]
      })
      catchlight(side, eyeY + eyeYShift + eyeCurveLift, halfWidth, eyeH)

      const lidYShift =
        expr === 'thumbs_up' ? 0.0036 : expr === 'remind' ? 0.0030 : expr === 'smile' ? 0.0018 : -0.0022
      const lidArch =
        expr === 'thumbs_up' ? 0.0056 : expr === 'remind' ? 0.0048 : expr === 'smile' ? 0.0042 : 0.0014
      const lidMedialTilt = expr === 'serious' ? -0.0018 * (1 - 0.5) : 0

      ribbon('#4a352b', (t, v) => [
        side * (0.034 + (2 * t - 1) * (halfWidth + 0.002)),
        eyeY + 0.005 + lidYShift + (expr === 'serious' ? -0.0020 * (1 - t) : lidMedialTilt) + (lidArch + 0.0016 * v) * Math.sin(Math.PI * t),
        0.0015,
      ])

      const browBaseArch = [0.001, 0.01, 0.003, 0.001][a.brows]
      const browBaseTilt = [0, -0.002, -0.012, 0.007][a.brows]
      const browBaseThick = [0.003, 0.004, 0.005, 0.0062][a.brows]
      const browThickScale = expr === 'serious' ? 1.22 : expr === 'thumbs_up' ? 1.08 : 1.0

      ribbon(new T.Color(hairColors[a.hairColor]), (t, v) => {
        const sinT = Math.sin(Math.PI * t)
        // Keep all expression brows cleanly beneath the police cap brim (y <= ~0.086) while preserving distinct shapes
        let exprOffset = 0
        if (expr === 'serious') {
          exprOffset = -0.0062 * (1 - t) + 0.0008 * t
        } else if (expr === 'smile') {
          exprOffset = -0.0024 + 0.0038 * sinT
        } else if (expr === 'remind') {
          exprOffset = side < 0 ? -0.0006 + 0.0028 * sinT : -0.0042 - 0.0018 * (1 - t)
        } else {
          // thumbs_up
          exprOffset = -0.0018 + 0.0042 * sinT
        }
        return [
          side * (0.018 + 0.041 * t),
          0.082 +
            exprOffset +
            browBaseArch * sinT +
            browBaseTilt * t +
            browBaseThick * browThickScale * v * sinT ** (a.brows === 3 ? 0.2 : 0.4),
          0.0016,
        ]
      })
    }
  }

  ribbon(new T.Color(skinTones[a.skin]).lerp(new T.Color('#885d49'), 0.45), (t, v) => [
    (t - 0.5) * 0.019,
    0.03 + 0.005 * (1 - t) * v,
    0.0014,
  ])

  const baseLip = new T.Color(skinTones[a.skin]).lerp(new T.Color('#994e48'), 0.52)
  if (expr === 'neutral') {
    ribbon(baseLip, (t, v) => {
      const arc = Math.sin(Math.PI * t)
      return [
        (0.5 - t) * 0.041,
        0.002 + 0.0015 * (2 * t - 1) ** 2 + arc * (v - 0.5) * (0.009 + 0.002 * Math.sin(2 * Math.PI * t) ** 2),
        0.0018,
      ]
    })
  } else {
    const lipColor =
      expr === 'thumbs_up'
        ? baseLip.clone().lerp(new T.Color('#b8524a'), 0.35)
        : expr === 'remind'
          ? baseLip.clone().lerp(new T.Color('#6f3533'), 0.32)
          : baseLip
    const width =
      expr === 'thumbs_up' ? 0.055 : expr === 'smile' ? 0.049 : expr === 'serious' ? 0.036 : 0.030
    const yShift =
      expr === 'thumbs_up' ? 0.0024 : expr === 'smile' ? 0.0014 : expr === 'serious' ? -0.0014 : -0.0018
    const cornerCurve =
      expr === 'thumbs_up' ? 0.0102 : expr === 'smile' ? 0.0072 : expr === 'serious' ? -0.0028 : -0.0006
    const hScale =
      expr === 'remind' ? 1.68 : expr === 'thumbs_up' ? 1.38 : expr === 'smile' ? 1.08 : 0.72
    ribbon(lipColor, (t, v) => {
      const arc = Math.sin(Math.PI * t)
      const u = 2 * t - 1
      return [
        (0.5 - t) * width,
        0.002 +
          yShift +
          cornerCurve * u * u +
          arc * (v - 0.5) * (0.009 + 0.002 * Math.sin(2 * Math.PI * t) ** 2) * hScale,
        0.0018,
      ]
    })
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    indices,
  }
}

/**
 * Switches brow, eye, eyelid, and mouth geometry in-place on `creator-face` (`rest-face`)
 * without adding extra meshes or draw calls. Default `'neutral'` preserves exact unmodified player geometry.
 */
export function setCreatorExpression(root: T.Object3D | null | undefined, expr: CreatorExpression | string): boolean {
  if (!root) return false
  const faceGroup = root.name === 'creator-face' ? root : root.getObjectByName('creator-face')
  if (!faceGroup) return false
  const rest = faceGroup.getObjectByName('rest-face')
  const store = faceGroup.userData.creatorFaceStore as CreatorFaceStore | undefined
  if (!(rest instanceof T.Mesh) || !store) return false

  const nextExpr = normalizeCreatorExpression(expr)
  let entry = store.cache[nextExpr]
  if (!entry) {
    const built = buildExpressionBuffers(store.front, store.avatar, nextExpr)
    entry = {positions: built.positions, colors: built.colors}
    store.cache[nextExpr] = entry
  }

  const posAttr = rest.geometry.getAttribute('position') as T.BufferAttribute | undefined
  const colAttr = rest.geometry.getAttribute('color') as T.BufferAttribute | undefined
  if (!posAttr || !colAttr || posAttr.array.length !== entry.positions.length || colAttr.array.length !== entry.colors.length) {
    return false
  }

  ;(posAttr.array as Float32Array).set(entry.positions)
  posAttr.needsUpdate = true
  ;(colAttr.array as Float32Array).set(entry.colors)
  colAttr.needsUpdate = true
  rest.geometry.computeBoundingBox()
  rest.geometry.computeBoundingSphere()

  rest.visible = true
  const laugh = faceGroup.getObjectByName('laugh-face')
  if (laugh) laugh.visible = false

  store.current = nextExpr
  faceGroup.userData.expression = nextExpr
  return true
}

export function getCreatorExpression(root: T.Object3D | null | undefined): CreatorExpression {
  if (!root) return 'neutral'
  const faceGroup = root.name === 'creator-face' ? root : root.getObjectByName('creator-face')
  if (!faceGroup) return 'neutral'
  return normalizeCreatorExpression(faceGroup.userData.expression as string | undefined)
}

/** Unlit ink for the face ribbons that still follows the street's night dimming like the toon skin around it. */
function faceInk() {
  const ink = new T.MeshBasicMaterial({vertexColors: true, side: T.DoubleSide})
  ink.onBeforeCompile = (shader, renderer) => {
    T.Material.prototype.onBeforeCompile.call(ink, shader, renderer)
    shader.uniforms.uNight ??= {value: 0}
    shader.uniforms.uLevel = characterLight.uLevel
    shader.fragmentShader = 'uniform float uNight, uLevel;\n' + shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      'outgoingLight *= mix(1.0, 0.38, uNight) * uLevel;\n#include <opaque_fragment>',
    )
  }
  ink.customProgramCacheKey = () => 'creator-face-ink'
  return ink
}

export function facialFeatures(geometry: T.BufferGeometry, a: Avatar) {
  const group = new T.Group(),
    front = frontOfFace(geometry)
  group.name = 'creator-face'
  const mouth = new T.Object3D()
  mouth.name = 'smoke-lips'
  mouth.position.set(0.004, 0.002, front(0.004, 0.002) - 0.0018)
  group.add(mouth)

  const neutral = buildExpressionBuffers(front, a, 'neutral')
  const g = new T.BufferGeometry()
  g.setAttribute('position', new T.Float32BufferAttribute(neutral.positions.slice(), 3))
  g.setAttribute('color', new T.Float32BufferAttribute(neutral.colors.slice(), 3))
  g.setIndex(neutral.indices)
  const rest = new T.Mesh(g, faceInk())
  rest.name = 'rest-face'
  group.add(rest)

  const store: CreatorFaceStore = {
    front,
    avatar: {...a},
    cache: {
      neutral: {
        positions: neutral.positions,
        colors: neutral.colors,
      },
    },
    current: 'neutral',
  }
  group.userData.creatorFaceStore = store
  group.userData.expression = 'neutral'

  const texture = laughTexture()
  const surface = new T.PlaneGeometry(0.145, 0.12, 24, 20)
  const points = surface.attributes.position
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i),
      y = points.getY(i) + 0.042
    points.setXYZ(i, x, y, front(x, y) - 0.002)
  }
  // The attachment's local +X is screen-right when viewed from behind.
  const laugh = new T.Mesh(
    surface,
    new T.MeshBasicMaterial({
      ...(texture ? {map: texture} : {}),
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
    }),
  )
  laugh.name = 'laugh-face'
  laugh.visible = false
  group.add(laugh)
  return group
}
