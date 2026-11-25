import * as T from 'three'
import {disposeCharacterParts, previewCharacter} from '../walk/character'
import type {Avatar} from '../../../lib/avatar'

export function creatorStage(host: HTMLElement, reduced: boolean, capture = false) {
  const renderer = new T.WebGLRenderer({alpha: true, antialias: true, preserveDrawingBuffer: capture})
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  host.append(renderer.domElement)
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(30, 1, 0.01, 20)
  scene.add(new T.HemisphereLight(0xfffaf2, 0xc3c9c2, 2))
  const key = new T.DirectionalLight(0xfff4e6, 2.35)
  key.position.set(-3, 5, -4)
  scene.add(key)
  const disc = new T.Mesh(
    new T.CylinderGeometry(0.62, 0.65, 0.065, 64),
    new T.MeshStandardMaterial({color: '#c4c9c6', roughness: 1}),
  )
  disc.position.y = -0.037
  scene.add(disc)
  let model: Awaited<ReturnType<typeof previewCharacter>> | undefined, mixer: T.AnimationMixer | undefined
  let rotation = 0,
    velocity = 0,
    close = false,
    closeAmount = 1,
    zoom = 0,
    entrance = reduced ? 1 : 0,
    finishing = false,
    pop = 1,
    glance = 1
  let crownHeight = 1.72,
    portraitScale = 1
  let pullback = 0,
    zoomStart = 0,
    zoomTime = 1,
    popTarget: T.Object3D | undefined
  let latest = 0,
    frame = 0,
    last = performance.now(),
    drag = false,
    x = 0,
    disposed = false
  const canvas = renderer.domElement
  function release() {
    if (!model) return
    mixer?.stopAllAction()
    mixer?.uncacheRoot(model.scene)
    scene.remove(model.scene)
    disposeCharacterParts(model.scene)
  }
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
    if (!reduced && from && colors.count === from.count && ['skin', 'look'].includes(change)) {
      const end = colors.clone(),
        start = from.clone(),
        begin = performance.now()
      const blend = (now: number) => {
        if (disposed || id !== latest) return
        const t = Math.min(1, (now - begin) / 200)
        for (let i = 0; i < colors.count; i++)
          colors.setXYZ(
            i,
            T.MathUtils.lerp(start.getX(i), end.getX(i), t),
            T.MathUtils.lerp(start.getY(i), end.getY(i), t),
            T.MathUtils.lerp(start.getZ(i), end.getZ(i), t),
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
        const t = Math.min(1, (now - begin) / 200)
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
    portraitScale = next.scene.getObjectByName('CreatorProportions')!.scale.y
    crownHeight = new T.Box3().setFromObject(next.scene.getObjectByName('creator-hair')!, true).max.y
    if (!reduced && ['hair', 'look'].includes(change)) {
      popTarget = change === 'hair' ? next.scene.getObjectByName('creator-hair') : next.scene
      pop = 0
    }
    if (!reduced && change === 'look') glance = 0
  }
  function resize() {
    const w = host.clientWidth,
      h = host.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()
  function draw(now: number) {
    const dt = Math.min(0.08, (now - last) / 1000)
    last = now
    entrance = Math.min(1, entrance + dt / 0.6)
    pop = Math.min(1, pop + dt / 0.18)
    glance = Math.min(1, glance + dt / 0.8)
    zoomTime = Math.min(1, zoomTime + dt / 0.45)
    zoom = T.MathUtils.lerp(zoomStart, close ? closeAmount : 0, reduced ? 1 : 1 - (1 - zoomTime) ** 3)
    if (finishing && !reduced) pullback = Math.min(1, pullback + dt / 0.6)
    const target = T.MathUtils.lerp(0.87, crownHeight - 0.244 * portraitScale, zoom),
      dist = T.MathUtils.lerp(4.25, 1.1 * portraitScale, zoom) * Math.max(1, 0.79 / camera.aspect)
    camera.position.set(0, target + 0.075, -dist - (1 - entrance) * 0.52 - pullback * 0.38)
    camera.lookAt(0, target, 0)
    if (model) {
      rotation += velocity * dt
      velocity *= Math.exp(-dt * 6)
      model.scene.rotation.y = rotation + (reduced ? 0 : 0.44 * (1 - entrance))
      popTarget?.scale.setScalar(pop < 0.6 ? 0.9 + (0.14 * pop) / 0.6 : 1.04 - (0.04 * (pop - 0.6)) / 0.4)
      mixer?.update(reduced ? 0 : dt)
      if (glance < 1) model.scene.getObjectByName('head')!.rotateX(0.16 * Math.sin(glance * Math.PI))
    }
    renderer.render(scene, camera)
    frame = requestAnimationFrame(draw)
  }
  frame = requestAnimationFrame(draw)
  canvas.onpointerdown = (e) => {
    drag = true
    x = e.clientX
    velocity = 0
    canvas.setPointerCapture(e.pointerId)
  }
  canvas.onpointermove = (e) => {
    if (drag) {
      const delta = (e.clientX - x) * 0.013
      rotation -= delta
      velocity = reduced ? 0 : -delta * 14
      x = e.clientX
    }
  }
  canvas.onpointerup = canvas.onpointercancel = () => {
    drag = false
  }
  canvas.ondblclick = () => {
    rotation = velocity = 0
  }
  return {
    apply,
    /** amount < 1 frames a little looser than the creator's face close-up (about-page portraits use it). */
    frameHead(value: boolean, amount = 1) {
      closeAmount = amount
      if (close !== value) {
        zoomStart = zoom
        zoomTime = 0
        close = value
      }
    },
    angle(y: number) {
      rotation = y
      velocity = 0
    },
    async finish() {
      if (!reduced && model && mixer) {
        const wave = model.animations.find((c) => c.name === 'wave')!,
          idle = model.animations.find((c) => c.name === 'idle')!
        const tracked = new Set(wave.tracks.map((t) => t.name))
        mixer.stopAllAction()
        mixer
          .clipAction(
            new T.AnimationClip(
              'wave-stance',
              idle.duration,
              idle.tracks.filter((t) => !tracked.has(t.name)),
            ),
          )
          .play()
        const waveAction = mixer.clipAction(wave).reset().setLoop(T.LoopOnce, 1)
        waveAction.clampWhenFinished = true
        waveAction.play()
        mixer.update(0)
        await new Promise((r) => setTimeout(r, 1200))
      }
      finishing = true
    },
    dispose() {
      disposed = true
      latest++
      cancelAnimationFrame(frame)
      observer.disconnect()
      release()
      disc.geometry.dispose()
      disc.material.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    },
  }
}
