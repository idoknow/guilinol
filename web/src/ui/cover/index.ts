// 主界面封面「天台黄昏」：玩家捏的角色站在桂林楼顶，黄昏转夜——唯一对外入口。
// 看哪儿她看哪儿；点她挥手/回头看城；横拖调时间；点城市亮一片灯、放孔明灯；点天空放烟花；进游戏越过她肩头俯冲。
import * as T from 'three'
import {Rig} from './camera'
import {createBanks} from './banks'
import {createCity, fromGrid, roofRect} from './city'
import {PALETTE, TOD, VIEW, dirAz} from './config'
import {coverDebug} from './debug'
import {Hero} from './hero'
import {bindInput} from './input'
import {noiseTexture, waterNormalTexture} from './noise'
import {Halos, createDust, createFireworks, createLanterns} from './particles'
import {createPost} from './post'
import {GpuTimer, Governor, SPECS, capacity, detectTier, pixelRatio, type CoverTier} from './quality'
import {createRoof} from './roof'
import {applyTime, disp, makeUniforms, type Ctx} from './shared'
import {createSky} from './sky'
import {createTerrain} from './terrain'
import {createTrees, roofBox} from './trees'
import {loadView} from './view'
import {createWater} from './water'

export type {CoverTier}

/** 被菜单挡住的边距（CSS px） */
export type SafeArea = {left: number; right?: number; bottom: number}
const fullSafe = (a: SafeArea) => ({left: a.left, right: a.right ?? 0, bottom: a.bottom})

export interface CoverOptions {
  reduced: boolean
  /** 接收拖拽/点击/悬停的元素（主界面根节点 .home，画布在它下面一层）。默认 = host。 */
  surface?: HTMLElement
  /** 返回 true 表示这个事件目标是 UI（按钮、卡片、链接、弹窗），场景不响应。 */
  ignore?: (target: Element) => boolean
  /**
   * 屏幕上被菜单占掉的边距（CSS px），场景只在剩下那块取景。
   * 桌面：left = 左栏目录宽；竖屏手机：bottom = 底部目录高；横屏手机：right = 右列目录宽。right 缺省 0。
   */
  safe?: SafeArea
  tier?: CoverTier
  onReady?(): void
  onHover?(name: string | null): void
  onLost?(): void
}

export interface Cover {
  readonly tier: CoverTier
  /** 同 CoverOptions.safe，平滑过渡到新画框 */
  setSafeArea(area: SafeArea): void
  /** 进游戏：越过主角肩头俯冲（会恢复渲染；~1.2 s 后由调用方 pause/dispose） */
  dive(): void
  pause(): void
  /** 恢复渲染；若在俯冲中则复位机位，并换上最新捏的角色 */
  resume(): void
  dispose(): void
  stats(): {fps: number; calls: number; triangles: number; dpr: number; tier: CoverTier}
}

const VIEW_URL = import.meta.env.BASE_URL + 'home/cover-view.bin'
const EXPOSURE = 1
const HALO_FIXED = 200
const WIND = new T.Vector3(0.9, 0, -0.35)
/** 光标在镜头前多远处（主角看向它） */
const GAZE_DIST = 3

type Built = Awaited<ReturnType<typeof build>>

/** WebGL 不可用时直接 throw，主会话会退回静态海报图。 */
export function mountCover(host: HTMLElement, options: CoverOptions): Cover {
  const reduced = options.reduced
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
  const start = options.tier ? {tier: options.tier, probe: false} : detectTier()
  const spec = capacity(start.tier, start.probe)
  const renderer = new T.WebGLRenderer({canvas, antialias: start.tier !== 'low', stencil: false, powerPreference: 'high-performance'})
  host.append(canvas)
  renderer.toneMapping = T.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0
  renderer.outputColorSpace = T.SRGBColorSpace
  renderer.info.autoReset = false
  renderer.setClearColor(0x05070c)

  const owned = new Set<{dispose(): void}>()
  const track = <O extends {dispose(): void}>(o: O) => (owned.add(o), o)
  const u = makeUniforms()
  const scene = new T.Scene()
  const rig = new Rig(reduced)
  const camera = rig.camera
  if (options.safe) rig.setSafe(fullSafe(options.safe), true)
  const ac = new AbortController()
  let world: Built | null = null
  let disposed = false

  // ---------- 时间轴：黄昏 → 夜；拖过以后交给用户 ----------
  let tod = reduced ? TOD.reducedStart : TOD.start
  let auto = !reduced
  let autoT = 0
  let time = 0

  // ---------- 档位 ----------
  let tier: CoverTier = start.tier
  let reflEvery = SPECS[tier].reflEvery, reflScale = SPECS[tier].refl
  let W = 1, H = 1
  function resize() {
    W = Math.max(1, host.clientWidth)
    H = Math.max(1, host.clientHeight)
    renderer.setSize(W, H, false)
    rig.setSize(W, H)
    const d = renderer.getPixelRatio()
    u.uDpr.value = d
    if (!world) return
    world.water.setSize(W * d * reflScale, H * d * reflScale)
    world.post.aspect.value = W / H
  }
  const applyTier = (t: CoverTier, scale: number) => {
    tier = t
    const s = SPECS[t]
    u.uRays.value = s.rays ? 1 : 0
    renderer.setPixelRatio(pixelRatio(t, scale))
    reflEvery = s.reflEvery
    reflScale = s.refl
    if (world) {
      world.city.setCount(s.city)
      world.dust.visible = s.dust > 0
    }
    resize()
  }
  const gov = new Governor(start.tier, start.probe, applyTier)
  const timer = new GpuTimer(renderer.getContext() as WebGL2RenderingContext)
  const ro = new ResizeObserver(() => resize())
  ro.observe(host)
  applyTier(start.tier, 1)

  // ---------- 交互 ----------
  const ray = new T.Raycaster()
  const ndc = new T.Vector2()
  const gaze = new T.Vector3()
  const sunNdc = new T.Vector3()
  const hit = new T.Vector3()
  let mouseIn = false, heroHot = false
  let hovered: string | null = null
  const setHover = (n: string | null) => {
    if (n === hovered) return
    hovered = n
    options.onHover?.(n)
  }
  /** 光标下是什么：主角 / 地标 / 地面点 / 天空 */
  const pick = (): {kind: 'hero'} | {kind: 'landmark'; name: string; at: T.Vector3} | {kind: 'ground'; at: T.Vector3; dist: number} | {kind: 'sky'} => {
    ray.setFromCamera(ndc, camera)
    if (!world) return {kind: 'sky'}
    if (world.hero.ready && ray.intersectObject(world.hero.proxy, false).length) return {kind: 'hero'}
    let best: {name: string; d: number} | null = null
    for (const [name, l] of Object.entries(world.terrain.landmarks)) {
      const p = ray.ray.intersectBox(l.box, hit)
      if (p) {
        const d = p.distanceTo(ray.ray.origin)
        if (!best || d < best.d) best = {name, d}
      }
    }
    const o = ray.ray.origin, d = ray.ray.direction
    const tg = d.y < -1e-4 ? (world.view.ground - o.y) / d.y : Infinity
    if (best && best.d < tg * 1.05) return {kind: 'landmark', name: best.name, at: o.clone().addScaledVector(d, best.d)}
    if (tg < 6000) return {kind: 'ground', at: o.clone().addScaledVector(d, tg), dist: tg}
    return {kind: 'sky'}
  }
  const updateGaze = () => {
    ray.setFromCamera(ndc, camera)
    gaze.copy(ray.ray.origin).addScaledVector(ray.ray.direction, GAZE_DIST)
    world?.hero.lookAt(gaze)
  }
  const tap = (x: number, y: number) => {
    if (!world) return
    ndc.set(x, y)
    const p = pick()
    const w = world
    if (p.kind === 'hero') w.hero.poke()
    else if (p.kind === 'ground' || p.kind === 'landmark') {
      const at = p.at
      const dist = Math.hypot(at.x - camera.position.x, at.z - camera.position.z)
      w.city.light(at.x, at.z, time)
      w.lanterns.launch(at.x, w.view.ground + 6 + dist * 0.004, at.z, reduced ? 2 : 6 + Math.floor(Math.random() * 3), dist)
    } else {
      // 天空：在光标方向 1.6 km 处的上空炸开
      ray.setFromCamera(ndc, camera)
      const d = ray.ray.direction, o = ray.ray.origin
      const hd = Math.hypot(d.x, d.z) || 1
      const D = 1600
      const to = new T.Vector3(o.x + (d.x / hd) * D, 0, o.z + (d.z / hd) * D)
      to.y = T.MathUtils.clamp(o.y + (d.y / hd) * D, w.view.ground + 110, w.view.ground + 320)
      const from = to.clone().setY(w.view.ground)
      w.fireworks.launch(from, to, time, D / 1800)
    }
  }
  const surface = options.surface ?? host
  const restoreCursor = bindInput(
    surface,
    canvas,
    options.ignore,
    {
      hover(x, y, mouse) {
        ndc.set(x, y)
        mouseIn = true
        if (mouse) rig.pointer(x, y)
        updateGaze()
      },
      leave() {
        rig.pointerLeave()
        mouseIn = heroHot = false
        world?.hero.lookAt(null)
        setHover(null)
      },
      grab() {},
      drag(dx) {
        // 横拖调时间：往右 = 更晚
        auto = false
        tod = T.MathUtils.clamp(tod + (dx / Math.max(W, 600)) * 0.9, 0, 1)
      },
      release() {},
      zoom(delta) {
        auto = false
        tod = T.MathUtils.clamp(tod - delta * 0.25, 0, 1)
      },
      tap,
      hot: () => heroHot || hovered !== null,
    },
    ac.signal,
  )

  // ---------- 循环 ----------
  let raf = 0, last = 0, frame = 0, userPaused = false, ready = false, compiled = false
  let fps = 60, fpsT = 0, fpsN = 0

  function step(dt: number) {
    const w = world!
    time += dt
    u.uTime.value = time
    if (auto) {
      autoT += dt
      const k = T.MathUtils.smootherstep(autoT / TOD.seconds, 0, 1)
      tod = TOD.start + (TOD.rest - TOD.start) * k
      if (autoT > TOD.seconds) auto = false
    }
    applyTime(u, tod)
    rig.update(dt)
    const intro = reduced ? 1 : T.MathUtils.smoothstep(time, 0, 2.4)
    u.uIntro.value = intro
    renderer.toneMappingExposure = EXPOSURE * (reduced ? Math.min(1, time / 0.4) : 0.1 + 0.9 * intro)
    u.uPx.value = rig.focalPx * renderer.getPixelRatio()

    // 串灯：入夜渐亮（日落后点亮）
    const lamps = T.MathUtils.smoothstep(tod, 0.3, 0.55)
    w.roof.update(time, lamps)
    const flash = w.fireworks.flash
    ;(w.roof.uniforms.uFlash.value as T.Color).copy(w.flashCol).multiplyScalar(flash * 0.35)
    w.hero.update(dt, camera, time)
    w.hero.light(tod, u.uSunDir.value, flash)
    w.lanterns.update(dt, time, WIND)
    w.fireworks.update(time)
    const night = u.uNight.value
    for (const s of w.towerHalos) w.halos.set(s, night * intro)
    w.halos.flush()
    // 镜头眩光：太阳投到屏幕上的位置；入峰后渐隐
    sunNdc.copy(u.uSunDir.value).multiplyScalar(1e4).add(camera.position).project(camera)
    const sunUp = T.MathUtils.smoothstep(u.uSunDir.value.y, -0.03, 0.05) * (sunNdc.z < 1 ? 1 : 0)
    w.post.sun.value.set(sunNdc.x * 0.5 + 0.5, sunNdc.y * 0.5 + 0.5, sunUp * intro)

    // 悬停：相机在动，每帧重拾取
    if (mouseIn) {
      const p = pick()
      heroHot = p.kind === 'hero'
      setHover(p.kind === 'landmark' ? p.name : null)
      updateGaze()
    }
  }

  function loop(now: number) {
    raf = requestAnimationFrame(loop)
    const frameMs = last ? now - last : 16.7
    last = now
    const dt = Math.min(frameMs / 1000, 0.1)
    const t0 = performance.now()
    timer.begin()
    step(dt)
    renderer.info.reset()
    if (frame++ % reflEvery === 0) world!.water.render(renderer, scene, camera)
    renderer.render(scene, camera)
    timer.end()
    const cpu = performance.now() - t0
    gov.sample(frameMs, timer.ok && timer.last >= 0 ? Math.max(cpu, timer.last) : frameMs, dt)
    fpsT += frameMs
    fpsN++
    if (fpsT > 500) {
      fps = (fpsN * 1000) / fpsT
      fpsT = fpsN = 0
    }
    if (!ready) {
      ready = true
      options.onReady?.()
    }
  }
  const run = () => {
    if (disposed || raf || userPaused || document.hidden || !compiled) return
    last = 0
    raf = requestAnimationFrame(loop)
  }
  const stop = () => {
    cancelAnimationFrame(raf)
    raf = 0
  }
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : run()), {signal: ac.signal})
  canvas.addEventListener(
    'webglcontextlost',
    () => {
      stop()
      options.onLost?.()
    },
    {signal: ac.signal},
  )

  // ---------- 异步建场：远景数据 + 角色模型 → 编译 shader → 出第一帧 ----------
  build({u, spec, reduced, track, renderer, rig, signal: ac.signal})
    .then(async (w) => {
      if (disposed) return
      world = w
      scene.add(...w.objects)
      applyTier(tier, 1)
      rig.update(0)
      applyTime(u, tod)
      await w.heroLoad
      if (disposed) return
      renderer.setRenderTarget(w.water.rt)
      const pre = renderer.compileAsync(scene, w.water.vcam)
      renderer.setRenderTarget(null)
      await Promise.all([pre, renderer.compileAsync(scene, camera)]).catch(() => undefined)
      if (disposed) return
      compiled = true
      run()
    })
    .catch((e) => {
      if (disposed || (e as Error).name === 'AbortError') return
      console.warn('[cover]', e)
      options.onLost?.()
    })

  const cover: Cover = {
    get tier() {
      return tier
    },
    setSafeArea(area) {
      rig.setSafe(fullSafe(area))
    },
    dive() {
      if (reduced) return
      rig.dive()
      world?.hero.depart(dirAz(VIEW.az))
      // 俯冲是显式动作：即使调用方已因忙碌暂停，也要渲染完这段
      userPaused = false
      run()
    },
    pause() {
      userPaused = true
      stop()
    },
    resume() {
      userPaused = false
      if (rig.diving) {
        rig.undive()
        world?.hero.arrive()
      }
      void world?.hero.load().catch(() => undefined)
      run()
    },
    stats: () => ({
      fps: Math.round(fps),
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      dpr: +renderer.getPixelRatio().toFixed(2),
      tier,
    }),
    dispose() {
      if (disposed) return
      disposed = true
      stop()
      ro.disconnect()
      ac.abort()
      restoreCursor()
      const before = {...renderer.info.memory}
      world?.hero.dispose()
      for (const o of owned) o.dispose()
      owned.clear()
      timer.dispose()
      const after = {...renderer.info.memory}
      const dbg = coverDebug.get(cover)
      if (dbg) dbg.disposed = {before, after}
      scene.clear()
      world = null
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    },
  }
  coverDebug.set(cover, {
    memory: () => ({...renderer.info.memory, programs: renderer.info.programs?.length ?? 0}),
    tod(t) {
      auto = false
      tod = T.MathUtils.clamp(t, 0, 1)
    },
    hover(x, y) {
      ndc.set(x, y)
      mouseIn = true
      rig.pointer(x, y)
      updateGaze()
    },
    tap,
    peek: () => ({world, renderer, scene, camera, u}),
    info: () => ({time, tod, uTime: u.uTime.value, uPx: u.uPx.value, focal: rig.focalPx, dpr: renderer.getPixelRatio(), tier: tier as unknown as number, W, H}),
    crop(x, y, w, h) {
      rig.crop = w ? [x, y, w, h] : null
    },
  })
  return cover
}

/** 建场（异步：远景烘焙数据）。所有 GPU 资源都走 track，dispose 一次清完。 */
async function build(o: {
  u: Ctx['u']
  spec: Ctx['spec']
  reduced: boolean
  track: Ctx['track']
  renderer: T.WebGLRenderer
  rig: Rig
  signal: AbortSignal
}) {
  const view = await loadView(VIEW_URL, o.signal)
  o.u.uGround.value = view.ground
  o.rig.place(view.roof)
  const noise = o.track(noiseTexture(128))
  o.u.uNoise.value = noise
  const normals = o.track(waterNormalTexture(128))
  const ctx: Ctx = {u: o.u, spec: o.spec, reduced: o.reduced, ground: view.ground, roof: view.roof, noise, track: o.track}

  const sky = createSky(ctx)
  const terrain = createTerrain(ctx, view, noise)
  const lm = terrain.landmarks
  const avoid = Object.values(lm).map((l) => l.box)
  const hills = Object.values(lm).map((l) => {
    const at = l.box.getCenter(new T.Vector3())
    return {at, dist: Math.hypot(at.x, at.z), az: Math.atan2(-at.z, at.x)}
  })
  const city = createCity(ctx, view, avoid, hills)
  const banks = createBanks(ctx, view)
  const trees = createTrees(ctx, view, city.lots, roofBox(roofRect(), fromGrid), o.spec.trees)
  const water = createWater(ctx, view, normals, noise, o.renderer.extensions.has('EXT_color_buffer_float'))
  const halos = new Halos(ctx, HALO_FIXED + o.spec.lanterns)
  const roof = createRoof(ctx, halos)
  roof.uniforms.uHero.value = o.rig.hero
  const lanterns = createLanterns(ctx, halos)
  const fireworks = createFireworks(ctx, halos)
  const dust = createDust(ctx, o.rig.hero)
  const post = createPost(ctx)
  const hero = new Hero(o.rig.hero, o.reduced)
  const heroLoad = hero.load().catch((e) => console.warn('[cover] hero', e))

  // 夜里地标泛光：双塔顶灯 + 塔身大光晕；象鼻山一层暖雾光；水面倒映光柱
  const towerHalos: number[] = []
  const pag = lm['日月双塔']
  if (pag?.tops?.length) {
    const cols = [disp(PALETTE.sunTower, 0.18), disp(PALETTE.moonTower, 0.14)]
    pag.tops.forEach((top, i) => {
      const c = cols[Math.min(i, 1)]
      const h = top.y - view.ground
      towerHalos.push(halos.add(top.clone().setY(view.ground + h * 0.55), c, h * 0.9))
      towerHalos.push(halos.add(top.clone(), c.clone().multiplyScalar(2.5), h * 0.18))
      water.setLight(i, top.clone().setY(view.ground + h * 0.5), c.clone().multiplyScalar(0.6), 0.0006)
    })
  }
  const hill = lm['象鼻山']
  if (hill) {
    const c = hill.box.getCenter(new T.Vector3())
    water.setLight(2, c.setY(hill.box.max.y * 0.6), disp(PALETTE.flood, 0.05), 0.0012)
  }

  return {
    view,
    terrain,
    city,
    water,
    halos,
    roof,
    lanterns,
    fireworks,
    dust,
    post,
    hero,
    heroLoad,
    towerHalos,
    flashCol: disp('#fff1d0', 1),
    objects: [sky, terrain.group, city.mesh, trees.group, banks.mesh, water.mesh, roof.group, hero.root, halos.mesh, fireworks.points, dust, post.mesh] as T.Object3D[],
  }
}
