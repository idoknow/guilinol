import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {AnimationMixer, MathUtils, Quaternion, Vector3} from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {cameraHoldLayer} from '../web/src/walk/camera-hold.ts'

test('a camera grip survives ten gait cycles and releases back to the untouched mixer pose', async () => {
  const data = await readFile(new URL('../public/avatar/figure.glb', import.meta.url))
  const load = () => new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '')
  const [avatar, reference] = await Promise.all([load(), load()])
  const mixer = new AnimationMixer(avatar.scene), control = new AnimationMixer(reference.scene)
  const layer = cameraHoldLayer(avatar.scene), aim = {forward: .32, up: .13, side: -.04}
  const [shoulder, elbow, hand, spine] = ['upperarm_r', 'lowerarm_r', 'hand_r', 'spine_02'].map(name => avatar.scene.getObjectByName(name))
  let firstGrip, maxDifference = 0, maxElbowHeight = -Infinity, maxReleased = 0, minHandForward = Infinity, minLensForward = Infinity
  const toe = avatar.scene.getObjectByName('ball_r'), lens = new Vector3()
  // IDOK-238: avatars face +Z (bind-pose toes ahead of the chest); the grip must sit in front, lens forward.
  assert.ok(toe.getWorldPosition(new Vector3()).z > spine.getWorldPosition(new Vector3()).z)
  function sample(name, frames, weight) {
    layer.reset()
    for (const [driver, model] of [[mixer, avatar], [control, reference]]) {
      driver.stopAllAction(); driver.clipAction(model.animations.find(clip => clip.name === name)).play()
    }
    for (let frame = 0; frame < frames; frame++) {
      layer.reset(); mixer.update(1 / 60); control.update(1 / 60); layer.apply(weight, aim)
      if (weight === 1) {
        const grip = spine.getWorldQuaternion(new Quaternion()).invert().multiply(hand.getWorldQuaternion(new Quaternion())).normalize()
        firstGrip ??= grip.clone()
        maxDifference = Math.max(maxDifference, MathUtils.radToDeg(firstGrip.angleTo(grip)))
        maxElbowHeight = Math.max(maxElbowHeight, elbow.getWorldPosition(new Vector3()).y - shoulder.getWorldPosition(new Vector3()).y)
        minHandForward = Math.min(minHandForward, hand.getWorldPosition(new Vector3()).z - spine.getWorldPosition(new Vector3()).z)
        const bind = avatar.scene.getObjectByProperty('isSkinnedMesh', true).skeleton
        const anchor = new Quaternion().setFromRotationMatrix(bind.boneInverses[bind.bones.indexOf(hand)].clone().invert()).invert()
        lens.set(0, 0, -1).applyQuaternion(hand.getWorldQuaternion(new Quaternion()).multiply(anchor))
        minLensForward = Math.min(minLensForward, lens.z)
      } else if (!weight) {
        for (const joint of [shoulder, elbow, hand]) {
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
  console.log({pairwiseBoundDegrees: 2 * maxDifference, maxElbowHeight, maxReleasedDegrees: maxReleased, minHandForward, minLensForward})
  assert.ok(minHandForward > .15, 'camera hand must be in front of the chest'); assert.ok(minLensForward > .6, 'lens must face forward')
  assert.ok(2 * maxDifference <= 5); assert.ok(maxElbowHeight < 0); assert.ok(maxReleased < .001)
})
