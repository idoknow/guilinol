import assert from 'node:assert/strict'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {build} from 'esbuild'

test('attachNet declares vstate1 on join and sends vstate before pos on mobility switch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'glol-net-vstate-'))
  try {
    const entry = join(dir, 'entry.ts')
    const out = join(dir, 'bundle.mjs')
    writeFileSync(entry, `export {attachNet} from ${JSON.stringify(join(process.cwd(), 'web/src/net.ts'))}\n`)
    await build({
      entryPoints: [entry],
      outfile: out,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      external: ['three'],
      plugins: [{
        name: 'stub-deps',
        setup(b) {
          b.onResolve({filter: /\/net-players$|\/chat-store$|\/ui\/account$|\/mp-roster$|\/fingerprint$|\/mp-travel$|\/cheat-capture$|\/combat\/net$/}, args => ({
            path: args.path,
            namespace: 'stub',
          }))
          b.onLoad({filter: /.*/, namespace: 'stub'}, args => {
            if (args.path.endsWith('/net-players')) return {contents: 'export function players(){return {list:()=>[],add(){},remove(){},move(){},reconcile(){},clear(){},emote(){},avatar(){},combat(){},helping(){},reveal(){},tick(){},probe:()=>({})}}'}
            if (args.path.endsWith('/chat-store')) return {contents: 'export function bindChat(){} export function receiveChat(){} export function setChatSelf(){}'}
            if (args.path.endsWith('/ui/account')) return {contents: 'export function onUser(fn){fn({id:"u1"});return ()=>{}}'}
            if (args.path.endsWith('/mp-roster')) return {contents: 'export function setRoster(){} export function clearRoster(){}'}
            if (args.path.endsWith('/fingerprint')) return {contents: 'export const fingerprint=()=>"a".repeat(32); export const deviceSummary=()=>"Test|Chrome"'}
            if (args.path.endsWith('/mp-travel')) return {contents: 'export function bindTravel(){} export function prepareTravel(){return true} export function rejectTravel(){} export function travelTarget(){return null}'}
            if (args.path.endsWith('/combat/net')) return {contents: 'export const config={hpMax:100}'}
            return {contents: 'export async function triggerCheatCapture(){}'}
          })
        },
      }],
    })

    const sent = []
    class MockWebSocket {
      static OPEN = 1
      static CONNECTING = 0
      readyState = 1
      bufferedAmount = 0
      onopen = null
      onmessage = null
      onclose = null
      onerror = null
      constructor() {
        MockWebSocket.instance = this
        queueMicrotask(() => {
          this.onopen?.()
          this.onmessage?.({data: JSON.stringify({t: 'welcome', me: {id: 'p1', uid: 100001, name: 'Test'}, online: 1, players: []})})
        })
      }
      send(raw) { sent.push(JSON.parse(raw)) }
      close() { this.readyState = 3 }
    }

    const listeners = new Map()
    globalThis.window = {
      dispatchEvent() {},
      addEventListener(name, fn) { listeners.set(name, fn) },
      removeEventListener(name) { listeners.delete(name) },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    }
    globalThis.location = {protocol: 'http:', host: '127.0.0.1', search: ''}
    globalThis.localStorage = {getItem: () => null}
    globalThis.fetch = async () => ({ok: true, status: 200, json: async () => ({ticket: 'tok'})})
    globalThis.WebSocket = MockWebSocket

    const mod = await import(out)
    let mode = {mode: 'foot'}
    let pose = {x: 10, y: 150, z: 20, yaw: 0, v: 0, gr: 1, foot: true, bike: '', bx: 0, bz: 0, byaw: 0}
    const net = mod.attachNet(
      {},
      [],
      () => pose,
      () => ({look: 'a'}),
      {},
      () => ({act: 'walk', detail: ''}),
      undefined,
      undefined,
      undefined,
      () => mode,
      reason => { assert.equal(reason,'rejected'); mode={mode:'foot'} },
    )

    await new Promise(resolve => setTimeout(resolve, 30))
    const joinMsg = sent.find(m => m.t === 'join')
    assert.ok(joinMsg, 'join message sent')
    assert.ok(Array.isArray(joinMsg.caps) && joinMsg.caps.includes('vstate1'), 'join declares vstate1 capability')
    assert.equal(joinMsg.vmode, 'foot')

    sent.length = 0
    mode = {mode: 'car', id: 'car-1'}
    pose = {...pose, x: 12, foot: false}
    net.tick(0.05)
    assert.equal(sent[0]?.t, 'vstate', 'vstate sent before pos')
    assert.equal(sent[0]?.mode, 'car')
    assert.equal(sent[0]?.id, 'car-1')
    assert.equal(sent[0]?.x, 12)
    assert.equal(sent[1]?.t, 'pos')

    // Same state does not resend vstate
    sent.length = 0
    await new Promise(resolve => setTimeout(resolve, 60))
    net.tick(0.05)
    assert.equal(sent.filter(m => m.t === 'vstate').length, 0)

    // Switch to drone
    sent.length = 0
    mode = {mode: 'drone'}
    await new Promise(resolve => setTimeout(resolve, 60))
    net.tick(0.05)
    assert.equal(sent[0]?.t, 'vstate')
    assert.equal(sent[0]?.mode, 'drone')
    assert.equal(sent[1]?.t, 'pos')

    const ack = seq => MockWebSocket.instance.onmessage({data:JSON.stringify({t:'vstate_ack',ok:false,reason:'rejected',mode:'foot',seq})})
    ack(sent[0].seq-1)
    assert.equal(mode.mode,'drone')
    ack(sent[0].seq)
    assert.equal(mode.mode,'foot')
    net.dispose()
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})
