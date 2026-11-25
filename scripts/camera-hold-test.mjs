import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {AnimationMixer, MathUtils, Matrix4, Quaternion, Vector3} from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {bindRotation, cameraAnchorLocalPose, cameraHoldLayer, DEFAULT_CAMERA_HOLD_AIM} from '../web/src/walk/camera-hold.ts'

test('a camera grip survives ten gait cycles with natural wrist/fingers and releases cleanly', async () => {
  const data = await readFile(new URL('../public/avatar/figure.glb', import.meta.url))
  const load = () => new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '')
  const [avatar, reference] = await Promise.all([load(), load()])
  const mixer = new AnimationMixer(avatar.scene), control = new AnimationMixer(reference.scene)
  const layer = cameraHoldLayer(avatar.scene), aim = {...DEFAULT_CAMERA_HOLD_AIM}
  const [shoulder, elbow, hand, spine, middleKnuckle, leftShoulder] = [
    'upperarm_r', 'lowerarm_r', 'hand_r', 'spine_02', 'middle_01_r', 'upperarm_l',
  ].map(name => avatar.scene.getObjectByName(name))
  const fingerBones = ['index', 'middle', 'ring', 'pinky', 'thumb']
    .flatMap(f => [1, 2, 3].map(i => avatar.scene.getObjectByName(`${f}_0${i}_r`)))
    .filter(Boolean)
  const handBind = bindRotation(avatar.scene, hand)
  const anchorPose = cameraAnchorLocalPose(handBind)
  let firstGrip, maxDifference = 0, maxElbowHeight = -Infinity, maxReleased = 0
  let minHandForward = Infinity, minHandSide = Infinity, minLensForward = Infinity
  let maxWristBendDeg = 0, minPalmInward = Infinity, minFingerCurlDeg = Infinity
  let minPalmOffset = Infinity
  const toe = avatar.scene.getObjectByName('ball_r'), lens = new Vector3()
  // IDOK-238: avatars face +Z (bind-pose toes ahead of the chest); the grip must sit in front on the right side, lens forward.
  assert.ok(toe.getWorldPosition(new Vector3()).z > spine.getWorldPosition(new Vector3()).z)
  function sample(name, frames, weight) {
    layer.reset()
    for (const [driver, model] of [[mixer, avatar], [control, reference]]) {
      driver.stopAllAction(); driver.clipAction(model.animations.find(clip => clip.name === name)).play()
    }
    for (let frame = 0; frame < frames; frame++) {
      layer.reset(); mixer.update(1 / 60); control.update(1 / 60); layer.apply(weight, aim)
      avatar.scene.updateMatrixWorld(true)
      if (weight === 1) {
        const shPos = shoulder.getWorldPosition(new Vector3())
        const elPos = elbow.getWorldPosition(new Vector3())
        const haPos = hand.getWorldPosition(new Vector3())
        const spPos = spine.getWorldPosition(new Vector3())
        const lsPos = leftShoulder.getWorldPosition(new Vector3())
        const rightAxis = shPos.clone().sub(lsPos).normalize()
        const fwdAxis = new Vector3(0, 1, 0).cross(rightAxis).normalize()
        const leftH = new Vector3(-rightAxis.x, 0, -rightAxis.z).normalize()
        const fwdH = leftH.clone().cross(new Vector3(0, 1, 0)).normalize()
        const bodyFrame = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(leftH, new Vector3(0, 1, 0), fwdH))
        const grip = bodyFrame.clone().invert().multiply(hand.getWorldQuaternion(new Quaternion())).normalize()
        firstGrip ??= grip.clone()
        maxDifference = Math.max(maxDifference, MathUtils.radToDeg(firstGrip.angleTo(grip)))

        maxElbowHeight = Math.max(maxElbowHeight, elPos.y - shPos.y)
        minHandForward = Math.min(minHandForward, haPos.clone().sub(spPos).dot(fwdAxis))
        minHandSide = Math.min(minHandSide, haPos.clone().sub(spPos).dot(rightAxis))

        // Natural wrist check: forearm vector vs hand->knuckle vector must NOT be reversed (no 180° twist).
        const forearmDir = haPos.clone().sub(elPos).normalize()
        const handDir = middleKnuckle.getWorldPosition(new Vector3()).sub(haPos).normalize()
        maxWristBendDeg = Math.max(maxWristBendDeg, MathUtils.radToDeg(forearmDir.angleTo(handDir)))

        // Palm normal (bind -Y rotated by handWorld * handBind^-1) must face inward (-rightAxis).
        const handWorld = hand.getWorldQuaternion(new Quaternion())
        const palmWorld = new Vector3(0, -1, 0).applyQuaternion(handBind.clone().invert()).applyQuaternion(handWorld)
        minPalmInward = Math.min(minPalmInward, palmWorld.dot(rightAxis.clone().negate()))

        // Camera anchor sits in palm hollow (offset from wrist) and aims -Z forward.
        const anchorWorldPos = anchorPose.position.clone().applyMatrix4(hand.matrixWorld)
        minPalmOffset = Math.min(minPalmOffset, anchorWorldPos.distanceTo(haPos))
        lens.set(0, 0, -1).applyQuaternion(handWorld.clone().multiply(anchorPose.quaternion))
        minLensForward = Math.min(minLensForward, lens.dot(fwdAxis))

        // Middle finger curls clearly toward palm compared to flat bind pose.
        const mid2 = avatar.scene.getObjectByName('middle_02_r')
        const mid2Ref = reference.scene.getObjectByName('middle_02_r')
        minFingerCurlDeg = Math.min(minFingerCurlDeg, MathUtils.radToDeg(mid2.quaternion.angleTo(mid2Ref.quaternion)))
      } else if (!weight) {
        for (const joint of [shoulder, elbow, hand, ...fingerBones]) {
          const actual = joint.getWorldQuaternion(new Quaternion()).normalize()
          const expected = reference.scene.getObjectByName(joint.name).getWorldQuaternion(new Quaternion()).normalize()
          maxReleased = Math.max(maxReleased, MathUtils.radToDeg(actual.angleTo(expected)))
        }
      }
    }
  }
  for (let cycle = 0; cycle < 10; cycle++) {
    for (const name of ['idle', 'walk', 'run', 'sprint', 'idle']) sample(name, 90, 1)
  }
  sample('idle', 6, .5); sample('run', 120, 0); sample('idle', 60, 0)
  console.log({
    pairwiseBoundDegrees: +((2 * maxDifference).toFixed(3)),
    maxElbowHeight: +maxElbowHeight.toFixed(4),
    maxReleasedDegrees: +maxReleased.toFixed(6),
    minHandForward: +minHandForward.toFixed(4),
    minHandSide: +minHandSide.toFixed(4),
    minLensForward: +minLensForward.toFixed(4),
    maxWristBendDeg: +maxWristBendDeg.toFixed(2),
    minPalmInward: +minPalmInward.toFixed(4),
    minPalmOffset: +minPalmOffset.toFixed(4),
    minFingerCurlDeg: +minFingerCurlDeg.toFixed(2),
  })
  assert.ok(minHandForward > .15, `camera hand must be in front of the chest (${minHandForward})`)
  assert.ok(minHandSide > .08, `camera hand must stay on right side of chest (${minHandSide})`)
  assert.ok(maxWristBendDeg < 45, `wrist must stay anatomically natural, not reversed (${maxWristBendDeg} deg)`)
  assert.ok(minPalmInward > .5, `right palm must face inward toward camera body (${minPalmInward})`)
  assert.ok(minPalmOffset > .05, `camera anchor must sit in palm hollow, not at wrist (${minPalmOffset} m)`)
  assert.ok(minLensForward > .85, `lens must face forward (${minLensForward})`)
  assert.ok(minFingerCurlDeg > 15, `fingers must curl to grip camera (${minFingerCurlDeg} deg)`)
  assert.ok(2 * maxDifference <= 5)
  assert.ok(maxElbowHeight < 0)
  assert.ok(maxReleased < .001)
})
