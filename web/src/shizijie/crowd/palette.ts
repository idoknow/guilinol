import type { SzjCrowdRole } from './types.ts'

export interface SeededRng {
  next(): number
  range(min: number, max: number): number
  pick<T>(items: readonly T[]): T
}

function hashSeed(seed: number | string): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return (seed >>> 0) || 0x9e3779b9
  }
  const str = String(seed)
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0 || 0x9e3779b9
}

export function createSeededRng(seed: number | string = 'shizijie-b1-crowd'): SeededRng {
  let state = hashSeed(seed)
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range(min: number, max: number): number {
      return min + (max - min) * next()
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length) % items.length]!
    },
  }
}

const KEEPER_SHIRTS = [
  '#252b34',
  '#b63a32',
  '#2d5b54',
  '#42352c',
  '#35465d',
  '#d9d2c4',
] as const

const CUSTOMER_SHIRTS = [
  '#efe7da',
  '#4c729b',
  '#c9685b',
  '#5d8370',
  '#d3a358',
  '#8c7296',
  '#3e4651',
  '#d88996',
  '#7c8ea3',
  '#b97f57',
] as const

const WALKER_SHIRTS = [
  '#e7dfd1',
  '#34495e',
  '#6a8b74',
  '#c36e55',
  '#7d6b8a',
  '#c89c52',
  '#4f6272',
  '#d49ca5',
  '#2c333d',
  '#8a7967',
] as const

const PANTS_COLORS = [
  '#272d36',
  '#364b68',
  '#4e565e',
  '#5b4d41',
  '#2b3642',
  '#6c685f',
  '#3f4e63',
] as const

const SKIN_TINTS = [
  '#fff7f0',
  '#f6ece3',
  '#ecdccf',
  '#f9efe6',
] as const

const SHOPPING_BAG_COLORS = [
  '#d4473b',
  '#f0e6d2',
  '#2f7a6d',
  '#3b5c8c',
  '#df9d3d',
  '#c46782',
  '#2c313a',
] as const

const KEEPER_PARCEL_COLORS = [
  '#c69866',
  '#d7c7ad',
  '#a97c50',
] as const

export interface SzjNpcPaletteEntry {
  readonly shirtColor: string
  readonly pantsColor: string
  readonly skinTint: string
  readonly propColor: string
}

export function pickNpcPalette(role: SzjCrowdRole, rng: SeededRng): SzjNpcPaletteEntry {
  const shirtColor =
    role === 'keeper'
      ? rng.pick(KEEPER_SHIRTS)
      : role === 'customer'
        ? rng.pick(CUSTOMER_SHIRTS)
        : rng.pick(WALKER_SHIRTS)

  const propColor =
    role === 'keeper'
      ? rng.pick(KEEPER_PARCEL_COLORS)
      : rng.pick(SHOPPING_BAG_COLORS)

  return {
    shirtColor,
    pantsColor: rng.pick(PANTS_COLORS),
    skinTint: rng.pick(SKIN_TINTS),
    propColor,
  }
}
