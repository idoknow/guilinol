export interface SeededRng {
  next(): number
  range(min: number, max: number): number
  int(minInclusive: number, maxExclusive: number): number
  pick<T>(items: readonly T[], fallback: T): T
  weightedPick<T>(items: readonly T[], weights: readonly number[], fallback: T): T
}

export function hashSeed(seed: number | string | undefined): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    const u = Math.floor(seed) >>> 0
    return u === 0 ? 0x6d2b79f5 : u
  }
  const str = typeof seed === 'string' && seed.length > 0 ? seed : 'guilin-wangcheng-drinks-v1'
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) || 0x6d2b79f5
}

export function createSeededRng(seed?: number | string): SeededRng {
  let state = hashSeed(seed)

  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    range(min: number, max: number): number {
      return min + (max - min) * next()
    },
    int(minInclusive: number, maxExclusive: number): number {
      if (maxExclusive <= minInclusive) return minInclusive
      return minInclusive + Math.floor(next() * (maxExclusive - minInclusive))
    },
    pick<T>(items: readonly T[], fallback: T): T {
      if (!items.length) return fallback
      return items[Math.floor(next() * items.length)] ?? fallback
    },
    weightedPick<T>(items: readonly T[], weights: readonly number[], fallback: T): T {
      if (!items.length) return fallback
      let total = 0
      for (let i = 0; i < items.length; i++) {
        const w = weights[i] ?? 0
        if (w > 0) total += w
      }
      if (total <= 0) return items[0] ?? fallback
      let r = next() * total
      for (let i = 0; i < items.length; i++) {
        const w = Math.max(0, weights[i] ?? 0)
        r -= w
        if (r <= 0) return items[i] ?? fallback
      }
      return items[items.length - 1] ?? fallback
    },
  }
}
