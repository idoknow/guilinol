// 程序城市：沿桂林老城南北向街网布楼（避开江面、峰脚、地标和主角所在楼），一个实例化 draw call。
// 立面窗格全在 shader 里：白天窗玻璃反天光，入夜按时间逐扇亮灯；远处窗格亚像素时取均值（不闪）。
// 点城市 = 一圈「亮灯波」从点击处向外扩散。
import * as T from 'three'
import {DEG, FRAME, PALETTE, SITE, VIEW, dirAz} from './config'
import {rng} from './noise'
import {GLSL_OUT, HEAD, REFLECT, disp, shader, type Ctx} from './shared'
import {wetAt, type ViewData} from './view'

const GC = Math.cos(SITE.grid), GS = Math.sin(SITE.grid)
/** 场景 xz → 街网坐标 uv（u 沿街网「东」，v 沿「南」） */
export const toGrid = (x: number, z: number): [number, number] => [x * GC - z * GS, x * GS + z * GC]
export const fromGrid = (u: number, v: number): [number, number] => [u * GC + v * GS, -u * GS + v * GC]
export const GRID_ROT = new T.Vector2(GC, GS)

/** 主角所在楼顶：按主角站位反推西北角（u、v 最小），让主角离西、北两道栏杆各留 SITE.heroInset 米。 */
export function roofRect() {
  const at = dirAz(SITE.heroAz)
  const [hu, hv] = toGrid(at.x * FRAME.dist, at.z * FRAME.dist)
  const cu = hu - SITE.heroInset[0], cv = hv - SITE.heroInset[1]
  return {u0: cu, v0: cv, u1: cu + SITE.roofSize[0], v1: cv + SITE.roofSize[1]}
}

const FACADES = ['#ddd6c8', '#cbc5ba', '#bdb9b1', '#e3d9c5', '#aab2b6', '#d2c8b2', '#a3a9a8', '#c9b9a3']
const WAVES = 2

interface Lot {
  x: number
  z: number
  w: number
  d: number
  h: number
  dist: number
}

export function createCity(ctx: Ctx, view: ViewData, avoid: T.Box3[], hills: {at: T.Vector3; dist: number; az: number}[]) {
  const r = rng(11)
  const {block, street, cityNear, cityFar} = SITE
  const camY = view.roof + 1.55
  const roof = roofRect()
  const half = 44 * DEG
  // 视野楔形在街网坐标里的外接框
  let umin = 0, umax = 0, vmin = 0, vmax = 0
  for (let a = -half; a <= half + 1e-6; a += half / 8) {
    const d = dirAz(VIEW.az + a)
    const [u, v] = toGrid(d.x * cityFar, d.z * cityFar)
    umin = Math.min(umin, u), umax = Math.max(umax, u), vmin = Math.min(vmin, v), vmax = Math.max(vmax, v)
  }
  const grown = avoid.map((b) => b.clone().expandByVector(new T.Vector3(70, 0, 70)))
  const lots: Lot[] = []
  const tmp = new T.Vector3()
  for (let bu = Math.floor(umin / block); bu <= Math.ceil(umax / block); bu++)
    for (let bv = Math.floor(vmin / block); bv <= Math.ceil(vmax / block); bv++) {
      const u0 = bu * block + street / 2, v0 = bv * block + street / 2, size = block - street
      const nu = 1 + Math.floor(r() * 3), nv = 1 + Math.floor(r() * 3)
      for (let i = 0; i < nu; i++)
        for (let j = 0; j < nv; j++) {
          const lw = size / nu, ld = size / nv
          const sb = 1.5 + r() * 3.5
          const w = lw - sb * 2 - r() * 4, d = ld - sb * 2 - r() * 4
          const cu = u0 + lw * (i + 0.5) + (r() - 0.5) * 3, cv = v0 + ld * (j + 0.5) + (r() - 0.5) * 3
          const roll = r(), roll2 = r(), roll3 = r()
          if (w < 7 || d < 7) continue
          if (cu + w / 2 > roof.u0 - 6 && cu - w / 2 < roof.u1 + 6 && cv + d / 2 > roof.v0 - 6 && cv - d / 2 < roof.v1 + 6) continue
          const [x, z] = fromGrid(cu, cv)
          const dist = Math.hypot(x, z)
          if (dist < cityNear || dist > cityFar) continue
          const az = Math.atan2(-z, x)
          let da = az - VIEW.az
          da = Math.atan2(Math.sin(da), Math.cos(da))
          if (Math.abs(da) > half) continue
          if (roll < T.MathUtils.smoothstep(dist, 1700, cityFar) * 0.55) continue
          // 江面：中心 + 四角任一落水就不建
          let wet = wetAt(view.water, x, z)
          for (const [su, sv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
            const [px, pz] = fromGrid(cu + (su * w) / 2, cv + (sv * d) / 2)
            wet ||= wetAt(view.water, px, pz)
          }
          if (wet) continue
          if (view.peaks.spots.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 18)) continue
          if (grown.some((b) => b.containsPoint(tmp.set(x, b.min.y, z)))) continue
          // 层数：多数 4–18 层；1.2 km 外偶有高层；老城（地标 700 m 内）限高；近处与地标视线走廊再压低
          let floors = 4 + Math.floor(roll2 ** 1.7 * 15)
          if (dist > 1200 && roll3 < 0.06) floors = 20 + Math.floor(roll3 * 230)
          for (const h of hills) {
            if (Math.hypot(h.at.x - x, h.at.z - z) < 700) floors = Math.min(floors, 3 + Math.floor(roll2 * 5))
            let dh = az - h.az
            dh = Math.atan2(Math.sin(dh), Math.cos(dh))
            if (Math.abs(dh) < 5 * DEG && dist < h.dist) floors = Math.min(floors, 4)
          }
          if (dist < 1200) floors = Math.min(floors, Math.floor((camY - 4 - dist * 0.004 - view.ground - 1) / 3.2))
          // 江景视廊：身后 800 m 内有江面 → 限高到不挡近岸水面（太矮就空着，当江滨绿地）
          const far = dist + Math.max(w, d) / 2
          for (let s = far; s < dist + 800; s += 12) {
            if (!wetAt(view.water, (x / dist) * s, (z / dist) * s)) continue
            floors = Math.min(floors, Math.floor(((camY - view.ground) * (1 - far / s) - 3) / 3.2))
            break
          }
          if (floors < 2) continue
          // 远处并块：一栋顶两栋，省实例
          const merge = dist > 2200 ? 1.35 : 1
          lots.push({x, z, w: w * merge, d: d * merge, h: floors * 3.2 + 1, dist})
        }
    }
  lots.sort((a, b) => a.dist - b.dist)
  const n = Math.min(lots.length, ctx.spec.city)

  const box = new T.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
  box.deleteAttribute('uv')
  const g = ctx.track(new T.InstancedBufferGeometry())
  g.index = box.index
  g.setAttribute('position', box.getAttribute('position'))
  g.setAttribute('normal', box.getAttribute('normal'))
  const aPos = new Float32Array(n * 4), aSize = new Float32Array(n * 2)
  const rs = rng(23)
  for (let i = 0; i < n; i++) {
    const l = lots[i]
    aPos.set([l.x, l.z, rs(), l.h], i * 4)
    aSize.set([l.w, l.d], i * 2)
  }
  g.setAttribute('aPos', new T.InstancedBufferAttribute(aPos, 4))
  g.setAttribute('aSize', new T.InstancedBufferAttribute(aSize, 2))
  g.instanceCount = n
  box.dispose()

  const waves = Array.from({length: WAVES}, () => new T.Vector4(0, 0, -999, 0))
  let waveIndex = 0
  const facade = FACADES.map((h) => disp(h, 0.85))
  const mat = shader(
    ctx,
    /* glsl */ `attribute vec4 aPos; attribute vec2 aSize; uniform vec2 uRot; uniform float uGround;
    varying vec3 vW, vN; varying vec3 vL; varying vec2 vFac, vSz; varying float vSeed, vH;
    void main(){
      float h = aPos.w + 4.;
      vSz = aSize;
      vec3 lp = position * vec3(aSize.x, h, aSize.y);
      vec3 w = vec3(aPos.x + lp.x * uRot.x + lp.z * uRot.y, uGround - 4. + lp.y, aPos.y - lp.x * uRot.y + lp.z * uRot.x);
      vN = vec3(normal.x * uRot.x + normal.z * uRot.y, normal.y, -normal.x * uRot.y + normal.z * uRot.x);
      vL = vec3(lp.x, lp.y - 4., lp.z);
      vFac = vec2(abs(normal.x) > .5 ? lp.z * sign(normal.x) : -lp.x * sign(normal.z), lp.y - 4.);
      vSeed = aPos.z + (normal.x + normal.z * 2.) * .173;
      vH = aPos.w;
      vW = w;
      gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
    }`,
    HEAD +
      /* glsl */ `uniform vec3 uFac[${FACADES.length}]; uniform vec3 uRoof, uWarm, uCool, uStreet; uniform vec4 uWave[${WAVES}];
    uniform float uNight;
    varying vec3 vW, vN; varying vec3 vL; varying vec2 vFac, vSz; varying float vSeed, vH;
    float h1(float x){ return fract(sin(x * 91.17) * 43758.5453); }
    void main(){
      vec3 N = normalize(vN), toC = cameraPosition - vW; float dist = length(toC); vec3 V = toC / dist;
      float seed = floor(vSeed * 997.);
      int fi = int(mod(seed, ${FACADES.length}.));
      vec3 alb = uFac[0];
      for (int i = 0; i < ${FACADES.length}; i++) if (i == fi) alb = uFac[i];
      // 亮灯波：点击处向外扩散，波内窗户点亮，波前一圈闪亮
      float waveLit = 0., front = 0.;
      for (int i = 0; i < ${WAVES}; i++) {
        float age = uTime - uWave[i].z;
        if (age < 0. || age > 26.) continue;
        float dw = distance(vW.xz, uWave[i].xy), rr = age * 320.;
        float fade = 1. - smoothstep(18., 26., age);
        waveLit = max(waveLit, smoothstep(rr, rr - 260., dw) * fade);
        front += exp(-pow((dw - rr) / 70., 2.)) * fade * (1. - smoothstep(0., 6., age) * .7);
      }
      vec3 c;
      if (N.y > .5) {
        // 屋面：深灰 + 斑驳 + 女儿墙一圈浅边
        float n = h1(seed + floor(vW.x * .3) * .7 + floor(vW.z * .3) * 1.3);
        vec3 ra = uRoof * (.75 + .5 * h1(seed * 1.7)) * (.9 + .2 * n);
        float edge = min(vSz.x * .5 - abs(vL.x), vSz.y * .5 - abs(vL.z));
        ra *= mix(1.3, 1., smoothstep(.35, .8, edge));
        c = shade(ra, N, V);
      } else {
        float lit0 = uNight * (.32 + .3 * h1(seed * 3.1)) + waveLit * .55;
        float colW = 2.9 + 1.3 * h1(seed * 5.3), flH = 3.2;
        vec2 g = vec2(vFac.x / colW, vFac.y / flH);
        vec2 cell = floor(g), f = fract(g);
        vec2 fw = fwidth(g);
        float glassFrac = .38 + .22 * h1(seed * 7.7);
        // 窗洞
        float wx = .5 - glassFrac * .45, wy = .22;
        vec2 aa = fw * .75 + 1e-4;
        float win = smoothstep(wx - aa.x, wx + aa.x, f.x) * smoothstep(1. - wx + aa.x, 1. - wx - aa.x, f.x)
                  * smoothstep(wy - aa.y, wy + aa.y, f.y) * smoothstep(.9 + aa.y, .9 - aa.y, f.y);
        float avgWin = (1. - 2. * wx) * (.9 - wy);
        float hc = h1(dot(cell, vec2(7.31, 157.7)) + seed * 13.1);
        float on = step(hc, lit0) * step(.5, cell.y);
        // 底商：通长玻璃、更暖更亮、更早亮
        float shop = 1. - step(1., cell.y);
        float shopOn = step(h1(cell.x * 3.7 + seed), uNight * .95 + waveLit);
        vec3 lampC = mix(uWarm, uCool, step(.8, h1(hc * 31.)));
        lampC *= .55 + .9 * h1(hc * 17.3);
        // 远处窗格小于 1 px：混成均值（不出摩尔纹）
        float far = smoothstep(.35, .9, max(fw.x, fw.y));
        win = mix(win, avgWin, far);
        float lit = mix(on, lit0 * step(.5, vFac.y / flH), far);
        vec3 wall = shade(alb, N, V);
        // 窗玻璃：反射天空（上半身更亮）
        vec3 R = reflect(-V, N);
        vec3 sky = fogColor(normalize(vec3(R.x, abs(R.y) * .6 + .02, R.z))) * (.2 + .08 * h1(hc * 5.1));
        vec3 glass = sky + lampC * lit * 1.6;
        c = mix(wall, glass, win * (1. - shop));
        c = mix(c, sky * .6 + uWarm * shopOn * 1.4 * uNight, shop * smoothstep(.15, .3, f.y) * (1. - far * .5));
        // 楼脚被街灯照暖
        c += uStreet * uNight * exp(-max(vFac.y, 0.) / 7.) * .12;
        c += uWarm * front * .25 * win;
      }
      gl_FragColor = vec4(applyAir(c, vW, -V, dist), 1.);
      ${GLSL_OUT}
    }`,
    {
      uRot: {value: GRID_ROT},
      uFac: {value: facade},
      uRoof: {value: disp('#6d6a63', 0.8)},
      uWarm: {value: disp(PALETTE.window, 1.8)},
      uCool: {value: disp(PALETTE.windowCool, 1.4)},
      uStreet: {value: disp(PALETTE.street, 1.2)},
      uWave: {value: waves},
    },
  )
  const mesh = new T.Mesh(g, mat)
  mesh.frustumCulled = false
  mesh.layers.enable(REFLECT)
  return {
    mesh,
    count: n,
    lots,
    setCount(k: number) {
      g.instanceCount = Math.min(n, k)
    },
    /** 在 (x, z) 放一圈亮灯波 */
    light(x: number, z: number, time: number) {
      waves[waveIndex].set(x, z, time, 1)
      waveIndex = (waveIndex + 1) % WAVES
    },
  }
}
