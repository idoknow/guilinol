import config from '../../../rt/combat-config.json'
export { config }
export type Kind = 'jab' | 'hook'
export type Side = 'l' | 'r'
export interface CombatPacket {
  id: string
  hp: number
  dn: number
  remaining: number
  helper: string
  progress: number
  windup?: Kind
  swing?: Kind
  kind?: Kind
  side?: Side
  by?: string
  contact?: [number, number, number]
  dir?: number
  dmg?: number
  heavy?: boolean
  zone?: 'head' | 'body'
}
