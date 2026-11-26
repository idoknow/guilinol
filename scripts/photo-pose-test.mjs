import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {poseView} from '../web/src/play/photo-pose.ts'

// IDOK-226：拍照模式「动作」键 + 表情轮盘的显隐。
const idle = {figure: true, capturing: false, recording: false, ready: true}

test('idle photo mode shows an enabled pose key and lets the wheel open', () => {
  assert.deepEqual(poseView(idle), {busy: '', button: true, enabled: true, wheel: true})
})

test('shutter and recording hide the key and close the wheel', () => {
  assert.deepEqual(poseView({...idle, capturing: true}), {busy: 'shot', button: false, enabled: true, wheel: false})
  assert.deepEqual(poseView({...idle, recording: true}), {busy: 'rec', button: false, enabled: true, wheel: false})
  assert.equal(poseView({...idle, capturing: true, recording: true}).busy, 'rec')
})

test('figure off or emotes unavailable keeps the key visible but disabled', () => {
  assert.deepEqual(poseView({...idle, figure: false}), {busy: '', button: true, enabled: false, wheel: false})
  assert.deepEqual(poseView({...idle, ready: false}), {busy: '', button: true, enabled: false, wheel: false})
})

test('every combination: wheel only when the key is visible and enabled', () => {
  for (let bits = 0; bits < 16; bits++) {
    const input = {figure: !!(bits & 1), capturing: !!(bits & 2), recording: !!(bits & 4), ready: !!(bits & 8)}
    const view = poseView(input)
    assert.equal(view.button, !(input.capturing || input.recording))
    assert.equal(view.enabled, input.figure && input.ready)
    assert.equal(view.wheel, view.button && view.enabled)
    assert.equal(view.busy === '', view.button)
  }
})

test('photo CSS lets the wheel show in photo mode but hides it while busy', async () => {
  const css = await readFile(new URL('../web/src/play/play.css', import.meta.url), 'utf8')
  const hideList = css.match(/body\[data-photo=on\] :is\(([^)]*)\)\{display:none!important\}/)
  assert(hideList, 'photo HUD hide list present')
  assert(hideList[1].includes('.emote-toggle'), 'walk-mode 表情 key stays hidden in photo mode')
  assert(!hideList[1].includes('.emote-overlay'), 'wheel is allowed in photo mode')
  assert.match(css, /body\[data-photo-busy\] \.emote-overlay\{display:none!important\}/)
})
