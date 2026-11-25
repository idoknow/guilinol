import * as THREE from 'three'
import { createDrinksNpcRenderer } from '../npc/index.ts'
import { buildDrinksShopMesh } from '../shop/index.ts'
import { createDrinksSim } from '../sim/index.ts'
import { createDrinksStaffController, type DrinksStaffController } from './controller.ts'
import type { DrinksStaffStateSnapshot } from './workflow.ts'

export interface DrinksStaffPreviewHandle {
  readonly staff: DrinksStaffController
  readonly playerFigure: THREE.Group
  setPlayerPose(x: number, z: number, yaw: number): void
  setCamera(px: number, py: number, pz: number, lx: number, ly: number, lz: number): void
  step(dtSec: number): DrinksStaffStateSnapshot
  getMetrics(): {
    snapshot: DrinksStaffStateSnapshot
    stageTriangles: number
    stageLights: number
    uniformEquipped: boolean
    uniformTriangles: number
    bgmPlaying: boolean
    bgmInsideShop: boolean
    bgmFadeLevel: number
    audioTotalPlayed: number
    audioLastId: string | null
    audioCounts: Record<string, number>
    armRightPitch: number
    headYaw: number
  }
  dispose(): void
}

function buildArticulatedPlayerFigure(): THREE.Group {
  const fig = new THREE.Group()
  fig.name = 'staff-preview-player'

  const skinMat = new THREE.MeshStandardMaterial({ color: '#dfb792', roughness: 0.78, flatShading: true })
  const shirtMat = new THREE.MeshStandardMaterial({ color: '#e2e8f0', roughness: 0.8, flatShading: true })
  const pantsMat = new THREE.MeshStandardMaterial({ color: '#3b4a62', roughness: 0.85, flatShading: true })
  const shoeMat = new THREE.MeshStandardMaterial({ color: '#1f2329', roughness: 0.9, flatShading: true })
  const hairMat = new THREE.MeshStandardMaterial({ color: '#221c18', roughness: 0.88, flatShading: true })

  // Hips & Legs
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.72, 0.14), pantsMat)
  legL.position.set(-0.095, 0.38, 0)
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.72, 0.14), pantsMat)
  legR.position.set(0.095, 0.38, 0)
  const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.22), shoeMat)
  shoeL.position.set(-0.095, 0.04, -0.03)
  const shoeR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.22), shoeMat)
  shoeR.position.set(0.095, 0.04, -0.03)

  // Torso & articulated shoulder/elbow hierarchy aligned with `walk/avatar-rig.ts` joint names
  const torsoGroup = new THREE.Group()
  torsoGroup.name = 'Torso'
  torsoGroup.position.set(0, 1.08, 0)
  const torsoMesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.56, 0.2), shirtMat)
  torsoGroup.add(torsoMesh)

  for (const side of ['L', 'R'] as const) {
    const sgn = side === 'L' ? -1 : 1
    const armPivot = new THREE.Group()
    armPivot.name = `Arm${side}`
    armPivot.position.set(sgn * 0.24, 0.24, 0)
    const upperArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.21, 0.1), shirtMat)
    upperArmMesh.position.set(0, -0.095, 0)

    const forearmPivot = new THREE.Group()
    forearmPivot.name = `Forearm${side}`
    forearmPivot.position.set(0, -0.2, 0)
    const forearmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.22, 0.086), skinMat)
    forearmMesh.position.set(0, -0.105, 0)
    forearmPivot.add(forearmMesh)

    armPivot.add(upperArmMesh, forearmPivot)
    torsoGroup.add(armPivot)
  }

  // Head group named `Head` centered at head bone (~1.568)
  const headGroup = new THREE.Group()
  headGroup.name = 'Head'
  headGroup.position.set(0, 1.568, 0)
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.116, 14, 10), skinMat)
  headMesh.position.set(0, 0.055, 0)
  const hairMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.121, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.56),
    hairMat,
  )
  hairMesh.position.set(0, 0.068, 0.01)
  headGroup.add(headMesh, hairMesh)

  fig.add(legL, legR, shoeL, shoeR, torsoGroup, headGroup)
  return fig
}

export function mountDrinksStaffPreview(
  container: HTMLElement,
  opts?: { width?: number; height?: number },
): DrinksStaffPreviewHandle {
  const width = opts?.width ?? Math.max(640, container.clientWidth || 1280)
  const height = opts?.height ?? Math.max(400, container.clientHeight || 720)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#dce8ee')

  const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 120)
  camera.position.set(-0.6, 2.25, 6.8)
  camera.lookAt(-1.1, 1.0, 3.2)

  const webgl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  webgl.setPixelRatio(1)
  webgl.setSize(width, height)
  webgl.outputColorSpace = THREE.SRGBColorSpace
  container.appendChild(webgl.domElement)

  const hemi = new THREE.HemisphereLight('#dcecf7', '#7b7467', 1.45)
  const sun = new THREE.DirectionalLight('#fff2da', 2.2)
  sun.position.set(8, 14, 9)
  scene.add(hemi, sun)

  const shop = buildDrinksShopMesh({ cutaway: true })
  shop.materials.curtainGlassMat.depthWrite = false
  shop.materials.doorGlassMat.depthWrite = false
  scene.add(shop.group)

  const sim = createDrinksSim({
    seed: 'staff-dev-preview',
    now: 0,
    hourOf: () => 15.0,
    clerkCount: 2,
    maxCustomers: 10,
  })
  sim.fastForward(20)

  // While player works backstage in preview, keep one stationary cashier clerk at register 0
  // so NPC clerks don't walk into backstage close-up camera sightlines or overlap pickup slot.
  const npcSimProxy = {
    ...sim,
    getSnapshot() {
      const snap = sim.getSnapshot()
      const firstClerk = snap.clerks[0]
      if (!firstClerk) return snap
      const cashier = sim.getLayout()?.cashiers?.[0]?.clerkPos ?? { x: -2.55, z: -0.92, yaw: 0 }
      return {
        ...snap,
        clerks: [
          {
            ...firstClerk,
            x: cashier.x,
            z: cashier.z,
            yaw: cashier.yaw,
            interactionKind: null,
            holdingCupColor: null,
          },
        ],
      }
    },
  }

  const npc = createDrinksNpcRenderer({
    scene,
    sim: npcSimProxy,
    maxNpcs: 24,
    showBadges: false,
  })

  const playerFigure = buildArticulatedPlayerFigure()
  playerFigure.position.set(-1.35, 0, 4.35)
  playerFigure.rotation.y = -0.15 // faces -Z toward standee & entrance
  scene.add(playerFigure)

  const staff = createDrinksStaffController({
    scene,
    sim,
    container,
    worldOrigin: [0, 0, 0],
    worldYaw: 0,
  })
  staff.bindWalker(null, playerFigure)
  staff.setPlayerLocalPos(playerFigure.position.x, playerFigure.position.z, playerFigure.rotation.y)

  let camTargetPos = new THREE.Vector3(-0.7, 2.15, 6.6)
  let camLookTarget = new THREE.Vector3(-1.35, 0.98, 3.5)
  let disposed = false
  let rafId = 0
  let prevMs = performance.now()

  const keyListener = (ev: KeyboardEvent) => {
    if (!disposed) staff.handleKeyDown(ev.code, ev.target)
  }
  window.addEventListener('keydown', keyListener)

  function setPlayerPose(x: number, z: number, yaw: number): void {
    playerFigure.position.set(x, 0, z)
    playerFigure.rotation.y = yaw
    staff.setPlayerLocalPos(x, z, yaw)
  }

  function setCamera(px: number, py: number, pz: number, lx: number, ly: number, lz: number): void {
    camTargetPos.set(px, py, pz)
    camLookTarget.set(lx, ly, lz)
    camera.position.copy(camTargetPos)
    camera.lookAt(camLookTarget)
    camera.updateMatrixWorld()
  }

  function renderOnce(dtSec: number): DrinksStaffStateSnapshot {
    sim.step(dtSec)
    npc.step(dtSec, camera.position)
    staff.step(dtSec)
    webgl.render(scene, camera)
    return staff.getSnapshot()
  }

  const loop = (nowMs: number) => {
    if (disposed) return
    const dt = Math.min(0.05, Math.max(0.008, (nowMs - prevMs) / 1000))
    prevMs = nowMs
    renderOnce(dt)
    rafId = requestAnimationFrame(loop)
  }
  rafId = requestAnimationFrame(loop)

  const handle: DrinksStaffPreviewHandle = {
    staff,
    playerFigure,
    setPlayerPose,
    setCamera,
    step: renderOnce,
    getMetrics() {
      const m = staff.stage.getMetrics()
      const a = staff.audio.getStats()
      const bgmStats = staff.bgm.getStats()
      const armR = playerFigure.getObjectByName('ArmR')
      const head = playerFigure.getObjectByName('Head')
      return {
        snapshot: staff.getSnapshot(),
        stageTriangles: m.triangles,
        stageLights: m.lights,
        uniformEquipped: staff.uniform.isEquipped(),
        uniformTriangles: staff.uniform.getTriangles(),
        bgmPlaying: staff.bgm.isPlaying(),
        bgmInsideShop: bgmStats.insideShop,
        bgmFadeLevel: bgmStats.fadeLevel,
        audioTotalPlayed: a.totalPlayed,
        audioLastId: a.lastPlayedId,
        audioCounts: { ...a.playedCounts },
        armRightPitch: armR ? Math.round(armR.rotation.x * 1000) / 1000 : 0,
        headYaw: head ? Math.round(head.rotation.y * 1000) / 1000 : 0,
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(rafId)
      window.removeEventListener('keydown', keyListener)
      staff.dispose()
      npc.dispose()
      shop.dispose()
      webgl.dispose()
      webgl.domElement.remove()
    },
  }

  Object.assign(window, { __drinksStaffPreview: handle })
  return handle
}
