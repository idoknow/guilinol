import * as THREE from 'three'
import { createDrinksSim, type DrinksSim, type DrinksSimSnapshot } from '../sim/index.ts'
import { createDrinksNpcRenderer } from './renderer.ts'
import { DEFAULT_DRINKS_NPC_SKIN } from './palette.ts'
import type { DrinksNpcMetrics, DrinksNpcRenderer, DrinksNpcSkinConfig } from './types.ts'

export interface DrinksNpcPreviewHandle {
  sim: DrinksSim
  renderer: DrinksNpcRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  webgl: THREE.WebGLRenderer
  advanceToPeak30(maxSimSec?: number): DrinksSimSnapshot
  getMetrics(): DrinksNpcMetrics & {
    rendererDrawCalls: number
    rendererTriangles: number
    npcLightCount: number
  }
  measureFrames(frameCount?: number): Promise<{
    frames: number
    avgFrameMs: number
    p95FrameMs: number
    maxFrameMs: number
    avgNpcUpdateMs: number
    fpsEstimate: number
    activeTotal: number
    visibleCount: number
    clerksCount: number
    customersCount: number
  }>
  dispose(): void
}

function createSignboardTexture(title: string, subtitle: string, bgHex: string, textHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 192
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = bgHex
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.strokeStyle = '#fff5e4'
  ctx.lineWidth = 6
  ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24)

  ctx.fillStyle = textHex
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 74px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  ctx.fillText(title, canvas.width * 0.5, 78)

  ctx.font = '500 30px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  ctx.fillStyle = '#ffeed8'
  ctx.fillText(subtitle, canvas.width * 0.5, 140)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

function buildShopStage(sim: DrinksSim, skin: DrinksNpcSkinConfig): { group: THREE.Group; dispose: () => void } {
  const layout = sim.getLayout()
  const group = new THREE.Group()
  group.name = 'drinks-shop-preview-stage'
  const geos: THREE.BufferGeometry[] = []
  const mats: THREE.Material[] = []
  const texs: THREE.Texture[] = []

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geos.push(g)
    return g
  }
  const trackMat = <T extends THREE.Material>(m: T): T => {
    mats.push(m)
    return m
  }
  const addBox = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    color: number | string,
    opts?: { transparent?: boolean; opacity?: number; roughness?: number; depthWrite?: boolean },
  ): THREE.Mesh => {
    const mat = trackMat(
      new THREE.MeshStandardMaterial({
        color,
        roughness: opts?.roughness ?? 0.85,
        metalness: 0.04,
        flatShading: true,
        transparent: opts?.transparent ?? false,
        opacity: opts?.opacity ?? 1,
        depthWrite: opts?.depthWrite ?? !(opts?.transparent ?? false),
      }),
    )
    const mesh = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w, h, d)), mat)
    mesh.position.set(x, y, z)
    group.add(mesh)
    return mesh
  }

  // Granite sidewalk + curb + patio strip + warm interior floor tiles
  addBox(24, 0.08, 10, 0, -0.05, 6.4, '#8b8b87', { roughness: 0.92 })
  addBox(12.2, 0.04, 2.3, 0, 0.0, 3.85, '#c2bcb0', { roughness: 0.9 })
  addBox(layout.width, 0.08, 7.6, 0, -0.03, -0.9, '#ece6da', { roughness: 0.86 })

  // Side & rear walls with upper parapet rim
  addBox(layout.width, 4.1, 0.24, 0, 2.05, -4.6, '#f4f0e8')
  addBox(0.24, 4.1, 7.5, -layout.width * 0.5, 2.05, -0.9, '#f4f0e8')
  addBox(0.24, 4.1, 7.5, layout.width * 0.5, 2.05, -0.9, '#f4f0e8')
  // Side roof eaves so store reads as an architectural building shell (leaving center open for visibility)
  addBox(layout.width + 0.4, 0.16, 1.8, 0, 4.12, -3.85, '#646b6d')
  addBox(0.55, 0.16, 7.8, -layout.width * 0.5, 4.12, -0.9, '#646b6d')
  addBox(0.55, 0.16, 7.8, layout.width * 0.5, 4.12, -0.9, '#646b6d')

  // Front facade mullions + framed glass curtain wings (transparent depthWrite:false prevents clipping sprites!)
  addBox(2.86, 3.35, 0.1, -4.19, 1.68, 2.8, '#cde0e8', { transparent: true, opacity: 0.22, roughness: 0.15, depthWrite: false })
  addBox(2.86, 3.35, 0.1, 4.19, 1.68, 2.8, '#cde0e8', { transparent: true, opacity: 0.22, roughness: 0.15, depthWrite: false })
  for (const fx of [-5.62, -2.76, 2.76, 5.62]) {
    addBox(0.14, 3.55, 0.18, fx, 1.78, 2.8, '#363c42', { roughness: 0.55 })
  }
  addBox(2.86, 0.1, 0.16, -4.19, 3.4, 2.8, '#363c42', { roughness: 0.55 })
  addBox(2.86, 0.1, 0.16, 4.19, 3.4, 2.8, '#363c42', { roughness: 0.55 })

  // Flagship fascia signboard lifted to 3.92m header so clerks & back counter are 100% unobstructed!
  addBox(layout.width, 0.88, 0.34, 0, 3.92, 2.84, skin.clerkApronColor, { roughness: 0.65 })
  const signTex = createSignboardTexture(skin.shopBrandName, '鲜果茶 · 现磨咖啡 · 冰爽茶饮', skin.clerkApronColor, '#ffffff')
  texs.push(signTex)
  const signMat = trackMat(new THREE.MeshBasicMaterial({ map: signTex }))
  const signPlane = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(layout.width * 0.9, 0.74)), signMat)
  signPlane.position.set(0, 3.92, 3.02)
  group.add(signPlane)

  // Wall-mounted Menu Lightbox behind back bar (never blocks customer walk paths!)
  const menuTex = createSignboardTexture('招牌饮品 · ¥4 - ¥9', '冰鲜柠檬水 ¥4  ·  满杯百香果 ¥7  ·  珍珠奶茶 ¥7  ·  杨枝甘露 ¥9', '#272f38', '#ffe49e')
  texs.push(menuTex)
  const menuPlane = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(5.8, 0.95)), trackMat(new THREE.MeshBasicMaterial({ map: menuTex })))
  menuPlane.position.set(-0.2, 2.65, -4.46)
  group.add(menuPlane)

  // Compact sidewalk A-frame menu stand tucked beside left glass window (well clear of browsing spots)
  addBox(0.62, 0.98, 0.1, -3.35, 0.49, 2.95, '#2b323b', { roughness: 0.65 })
  addBox(0.52, 0.66, 0.12, -3.35, 0.58, 2.96, '#f6efe0', { roughness: 0.75 })

  // Main front service counter (separates clerk zone z < -0.45 from customer hall z > -0.05)
  addBox(7.8, 0.94, 0.6, 0.2, 0.47, -0.38, '#f5f1e8', { roughness: 0.72 })
  addBox(7.86, 0.08, 0.66, 0.2, 0.96, -0.38, skin.clerkApronColor, { roughness: 0.6 })

  // POS registers at cashiers
  for (const c of layout.cashiers) {
    addBox(0.36, 0.24, 0.26, c.clerkPos.x, 1.12, -0.38, '#232830')
  }

  // Back prep bar + beverage machines
  addBox(8.2, 0.86, 0.72, -0.2, 0.43, -3.15, '#dce0e2', { roughness: 0.68 })
  for (const st of layout.prepStations) {
    addBox(0.56, 0.46, 0.46, st.x, 1.09, -3.15, st.kind === 'cream_top' ? '#f2ece2' : '#73828c')
  }
  // Storage crates
  addBox(0.85, 1.3, 0.68, layout.storagePos.x - 0.65, 0.65, layout.storagePos.z, '#b7854d')

  // Tables & seats (offset cleanly so seated legs don't clip central table post)
  for (const seat of layout.seats) {
    const dirX = Math.sin(seat.yaw)
    const dirZ = Math.cos(seat.yaw)
    addBox(0.42, 0.42, 0.42, seat.x, 0.21, seat.z, seat.zone === 'patio' ? '#d97b62' : '#d2c2aa')
    const tx = seat.x + dirX * 0.78
    const tz = seat.z + dirZ * 0.78
    addBox(0.56, 0.045, 0.56, tx, 0.7, tz, '#f6f2e8')
    addBox(0.07, 0.68, 0.07, tx + dirX * 0.1, 0.34, tz + dirZ * 0.1, '#434a52')
  }

  return {
    group,
    dispose() {
      for (const g of geos) g.dispose()
      for (const m of mats) m.dispose()
      for (const t of texs) t.dispose()
      group.removeFromParent()
    },
  }
}

export function mountDrinksNpcPreview(
  container: HTMLElement,
  opts?: { width?: number; height?: number; skin?: Partial<DrinksNpcSkinConfig> },
): DrinksNpcPreviewHandle {
  const width = opts?.width ?? Math.max(640, container.clientWidth || 1280)
  const height = opts?.height ?? Math.max(400, container.clientHeight || 720)
  const skin: DrinksNpcSkinConfig = { ...DEFAULT_DRINKS_NPC_SKIN, ...(opts?.skin ?? {}) }

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#d9e5ea')

  const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 120)
  camera.position.set(2.8, 5.5, 11.4)
  camera.lookAt(-0.1, 1.3, -0.2)
  camera.updateMatrixWorld()

  const webgl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  webgl.setPixelRatio(1)
  webgl.setSize(width, height)
  webgl.outputColorSpace = THREE.SRGBColorSpace
  container.appendChild(webgl.domElement)

  // Guilin daytime lighting (preview world sky/sun only; NPC renderer adds 0 lights)
  const hemi = new THREE.HemisphereLight('#d6e7f2', '#7d776a', 1.35)
  const sun = new THREE.DirectionalLight('#fff2da', 2.2)
  sun.position.set(8, 14, 9)
  scene.add(hemi, sun)

  const sim = createDrinksSim({
    seed: 'wangcheng-peak-30-preview',
    now: 0,
    hourOf: t => 19.5 + t / 3600,
    clerkCount: 5,
    maxCustomers: 26,
  })

  const stage = buildShopStage(sim, skin)
  scene.add(stage.group)

  const npcRenderer = createDrinksNpcRenderer({
    scene,
    sim,
    skin,
    maxNpcs: 48,
    showBadges: true,
  })

  function advanceToPeak30(maxSimSec = 240): DrinksSimSnapshot {
    let snap = sim.getSnapshot()
    let elapsed = 0
    while (elapsed < maxSimSec && snap.clerks.length + snap.customers.length < 30) {
      sim.fastForward(2)
      elapsed += 2
      snap = sim.getSnapshot()
    }
    npcRenderer.step(0, camera.position)
    webgl.render(scene, camera)
    return snap
  }

  // Start immediately at peak 30 NPCs
  advanceToPeak30(240)

  function getMetrics() {
    let npcLightCount = 0
    npcRenderer.group.traverse(obj => {
      if ((obj as THREE.Light).isLight) npcLightCount++
    })
    return {
      ...npcRenderer.getMetrics(),
      rendererDrawCalls: webgl.info.render.calls,
      rendererTriangles: webgl.info.render.triangles,
      npcLightCount,
    }
  }

  async function measureFrames(frameCount = 60) {
    const frameTimes: number[] = []
    const npcUpdateTimes: number[] = []
    let prev = performance.now()

    for (let i = 0; i < frameCount; i++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const now = performance.now()
      const dt = Math.min(0.05, Math.max(0.004, (now - prev) / 1000))
      prev = now

      const tFrame0 = performance.now()
      sim.step(dt)
      npcRenderer.step(dt, camera.position)
      webgl.render(scene, camera)
      const tFrame1 = performance.now()

      frameTimes.push(tFrame1 - tFrame0)
      npcUpdateTimes.push(npcRenderer.getMetrics().lastUpdateMs)
    }

    const sorted = [...frameTimes].sort((a, b) => a - b)
    const sum = frameTimes.reduce((a, b) => a + b, 0)
    const avgFrameMs = Math.round((sum / frameTimes.length) * 1000) / 1000
    const p95FrameMs = Math.round((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0) * 1000) / 1000
    const maxFrameMs = Math.round((sorted[sorted.length - 1] ?? 0) * 1000) / 1000
    const avgNpcUpdateMs = Math.round((npcUpdateTimes.reduce((a, b) => a + b, 0) / npcUpdateTimes.length) * 1000) / 1000
    const metrics = npcRenderer.getMetrics()

    return {
      frames: frameCount,
      avgFrameMs,
      p95FrameMs,
      maxFrameMs,
      avgNpcUpdateMs,
      fpsEstimate: avgFrameMs > 0 ? Math.round((1000 / avgFrameMs) * 10) / 10 : 999,
      activeTotal: metrics.activeTotal,
      visibleCount: metrics.visibleCount,
      clerksCount: metrics.clerksCount,
      customersCount: metrics.customersCount,
    }
  }

  const handle: DrinksNpcPreviewHandle = {
    sim,
    renderer: npcRenderer,
    scene,
    camera,
    webgl,
    advanceToPeak30,
    getMetrics,
    measureFrames,
    dispose() {
      npcRenderer.dispose()
      stage.dispose()
      webgl.dispose()
      webgl.domElement.remove()
    },
  }

  if (typeof window !== 'undefined') {
    Object.assign(window, { __drinksNpcPreview: handle })
  }

  return handle
}
