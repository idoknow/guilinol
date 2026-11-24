import test from 'node:test'
import assert from 'node:assert/strict'
import {emotes, interrupted} from '../web/src/emote/emotes.ts'
import {acceptEmote, sameCell} from '../rt/emote.mjs'

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
test('starts and stops share a two-packet sliding window', () => {
  const p = {es: 0, emoteTimes: []}
  for (const id of [-1, 256, 1.2, '2', null]) assert.equal(acceptEmote(p, {id, s: 1}, 10), false)
  assert.equal(acceptEmote(p, {id: 255, s: 1}, 10), true)
  assert.equal(acceptEmote(p, {id: 0, s: 1}, 11), false)
  assert.equal(acceptEmote(p, {id: 0, s: 2}, 11), true)
  assert.equal(acceptEmote(p, {id: 3, s: 3}, 1009), false)
  assert.equal(p.em, 0)
  assert.equal(acceptEmote(p, {id: 3, s: 3}, 1010), true)
  assert.equal(sameCell({x: -1, z: 0}, {x: -256, z: 255}), true)
  assert.equal(sameCell({x: -1, z: 0}, {x: 0, z: 0}), false)
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
