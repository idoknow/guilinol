// 远景：真实峰林网格 + 三层天际线剪影 + 象鼻山/日月双塔（游戏同款 lod1）+ 地面（水面处挖空、远处城市灯毯）。
import * as T from 'three'
import {elephantHill, hillFrame} from './hill'
import {DEG, PALETTE, RELIEF, SITE, dirAz} from './config'
import {GLSL_OUT, HEAD, REFLECT, disp, shader, type Ctx} from './shared'
import type {ViewData} from './view'

const VERT = /* glsl */ `varying vec3 vW, vN; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`

export function createTerrain(ctx: Ctx, view: ViewData, noise: T.Texture) {
  const group = new T.Group()

  // ---------- 峰林 ----------
  // 游戏低模峰体在长焦里读成「塔帽」。封面保留真实峰位、高度、底半径，每座峰换成一张朝镜头的
  // 「竹笋形」剪影卡（陡壁圆顶），片元里按截面重建圆顶法线：逆光一侧勾金边，山脚压一层薄雾。
  const kp: number[] = [], kk: number[] = [], ki: number[] = []
  const COLS = 30
  const rnd = (n: number) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
    return x - Math.floor(x)
  }
  view.peaks.spots.forEach((s, n) => {
    const H = (s.top - view.ground) * RELIEF.peaks
    if (H < 12) return
    const d = Math.hypot(s.x, s.z), fx = s.x / d, fz = s.z / d
    const rx = -fz, rz = fx
    const W = T.MathUtils.clamp(s.r * 0.8, H * 0.32, H * 0.85)
    // 截面：(1 - |t|^p)^q，p 越大肩越方，q 越小壁越陡；轻微歪斜让峰群不像复制粘贴
    const p = 2.2 + rnd(n) * 1.4, q = 0.32 + rnd(n + 7) * 0.18, lean = (rnd(n + 3) - 0.5) * 0.35, seed = rnd(n + 11)
    const base = kp.length / 3
    for (let i = 0; i <= COLS; i++) {
      const t = Math.sin(((i / COLS) * 2 - 1) * (Math.PI / 2))
      const bump = 1 + 0.035 * Math.sin(t * 6 + seed * 40) + 0.012 * Math.sin(t * 15 + seed * 17)
      const h = H * Math.pow(Math.max(1 - Math.abs(t) ** p, 0), q) * bump
      const off = (t + lean * (h / H)) * W
      const x = s.x + rx * off, z = s.z + rz * off
      kp.push(x, view.ground - 25, z, x, view.ground + h, z)
      kk.push(t, H, seed, t, H, seed)
      if (i) {
        const k = base + i * 2
        ki.push(k - 2, k - 1, k, k, k - 1, k + 1)
      }
    }
  })
  const pg = ctx.track(new T.BufferGeometry())
  pg.setAttribute('position', new T.Float32BufferAttribute(kp, 3))
  pg.setAttribute('aK', new T.Float32BufferAttribute(kk, 3))
  pg.setIndex(ki)
  pg.computeBoundingSphere()
  const peaks = new T.Mesh(
    pg,
    shader(
      ctx,
      /* glsl */ `attribute vec3 aK; varying vec3 vW, vK;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vK = aK; gl_Position = projectionMatrix * viewMatrix * w; }`,
      HEAD +
        /* glsl */ `uniform vec3 uVeg, uRock; varying vec3 vW, vK;
      void main(){
        vec3 toC = cameraPosition - vW; float dist = length(toC); vec3 V = toC / dist;
        float t = vK.x, H = vK.y, v = clamp((vW.y - uGround) / H, 0., 1.);
        vec3 f = normalize(vec3(vW.x, 0., vW.z)), R = vec3(-f.z, 0., f.x);
        // 圆顶截面法线：横向按 t 转向两侧，越往上越朝天
        vec3 N = normalize(R * t + vec3(0., 1., 0.) * (pow(v, 3.) * 1.2 + .1) - f * sqrt(max(1. - t * t, 0.)) * (1. - v * v * .5));
        float s = dot(vW.xz, R.xz);
        float n1 = texture2D(uNoise, vec2(s * .006, vW.y * .004) + vK.z).r;
        float streak = texture2D(uNoise, vec2(s * .03 + vK.z, vW.y * .0025)).b;
        // 喀斯特：顶部与缓处披绿，陡壁露灰白石，竖向水蚀纹
        float rock = smoothstep(.35, .75, abs(t) * .7 + (1. - v) * .3 + (n1 - .5) * .5);
        vec3 alb = mix(uVeg * (.75 + .5 * n1), uRock * (.85 + .3 * streak), rock * .75);
        vec3 c = shade(alb, N, V);
        // 山脚薄雾（漓江峰林的招牌：峰腰以下化进雾里）
        float mist = (1. - smoothstep(0., .45, v)) * .45;
        c = mix(c, fogColor(-V), mist);
        c = applyAir(c, vW, -V, dist);
        gl_FragColor = vec4(c, 1.);
        ${GLSL_OUT}
      }`,
      {uNoise: {value: noise}, uVeg: {value: disp(PALETTE.veg, 0.9)}, uRock: {value: disp(PALETTE.rock, 0.85)}},
      {side: T.DoubleSide},
    ),
  )
  peaks.layers.enable(REFLECT)
  group.add(peaks)

  // ---------- 天际线剪影带（6 km 以外）：每条带一个竖直条带，顶边发逆光金线 ----------
  const rpos: number[] = [], rtop: number[] = [], rdist: number[] = [], ridx: number[] = []
  const dir = new T.Vector3()
  for (const r of view.ribbons) {
    const base = rpos.length / 3
    for (let i = 0; i < r.h.length; i++) {
      dirAz((r.az0 + i * r.step) * DEG, 0, dir)
      const x = dir.x * r.at, z = dir.z * r.at
      rpos.push(x, Math.max(view.ground + (r.h[i] - view.ground) * RELIEF.ribbons, view.ground - 30), z, x, view.ground - 60, z)
      rtop.push(1, 0)
      rdist.push(r.at, r.at)
      if (i) {
        const k = base + i * 2
        ridx.push(k - 2, k - 1, k, k, k - 1, k + 1)
      }
    }
  }
  const rg = ctx.track(new T.BufferGeometry())
  rg.setAttribute('position', new T.Float32BufferAttribute(rpos, 3))
  rg.setAttribute('aTop', new T.Float32BufferAttribute(rtop, 1))
  rg.setIndex(ridx)
  rg.computeBoundingSphere()
  const ribbons = new T.Mesh(
    rg,
    shader(
      ctx,
      /* glsl */ `attribute float aTop; varying vec3 vW; varying float vTop;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vTop = aTop; gl_Position = projectionMatrix * viewMatrix * w; }`,
      HEAD +
        /* glsl */ `uniform vec3 uVeg; varying vec3 vW; varying float vTop;
      void main(){
        vec3 toC = cameraPosition - vW; float dist = length(toC); vec3 V = toC / dist;
        vec3 N = normalize(vec3(V.x, .35, V.z));
        vec3 c = shade(uVeg * .7, N, V);
        // 山脊线：屏幕空间 1–2 px 的逆光金边
        float px = fwidth(vTop);
        float ridge = smoothstep(1. - px * 2.5, 1., vTop);
        float back = pow(max(dot(-V, uSunDir), 0.), 3.);
        c = applyAir(c, vW, -V, dist);
        c += uGlow * ridge * (.1 + .9 * back) * .5 * mix(1., uRim.y, smoothstep(-.06, .03, uSunDir.y));
        gl_FragColor = vec4(c, 1.);
        ${GLSL_OUT}
      }`,
      {uVeg: {value: disp(PALETTE.veg, 0.8)}},
      {side: T.DoubleSide},
    ),
  )
  ribbons.layers.enable(REFLECT)
  ribbons.frustumCulled = false
  group.add(ribbons)

  // ---------- 地标：象鼻山（夜里暖色泛光）、日月双塔（金塔 / 银塔，夜里通体亮） ----------
  // 每部件一份材质（uLit/uHill 不同），共享同一程序与同一组 uniform 对象。
  // 不能用 ShaderMaterial.clone()：它深拷贝 uniform，时间/光照驱动的共享 uniform 会冻结在初始值。
  const lmU = {
    uFlood: {value: disp(PALETTE.flood, 2.4)},
    uSun: {value: disp(PALETTE.sunTower, 4.5)},
    uMoon: {value: disp(PALETTE.moonTower, 3.2)},
    uLamp: {value: disp(PALETTE.bulb, 2.2)},
    uRockH: {value: disp('#5d6058', 0.8)},
    uVegH: {value: disp('#2c3e2c', 0.8)},
  }
  const landmarkMat = (lit: boolean, hill: boolean) => shader(
    ctx,
    /* glsl */ `attribute vec3 color; attribute float aTower; varying vec3 vW, vN, vC; varying float vTower;
    void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vC = color; vTower = aTower;
      gl_Position = projectionMatrix * viewMatrix * w; }`,
    HEAD +
      /* glsl */ `uniform vec3 uFlood, uSun, uMoon, uLamp, uRockH, uVegH; uniform float uNight, uLit, uHill; varying vec3 vW, vN, vC; varying float vTower;
    void main(){
      vec3 N = normalize(vN), toC = cameraPosition - vW; float dist = length(toC); vec3 V = toC / dist;
      if (!gl_FrontFacing) N = -N;
      vec3 alb = vC;
      float up = clamp((vW.y - uGround) / 70., 0., 1.);
      if (uHill > .5) {
        // 象鼻山：喀斯特灰岩 + 顶上灌木，与峰林同一套（游戏顶点色太灰，逆光下发白）
        float n = vnoise(vW.xz * .09 + vW.y * .06);
        alb = mix(uRockH, uVegH, smoothstep(.35, .75, N.y * .6 + n * .5 + up * .2)) * (.75 + .5 * vnoise(vW.xz * .3 + vW.y * .2));
      }
      if (uHill > .5) {
        // 植被/溶蚀凹凸：噪声扰动法线（山体网格本身很圆）
        vec3 nz = vec3(vnoise(vW.xz * .22 + vW.y * .13), vnoise(vW.zy * .22 + 3.1), vnoise(vW.xy * .22 + 7.7)) - .5;
        N = normalize(N + nz * 1.1);
      }
      vec3 c = shade(alb, N, V);
      if (uHill > .5) c = mix(c, fogColor(-V), (1. - smoothstep(0., .25, up)) * .35);
      // 夜景泛光：山体由脚下往上打暖光（越往上越弱），塔身通体金/银
      vec3 flood = uHill > .5 ? uFlood * pow(1. - up, 2.) * (.4 + .6 * (1. - abs(N.y))) : mix(uSun, uMoon, vTower);
      c += alb * flood * uNight;
      c += uLamp * uLit * uNight * (uHill > .5 ? .3 : 1.);
      gl_FragColor = vec4(applyAir(c, vW, -V, dist), 1.);
      ${GLSL_OUT}
    }`,
    {...lmU, uLit: {value: lit ? 1 : 0}, uHill: {value: hill ? 1 : 0}},
    {side: T.DoubleSide},
  )
  const landmarks: Record<string, {mesh: T.Group; box: T.Box3; tops?: T.Vector3[]}> = {}
  for (const l of view.landmarks) {
    const g = new T.Group()
    const box = new T.Box3()
    const hill = l.name === '象鼻山'
    // 双塔：按水平位置两簇聚类，金塔（较高者）0、银塔 1
    const centers: T.Vector2[] = []
    if (!hill) {
      const all = l.parts.flatMap((p) => Array.from({length: p.pos.length / 3}, (_, i) => new T.Vector2(p.pos[i * 3], p.pos[i * 3 + 2])))
      const a = all[0].clone(), b = all.reduce((m, v) => (v.distanceTo(a) > m.distanceTo(a) ? v : m)).clone()
      for (let it = 0; it < 6; it++) {
        const sa = new T.Vector2(), sb = new T.Vector2()
        let na = 0, nb = 0
        for (const v of all) v.distanceTo(a) < v.distanceTo(b) ? (sa.add(v), na++) : (sb.add(v), nb++)
        a.copy(sa.divideScalar(Math.max(na, 1)))
        b.copy(sb.divideScalar(Math.max(nb, 1)))
      }
      centers.push(a, b)
    }
    const height = [0, 0]
    for (const p of l.parts)
      for (let i = 0; i < p.pos.length; i += 3) {
        const k = centers.length && centers[1].distanceTo(new T.Vector2(p.pos[i], p.pos[i + 2])) < centers[0].distanceTo(new T.Vector2(p.pos[i], p.pos[i + 2])) ? 1 : 0
        height[k] = Math.max(height[k], p.pos[i + 1])
      }
    const sunIs = height[0] >= height[1] ? 0 : 1
    // 象鼻山：游戏台阶低模只取占地中心，按侧影方向重塑（灯具部件不要，夜里改用泛光；颜色在 shader 里算）
    const parts = hill ? [{...sculptHill(l.parts), lit: false, col: undefined}] : l.parts
    for (const p of parts) {
      const geo = ctx.track(new T.BufferGeometry())
      geo.setAttribute('position', new T.BufferAttribute(p.pos, 3))
      geo.setAttribute('color', new T.BufferAttribute(p.col ? Float32Array.from(p.col, (c) => (c / 255) ** 2.2) : new Float32Array(p.pos.length), 3))
      const tower = new Float32Array(p.pos.length / 3)
      if (centers.length)
        for (let i = 0; i < tower.length; i++) {
          const v = new T.Vector2(p.pos[i * 3], p.pos[i * 3 + 2])
          tower[i] = (v.distanceTo(centers[1]) < v.distanceTo(centers[0]) ? 1 : 0) === sunIs ? 0 : 1
        }
      geo.setAttribute('aTower', new T.BufferAttribute(tower, 1))
      geo.setIndex(new T.BufferAttribute(p.index, 1))
      geo.computeVertexNormals()
      geo.computeBoundingBox()
      box.union(geo.boundingBox!)
      const m = new T.Mesh(geo, landmarkMat(p.lit, hill))
      m.layers.enable(REFLECT)
      g.add(m)
    }
    landmarks[l.name] = {
      mesh: g,
      box,
      tops: centers.length ? centers.map((c, k) => new T.Vector3(c.x, height[k], c.y)).sort((a, b) => b.y - a.y) : undefined,
    }
    group.add(g)
  }

  // ---------- 地面：水面处挖空（16 m 掩码双线性 → 平滑岸线），远处夜里铺一层灯毯 ----------
  const W = view.water
  const maskTex = ctx.track(
    new T.DataTexture(
      Uint8Array.from(W.field, (v) => Math.round(v * 255)),
      W.w,
      W.h,
      T.RedFormat,
    ),
  )
  maskTex.magFilter = maskTex.minFilter = T.LinearFilter
  maskTex.needsUpdate = true
  const gg = ctx.track(new T.PlaneGeometry(64000, 64000, 1, 1).rotateX(-Math.PI / 2))
  const ground = new T.Mesh(
    gg,
    shader(
      ctx,
      /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      HEAD +
        /* glsl */ `uniform sampler2D uMask; uniform vec4 uRect; uniform vec3 uAlb, uTree, uWarm, uCool, uHead, uTail; uniform vec4 uGrid; uniform float uNight; varying vec3 vW;
      void main(){
        vec2 m = (vW.xz - uRect.xy) * uRect.zw;
        float wet = all(greaterThan(m, vec2(0.))) && all(lessThan(m, vec2(1.))) ? texture2D(uMask, m).r : 0.;
        if (wet > .5) discard;
        vec3 toC = cameraPosition - vW; float dist = length(toC); vec3 V = toC / dist;
        float n = texture2D(uNoise, vW.xz * .0021).r, n2 = texture2D(uNoise, vW.xz * .013).g;
        vec3 alb = mix(uAlb * (.8 + .4 * n2), uTree, smoothstep(.4, .66, n));
        alb *= 1. - .45 * smoothstep(.15, .5, wet);
        // 太阳贴地：城里大半地面落在楼影里。沿太阳方向拉长的噪声 = 楼缝里漏下来的一道道长光
        vec2 sd2 = normalize(uSunDir.xz + 1e-5);
        vec2 sp = vec2(dot(vW.xz, sd2) * .0035, dot(vW.xz, vec2(-sd2.y, sd2.x)) * .045);
        float gap = smoothstep(.56, .78, texture2D(uNoise, sp).b);
        float sunK = mix(.16, 1., gap) * (max(uSunDir.y, 0.) * 1.6 + .05);
        vec3 c = alb * (uAmbUp * .85 + uSunLight * sunK);
        // 街网：沥青路面；入夜两侧路灯成串、车流（迎面白、背向红）沿街流动
        vec2 gp = vec2(vW.x * uGrid.x - vW.z * uGrid.y, vW.x * uGrid.y + vW.z * uGrid.x);
        vec2 fr = fract(gp / uGrid.z) * uGrid.z, ds = min(fr, uGrid.z - fr);
        vec2 side = step(fr, vec2(uGrid.z * .5)) * 2. - 1.;
        float hw = uGrid.w * .5;
        float road = 1. - smoothstep(hw - 1., hw + 1., min(ds.x, ds.y));
        c = mix(c, shade(uAlb * .45, vec3(0., 1., 0.), V), road * (1. - smoothstep(1500., 4000., dist)));
        float px = length(fwidth(gp));
        float rad = max(.6, px * .7);
        float lights = 0.; vec3 traffic = vec3(0.);
        for (int k = 0; k < 2; k++) {
          float across = k == 0 ? ds.x : ds.y, along = k == 0 ? gp.y : gp.x;
          float sgn = k == 0 ? side.x : side.y;
          // 路灯：离路中线 .42 街宽，30 m 一盏
          vec2 q = vec2(across - uGrid.w * .42, mod(along, 30.) - 15.);
          lights += smoothstep(rad, rad * .3, length(q)) * min(1., .36 / (rad * rad));
          // 车流：两条车道，各自方向
          for (int l = 0; l < 2; l++) {
            float dir = l == 0 ? 1. : -1.;
            float lane = across - uGrid.w * .17;
            if (l == 1) lane = across - uGrid.w * .06;
            float s2 = along * dir * sgn + uTime * 11.;
            float cell = floor(s2 / 23.), pos = fract(s2 / 23.) * 23. - 11.5;
            float has = step(.55, hash12(vec2(cell, floor(gp.x / uGrid.z) * 7. + floor(gp.y / uGrid.z) * 13. + float(k * 2 + l))));
            float len = max(1.4, px), wid = max(.45, px * .6);
            float dotc = smoothstep(1., .3, length(vec2(lane / wid, pos / len))) * min(1., .63 / (len * wid)) * has;
            vec2 mv = (k == 0 ? vec2(0., 1.) : vec2(1., 0.)) * dir * sgn;
            float toward = step(0., dot(mv, normalize(vec2(V.x * uGrid.x - V.z * uGrid.y, V.x * uGrid.y + V.z * uGrid.x))));
            traffic += mix(uTail, uHead, toward) * dotc;
          }
        }
        float city = 1. - smoothstep(3800., 5200., dist);
        c += uNight * (uWarm * lights * 1.6 + traffic * 1.2) * city;
        // 城外：18 m 一格随机光点（村镇、厂区），远处自然汇成一层暖光
        vec2 g = vW.xz / 18.; vec2 cell = floor(g);
        vec2 f = fract(g) - .5 - (vec2(hash12(cell), hash12(cell + 7.1)) - .5) * .7;
        float pick = hash12(cell + 3.3);
        float px2 = length(fwidth(g));
        float rad2 = max(.07, px2 * .7);
        float dotv = smoothstep(rad2, rad2 * .25, length(f)) * min(1., .0049 / (rad2 * rad2)) * step(.42, pick);
        float town = smoothstep(.25, .6, n2) * (.35 + .65 * (1. - city));
        vec3 lamp = mix(uWarm, uCool, step(.86, pick));
        c += lamp * uNight * (dotv * 2.4 + .03) * town;
        gl_FragColor = vec4(applyAir(c, vW, -V, dist), 1.);
        ${GLSL_OUT}
      }`,
      {
        uMask: {value: maskTex},
        uNoise: {value: noise},
        uRect: {value: new T.Vector4(W.x0, W.z0, 1 / (W.w * W.step), 1 / (W.h * W.step))},
        uAlb: {value: disp(PALETTE.ground, 0.75)},
        uTree: {value: disp(PALETTE.veg, 0.6)},
        uWarm: {value: disp(PALETTE.street, 1.6)},
        uCool: {value: disp(PALETTE.windowCool, 1.2)},
        uHead: {value: disp('#fff1d6', 1.5)},
        uTail: {value: disp('#ff4a2e', 1.2)},
        uGrid: {value: new T.Vector4(Math.cos(SITE.grid), Math.sin(SITE.grid), SITE.block, SITE.street)},
      },
    ),
  )
  ground.position.y = view.ground
  ground.frustumCulled = false
  group.add(ground)
  return {group, landmarks, maskTex}
}

function sculptHill(parts: {pos: Float32Array}[]) {
  const f = hillFrame(parts)
  return elephantHill(f, f.right, 1)
}
