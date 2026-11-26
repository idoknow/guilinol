/**
 * 解放桥交警岗前 GTA 风剧情多机位镜头控制器（web/src/traffic-duty/story/camera-shots.ts）
 *
 * 借鉴并对齐 `web/src/mifen/story/camera-shots.ts` 的电影运镜机制：
 *  - 进入剧情首帧记录原始 position / quaternion / fov，对话完成、跳过、取消或销毁时 1:1 精确还原；
 *  - 绝不修改玩家与交警的世界位置（零位移保证）；
 *  - 5 种机位：全景 (`wide`)、交警近景 (`officer`)、玩家过肩反打 (`player`)、双人中景 (`two`)、桥面态势 (`bridge`)；
 *  - 严格依据解放桥桥面横向坐标自动选择开阔路侧机位，防止撞进南侧石护栏或穿出桥外。
 */

import {jiefangDeckWorldY, worldToJiefangBridgeLocal} from '../jiefang-railings.ts'

export type DutyShotId = 'wide' | 'officer' | 'player' | 'two' | 'bridge'

export const DUTY_STORY_SHOT_IDS: readonly DutyShotId[] = Object.freeze([
  'wide',
  'officer',
  'player',
  'two',
  'bridge',
])

export interface DutyVec3Like {
  x: number
  y: number
  z: number
  set?(x: number, y: number, z: number): unknown
}

export interface DutyQuatLike {
  x: number
  y: number
  z: number
  w: number
  set?(x: number, y: number, z: number, w: number): unknown
}

export interface DutyCameraLike {
  position: DutyVec3Like
  quaternion: DutyQuatLike
  fov: number
  lookAt(x: number, y: number, z: number): void
  updateProjectionMatrix(): void
}

export interface DutyShotAnchor {
  npcPos: readonly [number, number, number]
  npcYaw: number
  npcHead: readonly [number, number, number]
  playerPos?: readonly [number, number, number] | null
}

export interface DutyShotPose {
  shot: DutyShotId
  position: [number, number, number]
  lookAt: [number, number, number]
  fov: number
}

export interface DutyCameraSnapshot {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  fov: number
}

export interface DutyStoryCameraState {
  active: boolean
  currentShot: DutyShotId | null
  savedFov: number | null
  currentFov: number | null
  restoreCount: number
}

export interface DutyStoryCameraController {
  begin(camera: DutyCameraLike): DutyCameraSnapshot
  setShot(shot: DutyShotId, anchor: DutyShotAnchor, camera: DutyCameraLike): DutyShotPose
  step(dt: number, anchor: DutyShotAnchor, camera: DutyCameraLike): DutyShotPose | null
  end(camera: DutyCameraLike): DutyCameraSnapshot | null
  isActive(): boolean
  getCurrentShot(): DutyShotId | null
  getSnapshot(): DutyCameraSnapshot | null
  getState(): DutyStoryCameraState
}

const SHOT_FOV: Record<DutyShotId, number> = {
  wide: 48,
  officer: 38,
  player: 35,
  two: 40,
  bridge: 50,
}

const BRIDGE_AXIS_X = 0.9486
const BRIDGE_AXIS_Z = 0.3165
const BRIDGE_SAFE_ABS_Z = 20.15

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function setVec3(target: DutyVec3Like, x: number, y: number, z: number): void {
  if (typeof target.set === 'function') {
    target.set(x, y, z)
  } else {
    target.x = x
    target.y = y
    target.z = z
  }
}

function setQuat(target: DutyQuatLike, x: number, y: number, z: number, w: number): void {
  if (typeof target.set === 'function') {
    target.set(x, y, z, w)
  } else {
    target.x = x
    target.y = y
    target.z = z
    target.w = w
  }
}

export function normalizeDutyShotId(raw: string | undefined | null): DutyShotId {
  if (raw === 'officer' || raw === 'player' || raw === 'two' || raw === 'bridge' || raw === 'wide') {
    return raw
  }
  return 'wide'
}

/** 保持机位处于解放桥石护栏内侧与桥面上空，避免贴边穿模或落入江面视野。 */
function clampPoseToBridgeDeck(pos: [number, number, number], fallbackMinY: number): [number, number, number] {
  let [wx, wy, wz] = pos
  const [lx, lz] = worldToJiefangBridgeLocal(wx, wz)
  if (lx >= -146 && lx <= 146 && Math.abs(lz) > BRIDGE_SAFE_ABS_Z && Math.abs(lz) <= 23.5) {
    const excess = Math.abs(lz) - BRIDGE_SAFE_ABS_Z
    const inwardSign = lz >= 0 ? -1 : 1
    // Local +Z normal in world is (-sin(-18.45), cos(-18.45)) ≈ (+0.3165, +0.9486)
    wx += inwardSign * 0.3165 * excess
    wz += inwardSign * 0.9486 * excess
  }
  const deckMinY = lx >= -142 && lx <= 142 && Math.abs(lz) <= 22.0 ? jiefangDeckWorldY(wx, wz) + 0.45 : fallbackMinY
  wy = Math.max(wy, deckMinY, fallbackMinY)
  return [wx, wy, wz]
}

/**
 * 纯函数：按真实人物 `-Z` 朝向与交警-玩家对话轴线计算 5 种电影机位。
 * 当站位靠南侧石栏杆时自动偏向北侧开阔路面摆放反打/双人机位。
 */
export function computeDutyShotPose(shot: DutyShotId, anchor: DutyShotAnchor): DutyShotPose {
  const [nx, ny, nz] = anchor.npcPos
  const [hx, hy, hz] = anchor.npcHead

  // CityWalker & Jiefang Officer local forward is -Z -> world (-sin(yaw), -cos(yaw))
  let fx = -Math.sin(anchor.npcYaw)
  let fz = -Math.cos(anchor.npcYaw)

  const hasPlayer = Boolean(anchor.playerPos)
  let px = anchor.playerPos ? anchor.playerPos[0] : nx + fx * 2.05
  let pz = anchor.playerPos ? anchor.playerPos[2] : nz + fz * 2.05
  const py = anchor.playerPos ? anchor.playerPos[1] : ny

  const dx = px - nx
  const dz = pz - nz
  const sep = Math.hypot(dx, dz)
  if (sep > 0.35) {
    fx = dx / sep
    fz = dz / sep
  } else if (hasPlayer) {
    px = nx + fx * 1.85
    pz = nz + fz * 1.85
  }

  // Right perpendicular of conversation axis (fx, fz): (fz, -fx) vs open roadway side (-fz, fx)
  const candAx = -fz
  const candAz = fx
  const [, lzA] = worldToJiefangBridgeLocal(nx + candAx * 2.4, nz + candAz * 2.4)
  const [, lzB] = worldToJiefangBridgeLocal(nx - candAx * 2.4, nz - candAz * 2.4)
  const openSign = Math.abs(lzA) <= Math.abs(lzB) ? 1 : -1
  const rx = candAx * openSign
  const rz = candAz * openSign

  // Convert walk capsule center (groundY + 0.88m) safely to standing foot height
  const rawPy = anchor.playerPos ? anchor.playerPos[1] : ny
  const playerFootY = rawPy > ny + 0.45 && rawPy < ny + 1.35 ? rawPy - 0.88 : rawPy
  const officerEyeY = Math.max(hy, ny + 1.54)
  const minSafeY = Math.min(ny, playerFootY) + 0.45

  if (shot === 'officer') {
    const offDist = hasPlayer ? Math.min(1.42, Math.max(1.16, sep * 0.56)) : 1.32
    const rawPos: [number, number, number] = [
      nx + fx * offDist + rx * 0.38,
      officerEyeY - 0.05,
      nz + fz * offDist + rz * 0.38,
    ]
    return {
      shot,
      position: clampPoseToBridgeDeck(rawPos, minSafeY),
      lookAt: [hx, officerEyeY - 0.12, hz],
      fov: SHOT_FOV.officer,
    }
  }

  if (shot === 'player') {
    // Chest-up reverse OTS framing so lowered hands stay cleanly out of wide-angle frame-edge stretch
    const fromPlayerDist = hasPlayer ? Math.min(2.45, Math.max(1.85, sep * 0.78)) : 2.0
    const rawPos: [number, number, number] = [
      px - fx * fromPlayerDist + rx * 0.58,
      playerFootY + 1.56,
      pz - fz * fromPlayerDist + rz * 0.58,
    ]
    return {
      shot,
      position: clampPoseToBridgeDeck(rawPos, minSafeY),
      lookAt: [px, playerFootY + 1.48, pz],
      fov: SHOT_FOV.player,
    }
  }

  if (shot === 'two') {
    // Chest-up level two-shot framing: keeps BOTH officer & player cleanly inside safe inner NDC (|x| <= 0.68)
    // across all talk distances (1.5m..5m) while pushing low bridge/stair handrails (<= +1.1m) cleanly below the
    // bottom dialogue bar so no metal rail cuts across legs or between characters.
    const mx = (nx + px) * 0.5
    const mz = (nz + pz) * 0.5
    const baseY = Math.min(ny, playerFootY)
    const halfSep = Math.max(0.72, sep * 0.5)
    const tanHalfV = Math.tan(((SHOT_FOV.two * 0.5) * Math.PI) / 180)
    const minAspect = 1.5
    const tanHalfH = tanHalfV * minAspect
    const requiredDist = (halfSep + 0.34) / (tanHalfH * 0.75)
    const dist = Math.max(2.4, Math.min(5.8, requiredDist))
    const rawPos: [number, number, number] = [
      mx + rx * dist,
      baseY + 1.46,
      mz + rz * dist,
    ]
    return {
      shot,
      position: clampPoseToBridgeDeck(rawPos, minSafeY),
      lookAt: [mx, baseY + 1.50, mz],
      fov: SHOT_FOV.two,
    }
  }

  if (shot === 'bridge') {
    // Showcase lens overlooking Jiefang Bridge deck railings & bicycle/scooter lane ahead
    const rawPos: [number, number, number] = [
      nx + BRIDGE_AXIS_X * 1.8 - BRIDGE_AXIS_Z * 3.8,
      ny + 2.65,
      nz + BRIDGE_AXIS_Z * 1.8 + BRIDGE_AXIS_X * 3.8 * -1,
    ]
    return {
      shot,
      position: clampPoseToBridgeDeck(rawPos, minSafeY),
      lookAt: [nx + BRIDGE_AXIS_X * 22.0, ny + 1.05, nz + BRIDGE_AXIS_Z * 22.0],
      fov: SHOT_FOV.bridge,
    }
  }

  // wide: establishing west bridgehead vista keeping guardrails cleanly below character chests
  const mx = (nx + px) * 0.5
  const mz = (nz + pz) * 0.5
  const rawWide: [number, number, number] = [
    mx + rx * 3.15 + fx * 0.65,
    ny + 2.15,
    mz + rz * 3.15 + fz * 0.65,
  ]
  return {
    shot: 'wide',
    position: clampPoseToBridgeDeck(rawWide, minSafeY),
    lookAt: [mx, ny + 1.22, mz],
    fov: SHOT_FOV.wide,
  }
}

export function createDutyStoryCameraController(): DutyStoryCameraController {
  let active = false
  let currentShot: DutyShotId | null = null
  let snapshot: DutyCameraSnapshot | null = null
  let hasBlended = false
  let restoreCount = 0

  let curPos: [number, number, number] = [0, 0, 0]
  let curLook: [number, number, number] = [0, 0, 0]
  let curFov = 50

  function applyPose(camera: DutyCameraLike): void {
    setVec3(camera.position, curPos[0], curPos[1], curPos[2])
    if (Math.abs(camera.fov - curFov) > 1e-4) {
      camera.fov = curFov
      camera.updateProjectionMatrix()
    }
    camera.lookAt(curLook[0], curLook[1], curLook[2])
  }

  return {
    begin(camera: DutyCameraLike): DutyCameraSnapshot {
      if (!active || !snapshot) {
        snapshot = {
          position: [camera.position.x, camera.position.y, camera.position.z],
          quaternion: [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w],
          fov: camera.fov,
        }
        curPos = [...snapshot.position]
        curFov = snapshot.fov
        hasBlended = false
        active = true
      }
      return {
        position: [...snapshot.position],
        quaternion: [...snapshot.quaternion],
        fov: snapshot.fov,
      }
    },

    setShot(shot: DutyShotId, anchor: DutyShotAnchor, camera: DutyCameraLike): DutyShotPose {
      if (!active) this.begin(camera)
      const normalized = normalizeDutyShotId(shot)
      currentShot = normalized
      const target = computeDutyShotPose(normalized, anchor)
      if (!hasBlended) {
        curPos = [
          lerpNum(curPos[0], target.position[0], 0.72),
          lerpNum(curPos[1], target.position[1], 0.72),
          lerpNum(curPos[2], target.position[2], 0.72),
        ]
        curLook = [...target.lookAt]
        curFov = lerpNum(curFov, target.fov, 0.72)
        hasBlended = true
      } else {
        curPos = [
          lerpNum(curPos[0], target.position[0], 0.62),
          lerpNum(curPos[1], target.position[1], 0.62),
          lerpNum(curPos[2], target.position[2], 0.62),
        ]
        curLook = [
          lerpNum(curLook[0], target.lookAt[0], 0.68),
          lerpNum(curLook[1], target.lookAt[1], 0.68),
          lerpNum(curLook[2], target.lookAt[2], 0.68),
        ]
        curFov = lerpNum(curFov, target.fov, 0.62)
      }
      applyPose(camera)
      return target
    },

    step(dt: number, anchor: DutyShotAnchor, camera: DutyCameraLike): DutyShotPose | null {
      if (!active || !currentShot) return null
      const safeDt = Math.min(0.1, Math.max(0, dt))
      const target = computeDutyShotPose(currentShot, anchor)
      const k = safeDt > 0 ? 1 - Math.exp(-8.5 * safeDt) : 0
      if (k > 0) {
        curPos = [
          lerpNum(curPos[0], target.position[0], k),
          lerpNum(curPos[1], target.position[1], k),
          lerpNum(curPos[2], target.position[2], k),
        ]
        curLook = [
          lerpNum(curLook[0], target.lookAt[0], k),
          lerpNum(curLook[1], target.lookAt[1], k),
          lerpNum(curLook[2], target.lookAt[2], k),
        ]
        curFov = lerpNum(curFov, target.fov, k)
      }
      applyPose(camera)
      return target
    },

    end(camera: DutyCameraLike): DutyCameraSnapshot | null {
      const saved = snapshot
      active = false
      currentShot = null
      hasBlended = false
      if (saved) {
        setVec3(camera.position, saved.position[0], saved.position[1], saved.position[2])
        setQuat(camera.quaternion, saved.quaternion[0], saved.quaternion[1], saved.quaternion[2], saved.quaternion[3])
        camera.fov = saved.fov
        camera.updateProjectionMatrix()
        restoreCount += 1
      }
      snapshot = null
      return saved
        ? {
            position: [...saved.position],
            quaternion: [...saved.quaternion],
            fov: saved.fov,
          }
        : null
    },

    isActive: () => active,
    getCurrentShot: () => currentShot,
    getSnapshot: () =>
      snapshot
        ? {
            position: [...snapshot.position],
            quaternion: [...snapshot.quaternion],
            fov: snapshot.fov,
          }
        : null,
    getState: () => ({
      active,
      currentShot,
      savedFov: snapshot?.fov ?? null,
      currentFov: active ? Number(curFov.toFixed(3)) : null,
      restoreCount,
    }),
  }
}
