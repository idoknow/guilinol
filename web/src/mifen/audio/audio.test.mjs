import assert from 'node:assert/strict'
import test from 'node:test'
import {existingCityAudio, prepareCityAudioDuringLoad} from '../../city-audio.ts'
import { STORY_BEATS, getStoryBeat, getStoryBeatByTrigger } from '../story/script.ts'
import { SOUND_CATALOG, SOUND_IDS, computeMifenDistanceGain, createMifenAudio, encodeWavMono16 } from './index.ts'

test('STORY_BEATS 包含 4 段剧情、全表情与全机位且选项下标不越界', () => {
  assert.equal(STORY_BEATS.length, 4)
  assert.deepEqual(
    STORY_BEATS.map(b => b.id),
    ['meet', 'first_bowl', 'shop_lv2', 'shop_lv3'],
  )
  const seenExprs = new Set()
  const seenShots = new Set()
  for (const beat of STORY_BEATS) {
    assert.ok(beat.lines.length >= 3, `${beat.id} 台词应 >= 3 句`)
    assert.equal(getStoryBeat(beat.id)?.id, beat.id)
    assert.equal(getStoryBeatByTrigger(beat.trigger)?.id, beat.id)
    for (const line of beat.lines) {
      assert.ok(line.text.trim().length > 0)
      seenExprs.add(line.expr)
      seenShots.add(line.shot)
      if (line.choices) {
        assert.ok(line.choices.length >= 1)
        for (const ch of line.choices) {
          assert.equal(typeof ch.next, 'number')
          assert.ok(ch.next >= 0 && ch.next < beat.lines.length, `${beat.id} choice ${ch.id} next 越界`)
        }
      }
    }
  }
  for (const e of ['neutral', 'smile', 'worry', 'proud', 'laugh']) {
    assert.ok(seenExprs.has(e), `缺少表情 ${e}`)
  }
  for (const s of ['wide', 'uncle', 'player', 'two', 'shop']) {
    assert.ok(seenShots.has(s), `缺少机位 ${s}`)
  }
})

test('SOUND_CATALOG 覆盖全链路工位与剧情音效并校验元数据', () => {
  const required = [
    'boil_bubbling',
    'boil_dip',
    'boil_lock_perfect',
    'boil_lock_miss',
    'meat_chop',
    'meat_plate',
    'brine_pour',
    'brine_stop',
    'condiment_add',
    'serve_complete',
    'cash_register',
    'story_open',
    'story_blip_uncle',
    'story_blip_player',
    'story_choice',
    'story_unlock',
    'action_reject',
  ]
  for (const id of required) {
    assert.ok(id in SOUND_CATALOG, `缺失音效 ${id}`)
    const spec = SOUND_CATALOG[id]
    assert.ok(spec.durationSec > 0 && spec.durationSec <= 5)
    assert.ok(spec.defaultVolume > 0 && spec.defaultVolume <= 1)
    assert.ok(spec.trigger.trim().length > 4)
  }
  assert.equal(SOUND_IDS.length, required.length)
})

test('createMifenAudio 在无 window Node 环境下安全降级且统计与静音开关正确', () => {
  const audio = createMifenAudio()
  assert.equal(audio.isMuted(), false)
  assert.equal(audio.getStats().supported, false)
  // 无 AudioContext 时不会抛错，也不会计为硬件播音，但记录调用状态前静音检查正常
  audio.play('meat_chop')
  assert.equal(audio.getStats().playedCounts.meat_chop, 1)
  audio.setMuted(true)
  assert.equal(audio.isMuted(), true)
  audio.setBoiling(false)
  audio.setPouringBrine(false)
  audio.dispose()
})

function makeVisualBase(overrides = {}) {
  return {
    active: true,
    ticketId: 'T-1',
    recipeId: 'lurou',
    stage: 'boil',
    currentStep: null,
    panelOpen: true,
    requiredStation: 'boil',
    activeStation: 'boil',
    completedStations: [],
    ...overrides,
    boil: {
      active: true,
      done: false,
      progress: 0,
      dipPhase: 0,
      drainProgress: 0,
      noodleRelax: 0,
      steamIntensity: 0.4,
      quality: null,
      ...(overrides.boil ?? {}),
    },
    meat: {
      active: false,
      done: false,
      addedMeats: [],
      requiredMeats: ['guoshao'],
      lastChopped: null,
      chopPulse: 0,
      chopCount: 0,
      progress: 0,
      quality: null,
      ...(overrides.meat ?? {}),
    },
    counter: {
      active: false,
      done: false,
      pouring: false,
      brineLevel: 0,
      brineTarget: 0.7,
      pourStream: 0,
      ladleTilt: 0,
      chiliOil: false,
      servePulse: 0,
      quality: null,
      ...(overrides.counter ?? {}),
    },
    bowl: {
      visible: true,
      location: 'boil',
      hasNoodles: false,
      meats: [],
      brineLevel: 0,
      chiliOil: false,
      brothStyle: 'lushui',
      opts: {},
      ...(overrides.bowl ?? {}),
    },
  }
}

function installFakeAudioEnv() {
  const prevWindow = globalThis.window
  const prevDocument = globalThis.document
  const winTarget = new EventTarget()
  const docTarget = new EventTarget()
  let hidden = false

  class FakeParam {
    constructor(val = 0) {
      this.value = val
      this.ramps = []
    }
    setValueAtTime(v) {
      this.value = v
    }
    linearRampToValueAtTime(v, t) {
      this.value = v
      this.ramps.push([v, t])
    }
    exponentialRampToValueAtTime(v, t) {
      this.value = v
      this.ramps.push([v, t])
    }
    cancelScheduledValues() {}
  }

  class FakeNode {
    connect() {
      return this
    }
    disconnect() {}
  }

  class FakeGain extends FakeNode {
    constructor() {
      super()
      this.gain = new FakeParam(1)
    }
  }

  class FakeOsc extends FakeNode {
    constructor() {
      super()
      this.type = 'sine'
      this.frequency = new FakeParam(440)
    }
    start() {}
    stop() {}
  }

  class FakeBufSrc extends FakeNode {
    constructor() {
      super()
      this.buffer = null
      this.loop = false
    }
    start() {}
    stop() {}
  }

  class FakeFilter extends FakeNode {
    constructor() {
      super()
      this.type = 'lowpass'
      this.frequency = new FakeParam(1000)
      this.Q = new FakeParam(1)
    }
  }

  class FakeComp extends FakeNode {
    constructor() {
      super()
      this.threshold = new FakeParam(-14)
      this.knee = new FakeParam(14)
      this.ratio = new FakeParam(6)
      this.attack = new FakeParam(0.002)
      this.release = new FakeParam(0.12)
    }
  }

  class FakeWaveShaper extends FakeNode {
    constructor() {
      super()
      this.curve = null
      this.oversample = 'none'
    }
  }

  class FakeAudioContext {
    constructor() {
      this.state = 'suspended'
      this.sampleRate = 44100
      this.currentTime = 0
      this.destination = new FakeNode()
    }
    resume() {
      this.state = 'running'
      return Promise.resolve()
    }
    close() {
      this.state = 'closed'
      return Promise.resolve()
    }
    createGain() {
      return new FakeGain()
    }
    createOscillator() {
      return new FakeOsc()
    }
    createBufferSource() {
      return new FakeBufSrc()
    }
    createBiquadFilter() {
      return new FakeFilter()
    }
    createDynamicsCompressor() {
      return new FakeComp()
    }
    createWaveShaper() {
      return new FakeWaveShaper()
    }
    createBuffer(channels, length) {
      const data = new Float32Array(length)
      return {
        numberOfChannels: channels,
        length,
        getChannelData: () => data,
      }
    }
  }

  const fakeWin = {
    AudioContext: FakeAudioContext,
    addEventListener: winTarget.addEventListener.bind(winTarget),
    removeEventListener: winTarget.removeEventListener.bind(winTarget),
    dispatchEvent: winTarget.dispatchEvent.bind(winTarget),
    setInterval: () => 1,
    clearInterval: () => {},
  }
  const fakeDoc = {
    get hidden() {
      return hidden
    },
    set hidden(v) {
      hidden = Boolean(v)
    },
    addEventListener: docTarget.addEventListener.bind(docTarget),
    removeEventListener: docTarget.removeEventListener.bind(docTarget),
    dispatchEvent: docTarget.dispatchEvent.bind(docTarget),
  }

  globalThis.window = fakeWin
  globalThis.document = fakeDoc

  return {
    winTarget,
    docTarget,
    setHidden(v) {
      hidden = Boolean(v)
    },
    restore() {
      globalThis.window = prevWindow
      globalThis.document = prevDocument
    },
  }
}

test('computeMifenDistanceGain 在 >=12m 衰减为 0 且 1.5m 内保持 1', () => {
  assert.equal(computeMifenDistanceGain(0), 1)
  assert.equal(computeMifenDistanceGain(1.5), 1)
  const mid = computeMifenDistanceGain(6)
  assert.ok(mid > 0.1 && mid < 0.9, `6m 衰减应居中: ${mid}`)
  assert.equal(computeMifenDistanceGain(12), 0)
  assert.equal(computeMifenDistanceGain(18.5), 0)
})

test('syncCooking 边沿音效触发、离店 >=12m 静默与关面板/取消单/切后台停循环', async t => {
  const env = installFakeAudioEnv()
  t.after(() => env.restore())

  const audio = createMifenAudio()
  assert.equal(audio.unlock(), false)
  await prepareCityAudioDuringLoad()
  t.after(() => {audio.dispose(); assert.equal(existingCityAudio()?.state,'running')})
  assert.equal(audio.unlock(), true)

  // 1) 进入煮锅阶段 -> boil_dip + boil_bubbling 循环开启
  const s1 = makeVisualBase({ stage: 'boil', panelOpen: true, boil: { active: true, dipPhase: 0.2 } })
  audio.syncCooking(s1)
  assert.equal(audio.getStats().playedCounts.boil_dip, 1)
  assert.deepEqual(audio.getStats().activeLoops, ['boil_bubbling'])

  // 2) 关面板 -> 自动停沸水循环
  audio.syncCooking(makeVisualBase({ stage: 'boil', panelOpen: false, boil: { active: true, dipPhase: 0.4 } }))
  assert.deepEqual(audio.getStats().activeLoops, [])

  // 3) 重开面板 + 提篱锁锅 -> boil_lock_perfect; 然后下碗与肉台切码
  audio.syncCooking(makeVisualBase({ stage: 'boil', panelOpen: true, boil: { active: true, drainProgress: 0.35, quality: 'perfect' } }))
  assert.equal(audio.getStats().playedCounts.boil_lock_perfect, 1)

  audio.syncCooking(makeVisualBase({ stage: 'carry_to_meat', panelOpen: true, boil: { active: false, done: true, drainProgress: 1 }, bowl: { hasNoodles: true } }))
  assert.equal(audio.getStats().playedCounts.meat_plate, 1)

  audio.syncCooking(makeVisualBase({
    stage: 'meat',
    panelOpen: true,
    boil: { active: false, done: true, drainProgress: 1 },
    bowl: { hasNoodles: true },
    meat: { active: true, addedMeats: ['guoshao'], chopCount: 1 },
  }))
  assert.equal(audio.getStats().playedCounts.meat_chop, 1)

  // 4) 前台淋卤开启循环 -> 松手 brine_stop -> 辣油 condiment_add -> 出餐 serve_complete
  audio.syncCooking(makeVisualBase({
    stage: 'counter',
    panelOpen: true,
    boil: { active: false, done: true, drainProgress: 1 },
    meat: { active: false, done: true, addedMeats: ['guoshao'], chopCount: 1 },
    bowl: { hasNoodles: true },
    counter: { active: true, pouring: true, brineLevel: 0.25 },
  }))
  assert.deepEqual(audio.getStats().activeLoops, ['brine_pour'])

  // 离店 >= 12m 时衰减至 0 且自动停止循环
  audio.setListenerDistance(12)
  assert.equal(audio.getStats().distanceGain, 0)
  assert.deepEqual(audio.getStats().activeLoops, [])
  audio.setListenerDistance(1.0)
  assert.equal(audio.getStats().distanceGain, 1)

  // 切后台 (visibilitychange) / blur 自动停循环
  audio.syncCooking(makeVisualBase({
    stage: 'counter',
    panelOpen: true,
    boil: { active: false, done: true, drainProgress: 1 },
    meat: { active: false, done: true, addedMeats: ['guoshao'], chopCount: 1 },
    bowl: { hasNoodles: true },
    counter: { active: true, pouring: true, brineLevel: 0.4 },
  }))
  assert.deepEqual(audio.getStats().activeLoops, ['brine_pour'])
  env.setHidden(true)
  env.docTarget.dispatchEvent(new Event('visibilitychange'))
  assert.deepEqual(audio.getStats().activeLoops, [])
  env.setHidden(false)

  // 重新淋卤后再停止与出餐
  audio.syncCooking(makeVisualBase({
    stage: 'counter',
    panelOpen: true,
    boil: { active: false, done: true, drainProgress: 1 },
    meat: { active: false, done: true, addedMeats: ['guoshao'], chopCount: 1 },
    bowl: { hasNoodles: true },
    counter: { active: true, pouring: true, brineLevel: 0.5 },
  }))
  audio.syncCooking(makeVisualBase({
    stage: 'counter',
    panelOpen: true,
    boil: { active: false, done: true, drainProgress: 1 },
    meat: { active: false, done: true, addedMeats: ['guoshao'], chopCount: 1 },
    bowl: { hasNoodles: true, chiliOil: true },
    counter: { active: true, pouring: false, brineLevel: 0.72, chiliOil: true },
  }))
  assert.equal(audio.getStats().playedCounts.brine_stop, 1)
  assert.equal(audio.getStats().playedCounts.condiment_add, 1)
  assert.deepEqual(audio.getStats().activeLoops, [])

  audio.syncCooking(makeVisualBase({
    stage: 'serving',
    panelOpen: true,
    boil: { active: false, done: true, drainProgress: 1 },
    meat: { active: false, done: true, addedMeats: ['guoshao'], chopCount: 1 },
    bowl: { hasNoodles: true, chiliOil: true, brineLevel: 0.72 },
    counter: { active: false, done: true, pouring: false, brineLevel: 0.72, chiliOil: true, servePulse: 0.5 },
  }))
  assert.equal(audio.getStats().playedCounts.serve_complete, 1)

  // 取消单停全部循环
  audio.startLoop('boil_bubbling')
  assert.deepEqual(audio.getStats().activeLoops, ['boil_bubbling'])
  audio.syncCooking(makeVisualBase({ active: false, stage: 'idle', panelOpen: false }))
  assert.deepEqual(audio.getStats().activeLoops, [])
})

test('encodeWavMono16 输出合法 16-bit PCM RIFF/WAV 头与浮点限幅', () => {
  const pcm = new Float32Array([0, 0.5, -0.5, 1.5, -1.5])
  const wav = encodeWavMono16(pcm, 44100)
  assert.equal(wav.length, 44 + pcm.length * 2)
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF')
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE')
  assert.equal(String.fromCharCode(...wav.slice(12, 16)), 'fmt ')
  assert.equal(String.fromCharCode(...wav.slice(36, 40)), 'data')
  const view = new DataView(wav.buffer)
  assert.equal(view.getInt16(44 + 6, true), 32767)
  assert.equal(view.getInt16(44 + 8, true), -32768)
})
