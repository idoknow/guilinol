import {before, after, test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'

const threeEntryUrl = import.meta.resolve('three')

let tempDir
let rigMod
let locoMod

async function loadAvatarScene(file = 'figure_m') {
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
  const {scene, animations} = await new GLTFLoader().parseAsync(data, '')
  return {scene, animations}
}

function measureSoleLocalY(scene, rig) {
  scene.updateMatrixWorld(true)
  let minY = Infinity
  const v = new THREE.Vector3()
  for (const fp of rig.footProbes) {
    for (const pt of fp.points) {
      v.copy(pt).applyMatrix4(fp.joint.matrixWorld)
      if (v.y < minY) minY = v.y
    }
  }
  return minY
}

before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'glol-loco-test-'))
  const resolveThree = {
    name: 'resolve-three',
    setup(buildCtx) {
      buildCtx.onResolve({filter: /^three(\/.*)?$/}, args => ({path: import.meta.resolve(args.path), external: true}))
    },
  }
  const entries = [
    ['rig', 'web/src/walk/avatar-rig.ts'],
    ['loco', 'web/src/walk/locomotion-anim.ts'],
  ]
  const loaded = {}
  for (const [key, entry] of entries) {
    const outfile = join(tempDir, `${key}.mjs`)
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      mainFields: ['module', 'main'],
      plugins: [resolveThree],
      external: ['three/*', threeEntryUrl],
    })
    loaded[key] = await import(pathToFileURL(outfile).href)
  }
  rigMod = loaded.rig
  locoMod = loaded.loco
})

after(async () => {
  if (tempDir) await rm(tempDir, {recursive: true, force: true})
})

test('男女跑步参数显著差异化且克制自然（步频、步幅、前倾、臂展、小臂内收、骨盆律动与裙摆保护）', () => {
  const {LOCOMOTION_PROFILES, sampleGait, createGaitSample} = locoMod
  const pm = LOCOMOTION_PROFILES.m
  const pf = LOCOMOTION_PROFILES.f

  // 女性步频明显高于男性约 12%~20%，跑步步幅更精致且受裙摆分裂上限保护
  const cadenceRatio = pf.cadence / pm.cadence
  assert.ok(cadenceRatio >= 1.10 && cadenceRatio <= 1.22, `cadenceRatio=${cadenceRatio}`)
  assert.ok(pm.runStride > pf.runStride, '男性跑步步幅应大于女性')
  assert.ok(pf.splitMax < pm.splitMax && pf.thighFwdMax < pm.thighFwdMax, '女性大腿张角与劈叉上限应保护裙摆')

  // 采样中速跑 (5.0 m/s) 与疾跑 (9.0 m/s)
  for (const speed of [5.0, 9.0]) {
    const gm = sampleGait(pm, speed, 0.963, createGaitSample())
    const gf = sampleGait(pf, speed, 0.907, createGaitSample())

    assert.ok(gf.cadence > gm.cadence * 1.08, `v=${speed}: 女性步频应明显快于男性`)
    assert.ok(Math.abs(gm.lean) > Math.abs(gf.lean), `v=${speed}: 男性躯干前倾应更有力量推进感`)
    assert.ok(gm.abduct > gf.abduct * 1.8, `v=${speed}: 男性大臂外展更宽阔，女性更微贴躯干`)
    assert.ok(gf.forearmIn > gm.forearmIn * 2.0, `v=${speed}: 女性小臂更自然向胸前内收轻摆`)
    assert.ok(gm.armSwing > gf.armSwing, `v=${speed}: 男性前后摆臂弧度更大更干脆`)
    assert.ok(gf.pelvisRoll > gm.pelvisRoll && gf.sway > gm.sway, `v=${speed}: 女性髋部微律动更柔和灵动`)
    assert.ok(gm.chestYaw > gf.chestYaw, `v=${speed}: 男性胸廓反相扭转更沉稳有力`)
    // 防止过度夸张刻板
    assert.ok(gf.pelvisRoll <= 0.08 && gf.sway <= 0.02, `v=${speed}: 女性骨盆律动须保持克制真实`)
  }
})

test('慢走 / 跑步 / 疾跑连续速度谱单调递进（步频、抬膝、摆臂、前倾、脚踝迎角）', () => {
  const {LOCOMOTION_PROFILES, sampleGait, createGaitSample} = locoMod
  for (const body of ['m', 'f']) {
    const p = LOCOMOTION_PROFILES[body]
    const scale = body === 'm' ? 0.963 : 0.907
    const walk = sampleGait(p, 1.65, scale, createGaitSample())
    const run = sampleGait(p, 5.0, scale, createGaitSample())
    const sprint = sampleGait(p, 9.0, scale, createGaitSample())

    assert.ok(walk.cadence < run.cadence && run.cadence < sprint.cadence, `${body}: 步频应随速度递增`)
    assert.ok(walk.lift < run.lift && run.lift < sprint.lift, `${body}: 摆动腿抬高应随速度递增`)
    assert.ok(walk.armSwing < run.armSwing && run.armSwing < sprint.armSwing, `${body}: 摆臂幅度应递增`)
    assert.ok(Math.abs(walk.lean) < Math.abs(run.lean) && Math.abs(run.lean) < Math.abs(sprint.lean), `${body}: 前倾应递增`)
    assert.ok(walk.duty > run.duty && run.duty > sprint.duty, `${body}: 支撑占空比应随速度递减（从双支撑到腾空）`)
    assert.ok(walk.pitchStrike > run.pitchStrike && run.pitchStrike > sprint.pitchStrike, `${body}: 应由足跟着地平滑过渡到前掌着地`)
  }
})

test('跳跃全五阶段（takeoff → rise → apex → fall → land）与落地欠阻尼回弹曲线', () => {
  const {LOCOMOTION_PROFILES, DEFAULT_LOCOMOTION_METRICS, createLocomotionState, createLocomotionPose, sampleLocomotionPose, resolveJumpPhase, landingCurve} = locoMod

  // 1) 离散阶段解析覆盖全部 5 个跳跃阶段 + none
  assert.equal(resolveJumpPhase(true, true, 0.04, 6.5, false, 0.1), 'takeoff')
  assert.equal(resolveJumpPhase(true, true, 0.18, 4.2, false, 0.1), 'rise')
  assert.equal(resolveJumpPhase(true, true, 0.34, 0.3, false, 0.1), 'apex')
  assert.equal(resolveJumpPhase(true, true, 0.50, -4.8, false, 0.1), 'fall')
  assert.equal(resolveJumpPhase(false, false, 0, 0, true, 0.1), 'land')
  assert.equal(resolveJumpPhase(false, false, 0, 0, false, 0.1), 'none')

  // 2) 落地曲线：起点终点严格为 0，约 20% 处达正向压缩峰值，后段有轻微负向弹性回弹过冲
  assert.equal(landingCurve(0, 0.3), 0)
  assert.equal(landingCurve(0.3, 0.3), 0)
  let maxVal = -Infinity, minVal = Infinity, peakAt = 0
  for (let i = 1; i < 60; i++) {
    const t = (i / 60) * 0.3
    const v = landingCurve(t, 0.3)
    if (v > maxVal) { maxVal = v; peakAt = t / 0.3 }
    if (v < minVal) minVal = v
  }
  assert.ok(maxVal > 0.92 && maxVal < 1.08, `peak=${maxVal}`)
  assert.ok(peakAt > 0.12 && peakAt < 0.30, `peakAt=${peakAt}`)
  assert.ok(minVal < -0.05 && minVal > -0.22, `elastic overshoot=${minVal}`)

  // 3) 采样对比：上升展体 vs 顶点微收 vs 下落预备伸腿 vs 落地缓冲
  const pm = LOCOMOTION_PROFILES.m
  const pose = createLocomotionPose()
  const sampleAir = (vy, jumpTime, jumped = true) => {
    const st = createLocomotionState()
    st.air = 1; st.jumped = jumped; st.jumpTime = jumpTime; st.vy = vy; st.runJump = 0.5; st.leadLeft = true
    sampleLocomotionPose(pm, DEFAULT_LOCOMOTION_METRICS, st, pose)
    return {
      leadKnee: pose.legs[0].thigh - pose.legs[0].shin,
      trailKnee: pose.legs[1].thigh - pose.legs[1].shin,
      leadFoot: pose.legs[0].foot,
      armSwing: pose.arms[1].swing,
      armAbduct: pose.arms[0].abduct,
      torsoPitch: pose.torsoPitch,
    }
  }
  const tk = sampleAir(6.8, 0.08, true)
  const rise = sampleAir(4.5, 0.22, true)
  const apex = sampleAir(0.0, 0.35, true)
  const fall = sampleAir(-6.5, 0.55, true)
  assert.ok(tk.armSwing > rise.armSwing * 0.9, '起跳瞬间双臂应有力前上提摆')
  assert.ok(apex.trailKnee > rise.trailKnee + 0.25, '最高点后腿应自然微收蓄势')
  assert.ok(fall.armAbduct > rise.armAbduct + 0.25, '下落阶段手臂应向侧上外展维持平衡')
  assert.ok(fall.leadKnee < apex.leadKnee - 0.3, '下落阶段腿部应向前下探伸预备迎地')
})

test('真实 figure_m / figure_f 骨架：接地不穿地不浮空、手指朝掌心弯曲、静止与跑动落地均有缓冲、热切性别及 reset 零漂移', async () => {
  const {createLocomotionAnimator} = locoMod
  const {ensureAvatarRig} = rigMod

  for (const body of ['m', 'f']) {
    const {scene} = await loadAvatarScene(`figure_${body}`)
    const rig = ensureAvatarRig(scene)
    const loco = createLocomotionAnimator(scene, body)
    const pelvis = scene.getObjectByName('pelvis')
    const restPelvisPos = pelvis.position.clone()
    const restPelvisQuat = pelvis.quaternion.clone()

    // 1) idle (<0.12 m/s) 权重应保持 0，骨骼 100% 不被改动
    loco.frame.enabled = true
    loco.frame.grounded = true
    loco.frame.moving = false
    loco.frame.speed = 0
    for (let i = 0; i < 20; i++) { loco.reset(); loco.update(1 / 60) }
    assert.equal(loco.probe().blend, 0, `${body}: idle blend 必须为 0`)
    assert.ok(pelvis.position.distanceTo(restPelvisPos) < 1e-6, `${body}: idle 不应改变 pelvis.position`)

    // 2) walk / run / sprint 全周期脚底贴地包络检查
    for (const speed of [1.65, 5.0, 9.0]) {
      loco.halt()
      loco.frame.enabled = true
      loco.frame.grounded = true
      loco.frame.moving = true
      loco.frame.crouching = false
      loco.frame.speed = speed
      loco.frame.vy = 0
      loco.frame.jumped = false
      for (let i = 0; i < 40; i++) { loco.reset(); loco.update(1 / 60) }
      let minSole = Infinity
      for (let i = 0; i < 60; i++) {
        loco.reset()
        loco.update(1 / 60)
        const sy = measureSoleLocalY(scene, rig)
        if (sy < minSole) minSole = sy
      }
      assert.ok(minSole >= -0.045 && minSole <= 0.02, `${body} v=${speed}: minSole=${minSole} 超出安全贴地包络`)
    }

    // 3) 疾跑自然握拳：指节朝掌心内弯且指尖收紧贴近手腕/掌心（不再呈张开铁爪）
    scene.updateMatrixWorld(true)
    const pHandL = new THREE.Vector3(), pIdx1L = new THREE.Vector3(), pIdx3L = new THREE.Vector3(), pTipL = new THREE.Vector3()
    const pHandR = new THREE.Vector3(), pIdx1R = new THREE.Vector3(), pIdx3R = new THREE.Vector3(), pTipR = new THREE.Vector3()
    scene.getObjectByName('hand_l').getWorldPosition(pHandL)
    scene.getObjectByName('index_01_l').getWorldPosition(pIdx1L)
    scene.getObjectByName('index_03_l').getWorldPosition(pIdx3L)
    scene.getObjectByName('index_04_leaf_l').getWorldPosition(pTipL)
    scene.getObjectByName('hand_r').getWorldPosition(pHandR)
    scene.getObjectByName('index_01_r').getWorldPosition(pIdx1R)
    scene.getObjectByName('index_03_r').getWorldPosition(pIdx3R)
    scene.getObjectByName('index_04_leaf_r').getWorldPosition(pTipR)
    assert.ok(pIdx3L.x - pIdx1L.x > 0.01, `${body}: 左手四指应向掌心内弯 (+X), delta=${pIdx3L.x - pIdx1L.x}`)
    assert.ok(pIdx3R.x - pIdx1R.x < -0.01, `${body}: 右手四指应向掌心内弯 (-X), delta=${pIdx3R.x - pIdx1R.x}`)
    assert.ok(pTipL.distanceTo(pHandL) < 0.12 && pTipR.distanceTo(pHandR) < 0.12, `${body}: 疾跑握拳指尖应紧收向掌心 (L=${pTipL.distanceTo(pHandL).toFixed(3)}, R=${pTipR.distanceTo(pHandR).toFixed(3)})`)

    // 4) 静止起跳 + 跑动起跳完整物理弧，覆盖全部五阶段且落地缓冲不穿地
    for (const runSpeed of [0, 7.5]) {
      loco.halt()
      loco.frame.enabled = true
      loco.frame.grounded = true
      loco.frame.moving = runSpeed > 0
      loco.frame.speed = runSpeed
      loco.frame.vy = 0
      loco.frame.jumped = false
      if (runSpeed > 0) for (let i = 0; i < 30; i++) { loco.reset(); loco.update(1 / 60) }

      let y = 0, vy = Math.sqrt(48), grounded = false
      const seen = new Set()
      let maxLandCompress = 0, minLandSole = Infinity
      for (let i = 0; i < 80; i++) {
        const dt = 1 / 60
        if (!grounded) {
          vy += (vy > 0 ? -20 : -28) * dt
          y += vy * dt
          if (y <= 0) { y = 0; vy = 0; grounded = true }
        }
        loco.reset()
        loco.frame.grounded = grounded
        loco.frame.vy = vy
        loco.frame.jumped = i < 4
        loco.update(dt)
        const pr = loco.probe()
        seen.add(pr.jumpPhase)
        if (pr.jumpPhase === 'land') {
          maxLandCompress = Math.max(maxLandCompress, pr.landCompress)
          minLandSole = Math.min(minLandSole, measureSoleLocalY(scene, rig))
        }
      }
      for (const ph of ['takeoff', 'rise', 'apex', 'fall', 'land']) {
        assert.ok(seen.has(ph), `${body} runSpeed=${runSpeed}: 缺少跳跃阶段 ${ph} (seen=${[...seen]})`)
      }
      assert.ok(maxLandCompress > 0.5, `${body} runSpeed=${runSpeed}: 落地缓冲应显著触发 (max=${maxLandCompress})`)
      assert.ok(minLandSole >= -0.045, `${body} runSpeed=${runSpeed}: 落地缓冲不应穿地 (minLandSole=${minLandSole})`)
    }

    // 5) reset() 与 halt() 完整恢复骨骼与 pelvis.position，无任何漂移
    loco.reset()
    assert.ok(pelvis.position.distanceTo(restPelvisPos) < 1e-6, `${body}: reset 后 pelvis.position 须完全还原`)
    assert.ok(pelvis.quaternion.angleTo(restPelvisQuat) < 1e-6, `${body}: reset 后 pelvis.quaternion 须完全还原`)

    // 6) 热切性别 setBody
    const nextBody = body === 'm' ? 'f' : 'm'
    loco.setBody(nextBody)
    assert.equal(loco.body, nextBody)
    assert.equal(loco.probe().body, nextBody)
  }
})

test('联机远端角色 createRemoteLocomotionFeed：按各自 avatar.body 展现性别跑步差异并推算起跳/滞空/落地', async () => {
  const {createLocomotionAnimator, createRemoteLocomotionFeed} = locoMod
  const {ensureAvatarRig} = rigMod

  const mGlb = await loadAvatarScene('figure_m')
  const fGlb = await loadAvatarScene('figure_f')
  ensureAvatarRig(mGlb.scene)
  ensureAvatarRig(fGlb.scene)
  const locoM = createLocomotionAnimator(mGlb.scene, 'm')
  const locoF = createLocomotionAnimator(fGlb.scene, 'f')
  const feedM = createRemoteLocomotionFeed(locoM)
  const feedF = createRemoteLocomotionFeed(locoF)

  // 远端 7.5 m/s 跑步 1 秒：验证两者均生效且步频/姿态区分明显
  for (let i = 0; i < 60; i++) {
    locoM.reset(); locoF.reset()
    feedM(1 / 60, 0, 0, true, 7.5, 0, true)
    feedF(1 / 60, 0, 0, true, 7.5, 0, true)
  }
  const pm = locoM.probe(), pf = locoF.probe()
  assert.equal(pm.body, 'm')
  assert.equal(pf.body, 'f')
  assert.ok(pm.blend > 0.95 && pf.blend > 0.95, '远端跑步 blend 应拉满')
  assert.ok(pf.cadence > pm.cadence * 1.08, `远端女步频 (${pf.cadence}) 应明显快于男 (${pm.cadence})`)

  // 远端跳跃：模拟 20 Hz 发包 + 平滑跟随时触发 rise / apex / fall / land
  let y = 0, shownY = 0, vy = Math.sqrt(48), gr = false
  const remotePhases = new Set()
  for (let i = 0; i < 85; i++) {
    const dt = 1 / 60
    if (!gr) {
      vy += (vy > 0 ? -20 : -28) * dt
      y += vy * dt
      if (y <= 0) { y = 0; vy = 0; gr = true }
    }
    const alpha = 1 - Math.exp(-20 * dt)
    shownY += (y - shownY) * alpha
    locoM.reset()
    feedM(dt, shownY, y, gr, 6.0, 0, true)
    remotePhases.add(locoM.probe().jumpPhase)
  }
  for (const ph of ['rise', 'apex', 'fall', 'land']) {
    assert.ok(remotePhases.has(ph), `远端跳跃缺少阶段 ${ph} (seen=${[...remotePhases]})`)
  }
})
