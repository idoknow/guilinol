import * as T from 'three'
import {emoteById} from './emotes.ts'
import {sampleDuty} from './duty.ts'
import {emoteFace, faceAt, type FaceCue} from './face.ts'
import {laugh} from './laugh.ts'
import {identity, type Target} from './rig.ts'
import {seal} from './seal.ts'
import {thumbsUp} from './thumbs-up.ts'
import type {Choreo, Extras} from './presets.ts'

// Wheel emotes are authored as full-body choreography (see thumbs-up.ts, seal.ts,
// laugh.ts); duty gestures keep their original sampler. Targets are authored in
// bind-space (+Z forward, +X character left), converted to joint-local rotations and
// baked once; each character's mixer then interpolates them on a private pose buffer.

const CHOREO: Partial<Record<number, Choreo>> = {1: thumbsUp, 2: seal, 3: laugh}
const NO_FACE: readonly FaceCue[] = []

// Side channels baked next to the clip: yaw, pelvis offset xyz, seal squeeze, core weight.
const CH = 6
const YAW = 0,
  OFFSET = 1,
  SEAL = 4,
  CORE = 5

interface Baked {
  clip: T.AnimationClip
  channels: Float32Array
  steps: number
  duration: number
  face: readonly FaceCue[]
}

// The three figures share bind transforms, so one bake serves every character.
const baked = new Map<number, Baked>()
function bake(id: number, mesh: T.SkinnedMesh): Baked {
  const existing = baked.get(id)
  if (existing) return existing
  const entry = emoteById(id)!
  const rest = new Map(
    mesh.skeleton.bones.map((bone, i) => [
      bone.name,
      {
        parent: bone.parent!.name,
        position: new T.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[i].clone().invert()),
        world: new T.Quaternion().setFromRotationMatrix(
          new T.Matrix4().extractRotation(mesh.skeleton.boneInverses[i].clone().invert()),
        ),
      },
    ]),
  )
  const bind = (name: string) => rest.get(name)!.position.clone()
  const choreo = CHOREO[id]
  // 30 fps keeps snaps, overshoots and beats crisp; duty gestures keep their original 20 fps.
  const steps = Math.ceil(entry.duration * (choreo ? 30 : 20))
  const times: number[] = [],
    values = new Map<string, number[]>()
  const channels = new Float32Array((steps + 1) * CH)
  const extras: Extras = {yaw: 0, offset: new T.Vector3(), seal: 0, core: 1}
  const set: Target = (name, delta, parent = identity) => {
    const joint = rest.get(name)!
    const rotation = (rest.get(joint.parent)?.world ?? identity)
      .clone()
      .invert()
      .multiply(parent.clone().invert())
      .multiply(delta)
      .multiply(joint.world)
    if (!values.has(name)) values.set(name, [])
    values.get(name)!.push(...rotation.toArray())
  }
  for (let i = 0; i <= steps; i++) {
    const t = (i * entry.duration) / steps
    times.push(t)
    extras.yaw = extras.seal = 0
    extras.core = 1
    extras.offset.set(0, 0, 0)
    if (choreo) choreo.sample(t, set, bind, extras)
    else sampleDuty(id as 4 | 5 | 6, t, set, bind)
    channels.set([extras.yaw, extras.offset.x, extras.offset.y, extras.offset.z, extras.seal, extras.core], i * CH)
  }
  for (const [name, quats] of values)
    if (quats.length !== times.length * 4) throw new Error(`emote ${entry.key}: ${name} keyed ${quats.length / 4}/${times.length}`)
  const tracks = Array.from(values, ([name, quats]) => new T.QuaternionKeyframeTrack(name + '.quaternion', times, quats))
  const result: Baked = {
    clip: new T.AnimationClip('emote_' + entry.key, entry.duration, tracks).optimize(),
    channels,
    steps,
    duration: entry.duration,
    face: choreo?.face ?? NO_FACE,
  }
  baked.set(id, result)
  return result
}

const LOWER_BODY = /^(pelvis|thigh_|calf_|foot_|ball_)/

interface Joint {
  bone: T.Bone
  sample: T.Object3D
  base: T.Quaternion
  applied: boolean
  /** Skipped while walking so the gait keeps the legs. */
  lower: boolean
  /** Scaled by the CORE channel. */
  core: boolean
}

export function emotePlayback(root: T.Object3D, onChange?: (id: number) => void, characterMixer?: T.AnimationMixer) {
  const mesh = root.getObjectByProperty('isSkinnedMesh', true) as T.SkinnedMesh
  const buffer = new T.Group(),
    mixer = characterMixer ?? new T.AnimationMixer(buffer)
  const joints = new Map<string, Joint>(
    mesh.skeleton.bones.map((bone) => {
      const sample = new T.Object3D()
      sample.name = bone.name
      buffer.add(sample)
      return [
        bone.name,
        {
          bone,
          sample,
          base: bone.quaternion.clone(),
          applied: false,
          lower: LOWER_BODY.test(bone.name),
          core: bone.name === 'spine_01' || bone.name === 'spine_02',
        },
      ]
    }),
  )
  // Track translations separately from mixer-owned rotations, restoring the
  // locomotion pose before each frame just like the rotation layer below.
  const pairedFingers = ['l', 'r'].flatMap((side) => {
    const hand = joints.get('hand_' + side)!.bone
    const local = new T.Matrix3().setFromMatrix4(mesh.skeleton.boneInverses[mesh.skeleton.bones.indexOf(hand)])
    return ['index', 'middle'].map((finger) => ({
      bone: joints.get(finger + '_01_' + side)!.bone,
      base: new T.Vector3(),
      offset: new T.Vector3(0, 0, finger === 'index' ? -0.0037 : 0.0037).applyMatrix3(local),
    }))
  })
  const pelvis = joints.get('pelvis')!.bone,
    pelvisBase = new T.Vector3()
  const spines = (['spine_01', 'spine_02', 'spine_03'] as const).map((name) => {
    const j = joints.get(name)!
    const idx = mesh.skeleton.bones.indexOf(j.bone)
    return {
      joint: j,
      up: new T.Vector3(0, 1, 0).transformDirection(mesh.skeleton.boneInverses[idx]).normalize(),
    }
  })
  const SPINE_YAW_SHARES = [0.38, 0.34, 0.28] as const
  // Bind space → world is meshWorld · bindMatrix⁻¹; pelvis offsets are authored in bind space.
  const unbind = new T.Matrix3().setFromMatrix4(mesh.bindMatrix).invert()
  const toLocal = new T.Matrix3(),
    meshWorld = new T.Matrix3(),
    shift = new T.Vector3(),
    waistTurn = new T.Quaternion()
  const face = emoteFace(root)
  let fingersShifted = false,
    pelvisMoved = false
  let active: ReturnType<typeof emoteById>,
    action: T.AnimationAction | undefined,
    meta: Baked | undefined,
    weight = 0,
    stand = -1
  let targets: Joint[] = []

  function reset() {
    if (fingersShifted) {
      for (let k = 0; k < pairedFingers.length; k++) pairedFingers[k].bone.position.copy(pairedFingers[k].base)
      fingersShifted = false
    }
    if (pelvisMoved) {
      pelvis.position.copy(pelvisBase)
      pelvisMoved = false
    }
    for (let k = 0; k < targets.length; k++) {
      const j = targets[k]
      if (j.applied) {
        j.bone.quaternion.copy(j.base)
        j.applied = false
      }
    }
    if (!active) face.sync('base')
  }
  function stop() {
    if (active) {
      active = undefined
      face.sync('base')
      onChange?.(0)
    }
  }
  function play(next: number, elapsed = 0) {
    const entry = emoteById(next)
    if (!entry) return
    reset()
    action?.stop()
    meta = bake(next, mesh)
    targets = meta.clip.tracks.map((track) => joints.get(track.name.split('.')[0])!)
    active = entry
    weight = 0
    stand = -1
    face.rescan()
    action = mixer.clipAction(meta.clip, buffer).reset().setLoop(T.LoopOnce, 1)
    action.clampWhenFinished = true
    action.time = elapsed
    action.play()
    onChange?.(next)
  }
  function tick(dt: number, moving: boolean) {
    if (!action || !meta) return
    if (!characterMixer) mixer.update(dt)
    if (active && action.time >= active.duration) stop()
    weight = T.MathUtils.clamp(weight + ((active ? 1 : -1) * dt) / 0.24, 0, 1)
    // Standing share of the lower body, eased so starting to walk mid-laugh never pops.
    const goal = moving ? 0 : 1
    stand = stand < 0 ? goal : stand + T.MathUtils.clamp(goal - stand, -dt / 0.25, dt / 0.25)
    face.sync(active ? faceAt(meta.face, action.time) : 'base')
    if (!weight) {
      action.stop()
      action = undefined
      return
    }
    const c = meta.channels,
      u = T.MathUtils.clamp(action.time / meta.duration, 0, 1) * meta.steps
    const i0 = Math.min(Math.floor(u), meta.steps) * CH,
      i1 = Math.min(Math.floor(u) + 1, meta.steps) * CH,
      f = u - Math.floor(u)
    const squeeze = channel(c, i0, i1, f, SEAL),
      core = channel(c, i0, i1, f, CORE),
      legs = weight * stand
    if (squeeze > 0) {
      for (let k = 0; k < pairedFingers.length; k++) {
        const joint = pairedFingers[k]
        joint.base.copy(joint.bone.position)
        joint.bone.position.addScaledVector(joint.offset, weight * squeeze)
      }
      fingersShifted = true
    }
    if (legs > 0) {
      shift.set(channel(c, i0, i1, f, OFFSET), channel(c, i0, i1, f, OFFSET + 1), channel(c, i0, i1, f, OFFSET + 2))
      if (shift.lengthSq() > 0) {
        // Bind-space pelvis offset → pelvis parent's local frame.
        toLocal
          .setFromMatrix4(pelvis.parent!.matrixWorld)
          .invert()
          .multiply(meshWorld.setFromMatrix4(mesh.matrixWorld))
          .multiply(unbind)
        pelvisBase.copy(pelvis.position)
        pelvis.position.add(shift.multiplyScalar(legs).applyMatrix3(toLocal))
        pelvisMoved = true
      }
    }
    for (let k = 0; k < targets.length; k++) {
      const j = targets[k]
      let w = weight
      if (j.lower) {
        if (legs <= 0) continue
        w = legs
      } else if (j.core) w *= core
      if (w <= 0) continue
      j.base.copy(j.bone.quaternion)
      j.applied = true
      j.bone.quaternion.slerp(j.sample.quaternion, w)
    }
    // Walking keeps the gait's hips, so cap the body turn (~36°) and split it evenly
    // across all three spine segments to avoid pinching/tearing the waist skin.
    const rawTurn = channel(c, i0, i1, f, YAW) * weight * (1 - stand)
    if (rawTurn) {
      const walkTurn = T.MathUtils.clamp(rawTurn * 0.62, -0.62, 0.62)
      for (let s = 0; s < spines.length; s++) {
        const sp = spines[s]
        if (sp.joint.applied) sp.joint.bone.quaternion.premultiply(waistTurn.setFromAxisAngle(sp.up, walkTurn * SPINE_YAW_SHARES[s]))
      }
    }
  }
  return {
    play,
    stop,
    reset,
    tick,
    get id() {
      return active?.id ?? 0
    },
    get clip() {
      return active ? action?.getClip().name : ''
    },
  }
}

function channel(c: Float32Array, i0: number, i1: number, f: number, k: number) {
  return c[i0 + k] + (c[i1 + k] - c[i0 + k]) * f
}
