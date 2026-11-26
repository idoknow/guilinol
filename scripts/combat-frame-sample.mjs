import { once } from 'node:events'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { frameSample } from './mp-frame.mjs'

// One observer and eight visible combatants. The same eight rigs stay in
// place for both samples. Only punch traffic changes between the samples.
export async function combatFrames(page, rt, ticket) {
  const center = await page.evaluate(() => window.viewer.walk.probe().figPos)
  const bots = []
  let timer
  try {
    for (let i = 0; i < 8; i++) {
      const socket = new WebSocket('ws://' + rt + '/ws')
      await once(socket, 'open')
      const next = once(socket, 'message')
      const pose = {
        x: center[0] + Math.floor(i / 2) * 1.35 - 2,
        y: center[1],
        z: center[2] - 1.8 - (i % 2) * 0.65,
        yaw: i % 2 ? Math.PI : 0,
        gr: 1,
        v: 0,
      }
      socket.send(JSON.stringify({ t: 'join', ticket: ticket(100010 + i), ...pose }))
      const { me } = JSON.parse((await next)[0])
      bots.push({ socket, id: me.id })
      socket.send(JSON.stringify({ t: 'pos', ...pose }))
    }
    await page.waitForFunction(() => window.viewer.walk.net.probe().filter((p) => p.ready).length === 8)
    await page.waitForTimeout(600)
    const baseline = await frameSample(page)
    let s = 0
    const punch = () => {
      s++
      for (const [i, bot] of bots.entries())
        bot.socket.send(JSON.stringify({ t: 'punch', s, kind: 'jab', zone: 'body', id: bots[i ^ 1].id }))
    }
    punch()
    timer = setInterval(punch, 700)
    const fighting = await frameSample(page),
      delta = fighting.mean - baseline.mean
    console.log('8 visible fighters (ms)', JSON.stringify({ baseline, fighting, delta }))
    assert(delta < 1, 'Mean frame overhead ' + delta + ' ms')
  } finally {
    clearInterval(timer)
    for (const bot of bots) bot.socket.terminate()
  }
}
