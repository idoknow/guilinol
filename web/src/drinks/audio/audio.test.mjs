import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DRINK_BGM_BAR_SEC,
  DRINK_BGM_TEMPO_BPM,
  DRINK_SOUND_CATALOG,
  DRINK_SOUND_IDS,
  EQUIPMENT_ACTION_SOUND_MAP,
  computeBgmDistanceAttenuation,
  createDrinksAudio,
  createDrinksBgmController,
  encodeWavMono16,
} from './index.ts'

test('DRINK_SOUND_CATALOG 覆盖全链路 15 种冷饮/设备/员工音效且元数据合法', () => {
  const expected = [
    'order_chime',
    'cup_drop',
    'ice_scoop',
    'fruit_pour',
    'tea_pour',
    'shaker_shake',
    'ice_cream_dispense',
    'cup_seal',
    'label_apply',
    'call_number',
    'straw_poke',
    'drink_sip',
    'action_reject',
    'staff_clock_in',
    'staff_step_done',
  ]
  assert.deepEqual([...DRINK_SOUND_IDS], expected)
  for (const id of expected) {
    const spec = DRINK_SOUND_CATALOG[id]
    assert.ok(spec.durationSec > 0 && spec.durationSec <= 2)
    assert.ok(spec.defaultVolume > 0 && spec.defaultVolume <= 1)
    assert.ok(spec.trigger.length > 4)
  }
  const equipActions = ['ice_cream_dispense', 'tea_shake', 'cup_seal', 'fruit_pour', 'ice_scoop', 'label_apply']
  for (const act of equipActions) {
    assert.ok(EQUIPMENT_ACTION_SOUND_MAP[act] in DRINK_SOUND_CATALOG, `缺少设备动作映射 ${act}`)
  }
})

test('createDrinksAudio 在无 window 环境下安全降级并支持设备 0..1 进度沿触发', () => {
  const audio = createDrinksAudio({ syncRidePref: false })
  assert.equal(audio.isMuted(), false)
  assert.equal(audio.getStats().supported, false)
  audio.play('shaker_shake')
  audio.playOrderConfirm()
  audio.playEquipmentAction('label_apply')
  audio.syncEquipmentProgress('ice_cream_dispense', 0.12, 0.0)
  audio.syncEquipmentProgress('ice_cream_dispense', 0.55, 0.12) // 中途不重复触发
  assert.equal(audio.getStats().playedCounts.shaker_shake, 1)
  assert.equal(audio.getStats().playedCounts.order_chime, 1)
  assert.equal(audio.getStats().playedCounts.label_apply, 1)
  assert.equal(audio.getStats().playedCounts.ice_cream_dispense, 1)
  audio.setMuted(true)
  assert.equal(audio.isMuted(), true)
  audio.dispose()
})

test('createDrinksAudio 跟随 glol:ride-sound 全局静音事件切换状态', t => {
  const prevWin = globalThis.window
  const prevStorage = globalThis.localStorage
  const target = new EventTarget()
  const store = new Map([['glol.rideSoundMuted', '0']])
  globalThis.localStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  }
  globalThis.window = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  }
  t.after(() => {
    globalThis.window = prevWin
    globalThis.localStorage = prevStorage
  })

  const audio = createDrinksAudio()
  t.after(() => audio.dispose())
  assert.equal(audio.isMuted(), false)

  target.dispatchEvent(new CustomEvent('glol:ride-sound', { detail: { muted: true } }))
  assert.equal(audio.isMuted(), true)

  target.dispatchEvent(new CustomEvent('glol:ride-sound', { detail: { muted: false } }))
  assert.equal(audio.isMuted(), false)
})

test('encodeWavMono16 正确写出 16-bit WAV 文件头', () => {
  const wav = encodeWavMono16(new Float32Array([0, 0.25, -0.5, 1.2]), 44100)
  assert.equal(wav.length, 44 + 8)
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF')
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE')
})

test('createDrinksBgmController 支持店内打卡启停、距离衰减与无 window 安全运行', () => {
  assert.equal(DRINK_BGM_TEMPO_BPM, 116)
  assert.equal(computeBgmDistanceAttenuation(0), 1)
  assert.equal(computeBgmDistanceAttenuation(8), 1)
  assert.ok(computeBgmDistanceAttenuation(17) > 0 && computeBgmDistanceAttenuation(17) < 1)
  assert.equal(computeBgmDistanceAttenuation(30), 0)

  const bgm = createDrinksBgmController({ syncRidePref: false })
  bgm.start()
  assert.equal(bgm.isPlaying(), true)
  bgm.setDistance(12)
  for (let i = 0; i < 12; i++) {
    bgm.step(0.4)
  }
  assert.ok(bgm.getStats().barsScheduled >= 2)
  bgm.setMuted(true)
  assert.equal(bgm.isMuted(), true)
  bgm.stop()
  assert.equal(bgm.isPlaying(), false)
  bgm.dispose()
})
