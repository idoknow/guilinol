// 江堤：水面场 .5 等值线（marching squares，格心节点 + 线性插值，和地面 shader 的双线性挖空对齐）
// 拉成一圈石砌堤墙：水下 0.5 m 起，高出路面 0.9 m 当栏墙。地面在水面上方 ~10 m，没有这道墙岸线就是一个个悬空的洞。
// 入夜墙顶一串暖灯，倒在江里（两江四湖夜景）。
import * as T from 'three'
import {DEG, VIEW} from './config'
import {rng} from './noise'
import {GLSL_OUT, HEAD, REFLECT, disp, shader, type Ctx} from './shared'
import {waterAt, type ViewData} from './view'

export function createBanks(ctx: Ctx, view: ViewData, far = 2600) {
  const W = view.water, f = W.field, r = rng(41)
  const node = (i: number, j: number): [number, number] => [W.x0 + (i + 0.5) * W.step, W.z0 + (j + 0.5) * W.step]
  const val = (i: number, j: number) => f[j * W.w + i]
  const pos: number[] = [], nrm: number[] = [], seg: number[] = []
  const top = view.ground + 0.9, bot = -0.5
  const half = 52 * DEG
  const cut = (a: number, b: number) => (0.5 - a) / (b - a)
  const emit = (p: [number, number], q: [number, number]) => {
    const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2, d = Math.hypot(mx, mz)
    if (d > far || d < 20) return
    let da = Math.atan2(-mz, mx) - VIEW.az
    da = Math.atan2(Math.sin(da), Math.cos(da))
    if (Math.abs(da) > half) return
    // 墙面朝水（场梯度方向）
    const e = 2
    let nx = waterAt(W, mx + e, mz) - waterAt(W, mx - e, mz), nz = waterAt(W, mx, mz + e) - waterAt(W, mx, mz - e)
    const nl = Math.hypot(nx, nz) || 1
    nx /= nl
    nz /= nl
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]), s = r()
    // 两个三角形：p 底、q 底、q 顶、p 顶
    for (const [x, z, y, u] of [
      [p[0], p[1], bot, 0], [q[0], q[1], bot, len], [q[0], q[1], top, len],
      [p[0], p[1], bot, 0], [q[0], q[1], top, len], [p[0], p[1], top, 0],
    ] as const) {
      pos.push(x, y, z)
      nrm.push(nx, 0, nz)
      seg.push(u, len, s)
    }
  }
  for (let j = 0; j < W.h - 1; j++)
    for (let i = 0; i < W.w - 1; i++) {
      const a = val(i, j), b = val(i + 1, j), c = val(i + 1, j + 1), d = val(i, j + 1)
      const k = (a > 0.5 ? 1 : 0) | (b > 0.5 ? 2 : 0) | (c > 0.5 ? 4 : 0) | (d > 0.5 ? 8 : 0)
      if (k === 0 || k === 15) continue
      const [x0, z0] = node(i, j), s = W.step
      const eT = (): [number, number] => [x0 + cut(a, b) * s, z0]
      const eR = (): [number, number] => [x0 + s, z0 + cut(b, c) * s]
      const eB = (): [number, number] => [x0 + cut(d, c) * s, z0 + s]
      const eL = (): [number, number] => [x0, z0 + cut(a, d) * s]
      switch (k) {
        case 1: case 14: emit(eL(), eT()); break
        case 2: case 13: emit(eT(), eR()); break
        case 3: case 12: emit(eL(), eR()); break
        case 4: case 11: emit(eR(), eB()); break
        case 6: case 9: emit(eT(), eB()); break
        case 7: case 8: emit(eL(), eB()); break
        case 5: emit(eL(), eT()); emit(eR(), eB()); break
        case 10: emit(eT(), eR()); emit(eB(), eL()); break
      }
    }

  const g = ctx.track(new T.BufferGeometry())
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new T.Float32BufferAttribute(nrm, 3))
  g.setAttribute('aS', new T.Float32BufferAttribute(seg, 3))
  const mat = shader(
    ctx,
    /* glsl */ `attribute vec3 aS; varying vec3 vW, vN, vS;
    void main(){ vW = position; vN = normal; vS = aS; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`,
    HEAD +
      /* glsl */ `uniform vec3 uStone, uMoss, uLamp; uniform float uNight; varying vec3 vW, vN, vS;
    float h1(float x){ return fract(sin(x * 91.17) * 43758.5453); }
    void main(){
      vec3 toC = cameraPosition - vW; float dist = length(toC); vec3 V = toC / dist;
      vec3 N = normalize(vN) * (gl_FrontFacing ? 1. : -1.);
      float y = vW.y;
      // 条石：0.6 m 一层，错缝；水线以上 2 m 一道湿痕，近水长青苔
      float course = floor(y / .6), joint = smoothstep(.04, 0., abs(fract(y / .6) - .5) - .46);
      float n = vnoise(vec2(vS.x * .7 + course * 3.1, course));
      vec3 alb = uStone * (.8 + .35 * n) * (1. - joint * .35);
      alb = mix(alb, uMoss, smoothstep(2.4, .2, y) * .7);
      alb *= mix(.55, 1., smoothstep(.0, 2.2, y));
      // 栏墙压顶：浅一点
      alb *= 1. + .35 * smoothstep(uGround + .55, uGround + .7, y);
      vec3 c = shade(alb, N, V);
      // 墙顶灯：每段中点一盏（约 16 m 一盏），只亮一半段落
      float lamp = step(vS.z, .55) * smoothstep(.7, .2, abs(vS.x - vS.y * .5)) * smoothstep(1.2, .3, abs(y - uGround - .45));
      c += uLamp * lamp * uNight * 3.;
      c += uLamp * uNight * .08 * smoothstep(uGround - 4., uGround + .9, y);
      gl_FragColor = vec4(applyAir(c, vW, -V, dist), 1.);
      ${GLSL_OUT}
    }`,
    {uStone: {value: disp('#8a8274', 0.85)}, uMoss: {value: disp('#3d4a36', 0.8)}, uLamp: {value: disp('#ffc47a', 1.4)}},
    {side: T.DoubleSide},
  )
  const mesh = new T.Mesh(g, mat)
  mesh.frustumCulled = false
  mesh.layers.enable(REFLECT)
  return {mesh, segments: pos.length / 18}
}
