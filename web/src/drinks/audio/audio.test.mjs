import assert from 'node:assert/strict'
import test from 'node:test'
import { DRINK_SOUND_CATALOG, DRINK_SOUND_IDS, createDrinksAudio, encodeWavMono16 } from './index.ts'

test('DRINK_SOUND_CATALOG 覆盖全链路 10 种冷饮音效且元数据合法', () => {
  const expected = [
    'order_chime',
    'cup_drop',
    'ice_scoop',
    'tea_pour',
    'shaker_shake',
    'cup_seal',
    'call_number',
    'straw_poke',
    'drink_sip',
    'action_reject',
  ]
  assert.deepEqual([...DRINK_SOUND_IDS], expected)
  for (const id of expected) {
    const spec = DRINK_SOUND_CATALOG[id]
    assert.ok(spec.durationSec > 0 && spec.durationSec <= 2)
    assert.ok(spec.defaultVolume > 0 && spec.defaultVolume <= 1)
    assert.ok(spec.trigger.length > 4)
  }
})

test('createDrinksAudio 在无 window 环境下安全降级并记录调用统计', () => {
  const audio = createDrinksAudio({ syncRidePref: false })
  assert.equal(audio.isMuted(), false)
  assert.equal(audio.getStats().supported, false)
  audio.play('shaker_shake')
  audio.playOrderConfirm()
  assert.equal(audio.getStats().playedCounts.shaker_shake, 1)
  assert.equal(audio.getStats().playedCounts.order_chime, 1)
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
