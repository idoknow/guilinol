import * as T from 'three'
import {hairColors, skinTones, type Avatar} from '../../../lib/avatar'

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
  // Taper each contour to its corners and curve the surface around the cheeks.
  function ribbon(
    color: T.ColorRepresentation,
    point: (t: number, v: number) => [number, number, number],
    pigment?: (t: number, v: number) => T.Color,
  ) {
    const p: number[] = [],
      indices: number[] = [],
      colors: number[] = []
    for (let i = 0; i <= 18; i++)
      for (let j = 0; j < 3; j++) {
        const [x, y, lift] = point(i / 18, j / 2)
        p.push(x, y, front(x, y) - lift)
        if (pigment) pigment(i / 18, j / 2).toArray(colors, colors.length)
        const k = i * 3 + j
        if (i && j) indices.push(k - 4, k - 1, k, k - 4, k, k - 3)
      }
    const g = new T.BufferGeometry()
    g.setAttribute('position', new T.Float32BufferAttribute(p, 3))
    g.setIndex(indices)
    g.computeVertexNormals()
    if (pigment) g.setAttribute('color', new T.Float32BufferAttribute(colors, 3))
    group.add(
      new T.Mesh(
        g,
        new T.MeshStandardMaterial({color, vertexColors: !!pigment, roughness: 0.85, side: T.DoubleSide}),
      ),
    )
  }
  for (const side of [-1, 1]) {
    function eye(t: number, v: number, lid: boolean): [number, number, number] {
      const arc = Math.sin(t * Math.PI),
        x = side * (0.019 + 0.031 * t)
      const base = 0.065 + 0.002 * t + 0.001 * a.eyes * (t - 0.5)
      const upper = (0.0035 + 0.0006 * a.eyes) * arc
      const y = lid ? base + upper + 0.0018 * arc + v * 0.0015 * arc : base + upper * v - 0.0032 * arc * (1 - v)
      return [x, y, 0.0012 + 0.0012 * arc * Math.sin(Math.PI * v)]
    }
    ribbon(
      '#ffffff',
      (t, v) => eye(t, v, false),
      (t, v) => {
        const distance = Math.abs(t - 0.47)
        const c = new T.Color('#30251f').lerp(
          new T.Color('#968273'),
          T.MathUtils.smoothstep(distance, 0.19, 0.4) * 0.78,
        )
        if (Math.abs(t - 0.4) < 0.036 && v === 0.5) c.lerp(new T.Color('#a7937e'), 0.22)
        return c
      },
    )
    ribbon('#765548', (t, v) => eye(t, v, true))
    ribbon(new T.Color(hairColors[a.hairColor]).lerp(new T.Color('#685040'), 0.28), (t, v) => {
      const arc = Math.sin(t * Math.PI) ** 0.5
      return [
        side * (0.018 + 0.04 * t),
        0.08 + 0.003 * Math.sin(t * Math.PI) + 0.002 * (a.brows - 1) * t + (0.003 + 0.001 * a.brows) * arc * v,
        0.0015,
      ]
    })
  }
  for (const side of [-1, 1])
    ribbon(new T.Color(skinTones[a.skin]).lerp(new T.Color('#794b3b'), 0.5), (t, v) => [
      side * (0.006 + 0.008 * t),
      0.028 + 0.0014 * Math.sin(t * Math.PI) + 0.0013 * v * Math.sin(t * Math.PI),
      0.0011,
    ])
  const lip = new T.Color(skinTones[a.skin]).lerp(new T.Color('#994e48'), 0.52)
  ribbon(lip, (t, v) => {
    const arc = Math.sin(Math.PI * t)
    return [
      (0.5 - t) * 0.041,
      0.002 + 0.0015 * (2 * t - 1) ** 2 + arc * (v - 0.5) * (0.006 + 0.002 * Math.sin(2 * Math.PI * t) ** 2),
      0.0018,
    ]
  })
  ribbon('#925e52', (t, v) => [
    (0.5 - t) * 0.034,
    0.002 + 0.0015 * (2 * t - 1) ** 2 + 0.0008 * v * Math.sin(Math.PI * t),
    0.0022,
  ])
  return group
}
