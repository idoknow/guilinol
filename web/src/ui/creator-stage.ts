import * as T from 'three'
import {disposeCharacterParts, previewCharacter} from '../walk/character'
import {resetCharacterLight, setCharacterLight, type CharacterLightSettings} from '../walk/character-light'
import type {Avatar} from '../../../lib/avatar'
import {creatorEnv} from './creator-env'

export type CreatorShot = 'body' | 'face' | 'hair' | 'outfit' | 'confirm'
type Model = Awaited<ReturnType<typeof previewCharacter>>
interface Rig {
  y: number
  dist: number
  az: number
  pitch: number
  fov: number
}

/** 夜渡口：冷月轮廓 + 暖灯主光。 */
const STUDIO_LIGHT: CharacterLightSettings = {
  keyFrom: [-0.45, 0.86, -0.36],
  rim: 0.62,
  rimColor: '#a8d8ff',
  rimFrom: [0.3, 0.45, 0.85], // the moon side (creator-env MOON_DIR)
  // Facets read as a patchwork when the two sides differ in hue, so the night look comes from level + rim.
  shade: '#bcc4d8',
  lit: '#fff4e4',
  contrast: 0.3,
  sheen: 0.3,
  level: 0.8,
}

const lerp = T.MathUtils.lerp,
  clamp = T.MathUtils.clamp
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const easeOut = (t: number) => 1 - (1 - t) ** 3
const mixRig = (a: Rig, b: Rig, k: number): Rig => ({
  y: lerp(a.y, b.y, k),
  dist: lerp(a.dist, b.dist, k),
  az: lerp(a.az, b.az, k),
  pitch: lerp(a.pitch, b.pitch, k),
  fov: lerp(a.fov, b.fov, k),
})

/**
 * 捏人舞台。capture=true 是贡献者头像/市民卡截图用的极简模式：透明背景、无环境、构图与旧版一致。
 * 非 capture：全屏「夜渡口 · 青石台」舞台，按步骤切机位，可拖拽/推拉，并能用同一个 renderer 拍预设缩略图。
 */
export function creatorStage(host: HTMLElement, reduced: boolean, capture = false) {
  const coarse = !capture && matchMedia('(pointer:coarse)').matches
  const renderer = new T.WebGLRenderer({
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: capture,
    powerPreference: capture ? 'default' : 'high-performance',
  })
  const ratio = () => Math.min(devicePixelRatio, coarse ? 1.5 : 2)
  renderer.setPixelRatio(ratio())
  renderer.setClearColor(0x000000, 0)
  const canvas = renderer.domElement
  host.append(canvas)
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(30, 1, capture ? 0.01 : 0.04, capture ? 20 : 700)
  scene.add(new T.HemisphereLight(0xfffaf2, 0xc3c9c2, 2))
  const key = new T.DirectionalLight(0xfff4e6, 2.35)
  key.position.set(-3, 5, -4)
  scene.add(key)
  let disc: T.Mesh<T.CylinderGeometry, T.MeshStandardMaterial> | undefined
  const env = capture ? undefined : creatorEnv(reduced, coarse)
  if (env) {
    scene.add(env.group)
    setCharacterLight(STUDIO_LIGHT)
  } else {
    disc = new T.Mesh(
      new T.CylinderGeometry(0.62, 0.65, 0.065, 64),
      new T.MeshStandardMaterial({color: '#c4c9c6', roughness: 1}),
    )
    disc.position.y = -0.037
    scene.add(disc)
  }

  let model: Model | undefined, mixer: T.AnimationMixer | undefined
  let rotation = 0,
    velocity = 0,
    entrance = reduced ? 1 : 0,
    finishing = false,
    pop = 1,
    glance = 1,
    spin = 1,
    pullback = 0
  let crownHeight = 1.72,
    portraitScale = 1,
    popTarget: T.Object3D | undefined
  // capture framing (unchanged from the original studio so portraits stay identical)
  let close = false,
    closeAmount = 1,
    zoom = 0,
    zoomStart = 0,
    zoomTime = 1
  // shot camera
  let shotName: CreatorShot = 'body',
    shotFrom: Rig | undefined,
    shotT = 1,
    current: Rig | undefined,
    sway = 0,
    dolly = 0,
    dollyTarget = 0
  let idle = 0,
    idleW = 0,
    idleClock = 0,
    clock = 0
  let latest = 0,
    frame = 0,
    last = performance.now(),
    drag = false,
    x = 0,
    disposed = false,
    drawn = false,
    width = 1,
    height = 1
  const insets = {top: 0, right: 0, bottom: 0, left: 0}

  function rigFor(name: CreatorShot): Rig {
    const ps = portraitScale,
      head = crownHeight - 0.244 * ps
    switch (name) {
      case 'face':
        return {y: head - 0.03 * ps, dist: lerp(4.25, 1.55 * ps, closeAmount), az: -0.22, pitch: 0.04, fov: 28}
      case 'hair':
        return {y: crownHeight - 0.17 * ps, dist: 1.85 * ps, az: -0.78, pitch: 0.13, fov: 28}
      case 'outfit':
        return {y: 0.86, dist: 4.15, az: 0.32, pitch: 0.05, fov: 30}
      case 'confirm':
        return {y: 0.98, dist: 4.55, az: -0.2, pitch: -0.08, fov: 28}
      default:
        return {y: 0.9, dist: 4.35, az: -0.4, pitch: 0.06, fov: 30}
    }
  }

  function release() {
    if (!model) return
    mixer?.stopAllAction()
    mixer?.uncacheRoot(model.scene)
    scene.remove(model.scene)
    disposeCharacterParts(model.scene)
  }
  const measure = (m: Model) => ({
    ps: m.scene.getObjectByName('CreatorProportions')!.scale.y,
    crown: new T.Box3().setFromObject(m.scene.getObjectByName('creator-hair')!, true).max.y,
  })

  async function apply(a: Avatar, change = '') {
    const id = ++latest,
      next = await previewCharacter(a)
    if (id !== latest || disposed) {
      disposeCharacterParts(next.scene)
      return
    }
    const previous = model?.scene
    const oldColors = previous?.getObjectByProperty('isSkinnedMesh', true) as T.SkinnedMesh | undefined
    const newMesh = next.scene.getObjectByProperty('isSkinnedMesh', true) as T.SkinnedMesh
    const colors = newMesh.geometry.getAttribute('color')
    const from = oldColors?.geometry.getAttribute('color')
    if (!reduced && from && colors.count === from.count && ['skin', 'look', 'preset'].includes(change)) {
      const end = colors.clone(),
        start = from.clone(),
        begin = performance.now()
      const blend = (now: number) => {
        if (disposed || id !== latest) return
        const t = Math.min(1, (now - begin) / 220)
        for (let i = 0; i < colors.count; i++)
          colors.setXYZ(
            i,
            lerp(start.getX(i), end.getX(i), t),
            lerp(start.getY(i), end.getY(i), t),
            lerp(start.getZ(i), end.getZ(i), t),
          )
        colors.needsUpdate = true
        if (t < 1) requestAnimationFrame(blend)
      }
      requestAnimationFrame(blend)
    }
    if (change === 'hairColor' && previous && !reduced) {
      const oldHair = previous.getObjectByName('creator-hair') as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>
      const newHair = next.scene.getObjectByName('creator-hair') as typeof oldHair
      const start = oldHair.material.color.clone(),
        end = newHair.material.color.clone(),
        begin = performance.now()
      const blend = (now: number) => {
        if (disposed || id !== latest) return
        const t = Math.min(1, (now - begin) / 220)
        newHair.material.color.lerpColors(start, end, t)
        if (t < 1) requestAnimationFrame(blend)
      }
      requestAnimationFrame(blend)
    }
    if (!model && !reduced) entrance = 0
    release()
    model = next
    scene.add(next.scene)
    mixer = new T.AnimationMixer(next.scene)
    mixer.clipAction(next.animations.find((c) => c.name === 'idle')!).play()
    mixer.update(0)
    next.scene.updateMatrixWorld(true)
    const size = measure(next)
    portraitScale = size.ps
    crownHeight = size.crown
    if (!reduced && ['hair', 'look', 'preset', 'body'].includes(change)) {
      popTarget = change === 'hair' ? next.scene.getObjectByName('creator-hair') : next.scene
      pop = 0
    }
    if (!reduced && (change === 'look' || change === 'preset')) glance = 0
    if (!reduced && change === 'preset') spin = 0
    if (change) env?.pulse()
  }

  // --- 预设缩略图：同一个 renderer，在主画面之前把半身像画进左下角再立刻拷走（同一任务内，用户看不到） ----
  type Job = {a: Avatar; resolve: (url: string) => void; reject: (e: unknown) => void}
  const jobs: Job[] = [],
    thumbCam = new T.PerspectiveCamera(24, 1, 0.05, 50)
  let jobRunning = false,
    staged: {m: Model; mixer: T.AnimationMixer; job: Job; ps: number; crown: number} | undefined
  async function pump() {
    if (jobRunning || !drawn || disposed || !jobs.length) return
    jobRunning = true
    const job = jobs.shift()!
    try {
      const m = await previewCharacter(job.a)
      if (disposed) {
        disposeCharacterParts(m.scene)
        throw Error('舞台已关闭')
      }
      const mx = new T.AnimationMixer(m.scene)
      mx.clipAction(m.animations.find((c) => c.name === 'idle')!).play()
      mx.update(0.6)
      m.scene.rotation.y = 0.4
      m.scene.updateMatrixWorld(true)
      staged = {m, mixer: mx, job, ...measure(m)}
    } catch (e) {
      job.reject(e)
      jobRunning = false
      void pump()
    }
  }
  function shootStaged() {
    const s = staged!
    staged = undefined
    const pr = renderer.getPixelRatio(),
      full = renderer.getSize(new T.Vector2())
    const tw = Math.min(168, full.x),
      th = Math.min(200, full.y),
      y = s.crown - 0.4 * s.ps
    thumbCam.aspect = tw / th
    thumbCam.updateProjectionMatrix()
    thumbCam.position.set(0, y + 0.05, -2.05 * s.ps)
    thumbCam.lookAt(0, y, 0)
    if (env) env.group.visible = false
    if (model) model.scene.visible = false
    scene.add(s.m.scene)
    renderer.setScissorTest(true)
    renderer.setScissor(0, 0, tw, th)
    renderer.setViewport(0, 0, tw, th)
    renderer.render(scene, thumbCam)
    const out = document.createElement('canvas')
    out.width = Math.round(tw * pr)
    out.height = Math.round(th * pr)
    out.getContext('2d')!.drawImage(canvas, 0, canvas.height - out.height, out.width, out.height, 0, 0, out.width, out.height)
    renderer.setScissorTest(false)
    renderer.setViewport(0, 0, full.x, full.y)
    scene.remove(s.m.scene)
    if (env) env.group.visible = true
    if (model) model.scene.visible = true
    s.mixer.stopAllAction()
    s.mixer.uncacheRoot(s.m.scene)
    disposeCharacterParts(s.m.scene)
    s.job.resolve(out.toDataURL('image/webp', 0.9))
    jobRunning = false
    setTimeout(() => void pump(), 60)
  }

  function resize() {
    const w = host.clientWidth,
      h = host.clientHeight
    if (!w || !h) return
    width = w
    height = h
    renderer.setPixelRatio(ratio())
    renderer.setSize(w, h, false)
    env?.pixelRatio(renderer.getPixelRatio())
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()

  function captureCamera(dt: number) {
    zoomTime = Math.min(1, zoomTime + dt / 0.45)
    zoom = lerp(zoomStart, close ? closeAmount : 0, reduced ? 1 : 1 - (1 - zoomTime) ** 3)
    const target = lerp(0.87, crownHeight - 0.244 * portraitScale, zoom),
      dist = lerp(4.25, 1.1 * portraitScale, zoom) * Math.max(1, 0.79 / camera.aspect)
    camera.position.set(0, target + 0.075, -dist - (1 - entrance) * 0.52 - pullback * 0.38)
    camera.lookAt(0, target, 0)
  }
  function shotCamera(dt: number) {
    shotT = Math.min(1, shotT + dt / 0.6)
    const goal = rigFor(shotName),
      r = shotFrom && !reduced ? mixRig(shotFrom, goal, easeInOut(shotT)) : goal
    current = r
    sway += ((shotName === 'hair' && !reduced ? 1 : 0) - sway) * Math.min(1, dt * 1.2)
    dolly = reduced ? dollyTarget : dolly + (dollyTarget - dolly) * Math.min(1, dt * 8)
    const rw = Math.max(1, width - insets.left - insets.right),
      rh = Math.max(1, height - insets.top - insets.bottom)
    const fit = (height / rh) * Math.max(1, 0.8 / (rw / rh))
    const ent = easeOut(entrance),
      back = easeInOut(pullback)
    const az = r.az + sway * 0.35 * Math.sin(clock * 0.5) + (1 - ent) * 0.25,
      pitch = r.pitch + back * 0.12,
      dist = r.dist * fit * (1 + dolly) + (1 - ent) * 1.2 + back * 2.4
    camera.fov = r.fov
    camera.position.set(
      Math.sin(az) * Math.cos(pitch) * dist,
      r.y + Math.sin(pitch) * dist,
      -Math.cos(az) * Math.cos(pitch) * dist,
    )
    camera.lookAt(0, r.y, 0)
    // put the subject at the centre of the area the panel leaves free
    camera.setViewOffset(
      width,
      height,
      width / 2 - (insets.left + rw / 2),
      height / 2 - (insets.top + rh / 2),
      width,
      height,
    )
  }

  function draw(now: number) {
    frame = requestAnimationFrame(draw)
    const dt = Math.min(0.08, (now - last) / 1000)
    last = now
    clock += dt
    entrance = Math.min(1, entrance + dt / (capture ? 0.6 : 1.3))
    pop = Math.min(1, pop + dt / 0.18)
    glance = Math.min(1, glance + dt / 0.8)
    spin = Math.min(1, spin + dt / 0.9)
    if (finishing && !reduced) pullback = Math.min(1, pullback + dt / (capture ? 0.6 : 1))
    if (capture) captureCamera(dt)
    else shotCamera(dt)
    if (model) {
      rotation += velocity * dt
      velocity *= Math.exp(-dt * 5)
      idle += dt
      idleW += ((!capture && !reduced && !drag && idle > 5 ? 1 : 0) - idleW) * Math.min(1, dt * 0.7)
      idleClock += dt * idleW
      const idleTurn = idleW * 0.28 * Math.sin(idleClock * 0.45),
        spinTurn = -(1 - easeOut(spin)) * Math.PI * 2
      model.scene.rotation.y = rotation + idleTurn + spinTurn + (reduced ? 0 : 0.44 * (1 - easeOut(entrance)))
      popTarget?.scale.setScalar(pop < 0.6 ? 0.9 + (0.14 * pop) / 0.6 : 1.04 - (0.04 * (pop - 0.6)) / 0.4)
      mixer?.update(reduced ? 0 : dt)
      if (glance < 1) model.scene.getObjectByName('head')!.rotateX(0.16 * Math.sin(glance * Math.PI))
    }
    if (staged) shootStaged()
    camera.updateProjectionMatrix()
    env?.update(dt, camera)
    renderer.render(scene, camera)
    if (model && !drawn) {
      drawn = true
      void pump()
    }
  }
  frame = requestAnimationFrame(draw)
  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(frame)
      frame = 0
    } else if (!frame && !disposed) {
      last = performance.now()
      frame = requestAnimationFrame(draw)
    }
  }
  document.addEventListener('visibilitychange', onVisibility)

  // --- 交互：拖拽转身（惯性）、双击复位、滚轮/双指推拉、悬停提亮光环 ---------------------------------------------
  const pointers = new Map<number, {x: number; y: number}>()
  let pinchFrom = 0,
    pinchDolly = 0
  const spread = () => {
    const [a, b] = [...pointers.values()]
    return Math.hypot(a.x - b.x, a.y - b.y) || 1
  }
  /** Fold the idle sway into the user's rotation so grabbing the character never snaps it. */
  const wake = () => {
    rotation += idleW * 0.28 * Math.sin(idleClock * 0.45)
    idleW = idleClock = idle = 0
  }
  const cursor = () => (canvas.style.cursor = capture ? '' : drag ? 'grabbing' : 'grab')
  const probe = new T.Vector3()
  function overCharacter(cx: number, cy: number) {
    const rect = canvas.getBoundingClientRect()
    const feet = probe.set(0, 0, 0).project(camera),
      fx = rect.left + ((feet.x + 1) / 2) * rect.width,
      fy = rect.top + ((1 - feet.y) / 2) * rect.height
    const crown = probe.set(0, crownHeight, 0).project(camera),
      ty = rect.top + ((1 - crown.y) / 2) * rect.height
    return cy > ty && cy < fy && Math.abs(cx - fx) < (fy - ty) * 0.18
  }
  if (!capture) {
    cursor()
    canvas.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, {x: e.clientX, y: e.clientY})
      canvas.setPointerCapture(e.pointerId)
      wake()
      velocity = 0
      if (pointers.size >= 2) {
        drag = false
        pinchFrom = spread()
        pinchDolly = dollyTarget
      } else {
        drag = true
        x = e.clientX
      }
      cursor()
    })
    canvas.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId)
      if (!p) {
        if (e.pointerType === 'mouse') env?.hover(overCharacter(e.clientX, e.clientY))
        return
      }
      p.x = e.clientX
      p.y = e.clientY
      if (pointers.size >= 2) {
        dollyTarget = clamp(pinchDolly + (pinchFrom / spread() - 1) * 0.7, -0.3, 0.35)
        return
      }
      if (drag) {
        const delta = (e.clientX - x) * 0.013
        rotation -= delta
        velocity = reduced ? 0 : -delta * 14
        x = e.clientX
        idle = 0
      }
    })
    const lift = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      const rest = [...pointers.values()][0]
      drag = !!rest
      if (rest) x = rest.x
      idle = 0
      cursor()
    }
    canvas.addEventListener('pointerup', lift)
    canvas.addEventListener('pointercancel', lift)
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !pointers.size) env?.hover(false)
    })
    canvas.addEventListener('dblclick', () => {
      wake()
      rotation = velocity = 0
      dollyTarget = 0
    })
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        wake()
        dollyTarget = clamp(dollyTarget + e.deltaY * 0.0009, -0.3, 0.35)
      },
      {passive: false},
    )
  } else {
    canvas.ondblclick = () => {
      rotation = velocity = 0
    }
  }

  /** 步骤机位：0.6 s easeInOutCubic 过渡。 */
  function shot(name: CreatorShot) {
    if (name === shotName) return
    shotFrom = current ?? rigFor(shotName)
    shotT = 0
    shotName = name
    dollyTarget = 0
  }
  return {
    apply,
    shot,
    /** amount < 1 frames a little looser than the creator's face close-up (about-page portraits use it).
     * Outside capture mode this maps onto the shot system (face / body). */
    frameHead(value: boolean, amount = 1) {
      closeAmount = amount
      if (!capture) return shot(value ? 'face' : 'body')
      if (close !== value) {
        zoomStart = zoom
        zoomTime = 0
        close = value
      }
    },
    /** Pixels of the stage covered by the panel; the subject is centred in what is left. */
    inset(next: Partial<typeof insets>) {
      Object.assign(insets, {top: 0, right: 0, bottom: 0, left: 0}, next)
    },
    angle(y: number) {
      rotation = y
      velocity = 0
    },
    /** 半身像缩略图（dataURL）。舞台首帧画完后逐个生成。 */
    portrait(a: Avatar) {
      return new Promise<string>((resolve, reject) => {
        if (disposed) return reject(Error('舞台已关闭'))
        jobs.push({a, resolve, reject})
        void pump()
      })
    },
    async finish() {
      if (!reduced && model && mixer) {
        const wave = model.animations.find((c) => c.name === 'wave')!,
          idleClip = model.animations.find((c) => c.name === 'idle')!
        const tracked = new Set(wave.tracks.map((t) => t.name))
        mixer.stopAllAction()
        mixer
          .clipAction(
            new T.AnimationClip(
              'wave-stance',
              idleClip.duration,
              idleClip.tracks.filter((t) => !tracked.has(t.name)),
            ),
          )
          .play()
        const waveAction = mixer.clipAction(wave).reset().setLoop(T.LoopOnce, 1)
        waveAction.clampWhenFinished = true
        waveAction.play()
        mixer.update(0)
        env?.pulse()
        await new Promise((r) => setTimeout(r, 1200))
      }
      finishing = true
    },
    dispose() {
      disposed = true
      latest++
      cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      release()
      model = undefined
      if (staged) {
        staged.mixer.uncacheRoot(staged.m.scene)
        disposeCharacterParts(staged.m.scene)
        staged.job.reject(Error('舞台已关闭'))
        staged = undefined
      }
      for (const job of jobs.splice(0)) job.reject(Error('舞台已关闭'))
      disc?.geometry.dispose()
      disc?.material.dispose()
      env?.dispose()
      if (!capture) resetCharacterLight()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    },
  }
}
