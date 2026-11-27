import {before, after, test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {createRequire} from 'node:module'
import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'

const requireFromCwd = createRequire(join(process.cwd(), 'package.json'))
const threeEntryUrl = import.meta.resolve('three')
const rapierEntryUrl = pathToFileURL(requireFromCwd.resolve('@dimforge/rapier3d-compat')).href

let tempDir
let kdMod
let rideMod
let rigMod
let propsMod
let emotesMod
let playbackMod
let handoverMod

async function loadAvatarScene(file = 'figure') {
  const bytes = await readFile(`public/avatar/${file}.glb`)
  let data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  if (file !== 'figure') {
    const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)))
    const bin = await readFile(`public/avatar/${doc.buffers[0].uri}`)
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
  return scene
}

before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'glol-kd-test-'))
  const resolveWorkspaceExternals = {
    name: 'resolve-workspace-externals',
    setup(buildCtx) {
      buildCtx.onResolve({filter: /^three$/}, () => ({path: threeEntryUrl, external: true}))
      buildCtx.onResolve({filter: /^@dimforge\/rapier3d-compat$/}, () => ({path: rapierEntryUrl, external: true}))
    },
  }
  const entryDefs = [
    ['knockdown', 'web/src/walk/knockdown.ts'],
    ['ride', 'web/src/walk/ride.ts'],
    ['rig', 'web/src/walk/avatar-rig.ts'],
    ['props', 'web/src/gear/duty-props.ts'],
    ['emotes', 'web/src/emote/emotes.ts'],
    ['playback', 'web/src/emote/playback.ts'],
    ['handover', 'web/src/emote/ticket-handover.ts'],
  ]
  const loaded = {}
  for (const [key, entry] of entryDefs) {
    const outfile = join(tempDir, `${key}.mjs`)
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      mainFields: ['module', 'main'],
      plugins: [resolveWorkspaceExternals],
      external: ['three/*', threeEntryUrl, rapierEntryUrl],
    })
    loaded[key] = await import(pathToFileURL(outfile).href)
  }
  kdMod = loaded.knockdown
  rideMod = loaded.ride
  rigMod = loaded.rig
  propsMod = loaded.props
  emotesMod = loaded.emotes
  playbackMod = loaded.playback
  handoverMod = loaded.handover
})

after(async () => {
  if (tempDir) await rm(tempDir, {recursive: true, force: true})
})

const DT = 1 / 60
function stepFor(kd, sec) {
  for (let t = 0; t < sec - 1e-9; t += DT) kd.step(DT)
}
function stepUntil(kd, pred, maxSec = 10) {
  for (let t = 0; t < maxSec; t += DT) {
    if (pred()) return t
    kd.step(DT)
  }
  throw new Error(`condition not reached in ${maxSec}s (phase=${kd.phase})`)
}

test('k47 倒地动作 ≥5 种：按撞击方向和力度选对，每种有撞击姿态 + 落地停顿，镜头震动随力度', () => {
  kdMod.knockdown.reset()
  assert.equal(kdMod.isDown(), false)
  // 推力方向（玩家 yaw=0 面朝 -Z）：back=被正面撞，往后推；front=被从后面撞
  const table = [
    ['vehicle_hit', 'back', 0.9, {}, 'front_launch'],
    ['vehicle_hit', {x: 0, z: 1}, 0.6, {}, 'front_launch'],
    ['vehicle_hit', 'left', 0.75, {}, 'side_topple_l'],
    ['vehicle_hit', {x: 1, z: 0}, 0.72, {}, 'side_topple_r'],
    ['vehicle_hit', 'front', 0.6, {}, 'forward_sprawl'],
    ['vehicle_hit', 'back', 0.2, {}, 'stagger_kneel'],
    ['vehicle_hit', 'left', 0.3, {}, 'stagger_kneel'],
    ['bike_crash', {x: 1, z: 0}, 0.7, {side: 1, reason: 'lowside'}, 'bike_slide'],
    ['bike_crash', 'front', 0.6, {reason: 'impact'}, 'bike_slide'],
    ['bike_crash', 'front', 0.3, {reason: 'impact'}, 'forward_sprawl'],
    ['bike_crash', 'back', 0.9, {reason: 'loopout'}, 'front_launch'],
    // 朝向旋转后仍按本地方向判断：yaw=π/2 面朝 -X，世界 +X 推力 = 往后推
    ['vehicle_hit', {x: 1, z: 0}, 0.8, {yaw: Math.PI / 2}, 'front_launch'],
    ['vehicle_hit', {x: 0, z: 1}, 0.8, {yaw: Math.PI / 2}, 'side_topple_l'],
  ]
  for (const [kind, dir, sev, opts, expected] of table) {
    assert.equal(kdMod.resolveKnockdownVariant(dir, sev, kind, {yaw: 0, ...opts}), expected, `${kind} ${JSON.stringify(dir)} sev${sev}`)
  }
  const seen = new Set(table.map((r) => r[4]))
  assert(seen.size >= 5, `≥5 种倒法，实际 ${[...seen].join(',')}`)
  assert.deepEqual([...kdMod.KNOCKDOWN_VARIANTS].sort(), [...seen].sort())

  const sFront = kdMod.triggerKnockdown('vehicle_hit', {x: 0, z: 1}, 0.9, {yaw: 0})
  assert.equal(kdMod.isDown(), true)
  assert.equal(sFront.variant, 'front_launch')
  assert(sFront.knockbackVel.z > 4, '正面撞飞往后（+Z）推')
  const sLeft = kdMod.triggerKnockdown('vehicle_hit', 'left', 0.75, {yaw: 0})
  assert(sLeft.knockbackVel.x < -3)
  kdMod.knockdown.reset()

  // 镜头震动随力度
  const shake = (sev) => kdMod.createKnockdownState().triggerKnockdown('vehicle_hit', 'back', sev, {yaw: 0}).cameraShake
  assert(shake(0.95) > shake(0.6) && shake(0.6) > shake(0.36), '力度越大震得越狠')
  assert(shake(0.95) > 0.85)

  const poses = new Map()
  for (const [kind, dir, sev, opts, variant] of [
    ['vehicle_hit', 'back', 0.9, {}, 'front_launch'],
    ['vehicle_hit', 'left', 0.7, {}, 'side_topple_l'],
    ['vehicle_hit', 'right', 0.7, {}, 'side_topple_r'],
    ['vehicle_hit', 'front', 0.6, {}, 'forward_sprawl'],
    ['vehicle_hit', 'left', 0.2, {}, 'stagger_kneel'],
    ['bike_crash', {x: -1, z: 0}, 0.6, {side: -1, reason: 'lowside'}, 'bike_slide'],
  ]) {
    const kd = kdMod.createKnockdownState({seed: 3})
    const s0 = kd.triggerKnockdown(kind, dir, sev, {yaw: 0, ...opts})
    assert.equal(s0.variant, variant)
    const shake0 = kd.cameraShake
    const at = (u) => kdMod.knockdownBodyPose({...kd.getSnapshot(), phase: 'falling', fallU: u})
    // 撞击姿态：开头 10% 内身体已经明显被打歪
    const hit = at(0.1)
    const stand = at(0)
    assert(hit.qBody.angleTo(stand.qBody) > 0.1 || Math.abs(hit.ev.j.Torso[0]) + Math.abs(hit.ev.j.ArmL[2]) > 0.3, `${variant} 有撞击姿态`)
    // 落地停顿：最后 ≥10% 时间姿态不动
    const a = at(0.9)
    const b = at(1)
    assert(a.qBody.angleTo(b.qBody) < 0.02, `${variant} 落地后停顿`)
    for (const n of ['Torso', 'ArmL', 'ThighR']) assert(Math.abs(a.ev.j[n][0] - b.ev.j[n][0]) < 0.02)
    // 下落过程 → stunned；落地那一刻有一次额外震动
    let landedShakeBump = false
    let prevShake = shake0
    while (kd.phase === 'falling') {
      kd.step(DT)
      if (kd.cameraShake > prevShake + 1e-6) landedShakeBump = true
      prevShake = kd.cameraShake
    }
    assert.equal(kd.phase, 'stunned')
    assert(landedShakeBump || variant === 'front_launch' || variant === 'bike_slide', `${variant} 落地震一下`)
    // 下落末帧 = 缓气首帧（无缝衔接，不跳）
    const end = kdMod.knockdownBodyPose(kd.getSnapshot())
    assert(end.qBody.angleTo(b.qBody) < 0.12, `${variant} 下落→缓气无跳变 (${end.qBody.angleTo(b.qBody).toFixed(3)})`)
    poses.set(variant, mid(at))
  }
  // 六种倒法中段姿态两两不同
  const list = [...poses.entries()]
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      assert(list[i][1].angleTo(list[j][1]) > 0.15, `${list[i][0]} vs ${list[j][0]} 姿态要有区别`)
    }
  }
  function mid(at) {
    return at(0.45).qBody.clone()
  }
})

test('k47 缓一缓 ≥4 种状态随机切换，且关节姿态各不相同', () => {
  const kd = kdMod.createKnockdownState({seed: 11})
  kd.triggerKnockdown('vehicle_hit', 'front', 0.6, {yaw: 0})
  stepUntil(kd, () => kd.phase === 'stunned')
  const seen = new Map()
  const order = []
  for (let t = 0; t < 14; t += DT) {
    kd.step(DT)
    const snap = kd.getSnapshot()
    assert(snap.phase === 'stunned' || snap.phase === 'mashing')
    if (order[order.length - 1] !== snap.breathState) order.push(snap.breathState)
    if ((snap.breathBlend ?? 0) >= 0.999 && !seen.has(snap.breathState)) {
      seen.set(snap.breathState, kdMod.evaluateKnockdownPose(snap).j)
    }
  }
  assert.deepEqual([...seen.keys()].sort(), [...kdMod.KNOCKDOWN_BREATH_STATES].sort(), `看到的状态: ${[...seen.keys()]}`)
  assert(seen.size >= 4)
  assert(order.length >= 6, `14 秒内应切换多次: ${order.join('>')}`)
  for (let i = 1; i < order.length; i++) assert.notEqual(order[i], order[i - 1], '不会连续两次同一状态')
  // 4 种状态关节差异明显
  const flat = (j) => Object.values(j).flat()
  const states = [...seen.entries()]
  for (let i = 0; i < states.length; i++) {
    for (let k = i + 1; k < states.length; k++) {
      const a = flat(states[i][1])
      const b = flat(states[k][1])
      const diff = a.reduce((s, v, idx) => s + Math.abs(v - b[idx]), 0)
      assert(diff > 0.25, `${states[i][0]} vs ${states[k][0]} 关节差 ${diff.toFixed(3)}`)
    }
  }
  // 缓气中按空格不计数（必须先缓）
  const kd2 = kdMod.createKnockdownState()
  kd2.triggerKnockdown('vehicle_hit', 'left', 0.7, {yaw: 0})
  stepUntil(kd2, () => kd2.phase === 'stunned')
  assert.equal(kd2.handleKeyDown('Space'), false)
  assert.equal(kd2.mashCount, 0)
})

test('k47 爬起 3 段：按满 5 下才站起；超过 2.4 秒没按退回上一段；越按越晃', () => {
  const kd = kdMod.createKnockdownState({seed: 5})
  assert.equal(kd.mashRequired, 5)
  kd.triggerKnockdown('vehicle_hit', 'back', 0.85, {yaw: 0})
  stepUntil(kd, () => kd.phase === 'mashing')
  assert.equal(kd.recoverySegment, 0)

  const wobbles = []
  const segs = []
  assert.equal(kd.handleKeyDown('Space', true), false, '按住重复不算')
  for (let i = 1; i <= 4; i++) {
    assert.equal(kd.handleKeyDown('Space', false), false, `第 ${i} 下还站不起来`)
    wobbles.push(kd.getSnapshot().wobble)
    stepFor(kd, 0.3)
    segs.push(kd.recoverySegment)
    assert.equal(kd.isDown, true)
    assert.equal(kd.phase, 'mashing')
  }
  assert.deepEqual(segs, [1, 1, 2, 3], '1 下趴撑，3 下跪撑，4 下单膝')
  for (let i = 1; i < wobbles.length; i++) assert(wobbles[i] > wobbles[i - 1], `越按越晃 ${wobbles.map((w) => w.toFixed(2))}`)
  // 每段姿态不同：趴撑 → 跪撑 → 单膝，身体逐渐立起来
  const snap4 = kd.getSnapshot()
  assert(snap4.recoveryProgress > 2.8 && snap4.recoveryProgress < 3.3)

  // 超时：2.3 秒内不退；过 2.4 秒退回上一段（单膝 → 跪撑）
  stepFor(kd, 2.0)
  assert.equal(kd.recoverySegment, 3)
  stepFor(kd, 0.2)
  assert.equal(kd.recoverySegment, 2, '超过 2.4 秒退回跪撑')
  assert.equal(kd.getSnapshot().fallbackCount, 1)
  stepFor(kd, 2.45)
  assert.equal(kd.recoverySegment, 1, '再等 2.4 秒退回趴撑')
  stepFor(kd, 2.45)
  assert.equal(kd.recoverySegment, 0, '再等就趴回去')
  assert.equal(kd.mashCount, 0)
  assert.equal(kd.isDown, true)

  // 手机按钮（recordRecoverMash）连点 5 下：第 5 下才进入站起
  for (let i = 0; i < 4; i++) {
    assert.equal(kd.recordRecoverMash(), false)
    stepFor(kd, 0.2)
  }
  assert.equal(kd.recordRecoverMash(), true)
  assert.equal(kd.phase, 'rising')
  assert.equal(kd.isRecovering, true)
  assert.equal(kd.isDown, true, 'rising 过程中仍算倒地（站起 + 拍灰）')
  // rising：先站直，再拍灰（手臂上下拍）
  const riseSnap = (r) => kdMod.evaluateKnockdownPose({...kd.getSnapshot(), riseProgress: r})
  const standMid = kdMod.knockdownBodyPose({...kd.getSnapshot(), riseProgress: 0.62, wobble: 0})
  assert(standMid.qBody.angleTo(new THREE.Quaternion()) < 0.12, '站直')
  const forearms = [0.66, 0.72, 0.78, 0.84].map((r) => riseSnap(r).j.ForearmL[0])
  assert(Math.max(...forearms) - Math.min(...forearms) > 0.15, `拍灰手在动 ${forearms.map((v) => v.toFixed(2))}`)
  stepUntil(kd, () => kd.phase === 'idle', 3)
  assert.equal(kd.isDown, false)

  // 4 下后停太久 → 退段，补 1 下不能直接站起
  const kd2 = kdMod.createKnockdownState()
  kd2.triggerKnockdown('vehicle_hit', 'front', 0.6, {yaw: 0})
  stepUntil(kd2, () => kd2.phase === 'mashing')
  for (let i = 0; i < 4; i++) {
    kd2.recordRecoverMash()
    stepFor(kd2, 0.1)
  }
  stepFor(kd2, 2.5)
  assert.equal(kd2.recordRecoverMash(), false, '退段后第 5 下不够')
  assert.equal(kd2.phase, 'mashing')
})

test('k48 倒地镜头俯视补偿：倒下后平滑抬高俯角越过栏杆，起身时收回，站起后归零', () => {
  const kd = kdMod.createKnockdownState({seed: 9})
  const MAX = kdMod.KNOCKDOWN_CAMERA_PITCH_BIAS
  assert.ok(MAX >= 0.3 && MAX <= 0.6, `俯视补偿上限合理：${MAX}`)
  assert.equal(kd.cameraPitchBias, 0, '没倒地不加俯角')
  kd.triggerKnockdown('vehicle_hit', 'left', 0.8, {yaw: 0})
  let prev = 0
  let maxJump = 0
  const seen = []
  const dt = 1 / 60
  let mashes = 0
  for (let t = 0; t < 14 && kd.isDown; t += dt) {
    if (kd.phase === 'mashing' && mashes < 5 && Math.round(t / dt) % 18 === 0) {
      kd.recordRecoverMash()
      mashes++
    }
    kd.step(dt)
    const b = kd.cameraPitchBias
    assert.ok(Number.isFinite(b) && b >= 0 && b <= MAX + 1e-9)
    maxJump = Math.max(maxJump, Math.abs(b - prev))
    prev = b
    seen.push([kd.phase, b])
    assert.equal(kd.getSnapshot().cameraPitchBias, b)
  }
  assert.equal(kd.phase, 'idle')
  assert.equal(kd.cameraPitchBias, 0)
  assert.ok(maxJump < 0.05, `逐帧变化平滑：${maxJump.toFixed(3)}`)
  const peak = Math.max(...seen.filter(([ph]) => ph === 'mashing').map(([, b]) => b))
  assert.ok(peak > MAX * 0.9, `趴着时俯角接近上限：${peak.toFixed(3)}`)
  const rising = seen.filter(([ph]) => ph === 'rising').map(([, b]) => b)
  assert.ok(rising.length > 3 && rising.at(-1) < 0.05, `起身末尾俯角已收回：${rising.at(-1)?.toFixed(3)}`)
})

test('k47/k48 全程身体贴地：最低点在地面 0~0.3m（FK + 真骨骼）', async () => {
  const scene = await loadAvatarScene('figure')
  const rig = rigMod.ensureAvatarRig(scene)
  const bones = []
  scene.traverse((o) => {
    if (o.isBone && o.name !== 'root') bones.push(o)
  })
  const wp = new THREE.Vector3()
  const worst = {}
  const groundY = 151.85
  for (const [kind, dir, sev, opts] of [
    ['vehicle_hit', 'back', 0.95, {}],
    ['vehicle_hit', 'left', 0.7, {}],
    ['vehicle_hit', 'right', 0.5, {}],
    ['vehicle_hit', 'front', 0.6, {}],
    ['vehicle_hit', 'left', 0.2, {}],
    ['bike_crash', {x: 1, z: 0}, 0.9, {side: 1, reason: 'lowside'}],
  ]) {
    const kd = kdMod.createKnockdownState({seed: 9})
    scene.rotation.set(0, 0.7, 0)
    scene.position.set(0, groundY, 0)
    const s = kd.triggerKnockdown(kind, dir, sev, {yaw: 0.7, ...opts})
    const v = s.variant
    worst[v] = {min: 9, max: -9}
    let mashes = 0
    let since = 0
    for (let t = 0; t < 14 && kd.isDown; t += DT) {
      kd.step(DT)
      if (kd.phase === 'mashing' && (since += DT) > 0.35 && mashes < 5) {
        kd.recordRecoverMash()
        mashes++
        since = 0
      }
      const snap = kd.getSnapshot()
      if (!snap.isDown) break
      const {fp, ev} = kdMod.knockdownBodyPose(snap)
      assert(Math.abs(-fp.minY + fp.minY) < 1e-9)
      assert(ev.air >= 0 && ev.air <= 0.3, `${v} air ${ev.air}`)
      if (Math.round(t / DT) % 3 === 0) {
        kd.applyPose(scene, rig.joints, {x: 1, y: groundY, z: 2})
        rig.syncPose()
        scene.updateMatrixWorld(true)
        let low = Infinity
        for (const b of bones) low = Math.min(low, b.getWorldPosition(wp).y)
        const rel = low - groundY
        worst[v].min = Math.min(worst[v].min, rel)
        worst[v].max = Math.max(worst[v].max, rel)
      }
    }
    assert.equal(kd.isDown, false, `${v} 应该站起来了`)
  }
  for (const [v, w] of Object.entries(worst)) {
    assert(w.min > -0.06, `${v} 最低骨骼穿地 ${w.min.toFixed(3)}`)
    assert(w.max < 0.3, `${v} 最低骨骼悬空 ${w.max.toFixed(3)}`)
  }
})

test('ride.ts crash integration engages knockdown state & blocks impact crash auto-stand until 5 mashes', async () => {
  const bike = rideMod.createBikeControl()
  bike.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false})
  bike.steer(1, 0, 0.4, true)

  const initSnap = bike.triggerCrash('impact', 1)
  assert.equal(initSnap.phase, 'sliding')
  assert.equal(initSnap.knockdown.isDown, true)
  assert.equal(bike.knockdown.isDown, true)

  const scene = await loadAvatarScene('figure')
  rigMod.ensureAvatarRig(scene)
  const pose = rideMod.createRiderPose(scene)
  const midFallSnap = bike.stepCrash(0.18, {moveHeld: true})
  pose.applyCrashPhasePose(midFallSnap)
  assert(Math.abs(scene.rotation.x) > 0.2 || Math.abs(scene.rotation.z) > 0.2, 'crash pose rotates downed figure')

  // Slide down to downed state, advancing past autoRiseDelay
  let snap = midFallSnap
  for (let i = 0; i < 20; i++) snap = bike.stepCrash(0.1, {moveHeld: true})
  assert.equal(snap.phase, 'downed', 'impact crash must not auto-stand on moveHeld or timeout')
  assert.equal(snap.knockdown.phase, 'mashing')

  // 4 mashes keep rider downed
  for (let i = 0; i < 4; i++) assert.equal(bike.mashCrashRecover(), false)
  assert.equal(bike.crashPhase, 'downed')

  // 5th mash transitions rider_rising -> bike_down
  assert.equal(bike.mashCrashRecover(), true)
  assert.equal(bike.crashPhase, 'rider_rising')
  for (let i = 0; i < 15; i++) snap = bike.stepCrash(0.06)
  assert.equal(snap.phase, 'bike_down')
  assert.equal(snap.knockdown.isDown, false)
})

test('duty-props: whistle sits at the mouth by default (r6); with the chest mode on it travels from chest to mouth when blowing', async () => {
  const scene = await loadAvatarScene('figure')
  const rig = rigMod.ensureAvatarRig(scene)
  const always = propsMod.createDutyProps(scene, {rig})
  always.update(0)
  const alwaysProbe = always.getProbe()
  assert.equal(alwaysProbe.attachedToSkeleton, true)
  assert.equal(alwaysProbe.whistleAlwaysAtMouth, true)
  assert.equal(alwaysProbe.whistleMode, 'mouth')
  assert(alwaysProbe.whistleToMouthDist < 0.02, `默认口哨在嘴边 (dist=${alwaysProbe.whistleToMouthDist.toFixed(4)})`)
  always.dispose()

  const props = propsMod.createDutyProps(scene, {rig, whistleAlwaysAtMouth: false})
  props.update(0)
  const chestProbe = props.getProbe()
  assert.equal(chestProbe.attached, true)
  assert.equal(chestProbe.whistleVisible, true)
  assert.equal(chestProbe.flagVisible, true)
  assert.equal(chestProbe.whistleMode, 'chest')
  assert(chestProbe.whistleToChestDist < chestProbe.whistleToMouthDist)
  props.setWhistleBlowing(true)
  for (let i = 0; i < 8; i++) props.update(0.04)
  const mouthProbe = props.getProbe()
  assert.equal(mouthProbe.whistleMode, 'mouth')
  assert(mouthProbe.blowBlend >= 0.99)
  assert(mouthProbe.whistleToMouthDist < 0.02)
  assert(mouthProbe.whistleToMouthDist < chestProbe.whistleToMouthDist - 0.12, 'whistle travels from chest up to mouth')
  props.setFlagMode('pass')
  props.update(0.05)
  assert.equal(props.getProbe().flagMode, 'pass')
  props.setFlagMode('stowed')
  assert.equal(props.getProbe().flagVisible, false)
  props.dispose()
})

test('duty emotes (4=whistle, 5=flag_stop, 6=flag_pass) register cleanly and animate avatar bones on GLB rigs', async () => {
  assert.deepEqual(
    emotesMod.dutyEmotes.map((e) => e.key),
    ['duty_whistle', 'duty_flag_stop', 'duty_flag_pass'],
  )
  for (const id of [4, 5, 6]) {
    assert(emotesMod.emoteById(id), `emoteById(${id}) must resolve`)
    assert.equal(emotesMod.interrupted(id, true, false), false, `duty emote ${id} allows slow movement`)
    assert.equal(emotesMod.interrupted(id, false, true), true, `duty emote ${id} yields when busy`)
  }

  for (const body of ['figure', 'figure_m', 'figure_f']) {
    const scene = await loadAvatarScene(body)
    const emote = playbackMod.emotePlayback(scene)
    const point = (name) => scene.getObjectByName(name).getWorldPosition(new THREE.Vector3())

    // 4: Blow whistle -> left hand rises near head height
    emote.play(4)
    emote.tick(0.5, false)
    scene.updateMatrixWorld(true)
    const headPos = point('head')
    const leftHand = point('hand_l')
    assert.equal(emote.id, 4)
    assert(
      Math.abs(leftHand.y - headPos.y) < 0.22 && leftHand.distanceTo(headPos) < 0.34,
      `${body} duty_whistle hand_l (${leftHand.toArray().map((n) => n.toFixed(2))}) near head (${headPos.toArray().map((n) => n.toFixed(2))})`,
    )

    // 5: Flag stop -> left palm raised forward, right arm holds flag forward/up
    emote.play(5)
    emote.tick(0.5, false)
    scene.updateMatrixWorld(true)
    const chestStop = point('spine_03')
    const rightStop = point('hand_r')
    const leftStop = point('hand_l')
    assert.equal(emote.id, 5)
    assert(rightStop.z > chestStop.z + 0.2, `${body} stop right hand forward`)
    assert(leftStop.z > chestStop.z + 0.18 && leftStop.y > chestStop.y - 0.05, `${body} stop left palm raised`)

    // 6: Flag pass -> wide side-to-side sweep across waveform
    emote.play(6)
    emote.tick(0.32, true)
    scene.updateMatrixWorld(true)
    const passA = point('hand_r').clone()
    emote.tick(0.33, true)
    scene.updateMatrixWorld(true)
    const passB = point('hand_r').clone()
    assert.equal(emote.id, 6)
    assert(passA.distanceTo(passB) > 0.15, `${body} pass wave sweeps flag (${passA.distanceTo(passB).toFixed(3)}m)`)
  }
})

// —— r8-3 递交罚单动作（k71/k72）——
function handoverFrame(scene) {
  scene.updateMatrixWorld(true)
  const P = (n) => scene.getObjectByName(n).getWorldPosition(new THREE.Vector3())
  const sl = P('upperarm_l')
  const sr = P('upperarm_r')
  const left = sl.clone().sub(sr).setY(0).normalize()
  const forward = new THREE.Vector3().crossVectors(left, new THREE.Vector3(0, 1, 0)).normalize()
  const pelvis = P('pelvis')
  const ground = Math.min(P('foot_l').y, P('foot_r').y) - 0.08
  return {P, left, forward, pelvis, ground}
}
// 角度 deg：0＝正前方，正数往角色左边转
function handoverTarget(fr, deg, dist, height) {
  const a = (deg * Math.PI) / 180
  const dir = fr.forward.clone().multiplyScalar(Math.cos(a)).addScaledVector(fr.left, Math.sin(a))
  return new THREE.Vector3(fr.pelvis.x, fr.ground + height, fr.pelvis.z).addScaledVector(dir, dist)
}
// angleTo 在 float32 四元数上有 ~5e-4 的 acos 噪声，逐分量比较才准
const quatSame = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z), Math.abs(a.w - b.w)) < 1e-6
function snapshotBones(scene) {
  const out = new Map()
  scene.traverse((o) => {
    if (o.isBone) out.set(o, {q: o.quaternion.clone(), p: o.position.clone()})
  })
  return out
}
function runHandover(h, scene, opts, dt = 1 / 60) {
  const log = {phases: [], events: [], minDist: Infinity, holdDist: [], done: null, footRear: [], footFront: [], minFootY: Infinity}
  const ok = h.play({
    ...opts,
    onTear: (s) => log.events.push(['tear', s, h.elapsed]),
    onDeliver: (s) => {
      log.events.push(['deliver', s, h.elapsed])
      log.deliverDist = h.gripWorldPosition(s).distanceTo(opts.targetWorldPos)
    },
    onDone: (c) => (log.done = c),
  })
  if (!ok) return {ok, log}
  for (let t = 0; t < 6 && h.active; t += dt) {
    h.reset()
    h.tick(dt)
    if (!h.active) break
    if (log.phases.at(-1) !== h.phase) log.phases.push(h.phase)
    const g = h.gripWorldPosition(h.side)
    const d = g.distanceTo(opts.targetWorldPos)
    log.minDist = Math.min(log.minDist, d)
    if (h.phase === 'hold') log.holdDist.push(d)
    const rear = h.side === 'left' ? 'foot_r' : 'foot_l'
    const front = h.side === 'left' ? 'foot_l' : 'foot_r'
    log.footRear.push(scene.getObjectByName(rear).getWorldPosition(new THREE.Vector3()))
    log.footFront.push(scene.getObjectByName(front).getWorldPosition(new THREE.Vector3()))
    for (const n of ['foot_l', 'foot_r', 'ball_l', 'ball_r']) log.minFootY = Math.min(log.minFootY, scene.getObjectByName(n).getWorldPosition(new THREE.Vector3()).y)
  }
  h.reset()
  h.tick(dt)
  return {ok, log}
}

test('k71/k72 递交罚单：就近选手、1.2m 内握点 <0.12m 送到对方手上、四段动作、结束复原、够不到返回 false（真 GLB 骨骼）', async () => {
  const {createTicketHandover, TICKET_HANDOVER_TIMING, bindTicketHandover, playTicketHandover, checkTicketHandover} = handoverMod
  for (const body of ['figure', 'figure_m', 'figure_f']) {
    const scene = await loadAvatarScene(body)
    // 随便给根节点一个朝向和位置：方向全靠骨骼推，不能依赖根节点约定
    scene.rotation.y = 0.7
    scene.position.set(12, 151.85, -4)
    const h = createTicketHandover(scene)
    const fr = handoverFrame(scene)
    const base = snapshotBones(scene)

    // 1) 就近选手：目标在左用左手，在右用右手
    for (const [deg, want] of [[50, 'left'], [-50, 'right'], [85, 'left'], [-85, 'right'], [20, 'left'], [-20, 'right']]) {
      const c = h.check(handoverTarget(fr, deg, 0.9, 1.05))
      assert.equal(c.ok, true, `${body} ${deg}° 应该够得到：${c.reason}`)
      assert.equal(c.side, want, `${body} 目标在 ${deg}° 应该用${want === 'left' ? '左' : '右'}手`)
    }

    // 2) 1.2m 以内都能把握点送到对方手上（<0.12m），四段顺序完整，扯单在塞单之前
    let worstHold = 0
    let worstDeliver = 0
    for (const dist of [0.55, 0.9, 1.2]) {
      for (const deg of [-80, -40, 0, 40, 80]) {
        for (const height of [0.9, 1.15]) {
          const tgt = handoverTarget(fr, deg, dist, height)
          const {ok, log} = runHandover(h, scene, {targetWorldPos: tgt})
          const tag = `${body} d=${dist} ${deg}° h=${height}`
          assert.equal(ok, true, `${tag} 应该能递 ${JSON.stringify(h.check(tgt))}`)
          assert.deepEqual(log.phases, ['tear', 'reach', 'hold', 'retract'], `${tag} 四段`)
          assert.deepEqual(log.events.map((e) => e[0]), ['tear', 'deliver'], `${tag} 先扯单后塞单`)
          assert.equal(log.done, true)
          assert.ok(log.events[0][2] < TICKET_HANDOVER_TIMING.tear + 1e-6, '扯单发生在扯单段')
          const holdMid = log.holdDist[Math.floor(log.holdDist.length / 2)]
          worstHold = Math.max(worstHold, holdMid)
          worstDeliver = Math.max(worstDeliver, log.deliverDist)
          assert.ok(holdMid < 0.12, `${tag} 停顿时握点离目标 ${holdMid.toFixed(3)}m`)
          assert.ok(log.deliverDist < 0.12, `${tag} 塞单瞬间握点离目标 ${log.deliverDist.toFixed(3)}m`)
          // 后脚钉地（<3cm），脚不穿地
          const r0 = log.footRear[0]
          const rearSlide = Math.max(...log.footRear.map((p) => Math.hypot(p.x - r0.x, p.z - r0.z)))
          assert.ok(rearSlide < 0.03, `${tag} 后脚滑了 ${rearSlide.toFixed(3)}m`)
          assert.ok(log.minFootY > fr.ground - 0.03, `${tag} 脚穿地 ${(log.minFootY - fr.ground).toFixed(3)}`)
          // 结束后骨骼回到原样
          scene.updateMatrixWorld(true)
          for (const [o, b] of base) {
            assert.ok(quatSame(o.quaternion, b.q), `${tag} ${o.name} 没复原`)
            assert.ok(o.position.distanceTo(b.p) < 1e-6, `${tag} ${o.name} 位置没复原`)
          }
        }
      }
    }
    if (body === 'figure') console.log(`  handover worst hold=${worstHold.toFixed(3)}m deliver=${worstDeliver.toFixed(3)}m`)

    // 3) 远处迈半步：1.2m 前方时前脚确实迈出去、骨盆下沉
    {
      const {log} = runHandover(h, scene, {targetWorldPos: handoverTarget(fr, -30, 1.2, 1.0)})
      const f0 = log.footFront[0]
      const step = Math.max(...log.footFront.map((p) => Math.hypot(p.x - f0.x, p.z - f0.z)))
      assert.ok(step > 0.25, `${body} 1.2m 要迈半步，前脚只动了 ${step.toFixed(3)}m`)
    }

    // 4) 够不到 / 在身后 / 太高 → false，且什么都不动
    for (const [deg, dist, height, reason] of [[0, 2.0, 1.0, 'too_far'], [60, 1.9, 1.0, 'too_far'], [180, 0.7, 1.0, 'behind'], [0, 0.6, 2.4, 'too_high'], [0, 0.6, 0.1, 'too_low']]) {
      const tgt = handoverTarget(fr, deg, dist, height)
      const c = h.check(tgt)
      assert.equal(c.ok, false, `${body} ${deg}° ${dist}m ${height}m 不该能递`)
      assert.equal(c.reason, reason)
      assert.equal(h.play({targetWorldPos: tgt}), false)
      assert.equal(h.active, false)
    }

    // 5) 左右手都能强制指定；打断能立刻复原；目标丢失算失败
    {
      const tgt = handoverTarget(fr, 0, 0.8, 1.05)
      assert.equal(h.play({targetWorldPos: tgt, side: 'left'}), true)
      assert.equal(h.side, 'left')
      for (let i = 0; i < 40; i++) {
        h.reset()
        h.tick(1 / 60)
      }
      let done = null
      h.stop()
      h.reset()
      scene.updateMatrixWorld(true)
      for (const [o, b] of base) assert.ok(quatSame(o.quaternion, b.q), `stop 后 ${o.name} 没复原`)
      let alive = true
      assert.equal(h.play({targetWorldPos: () => (alive ? tgt : null), side: 'right', onDone: (c) => (done = c)}), true)
      h.reset()
      h.tick(1 / 60)
      alive = false
      h.reset()
      h.tick(1 / 60)
      assert.equal(done, false, '递出去之前目标消失 → onDone(false)')
      assert.equal(h.active, false)
    }

    // 6) 默认实例入口（给 Carbon 用）
    bindTicketHandover(h)
    const tgt = handoverTarget(fr, -30, 0.8, 1.05)
    assert.equal(checkTicketHandover(tgt).side, 'right')
    assert.equal(playTicketHandover({targetWorldPos: tgt}), true)
    h.stop()
    h.reset()
    bindTicketHandover(null)
    assert.equal(playTicketHandover({targetWorldPos: tgt}), false)
  }
})

test('k80/k81 腰挂打印机重做：蓝白涂装 + 护角 + 锯齿出纸口 + 屏幕键盘 + 背夹；凭条锯齿撕口 + 虚构编号/二维码；出纸口对齐递单动作，左右手都捏得住凭条（真 GLB 骨骼）', async () => {
  const {createTicketHandover} = handoverMod
  const {createDutyProps, getDutyPrinterSlotWorldPosition} = propsMod
  for (const body of ['figure', 'figure_m', 'figure_f']) {
    const scene = await loadAvatarScene(body)
    const rig = rigMod.ensureAvatarRig(scene)
    const props = createDutyProps(scene, {rig})
    props.setVisible(true)
    props.update(0)
    scene.updateMatrixWorld(true)

    // 1) 模型零件齐全
    const need = [
      'printer_chassis', 'printer_white_faceplate', 'printer_reflective_band', 'printer_thermal_hood',
      'printer_bumper_tl', 'printer_bumper_tr', 'printer_bumper_bl', 'printer_bumper_br',
      'printer_grip_left', 'printer_grip_right', 'printer_paper_slot', 'printer_serrated_cutter', 'printer_paper_tongue',
      'printer_paper_slot_anchor', 'printer_status_led', 'printer_screen_bezel', 'printer_lcd_face', 'printer_lcd_ui',
      'printer_keypad', 'printer_confirm_key', 'printer_cancel_key', 'printer_belt_clip',
    ]
    for (const n of need) assert.ok(props.printerGroup.getObjectByName(n), `${body} 打印机缺零件 ${n}`)
    for (const n of ['holster_leather_pouch', 'holster_bottom_cup', 'holster_side_rails', 'holster_belt_loop', 'holster_retaining_strap', 'holster_brass_snap']) {
      assert.ok(props.holsterGroup.getObjectByName(n), `${body} 快拔套缺零件 ${n}`)
    }
    const col = (n) => props.printerGroup.getObjectByName(n).material.color
    const blue = col('printer_chassis')
    assert.ok(blue.b > blue.r * 2.5 && blue.b > 0.3, `${body} 主壳是警用蓝 (${blue.getHexString()})`)
    const white = col('printer_white_faceplate')
    assert.ok(Math.min(white.r, white.g, white.b) > 0.8, `${body} 面板是白色 (${white.getHexString()})`)
    // 锯齿撕纸刀：16 个齿
    const cutter = props.printerGroup.getObjectByName('printer_serrated_cutter').geometry
    cutter.computeBoundingBox()
    const cutterPos = cutter.getAttribute('position')
    const tips = new Set()
    for (let i = 0; i < cutterPos.count; i++) if (cutterPos.getY(i) > cutter.boundingBox.max.y - 1e-5) tips.add(cutterPos.getX(i).toFixed(4))
    assert.equal(tips.size, 16, `${body} 撕纸刀 16 个齿尖 (got ${tips.size})`)
    // 凭条：上下两端都是锯齿，虚构二维码模块 >100 个
    const sheet = props.handSlipGroup.getObjectByName('torn_receipt_sheet')
    const sg = sheet.geometry
    sg.computeBoundingBox()
    const sp = sg.getAttribute('position')
    const topTips = new Set()
    const botTips = new Set()
    for (let i = 0; i < sp.count; i++) {
      if (sp.getY(i) > sg.boundingBox.max.y - 1e-5) topTips.add(sp.getX(i).toFixed(4))
      if (sp.getY(i) < sg.boundingBox.min.y + 1e-5) botTips.add(sp.getX(i).toFixed(4))
    }
    assert.ok(topTips.size >= 12 && botTips.size >= 12, `${body} 凭条两端锯齿撕口 (top=${topTips.size} bottom=${botTips.size})`)
    const inkQuads = props.handSlipGroup.getObjectByName('torn_receipt_qr_mark').geometry.getAttribute('position').count / 6
    assert.ok(inkQuads > 100, `${body} 凭条有虚构二维码和字行 (quads=${inkQuads})`)
    // draw call 预算：打印机 + 套 + 凭条一共 ≤ 36 个网格
    let meshes = 0
    for (const g of [props.printerGroup, props.holsterGroup, props.handSlipGroup]) g.traverse((o) => { if (o.isMesh) meshes++ })
    assert.ok(meshes <= 36, `${body} 网格数 ${meshes} ≤ 36`)

    // 2) 挂在右胯前侧皮带上、屏幕朝前偏外
    const fr = handoverFrame(scene)
    const slot = getDutyPrinterSlotWorldPosition(props)
    assert.ok(slot, `${body} 能取到出纸口世界坐标`)
    const rel = slot.clone().sub(fr.pelvis)
    const right = -rel.dot(fr.left)
    const fwd = rel.dot(fr.forward)
    assert.ok(right > 0.08 && right < 0.24, `${body} 出纸口在右胯 (right=${right.toFixed(3)})`)
    assert.ok(fwd > -0.03 && fwd < 0.2, `${body} 出纸口在胯前侧 (fwd=${fwd.toFixed(3)})`)
    assert.ok(rel.y > 0 && rel.y < 0.2, `${body} 出纸口在皮带高度 (up=${rel.y.toFixed(3)})`)
    const lcd = props.printerGroup.getObjectByName('printer_lcd_face')
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(lcd.getWorldQuaternion(new THREE.Quaternion()))
    assert.ok(n.dot(fr.forward) > 0.4, `${body} 屏幕朝前 (dot=${n.dot(fr.forward).toFixed(2)})`)
    assert.ok(-n.dot(fr.left) > 0.2, `${body} 屏幕偏外 (dot=${(-n.dot(fr.left)).toFixed(2)})`)

    // 3) 递单动作用真实出纸口：扯单时手到出纸口 <3cm；onTear 把凭条捏到递单那只手上，左右手都行
    const h = createTicketHandover(scene)
    for (const [deg, want] of [[-40, 'right'], [40, 'left']]) {
      const tgt = handoverTarget(fr, deg, 0.9, 1.05)
      let minSlot = Infinity
      let tornSide = null
      let slipGap = Infinity
      let reachGap = Infinity
      const ok = h.play({
        targetWorldPos: tgt,
        printerWorldPos: () => getDutyPrinterSlotWorldPosition(props),
        onTear: (s) => {
          tornSide = s
          props.tearOffSlip(s)
        },
      })
      assert.equal(ok, true, `${body} ${deg}° 能递`)
      assert.equal(h.side, want)
      for (let t = 0; t < 4 && h.active; t += 1 / 60) {
        h.reset()
        h.tick(1 / 60)
        if (!h.active) break
        scene.updateMatrixWorld(true)
        if (h.phase === 'tear') minSlot = Math.min(minSlot, h.gripWorldPosition(h.side).distanceTo(getDutyPrinterSlotWorldPosition(props)))
        if (h.phase === 'hold') {
          // 凭条近手那端（-Y）在掌心附近，纸本身伸到对方手上
          const nearEnd = sheet.localToWorld(new THREE.Vector3(0, -0.05, 0))
          slipGap = Math.min(slipGap, nearEnd.distanceTo(h.gripWorldPosition(h.side)))
          for (let k = -0.05; k <= 0.0501; k += 0.025) reachGap = Math.min(reachGap, sheet.localToWorld(new THREE.Vector3(0, k, 0)).distanceTo(tgt))
        }
      }
      h.reset()
      h.tick(1 / 60)
      assert.equal(tornSide, want, `${body} 凭条扯到${want === 'left' ? '左' : '右'}手`)
      assert.ok(minSlot < 0.03, `${body} ${want} 扯单时手到出纸口 ${minSlot.toFixed(3)}m < 0.03`)
      assert.equal(props.getProbe().handSlipVisible, true)
      const handBone = scene.getObjectByName(want === 'left' ? 'hand_l' : 'hand_r')
      let p = props.handSlipGroup.parent
      while (p && p !== handBone) p = p.parent
      assert.equal(p, handBone, `${body} 凭条挂在${want}手骨下`)
      assert.ok(slipGap < 0.07, `${body} ${want} 递单时凭条根部捏在指间：离掌心握点 ${slipGap.toFixed(3)}m < 0.07`)
      assert.ok(reachGap < 0.06, `${body} ${want} 凭条送到对方手上：纸离对方手 ${reachGap.toFixed(3)}m < 0.06`)
      props.clearHandSlip()
      assert.equal(props.getProbe().handSlipVisible, false)
      console.log(`  printer ${body} ${want}: slot→grip ${minSlot.toFixed(3)}m, slip→grip ${slipGap.toFixed(3)}m, slip→target ${reachGap.toFixed(3)}m`)
    }
    props.dispose()
  }
})

test('high_fall thresholds reject flat jumps/stairs, scale light->heavy, and complete 5-mash recovery across all 5 KnockdownKinds', () => {
  const flatJump = kdMod.evaluateHighFallImpact({peakDropM: 1.2, netDropM: 0, landingSpeedMs: 8.2, yaw: 0})
  assert.equal(flatJump, null, '1.2m flat jump must not trigger high_fall')
  const stairDrop = kdMod.evaluateHighFallImpact({peakDropM: 2.1, netDropM: 1.4, landingSpeedMs: 10.2, yaw: 0})
  assert.equal(stairDrop, null, 'normal stairs/1.4m curb must not trigger high_fall')

  const light = kdMod.evaluateHighFallImpact({peakDropM: 2.8, netDropM: 2.2, landingSpeedMs: 11.2, horizontalVx: 0, horizontalVz: 0, yaw: 0.4})
  const medium = kdMod.evaluateHighFallImpact({peakDropM: 4.5, netDropM: 4.2, landingSpeedMs: 14.5, horizontalVx: 3.0, horizontalVz: 0, yaw: 0})
  const heavy = kdMod.evaluateHighFallImpact({peakDropM: 7.2, netDropM: 6.8, landingSpeedMs: 18.0, horizontalVx: 0, horizontalVz: 0, yaw: 0})
  assert.ok(light && medium && heavy)
  assert.equal(light.tier, 'light')
  assert.equal(medium.tier, 'medium')
  assert.equal(heavy.tier, 'heavy')
  assert(light.severity < medium.severity && medium.severity < heavy.severity, 'severity must increase with drop height/speed')

  const straightFallKd = kdMod.createKnockdownState({seed: 3})
  const straightSnap = straightFallKd.triggerKnockdown('high_fall', light.dir, light.severity, {
    yaw: 0.4,
    fallHeight: light.fallHeight,
    verticalSpeed: light.verticalSpeed,
    impactSpeed: light.impactSpeed,
    fromRide: false,
  })
  assert.equal(straightSnap.kind, 'high_fall')
  assert(Math.hypot(straightSnap.knockbackVel.x, straightSnap.knockbackVel.z) < 0.35, 'straight-down high_fall must not rocket horizontally')

  for (const kind of ['vehicle_hit', 'bike_crash', 'high_fall', 'ebike_slip', 'obstacle_trip']) {
    const kd = kdMod.createKnockdownState({seed: 7})
    const snap0 = kd.triggerKnockdown(kind, 'front', 0.68, {yaw: 0.2})
    assert.equal(snap0.kind, kind)
    assert.equal(kd.isDown, true)
    let elapsed = 0
    while (kd.phase === 'falling' || kd.phase === 'stunned') {
      kd.step(1 / 60)
      elapsed += 1 / 60
      assert(elapsed < 6, `${kind} stalled before mashing`)
    }
    assert.equal(kd.phase, 'mashing')
    for (let m = 0; m < 5; m++) {
      assert.equal(kd.recordRecoverMash(), m === 4)
      kd.step(0.05)
    }
    assert.equal(kd.phase, 'rising')
    while (kd.isDown) {
      kd.step(1 / 60)
      elapsed += 1 / 60
      assert(elapsed < 10, `${kind} stalled in rising`)
    }
    assert.equal(kd.phase, 'idle')
  }
})

test('triggerBikeSlipKnockdown and ride.ts triggerSlip + high-speed corner emergency-brake slip flow cleanly', () => {
  const slipCtrl = kdMod.createKnockdownState({seed: 11})
  const slipSnap = kdMod.triggerBikeSlipKnockdown({yaw: 0.5, side: -1, speedMs: 8.6, reason: 'shared_turn_slip', controller: slipCtrl})
  assert.equal(slipSnap.kind, 'ebike_slip')
  assert.equal(slipSnap.variant, 'bike_slide')
  assert.equal(slipCtrl.isDown, true)

  const bike = rideMod.createBikeControl()
  bike.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false, parkStart: false})
  bike.setGear(4)
  // Straight-line hard brake from high speed must NOT tip over
  for (let i = 0; i < 40; i++) bike.steer(1, 0, 0.05, true)
  assert(bike.speed > 7.5)
  for (let i = 0; i < 20; i++) bike.steer(-1, 0, 0.05, true)
  assert.equal(bike.crashPhase, 'none', 'straight emergency braking should not slip-crash')

  // Short 0.15s brake tap while turning must NOT slip-crash (preserves S-gear tap stability)
  for (let i = 0; i < 45; i++) bike.steer(1, 0, 0.05, true)
  for (let i = 0; i < 3; i++) bike.steer(-1, 1, 0.05, true)
  assert.equal(bike.crashPhase, 'none', 'brief 0.15s corner brake tap must stay upright')

  // Sustained high-speed cornering emergency brake triggers slip crash
  for (let i = 0; i < 40; i++) bike.steer(1, 0, 0.05, true)
  for (let i = 0; i < 22; i++) {
    bike.steer(-1, 1, 0.05, true)
    if (bike.crashPhase !== 'none') break
  }
  assert.equal(bike.crashPhase, 'sliding')
  assert.equal(bike.crashState.reason, 'slip')
  assert.equal(bike.crashState.knockdown.kind, 'ebike_slip')

  // Explicit triggerSlip API engages knockdown & recovers on 5 mashes
  const bike2 = rideMod.createBikeControl()
  bike2.mount(0.3, 0, 'bike', {vehicleType: 'shared', autoCrash: true, drainEnabled: false, parkStart: false})
  bike2.steer(1, 0.5, 0.35, true)
  const trigSnap = bike2.triggerSlip({side: 1})
  assert.equal(trigSnap.reason, 'slip')
  assert.equal(trigSnap.knockdown.kind, 'ebike_slip')
  let crashSnap = trigSnap
  for (let i = 0; i < 20; i++) crashSnap = bike2.stepCrash(0.1)
  assert.equal(crashSnap.phase, 'downed')
  for (let i = 0; i < 4; i++) assert.equal(bike2.mashCrashRecover(), false)
  assert.equal(bike2.mashCrashRecover(), true)
  for (let i = 0; i < 15; i++) crashSnap = bike2.stepCrash(0.06)
  assert.equal(crashSnap.phase, 'bike_down')
  assert.equal(crashSnap.knockdown.isDown, false)
})

test('applyKnockdownPose aligns with 20° slopes and holds elevated bridge decks without sinking or clipping (real GLB bones)', async () => {
  const scene = await loadAvatarScene('figure')
  const rig = rigMod.ensureAvatarRig(scene)
  const bones = []
  scene.traverse((o) => {
    if (o.isBone && o.name !== 'root') bones.push(o)
  })
  const wp = new THREE.Vector3()
  const slopeY = (x, _z) => 150 + 0.36 * x
  const kdSlope = kdMod.createKnockdownState({seed: 19})
  scene.rotation.set(0, 0.3, 0)
  kdSlope.triggerKnockdown('vehicle_hit', 'back', 0.8, {yaw: 0.3})
  let worstSlopeSink = Infinity
  let worstSlopeClearance = Infinity
  let mashes = 0
  let since = 0
  const DT = 1 / 60
  for (let t = 0; t < 14 && kdSlope.isDown; t += DT) {
    kdSlope.step(DT)
    if (kdSlope.phase === 'mashing' && (since += DT) > 0.3 && mashes < 5) {
      kdSlope.recordRecoverMash()
      mashes++
      since = 0
    }
    if (!kdSlope.isDown) break
    if (Math.round(t / DT) % 3 === 0) {
      const bx = 2.0, bz = -1.0
      kdSlope.applyPose(scene, rig.joints, {x: bx, y: slopeY(bx, bz), z: bz}, slopeY)
      rig.syncPose()
      scene.updateMatrixWorld(true)
      let minDelta = Infinity
      for (const b of bones) {
        b.getWorldPosition(wp)
        minDelta = Math.min(minDelta, wp.y - slopeY(wp.x, wp.z))
      }
      worstSlopeSink = Math.min(worstSlopeSink, minDelta)
      if (kdSlope.phase === 'stunned' || kdSlope.phase === 'mashing') {
        worstSlopeClearance = Math.min(worstSlopeClearance, minDelta)
      }
    }
  }
  assert.equal(kdSlope.isDown, false)
  assert(worstSlopeSink > -0.08, `20° slope lowest bone must not clip below ramp: ${worstSlopeSink.toFixed(3)}m`)
  assert(worstSlopeClearance < 0.32, `20° slope body must stay resting on ramp: ${worstSlopeClearance.toFixed(3)}m`)

  // Bridge edge scenario: deck at 156m for x <= 1.25, riverbed 148m beyond deck edge
  const bridgeEdgeY = (x, _z) => (x <= 1.25 ? 156.0 : 148.0)
  const kdBridge = kdMod.createKnockdownState({seed: 23})
  scene.rotation.set(0, -1.57, 0)
  kdBridge.triggerKnockdown('bike_crash', {x: 1, z: 0}, 0.85, {yaw: -1.57, side: 1, reason: 'lowside'})
  for (let i = 0; i < 65; i++) kdBridge.step(DT)
  kdBridge.applyPose(scene, rig.joints, {x: 0.9, y: 156.0, z: 0}, bridgeEdgeY)
  rig.syncPose()
  scene.updateMatrixWorld(true)
  let minBridgeBoneY = Infinity
  for (const b of bones) {
    minBridgeBoneY = Math.min(minBridgeBoneY, b.getWorldPosition(wp).y)
  }
  assert(minBridgeBoneY >= 155.9, `bridge deck knockdown must stay supported above deck (not fall to 148m river): minY=${minBridgeBoneY.toFixed(3)}`)
})
