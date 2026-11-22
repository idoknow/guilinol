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
  ) {
    const p: number[] = [],
      indices: number[] = []
    for (let i = 0; i <= 18; i++)
      for (let j = 0; j < 3; j++) {
        const [x, y, lift] = point(i / 18, j / 2)
        p.push(x, y, front(x, y) - lift)
        const k = i * 3 + j
        if (i && j) indices.push(k - 4, k - 1, k, k - 4, k, k - 3)
      }
    const g = new T.BufferGeometry()
    g.setAttribute('position', new T.Float32BufferAttribute(p, 3))
    g.setIndex(indices)
    g.computeVertexNormals()
    group.add(
      new T.Mesh(
        g,
        new T.MeshStandardMaterial({color, roughness: 0.85, side: T.DoubleSide}),
      ),
    )
  }
  for (const side of [-1, 1]) {
    ribbon('#382e2b', (t, v) => [
      side * (0.02 + 0.028 * t),
      0.065 + 0.002 * t + (0.004 + 0.001 * a.eyes) * (v - 0.5) * Math.sin(Math.PI * t) ** 0.45,
      0.0015,
    ])
    ribbon(new T.Color(hairColors[a.hairColor]), (t, v) => [
      side * (0.018 + 0.041 * t),
      0.082 +
        [0.001, 0.01, 0.003][a.brows] * Math.sin(Math.PI * t) +
        [0, -0.002, -0.012][a.brows] * t +
        (0.003 + 0.001 * a.brows) * v * Math.sin(Math.PI * t) ** 0.4,
      0.0016,
    ])
  }
  ribbon(new T.Color(skinTones[a.skin]).lerp(new T.Color('#885d49'), 0.45), (t, v) => [
    (t - 0.5) * 0.019,
    0.03 + 0.005 * (1 - t) * v,
    0.0014,
  ])
  const lip = new T.Color(skinTones[a.skin]).lerp(new T.Color('#994e48'), 0.52)
  ribbon(lip, (t, v) => {
    const arc = Math.sin(Math.PI * t)
    return [
      (0.5 - t) * 0.041,
      0.002 + 0.0015 * (2 * t - 1) ** 2 + arc * (v - 0.5) * (0.009 + 0.002 * Math.sin(2 * Math.PI * t) ** 2),
      0.0018,
    ]
  })
  return group
}
