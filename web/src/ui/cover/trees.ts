// 绿化：江滨树带 + 街区零星树冠。低模球冠一个实例化 draw call；逆光时冠缘透出金色（叶片透光）。
import * as T from 'three'
import {DEG, PALETTE, VIEW} from './config'
import {rng} from './noise'
import {GLSL_OUT, HEAD, REFLECT, disp, shader, type Ctx} from './shared'
import {wetAt, type ViewData} from './view'

const STEP = 7
const CELL = 16

export function createTrees(ctx: Ctx, view: ViewData, lots: {x: number; z: number; w: number; d: number}[], roof: T.Box3, max: number) {
  const r = rng(31)
  // 楼块占位（粗网格）：外接圆 + 4 m 退界
  const occ = new Set<number>()
  const key = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096)
  for (const l of lots) {
    const rad = Math.hypot(l.w, l.d) / 2 + 4
    for (let i = Math.floor((l.x - rad) / CELL); i <= Math.floor((l.x + rad) / CELL); i++)
      for (let j = Math.floor((l.z - rad) / CELL); j <= Math.floor((l.z + rad) / CELL); j++)
        if (Math.hypot((i + 0.5) * CELL - l.x, (j + 0.5) * CELL - l.z) < rad + CELL * 0.35) occ.add(key(i, j))
  }
  const wet = (x: number, z: number) => wetAt(view.water, x, z)
  const half = 46 * DEG, far = 1700
  // 相机离地高（冠顶 = 地面 + 2.75 s + 1.8）
  const eyeH = view.roof - view.ground + 1.55
  const cand: {x: number; z: number; s: number; d: number}[] = []
  const at = new T.Vector3()
  for (let x = -far; x <= far; x += STEP)
    for (let z = -far; z <= far; z += STEP) {
      const px = x + (r() - 0.5) * STEP * 0.9, pz = z + (r() - 0.5) * STEP * 0.9
      const d = Math.hypot(px, pz)
      if (d < 36 || d > far) continue
      let da = Math.atan2(-pz, px) - VIEW.az
      da = Math.atan2(Math.sin(da), Math.cos(da))
      if (Math.abs(da) > half) continue
      if (wet(px, pz) || occ.has(key(Math.floor(px / CELL), Math.floor(pz / CELL)))) continue
      if (roof.containsPoint(at.set(px, roof.min.y, pz))) continue
      // 岸边 30 m 内成带（江滨步道的行道树），其余零星（院落、街角）
      let bank = false
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]])
        if (wet(px + ox * 26, pz + oz * 26)) bank = true
      if (r() > (bank ? 0.9 : 0.1)) continue
      let size = bank ? 3.2 + r() * 2.6 : 2.6 + r() * 2.2
      // 江景视廊：身后有江面就把冠顶压到视线以下（压不下就不种），近岸水面不被树挡
      for (let s = d + size; s < d + 700; s += 10) {
        if (!wet((px / d) * s, (pz / d) * s)) continue
        size = Math.min(size, (eyeH * (1 - (d + size) / s) - 2.4) / 2.75)
        break
      }
      if (size < 1.6) continue
      cand.push({x: px, z: pz, s: size, d})
    }
  cand.sort((a, b) => a.d - b.d)
  const n = Math.min(cand.length, max)
  // 两档：近处 15 % 用 3 团 × 80 面的冠，其余 2 团 × 20 面（远处只剩几十像素，面数看不出来）
  const nNear = Math.min(n, Math.round(max * 0.15))
  const part = (from: number, to: number, crown: T.BufferGeometry) => {
    const data = new Float32Array((to - from) * 4)
    for (let i = from; i < to; i++) data.set([cand[i].x, cand[i].z, cand[i].s, r()], (i - from) * 4)
    const g = ctx.track(new T.InstancedBufferGeometry())
    g.setAttribute('position', crown.getAttribute('position'))
    g.setAttribute('normal', crown.getAttribute('normal'))
    g.setAttribute('aT', new T.InstancedBufferAttribute(data, 4))
    g.instanceCount = to - from
    crown.dispose()
    const mesh = new T.Mesh(g, mat)
    mesh.frustumCulled = false
    mesh.layers.enable(REFLECT)
    return mesh
  }
  const mat = shader(
    ctx,
    /* glsl */ `attribute vec4 aT; uniform float uGround; varying vec3 vW, vN, vC; varying float vSeed;
    void main(){
      float s = aT.z, sd = aT.w;
      // 每棵绕 Y 随机转一下，冠形略扁；顶点按低频正弦起伏，轮廓不再是正球
      float a = sd * 6.283, ca = cos(a), sa = sin(a);
      vec3 q = vec3(position.x * ca - position.z * sa, position.y, position.x * sa + position.z * ca);
      vec3 nl = vec3(normal.x * ca - normal.z * sa, normal.y, normal.x * sa + normal.z * ca);
      float bump = sin(dot(q, vec3(3.1, 2.7, 4.3)) + sd * 20.) * .1 + sin(dot(q, vec3(-5.3, 6.1, 1.7)) + sd * 9.) * .07;
      q += nl * bump;
      vec3 p = q * vec3(s, s * (.78 + sd * .28), s);
      vec3 w = vec3(aT.x, uGround + s * .95 + 1.8, aT.y) + p;
      vN = nl; vC = q; vSeed = sd; vW = w;
      gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
    }`,
    HEAD +
      /* glsl */ `uniform vec3 uLeaf, uLeaf2; varying vec3 vW, vN, vC; varying float vSeed;
    void main(){
      vec3 toC = cameraPosition - vW; float dist = length(toC); vec3 V = toC / dist;
      vec3 Nc = normalize(vC);
      // 叶团：团法线与整冠法线各半，再用世界坐标噪声打成一簇簇
      vec3 nz = vec3(vnoise(vW.xz * .55 + vW.y * .4), vnoise(vW.zy * .55 + 3.1), vnoise(vW.xy * .55 + 7.7)) - .5;
      vec3 N = normalize(mix(normalize(vN), Nc, .45) + nz * 1.1);
      float thin = 1. - max(dot(Nc, V), 0.);
      // 近处轮廓抠出叶缘（远了会闪，只在 350 m 内）
      float leaf = vnoise(vW.xz * 1.6 + vW.y * 1.3 + vSeed * 10.);
      if (leaf < (thin - .62) * 2.4 * (1. - smoothstep(200., 350., dist))) discard;
      vec3 alb = mix(uLeaf, uLeaf2, smoothstep(.3, .7, vSeed)) * (.75 + .5 * vnoise(vW.xz * .25 + vSeed * 9.));
      float ao = .4 + .6 * smoothstep(-.75, .65, Nc.y);
      vec3 amb = mix(uAmbDn, uAmbUp, N.y * .5 + .5);
      float diff = max((dot(N, uSunDir) + .4) / 1.4, 0.);
      vec3 c = alb * (amb * .8 + uSunLight * diff * .45) * ao;
      // 逆光透叶：冠缘最薄处透出黄绿金
      float back = pow(max(dot(-V, uSunDir), 0.), 4.);
      c += uSunLight * alb * vec3(1.15, 1.1, .6) * back * (.06 + pow(thin, 3.) * 1.3);
      gl_FragColor = vec4(applyAir(c, vW, -V, dist), 1.);
      ${GLSL_OUT}
    }`,
    {uLeaf: {value: disp('#2a4229', 0.8)}, uLeaf2: {value: disp('#44592a', 0.75)}},
  )
  const lod0 = part(0, nNear, crown(1, LOBES))
  const lod1 = part(nNear, n, crown(0, LOBES.slice(0, 2)))
  const group = new T.Group()
  group.add(lod0, lod1)
  return {group, count: n}
}

/** 冠团：中心大团 + 两侧小团（单位尺度，中心在原点附近） */
const LOBES: [number, number, number, number][] = [
  [0, 0.08, 0, 1],
  [0.55, -0.18, 0.22, 0.72],
  [-0.48, -0.12, -0.32, 0.74],
]

function crown(detail: number, lobes: typeof LOBES) {
  const pos: number[] = [], nrm: number[] = []
  for (const [x, y, z, rad] of lobes) {
    const ico = new T.IcosahedronGeometry(1, detail)
    const p = ico.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), py = p.getY(i), pz = p.getZ(i), l = Math.hypot(px, py, pz)
      pos.push(x + px * rad, y + py * rad, z + pz * rad)
      nrm.push(px / l, py / l, pz / l)
    }
    ico.dispose()
  }
  const g = new T.BufferGeometry()
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new T.Float32BufferAttribute(nrm, 3))
  return g
}

/** 主角所在楼顶的占地（场景坐标外接框），绿化避让用 */
export function roofBox(rect: {u0: number; v0: number; u1: number; v1: number}, fromGrid: (u: number, v: number) => [number, number]) {
  const b = new T.Box3()
  for (const [u, v] of [[rect.u0, rect.v0], [rect.u1, rect.v0], [rect.u0, rect.v1], [rect.u1, rect.v1]] as const) {
    const [x, z] = fromGrid(u, v)
    b.expandByPoint(new T.Vector3(x, 0, z))
  }
  return b.expandByScalar(4)
}
