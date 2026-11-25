import * as THREE from 'three'
import { buildDrinksShopMesh } from '../shop/mesh.ts'
import { createDrinksSim, type DrinksSim, type DrinksSimSnapshot } from '../sim/index.ts'
import { createDrinksNpcRenderer } from './renderer.ts'
import { DEFAULT_DRINKS_NPC_SKIN } from './palette.ts'
import type { DrinksNpcMetrics, DrinksNpcRenderer, DrinksNpcSkinConfig } from './types.ts'

export type InteractionScenarioId =
  | 'order'
  | 'handover'
  | 'call'
  | 'complain'
  | 'chat'
  | 'player_greet'
  | 'peak_30'

export interface DrinksNpcPreviewHandle {
  sim: DrinksSim
  renderer: DrinksNpcRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  webgl: THREE.WebGLRenderer
  advanceToPeak30(maxSimSec?: number): DrinksSimSnapshot
  runScenario(id: InteractionScenarioId): {
    scenario: InteractionScenarioId
    simTimeSec: number
    matchedKinds: string[]
    activeTotal: number
    visibleBadgeCount: number
  }
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
    visibleBadgeCount: number
    clerksCount: number
    customersCount: number
  }>
  dispose(): void
}

function createPlayerTagSprite(): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 192
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(24, 18, 12, 0.94)'
  ctx.beginPath()
  ctx.roundRect(10, 8, 172, 48, 22)
  ctx.fill()
  ctx.strokeStyle = '#fbbf24'
  ctx.lineWidth = 4
  ctx.stroke()
  ctx.fillStyle = '#fbbf24'
  ctx.beginPath()
  ctx.arc(38, 32, 8, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fef3c7'
  ctx.font = 'bold 26px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText('玩家', 56, 33)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(0.9, 0.3, 1)
  sprite.position.set(0, 2.02, 0)
  sprite.renderOrder = 5
  return sprite
}

function buildPlayerAvatarMarker(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'drinks-preview-player-marker'
  const jacket = new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.72, flatShading: true })
  const jeans = new THREE.MeshStandardMaterial({ color: '#3b5998', roughness: 0.84, flatShading: true })
  const skin = new THREE.MeshStandardMaterial({ color: '#dcb48e', roughness: 0.78, flatShading: true })
  const hair = new THREE.MeshStandardMaterial({ color: '#1f1b19', roughness: 0.88, flatShading: true })
  const ringMat = new THREE.MeshBasicMaterial({ color: '#fbbf24', side: THREE.DoubleSide })
  const discMat = new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false })

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.58, 0.26), jacket)
  torso.position.y = 1.03
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 1), skin)
  head.position.y = 1.5
  const capHair = new THREE.Mesh(new THREE.SphereGeometry(0.168, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.56), hair)
  capHair.position.set(0, 1.53, -0.01)
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.7, 0.16), jeans)
  legL.position.set(-0.11, 0.35, 0)
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.7, 0.16), jeans)
  legR.position.set(0.11, 0.35, 0)
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.46, 0.11), jacket)
  armL.position.set(-0.28, 1.05, 0)
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.46, 0.11), jacket)
  armR.position.set(0.28, 1.05, 0)

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 28), ringMat)
  ring.rotation.x = -Math.PI * 0.5
  ring.position.y = 0.04
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), discMat)
  disc.rotation.x = -Math.PI * 0.5
  disc.position.y = 0.035

  const tagSprite = createPlayerTagSprite()
  g.add(torso, head, capHair, legL, legR, armL, armR, ring, disc, tagSprite)
  g.visible = false
  return g
}

export function mountDrinksNpcPreview(
  container: HTMLElement,
  opts?: { width?: number; height?: number; skin?: Partial<DrinksNpcSkinConfig> },
): DrinksNpcPreviewHandle {
  const width = opts?.width ?? Math.max(640, container.clientWidth || 1280)
  const height = opts?.height ?? Math.max(400, container.clientHeight || 720)
  const skin: DrinksNpcSkinConfig = {
    ...DEFAULT_DRINKS_NPC_SKIN,
    greetingLine: '欢迎光临！',
    ...(opts?.skin ?? {}),
  }

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#d9e5ea')

  const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 120)
  camera.position.set(2.8, 5.8, 11.4)
  camera.lookAt(-0.1, 1.3, -0.2)
  camera.updateMatrixWorld()

  const webgl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  webgl.setPixelRatio(1)
  webgl.setSize(width, height)
  webgl.outputColorSpace = THREE.SRGBColorSpace
  container.appendChild(webgl.domElement)

  const hemi = new THREE.HemisphereLight('#d6e7f2', '#7d776a', 1.4)
  const sun = new THREE.DirectionalLight('#fff2da', 2.2)
  sun.position.set(8, 14, 9)
  scene.add(hemi, sun)

  // Mount real 1:1 Wangcheng shop architectural mesh in cutaway mode
  const shopMesh = buildDrinksShopMesh({ cutaway: true })
  shopMesh.materials.curtainGlassMat.depthWrite = false
  shopMesh.materials.doorGlassMat.depthWrite = false
  scene.add(shopMesh.group)

  const playerMarker = buildPlayerAvatarMarker()
  scene.add(playerMarker)

  let sim: DrinksSim = createDrinksSim({
    seed: 'wangcheng-peak-30-preview',
    now: 0,
    hourOf: t => 19.5 + t / 3600,
    clerkCount: 5,
    maxCustomers: 8,
  })

  let npcRenderer: DrinksNpcRenderer = createDrinksNpcRenderer({
    scene,
    sim,
    skin,
    maxNpcs: 20,
    maxVisibleBadges: 4,
    showBadges: true,
  })

  function rebuildSim(seed: string, hour = 19.5, maxCustomers = 8): void {
    npcRenderer.dispose()
    sim = createDrinksSim({
      seed,
      now: 0,
      hourOf: () => hour,
      clerkCount: 5,
      maxCustomers,
    })
    npcRenderer = createDrinksNpcRenderer({
      scene,
      sim,
      skin,
      maxNpcs: 20,
      maxVisibleBadges: 4,
      showBadges: true,
    })
    playerMarker.visible = false
  }

  function advanceToPeak30(maxSimSec = 240): DrinksSimSnapshot {
    let snap = sim.getSnapshot()
    let elapsed = 0
    while (elapsed < maxSimSec && snap.customers.length < 8) {
      sim.fastForward(2)
      elapsed += 2
      snap = sim.getSnapshot()
    }
    camera.position.set(0.3, 4.1, 9.4)
    camera.lookAt(0.1, 1.05, 0.3)
    camera.updateMatrixWorld()
    npcRenderer.step(0, camera.position)
    webgl.render(scene, camera)
    return snap
  }

  function stepUntilInteraction(
    predicate: (snap: DrinksSimSnapshot) => { x: number; z: number } | null,
    maxSteps = 900,
    stepDt = 0.2,
  ): { x: number; z: number } | null {
    for (let i = 0; i < maxSteps; i++) {
      sim.step(stepDt)
      const snap = sim.getSnapshot()
      const hit = predicate(snap)
      if (hit) return hit
    }
    return null
  }

  function runScenario(id: InteractionScenarioId) {
    if (id === 'peak_30') {
      rebuildSim('wangcheng-peak-30-preview', 19.5, 8)
      const snap = advanceToPeak30(240)
      const kinds = [
        ...snap.clerks.map(c => c.interactionKind).filter(Boolean),
        ...snap.customers.map(c => c.interactionKind).filter(Boolean),
      ] as string[]
      return {
        scenario: id,
        simTimeSec: snap.timeSec,
        matchedKinds: kinds,
        activeTotal: snap.clerks.length + snap.customers.length,
        visibleBadgeCount: npcRenderer.getMetrics().visibleBadgeCount,
      }
    }

    function pickClearCamera(
      tx: number,
      tz: number,
      candidates: readonly [number, number, number][],
      snap: DrinksSimSnapshot,
      ignoreIds: ReadonlySet<string>,
    ): [number, number, number] {
      const others = [
        ...snap.customers.filter(c => !ignoreIds.has(c.id)),
        ...snap.clerks.filter(c => !ignoreIds.has(c.id)),
      ]
      let best = candidates[0]!
      let bestScore = -Infinity
      for (const cand of candidates) {
        const [cx, cy, cz] = cand
        if (cx < -5.1 || cx > 5.1) continue
        let penalty = 0
        const dx = tx - cx
        const dz = tz - cz
        const lenSq = dx * dx + dz * dz
        if (lenSq < 1e-4) continue
        for (const o of others) {
          const t = Math.max(0, Math.min(1, ((o.x - cx) * dx + (o.z - cz) * dz) / lenSq))
          const px = cx + dx * t
          const pz = cz + dz * t
          const distToRay = Math.hypot(o.x - px, o.z - pz)
          if (distToRay < 0.9 && t > 0.05 && t < 0.95) {
            penalty += (0.9 - distToRay) * 20
          }
          if (Math.hypot(o.x - cx, o.z - cz) < 0.85) penalty += 15
        }
        const score = -penalty - Math.abs(Math.hypot(dx, dz) - 2.65)
        if (score > bestScore) {
          bestScore = score
          best = [cx, cy, cz]
        }
      }
      return best
    }

    if (id === 'order') {
      rebuildSim('scenario-order-v1', 15.5, 18)
      let pair: { fx: number; fz: number; ids: Set<string>; snap: DrinksSimSnapshot } | null = null
      stepUntilInteraction(s => {
        const cl = s.clerks.find(c => c.interactionKind === 'order_ask' && c.speed < 0.1)
        const cu = cl
          ? s.customers.find(c => c.interactionKind === 'order_reply' && Math.abs(c.x - cl.x) < 0.75)
          : undefined
        if (!cl || !cu) return null
        pair = { fx: (cl.x + cu.x) * 0.5, fz: (cl.z + cu.z) * 0.5, ids: new Set([cl.id, cu.id]), snap: s }
        return { x: pair.fx, z: pair.fz }
      })
      if (pair) {
        const p = pair as { fx: number; fz: number; ids: Set<string>; snap: DrinksSimSnapshot }
        const [cx, cy, cz] = pickClearCamera(
          p.fx,
          p.fz,
          [
            [p.fx + 1.55, 1.9, Math.min(2.35, p.fz + 2.35)],
            [p.fx - 1.55, 1.9, Math.min(2.35, p.fz + 2.35)],
            [p.fx + 2.1, 1.88, Math.min(2.2, p.fz + 1.45)],
          ],
          p.snap,
          p.ids,
        )
        camera.position.set(cx, cy, cz)
        camera.lookAt(p.fx, 1.24, p.fz - 0.1)
      } else {
        camera.position.set(-0.95, 1.9, 1.95)
        camera.lookAt(-2.55, 1.24, -0.4)
      }
    } else if (id === 'handover') {
      rebuildSim('scenario-handover-v1', 15.5, 18)
      let pair: { fx: number; fz: number; ids: Set<string>; snap: DrinksSimSnapshot } | null = null
      stepUntilInteraction(s => {
        const cl = s.clerks.find(c => c.interactionKind === 'handover_cup')
        const cu = cl
          ? s.customers.find(c => c.interactionKind === 'receive_cup' && Math.hypot(c.x - cl.x, c.z - cl.z) < 2.2)
          : undefined
        if (!cl || !cu) return null
        pair = { fx: (cl.x + cu.x) * 0.5, fz: (cl.z + cu.z) * 0.5, ids: new Set([cl.id, cu.id]), snap: s }
        return { x: pair.fx, z: pair.fz }
      })
      if (pair) {
        const p = pair as { fx: number; fz: number; ids: Set<string>; snap: DrinksSimSnapshot }
        const [cx, cy, cz] = pickClearCamera(
          p.fx,
          p.fz,
          [
            [p.fx + 2.35, 1.82, 1.15],
            [p.fx - 2.35, 1.82, 1.15],
            [p.fx + 2.05, 1.82, 1.85],
            [p.fx - 2.05, 1.82, 1.85],
          ],
          p.snap,
          p.ids,
        )
        camera.position.set(cx, cy, cz)
        camera.lookAt(p.fx, 1.18, p.fz)
      } else {
        camera.position.set(4.3, 1.82, 1.2)
        camera.lookAt(2.25, 1.18, -0.3)
      }
    } else if (id === 'call') {
      rebuildSim('scenario-call-v1', 15.5, 18)
      let pair: { fx: number; fz: number; ids: Set<string>; snap: DrinksSimSnapshot } | null = null
      stepUntilInteraction(s => {
        const cl = s.clerks.find(c => c.interactionKind === 'call_number')
        const cu = s.customers.find(c => c.interactionKind === 'look_up_called')
        if (!cl || !cu) return null
        pair = { fx: (cl.x + cu.x) * 0.5, fz: (cl.z + cu.z) * 0.5, ids: new Set([cl.id, cu.id]), snap: s }
        return { x: pair.fx, z: pair.fz }
      })
      if (pair) {
        const p = pair as { fx: number; fz: number; ids: Set<string>; snap: DrinksSimSnapshot }
        const [cx, cy, cz] = pickClearCamera(
          p.fx,
          p.fz,
          [
            [p.fx - 1.65, 1.9, 2.45],
            [p.fx + 1.65, 1.9, 2.45],
            [p.fx - 2.1, 1.9, 1.65],
          ],
          p.snap,
          p.ids,
        )
        camera.position.set(cx, cy, cz)
        camera.lookAt(p.fx + 0.05, 1.26, 0.15)
      } else {
        camera.position.set(0.5, 1.9, 2.45)
        camera.lookAt(2.05, 1.26, 0.15)
      }
    } else if (id === 'complain') {
      rebuildSim('scenario-complain-v1', 19.5, 26)
      let found: { fx: number; fz: number; id: string; snap: DrinksSimSnapshot } | null = null
      stepUntilInteraction(
        s => {
          const cu = s.customers.find(
            c => c.interactionKind === 'complain_leave' && c.phase === 'leaving' && c.x > -4.6 && c.x < 4.6 && c.z < 2.2,
          )
          if (!cu) return null
          found = { fx: cu.x, fz: cu.z, id: cu.id, snap: s }
          return { x: cu.x, z: cu.z }
        },
        2400,
        0.2,
      )
      if (found) {
        const f = found as { fx: number; fz: number; id: string; snap: DrinksSimSnapshot }
        const [cx, cy, cz] = pickClearCamera(
          f.fx,
          f.fz,
          [
            [f.fx + 2.35, 1.88, Math.min(2.38, f.fz + 1.25)],
            [f.fx - 2.35, 1.88, Math.min(2.38, f.fz + 1.25)],
            [f.fx + 1.8, 1.88, Math.min(2.38, f.fz + 1.95)],
            [f.fx - 1.8, 1.88, Math.min(2.38, f.fz + 1.95)],
          ],
          f.snap,
          new Set([f.id]),
        )
        camera.position.set(cx, cy, cz)
        camera.lookAt(f.fx, 1.15, f.fz)
      } else {
        camera.position.set(1.2, 1.9, 2.38)
        camera.lookAt(-1.2, 1.15, 1.2)
      }
    } else if (id === 'chat') {
      rebuildSim('scenario-chat-v1', 16.0, 24)
      let bestCam: { cam: [number, number, number]; mx: number; mz: number } | null = null
      let fallbackCam: { cam: [number, number, number]; mx: number; mz: number } | null = null
      const evalChatCam = (
        a: { id: string; x: number; z: number },
        b: { id: string; x: number; z: number },
        s: DrinksSimSnapshot,
      ): { cam: [number, number, number]; penalty: number } => {
        const mx = (a.x + b.x) * 0.5
        const mz = (a.z + b.z) * 0.5
        const cands: [number, number, number][] = []
        for (const dist of [3.2, 3.65, 4.0]) {
          for (const angleDeg of [20, 45, 70, 110, 135, 160, -20, -45, -70, -110, -135, -160]) {
            const rad = (angleDeg * Math.PI) / 180
            const cx = mx + Math.cos(rad) * dist
            const cz = mz + Math.sin(rad) * dist
            if (cx < -4.95 || cx > 4.95) continue
            if (mz < 2.5 && (cz > 2.38 || cz < 0.05)) continue
            if (mz >= 2.5 && (cz < 3.85 || cz > 6.4)) continue
            cands.push([cx, 2.02, cz])
          }
        }
        const others = s.customers.filter(c => c.id !== a.id && c.id !== b.id)
        let chosen: [number, number, number] = [mx + 2.8, 2.02, Math.min(2.36, mz + 1.6)]
        let minScore = Infinity
        let bestObstruct = Infinity
        for (const cand of cands) {
          const [cx, , cz] = cand
          let pen = 0
          for (const tgt of [a, b]) {
            const dx = tgt.x - cx
            const dz = tgt.z - cz
            const lenSq = Math.max(1e-4, dx * dx + dz * dz)
            for (const o of others) {
              const t = Math.max(0, Math.min(1, ((o.x - cx) * dx + (o.z - cz) * dz) / lenSq))
              const distRay = Math.hypot(o.x - (cx + dx * t), o.z - (cz + dz * t))
              if (distRay < 1.1 && t > 0.02 && t < 0.98) {
                pen += (1.1 - distRay) * 25
              }
            }
          }
          const align = Math.abs((b.x - a.x) * (cx - mx) + (b.z - a.z) * (cz - mz))
          const scorePen = pen + align * 0.8
          if (scorePen < minScore) {
            minScore = scorePen
            bestObstruct = pen
            chosen = cand
          }
        }
        return { cam: chosen, penalty: bestObstruct }
      }

      let chatStep = 0
      stepUntilInteraction(s => {
        chatStep++
        for (const a of s.customers) {
          if (a.interactionKind !== 'chat_pair_a' || !a.chatPartnerId) continue
          const b = s.customers.find(c => c.id === a.chatPartnerId && c.interactionKind === 'chat_pair_b')
          if (!b) continue
          const mx = (a.x + b.x) * 0.5
          const mz = (a.z + b.z) * 0.5
          const res = evalChatCam(a, b, s)
          fallbackCam = { cam: res.cam, mx, mz }
          if (res.penalty <= 1.5 || chatStep >= 300) {
            bestCam = { cam: res.cam, mx, mz }
            return { x: mx, z: mz }
          }
        }
        return null
      }, 900)
      const pick = bestCam ?? fallbackCam
      if (pick) {
        const chosen = pick as { cam: [number, number, number]; mx: number; mz: number }
        camera.position.set(chosen.cam[0], chosen.cam[1], chosen.cam[2])
        camera.lookAt(chosen.mx, 1.06, chosen.mz)
      } else {
        camera.position.set(3.4, 2.02, 2.35)
        camera.lookAt(0.0, 1.06, 1.4)
      }
    } else if (id === 'player_greet') {
      rebuildSim('scenario-player-v1', 19.5, 22)
      sim.fastForward(28)
      const preSnap = sim.getSnapshot()
      const anchorCust =
        preSnap.customers.find(c => c.phase === 'queuing' && c.z >= 0.7 && c.z <= 2.1) ??
        preSnap.customers.find(c => c.phase === 'waiting_pickup' && c.z >= 0.7 && c.z <= 2.1)
      const px = anchorCust ? Math.max(-2.1, Math.min(2.4, anchorCust.x + (anchorCust.x < 0 ? 0.92 : -0.92))) : -0.15
      const pz = anchorCust ? Math.max(0.85, Math.min(2.05, anchorCust.z + 0.18)) : 1.35
      playerMarker.position.set(px, 0, pz)
      playerMarker.rotation.y = Math.PI
      playerMarker.visible = true
      sim.setPlayerPresence({ active: true, x: px, z: pz, yaw: Math.PI, nearRadius: 6.2 })
      let clFocus = { x: -0.35, z: -0.92 }
      let snapAfter = preSnap
      stepUntilInteraction(
        s => {
          const cl = s.clerks.find(c => c.interactionKind === 'clerk_greet_player')
          if (!cl) return null
          clFocus = { x: cl.x, z: cl.z }
          snapAfter = s
          return clFocus
        },
        40,
        0.1,
      )
      const mx = (px + clFocus.x) * 0.5
      const mz = (pz + clFocus.z) * 0.5
      const [cx, cy, cz] = pickClearCamera(
        mx,
        mz,
        [
          [px + 2.85, 1.92, Math.min(2.4, pz + 1.25)],
          [px - 2.85, 1.92, Math.min(2.4, pz + 1.25)],
          [mx + 2.95, 1.94, 2.38],
        ],
        snapAfter,
        new Set(),
      )
      camera.position.set(cx, cy, cz)
      camera.lookAt(mx, 0.98, mz + 0.15)
    }

    camera.updateMatrixWorld()
    npcRenderer.step(0, camera.position)
    webgl.render(scene, camera)
    const snap = sim.getSnapshot()
    const kinds = [
      ...snap.clerks.map(c => c.interactionKind).filter(Boolean),
      ...snap.customers.map(c => c.interactionKind).filter(Boolean),
    ] as string[]
    return {
      scenario: id,
      simTimeSec: Math.round(snap.timeSec * 10) / 10,
      matchedKinds: kinds,
      activeTotal: snap.clerks.length + snap.customers.length,
      visibleBadgeCount: npcRenderer.getMetrics().visibleBadgeCount,
    }
  }

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
      visibleBadgeCount: metrics.visibleBadgeCount,
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
    runScenario,
    getMetrics,
    measureFrames,
    dispose() {
      npcRenderer.dispose()
      shopMesh.dispose()
      webgl.dispose()
      webgl.domElement.remove()
    },
  }

  if (typeof window !== 'undefined') {
    Object.assign(window, { __drinksNpcPreview: handle })
  }

  return handle
}
