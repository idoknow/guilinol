// 主角脚下的天台：方砖屋面、矮女儿墙 + 玻璃栏板（两道斜线汇聚到主角身后）、串灯悬链。
// 全部合成一个网格（顶点色）+ 一个 shader：天光/落日 + 入夜串灯照明 + 主角脚下接触阴影。
import * as T from 'three'
import {PALETTE, SITE} from './config'
import {rng} from './noise'
import {GLSL_OUT, HEAD, disp, shader, type Ctx} from './shared'
import {roofRect} from './city'
import type {Halos} from './particles'

/** 串灯：两根灯杆之间的悬链（街网局部坐标 u, y, v）。 */
export interface Strand {
  a: T.Vector3
  b: T.Vector3
  sag: number
}

const BULB_GAP = 0.42

function tint(geo: T.BufferGeometry, hex: string, emit = 0, jitter = 0, r = Math.random) {
  const g = geo.index ? geo.toNonIndexed() : geo
  if (g !== geo) geo.dispose()
  const n = g.getAttribute('position').count
  const base = disp(hex, 1)
  const col = new Float32Array(n * 3), em = new Float32Array(n).fill(emit)
  const k = 1 + (r() - 0.5) * jitter
  for (let i = 0; i < n; i++) col.set([base.r * k, base.g * k, base.b * k], i * 3)
  g.setAttribute('color', new T.BufferAttribute(col, 3))
  g.setAttribute('aEmit', new T.BufferAttribute(em, 1))
  g.deleteAttribute('uv')
  return g
}

function mergeAll(parts: T.BufferGeometry[], names = ['position', 'normal', 'color', 'aEmit']) {
  const total = parts.reduce((s, p) => s + p.getAttribute('position').count, 0)
  const out = new T.BufferGeometry()
  for (const name of names) {
    const size = parts[0].getAttribute(name).itemSize
    const arr = new Float32Array(total * size)
    let o = 0
    for (const p of parts) {
      const a = p.getAttribute(name) as T.BufferAttribute
      arr.set(a.array as Float32Array, o)
      o += a.array.length
    }
    out.setAttribute(name, new T.BufferAttribute(arr, size))
  }
  for (const p of parts) p.dispose()
  return out
}

export function catenary(s: Strand, t: number, out = new T.Vector3()) {
  return out.lerpVectors(s.a, s.b, t).setY(T.MathUtils.lerp(s.a.y, s.b.y, t) - s.sag * 4 * t * (1 - t))
}

export function createRoof(ctx: Ctx, halos: Halos) {
  const R = roofRect()
  const roofY = ctx.roof
  const group = new T.Group()
  group.rotation.y = SITE.grid
  const r = rng(31)
  const parts: T.BufferGeometry[] = []
  const add = (g: T.BufferGeometry, hex: string, x: number, y: number, z: number, emit = 0, jitter = 0.08) => {
    g.translate(x, y, z)
    parts.push(tint(g, hex, emit, jitter, r))
  }
  const W = R.u1 - R.u0, D = R.v1 - R.v0

  // 屋面（局部坐标 = 街网 u, v；y 相对楼顶）
  add(new T.PlaneGeometry(W, D, 1, 1).rotateX(-Math.PI / 2), PALETTE.roof, (R.u0 + R.u1) / 2, 0, (R.v0 + R.v1) / 2, 0, 0)
  // 矮女儿墙：四边，0.3 m 高 0.26 m 厚，顶上压一道浅色压顶；北、西两边再立玻璃栏板（城市透过来）
  const wallH = 0.3, wallT = 0.26
  const walls: [number, number, number, number][] = [
    [R.u0 + W / 2, R.v0 + wallT / 2, W, wallT],
    [R.u0 + W / 2, R.v1 - wallT / 2, W, wallT],
    [R.u0 + wallT / 2, R.v0 + D / 2, wallT, D],
    [R.u1 - wallT / 2, R.v0 + D / 2, wallT, D],
  ]
  for (const [x, z, w, d] of walls) {
    add(new T.BoxGeometry(w, wallH, d), '#77726a', x, wallH / 2, z, 0, 0.04)
    add(new T.BoxGeometry(w + 0.05, 0.05, d + 0.05), '#a39c90', x, wallH + 0.025, z, 0, 0.03)
  }
  // 玻璃栏板：1.5 m 一块，顶上一道细不锈钢扶手，板缝处细立柱
  const railTop = 1.1, metal = PALETTE.rail
  const rails: [T.Vector2, T.Vector2][] = [
    [new T.Vector2(R.u0 + 0.13, R.v0 + 0.13), new T.Vector2(R.u1 - 0.13, R.v0 + 0.13)],
    [new T.Vector2(R.u0 + 0.13, R.v0 + 0.13), new T.Vector2(R.u0 + 0.13, R.v1 - 0.13)],
  ]
  const panes: T.BufferGeometry[] = []
  const PANE = 1.5, g0 = wallH + 0.05, gh = railTop - 0.03 - g0
  for (const [a, b] of rails) {
    const len = a.distanceTo(b), dir = b.clone().sub(a).normalize()
    const ang = Math.atan2(-dir.y, dir.x)
    add(new T.CylinderGeometry(0.022, 0.022, len, 8).rotateZ(Math.PI / 2).rotateY(ang), '#9a9ea3', (a.x + b.x) / 2, railTop, (a.y + b.y) / 2, 0, 0)
    for (let s = 0; s < len - 0.01; s += PANE) {
      const w = Math.min(PANE, len - s)
      const p = a.clone().addScaledVector(dir, s)
      add(new T.BoxGeometry(0.03, railTop - g0, 0.03), metal, p.x, g0 + (railTop - g0) / 2, p.y, 0, 0)
      const c = a.clone().addScaledVector(dir, s + w / 2)
      panes.push(new T.PlaneGeometry(w - 0.03, gh).rotateY(ang).translate(c.x, g0 + gh / 2, c.y).toNonIndexed())
    }
  }
  // 灯杆 + 串灯：北沿靠西一根杆，一串沿北沿拉到主角身后右侧，一串斜拉回身后（不从镜头头顶过，近处灯泡不糊脸）
  const poleH = 2.45
  const poles = [
    // 角杆放主角右后方：正后方会和人物轮廓贴在一起
    new T.Vector3(R.u0 + 2.6, poleH, R.v0 + 0.45),
    new T.Vector3(R.u0 + 9.5, poleH - 0.1, R.v0 + 9.5),
    new T.Vector3(R.u0 + 13.5, poleH - 0.1, R.v0 + 0.45),
  ]
  for (const p of poles) {
    add(new T.CylinderGeometry(0.035, 0.045, p.y, 8), metal, p.x, p.y / 2, p.z, 0, 0)
    add(new T.SphereGeometry(0.06, 8, 6), metal, p.x, p.y, p.z, 0, 0)
  }
  const strands: Strand[] = [
    {a: poles[0], b: poles[1], sag: 0.42},
    {a: poles[0], b: poles[2], sag: 0.48},
  ]
  const bulbs: T.Vector3[] = []
  const wireCol = '#1d1d1f'
  for (const s of strands) {
    const len = s.a.distanceTo(s.b)
    const n = Math.floor(len / BULB_GAP)
    const pts = Array.from({length: 24}, (_, i) => catenary(s, i / 23))
    const curve = new T.CatmullRomCurve3(pts)
    const wire = new T.TubeGeometry(curve, 48, 0.008, 4, false)
    parts.push(tint(wire, wireCol, 0, 0, r))
    for (let i = 1; i < n; i++) {
      const p = catenary(s, i / n)
      p.y -= 0.07
      bulbs.push(p)
      add(new T.SphereGeometry(0.024, 8, 6), PALETTE.bulb, p.x, p.y, p.z, 1, 0)
    }
  }
  const geo = ctx.track(mergeAll(parts))
  geo.computeBoundingSphere()
  // 串灯照明：两条悬链近似成线光源
  const lineA = strands.map((s) => s.a.clone().applyEuler(group.rotation).add(new T.Vector3(0, roofY - 0.2, 0)))
  const lineB = strands.map((s) => s.b.clone().applyEuler(group.rotation).add(new T.Vector3(0, roofY - 0.2, 0)))
  const mat = shader(
    ctx,
    /* glsl */ `attribute vec3 color; attribute float aEmit; varying vec3 vW, vN, vC; varying float vE;
    void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vC = color; vE = aEmit;
      gl_Position = projectionMatrix * viewMatrix * w; }`,
    HEAD +
      /* glsl */ `uniform sampler2D uNoise; uniform vec3 uLA[2], uLB[2], uBulb, uHero, uFlash; uniform float uNight, uRoofY, uLamps;
    varying vec3 vW, vN, vC; varying float vE;
    vec3 lineLight(vec3 a, vec3 b, vec3 p, vec3 N){
      vec3 ab = b - a; float t = clamp(dot(p - a, ab) / dot(ab, ab), 0., 1.);
      vec3 l = a + ab * t - p; float d2 = dot(l, l);
      return uBulb * max(dot(N, l * inversesqrt(d2)) * .8 + .2, 0.) / (1. + d2 * 1.2);
    }
    void main(){
      vec3 N = normalize(vN), toC = cameraPosition - vW; float dist = length(toC); vec3 V = toC / dist;
      if (!gl_FrontFacing) N = -N;
      vec3 alb = vC;
      float onTop = step(.9, N.y) * step(vW.y, uRoofY + .01);
      if (onTop > .5) {
        // 屋面：60 cm 方砖缝 + 水渍斑驳
        vec2 q = vW.xz / .6; vec2 f = abs(fract(q) - .5);
        float seam = smoothstep(.47, .5, max(f.x, f.y));
        float n = texture2D(uNoise, vW.xz * .05).r, n2 = texture2D(uNoise, vW.xz * .31).g;
        alb *= (.82 + .3 * n) * (.92 + .16 * n2) * (1. - seam * .25);
      }
      vec3 c = shade(alb, N, V);
      // 主角的长影：屋面点逆着太阳看，光线擦过人体（竖直胶囊近似）就在影里；越远半影越宽
      if (onTop > .5 && uSunDir.y > -.03) {
        vec2 Lh = uSunDir.xz; float l2 = dot(Lh, Lh);
        float t = dot(uHero.xz - vW.xz, Lh) / l2;
        float y = t * max(uSunDir.y, .004);
        if (t > 0. && y < 1.8) {
          float d = length(vW.xz + Lh * t - uHero.xz);
          float r = mix(.15, .23, smoothstep(.85, 1.25, y)) * (1. - smoothstep(1.4, 1.6, y) * .45);
          float pen = .03 + t * .012;
          float sh = (1. - smoothstep(r - pen, r + pen, d)) * smoothstep(1.78, 1.62, y) * smoothstep(-.03, .02, uSunDir.y);
          vec3 amb = mix(uAmbDn, uAmbUp, N.y * .5 + .5);
          c = mix(c, alb * amb, sh * .9);
        }
      }
      // 接触阴影：主角脚下
      vec2 dh = vW.xz - uHero.xz;
      c *= 1. - .55 * exp(-dot(dh, dh) * 5.) * onTop;
      vec3 lamp = (lineLight(uLA[0], uLB[0], vW, N) + lineLight(uLA[1], uLB[1], vW, N)) * uLamps;
      c += alb * lamp * .3 + alb * uFlash;
      c = mix(c, uBulb * (2.2 + 6. * uLamps), vE * (.25 + .75 * uLamps));
      gl_FragColor = vec4(applyAir(c, vW, -V, dist), 1.);
      ${GLSL_OUT}
    }`,
    {
      uNoise: {value: ctx.noise},
      uLA: {value: lineA},
      uLB: {value: lineB},
      uBulb: {value: disp(PALETTE.bulb, 1)},
      uHero: {value: new T.Vector3()},
      uFlash: {value: new T.Color(0, 0, 0)},
      uRoofY: {value: roofY},
      uLamps: {value: 0},
    },
    {side: T.DoubleSide},
  )
  const mesh = new T.Mesh(geo, mat)
  group.add(mesh)

  // 玻璃：菲涅尔反天 + 入夜映串灯；板边一圈稍亮（玻璃厚度）
  const glassGeo = ctx.track(mergeAll(panes, ['position', 'normal', 'uv']))
  const glassMat = shader(
    ctx,
    /* glsl */ `varying vec3 vW, vN; varying vec2 vUv;
    void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv;
      gl_Position = projectionMatrix * viewMatrix * w; }`,
    HEAD +
      /* glsl */ `uniform vec3 uBulb; uniform float uLamps; varying vec3 vW, vN; varying vec2 vUv;
    void main(){
      vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
      if (dot(N, V) < 0.) N = -N;
      float f = pow(1. - max(dot(N, V), 0.), 4.);
      vec3 R = reflect(-V, N);
      vec3 refl = skyColor(normalize(vec3(R.x, max(R.y, .015), R.z)));
      vec2 e = min(vUv, 1. - vUv) / fwidth(vUv);
      float edge = 1. - smoothstep(0., 1.6, min(e.x, e.y));
      // 反射只在很斜的角度才起来（否则整片城市蒙一层天色）；板边一道青绿玻璃截面
      float a = .02 + .22 * f * f + edge * .4;
      vec3 c = mix(refl, vec3(.5, .75, .7) * (refl + .05), edge * .6) + uBulb * uLamps * (.04 + edge * .3);
      gl_FragColor = vec4(c, a);
      ${GLSL_OUT}
    }`,
    {uBulb: mat.uniforms.uBulb, uLamps: mat.uniforms.uLamps},
    {transparent: true, depthWrite: false, side: T.DoubleSide},
  )
  const glass = new T.Mesh(glassGeo, glassMat)
  glass.renderOrder = 5
  group.add(glass)
  group.position.y = roofY
  group.updateMatrixWorld(true)

  // 灯泡光晕（世界坐标）
  const glow = disp(PALETTE.bulb, 0.45)
  const slots = bulbs.map((p) => halos.add(p.clone().applyMatrix4(group.matrixWorld), glow, 0.16))
  const phase = bulbs.map(() => r() * 6.28)
  return {
    group,
    rect: R,
    uniforms: mat.uniforms,
    /** 串灯亮度 0..1（入夜渐亮，带一点不齐的呼吸） */
    update(time: number, on: number) {
      mat.uniforms.uLamps.value = on
      for (let i = 0; i < slots.length; i++) halos.set(slots[i], on * (0.85 + 0.15 * Math.sin(time * 1.3 + phase[i])))
    },
  }
}
