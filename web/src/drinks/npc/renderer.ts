import * as THREE from 'three'
import { resolveDrinksNpcSkin } from './palette.ts'
import {
  buildNpcRenderPoseFromClerk,
  buildNpcRenderPoseFromCustomer,
  DrinksNpcRigPool,
  type NpcRenderPose,
} from './rig-pool.ts'
import type { DrinksNpcMetrics, DrinksNpcRenderer, DrinksNpcRendererOptions, DrinksNpcSkinConfig } from './types.ts'

interface SmoothedTransform {
  x: number
  z: number
  yaw: number
}

function lerpAngle(a: number, b: number, t: number): number {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a))
  return a + diff * t
}

export function createDrinksNpcRenderer(options: DrinksNpcRendererOptions): DrinksNpcRenderer {
  const { scene, sim } = options
  let skin: DrinksNpcSkinConfig = resolveDrinksNpcSkin(options.skin)
  const origin = options.worldOrigin ?? [0, 0, 0]
  const worldYaw = options.worldYaw ?? 0
  const cosY = Math.cos(worldYaw)
  const sinY = Math.sin(worldYaw)
  const sampleGroundY = options.sampleGroundY ?? (() => origin[1])

  const pool = new DrinksNpcRigPool(options.maxNpcs ?? 48, options.showBadges ?? true)
  scene.add(pool.group)

  const smoothed = new Map<string, SmoothedTransform>()
  const poses: NpcRenderPose[] = []
  let peakTotal = 0
  let lastUpdateMs = 0
  let lastMetrics: DrinksNpcMetrics = {
    activeTotal: 0,
    clerksCount: 0,
    customersCount: 0,
    visibleCount: 0,
    holdingCupCount: 0,
    seatedCount: 0,
    drawCallLayers: pool.drawCallLayers,
    lastUpdateMs: 0,
    peakTotal: 0,
  }

  function toWorld(lx: number, lz: number, lyaw: number): { wx: number; wy: number; wz: number; wyaw: number } {
    const wx = origin[0] + lx * cosY + lz * sinY
    const wz = origin[2] - lx * sinY + lz * cosY
    const wy = sampleGroundY(wx, wz)
    return { wx, wy, wz, wyaw: lyaw + worldYaw }
  }

  function smoothEntity(key: string, targetX: number, targetZ: number, targetYaw: number, alpha: number): SmoothedTransform {
    let cur = smoothed.get(key)
    if (!cur) {
      cur = { x: targetX, z: targetZ, yaw: targetYaw }
      smoothed.set(key, cur)
      return cur
    }
    const distSq = (targetX - cur.x) ** 2 + (targetZ - cur.z) ** 2
    if (distSq > 9) {
      cur.x = targetX
      cur.z = targetZ
      cur.yaw = targetYaw
      return cur
    }
    cur.x += (targetX - cur.x) * alpha
    cur.z += (targetZ - cur.z) * alpha
    cur.yaw = lerpAngle(cur.yaw, targetYaw, alpha)
    return cur
  }

  function step(dtSec: number, cameraPos?: THREE.Vector3): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const snap = sim.getSnapshot()
    const alpha = dtSec > 0 ? Math.min(1, 1 - Math.exp(-16 * dtSec)) : 1

    poses.length = 0
    const liveKeys = new Set<string>()
    let holdingCupCount = 0
    let seatedCount = 0

    for (const cl of snap.clerks) {
      liveKeys.add(cl.id)
      const sm = smoothEntity(cl.id, cl.x, cl.z, cl.yaw, alpha)
      const w = toWorld(sm.x, sm.z, sm.yaw)
      if (cl.holdingCup) holdingCupCount++
      poses.push(buildNpcRenderPoseFromClerk(cl, skin, w.wx, w.wy, w.wz, w.wyaw))
    }

    for (const cu of snap.customers) {
      liveKeys.add(cu.id)
      const sm = smoothEntity(cu.id, cu.x, cu.z, cu.yaw, alpha)
      const w = toWorld(sm.x, sm.z, sm.yaw)
      if (cu.holdingCup) holdingCupCount++
      if (cu.seated) seatedCount++
      poses.push(buildNpcRenderPoseFromCustomer(cu, w.wx, w.wy, w.wz, w.wyaw))
    }

    for (const key of smoothed.keys()) {
      if (!liveKeys.has(key)) smoothed.delete(key)
    }

    const visibleCount = pool.update(poses, snap.timeSec, cameraPos)
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    lastUpdateMs = Math.round((t1 - t0) * 1000) / 1000

    const activeTotal = snap.clerks.length + snap.customers.length
    if (activeTotal > peakTotal) peakTotal = activeTotal

    lastMetrics = {
      activeTotal,
      clerksCount: snap.clerks.length,
      customersCount: snap.customers.length,
      visibleCount,
      holdingCupCount,
      seatedCount,
      drawCallLayers: pool.drawCallLayers,
      lastUpdateMs,
      peakTotal,
    }
  }

  // Initial sync so scene has NPCs immediately on frame 0
  step(0)

  return {
    group: pool.group,
    step,
    getMetrics(): DrinksNpcMetrics {
      return { ...lastMetrics }
    },
    setSkin(patch: Partial<DrinksNpcSkinConfig>): void {
      skin = resolveDrinksNpcSkin(patch)
    },
    dispose(): void {
      smoothed.clear()
      pool.dispose()
    },
  }
}
