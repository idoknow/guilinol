// IDOK-399 — unit tests for the per-frame hot paths that must stay cheap.
// Run: npm run verify:hot-paths
//
// The avatar-rig poses are checked against `scripts/fixtures/avatar-rig-golden.json`, recorded from the
// rig as it was before its solver stopped allocating (commit f75b391b). To record it again from a
// version you trust, point GOLDEN_RIG at that version's avatar-rig module:
//   GOLDEN_RIG=/abs/path/to/avatar-rig.ts node --import tsx --test scripts/test-hot-paths.mjs
import assert from 'node:assert/strict'
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {test} from 'node:test'
import {pathToFileURL} from 'node:url'
import * as THREE from 'three'
import {namedChild} from '../web/src/scene-named.ts'
import {ensureAvatarRig} from '../web/src/walk/avatar-rig.ts'

const GOLDEN_FILE = new URL('./fixtures/avatar-rig-golden.json', import.meta.url)
const goldenRig = process.env.GOLDEN_RIG ? (await import(pathToFileURL(process.env.GOLDEN_RIG).href)).ensureAvatarRig : null

test('namedChild finds an object added straight under the root and follows it being replaced', () => {
  const scene = new THREE.Scene()
  for (let index = 0; index < 5; index++) scene.add(new THREE.Group())
  const shop = namedChild(scene, 'shop')
  assert.equal(shop(), null, 'not loaded yet')

  const nested = new THREE.Group()
  nested.name = 'shop'
  scene.children[2].add(nested)
  assert.equal(shop(), null, 'only direct children count: the lookup never walks the graph')

  const first = new THREE.Group()
  first.name = 'shop'
  scene.add(first)
  assert.equal(shop(), first)
  assert.equal(shop(), first)

  scene.remove(first)
  assert.equal(shop(), null, 'gone as soon as it leaves the root')

  const second = new THREE.Group()
  second.name = 'shop'
  scene.add(first)
  scene.remove(first)
  scene.add(second)
  assert.equal(shop(), second, 'a rebuilt object with the same name is picked up')

  second.name = 'other'
  assert.equal(shop(), null, 'a renamed object no longer matches')
})

test('namedChild does not rescan while its object is still attached', () => {
  const scene = new THREE.Scene()
  const target = new THREE.Group()
  target.name = 'shop'
  scene.add(target)
  const shop = namedChild(scene, 'shop')
  assert.equal(shop(), target)
  let reads = 0
  const watched = new THREE.Group()
  Object.defineProperty(watched, 'name', {get() { reads++; return '' }})
  scene.children.unshift(watched)
  for (let frame = 0; frame < 100; frame++) shop()
  assert.equal(reads, 0)
})

// --- isModalOrOverlayOpen: one document scan per DOM change, not one per caller per frame.

class FakeObserver {
  static last = null
  constructor(callback) { this.callback = callback; this.pending = []; this.options = null; FakeObserver.last = this }
  observe(target, options) { this.target = target; this.options = options }
  disconnect() { this.options = null }
  takeRecords() { const records = this.pending; this.pending = []; return records }
}

function fakeDocument() {
  const doc = {
    open: false,
    scans: [],
    body: {dataset: {}, hasAttribute: () => false},
    querySelector(selector) { doc.scans.push(selector); return doc.open ? {} : null },
  }
  return doc
}

test('isModalOrOverlayOpen scans the page once, then only after the DOM changed', async t => {
  const page = fakeDocument()
  const saved = {document: globalThis.document, MutationObserver: globalThis.MutationObserver}
  t.after(() => Object.assign(globalThis, saved))
  globalThis.document = page
  globalThis.MutationObserver = FakeObserver
  const {isModalOrOverlayOpen, overlayScanCount} = await import('../web/src/walk/input-guard.ts')
  const before = overlayScanCount()

  for (let call = 0; call < 50; call++) assert.equal(isModalOrOverlayOpen(), false)
  assert.equal(page.scans.length, 1, '50 callers in a frame cost one scan')
  const observer = FakeObserver.last
  assert.equal(observer.target, page)
  assert.equal(observer.options.subtree, true)
  assert.equal(observer.options.childList, true)
  assert.deepEqual([...observer.options.attributeFilter].sort(), ['class', 'data-story-dialog', 'hidden', 'open'],
    'every attribute the overlay selectors test is watched')

  // A dialog opens earlier in the same task: the record is still pending, and the very next call sees it.
  page.open = true
  observer.pending.push({type: 'attributes'})
  assert.equal(isModalOrOverlayOpen(), true, 'no stale frame')
  for (let call = 0; call < 50; call++) assert.equal(isModalOrOverlayOpen(), true)
  assert.equal(page.scans.length, 2)

  // Records already delivered to the observer callback (a microtask ran in between) invalidate too.
  page.open = false
  observer.callback([{type: 'childList', addedNodes: [], removedNodes: [{nodeType: 1}]}])
  assert.equal(isModalOrOverlayOpen(), false)
  assert.equal(page.scans.length, 3)

  // A HUD label rewriting its text every frame swaps text nodes only: that cannot open an overlay, so no rescan.
  const textOnly = {type: 'childList', addedNodes: [{nodeType: 3}], removedNodes: [{nodeType: 3}]}
  for (let frame = 0; frame < 20; frame++) {
    observer.pending.push(textOnly, textOnly)
    observer.callback([textOnly])
    assert.equal(isModalOrOverlayOpen(), false)
  }
  assert.equal(page.scans.length, 3)
  // So does a HUD element being given the value it already has, which the page reports as a change every frame.
  assert.equal(observer.options.attributeOldValue, true)
  const attribute = (name, oldValue, value) => ({type: 'attributes', attributeName: name, oldValue, target: {getAttribute: () => value}})
  for (let frame = 0; frame < 20; frame++) {
    observer.pending.push(attribute('hidden', '', ''), attribute('class', 'hud on', 'hud on'), attribute('hidden', null, null))
    observer.callback([attribute('hidden', '', '')])
    assert.equal(isModalOrOverlayOpen(), false)
  }
  assert.equal(page.scans.length, 3)
  observer.pending.push(attribute('hidden', '', ''), attribute('hidden', '', null))
  assert.equal(isModalOrOverlayOpen(), false)
  assert.equal(page.scans.length, 4, 'an attribute that really changed (hidden removed) rescans')
  observer.callback([attribute('class', 'book', 'book show')])
  assert.equal(isModalOrOverlayOpen(), false)
  assert.equal(page.scans.length, 5)
  observer.pending.push(textOnly, {type: 'childList', addedNodes: [{nodeType: 3}, {nodeType: 1}], removedNodes: []})
  page.open = true
  assert.equal(isModalOrOverlayOpen(), true, 'an element arriving among text nodes still counts')
  assert.equal(page.scans.length, 6)
  page.open = false
  observer.pending.push({type: 'attributes'})
  assert.equal(isModalOrOverlayOpen(), false)
  assert.equal(page.scans.length, 7)

  // The fine terminal uses a narrower selector while delivering; it has its own cached answer.
  page.body.dataset.tdTerminalPhase = 'deliver'
  assert.equal(isModalOrOverlayOpen(), false)
  assert.equal(isModalOrOverlayOpen(), false)
  assert.equal(page.scans.length, 8)
  assert.notEqual(page.scans[7], page.scans[6])
  delete page.body.dataset.tdTerminalPhase

  // Body flags are read live, never cached.
  page.body.dataset.shopOpen = '1'
  assert.equal(isModalOrOverlayOpen(), true)
  delete page.body.dataset.shopOpen
  assert.equal(isModalOrOverlayOpen(), false)
  assert.equal(page.scans.length, 8)

  // Any other document (a test double, an iframe) is scanned on every call.
  const other = fakeDocument()
  other.open = true
  assert.equal(isModalOrOverlayOpen(other), true)
  assert.equal(isModalOrOverlayOpen(other), true)
  assert.equal(other.scans.length, 2)
  assert.equal(overlayScanCount() - before, 10)
})

test('overlay selectors use only what a MutationObserver can see changing', async () => {
  const {MODAL_OVERLAY_SELECTORS} = await import('../web/src/walk/input-guard.ts')
  for (const selector of MODAL_OVERLAY_SELECTORS) {
    const bare = selector.replace(/\[[^\]]*\]/g, '').replace(/:not\(/g, '(')
    assert.ok(!bare.includes(':'), `state pseudo-classes change without a mutation record, the cached answer would go stale: ${bare.match(/:[\w-]+/)?.[0]}`)
  }
})

test('rider pool: nothing leaves the batched joint block before the rig is released', () => {
  // A `continue` / `return` / `throw` between rig.batch(true) and rig.batch(false) would leave that rider frozen.
  const source = readFileSync(new URL('../web/src/traffic/rider-pool.ts', import.meta.url), 'utf8')
  const blocks = [...source.matchAll(/[\w.]*rig\.batch\?\.\(true\)([\s\S]*?)rig\.batch\(false\)/g)]
  assert.equal(blocks.length, 2, 'setPose and the per-frame driver animation each hold the rig once')
  for (const [, body] of blocks) assert.equal(body.match(/\b(continue|return|throw|break)\b/)?.[0], undefined)
})

// --- Avatar rig: batched joint writes solve the skeleton once and land on the same pose.

const BONES = {
  pelvis: ['spine_01', 'thigh_l', 'thigh_r'], spine_01: ['spine_02'], spine_02: ['spine_03'], spine_03: ['neck_01', 'clavicle_l', 'clavicle_r'],
  neck_01: ['head'], clavicle_l: ['upperarm_l'], upperarm_l: ['lowerarm_l'], lowerarm_l: ['hand_l'],
  clavicle_r: ['upperarm_r'], upperarm_r: ['lowerarm_r'], lowerarm_r: ['hand_r'],
  thigh_l: ['calf_l'], calf_l: ['foot_l'], foot_l: ['ball_l'], thigh_r: ['calf_r'], calf_r: ['foot_r'], foot_r: ['ball_r'],
}

function figure(ensure = ensureAvatarRig) {
  let seed = 7
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const make = name => {
    const bone = new THREE.Bone()
    bone.name = name
    bone.position.set(random() - .5, random(), random() - .5)
    bone.rotation.set(random() - .5, random() - .5, random() - .5)
    for (const child of BONES[name] ?? []) bone.add(make(child))
    return bone
  }
  const rootBone = new THREE.Bone()
  rootBone.name = 'root'
  rootBone.add(make('pelvis'))
  const armature = new THREE.Group()
  armature.name = 'Armature'
  armature.add(rootBone)
  const bones = []
  rootBone.traverse(bone => bones.push(bone))
  const skin = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
  skin.bind(new THREE.Skeleton(bones))
  armature.add(skin)
  const root = new THREE.Group()
  root.add(armature)
  const rig = ensure(root)
  return {rig, bones, pose: () => bones.flatMap(bone => bone.quaternion.toArray())}
}

const near = (actual, expected, label, tolerance = 1e-12) => {
  assert.equal(actual.length, expected.length)
  for (let index = 0; index < actual.length; index++) assert.ok(Math.abs(actual[index] - expected[index]) < tolerance, `${label}: component ${index}`)
}

const writeJoints = (rig, frame) => {
  const j = rig.joints
  j.Torso.rotation.x += (-.3 - j.Torso.rotation.x) * .4
  j.Head.rotation.y += (.5 * Math.sin(frame) - j.Head.rotation.y) * .4
  j.ThighL.rotation.x += (.68 - j.ThighL.rotation.x) * .4
  j.ShinL.rotation.x += (-.72 - j.ShinL.rotation.x) * .4
  j.ArmR.rotation.x += (1.2 - j.ArmR.rotation.x) * .6
  j.ArmR.rotation.y += (-.42 - j.ArmR.rotation.y) * .6
  j.ForearmR.rotation.z = .1 * frame
  j.Hips.rotation.set(.02 * frame, 0, .01)
}
const setJoints = rig => {
  rig.joints.ArmL.rotation.set(1.1, .2, -.3)
  rig.joints.ThighR.rotation.set(.9, 0, .2)
  rig.joints.Torso.rotation.set(-.2, .1, 0)
}
/** Poses the golden file holds: the rest pose, animated frames 6 and 12, and one set pose. */
function goldenPoses(ensure) {
  const animated = figure(ensure), posed = figure(ensure)
  const frames = [animated.pose()]
  for (let frame = 0; frame < 12; frame++) {
    writeJoints(animated.rig, frame)
    animated.rig.syncPose()
    if (frame % 6 === 5) frames.push(animated.pose())
  }
  setJoints(posed.rig)
  posed.rig.syncPose()
  return {frames, set: posed.pose()}
}

test('avatar rig: poses match the ones recorded before the solver reused its quaternions', () => {
  if (goldenRig) {
    writeFileSync(GOLDEN_FILE, JSON.stringify(goldenPoses(goldenRig)) + '\n')
    console.log(`recorded ${GOLDEN_FILE.pathname} from ${process.env.GOLDEN_RIG}`)
  }
  assert.ok(existsSync(GOLDEN_FILE), 'golden file missing: see the header of this test for how to record it')
  const golden = JSON.parse(readFileSync(GOLDEN_FILE, 'utf8'))
  const now = goldenPoses(ensureAvatarRig)
  assert.equal(now.frames.length, golden.frames.length)
  now.frames.forEach((pose, frame) => near(pose, golden.frames[frame], `frame ${frame}`, 1e-9))
  near(now.set, golden.set, 'set pose', 1e-9)
  assert.ok(golden.frames[2].some((value, index) => Math.abs(value - golden.frames[0][index]) > 1e-3), 'the recorded pose actually moved off rest')
})

test('avatar rig: single-axis joint writes inside batch() give the pose of unbatched writes, with one solve', () => {
  const plain = figure(), held = figure()
  assert.equal(plain.rig.isSkinned, true)
  for (let frame = 0; frame < 12; frame++) {
    writeJoints(plain.rig, frame)
    plain.rig.syncPose()

    const rest = held.pose()
    held.rig.batch(true)
    writeJoints(held.rig, frame)
    near(held.pose(), rest, `frame ${frame}: bones untouched while the rig is held`)
    held.rig.batch(false)

    near(held.pose(), plain.pose(), `frame ${frame}`)
  }
})

test('avatar rig: solving again allocates no quaternions and carries nothing over from earlier poses', t => {
  const a = figure(), b = figure()
  setJoints(a.rig)
  const once = a.pose()
  const count = {made: 0}
  const {clone} = THREE.Quaternion.prototype
  t.after(() => { THREE.Quaternion.prototype.clone = clone })
  THREE.Quaternion.prototype.clone = function () { count.made++; return clone.call(this) }
  for (let repeat = 0; repeat < 10; repeat++) a.rig.syncPose()
  THREE.Quaternion.prototype.clone = clone
  assert.equal(count.made, 0, 'a solve after the first one clones nothing')
  near(a.pose(), once, 'repeat solve')
  // A rig that went through other poses first ends on the same bones as a fresh one.
  b.rig.joints.ArmL.rotation.set(-.4, .9, .3)
  b.rig.joints.Head.rotation.set(.3, .3, .3)
  b.rig.joints.Head.rotation.set(0, 0, 0)
  setJoints(b.rig)
  near(b.pose(), once, 'history independent')
})
