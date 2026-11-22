import * as T from 'three'
import {hairColors, skinTones, type Avatar} from '../../../lib/avatar'
import {streetShading} from './creator-ink'

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

export function facialFeatures(geometry: T.BufferGeometry, a: Avatar) {
  const group = new T.Group(),
    front = frontOfFace(geometry)
  group.name = 'creator-face'
  const positions: number[] = [],
    colors: number[] = [],
    indices: number[] = []
  const female = a.body === 'f'

  // Taper each contour to its corners and curve the surface smoothly around the cheeks.
  function ribbon(color: T.ColorRepresentation, point: (t: number, v: number) => [number, number, number], segs = 16) {
    const pigment = new T.Color(color)
    const start = positions.length / 3
    for (let i = 0; i <= segs; i++)
      for (let j = 0; j < 3; j++) {
        const [x, y, lift] = point(i / segs, j / 2)
        colors.push(pigment.r, pigment.g, pigment.b)
        positions.push(x, y, front(x, y) - lift)
        const k = start + i * 3 + j
        if (i && j) indices.push(k - 4, k - 1, k, k - 4, k, k - 3)
      }
  }

  const skinBase = new T.Color(skinTones[a.skin])
  const browCol = new T.Color(hairColors[a.hairColor]).lerp(new T.Color('#2a201b'), 0.25)

  for (const side of [-1, 1]) {
    const eyeX = side * 0.0325
    const eyeY = 0.064
    const eyeHalfW = (female ? 0.0138 : 0.0128) + 0.0012 * a.eyes
    const eyeHalfH = (female ? 0.0068 : 0.0058) + 0.0008 * a.eyes

    // 1) Soft warm sclera (gives natural almond eye shape instead of pinpoint cartoon dots)
    ribbon('#ece6dc', (t, v) => {
      const ang = Math.PI * t
      const arch = Math.sin(ang)
      const tilt = (t - 0.5) * 0.0016 * side
      return [
        eyeX + side * (t * 2 - 1) * eyeHalfW,
        eyeY + tilt + (v - 0.5) * 2 * eyeHalfH * Math.pow(arch, 0.72),
        0.0014,
      ]
    }, 14)

    // 2) Rich warm-dark iris centered inside sclera
    const irisR = (female ? 0.0062 : 0.0057) + 0.0005 * a.eyes
    ribbon('#261b16', (t, v) => {
      const ang = Math.PI * t
      return [
        eyeX - side * irisR * Math.cos(ang),
        eyeY - 0.0004 + (v - 0.5) * 2 * irisR * 0.96 * Math.sin(ang),
        0.0020,
      ]
    }, 12)

    // 3) Tiny specular eye catchlight (upper-left of iris -> instantly adds human life)
    const catchR = 0.0020
    ribbon('#ffffff', (t, v) => {
      const ang = Math.PI * t
      return [
        eyeX - 0.0020 - catchR * Math.cos(ang),
        eyeY + 0.0019 + (v - 0.5) * 2 * catchR * Math.sin(ang),
        0.0025,
      ]
    }, 8)

    // 4) Natural curved upper lash / eyelid line framing the eye
    ribbon('#2d201a', (t, v) => {
      const arch = Math.sin(Math.PI * t)
      const tilt = (t - 0.5) * 0.0018 * side
      const thick = (female ? 0.0024 : 0.0019) * (0.45 + 0.55 * arch)
      return [
        eyeX + side * (t * 2 - 1) * (eyeHalfW + 0.0015),
        eyeY + tilt + eyeHalfH * Math.pow(arch, 0.72) + (v - 0.2) * thick,
        0.0023,
      ]
    }, 14)

    // 5) Tapered expressive eyebrows matching selected brow style & hair color
    ribbon(browCol, (t, v) => {
      const arch = Math.sin(Math.PI * t)
      const taper = 0.35 + 0.65 * Math.pow(arch, 0.55)
      const thick = (female ? 0.0026 : 0.0036) + 0.0008 * a.brows
      return [
        side * (0.0155 + 0.038 * t),
        0.080 +
          [0.0015, 0.0075, 0.0025][a.brows] * arch +
          [0.000, -0.0015, -0.0085][a.brows] * t +
          (v - 0.5) * thick * taper,
        0.0019,
      ]
    }, 14)
  }

  // 6) Subtle nose-underside shadow (softly anchors sculpted nose tip without harsh cartoon line)
  const noseShade = skinBase.clone().lerp(new T.Color('#7a513e'), 0.38)
  ribbon(noseShade, (t, v) => {
    const arc = Math.sin(Math.PI * t)
    return [
      (t - 0.5) * 0.017,
      0.0295 + (v - 0.5) * 0.0042 * arc - 0.0012 * (1 - arc),
      0.0013,
    ]
  }, 10)

  // 7) Natural lips (muted warm terracotta/rose, fuller upper/lower taper, slight gentle smile curve)
  const lipTarget = female ? '#b05652' : '#96544b'
  const lipUpper = skinBase.clone().lerp(new T.Color(lipTarget), female ? 0.56 : 0.40)
  const lipLower = skinBase.clone().lerp(new T.Color(lipTarget), female ? 0.44 : 0.32)
  const mouthW = female ? 0.036 : 0.039
  ribbon(lipUpper, (t, v) => {
    const arc = Math.sin(Math.PI * t)
    const bow = 0.0014 * Math.sin(2 * Math.PI * t) ** 2
    const smile = 0.0022 * (2 * t - 1) ** 2
    return [
      (0.5 - t) * mouthW,
      0.0042 + smile + v * (0.0042 * arc + bow),
      0.0018,
    ]
  }, 14)
  ribbon(lipLower, (t, v) => {
    const arc = Math.sin(Math.PI * t)
    const smile = 0.0022 * (2 * t - 1) ** 2
    return [
      (0.5 - t) * (mouthW * 0.92),
      0.0042 + smile - (1 - v) * (female ? 0.0052 : 0.0044) * arc,
      0.0017,
    ]
  }, 14)

  const g = new T.BufferGeometry()
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3))
  g.setAttribute('color', new T.Float32BufferAttribute(colors, 3))
  g.setIndex(indices)
  g.computeVertexNormals()
  const mat = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.62,
    metalness: 0.0,
    side: T.DoubleSide,
  })
  streetShading(mat, false, 'face')
  group.add(new T.Mesh(g, mat))
  return group
}
