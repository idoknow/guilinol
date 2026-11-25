import test from 'node:test'
import assert from 'node:assert/strict'

import { STORY_BEATS } from './script.ts'
import {
  computeShotPose,
  createStoryCameraController,
  STORY_SHOT_IDS,
} from './camera-shots.ts'
import {
  createStoryDirector,
  loadStorySave,
  STORY_STORAGE_KEY,
} from './director.ts'
import { isGlobalHotkeyBlocked, isModalOrOverlayOpen, isStoryDialogueOpen } from '../../walk/input-guard.ts'

function makeMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, val) => { map.set(key, String(val)) },
    dump: () => Object.fromEntries(map.entries()),
  }
}

function makeMockCamera(pos = [-1140.5, 157.8, -45.2], fov = 54) {
  let projUpdates = 0
  const cam = {
    position: {
      x: pos[0], y: pos[1], z: pos[2],
      set(x, y, z) { this.x = x; this.y = y; this.z = z },
    },
    quaternion: {
      x: 0.04, y: -0.15, z: 0.01, w: 0.987,
      set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w },
    },
    fov,
    lastLookAt: null,
    lookAt(x, y, z) { this.lastLookAt = [x, y, z] },
    updateProjectionMatrix() { projUpdates++ },
    getProjUpdates: () => projUpdates,
  }
  return cam
}

function makeMockNpc() {
  const calls = { markers: [], talking: [], exprs: [] }
  return {
    group: {
      position: { x: -1141.9, y: 156.1, z: -47.9 },
      rotation: { y: 2.83616 - Math.PI },
    },
    setMarker(m) { calls.markers.push(m) },
    setTalking(on) { calls.talking.push(on) },
    setExpression(id) { calls.exprs.push(id) },
    headWorld() { return { x: -1141.9, y: 157.7, z: -47.9 } },
    calls,
  }
}

function makeMockAudio() {
  const played = []
  const blips = []
  return {
    play(id) { played.push(id); return true },
    playBlip(s) { blips.push(s); return true },
    played,
    blips,
  }
}

test('full meet unlock flow via choice branch, persistence to glol.mifen.story.v1 only, and exact camera restore', () => {
  const storage = makeMemoryStorage({ 'glol.mifen.v1': '{"funds":99}' })
  const camera = makeMockCamera([-1140.8, 157.7, -46.7], 55)
  const npc = makeMockNpc()
  const audio = makeMockAudio()
  const playerPos = { x: -1140.8, y: 156.95, z: -46.7 }
  let unlocks = 0
  const doneBeats = []

  const dir = createStoryDirector({
    camera,
    container: null,
    getPlayerPos: () => playerPos,
    npc,
    beats: STORY_BEATS,
    portraits: { neutral: '/u-n.png', worry: '/u-w.png', smile: '/u-s.png', proud: '/u-p.png', laugh: '/u-l.png' },
    playerPortrait: '/player.png',
    audio,
    storage,
    onUnlock: () => { unlocks++ },
    onBeatDone: id => { doneBeats.push(id) },
  })

  assert.equal(dir.isUnlocked(), false)
  assert.equal(dir.canTalk(), true)
  assert.equal(dir.isActive(), false)

  // Start meet beat
  assert.equal(dir.talk(), true)
  assert.equal(dir.isActive(), true)
  assert.equal(dir.canTalk(), false)
  assert.equal(dir.getProbe().currentBeatId, 'meet')
  assert.equal(dir.getProbe().currentShot, 'wide')
  assert.notEqual(camera.fov, 55, 'cutscene should adjust cinematic FOV')

  // Fast-tap (< 0.14s) reveals full text first, then second advance moves to line 1 (player shot)
  dir.step(0.05)
  assert.equal(dir.advance(), true)
  assert.equal(dir.getProbe().lineIndex, 0)
  assert.equal(dir.advance(), true)
  assert.equal(dir.getProbe().lineIndex, 1)
  assert.equal(dir.getProbe().currentShot, 'player')

  // Normal reading pace (>= 0.14s) advances in one click to line 2 (uncle shot with 2 choices)
  dir.step(0.1); dir.step(0.1)
  assert.equal(dir.advance(), true)
  assert.equal(dir.getProbe().lineIndex, 2)
  assert.equal(dir.getProbe().currentShot, 'uncle')
  assert.deepEqual(dir.getProbe().choices, ['accept_direct', 'ask_steps'])

  // Invalid choice id rejected
  assert.equal(dir.choose('nonexistent'), false)
  assert.equal(dir.getProbe().lineIndex, 2)

  // Pick branch ask_steps -> jumps to line 3 (two shot) -> line 4 -> line 5 -> completes meet
  assert.equal(dir.choose('ask_steps'), true)
  assert.equal(dir.getProbe().lineIndex, 3)
  assert.equal(dir.getProbe().currentShot, 'two')
  assert.equal(dir.getProbe().lastChoices.meet, 'ask_steps')

  dir.step(0.1); dir.step(0.1); assert.equal(dir.advance(), true) // line 4
  dir.step(0.1); dir.step(0.1); assert.equal(dir.advance(), true) // line 5
  dir.step(0.1); dir.step(0.1); assert.equal(dir.advance(), true) // finish!

  assert.equal(dir.isActive(), false)
  assert.equal(dir.isUnlocked(), true)
  assert.equal(dir.canTalk(), false)
  assert.equal(unlocks, 1)
  assert.deepEqual(doneBeats, ['meet'])

  // Exact camera & FOV restored and player never moved
  assert.deepEqual([camera.position.x, camera.position.y, camera.position.z], [-1140.8, 157.7, -46.7])
  assert.deepEqual([camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w], [0.04, -0.15, 0.01, 0.987])
  assert.equal(camera.fov, 55)
  assert.deepEqual(playerPos, { x: -1140.8, y: 156.95, z: -46.7 })

  // Storage isolated: glol.mifen.v1 untouched, glol.mifen.story.v1 persisted
  const dumped = storage.dump()
  assert.equal(dumped['glol.mifen.v1'], '{"funds":99}')
  assert.ok(dumped[STORY_STORAGE_KEY])
  assert.equal(loadStorySave(storage).unlocked, true)
  dir.dispose()
})

test('choice accept_direct skips explanation lines and jumps directly to line 5', () => {
  const storage = makeMemoryStorage()
  const dir = createStoryDirector({
    camera: makeMockCamera(),
    container: null,
    getPlayerPos: () => ({ x: 0, y: 0, z: 0 }),
    npc: makeMockNpc(),
    beats: STORY_BEATS,
    portraits: {},
    playerPortrait: '/p.png',
    storage,
  })
  assert.equal(dir.talk(), true)
  dir.step(0.1); dir.step(0.1); dir.advance() // line 1
  dir.step(0.1); dir.step(0.1); dir.advance() // line 2
  assert.equal(dir.choose('accept_direct'), true)
  assert.equal(dir.getProbe().lineIndex, 5)
  dir.step(0.1); dir.step(0.1); dir.advance() // finish
  assert.equal(dir.isUnlocked(), true)
  assert.equal(dir.isActive(), false)
  dir.dispose()
})

test('skip immediately unlocks meet, restores exact camera/FOV, and does not replay', () => {
  const storage = makeMemoryStorage()
  const camera = makeMockCamera([-1141.0, 157.9, -45.5], 52)
  const npc = makeMockNpc()
  let unlocks = 0
  const dir = createStoryDirector({
    camera,
    container: null,
    getPlayerPos: () => ({ x: -1141.0, y: 156.9, z: -45.5 }),
    npc,
    beats: STORY_BEATS,
    portraits: {},
    playerPortrait: '/p.png',
    storage,
    onUnlock: () => { unlocks++ },
  })
  assert.equal(dir.talk(), true)
  dir.step(0.25)
  assert.notEqual(camera.fov, 52)

  assert.equal(dir.skip(), true)
  assert.equal(dir.isActive(), false)
  assert.equal(dir.isUnlocked(), true)
  assert.equal(unlocks, 1)
  assert.equal(dir.getProbe().lastSkippedBeatId, 'meet')
  assert.equal(dir.getProbe().cameraState.restoreCount, 1)
  assert.deepEqual([camera.position.x, camera.position.y, camera.position.z], [-1141.0, 157.9, -45.5])
  assert.equal(camera.fov, 52)

  // Repeat trigger blocked
  assert.equal(dir.talk(), false)
  assert.equal(dir.skip(), false)
  dir.dispose()
})

test('corrupt or forged save in glol.mifen.story.v1 safely falls back to locked state', () => {
  const badSaves = [
    '{not valid json',
    'null',
    '[]',
    '123',
    '{"unlocked": "yes", "completedBeats": ["meet"]}',
    '{"unlocked": true, "completedBeats": []}',
    '{"unlocked": true, "completedBeats": ["first_bowl"]}',
    '{"unlocked": false, "completedBeats": ["meet"]}',
  ]
  for (const raw of badSaves) {
    const storage = makeMemoryStorage({ [STORY_STORAGE_KEY]: raw, 'glol.mifen.v1': '{"funds":42}' })
    const loaded = loadStorySave(storage)
    assert.equal(loaded.unlocked, false, `corrupt save should stay locked: ${raw}`)
    assert.deepEqual(loaded.completedBeats, [])

    const dir = createStoryDirector({
      camera: makeMockCamera(),
      container: null,
      getPlayerPos: () => null,
      npc: makeMockNpc(),
      beats: STORY_BEATS,
      portraits: {},
      playerPortrait: '/p.png',
      storage,
    })
    assert.equal(dir.isUnlocked(), false)
    assert.equal(dir.canTalk(), true)
    assert.equal(storage.dump()['glol.mifen.v1'], '{"funds":42}')
    dir.dispose()
  }
})

test('repeat trigger protection for notify events and active-beat guard', () => {
  const storage = makeMemoryStorage()
  const dir = createStoryDirector({
    camera: makeMockCamera(),
    container: null,
    getPlayerPos: () => ({ x: -1140, y: 156.9, z: -46 }),
    npc: makeMockNpc(),
    beats: STORY_BEATS,
    portraits: {},
    playerPortrait: '/p.png',
    storage,
  })
  // Unlock meet
  assert.equal(dir.talk(), true)
  // Cannot trigger another beat while meet is active
  assert.equal(dir.notify('first_bowl_served'), false)
  assert.equal(dir.talk(), false)
  assert.equal(dir.skip(), true)

  // Trigger first_bowl_served once -> succeeds (starts at shop shot)
  assert.equal(dir.notify('first_bowl_served'), true)
  assert.equal(dir.getProbe().currentBeatId, 'first_bowl')
  assert.equal(dir.getProbe().currentShot, 'shop')
  assert.equal(dir.skip(), true)

  // Repeat trigger of same event -> blocked
  assert.equal(dir.notify('first_bowl_served'), false)
  // Unknown event -> blocked
  assert.equal(dir.notify('unknown_event'), false)

  // Reset allows replaying meet cleanly
  dir.reset()
  assert.equal(dir.isUnlocked(), false)
  assert.equal(dir.canTalk(), true)
  assert.equal(dir.talk(), true)
  dir.dispose()
})

test('all 5 camera shots produce distinct poses and camera controller restores exact snapshot', () => {
  const anchor = {
    npcPos: [-1141.9, 156.1, -47.9],
    npcYaw: 2.83616 - Math.PI,
    npcHead: [-1141.9, 157.7, -47.9],
    playerPos: [-1140.8, 156.9, -46.7],
  }
  const poses = STORY_SHOT_IDS.map(shot => computeShotPose(shot, anchor))
  for (let i = 0; i < poses.length; i++) {
    for (let j = i + 1; j < poses.length; j++) {
      const d = Math.hypot(
        poses[i].position[0] - poses[j].position[0],
        poses[i].position[1] - poses[j].position[1],
        poses[i].position[2] - poses[j].position[2],
      )
      assert.ok(d > 0.8, `shots ${poses[i].shot} & ${poses[j].shot} too close (${d})`)
    }
  }

  const cam = makeMockCamera([-1140.5, 157.6, -45.0], 50)
  const rig = createStoryCameraController()
  rig.begin(cam)
  for (const shot of STORY_SHOT_IDS) {
    rig.setShot(shot, anchor, cam)
    rig.step(0.1, anchor, cam)
    assert.equal(rig.getCurrentShot(), shot)
  }
  rig.end(cam)
  assert.deepEqual([cam.position.x, cam.position.y, cam.position.z], [-1140.5, 157.6, -45.0])
  assert.equal(cam.fov, 50)
})

test('input-guard blocks movement and global hotkeys when story dialogue is active', () => {
  const fakeDoc = {
    body: {
      dataset: { mifenStoryActive: '1' },
      hasAttribute: () => false,
    },
    querySelector: () => null,
  }
  assert.equal(isStoryDialogueOpen(fakeDoc), true)
  assert.equal(isModalOrOverlayOpen(fakeDoc), true)
  assert.equal(isGlobalHotkeyBlocked(null, { doc: fakeDoc }), true)

  fakeDoc.body.dataset.mifenStoryActive = '0'
  assert.equal(isStoryDialogueOpen(fakeDoc), false)
  assert.equal(isModalOrOverlayOpen(fakeDoc), false)
  assert.equal(isGlobalHotkeyBlocked(null, { doc: fakeDoc }), false)
})
