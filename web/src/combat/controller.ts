import { Vector3, type Camera, type Group } from 'three'
import type { AvatarRig } from '../walk/avatar-rig'
import type { Player } from '../net-players'
import { hits } from '../input/keymap'
import { isGlobalHotkeyBlocked } from '../walk/input-guard'
import { Fighter } from './state'
import { config, type CombatPacket } from './net'
import { hud } from './hud'
import { pose } from './poses'
import { contact } from './hitdetect'
import { impact, unlockAudio } from './fx'

interface Host {
  canvas: HTMLCanvasElement
  figure: Group
  camera: Camera
  rig: AvatarRig
  allowed: () => boolean
  peers: () => Player[]
  send: (packet: object) => void
  onDown: () => void
  align: (p: Player) => boolean
}
export function combatController(h: Host) {
  const f = new Fighter(),
    ui = hud(),
    screen = new Vector3()
  let seq = 0,
    combo = 0,
    last = -Infinity,
    pending = false,
    posed = false,
    drop = 0,
    requested = '',
    selfId = ''
  function free() {
    return h.allowed() && !f.down && !isGlobalHotkeyBlocked(document.activeElement)
  }
  function punch() {
    const now = performance.now()
    if (
      !free() ||
      f.helping ||
      requested ||
      now - last < config.punchCooldownMs[f.kind] ||
      f.phase(now, false) === 'rising'
    )
      return
    unlockAudio()
    combo = now - last <= config.comboWindowMs ? (combo + 1) % 3 : 0
    last = now
    seq++
    pending = true
    f.swing(combo === 2 ? 'hook' : 'jab', seq % 2 ? 'l' : 'r', now)
    h.send({ t: 'windup', kind: f.kind, s: seq })
  }
  let press: { x: number; y: number; t: number; id: number } | undefined
  h.canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0 && e.pointerType === 'mouse' && free())
      press = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId }
  })
  h.canvas.addEventListener('pointermove', (e) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) >= 6) press = undefined
  })
  window.addEventListener('pointerup', (e) => {
    if (
      press &&
      e.pointerId === press.id &&
      e.target === h.canvas &&
      e.timeStamp - press.t < 200 &&
      hits('Mouse0', 'punch')
    )
      punch()
    press = undefined
  })
  h.canvas.addEventListener('pointercancel', () => {
    press = undefined
  })
  window.addEventListener('keydown', (e) => {
    if (!e.repeat && hits(e.code, 'punch') && !isGlobalHotkeyBlocked(e.target)) punch()
  })
  function nearest(closerThan = Infinity) {
    let best: Player | undefined,
      limit = config.reviveRangeM
    for (const p of h.peers()) {
      if (!p.dn) continue
      const d = Math.hypot(p.x - h.figure.position.x, p.y - h.figure.position.y, p.z - h.figure.position.z)
      if (d < closerThan && d <= limit) {
        best = p
        limit = d
      }
    }
    return best
  }
  function start(closerThan = Infinity) {
    if (!free() || requested || performance.now() - last < config.punchCooldownMs[f.kind]) return false
    const p = nearest(closerThan)
    if (!p || p.helper || !h.align(p)) return false
    requested = p.id
    h.send({ t: 'rescue-start', id: p.id })
    return true
  }
  function stop() {
    if (requested || f.helping) h.send({ t: 'rescue-stop' })
    requested = ''
  }
  window.addEventListener('pointerdown', unlockAudio, { once: true })
  window.addEventListener('keydown', unlockAudio, { once: true })
  ui.punch.onclick = punch
  ui.revive.onpointerdown = (e) => {
    ui.revive.setPointerCapture(e.pointerId)
    start()
  }
  ui.revive.onlostpointercapture = stop
  window.addEventListener('blur', stop)
  function receive(p: CombatPacket, self: string) {
    selfId = self
    const now = performance.now(),
      own = p.id === self
    if (own) {
      const was = f.down
      f.receive(p, now, true)
      if (p.dmg) {
        pending = false
        stop()
      }
      if (!was && f.down) h.onDown()
    }
    if (p.helper && p.helper === self) {
      f.helping = p.id
      f.assistProgress = p.progress
    } else if (f.helping === p.id) {
      f.helping = ''
      requested = ''
    }
    if (!p.dmg) return
    const peer = h.peers().find((peer) => peer.id === p.id)
    screen.copy(h.figure.position)
    if (!own && peer) screen.set(peer.x, peer.y, peer.z)
    const distance = screen.distanceTo(h.figure.position)
    if (p.contact) {
      screen.x += p.contact[0]
      screen.y += p.contact[1]
      screen.z += p.contact[2]
    } else screen.y += p.zone === 'head' ? 1.53 : 1.15
    screen.project(h.camera)
    if (distance < 25)
      impact(
        ((1 + screen.x) * innerWidth) / 2,
        ((1 - screen.y) * innerHeight) / 2,
        Math.min(1, p.dmg / (config.damage.hook * config.zone.head)),
        p.kind === 'hook',
        distance,
        own,
        h.canvas,
      )
    if (own || p.by === self)
      window.dispatchEvent(
        new CustomEvent('combat:hit', { detail: { dmg: p.dmg, heavy: !!p.heavy, dir: p.dir } }),
      )
  }
  function resetPose() {
    if (posed) {
      h.rig.clearPose()
      h.figure.position.y += drop
      drop = 0
      posed = false
    }
  }
  function tick(moving: boolean) {
    const now = performance.now(),
      phase = f.phase(now, moving)
    if (pending && now - last >= 100) {
      if (free()) {
        pose(h.rig, f, 'strike', f.punched + 120, h.figure.rotation.y)
        posed = true
        const hand =
          h.rig.attachmentAt?.('hand_' + f.side) ??
          h.figure.getObjectByName(f.side === 'l' ? 'ForearmL' : 'ForearmR')
        h.send({
          t: 'punch',
          kind: f.kind,
          zone: 'body',
          s: seq,
          ...contact(hand, h.figure.position, h.peers()),
        })
      }
      pending = false
    }
    if (phase !== 'idle') {
      drop = pose(h.rig, f, phase, now, h.figure.rotation.y, h.figure)
      h.figure.position.y -= drop
      posed = true
    }
    const p = nearest(),
      prompt =
        f.down || !p || !h.allowed() ? '' : p.helper && p.helper !== selfId ? '正在被救援' : '长按 E 救援'
    if (prompt && p) {
      screen.set(p.x, p.y + 1.6, p.z).project(h.camera)
      ui.tip.style.left = ((1 + screen.x) * innerWidth) / 2 + 'px'
      ui.tip.style.top = ((1 - screen.y) * innerHeight) / 2 + 'px'
    }
    ui.update(f, phase, now, prompt, f.down ? f.progress : (p?.progress ?? 0))
    ui.punch.hidden ||= !h.allowed()
  }
  function hide() {
    stop()
    resetPose()
    ui.root.hidden = true
    pending = false
  }
  return {
    f,
    start,
    stop,
    receive,
    tick,
    hide,
    resetPose,
    get drop() {
      return drop
    },
    reset() {
      hide()
      Object.assign(f, new Fighter())
      requested = ''
    },
  }
}
