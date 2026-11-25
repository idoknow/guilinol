import type {Manifest, Tile} from './world'

// Rows stay in world coordinates even when a new manifest changes the extent.
export class TileGrid {
  private rows = new Map<number, Map<number, Tile>>()
  private size: number

  constructor(manifest: Manifest) {
    this.size = manifest.chunkSize
    for (const tile of manifest.chunks) {
      let row = this.rows.get(tile.z)
      if (!row) this.rows.set(tile.z, row = new Map())
      row.set(tile.x, tile)
    }
  }

  at(x: number, z: number) {
    const size = this.size
    return this.rows.get(Math.floor(z / size) * size)?.get(Math.floor(x / size) * size)
  }

  *near(x: number, z: number, radius: number) {
    const size = this.size
    const first = (v: number) => Math.ceil((v - radius) / size - 0.5) * size
    const last = (v: number) => v + radius - size / 2
    for (let tz = first(z); tz <= last(z); tz += size) {
      const row = this.rows.get(tz)
      if (!row) continue
      for (let tx = first(x); tx <= last(x); tx += size) {
        const tile = row.get(tx)
        if (tile) yield tile
      }
    }
  }
}

export function tileEdgeDistance(tile:Tile, x:number, z:number){
  return Math.hypot(Math.max(0,Math.abs(x-tile.x-128)-128),Math.max(0,Math.abs(z-tile.z-128)-128))
}

export const streamBudget = {
  residentTiles: 180, detailRequests: 8, innerRequests: 6, treeRequests: 6,
  parseMs: 5, attachMs: 4, priorityRadius: 300, priorityTreeRadius: 128,
}

// Each resolution resumes the awaiting parser/attachment before the next
// microtask checks elapsed wall time. Even an oversized job makes progress.
export function frameSlots(milliseconds: number) {
  const waiting: (() => void)[] = []
  let scheduled = false
  function drain() {
    const start = performance.now()
    function next() {
      if (!waiting.length) { scheduled = false; return }
      waiting.shift()!()
      queueMicrotask(() => {
        if (waiting.length && performance.now() - start >= milliseconds) requestAnimationFrame(drain)
        else next()
      })
    }
    next()
  }
  return () => new Promise<void>(resolve => {
    waiting.push(resolve)
    if (!scheduled) { scheduled = true; requestAnimationFrame(drain) }
  })
}
