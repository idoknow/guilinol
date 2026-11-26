import * as THREE from 'three'
import type {Position} from '../../traffic/sim.ts'
import type {CloseupSnapshot} from './types.ts'

export interface HandoverCloseupController {
  begin(officerPos: Position, violatorPos: Position, camera?: THREE.PerspectiveCamera | null): CloseupSnapshot
  step(dt: number, officerPos?: Position | null, violatorPos?: Position | null): CloseupSnapshot
  release(instant?: boolean): CloseupSnapshot
  getSnapshot(): CloseupSnapshot
}

function easeOutCubic(x: number): number {
  const c = Math.max(0, Math.min(1, x))
  return 1 - (1 - c) ** 3
}

/**
 * 递罚单时的双人交接特写镜头控制器：
 * - 递交瞬间平滑推近到辅警与违规骑手侧前方 45° 过肩手部特写位（FOV 收窄至 42°），突显递单与接单动作；
 * - 接单完成后平滑释放回玩家原相机位姿与视野，无头环境不依赖真实 WebGL 相机同样输出确定性轨迹。
 */
export function createHandoverCloseupController(): HandoverCloseupController {
  let active = false
  let releasing = false
  let blend = 0
  let savedCamera: THREE.PerspectiveCamera | null = null
  const savedPos = new THREE.Vector3()
  const savedQuat = new THREE.Quaternion()
  let savedFov = 55

  const lastOfficer: Position = {x: 0, y: 0, z: 0}
  const lastViolator: Position = {x: 0, y: 0, z: 1}
  const camPos = new THREE.Vector3()
  const lookAt = new THREE.Vector3()
  const tmpMat = new THREE.Matrix4()
  const tmpTargetQuat = new THREE.Quaternion()
  const upVec = new THREE.Vector3(0, 1, 0)

  function computeTargetRig(): {targetPos: THREE.Vector3; targetLook: THREE.Vector3} {
    const midX = (lastOfficer.x + lastViolator.x) * 0.5
    const midY = Math.max(lastOfficer.y, lastViolator.y) + 1.24
    const midZ = (lastOfficer.z + lastViolator.z) * 0.5

    let dx = lastViolator.x - lastOfficer.x
    let dz = lastViolator.z - lastOfficer.z
    const len = Math.hypot(dx, dz)
    if (len > 1e-4) {
      dx /= len
      dz /= len
    } else {
      dx = 0
      dz = 1
    }

    // 右侧法向 (-dz, dx) 偏移 1.38m + 略偏向辅警肩膀后侧 -0.45m，形成干净的交接特写构图
    const sideX = -dz
    const sideZ = dx
    const targetPos = new THREE.Vector3(
      midX + sideX * 1.38 - dx * 0.42,
      midY + 0.18,
      midZ + sideZ * 1.38 - dz * 0.42,
    )
    const targetLook = new THREE.Vector3(midX + dx * 0.08, midY - 0.06, midZ + dz * 0.08)
    return {targetPos, targetLook}
  }

  function applyToCamera(): CloseupSnapshot {
    const {targetPos, targetLook} = computeTargetRig()
    const eased = easeOutCubic(blend)
    const targetFov = 42

    if (savedCamera) {
      camPos.lerpVectors(savedPos, targetPos, eased)
      lookAt.copy(targetLook)
      savedCamera.position.copy(camPos)
      tmpMat.lookAt(camPos, lookAt, upVec)
      tmpTargetQuat.setFromRotationMatrix(tmpMat)
      savedCamera.quaternion.slerpQuaternions(savedQuat, tmpTargetQuat, eased)
      const nextFov = savedFov + (targetFov - savedFov) * eased
      if (Math.abs(savedCamera.fov - nextFov) > 0.01) {
        savedCamera.fov = nextFov
        savedCamera.updateProjectionMatrix()
      }
      return {
        active,
        blend: eased,
        cameraPos: {x: camPos.x, y: camPos.y, z: camPos.z},
        lookAt: {x: lookAt.x, y: lookAt.y, z: lookAt.z},
        fov: savedCamera.fov,
      }
    }

    camPos.copy(targetPos)
    lookAt.copy(targetLook)
    return {
      active,
      blend: eased,
      cameraPos: {x: camPos.x, y: camPos.y, z: camPos.z},
      lookAt: {x: lookAt.x, y: lookAt.y, z: lookAt.z},
      fov: savedFov + (targetFov - savedFov) * eased,
    }
  }

  return {
    begin(officerPos, violatorPos, camera = null) {
      lastOfficer.x = officerPos.x
      lastOfficer.y = officerPos.y
      lastOfficer.z = officerPos.z
      lastViolator.x = violatorPos.x
      lastViolator.y = violatorPos.y
      lastViolator.z = violatorPos.z

      if (camera && !active) {
        savedCamera = camera
        savedPos.copy(camera.position)
        savedQuat.copy(camera.quaternion)
        savedFov = camera.fov
      }
      active = true
      releasing = false
      blend = Math.max(blend, 0.25)
      return applyToCamera()
    },
    step(dt, officerPos, violatorPos) {
      if (officerPos) {
        lastOfficer.x = officerPos.x
        lastOfficer.y = officerPos.y
        lastOfficer.z = officerPos.z
      }
      if (violatorPos) {
        lastViolator.x = violatorPos.x
        lastViolator.y = violatorPos.y
        lastViolator.z = violatorPos.z
      }
      const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 1) : 0
      if (!active) return applyToCamera()

      if (releasing) {
        blend = Math.max(0, blend - safeDt / 0.22)
        const snap = applyToCamera()
        if (blend <= 0.001) {
          active = false
          releasing = false
          if (savedCamera) {
            savedCamera.position.copy(savedPos)
            savedCamera.quaternion.copy(savedQuat)
            savedCamera.fov = savedFov
            savedCamera.updateProjectionMatrix()
            savedCamera = null
          }
        }
        return snap
      }

      blend = Math.min(1, blend + safeDt / 0.2)
      return applyToCamera()
    },
    release(instant = false) {
      if (!active) return applyToCamera()
      if (instant) {
        blend = 0
        active = false
        releasing = false
        if (savedCamera) {
          savedCamera.position.copy(savedPos)
          savedCamera.quaternion.copy(savedQuat)
          savedCamera.fov = savedFov
          savedCamera.updateProjectionMatrix()
          savedCamera = null
        }
        return applyToCamera()
      }
      releasing = true
      return applyToCamera()
    },
    getSnapshot() {
      return applyToCamera()
    },
  }
}
