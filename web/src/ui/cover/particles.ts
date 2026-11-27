// 加色光晕（代替 bloom）、孔明灯、烟花（GPU 解析弹道）、主角身边逆光光尘。
import * as T from 'three'
import {PALETTE} from './config'
import {rng} from './noise'
import {GLSL_OUT, REFLECT, disp, shader, type Ctx} from './shared'

/** 所有光晕一个 draw call：实例 = 位置 + 颜色×强度 + 世界尺寸。每帧整批重写（几百个，很便宜）。 */
export class Halos {
  readonly mesh: T.Mesh
  private pos: Float32Array
  private col: Float32Array
  private geo: T.InstancedBufferGeometry
  private base: {p: T.Vector3; c: T.Color; s: number}[] = []
  count = 0
  constructor(ctx: Ctx, readonly max: number) {
    const g = (this.geo = ctx.track(new T.InstancedBufferGeometry()))
    const quad = new T.PlaneGeometry(1, 1)
    g.index = quad.index
    g.setAttribute('position', quad.getAttribute('position'))
    this.pos = new Float32Array(max * 3)
    this.col = new Float32Array(max * 4)
    g.setAttribute('aP', new T.InstancedBufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage))
    g.setAttribute('aC', new T.InstancedBufferAttribute(this.col, 4).setUsage(T.DynamicDrawUsage))
    g.instanceCount = 0
    this.mesh = new T.Mesh(
      g,
      shader(
        ctx,
        /* glsl */ `attribute vec3 aP; attribute vec4 aC; uniform float uPx; varying vec2 vUv; varying vec3 vC;
        void main(){ vec4 c = viewMatrix * vec4(aP, 1.);
          // 最小 3 px：远处的灯不会缩没
          // 最大约 1.7°：贴近镜头的灯泡不会糊成一大片
          float s = min(max(aC.w, -c.z * 3. / uPx), -c.z * .03);
          c.xy += position.xy * s; vUv = position.xy * 2.; vC = aC.rgb * min(1., aC.w / s * 4.);
          gl_Position = projectionMatrix * c; }`,
        /* glsl */ `varying vec2 vUv; varying vec3 vC;
        void main(){ float d = length(vUv); if (d > 1.) discard;
          float a = pow(1. - d, 3.) * .35 + exp(-d * d * 40.) * 1.2;
          gl_FragColor = vec4(vC * a, 1.); ${GLSL_OUT} }`,
        {},
        {transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide},
      ),
    )
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 6
    this.mesh.layers.enable(REFLECT)
  }
  add(p: T.Vector3, c: T.Color, s: number) {
    this.base.push({p: p.clone(), c: c.clone(), s})
    return this.base.length - 1
  }
  /** 写第 i 个（k = 亮度倍率；p 省略则用登记时的位置） */
  set(i: number, k: number, p?: T.Vector3, s?: number) {
    const b = this.base[i]
    if (p) b.p.copy(p)
    this.pos.set([b.p.x, b.p.y, b.p.z], i * 3)
    this.col.set([b.c.r * k, b.c.g * k, b.c.b * k, s ?? b.s], i * 4)
    this.count = Math.max(this.count, i + 1)
  }
  flush() {
    this.geo.instanceCount = this.count
    this.geo.getAttribute('aP').needsUpdate = true
    this.geo.getAttribute('aC').needsUpdate = true
  }
}

/** 孔明灯：从城里某处成群升起，随风漂、慢慢暗下去。纯光晕（远处只是一点暖光）。 */
export function createLanterns(ctx: Ctx, halos: Halos) {
  const max = ctx.spec.lanterns
  const r = rng(5)
  const col = disp(PALETTE.lantern, 1.1)
  const items = Array.from({length: max}, () => ({
    slot: halos.add(new T.Vector3(), col, 5),
    p: new T.Vector3(),
    v: new T.Vector3(),
    t: -1,
    life: 0,
    ph: r() * 6.28,
    size: 4 + r() * 3,
  }))
  let next = 0
  return {
    /** 在 (x, y, z) 放 n 盏；远近决定光晕尺寸 */
    launch(x: number, y: number, z: number, n: number, dist: number) {
      const s = T.MathUtils.clamp(dist / 260, 0.4, 8)
      for (let i = 0; i < n; i++) {
        const it = items[next++ % max]
        it.p.set(x + (r() - 0.5) * 40 * s, y + r() * 6 * s, z + (r() - 0.5) * 40 * s)
        it.v.set((r() - 0.5) * 0.6, 1.4 + r() * 1.1, (r() - 0.5) * 0.6).multiplyScalar(Math.max(1, s * 0.6))
        it.t = -r() * 0.6
        it.life = 34 + r() * 14
        // 光晕直径按远近放大（亮芯约占 1/6）：近处 ~10 px 亮芯，1 km 外仍有 ~30 px 暖晕，读得出是一盏灯
        it.size = (4.5 + r() * 2) * Math.max(0.6, s)
      }
    },
    update(dt: number, time: number, wind: T.Vector3) {
      for (const it of items) {
        if (it.life <= 0) continue
        it.t += dt
        if (it.t < 0) {
          halos.set(it.slot, 0)
          continue
        }
        it.p.addScaledVector(it.v, dt).addScaledVector(wind, dt)
        const fade = Math.min(1, it.t / 0.5) * (1 - T.MathUtils.smoothstep(it.t, it.life * 0.6, it.life))
        const flick = 0.85 + 0.15 * Math.sin(time * 7 + it.ph) * Math.sin(time * 2.3 + it.ph * 2)
        halos.set(it.slot, fade * flick, it.p, it.size)
        if (it.t > it.life) it.life = 0
      }
    },
  }
}

const PALETTES = [
  ['#ffd27a', '#ffb347'],
  ['#ff6b5a', '#ffc38a'],
  ['#9fe6ff', '#ffffff'],
  ['#ffe3f0', '#ff8fc7'],
  ['#b8ff9e', '#fff0a8'],
]
const TRAIL = 3

/** 烟花：每发 K 颗火星，位置在顶点着色器里按时间解析（阻尼 + 重力），每颗拖 3 节残影。 */
export function createFireworks(ctx: Ctx, halos: Halos) {
  const K = Math.max(60, Math.round(ctx.spec.sparks / 8))
  const shells = Math.max(2, Math.floor(ctx.spec.sparks / K))
  const N = shells * K
  const r = rng(77)
  const g = ctx.track(new T.BufferGeometry())
  const aDir = new Float32Array(N * TRAIL * 4), aBurst = new Float32Array(N * TRAIL * 4), aCol = new Float32Array(N * TRAIL * 3)
  const aLag = new Float32Array(N * TRAIL)
  for (let i = 0; i < N; i++) for (let k = 0; k < TRAIL; k++) aLag[i * TRAIL + k] = k
  aBurst.fill(-999)
  g.setAttribute('position', new T.BufferAttribute(new Float32Array(N * TRAIL * 3), 3))
  const dirA = new T.BufferAttribute(aDir, 4).setUsage(T.DynamicDrawUsage)
  const burstA = new T.BufferAttribute(aBurst, 4).setUsage(T.DynamicDrawUsage)
  const colA = new T.BufferAttribute(aCol, 3).setUsage(T.DynamicDrawUsage)
  g.setAttribute('aDir', dirA)
  g.setAttribute('aBurst', burstA)
  g.setAttribute('aCol', colA)
  g.setAttribute('aLag', new T.BufferAttribute(aLag, 1))
  const mat = shader(
    ctx,
    /* glsl */ `attribute vec4 aDir, aBurst; attribute vec3 aCol; attribute float aLag; uniform float uTime, uPx;
    varying vec3 vC; varying float vA;
    void main(){
      float t = uTime - aBurst.w - aLag * .045;
      float life = aDir.w;
      if (t < 0. || t > life) { gl_Position = vec4(2., 2., 2., 1.); gl_PointSize = 0.; return; }
      float k = 1.6;
      vec3 p = aBurst.xyz + aDir.xyz * (1. - exp(-k * t)) / k + vec3(0., -9., 0.) * t * t * .5;
      vec4 c = viewMatrix * vec4(p, 1.);
      gl_Position = projectionMatrix * c;
      float age = t / life;
      float crackle = step(.62, age) * step(.5, fract(sin(dot(aDir.xyz, vec3(12.9, 78.2, 37.7)) + floor(uTime * 18.)) * 43758.5));
      vA = (1. - age) * (1. - age) * (1. - aLag * .32) * (1. + crackle * 1.5) * (1. + 3. * exp(-t * 9.));
      vC = mix(aCol, vec3(1., .55, .25), smoothstep(.45, 1., age));
      gl_PointSize = clamp(3.6 * uPx / -c.z * (1. - aLag * .2), 1.5, 10.);
    }`,
    /* glsl */ `varying vec3 vC; varying float vA;
    void main(){ vec2 q = gl_PointCoord * 2. - 1.; float d = dot(q, q); if (d > 1.) discard;
      gl_FragColor = vec4(vC * vA * (exp(-d * 4.) * 2.4), 1.); ${GLSL_OUT} }`,
    {},
    {transparent: true, depthWrite: false, blending: T.AdditiveBlending},
  )
  const points = new T.Points(g, mat)
  points.frustumCulled = false
  points.renderOrder = 7
  points.layers.enable(REFLECT)

  // 升空的火箭 + 炸开那一下的大光晕
  const rockets = Array.from({length: 3}, () => ({slot: halos.add(new T.Vector3(), disp('#ffcf91', 0.6), 3), flash: halos.add(new T.Vector3(), disp('#fff1d0', 0.7), 40), from: new T.Vector3(), to: new T.Vector3(), t0: -99, rise: 1, pal: 0, done: true}))
  let shell = 0, rocketIndex = 0
  const tmpC = new T.Color(), c2 = new T.Color(), dir = new T.Vector3(), p = new T.Vector3()
  /** 当前闪光强度（给天台/人物补光） */
  let flash = 0

  function burst(at: T.Vector3, time: number, pal: number, scale: number) {
    const base = (shell++ % shells) * K
    const [ca, cb] = PALETTES[pal % PALETTES.length]
    const speed = (92 + r() * 34) * scale
    for (let i = 0; i < K; i++) {
      dir.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1)
      if (dir.lengthSq() > 1 || dir.lengthSq() < 1e-4) dir.randomDirection()
      dir.normalize().multiplyScalar(speed * (0.8 + r() * 0.25))
      tmpC.set(r() < 0.75 ? ca : cb)
      c2.copy(tmpC).convertSRGBToLinear().multiplyScalar(1.6)
      const life = 2.1 + r() * 1.2
      for (let k = 0; k < TRAIL; k++) {
        const j = (base + i) * TRAIL + k
        aDir.set([dir.x, dir.y, dir.z, life], j * 4)
        aBurst.set([at.x, at.y, at.z, time], j * 4)
        aCol.set([c2.r, c2.g, c2.b], j * 3)
      }
    }
    for (const a of [dirA, burstA, colA]) {
      a.clearUpdateRanges()
      a.addUpdateRange(base * TRAIL * a.itemSize, K * TRAIL * a.itemSize)
      a.needsUpdate = true
    }
  }

  return {
    points,
    get flash() {
      return flash
    },
    /** 从 from 发射到 to 炸开（scale = 远近换算的大小） */
    launch(from: T.Vector3, to: T.Vector3, time: number, scale: number) {
      const rk = rockets[rocketIndex++ % rockets.length]
      rk.from.copy(from)
      rk.to.copy(to)
      rk.t0 = time
      rk.rise = 1.1 + r() * 0.4
      rk.pal = Math.floor(r() * PALETTES.length)
      rk.done = false
      ;(rk as {scale?: number}).scale = scale
    },
    update(time: number) {
      flash = 0
      for (const rk of rockets) {
        const a = time - rk.t0
        const s = (rk as {scale?: number}).scale ?? 1
        if (!rk.done && a >= rk.rise) {
          rk.done = true
          burst(rk.to, rk.t0 + rk.rise, rk.pal, s)
        }
        const up = a >= 0 && a < rk.rise
        const k = T.MathUtils.smootherstep(a / rk.rise, 0, 1)
        halos.set(rk.slot, up ? 0.8 : 0, p.lerpVectors(rk.from, rk.to, Math.sqrt(Math.max(0, k))), 2.5 * s)
        const b = a - rk.rise
        const f = b >= 0 && b < 1.2 ? Math.exp(-b * 5) : 0
        flash = Math.max(flash, f)
        halos.set(rk.flash, f, rk.to, 55 * s)
      }
    },
  }
}

/** 主角身边的光尘：落日逆光里闪着金点，入夜被串灯照成暖色，鼠标附近会被拨开。 */
export function createDust(ctx: Ctx, center: T.Vector3) {
  const n = ctx.spec.dust
  const r = rng(9)
  const g = ctx.track(new T.BufferGeometry())
  const pos = new Float32Array(Math.max(1, n) * 3), seed = new Float32Array(Math.max(1, n))
  for (let i = 0; i < n; i++) pos.set([(r() - 0.5) * 5, r() * 2.6, (r() - 0.5) * 5], i * 3), (seed[i] = r())
  g.setAttribute('position', new T.BufferAttribute(pos, 3))
  g.setAttribute('aSeed', new T.BufferAttribute(seed, 1))
  const mat = shader(
    ctx,
    /* glsl */ `uniform float uTime, uPx; uniform vec3 uCenter; attribute float aSeed; varying float vA; varying float vS;
    void main(){
      vec3 q = position;
      float s = aSeed;
      vec3 p = uCenter + vec3(
        mod(q.x + sin(uTime * .13 + s * 30.) * .6 + uTime * .05 + 2.5, 5.) - 2.5,
        mod(q.y + uTime * (.03 + .05 * s), 2.6) + .1,
        mod(q.z + cos(uTime * .11 + s * 20.) * .6 + 2.5, 5.) - 2.5);
      vec4 c = viewMatrix * vec4(p, 1.);
      gl_Position = projectionMatrix * c;
      float tw = .5 + .5 * sin(uTime * (1. + s * 2.) + s * 50.);
      vA = tw * smoothstep(0., .4, p.y - uCenter.y) * smoothstep(2.7, 2., p.y - uCenter.y);
      vS = s;
      gl_PointSize = clamp(.012 * uPx / -c.z, 1., 6.);
    }`,
    /* glsl */ `uniform vec3 uSunCol, uSunDir, uBulb; uniform float uNight; varying float vA; varying float vS;
    void main(){ vec2 q = gl_PointCoord * 2. - 1.; float d = dot(q, q); if (d > 1.) discard;
      vec3 c = uSunCol * smoothstep(-.06, .04, uSunDir.y) * .9 + uBulb * uNight * .4;
      gl_FragColor = vec4(c * vA * exp(-d * 3.) * .9, 1.); ${GLSL_OUT} }`,
    {uCenter: {value: center}, uBulb: {value: disp(PALETTE.bulb, 1)}},
    {transparent: true, depthWrite: false, blending: T.AdditiveBlending},
  )
  const points = new T.Points(g, mat)
  points.frustumCulled = false
  points.renderOrder = 7
  points.visible = n > 0
  return points
}
