import test from 'node:test'
import assert from 'node:assert/strict'
import {emotes, interrupted} from '../web/src/emote/emotes.ts'
import {acceptEmote, inEmoteRange} from '../rt/emote.mjs'

test('stable registry and interruptions', () => {
  assert.deepEqual(
    emotes.map(({id, key}) => [id, key]),
    [
      [1, 'thumbs_up'],
      [2, 'yixia_fanshang'],
      [3, 'naiwa_laugh'],
    ],
  )
  for (const {id} of emotes) {
    assert.equal(interrupted(id, false, false), false)
    assert.equal(interrupted(id, true, false), id !== 3)
    assert.equal(interrupted(id, false, true), true)
  }
})
test('two starts per second, immediate sequenced stops', () => {
  const p = {es: 0, emoteTimes: []}
  for (const id of [-1, 256, 1.2, '2', null]) assert.equal(acceptEmote(p, {id, s: 1}, 10), false)
  assert.equal(acceptEmote(p, {id: 255, s: 1}, 10), true)
  assert.equal(acceptEmote(p, {id: 2, s: 2}, 11), true)
  assert.equal(acceptEmote(p, {id: 0, s: 2}, 12), false)
  assert.equal(acceptEmote(p, {id: 0, s: 3}, 13), true)
  assert.equal(p.em, 0)
  assert.equal(acceptEmote(p, {id: 0, s: 9}, 14), false, 'stop without an active emote is dropped')
  assert.equal(acceptEmote(p, {id: 3, s: 4}, 1009), false)
  assert.equal(acceptEmote(p, {id: 3, s: 4}, 1010), true)
})
test('horizontal radius includes neighbours across a tile edge and its exact outer limit', () => {
  assert(inEmoteRange({x: -0.5, z: 0}, {x: 0.5, z: 0}))
  assert(inEmoteRange({x: 0, z: 0}, {x: 0, z: 256}))
  assert(!inEmoteRange({x: 0, z: 0}, {x: 200, z: 200}))
})

test('all five fingers have three weighted joints, identical hierarchy and <=220 triangles per hand', async () => {
  const {readFile} = await import('node:fs/promises')
  let expected
  for (const file of ['figure', 'figure_m', 'figure_f']) {
    const glb = await readFile('public/avatar/' + file + '.glb')
    const end = 20 + glb.readUInt32LE(12)
    const doc = JSON.parse(glb.subarray(20, end))
    const bin = doc.buffers[0].uri
      ? await readFile('public/avatar/' + doc.buffers[0].uri)
      : glb.subarray(end + 8)
    const joints = doc.skins[0].joints.map((i) => doc.nodes[i])
    const hierarchy = joints.map((j) => [j.name, j.children])
    if (expected) assert.deepEqual(hierarchy, expected)
    expected = hierarchy
    const primitive = doc.meshes[0].primitives[0]
    function values(ref) {
      const a = doc.accessors[ref],
        v = doc.bufferViews[a.bufferView]
      const Type = {5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array}[
        a.componentType
      ]
      return new Type(
        bin.buffer,
        bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0),
        a.count * (a.type === 'SCALAR' ? 1 : 4),
      )
    }
    const idx = values(primitive.indices),
      skin = values(primitive.attributes.JOINTS_0),
      weights = values(primitive.attributes.WEIGHTS_0)
    for (const side of ['l', 'r']) {
      const digit = new RegExp('^(thumb|index|middle|ring|pinky)_0[123]_' + side + '$')
      const weighted = new Set(),
        hand = new Set()
      for (let i = 0; i < skin.length; i += 4) {
        const name = joints[skin[i]].name
        if (digit.test(name)) {
          assert(weights[i] > 0 && weights[i + 1] === 0 && weights[i + 2] === 0 && weights[i + 3] === 0)
          weighted.add(name)
        }
        if (digit.test(name) || name === 'hand_' + side) hand.add(i / 4)
      }
      assert.equal(weighted.size, 15)
      let count = 0
      for (let i = 0; i < idx.length; i += 3)
        if (hand.has(idx[i]) && hand.has(idx[i + 1]) && hand.has(idx[i + 2])) count++
      assert(count <= 220, file + ' ' + side + ' has ' + count + ' triangles')
      console.log(file, side, count, 'triangles')
    }
  }
})

for (const body of ['figure', 'figure_m', 'figure_f'])
  test('opposing thumb hooks on ' + body, async () => {
    const {readFile} = await import('node:fs/promises')
    const {Vector3, Box3} = await import('three')
    const {GLTFLoader} = await import('three/addons/loaders/GLTFLoader.js')
    const {emotePlayback} = await import('../web/src/emote/playback.ts')
    const bytes = await readFile('public/avatar/' + body + '.glb')
    let data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    if (body !== 'figure') {
      const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)))
      const bin = await readFile('public/avatar/' + doc.buffers[0].uri)
      // Inline the shared buffer as a GLB chunk for Node's filesystem-only loader.
      delete doc.buffers[0].uri
      const json = Buffer.from(JSON.stringify(doc))
      const length = (json.length + 3) & ~3
      const packed = Buffer.alloc(28 + length + bin.length)
      bytes.copy(packed, 0, 0, 20)
      packed.writeUInt32LE(packed.length, 8)
      packed.writeUInt32LE(length, 12)
      packed.fill(0x20, 20, 20 + length)
      json.copy(packed, 20)
      packed.writeUInt32LE(bin.length, 20 + length)
      packed.write('BIN\0', 24 + length)
      bin.copy(packed, 28 + length)
      data = packed.buffer
    }
    const {scene} = await new GLTFLoader().parseAsync(data, '')
    const pose = emotePlayback(scene)
    pose.play(2)
    pose.tick(0.5, false)
    scene.updateMatrixWorld(true)
    const point = (name) => scene.getObjectByName(name).getWorldPosition(new Vector3())
    const chest = point('spine_03')
    const left = point('hand_l'),
      right = point('hand_r')
    assert(left.x - right.x >= 0.08)
    for (const side of ['l', 'r']) {
      const sign = side === 'r' ? 1 : -1
      const wrist = point('hand_' + side)
      assert(Math.abs(wrist.y - chest.y) < 0.14 && wrist.z - chest.z > 0.18)
      for (const finger of ['index', 'middle']) {
        assert(sign * (point(finger + '_04_leaf_' + side).y - wrist.y) > 0.12)
      }
      const tip = point('thumb_04_leaf_' + side)
      assert(sign * (tip.x - chest.x) > 0.018)
      assert(sign * (tip.y - point('thumb_02_' + side).y) >= 0.015)
      assert(sign * (tip.y - point('thumb_03_' + side).y) > 0.03)
    }
    assert(point('thumb_03_r').z > point('thumb_03_l').z)

    // Per-triangle boxes enclose the entire skinned surfaces. Their separation
    // is a conservative lower bound, including edges and face interiors.
    const mesh = scene.getObjectByProperty('isSkinnedMesh', true)
    const geo = mesh.geometry,
      triangles = {l: [], r: []}

    for (let i = 0; i < geo.index.count; i += 3) {
      const ids = [0, 1, 2].map((k) => geo.index.getX(i + k))
      const joint = mesh.skeleton.bones[geo.attributes.skinIndex.getX(ids[0])].name
      if (!joint.startsWith('thumb_')) continue
      triangles[joint.slice(-1)].push(
        ids.map((j) => mesh.localToWorld(mesh.getVertexPosition(j, new Vector3()))),
      )
    }
    assert(triangles.l.length && triangles.r.length)
    function apart(a, b, depth) {
      const l = new Box3().setFromPoints(a),
        r = new Box3().setFromPoints(b)
      const gaps = ['x', 'y', 'z'].map((k) => Math.max(0, l.min[k] - r.max[k], r.min[k] - l.max[k]))
      if (Math.hypot(...gaps) >= 0.003) return true
      if (depth === 0) return false
      const ab = a[0].clone().lerp(a[1], 0.5),
        bc = a[1].clone().lerp(a[2], 0.5),
        ca = a[2].clone().lerp(a[0], 0.5)
      return [
        [a[0], ab, ca],
        [ab, a[1], bc],
        [ca, bc, a[2]],
        [ab, bc, ca],
      ].every((sub) => apart(b, sub, depth - 1))
    }
    for (const l of triangles.l)
      for (const r of triangles.r) assert(apart(l, r, 10), 'thumb surfaces within 3 mm')
  })

test('full-body choreography, clean reset, and zero NaN across all 6 emotes', async () => {
  const {readFile} = await import('node:fs/promises')
  const {Quaternion, Vector3} = await import('three')
  const {GLTFLoader} = await import('three/addons/loaders/GLTFLoader.js')
  const {allEmotes} = await import('../web/src/emote/emotes.ts')
  const {emotePlayback} = await import('../web/src/emote/playback.ts')

  const bytes = await readFile('public/avatar/figure.glb')
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const {scene} = await new GLTFLoader().parseAsync(data, '')
  const mesh = scene.getObjectByProperty('isSkinnedMesh', true)
  const restQuats = new Map(mesh.skeleton.bones.map((b) => [b.name, b.quaternion.clone()]))
  const restPos = new Map(mesh.skeleton.bones.map((b) => [b.name, b.position.clone()]))
  const pose = emotePlayback(scene)

  const wheelTracked = ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'clavicle_r', 'hand_l', 'hand_r']
  for (const entry of allEmotes) {
    pose.play(entry.id, 0)
    const snapshots = new Map(wheelTracked.map((n) => [n, []]))
    const steps = 16
    const dt = entry.duration / steps
    for (let s = 1; s <= steps; s++) {
      pose.reset()
      pose.tick(dt, false)
      scene.updateMatrixWorld(true)
      for (const b of mesh.skeleton.bones) {
        const q = b.quaternion
        assert(
          Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w),
          `${entry.key} ${b.name} produced non-finite quaternion`,
        )
        assert(Math.abs(q.length() - 1) < 1e-3, `${entry.key} ${b.name} quaternion not unit length`)
      }
      if (entry.id <= 3) {
        for (const n of wheelTracked) snapshots.get(n).push(scene.getObjectByName(n).quaternion.clone())
      }
    }
    if (entry.id <= 3) {
      for (const n of wheelTracked) {
        const list = snapshots.get(n)
        let maxAngle = 0
        for (let i = 1; i < list.length; i++) maxAngle = Math.max(maxAngle, list[0].angleTo(list[i]))
        assert(maxAngle > 0.015, `${entry.key}: ${n} should animate dynamically (maxAngle=${maxAngle.toFixed(4)})`)
      }
    }
    pose.stop()
    pose.reset()
    for (const b of mesh.skeleton.bones) {
      const q0 = restQuats.get(b.name)
      const qDiff = Math.max(
        Math.abs(b.quaternion.x - q0.x),
        Math.abs(b.quaternion.y - q0.y),
        Math.abs(b.quaternion.z - q0.z),
        Math.abs(b.quaternion.w - q0.w),
      )
      assert(qDiff < 1e-5, `${entry.key}: ${b.name} quaternion did not reset (maxDiff=${qDiff})`)
      assert(b.position.distanceTo(restPos.get(b.name)) < 1e-5, `${entry.key}: ${b.name} position did not reset`)
    }
  }
})

test('naiwa_laugh moving mode keeps legs untouched and splits torso yaw safely across spine_01..03', async () => {
  const {readFile} = await import('node:fs/promises')
  const {Matrix4, Quaternion, Vector3} = await import('three')
  const {GLTFLoader} = await import('three/addons/loaders/GLTFLoader.js')
  const {emotePlayback} = await import('../web/src/emote/playback.ts')

  const bytes = await readFile('public/avatar/figure.glb')
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const {scene} = await new GLTFLoader().parseAsync(data, '')
  const mesh = scene.getObjectByProperty('isSkinnedMesh', true)
  const restLegs = ['pelvis', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'].map((n) => [
    n,
    scene.getObjectByName(n).quaternion.clone(),
    scene.getObjectByName(n).position.clone(),
  ])
  const pose = emotePlayback(scene)
  pose.play(3, 0)
  for (let i = 0; i < 180; i++) {
    pose.reset()
    pose.tick(1 / 60, true)
  }
  scene.updateMatrixWorld(true)
  for (const [n, q0, p0] of restLegs) {
    const b = scene.getObjectByName(n)
    const qDiff = Math.max(
      Math.abs(b.quaternion.x - q0.x),
      Math.abs(b.quaternion.y - q0.y),
      Math.abs(b.quaternion.z - q0.z),
      Math.abs(b.quaternion.w - q0.w),
    )
    assert(qDiff < 1e-5, `moving laugh must not touch ${n} quaternion`)
    assert(b.position.distanceTo(p0) < 1e-5, `moving laugh must not touch ${n} position`)
  }
  const yawOf = (name) => {
    const idx = mesh.skeleton.bones.findIndex((b) => b.name === name)
    const restWorld = new Quaternion().setFromRotationMatrix(
      new Matrix4().extractRotation(mesh.skeleton.boneInverses[idx].clone().invert()),
    )
    const fwd = new Vector3(0, 0, 1).applyQuaternion(
      mesh.skeleton.bones[idx].getWorldQuaternion(new Quaternion()).multiply(restWorld.invert()),
    )
    return (Math.atan2(fwd.x, fwd.z) * 180) / Math.PI
  }
  const y0 = yawOf('pelvis'),
    y1 = yawOf('spine_01'),
    y2 = yawOf('spine_02'),
    y3 = yawOf('spine_03')
  assert(Math.abs(y3 - y0) > 20 && Math.abs(y3 - y0) <= 45, `moving laugh torso yaw should be moderate (${(y3 - y0).toFixed(1)}°)`)
  assert(Math.abs(y1 - y0) <= 22, `spine_01 twist must be capped to prevent waist pinch (${(y1 - y0).toFixed(1)}°)`)
  assert(Math.abs(y2 - y1) <= 22, `spine_02 twist must be capped (${(y2 - y1).toFixed(1)}°)`)
  assert(Math.abs(y3 - y2) <= 22, `spine_03 twist must be capped (${(y3 - y2).toFixed(1)}°)`)
})

test('face cues cover anticipation, climax, and return to base for all 3 wheel emotes', async () => {
  const {faceAt} = await import('../web/src/emote/face.ts')
  const {thumbsUp} = await import('../web/src/emote/thumbs-up.ts')
  const {seal} = await import('../web/src/emote/seal.ts')
  const {laugh} = await import('../web/src/emote/laugh.ts')

  assert.equal(faceAt(thumbsUp.face, 0.1), 'smile')
  assert.equal(faceAt(thumbsUp.face, 1.5), 'thumbs_up')
  assert.equal(faceAt(thumbsUp.face, 3.95), 'base')

  assert.equal(faceAt(seal.face, 0.5), 'serious')
  assert.equal(faceAt(seal.face, 2.9), 'base')

  assert.equal(faceAt(laugh.face, 1.0), 'laugh')
  assert.equal(faceAt(laugh.face, 2.8), 'serious')
  assert.equal(faceAt(laugh.face, 4.1), 'base')
})
