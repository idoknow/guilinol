import * as T from 'three'
import {emoteById} from './emotes.ts'

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

// In a front view the right thumb rises from its web and hooks down to the
// centre; the left follows the opposite arc. Both tips end at the sternum line.
function thumbArc(side: number, link: number) {
  const angle = ([73, -5, -79][link - 1] * Math.PI) / 180
  return V(-side * Math.cos(angle), -side * Math.sin(angle), 0)
}
const thumbJoint = (link: number, side: string) =>
  'thumb_' + (link === 4 ? '04_leaf' : '0' + link) + '_' + side

// Targets are authored in bind-space (+Z forward, +X character left), then
// converted to joint-local rotations. Apply after locomotion so feet keep their gait.
type Target = (name: string, delta: T.Quaternion, parent?: T.Quaternion) => void
function sample(poseId: number, time: number, set: Target, bind: (name: string) => T.Vector3) {
  const phase = poseId === 3 ? T.MathUtils.smoothstep(time, 2.4, 2.75) : 0
  const torso =
    poseId === 3 ? axis(1, 0, 0, (0.14 + 0.13 * Math.sin((time * Math.PI) / 0.6)) * (1 - phase)) : identity
  if (poseId === 3) set('pelvis', axis(0, 1, 0, ((-70 * Math.PI) / 180) * phase))
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
      hand = palm(s, V(0, up ? 1 : -1, 0), V(0, 0, up ? 1 : -1))
      // Place the thumb roots first, then solve the elbow around the shoulder–wrist line.
      // This keeps both thumbs together even though the two palms face opposite ways.
      set('clavicle_' + side, identity)
      const shoulder = bind('upperarm_' + side),
        elbow = bind('lowerarm_' + side),
        wrist = bind('hand_' + side)
      const thumbOffset = bind('thumb_01_' + side)
        .clone()
        .sub(wrist)
        .applyQuaternion(hand)
      const goal = V(0, 1.34, 0.3).sub(thumbOffset)
      for (let link = 1; link <= 3; link++) {
        const length = bind(thumbJoint(link + 1, side)).distanceTo(bind(thumbJoint(link, side)))
        goal.addScaledVector(thumbArc(s, link), -length)
      }
      const reach = goal.clone().sub(shoulder),
        distance = reach.length()
      reach.normalize()
      const humerus = elbow.clone().sub(shoulder),
        forearm = wrist.clone().sub(elbow)
      const along = (humerus.lengthSq() - forearm.lengthSq() + distance * distance) / (2 * distance)
      const pole = up ? V(s * 0.65, -1, 0) : V(s, 0.1, 0)
      pole.addScaledVector(reach, -pole.dot(reach)).normalize()
      const offset = reach
        .multiplyScalar(along)
        .addScaledVector(pole, Math.sqrt(Math.max(0, humerus.lengthSq() - along * along)))
      upper = new T.Quaternion().setFromUnitVectors(humerus.normalize(), offset.clone().normalize())
      lower = new T.Quaternion().setFromUnitVectors(
        forearm.normalize(),
        goal.sub(shoulder).sub(offset).normalize(),
      )
    } else {
      upper = aim(s, 0.48 * s, -0.84, 0.23).slerp(aim(s, 0.22 * s, -0.74, s === 1 ? 0.8 : 0.17), phase)
      lower = aim(s, -0.73 * s, -0.33 + 0.12 * s, 0.61).slerp(
        aim(s, -0.32 * s, s === 1 ? 0.16 : -0.36, 0.86),
        phase,
      )
      hand = palm(s, V(-s, 0.36 * s, 0), V(0, 0, -1)).slerp(palm(s, V(0, 0.2, 1), V(-s, 0, 0)), phase)
      // Local pitch relative to the turned pelvis. Equal opposite stride angles
      // balance leg extension, while the extra hip flexion offsets the bent knee.
      const thigh = axis(1, 0, 0, (-s * 0.255 - 0.18) * phase)
      const shin = axis(1, 0, 0, (-s * 0.255 + 0.06) * phase)
      set('thigh_' + side, thigh)
      set('calf_' + side, shin, thigh)
      set('foot_' + side, identity, shin)
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
                ? side === 'r'
                  ? ([88, 80, 75][i - 1] * Math.PI) / 180
                  : 1.17
                : 0.025
              : 0.26 + (s === -1 ? 0.86 : -0.23) * phase
        if (thumb) bend = 0.17
        let turn = axis(0, 0, 1, -s * bend)
        if (thumb && poseId === 1 && i === 1) {
          // Inverse palm rotation maps world up into the thumb's bind frame.
          turn = new T.Quaternion().setFromUnitVectors(
            V(s * 0.78, -0.46, 0.43).normalize(),
            V(0, 1, 0).applyQuaternion(hand.clone().invert()),
          )
        }
        const delta = parent.clone().multiply(turn)
        if (poseId === 2 && thumb) {
          const segment = bind(thumbJoint(i + 1, side))
            .clone()
            .sub(bind(thumbJoint(i, side)))
          // Maintain a consistent roll around the curved links, including at the flat end caps.
          // The two sides are point reflections at the contact, so the tip planes coincide.
          const rightBind = V(-Math.abs(segment.x), segment.y, segment.z)
          const from = palm(1, rightBind, V(0, -1, 0))
          const to = palm(1, thumbArc(-1, i), V(0, 0, 1))
          delta.copy(to).multiply(from.invert())
          if (s === 1) delta.multiply(axis(1, 0, 0, Math.PI))
        }
        if (poseId === 2 && (finger === 'index' || finger === 'middle')) {
          const convergence = finger === 'index' ? [0.118, 0.09, 0.14] : [-0.08, -0.07, -0.1]
          delta
            .copy(hand)
            .multiply(axis(0, 1, 0, s * convergence[i - 1]))
            .multiply(axis(0, 0, 1, -s * 0.025))
        }
        if (thumb && poseId === 3 && phase) {
          // Lay the closed thumb over the fingers. The blade hand keeps its thumb beside the index.
          const target =
            s === 1 ? V(s, 0.22, 0.08) : [V(s, -0.42, 0.08), V(s * 0.7, -0.43, -0.58), V(0, 0.18, -1)][i - 1]
          const tucked = new T.Quaternion().setFromUnitVectors(
            V(s * 0.76, -0.46, 0.44).normalize(),
            target.normalize(),
          )
          delta.slerp(hand.clone().multiply(tucked), phase)
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
        position: new T.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[i].clone().invert()),
        world: new T.Quaternion().setFromRotationMatrix(
          new T.Matrix4().extractRotation(mesh.skeleton.boneInverses[i].clone().invert()),
        ),
      },
    ]),
  )
  const bindPosition = (name: string) => rest.get(name)!.position
  const times: number[] = [],
    values = new Map<string, number[]>()
  const steps = id === 2 ? 1 : Math.ceil(entry.duration * 20)
  for (let i = 0; i <= steps; i++) {
    const t = (i * entry.duration) / steps
    times.push(t)
    sample(
      id,
      t,
      (name, delta, parent = identity) => {
        const joint = rest.get(name)!
        const rotation = (rest.get(joint.parent)?.world ?? identity)
          .clone()
          .invert()
          .multiply(parent.clone().invert())
          .multiply(delta)
          .multiply(joint.world)
        if (!values.has(name)) values.set(name, [])
        values.get(name)!.push(...rotation.toArray())
      },
      bindPosition,
    )
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
  // Track translations separately from mixer-owned rotations, restoring the
  // locomotion pose before each frame just like the rotation layer below.
  const pairedFingers = ['l', 'r'].flatMap((side) => {
    const hand = joints.get('hand_' + side)!.bone
    const local = new T.Matrix3().setFromMatrix4(
      mesh.skeleton.boneInverses[mesh.skeleton.bones.indexOf(hand)],
    )
    return ['index', 'middle'].map((finger) => ({
      bone: joints.get(finger + '_01_' + side)!.bone,
      base: new T.Vector3(),
      offset: V(0, 0, finger === 'index' ? -0.0037 : 0.0037).applyMatrix3(local),
    }))
  })
  const pelvis = joints.get('pelvis')!.bone,
    pelvisPosition = new T.Vector3()
  const spine = joints.get('spine_01')!.bone,
    spineRotation = new T.Quaternion()
  const pelvisBind = mesh.skeleton.boneInverses[mesh.skeleton.bones.indexOf(pelvis)]
  const waistUp = V(0, 1, 0).transformDirection(pelvisBind)
  const squatOffset = new T.Vector3(),
    toLocal = new T.Matrix3(),
    waistTurn = new T.Quaternion()
  let fingersShifted = false,
    pelvisLowered = false,
    spineTurned = false
  let active: ReturnType<typeof emoteById>,
    action: T.AnimationAction | undefined,
    weight = 0
  let targets: Array<{bone: T.Bone; sample: T.Object3D; base: T.Quaternion; applied: boolean}> = []
  function reset() {
    if (fingersShifted) {
      for (const joint of pairedFingers) joint.bone.position.copy(joint.base)
      fingersShifted = false
    }
    if (pelvisLowered) {
      pelvis.position.copy(pelvisPosition)
      pelvisLowered = false
    }
    if (spineTurned) {
      spine.quaternion.copy(spineRotation)
      spineTurned = false
    }
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
    const clip = action.getClip().name
    const finish = clip === 'emote_naiwa_laugh' ? T.MathUtils.smoothstep(action.time, 2.4, 2.75) : 0
    if (clip === 'emote_yixia_fanshang') {
      for (const joint of pairedFingers) {
        joint.base.copy(joint.bone.position)
        joint.bone.position.addScaledVector(joint.offset, weight)
      }
      fingersShifted = true
    }
    if (finish && !moving) {
      // Convert the world-space squat depth into the pelvis parent's local frame.
      pelvisPosition.copy(pelvis.position)
      pelvis.position.add(
        squatOffset
          .set(0, -0.031 * finish * weight, 0)
          .applyMatrix3(toLocal.setFromMatrix4(pelvis.parent!.matrixWorld).invert()),
      )
      pelvisLowered = true
    }
    if (finish && moving) {
      // Keep the gait's hip yaw and apply the standing turn at the waist instead.
      spineRotation.copy(spine.quaternion)
      spine.quaternion.premultiply(
        waistTurn.setFromAxisAngle(waistUp, ((-70 * Math.PI) / 180) * finish * weight),
      )
      spineTurned = true
    }
    for (const j of targets) {
      const lowerBody = /^(pelvis|thigh_|calf_|foot_)/.test(j.bone.name)
      if (lowerBody && (moving || !finish)) continue
      j.base.copy(j.bone.quaternion)
      j.applied = true
      j.bone.quaternion.slerp(
        j.sample.quaternion,
        lowerBody ? weight * T.MathUtils.smoothstep(finish, 0, 0.25) : weight,
      )
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
