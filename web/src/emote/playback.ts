import * as T from 'three'
import {emoteById} from './emotes'

const V = (x: number, y: number, z: number) => new T.Vector3(x, y, z)
const identity = new T.Quaternion()
const axis = (x: number, y: number, z: number, a: number) =>
  new T.Quaternion().setFromAxisAngle(V(x, y, z), a)
function aim(side: number, x: number, y: number, z: number) {
  return new T.Quaternion().setFromUnitVectors(V(side, 0, 0), V(x, y, z).normalize())
}
function palm(side: number, fingers: T.Vector3, normal: T.Vector3) {
  const x = fingers.normalize().multiplyScalar(side)
  const y = normal.clone().negate()
  y.addScaledVector(x, -y.dot(x)).normalize()
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, x.clone().cross(y)))
}

// Targets are authored in bind-space (+Z forward, +X character left), then
// converted to joint-local rotations. Apply after locomotion so feet keep their gait.
type Target = (name: string, delta: T.Quaternion, parent?: T.Quaternion) => void
function sample(poseId: number, time: number, set: Target) {
  const phase = poseId === 3 ? T.MathUtils.smoothstep(time, 2.4, 2.75) : 0
  const torso =
    poseId === 3
      ? axis(0, 1, 0, -0.52 * phase).multiply(
          axis(1, 0, 0, (0.14 + 0.13 * Math.sin((time * Math.PI) / 0.6)) * (1 - phase)),
        )
      : identity
  set('spine_03', torso)
  for (const [side, s] of [
    ['l', 1],
    ['r', -1],
  ] as const) {
    let upper: T.Quaternion, lower: T.Quaternion, hand: T.Quaternion
    if (poseId === 1) {
      upper = aim(s, 0.22 * s, -0.8, 0.57)
      lower = aim(s, -0.28 * s, 0.56 + 0.035 * Math.sin(time * 5), 0.78)
      hand = palm(s, V(0, 0, 1), V(-s, 0, 0))
    } else if (poseId === 2) {
      const up = s === -1
      upper = aim(s, 0.19 * s, -0.94, 0.26)
      lower = aim(s, (up ? 0.15 : 0.23) * s, up ? 0.88 : -0.97, up ? 0.45 : 0.1)
      hand = palm(s, V(0, up ? 1 : -1, 0), V(0, 0, up ? 1 : -1))
    } else {
      upper = aim(s, 0.48 * s, -0.84, 0.23).slerp(aim(s, 0.22 * s, -0.74, s === 1 ? 0.8 : 0.17), phase)
      lower = aim(s, -0.73 * s, -0.33 + 0.12 * s, 0.61).slerp(
        aim(s, -0.32 * s, s === 1 ? 0.16 : -0.36, 0.86),
        phase,
      )
      hand = palm(s, V(-s, 0.36 * s, 0), V(0, 0, -1)).slerp(palm(s, V(0, 0.2, 1), V(-s, 0, 0)), phase)
      set('thigh_' + side, axis(1, 0, 0, -s * 0.19 * phase))
    }
    set('upperarm_' + side, upper, torso)
    set('lowerarm_' + side, lower, upper)
    set('hand_' + side, hand, lower)
    for (const finger of ['index', 'middle', 'ring', 'pinky', 'thumb']) {
      const thumb = finger === 'thumb'
      let parent = hand
      for (let i = 1; i <= 3; i++) {
        let bend =
          poseId === 1
            ? 1.16
            : poseId === 2
              ? ['ring', 'pinky'].includes(finger)
                ? 1.17
                : 0.025
              : 0.26 + (s === -1 ? 0.86 : -0.23) * phase
        if (thumb) bend = poseId === 2 ? (s === -1 ? 0.42 : 0.12) : 0.17
        let turn = axis(0, 0, 1, -s * bend)
        if (thumb && poseId === 1 && i === 1) {
          // Inverse palm rotation maps world up into the thumb's bind frame.
          turn = new T.Quaternion().setFromUnitVectors(
            V(s * 0.78, -0.46, 0.43).normalize(),
            V(0, 1, 0).applyQuaternion(hand.clone().invert()),
          )
        }
        if (poseId === 2 && i === 1 && !thumb && ['index', 'middle'].includes(finger))
          turn.multiply(axis(0, 1, 0, s * (finger === 'index' ? 0.08 : -0.05)))
        const delta = parent.clone().multiply(turn)
        if (thumb && poseId === 3 && phase) {
          // Lay the closed thumb over the fingers. The blade hand keeps its thumb beside the index.
          const target = s === 1 ? V(s, 0.22, 0.08) : [V(s, -0.42, 0.08), V(s*.7, -.43, -.58), V(0, .18, -1)][i-1]
          const tucked = new T.Quaternion().setFromUnitVectors(V(s*.76, -.46, .44).normalize(), target.normalize())
          delta.slerp(hand.clone().multiply(tucked),phase)
        }
        set(finger + '_0' + i + '_' + side, delta, parent)
        parent = delta
      }
    }
  }
}

// The three figures share bind transforms. Bake once, then let each character's
// existing mixer interpolate these tracks on a private pose buffer.
const clips = new Map<number, T.AnimationClip>()
function clipFor(id: number, mesh: T.SkinnedMesh) {
  const existing = clips.get(id)
  if (existing) return existing
  const entry = emoteById(id)!
  const rest = new Map(
    mesh.skeleton.bones.map((bone, i) => [
      bone.name,
      {
        parent: bone.parent!.name,
        world: new T.Quaternion().setFromRotationMatrix(
          new T.Matrix4().extractRotation(mesh.skeleton.boneInverses[i].clone().invert()),
        ),
      },
    ]),
  )
  const times: number[] = [],
    values = new Map<string, number[]>()
  const steps = id === 2 ? 1 : Math.ceil(entry.duration * 20)
  for (let i = 0; i <= steps; i++) {
    const t = (i * entry.duration) / steps
    times.push(t)
    sample(id, t, (name, delta, parent = identity) => {
      const joint = rest.get(name)!
      const rotation = (rest.get(joint.parent)?.world ?? identity)
        .clone()
        .invert()
        .multiply(parent.clone().invert())
        .multiply(delta)
        .multiply(joint.world)
      if (!values.has(name)) values.set(name, [])
      values.get(name)!.push(...rotation.toArray())
    })
  }
  const tracks = Array.from(
    values,
    ([name, quats]) => new T.QuaternionKeyframeTrack(name + '.quaternion', times, quats),
  )
  const clip = new T.AnimationClip('emote_' + entry.key, entry.duration, tracks).optimize()
  clips.set(id, clip)
  return clip
}

export function emotePlayback(
  root: T.Object3D,
  onChange?: (id: number) => void,
  characterMixer?: T.AnimationMixer,
) {
  const mesh = root.getObjectByProperty('isSkinnedMesh', true) as T.SkinnedMesh
  const buffer = new T.Group(),
    mixer = characterMixer ?? new T.AnimationMixer(buffer)
  const joints = new Map(
    mesh.skeleton.bones.map((bone) => {
      const sample = new T.Object3D()
      sample.name = bone.name
      buffer.add(sample)
      return [bone.name, {bone, sample, base: bone.quaternion.clone(), applied: false}]
    }),
  )
  let active: ReturnType<typeof emoteById>,
    action: T.AnimationAction | undefined,
    weight = 0
  let targets: Array<{bone: T.Bone; sample: T.Object3D; base: T.Quaternion; applied: boolean}> = []
  function reset() {
    for (const j of targets)
      if (j.applied) {
        j.bone.quaternion.copy(j.base)
        j.applied = false
      }
  }
  function stop() {
    if (active) {
      active = undefined
      onChange?.(0)
    }
  }
  function play(next: number, elapsed = 0) {
    const entry = emoteById(next)
    if (!entry) return
    reset()
    action?.stop()
    const clip = clipFor(next, mesh)
    targets = clip.tracks.map((track) => joints.get(track.name.split('.')[0])!)
    active = entry
    weight = 0
    action = mixer.clipAction(clip, buffer).reset().setLoop(T.LoopOnce, 1)
    action.clampWhenFinished = true
    action.time = elapsed
    action.play()
    onChange?.(next)
  }
  function tick(dt: number, moving: boolean) {
    if (!action) return
    if (!characterMixer) mixer.update(dt)
    if (active && action.time >= active.duration) stop()
    weight = T.MathUtils.clamp(weight + ((active ? 1 : -1) * dt) / 0.24, 0, 1)
    const laughing = active?.id === 3 && action.time < 2.75
    const face = root.getObjectByName('rest-face'),
      laugh = root.getObjectByName('laugh-face')
    if (face && laugh) {
      face.visible = !laughing
      laugh.visible = laughing
    }
    if (!weight) {
      action.stop()
      action = undefined
      return
    }
    for (const j of targets) {
      if (moving && j.bone.name.startsWith('thigh_')) continue
      j.base.copy(j.bone.quaternion)
      j.applied = true
      j.bone.quaternion.slerp(j.sample.quaternion, weight)
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
