import test from 'node:test'
import assert from 'node:assert/strict'
import { combat, config as c } from './combat.mjs'

function fixture() {
  let time = 10000
  const players = new Map(),
    events = [],
    fight = combat(players, (_, packet) => events.push(packet))
  const player = (id) => {
    const p = { id, ws: { readyState: 1 }, x: 0, y: 0, z: 0, activity: 'walk', gr: 1, hp: c.hpMax, dn: 0 }
    players.set(id, p)
    return p
  }
  const a = player('a'),
    b = player('b'),
    other = player('c')
  const tick = (ms) => {
    time += ms
    fight.tick(time)
  }
  const input = (p, msg) => fight.input(p, msg, time)
  const punch = (target = b, zone = 'body') =>
    input(a, { t: 'punch', id: target.id, kind: 'jab', zone, s: 1 })
  const start = (p) => input(p, { t: 'rescue-start', id: b.id })
  const down = () => {
    while (!b.dn) {
      tick(700)
      punch()
    }
  }
  return { a, b, other, events, input, tick, punch, start, down }
}
test('damage, cooldown, vertical and horizontal reach, stance and combo', () => {
  const { a, b, punch, tick } = fixture()
  punch()
  assert.equal(b.hp, 92)
  punch()
  assert.equal(b.hp, 92)
  tick(350)
  punch(b, 'head')
  assert.equal(b.hp, 80)
  tick(350)
  punch(b, 'head')
  assert.equal(b.hp, 57)
  tick(350)
  punch()
  assert.equal(b.hp, 57)
  tick(1000)
  b.x = 2
  punch()
  assert.equal(b.hp, 57)
  tick(1000)
  b.x = 0
  b.y = 3
  punch()
  assert.equal(b.hp, 57)
  tick(1000)
  b.y = 0
  b.activity = 'boat'
  punch()
  assert.equal(b.hp, 57)
  tick(1000)
  b.activity = 'walk'
  a.bike = 'bike'
  punch()
  assert.equal(b.hp, 57)
})
test('down is immune, times out at 15 seconds and regenerates after the delay', () => {
  const { a, b, other, tick, down, input } = fixture()
  down()
  assert.equal(b.hp, 0)
  input(other, { t: 'punch', id: b.id, kind: 'jab', zone: 'head' })
  input(b, { t: 'punch', id: a.id, kind: 'hook', zone: 'head' })
  assert.equal(a.hp, 100)
  tick(14999)
  assert.equal(b.dn, 1)
  tick(1)
  assert.equal(b.hp, 30)
  assert.equal(b.dn, 0)
  tick(8000)
  assert.equal(b.hp, 30)
  tick(1000)
  assert.equal(b.hp, 33)
})
test('one helper, release and movement decay, hit interruption and revive HP', () => {
  const { a, b, other, start, down, input, tick } = fixture()
  down()
  start(b)
  assert(!b.helper)
  start(a)
  start(other)
  assert.equal(b.helper, a.id)
  tick(1500)
  assert.equal(b.progress, 0.5)
  input(a, { t: 'rescue-stop' })
  tick(500)
  assert.equal(b.progress, 0.25)
  start(other)
  other.x = 0.35
  tick(100)
  assert(!b.helper)
  start(a)
  input(other, { t: 'punch', id: a.id, kind: 'jab', zone: 'body' })
  assert(!b.helper)
  tick(1000)
  start(other)
  tick(2999)
  assert.equal(b.dn, 1)
  tick(1)
  assert.equal(b.hp, 40)
  assert.equal(b.dn, 0)
  assert(!other.helping)
})
test('cooldown tolerates packet jitter at max click rate', () => {
  const { b, punch, tick } = fixture()
  punch()
  assert.equal(b.hp, 92)
  // 客户端按 350 ms 点击，包到达间隔被抖动压到 300 ms，仍应结算
  tick(300)
  punch()
  assert.equal(b.hp, 84)
  // 但低于 200 ms 下限的连发仍拒绝
  tick(150)
  punch()
  assert.equal(b.hp, 84)
})
