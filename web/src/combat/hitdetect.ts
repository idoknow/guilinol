import { Vector3, type Object3D } from 'three'
import type { Player } from '../net-players'
import { config } from './net'
const fist = new Vector3()
export function contact(hand: Object3D | undefined, base: Vector3, peers: Player[]) {
  if (!hand) return
  hand.getWorldPosition(fist)
  let best,
    nearest = Infinity
  for (const p of peers) {
    if (p.foot === false || p.dn || p.bike || !p.gr || Math.hypot(p.x - base.x, p.z - base.z) > config.reachM)
      continue
    const y = fist.y - p.y
    const distance = Math.hypot(fist.x - p.x, fist.z - p.z, y - Math.max(0.35, Math.min(1.65, y)))
    if (distance < 0.39 && distance < nearest) {
      nearest = distance
      best = { id: p.id, zone: y > 1.42 ? 'head' : 'body', contact: [fist.x - p.x, y, fist.z - p.z] }
    }
  }
  return best
}
