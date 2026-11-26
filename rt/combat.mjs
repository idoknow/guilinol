import { readFileSync } from 'node:fs'
export const config = JSON.parse(readFileSync(new URL('./combat-config.json', import.meta.url)))
const c = config
const foot = new Set(['walk', 'idle', 'mission', 'photo', 'smoke', 'fishing'])
const standing = (p) =>
  p && p.ws?.readyState === 1 && p.foot !== false && !p.dn && !p.bike && p.gr && foot.has(p.activity)
// 冷却按包到达时间算，客户端按点击时间算；留 cooldownSlackMs 吸收网络抖动和掉帧，否则满速连按会被静默吞拳
const gap = (kind) => Math.max(200, c.punchCooldownMs[kind] - (c.cooldownSlackMs ?? 0))
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
export function snapshot(p, at) {
  return {
    hp: p.hp,
    dn: p.dn,
    remaining: Math.max(0, (p.downUntil ?? 0) - at),
    helper: p.helper ?? '',
    progress: p.progress ?? 0,
  }
}
export function combat(players, broadcast) {
  const changed = (p, at, extra = {}) => broadcast(p, { t: 'combat', id: p.id, ...snapshot(p, at), ...extra })
  function cancel(helper, at) {
    const target = players.get(helper.helping)
    if (target?.helper === helper.id) {
      if (target.downUntil <= at) {
        rise(target, c.selfRiseHpRatio, at)
        return
      }
      if (
        target.ws?.readyState === 1 &&
        standing(helper) &&
        distance(helper, target) <= c.reviveRangeM &&
        distance(helper, helper.origin) <= c.reviveMoveM
      ) {
        target.progress += (at - target.updated) / (1000 * c.reviveHoldSeconds)
        if (target.progress >= 1 - 1e-8) {
          rise(target, c.reviveHpRatio, at)
          return
        }
      }
      target.helper = null
      target.updated = at
      changed(target, at)
    }
    helper.helping = null
  }
  function rise(p, ratio, at) {
    const helper = players.get(p.helper)
    if (helper) helper.helping = null
    p.helper = null
    p.dn = 0
    p.progress = 0
    p.downUntil = 0
    p.hp = Math.round(c.hpMax * ratio)
    p.lastCombat = p.updated = at
    changed(p, at)
  }
  function input(p, msg, at) {
    if (msg.t === 'rescue-stop') {
      cancel(p, at)
      return
    }
    if (!standing(p) || p.helping || !['walk', 'idle', 'mission'].includes(p.activity)) return
    const target = players.get(msg.id)
    if (msg.t === 'rescue-start') {
      if (
        !target?.dn ||
        target === p ||
        target.helper ||
        target.ws?.readyState !== 1 ||
        distance(p, target) > c.reviveRangeM
      )
        return
      if (target.downUntil <= at) {
        rise(target, c.selfRiseHpRatio, at)
        return
      }
      target.progress = Math.max(0, target.progress - ((at - target.updated) / 1000) * c.reviveDecayPerSec)
      target.helper = p.id
      target.updated = at
      p.helping = target.id
      // 施救者站位：倒地者肩侧（前 0.35 m、侧 0.55 m，左右两侧任选），其次正前 0.6 m；客户端挑一个能站的
      const yaw = target.yaw ?? 0,
        fx = -Math.sin(yaw),
        fz = -Math.cos(yaw),
        spot = (f, s) => ({ x: target.x + fx * f + fz * s, y: p.y, z: target.z + fz * f - fx * s })
      p.alignment = { spots: [spot(0.35, 0.55), spot(0.35, -0.55), spot(0.6, 0)], until: at + 250 }
      p.origin = { x: p.x, y: p.y, z: p.z }
      changed(target, at)
      return
    }
    if (msg.t === 'windup') {
      if (at < (p.nextPunch ?? 0) || at < (p.nextWindup ?? 0)) return
      p.nextWindup = at + gap('jab')
      changed(p, at, { windup: msg.kind === 'hook' ? 'hook' : 'jab', side: msg.s % 2 === 1 ? 'l' : 'r' })
      return
    }
    if (
      msg.t !== 'punch' ||
      !Object.hasOwn(c.damage, msg.kind) ||
      !Object.hasOwn(c.zone, msg.zone) ||
      at < (p.nextPunch ?? 0)
    )
      return
    p.combo = at - (p.lastPunch ?? -Infinity) <= c.comboWindowMs ? (p.combo + 1) % 3 : 0
    const kind = p.combo === 2 ? 'hook' : 'jab'
    p.lastPunch = p.lastCombat = at
    p.nextPunch = at + gap(kind)
    changed(p, at, { swing: kind, side: msg.s % 2 === 1 ? 'l' : 'r' })
    if (!standing(target) || p === target || distance(p, target) > c.reachM + c.networkMarginM) return
    const dmg = Math.round(c.damage[kind] * c.zone[msg.zone])
    cancel(target, at)
    target.hp = Math.max(0, target.hp - dmg)
    target.lastCombat = target.updated = at
    if (!target.hp) {
      target.dn = 1
      target.downUntil = at + c.downSeconds * 1000
      target.progress = 0
    }
    changed(target, at, {
      by: p.id,
      dmg,
      heavy: kind === 'hook' && msg.zone === 'head',
      kind,
      dir: Math.atan2(p.x - target.x, p.z - target.z),
      zone: msg.zone,
      contact:
        Array.isArray(msg.contact) && msg.contact.length === 3 && msg.contact.every(Number.isFinite)
          ? [
              Math.max(-0.4, Math.min(0.4, msg.contact[0])),
              Math.max(0, Math.min(2, msg.contact[1])),
              Math.max(-0.4, Math.min(0.4, msg.contact[2])),
            ]
          : undefined,
    })
  }
  function tick(at) {
    for (const p of players.values()) {
      if (p.dn) {
        if (at >= p.downUntil) {
          rise(p, c.selfRiseHpRatio, at)
          continue
        }
        const helper = players.get(p.helper)
        if (
          helper?.alignment &&
          at <= helper.alignment.until &&
          helper.alignment.spots.some((spot) => distance(helper, spot) < 0.2)
        ) {
          helper.origin = { x: helper.x, y: helper.y, z: helper.z }
          helper.alignment = null
        }
        if (
          p.helper &&
          (!standing(helper) ||
            distance(helper, helper.origin) > c.reviveMoveM ||
            distance(helper, p) > c.reviveRangeM ||
            p.ws?.readyState !== 1)
        ) {
          if (helper) cancel(helper, at)
          else {
            p.helper = null
            changed(p, at)
          }
        }
        const dt = (at - p.updated) / 1000
        p.updated = at
        if (!p.helper && !p.progress) continue
        p.progress = Math.max(
          0,
          p.progress + dt * (p.helper ? 1 / c.reviveHoldSeconds : -c.reviveDecayPerSec),
        )
        if (p.progress >= 1 - 1e-8) rise(p, c.reviveHpRatio, at)
        else changed(p, at)
      } else if (p.hp < c.hpMax) {
        const dt = at - Math.max(p.updated, p.lastCombat + c.regenDelaySeconds * 1000)
        if (dt >= 1000) {
          p.hp = Math.min(c.hpMax, p.hp + (c.regenPerSec * dt) / 1000)
          p.updated = at
          changed(p, at)
        }
      }
    }
  }
  return { input, tick, cancel }
}
