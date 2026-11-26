import * as T from 'three'
import {hairColors, skinTones, type Avatar} from '../../../lib/avatar'

let sharedLaugh:T.CanvasTexture|undefined
function laughTexture(){
  if(sharedLaugh)return sharedLaugh
  const canvas=document.createElement('canvas')
  canvas.width=256;canvas.height=192
  const ctx=canvas.getContext('2d')!
  ctx.strokeStyle='#392b26';ctx.lineWidth=8;ctx.lineCap='round'
  for(const x of [64,192]){
    ctx.beginPath();ctx.moveTo(x-21,68);ctx.quadraticCurveTo(x,43,x+21,68);ctx.stroke()
  }
  ctx.fillStyle='#763f3c';ctx.beginPath();ctx.moveTo(73,119)
  ctx.quadraticCurveTo(128,136,183,119);ctx.bezierCurveTo(172,183,91,183,73,119);ctx.fill()
  ctx.fillStyle='#f4e5cf';ctx.beginPath();ctx.moveTo(80,124)
  ctx.quadraticCurveTo(128,137,176,124);ctx.quadraticCurveTo(128,153,80,124);ctx.fill()
  sharedLaugh=new T.CanvasTexture(canvas);sharedLaugh.colorSpace=T.SRGBColorSpace
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

export function facialFeatures(geometry: T.BufferGeometry, a: Avatar) {
  const group = new T.Group(),
    front = frontOfFace(geometry)
  group.name = 'creator-face'
  const mouth=new T.Object3D()
  mouth.name='smoke-lips'
  mouth.position.set(.004,.002,front(.004,.002)-.0018)
  group.add(mouth)
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
  for (const side of [-1, 1]) {
    const eyeY = 0.065,
      halfWidth = a.eyes === 3 ? 0.009 : 0.0075 + 0.001 * a.eyes
    ribbon('#302622', (t, v) => {
      const angle = Math.PI * t
      return [
        side * (0.034 - halfWidth * Math.cos(angle)),
        eyeY + (v - 0.5) * (a.eyes === 3 ? 0.0165 : 0.011 + 0.001 * a.eyes) * Math.sin(angle),
        0.0018,
      ]
    })
    ribbon('#4a352b', (t, v) => [
      side * (0.034 + (2 * t - 1) * (halfWidth + 0.002)),
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
  const g = new T.BufferGeometry()
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3))
  g.setAttribute('color', new T.Float32BufferAttribute(colors, 3))
  g.setIndex(indices)
  const rest=new T.Mesh(g,new T.MeshBasicMaterial({vertexColors:true,side:T.DoubleSide}))
  rest.name='rest-face'
  group.add(rest)
  const texture=laughTexture()
  const surface=new T.PlaneGeometry(.145,.12,24,20)
  const points=surface.attributes.position
  for(let i=0;i<points.count;i++){
    const x=points.getX(i),y=points.getY(i)+.042
    points.setXYZ(i,x,y,front(x,y)-.002)
  }
  // The attachment's local +X is screen-right when viewed from behind.
  const laugh=new T.Mesh(surface,new T.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,side:T.DoubleSide}))
  laugh.name='laugh-face';laugh.visible=false;group.add(laugh)
  return group
}
