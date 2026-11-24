/**
 * 田源米粉 · GTA 风剧情对话 5 机位镜头控制器
 *
 * 仅依赖鸭子类型接口（CameraLike / Vec3Like），不强耦合 Three.js 运行时，便于 Node 单测与浏览器同构运行。
 * 严格遵守：
 * - 进入剧情首帧记录原始 position / quaternion / fov，对话结束、跳过或重置时 1:1 还原；
 * - 绝不修改玩家位置（零位移保证）；
 * - 5 种机位（wide / uncle / player / two / shop）区分构图与焦段，且均保持在门面玻璃外侧防穿墙。
 */

export type StoryShotId = 'wide' | 'uncle' | 'player' | 'two' | 'shop'

export const STORY_SHOT_IDS: readonly StoryShotId[] = ['wide', 'uncle', 'player', 'two', 'shop']

export interface Vec3Like {
  x: number
  y: number
  z: number
  set?(x: number, y: number, z: number): unknown
}

export interface QuatLike {
  x: number
  y: number
  z: number
  w: number
  set?(x: number, y: number, z: number, w: number): unknown
}

export interface CameraLike {
  position: Vec3Like
  quaternion: QuatLike
  fov: number
  lookAt(x: number, y: number, z: number): void
  updateProjectionMatrix(): void
}

export interface ShotAnchor {
  npcPos: readonly [number, number, number]
  npcYaw: number
  npcHead: readonly [number, number, number]
  playerPos?: readonly [number, number, number] | null
}

export interface ShotPose {
  shot: StoryShotId
  position: [number, number, number]
  lookAt: [number, number, number]
  fov: number
}

export interface CameraSnapshot {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  fov: number
}

export interface StoryCameraController {
  begin(camera: CameraLike): CameraSnapshot
  setShot(shot: StoryShotId, anchor: ShotAnchor, camera: CameraLike): ShotPose
  step(dt: number, anchor: ShotAnchor, camera: CameraLike): ShotPose | null
  end(camera: CameraLike): CameraSnapshot | null
  isActive(): boolean
  getCurrentShot(): StoryShotId | null
  getSnapshot(): CameraSnapshot | null
  getState(): {
    active: boolean
    currentShot: StoryShotId | null
    savedFov: number | null
    currentFov: number | null
    restoreCount: number
  }
}

const SHOT_FOV: Record<StoryShotId, number> = {
  wide: 48,
  uncle: 40,
  player: 42,
  two: 44,
  shop: 50,
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function setVec3(target: Vec3Like, x: number, y: number, z: number): void {
  if (typeof target.set === 'function') {
    target.set(x, y, z)
  } else {
    target.x = x
    target.y = y
    target.z = z
  }
}

function setQuat(target: QuatLike, x: number, y: number, z: number, w: number): void {
  if (typeof target.set === 'function') {
    target.set(x, y, z, w)
  } else {
    target.x = x
    target.y = y
    target.z = z
    target.w = w
  }
}

export function normalizeShotId(raw: string | undefined | null): StoryShotId {
  if (raw === 'uncle' || raw === 'player' || raw === 'two' || raw === 'shop' || raw === 'wide') {
    return raw
  }
  return 'wide'
}

/**
 * 纯函数：根据表叔站位、朝向与玩家位置计算 5 种电影机位的目标位置、注视点与 FOV。
 * 表叔站在门前局部 z = 8.1（门面玻璃在 z = 7.1），因此所有沿 -fwd 的偏移均限制在安全余量内，绝不穿进玻璃幕墙。
 */
export function computeShotPose(shot: StoryShotId, anchor: ShotAnchor): ShotPose {
  const [nx, ny, nz] = anchor.npcPos
  const [hx, hy, hz] = anchor.npcHead
  const sinY = Math.sin(anchor.npcYaw)
  const cosY = Math.cos(anchor.npcYaw)
  // 局部 +Z 朝向街道前方（与 shop.group.rotation.y 一致）
  const fx = sinY
  const fz = cosY
  // 局部 +X 朝向门面右侧（东侧）
  const rx = cosY
  const rz = -sinY

  const px = anchor.playerPos ? anchor.playerPos[0] : nx + fx * 1.95 + rx * 0.25
  const pz = anchor.playerPos ? anchor.playerPos[2] : nz + fz * 1.95 + rz * 0.25
  const playerEyeY = ny + 1.54

  if (shot === 'uncle') {
    // 过肩近景特写：突出表叔神态、搭肩毛巾与右手绷带
    return {
      shot,
      position: [nx + fx * 1.48 + rx * 0.46, ny + 1.58, nz + fz * 1.48 + rz * 0.46],
      lookAt: [hx, hy - 0.05, hz],
      fov: SHOT_FOV.uncle,
    }
  }

  if (shot === 'player') {
    // 反打过肩镜头：位于表叔左肩外侧（保持在玻璃外侧），正拍玩家
    return {
      shot,
      position: [nx + fx * 0.22 - rx * 0.78, ny + 1.62, nz + fz * 0.22 - rz * 0.78],
      lookAt: [px, playerEyeY, pz],
      fov: SHOT_FOV.player,
    }
  }

  if (shot === 'two') {
    // 侧方双人中景：表叔与玩家同框形成对话张力
    const mx = (hx + px) * 0.5
    const mz = (hz + pz) * 0.5
    return {
      shot,
      position: [mx + rx * 2.35 + fx * 0.95, ny + 1.58, mz + rz * 2.35 + fz * 0.95],
      lookAt: [mx, ny + 1.48, mz],
      fov: SHOT_FOV.two,
    }
  }

  if (shot === 'shop') {
    // 门店英雄展示镜头：低仰角带出「田源米粉」杉木门楣与临街玻璃门头
    return {
      shot,
      position: [nx + fx * 5.2 - rx * 1.65, ny + 2.48, nz + fz * 5.2 - rz * 1.65],
      lookAt: [nx - fx * 1.6 + rx * 0.95, ny + 2.32, nz - fz * 1.6 + rz * 0.95],
      fov: SHOT_FOV.shop,
    }
  }

  // wide：三多路街角全景建立镜头
  const wx = nx + fx * 3.55 + rx * 1.65
  const wz = nz + fz * 3.55 + rz * 1.65
  const lx = (hx + px) * 0.45 + nx * 0.1
  const lz = (hz + pz) * 0.45 + nz * 0.1
  return {
    shot: 'wide',
    position: [wx, ny + 1.92, wz],
    lookAt: [lx, ny + 1.48, lz],
    fov: SHOT_FOV.wide,
  }
}

export function createStoryCameraController(): StoryCameraController {
  let active = false
  let currentShot: StoryShotId | null = null
  let snapshot: CameraSnapshot | null = null
  let hasBlended = false
  let restoreCount = 0

  let curPos: [number, number, number] = [0, 0, 0]
  let curLook: [number, number, number] = [0, 0, 0]
  let curFov = 50

  function applyPose(camera: CameraLike): void {
    setVec3(camera.position, curPos[0], curPos[1], curPos[2])
    if (Math.abs(camera.fov - curFov) > 1e-4) {
      camera.fov = curFov
      camera.updateProjectionMatrix()
    }
    camera.lookAt(curLook[0], curLook[1], curLook[2])
  }

  return {
    begin(camera: CameraLike): CameraSnapshot {
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

    setShot(shot: StoryShotId, anchor: ShotAnchor, camera: CameraLike): ShotPose {
      if (!active) this.begin(camera)
      const normalized = normalizeShotId(shot)
      currentShot = normalized
      const target = computeShotPose(normalized, anchor)
      if (!hasBlended) {
        // 切入首帧立即拉近 65%，确保首帧构图已明确离开玩家默认机位
        curPos = [
          lerpNum(curPos[0], target.position[0], 0.65),
          lerpNum(curPos[1], target.position[1], 0.65),
          lerpNum(curPos[2], target.position[2], 0.65),
        ]
        curLook = [...target.lookAt]
        curFov = lerpNum(curFov, target.fov, 0.65)
        hasBlended = true
      } else {
        // 机位切换时干脆切入 55%，随后由 step() 平滑阻尼收拢
        curPos = [
          lerpNum(curPos[0], target.position[0], 0.55),
          lerpNum(curPos[1], target.position[1], 0.55),
          lerpNum(curPos[2], target.position[2], 0.55),
        ]
        curLook = [
          lerpNum(curLook[0], target.lookAt[0], 0.65),
          lerpNum(curLook[1], target.lookAt[1], 0.65),
          lerpNum(curLook[2], target.lookAt[2], 0.65),
        ]
        curFov = lerpNum(curFov, target.fov, 0.55)
      }
      applyPose(camera)
      return target
    },

    step(dt: number, anchor: ShotAnchor, camera: CameraLike): ShotPose | null {
      if (!active || !currentShot) return null
      const safeDt = Math.min(0.1, Math.max(0, dt))
      const target = computeShotPose(currentShot, anchor)
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

    end(camera: CameraLike): CameraSnapshot | null {
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
