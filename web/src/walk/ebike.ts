import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {shareAtmosphere} from '../look/atmosphere'
import {avatar} from '../look/avatar'
import {loadAtlas, type Atlas} from '../map/atlas'
import type {Manifest} from '../world'
import {walkConfig as cfg} from './config'
import type {createPhysics} from './physics'

type Sim = Awaited<ReturnType<typeof createPhysics>>

export const EBIKE_MOUNT_RADIUS = 3.5
export const EBIKE_MAX_SPEED = 25 / 3.6       // 6.944 m/s (~25.0 km/h on paved roads & bridges)
export const EBIKE_OFFROAD_SPEED = 17 / 3.6   // 4.722 m/s (~17.0 km/h off-road)
const EBIKE_REVERSE_SPEED = -2.2

interface ParkedSpot {
  x: number
  y: number
  z: number
  yaw: number
  snapped: boolean
  tint: number
}

// Initial parked e-bikes near Wangcheng Zhengyang Gate spawn, Shizijie (十字街), Jiefang Bridge, and scenic entrances.
const INITIAL_SPOTS: Omit<ParkedSpot, 'y' | 'snapped'>[] = [
  // Near default walk spawn (Wangcheng Gate: -588, -212)
  {x: -590.8, z: -210.5, yaw: -0.16, tint: 0xf7f5ef},
  {x: -594.0, z: -211.2, yaw: -0.16, tint: 0xc4ded8},
  {x: -585.0, z: -203.5, yaw: -1.71, tint: 0xcbd8e4},
  // Shizijie intersection (十字街: 中山中路 × 解放东/西路, around -881, -165)
  {x: -871.5, z: -154.0, yaw: -2.75, tint: 0xf7f5ef},
  {x: -890.5, z: -154.5, yaw:  2.79, tint: 0xe6d0c2},
  {x: -871.0, z: -176.0, yaw: -1.03, tint: 0xc4ded8},
  {x: -891.0, z: -175.5, yaw:  1.36, tint: 0xcbd8e4},
  {x: -886.0, z: -192.0, yaw: -2.75, tint: 0xf7f5ef},
  // Jiefang Bridge west approach (解放桥西桥头, for bridge crossing)
  {x: -311.5, z:   -2.2, yaw: -1.90, tint: 0xc4ded8},
  {x: -315.0, z:   -4.0, yaw: -1.90, tint: 0xf7f5ef},
  // Palace & Elephant Hill walk endpoints
  {x: -493.0, z: -487.0, yaw: -0.15, tint: 0xe6d0c2},
  {x: -959.0, z: 1094.0, yaw: -0.28, tint: 0xcbd8e4},
]

interface RiderJoints {
  hips?: THREE.Object3D
  torso?: THREE.Object3D
  head?: THREE.Object3D
  thighL?: THREE.Object3D
  thighR?: THREE.Object3D
  shinL?: THREE.Object3D
  shinR?: THREE.Object3D
  armL?: THREE.Object3D
  armR?: THREE.Object3D
  foreL?: THREE.Object3D
  foreR?: THREE.Object3D
  hipsRestY: number
}

function bindRiderJoints(figure: THREE.Object3D): RiderJoints {
  const byName = new Map<string, THREE.Object3D>()
  figure.traverse(n => { if (n.name) byName.set(n.name, n) })
  const hips = byName.get('Hips')
  return {
    hips,
    torso: byName.get('Torso'),
    head: byName.get('Head'),
    thighL: byName.get('ThighL'),
    thighR: byName.get('ThighR'),
    shinL: byName.get('ShinL'),
    shinR: byName.get('ShinR'),
    armL: byName.get('ArmL'),
    armR: byName.get('ArmR'),
    foreL: byName.get('ForearmL'),
    foreR: byName.get('ForearmR'),
    hipsRestY: hips?.position.y ?? 0.92,
  }
}

export async function createEbikeSystem(scene: THREE.Scene, manifest: Manifest, sim: Sim, figure: THREE.Object3D) {
  const [gltf, atlasLoaded] = await Promise.all([
    new GLTFLoader().loadAsync('./avatar/ebike.glb'),
    loadAtlas(manifest).catch(() => null as Atlas | null),
  ])
  const atlas = atlasLoaded

  let srcGeom: THREE.BufferGeometry | null = null
  gltf.scene.traverse(node => {
    if (node instanceof THREE.Mesh && !srcGeom) srcGeom = node.geometry.clone()
  })
  if (!srcGeom) throw Error('Missing EbikeMesh in ebike.glb')
  const geometry = srcGeom as THREE.BufferGeometry

  // Split VEC4 COLOR_0 into RGB vertex color + scalar aLamp attribute so standard InstancedMesh tinting works cleanly
  const colAttr = geometry.getAttribute('color')
  const count = colAttr.count
  const rgb = new Float32Array(count * 3)
  const lamp = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    rgb[i * 3] = colAttr.getX(i)
    rgb[i * 3 + 1] = colAttr.getY(i)
    rgb[i * 3 + 2] = colAttr.getZ(i)
    lamp[i] = colAttr.itemSize >= 4 ? colAttr.getW(i) : 0
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(rgb, 3))
  geometry.setAttribute('aLamp', new THREE.BufferAttribute(lamp, 1))

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.78,
    metalness: 0.06,
  })
  material.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shareAtmosphere(shader)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLamp;\nvarying float vLamp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLamp = aLamp;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vLamp;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { float head = step(0.75, vLamp);
        float tail = step(0.25, vLamp) * (1.0 - head);
        totalEmissiveRadiance += vec3(1.0, 0.88, 0.58) * head * (0.22 + 2.2 * uNight)
                               + vec3(0.95, 0.18, 0.14) * tail * (0.18 + 1.4 * uNight); }`)
  }
  material.customProgramCacheKey = () => 'guilinol-ebike-instanced'

  const spots: ParkedSpot[] = INITIAL_SPOTS.map(s => ({...s, y: 150.0, snapped: false}))
  const instanced = new THREE.InstancedMesh(geometry, material, spots.length)
  instanced.name = '小电驴'
  instanced.frustumCulled = false

  const dummy = new THREE.Object3D()
  const color = new THREE.Color()
  spots.forEach((spot, i) => {
    color.setHex(spot.tint)
    instanced.setColorAt(i, color)
  })
  if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true
  scene.add(instanced)

  const joints = bindRiderJoints(figure)
  const euler = new THREE.Euler(0, 0, 0, 'YXZ')

  let activeIndex = -1
  let speed = 0
  let steerVisual = 0
  let rollVisual = 0
  let lastRoadName: string | null = null

  function refreshInstance(index: number, roll = 0, pitch = 0) {
    const s = spots[index]
    dummy.position.set(s.x, s.y, s.z)
    euler.set(pitch, s.yaw, roll, 'YXZ')
    dummy.quaternion.setFromEuler(euler)
    dummy.scale.setScalar(1)
    dummy.updateMatrix()
    instanced.setMatrixAt(index, dummy.matrix)
  }

  function snapParkedNear(px: number, pz: number) {
    let dirty = false
    for (let i = 0; i < spots.length; i++) {
      if (i === activeIndex) continue
      const s = spots[i]
      if (!s.snapped && Math.hypot(px - s.x, pz - s.z) < 280) {
        const sup = sim.surface(s.x, s.z, 'deck') ?? sim.surface(s.x, s.z, 'sidewalk') ?? sim.surface(s.x, s.z, 'ground')
        if (sup) {
          s.y = sup.y
          s.snapped = true
          refreshInstance(i)
          dirty = true
        }
      } else if (!s.snapped) {
        refreshInstance(i)
        dirty = true
      }
    }
    if (dirty) instanced.instanceMatrix.needsUpdate = true
  }

  function applySeatedPose(bikeX: number, bikeY: number, bikeZ: number, yaw: number) {
    figure.position.set(bikeX, bikeY, bikeZ)
    euler.set(0, yaw + avatar.yaw, rollVisual * 0.85, 'YXZ')
    figure.quaternion.setFromEuler(euler)
    if (joints.hips) joints.hips.position.set(0, 0.67, 0.22)
    if (joints.torso) joints.torso.rotation.set(-0.11, 0, 0)
    if (joints.head) joints.head.rotation.set(0.06, steerVisual * 0.25, 0)
    if (joints.thighL) joints.thighL.rotation.set(1.26, 0, -0.11)
    if (joints.thighR) joints.thighR.rotation.set(1.26, 0,  0.11)
    if (joints.shinL) joints.shinL.rotation.set(-1.22, 0, 0)
    if (joints.shinR) joints.shinR.rotation.set(-1.22, 0, 0)
    if (joints.armL) joints.armL.rotation.set(0.84, 0, -0.07)
    if (joints.armR) joints.armR.rotation.set(0.84, 0,  0.07)
    if (joints.foreL) joints.foreL.rotation.set(0.36, 0, 0)
    if (joints.foreR) joints.foreR.rotation.set(0.36, 0, 0)
  }

  function resetStandingPose() {
    figure.rotation.set(0, figure.rotation.y, 0)
    if (joints.hips) joints.hips.position.set(0, joints.hipsRestY, 0)
    for (const part of [joints.torso, joints.head, joints.thighL, joints.thighR, joints.shinL, joints.shinR, joints.armL, joints.armR, joints.foreL, joints.foreR]) {
      part?.rotation.set(0, 0, 0)
    }
  }

  function nearestIndex(x: number, z: number, maxDist = EBIKE_MOUNT_RADIUS): number {
    let best = -1
    let bestDist = maxDist
    for (let i = 0; i < spots.length; i++) {
      const d = Math.hypot(x - spots[i].x, z - spots[i].z)
      if (d <= bestDist) {
        bestDist = d
        best = i
      }
    }
    return best
  }

  function mount(playerX: number, playerZ: number): number | null {
    if (activeIndex >= 0) return null
    snapParkedNear(playerX, playerZ)
    const idx = nearestIndex(playerX, playerZ)
    if (idx < 0) return null
    const spot = spots[idx]
    const sup = sim.surface(spot.x, spot.z, 'deck') ?? sim.surface(spot.x, spot.z, 'sidewalk') ?? sim.surface(spot.x, spot.z, 'ground')
    const footY = sup ? sup.y : spot.y
    const targetPos = {x: spot.x, y: footY + cfg.height / 2 + 0.055, z: spot.z}
    sim.body.setTranslation(targetPos, true)
    sim.body.setNextKinematicTranslation(targetPos)
    sim.world.step()
    spot.y = footY
    spot.snapped = true
    activeIndex = idx
    speed = 0
    steerVisual = 0
    rollVisual = 0
    applySeatedPose(spot.x, spot.y, spot.z, spot.yaw)
    refreshInstance(idx)
    instanced.instanceMatrix.needsUpdate = true
    return spot.yaw
  }

  function dismount(): boolean {
    if (activeIndex < 0) return false
    const idx = activeIndex
    const spot = spots[idx]
    const pos = sim.body.translation()
    const footY = pos.y - cfg.height / 2
    spot.x = pos.x
    spot.y = footY
    spot.z = pos.z
    spot.snapped = true
    refreshInstance(idx, 0, 0)
    instanced.instanceMatrix.needsUpdate = true

    // Step slightly to the left of the scooter if clear so the rider stands beside it
    const sideX = pos.x - Math.cos(spot.yaw) * 0.62
    const sideZ = pos.z + Math.sin(spot.yaw) * 0.62
    const found = sim.findWalkableSpawn(sideX, sideZ, true) ?? sim.findWalkableSpawn(pos.x, pos.z, true)
    if (found) {
      sim.body.setTranslation(found, true)
      sim.body.setNextKinematicTranslation(found)
      sim.world.step()
    }
    activeIndex = -1
    speed = 0
    steerVisual = 0
    rollVisual = 0
    resetStandingPose()
    return true
  }

  return {
    get riding() { return activeIndex >= 0 },
    get speed() { return speed },
    get road() { return lastRoadName },
    get spots() { return spots },
    canMount(x: number, z: number) {
      if (activeIndex >= 0) return false
      snapParkedNear(x, z)
      return nearestIndex(x, z) >= 0
    },
    mount,
    dismount,
    syncParked(x: number, z: number) {
      snapParkedNear(x, z)
    },
    stepRide(
      dt: number,
      keys: {right: number; forward: number; jump: boolean; brake?: boolean},
      external: {x: number; z: number; run: boolean} | null,
      yawIn: number,
      velocityIn: number,
      safe: THREE.Vector3,
      verify: boolean,
      onRescue: () => void,
    ) {
      let yaw = yawIn
      let velocity = velocityIn
      const lastHits: string[] = []
      let blockedWater = false
      const step = 1 / 60
      let acc = Math.min(0.12, dt)

      while (acc >= step) {
        acc -= step
        const pos = sim.body.translation()
        const onDeck = sim.surface(pos.x, pos.z, 'deck')
        const roadHit = atlas?.roadAt(pos.x, pos.z, 15) ?? null
        lastRoadName = roadHit ? (roadHit.name || '路面') : (onDeck ? '桥面' : null)
        const maxFwd = (roadHit || onDeck) ? EBIKE_MAX_SPEED : EBIKE_OFFROAD_SPEED

        let throttle = keys.forward
        let steerInput = -keys.right
        let brake = keys.brake ?? keys.jump

        if (external) {
          const mag = Math.hypot(external.x, external.z)
          if (mag > 0.02) {
            const targetYaw = Math.atan2(-external.x, -external.z)
            let diff = targetYaw - yaw
            while (diff > Math.PI) diff -= Math.PI * 2
            while (diff < -Math.PI) diff += Math.PI * 2
            steerInput = THREE.MathUtils.clamp(diff * 2.8, -1, 1)
            throttle = Math.cos(Math.min(Math.PI * 0.45, Math.abs(diff))) * Math.min(1, mag)
            brake = false
          } else {
            throttle = 0
            steerInput = 0
            brake = true
          }
        }

        if (brake) {
          const drop = 18.0 * step
          speed = Math.abs(speed) <= drop ? 0 : speed - Math.sign(speed) * drop
        } else if (throttle > 0.05) {
          if (speed < 0) speed = Math.min(0, speed + 16.0 * step)
          else speed = Math.min(maxFwd * Math.min(1, throttle), speed + 8.5 * throttle * step)
        } else if (throttle < -0.05) {
          if (speed > 0.15) speed = Math.max(0, speed + 15.0 * throttle * step)
          else speed = Math.max(EBIKE_REVERSE_SPEED, speed + 4.5 * throttle * step)
        } else {
          // Natural rolling resistance + speed cap transition when leaving road
          const drag = 4.2 * step
          speed = Math.abs(speed) <= drag ? 0 : speed - Math.sign(speed) * drag
        }
        if (speed > maxFwd) speed = Math.max(maxFwd, speed - 6.0 * step)

        // Turn yaw only when moving (or when external autopilot aligns heading)
        const moveFactor = external ? 1.0 : THREE.MathUtils.clamp(Math.abs(speed) / 1.4, 0, 1)
        const dirSign = speed < -0.15 && !external ? -1 : 1
        const turnRate = 2.35
        yaw += steerInput * turnRate * moveFactor * dirSign * step

        steerVisual = THREE.MathUtils.lerp(steerVisual, steerInput, 10 * step)
        const targetRoll = THREE.MathUtils.clamp(steerInput * (speed / EBIKE_MAX_SPEED) * 0.18, -0.18, 0.18)
        rollVisual = THREE.MathUtils.lerp(rollVisual, targetRoll, 9 * step)

        const vx = -Math.sin(yaw) * speed
        const vz = -Math.cos(yaw) * speed
        velocity += cfg.gravity * step

        sim.controller.computeColliderMovement(sim.capsule, {x: vx * step, y: velocity * step, z: vz * step})
        const move = sim.controller.computedMovement()
        const next = {x: pos.x + move.x, y: pos.y + move.y, z: pos.z + move.z}
        const grounded = sim.controller.computedGrounded()
        if (grounded && velocity < 0) velocity = 0

        let hitSolid = false
        for (let at = 0; at < sim.controller.numComputedCollisions(); at++) {
          const coll = sim.controller.computedCollision(at)?.collider
          if (!coll) continue
          const kind = sim.kinds.get(coll.handle) ?? ''
          if (verify) lastHits.push(kind)
          if (kind === 'building' || kind === 'peak' || kind === 'rail' || kind === 'tree') {
            hitSolid = true
          }
        }

        const commandedHoriz = Math.abs(speed) * step
        const actualHoriz = Math.hypot(move.x, move.z)
        if (hitSolid && commandedHoriz > 1e-4 && actualHoriz < commandedHoriz * 0.55) {
          // Clean crash-stop on hitting building, cliff, railing, or trunk
          speed = 0
        }

        const ground = sim.surface(next.x, next.z, 'ground')
        if (!ground || next.y - cfg.height / 2 < ground.y - 3) {
          speed = 0
          onRescue()
          break
        }
        if (sim.wet(next.x, next.z)) {
          const deck = sim.surface(next.x, next.z, 'deck')
          if (!deck || next.y - cfg.height / 2 < deck.y - 0.35) {
            next.x = pos.x
            next.z = pos.z
            speed = 0
            blockedWater = true
          }
        }

        sim.body.setNextKinematicTranslation(next)
        sim.world.step()
        if (grounded && !blockedWater) safe.set(next.x, next.y, next.z)
      }

      if (activeIndex >= 0) {
        const pos = sim.body.translation()
        const footY = pos.y - cfg.height / 2
        const spot = spots[activeIndex]
        spot.x = pos.x
        spot.y = footY
        spot.z = pos.z
        spot.yaw = yaw
        refreshInstance(activeIndex, rollVisual, 0)
        instanced.instanceMatrix.needsUpdate = true
        applySeatedPose(pos.x, footY, pos.z, yaw)
      }

      return {yaw, velocity, hits: lastHits, blockedWater}
    },
  }
}
