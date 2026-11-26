import { config, type CombatPacket, type Kind, type Side } from './net'
export type Phase =
  | 'idle'
  | 'windup'
  | 'strike'
  | 'recover'
  | 'stagger'
  | 'falling'
  | 'down'
  | 'crawling'
  | 'being_revived'
  | 'reviving'
  | 'rising'
export class Fighter {
  hp = config.hpMax
  down = false
  deadline = 0
  helper = ''
  assistProgress = 0
  helping = ''
  progress = 0
  hpShownUntil = 0
  kind: Kind = 'jab'
  side: Side = 'l'
  punched = -Infinity
  struck = -Infinity
  fallen = -Infinity
  riseWeight = 1
  risen = -Infinity
  dir = 0
  heavy = false
  swing(kind: Kind, side: Side, now: number) {
    this.kind = kind
    this.side = side
    this.punched = now
    this.struck = -Infinity
  }
  receive(p: CombatPacket, now: number, local = false) {
    if (!local) {
      if (p.windup) this.swing(p.windup, p.side ?? 'l', now)
      if (p.swing) this.swing(p.swing, p.side ?? 'l', now - 100)
    }
    if (p.dmg) {
      this.struck = now
      this.punched = -Infinity
      this.dir = p.dir ?? 0
      this.heavy = !!p.heavy
      this.hpShownUntil = now + config.overheadBarHideSeconds * 1000
    }
    if (p.dn && !this.down) this.fallen = now
    if (!p.dn && this.down) {
      this.risen = now
      this.riseWeight = this.helper ? 1 - 0.45 * this.progress : 1
    }
    this.hp = p.hp ?? config.hpMax
    this.down = !!p.dn
    this.deadline = now + (p.remaining ?? 0)
    this.helper = p.helper ?? ''
    this.progress = p.progress ?? 0
  }
  phase(now: number, moving: boolean): Phase {
    if (this.down) {
      if (this.helper) return 'being_revived'
      if (now - this.fallen < 320) return 'falling'
      return moving ? 'crawling' : 'down'
    }
    if (now - this.risen < 420) return 'rising'
    if (this.helping) return 'reviving'
    if (now - this.struck < (this.heavy ? 410 : 280)) return 'stagger'
    const t = now - this.punched
    if (t < 100) return 'windup'
    if (t < 160) return 'strike'
    if (t < config.punchCooldownMs[this.kind]) return 'recover'
    return 'idle'
  }
}
