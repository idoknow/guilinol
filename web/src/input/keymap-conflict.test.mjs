import assert from 'node:assert/strict'
import {rmSync} from 'node:fs'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test, {after, beforeEach} from 'node:test'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'

const bundleDir = await mkdtemp(join(tmpdir(), 'glol-keymap-conflict-test-'))
const bundleFile = join(bundleDir, 'keymap-sut.mjs')
process.once('exit', () => {
  try {
    rmSync(bundleDir, {recursive: true, force: true})
  } catch {
    // ignore
  }
})

await build({
  entryPoints: ['web/src/input/keymap.ts'],
  outfile: bundleFile,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  logLevel: 'silent',
})

after(async () => {
  await rm(bundleDir, {recursive: true, force: true})
})

const {
  ACTIONS,
  DUTY_ACTION_IDS,
  actionScope,
  activeActionScope,
  binding,
  canonical,
  findScopeKeyConflicts,
  hits,
  isDutyAction,
  isDutyScopeActive,
  reservedFor,
  resetBindings,
  setBinding,
} = await import(pathToFileURL(bundleFile).href)

const prevDocument = globalThis.document

function setMockDutyDom(dataset) {
  if (!dataset) {
    if (prevDocument === undefined) delete globalThis.document
    else globalThis.document = prevDocument
    return
  }
  globalThis.document = {body: {dataset: {...dataset}}}
}

beforeEach(() => {
  setMockDutyDom(null)
  resetBindings()
})

after(() => {
  setMockDutyDom(null)
  resetBindings()
})

test('k26: default bindings have 0 intra-scope conflicts and clear scope/hint separation for rescue, punch, interact, and duty keys', () => {
  assert.deepEqual(binding('punch'), ['Mouse0'])
  assert.deepEqual(binding('rescue'), ['KeyE'])
  assert.deepEqual(binding('interact'), ['KeyF'])
  assert.deepEqual(binding('dutyWhistle'), ['KeyQ'])
  assert.deepEqual(binding('dutyFlag'), ['KeyE'])
  assert.deepEqual(binding('dutyTicket'), ['KeyF'])

  assert.equal(actionScope('punch'), 'common')
  assert.equal(actionScope('rescue'), 'common')
  assert.equal(actionScope('interact'), 'common')
  for (const id of DUTY_ACTION_IDS) {
    assert.equal(actionScope(id), 'duty')
    assert.equal(isDutyAction(id), true)
  }

  // Zero same-scope key clashes in both common and duty scopes
  assert.deepEqual(findScopeKeyConflicts('common'), [])
  assert.deepEqual(findScopeKeyConflicts('duty'), [])

  // punch (Mouse0) never shares a physical key with interact or any duty action
  const punchKeys = new Set(binding('punch'))
  for (const id of ['interact', 'dutyWhistle', 'dutyFlag', 'dutyTicket']) {
    for (const code of binding(id)) {
      assert.equal(punchKeys.has(code), false, `punch must not collide with ${id} on ${code}`)
    }
  }

  // rescue & dutyFlag both explain their scope priority in hint metadata
  const rescueDef = ACTIONS.find(a => a.id === 'rescue')
  const flagDef = ACTIONS.find(a => a.id === 'dutyFlag')
  assert.ok(rescueDef?.hint && rescueDef.hint.includes('执勤'), 'rescue hint should clarify duty E precedence')
  assert.ok(flagDef?.hint && flagDef.hint.includes('长按'), 'dutyFlag hint should clarify short/long press')
})

test('k26: on duty (scope duty) rescue cannot swallow KeyE/dutyFlag or KeyQ/dutyWhistle, while walking (scope common) rescue works normally', () => {
  // Explicit scope='common' (walking): rescue, punch, interact active; duty actions suppressed
  assert.equal(hits('KeyE', 'rescue', 'common'), true)
  assert.equal(hits('Mouse0', 'punch', 'common'), true)
  assert.equal(hits('KeyF', 'interact', 'common'), true)
  assert.equal(hits('KeyE', 'dutyFlag', 'common'), false)
  assert.equal(hits('KeyQ', 'dutyWhistle', 'common'), false)
  assert.equal(hits('KeyF', 'dutyTicket', 'common'), false)

  // Explicit scope='duty': dutyFlag owns KeyE, dutyWhistle owns KeyQ, rescue CANNOT swallow KeyE,
  // while interact + dutyTicket cooperate cleanly on KeyF and punch stays unaffected on Mouse0
  assert.equal(hits('KeyE', 'dutyFlag', 'duty'), true)
  assert.equal(hits('KeyE', 'rescue', 'duty'), false)
  assert.equal(hits('KeyQ', 'dutyWhistle', 'duty'), true)
  assert.equal(hits('KeyQ', 'rescue', 'duty'), false)
  assert.equal(hits('KeyF', 'dutyTicket', 'duty'), true)
  assert.equal(hits('KeyF', 'interact', 'duty'), true)
  assert.equal(hits('Mouse0', 'punch', 'duty'), true)

  // Live DOM toggle via document.body.dataset.duty='active' (used by controller.ts & walk/index.ts)
  setMockDutyDom({duty: 'active', tdDutyActive: '1'})
  assert.equal(isDutyScopeActive(), true)
  assert.equal(activeActionScope(), 'duty')
  assert.equal(hits('KeyE', 'dutyFlag'), true)
  assert.equal(hits('KeyE', 'rescue'), false, 'active duty DOM state must block rescue from stealing KeyE')
  assert.equal(hits('KeyQ', 'dutyWhistle'), true)
  assert.equal(hits('KeyF', 'interact'), true)
  assert.equal(hits('KeyF', 'dutyTicket'), true)

  // Leaving duty restores walking rescue on KeyE immediately
  setMockDutyDom({tdDutyActive: '0'})
  assert.equal(isDutyScopeActive(), false)
  assert.equal(activeActionScope(), 'common')
  assert.equal(hits('KeyE', 'rescue'), true, 'off-duty walking must keep KeyE rescue working')
  assert.equal(hits('Mouse0', 'punch'), true)
  assert.equal(hits('KeyF', 'interact'), true)
})

test('k26: rebinding keeps common vs duty scopes isolated and allows rescue/duty keys to rebind back to defaults cleanly', () => {
  // Rebinding dutyFlag to KeyH must NOT touch rescue (KeyE)
  setBinding('dutyFlag', 'KeyH')
  assert.deepEqual(binding('dutyFlag'), ['KeyH'])
  assert.deepEqual(binding('rescue'), ['KeyE'])
  assert.equal(hits('KeyH', 'dutyFlag', 'duty'), true)
  // Now that dutyFlag moved off KeyE, rescue on KeyE no longer collides with dutyFlag
  assert.equal(hits('KeyE', 'rescue', 'duty'), true)
  assert.equal(canonical('KeyH', 'duty'), 'KeyE')

  // If rescue is also rebound to KeyH, duty scope still protects dutyFlag while common scope keeps rescue working
  setBinding('rescue', 'KeyH')
  assert.deepEqual(binding('rescue'), ['KeyH'])
  assert.deepEqual(binding('dutyFlag'), ['KeyH'])
  assert.equal(hits('KeyH', 'dutyFlag', 'duty'), true)
  assert.equal(hits('KeyH', 'rescue', 'duty'), false)
  assert.equal(hits('KeyH', 'rescue', 'common'), true)

  // reservedFor allows rescue to rebind back to KeyE and duty actions to Q/E/F, while still blocking unrelated actions from KeyE/KeyQ
  assert.equal(reservedFor('KeyE', 'rescue'), undefined)
  assert.equal(reservedFor('KeyE', 'dutyFlag'), undefined)
  assert.equal(reservedFor('KeyQ', 'dutyWhistle'), undefined)
  assert.equal(reservedFor('KeyF', 'dutyTicket'), undefined)
  assert.equal(reservedFor('KeyE', 'punch'), '加档')
  assert.equal(reservedFor('KeyQ', 'punch'), '减档')

  // Rebinding rescue back to KeyE restores default cleanly
  setBinding('rescue', 'KeyE')
  assert.deepEqual(binding('rescue'), ['KeyE'])
  resetBindings()
  assert.deepEqual(binding('dutyFlag'), ['KeyE'])
  assert.deepEqual(binding('rescue'), ['KeyE'])
})
