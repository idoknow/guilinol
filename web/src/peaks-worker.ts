import {northCyclewayGrade,slopeStart,slopeRatio,yueyaShoulderHeight} from './yueya-slope.ts'

export interface PeakWorkerInput {
  packed: ArrayBuffer
  entries: {name: string; center: [number, number, number]; lods: {offset: number; vertices: number; indices: number; indexOffset: number}[]; model?: string}[]
  palette: number[][]
  bareFrom: number
  rockShare: number
  jitter: number
}

export interface BatchedPeakMeta {
  name: string
  center: [number, number, number]
  radius: number
  vStart0: number
  vCount0: number
  idx0: Uint32Array
  idx1: Uint16Array | Uint32Array
}

export interface PeakWorkerOutput {
  pos0: Float32Array
  norm0: Int8Array
  col0: Float32Array
  height0: Uint8Array
  pick0: Uint16Array
  pos1: Float32Array
  norm1: Int8Array
  col1: Float32Array
  height1: Uint8Array
  pick1: Uint16Array
  localIdx0: Uint32Array
  peaks: BatchedPeakMeta[]
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x)
function clearYueyaRoad(positions:Float32Array,normals:Int8Array,start:number,count:number) {
  for(let vertex=start;vertex<start+count;vertex++) {
    const at=vertex*3
    const east=positions[at], south=positions[at+2], height=positions[at+1]
    const adjusted=yueyaShoulderHeight(east,height,south)
    if(adjusted!==height){
      const gradX=yueyaShoulderHeight(east+.5,height,south)-yueyaShoulderHeight(east-.5,height,south)
      const gradZ=yueyaShoulderHeight(east,height,south+.5)-yueyaShoulderHeight(east,height,south-.5)
      const ny=normals[at+1]*(height-158)/(adjusted-158)
      const nx=normals[at]-gradX*ny,nz=normals[at+2]-gradZ*ny
      const scale=127/(Math.hypot(nx,ny,nz)||1)
      normals.set([Math.round(nx*scale),Math.round(ny*scale),Math.round(nz*scale)],at)
      positions[at+1]=adjusted
    }
    const from=slopeStart(positions[at]), distance=positions[at+2]-from
    if(distance<=0)continue
    const ratio=slopeRatio(distance), derivative=ratio*ratio
    positions[at+2]=from+distance*ratio
    const nz=normals[at+2]/derivative, nx=normals[at]-northCyclewayGrade*(1-derivative)*nz, ny=normals[at+1]
    const scale=127/(Math.hypot(nx,ny,nz)||1)
    normals[at]=Math.round(nx*scale);normals[at+1]=Math.round(ny*scale);normals[at+2]=Math.round(nz*scale)
  }
}
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const hash = (x: number, z: number) => {
  const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
  return v - Math.floor(v)
}
// Neighbouring vertices and both LODs sample the same integer noise lattice.
// Cache exact double-precision values for the common range during this worker's lifetime.
const lattice = new Float64Array(256*256).fill(NaN)
function latticeHash(x:number,z:number) {
  if(x < -128 || x >= 128 || z < -128 || z >= 128)return hash(x,z)
  const i=(z+128)*256+x+128, value=lattice[i]
  if(Number.isFinite(value))return value
  return lattice[i]=hash(x,z)
}
const noise = (x: number, z: number, cell: number) => {
  const gx = x / cell, gz = z / cell, ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz)
  const a = latticeHash(ix, iz), b = latticeHash(ix + 1, iz), c = latticeHash(ix, iz + 1), d = latticeHash(ix + 1, iz + 1)
  const ab = a + (b - a) * u, cd = c + (d - c) * u
  return ab + (cd - ab) * v
}

self.onmessage = async (event: MessageEvent<PeakWorkerInput>) => {
  const {packed, entries, palette, bareFrom, rockShare, jitter} = event.data
  const buffer = await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  const view = new DataView(buffer)
  if (view.getUint32(0) !== 0x504b3032) throw Error('Invalid PK02 header')

  const [foot, green, dark, light, rock, rockDark, ochre] = palette
  const procedural = entries.filter(e => !e.model && e.lods.length >= 2)

  let total0 = 0, total1 = 0
  for (const e of procedural) {
    total0 += e.lods[0].vertices
    total1 += e.lods[1].vertices
  }

  const pos0 = new Float32Array(total0 * 3)
  const norm0 = new Int8Array(total0 * 3)
  const col0 = new Float32Array(total0 * 3)
  const height0 = new Uint8Array(total0)
  const pick0 = new Uint16Array(total0)

  // The city-wide bootstrap package uses the same coarse mesh for both
  // levels until its detail sector arrives. Shade and transfer it once.
  const sharedLevel = procedural.every(({lods})=>lods[0].offset===lods[1].offset && lods[0].vertices===lods[1].vertices)
  const pos1 = sharedLevel ? pos0 : new Float32Array(total1 * 3)
  const norm1 = sharedLevel ? norm0 : new Int8Array(total1 * 3)
  const col1 = sharedLevel ? col0 : new Float32Array(total1 * 3)
  const height1 = sharedLevel ? height0 : new Uint8Array(total1)
  const pick1 = sharedLevel ? pick0 : new Uint16Array(total1)

  const sharedIdx = new Map<number, Uint16Array>()
  const getShared = (indexOffset: number, indices: number) => {
    let arr = sharedIdx.get(indexOffset)
    if (!arr) {
      arr = new Uint16Array(buffer.slice(indexOffset, indexOffset + indices * 2))
      sharedIdx.set(indexOffset, arr)
    }
    return arr
  }

  function fillLevel(
    lod: {offset: number; vertices: number},
    cx: number, cy: number, cz: number, pickVal: number,
    outPos: Float32Array, outNorm: Int8Array, outCol: Float32Array, outHeight: Uint8Array, outPick: Uint16Array,
    vStart: number, calcRadius: boolean, riverCliff: boolean,
  ) {
    const {offset, vertices} = lod
    outNorm.set(new Int8Array(buffer, offset + vertices * 6, vertices * 3), vStart * 3)
    const weights = new Uint8Array(buffer, offset + vertices * 9, vertices * 2)
    outPick.fill(pickVal, vStart, vStart + vertices)
    let maxR2 = 0
    for (let i = 0; i < vertices; i++) {
      const base = offset + i * 6
      const lx = view.getInt16(base, true) / 100
      const ly = view.getInt16(base + 2, true) / 100
      const lz = view.getInt16(base + 4, true) / 100
      if (calcRadius) {
        const r2 = lx * lx + ly * ly + lz * lz
        if (r2 > maxR2) maxR2 = r2
      }
      const pAt = (vStart + i) * 3
      outPos[pAt] = lx + cx
      outPos[pAt + 1] = ly + cy
      outPos[pAt + 2] = lz + cz

      const wRock = weights[i * 2] / 255
      const hRaw = weights[i * 2 + 1]
      const wHeight = hRaw / 255
      outHeight[vStart + i] = hRaw

      const clump = noise(lx + ly * 0.3, lz - ly * 0.3, 7) * 0.65 + noise(lx, lz, 2.5) * 0.35
      const tGreen = smooth(0.2, 0.75, clump)
      const tLight = smooth(0.62, 0.95, clump) * (0.35 + 0.4 * wHeight)
      const tFoot = (1 - smooth(0.03, 0.18, wHeight)) * 0.7

      let r = dark[0] + (green[0] - dark[0]) * tGreen
      let g = dark[1] + (green[1] - dark[1]) * tGreen
      let b = dark[2] + (green[2] - dark[2]) * tGreen
      r += (light[0] - r) * tLight
      g += (light[1] - g) * tLight
      b += (light[2] - b) * tLight
      r += (foot[0] - r) * tFoot
      g += (foot[1] - g) * tFoot
      b += (foot[2] - b) * tFoot

      const rockFactor = smooth(0.55, 0.9, wRock)
      if (rockFactor > 0) {
        const angle = Math.atan2(lz, lx)
        const band = noise(angle * 9, ly * 0.04, 1) * 0.7 + noise(angle * 30, ly * 0.12, 1) * 0.3
        const bareBand = smooth(bareFrom, bareFrom + 0.18, band)
        if (bareBand > 0) {
          const ledge = noise(angle * 22, ly * 0.35, 1)
          const bare = rockFactor * bareBand * (0.55 + 0.45 * smooth(0.3, 0.6, ledge))
          const runnel = Math.pow(Math.sin(angle * 53 + Math.sin(angle * 7) * 1.5) * 0.5 + 0.5, 3)
          const tOchre = smooth(0.7, 0.9, noise(angle * 14, ly * 0.05, 1)) * 0.45
          const tDark = runnel * (0.3 + 0.45 * smooth(0.15, 0.85, 1 - wHeight))
          let sr = rock[0] + (ochre[0] - rock[0]) * tOchre
          let sg = rock[1] + (ochre[1] - rock[1]) * tOchre
          let sb = rock[2] + (ochre[2] - rock[2]) * tOchre
          sr += (rockDark[0] - sr) * tDark
          sg += (rockDark[1] - sg) * tDark
          sb += (rockDark[2] - sb) * tDark
          const share = clamp(bare * rockShare, 0, 1)
          r += (sr - r) * share
          g += (sg - g) * share
          b += (sb - b) * share
        }
      }

      if (riverCliff && lx>0) {
        const exposure=smooth(.18,.65,lx/Math.max(1,Math.hypot(lx,lz)))*(1-smooth(.78,.95,wHeight))
        const streak=smooth(.49,.82,noise(lz*.65,ly*.045,2.8))
        const stone=.81-.25*streak+.055*Math.sin(ly*.89+noise(lx,lz,8)*2)
        r+=(stone-r)*exposure; g+=(stone-.012-g)*exposure; b+=(stone-.024-b)*exposure
      }
      const scale = 1 + (hash(lx, lz) - 0.5) * 2 * jitter
      outCol[pAt] = r * scale
      outCol[pAt + 1] = g * scale
      outCol[pAt + 2] = b * scale
    }
    return Math.sqrt(maxR2)
  }

  const peaks: BatchedPeakMeta[] = []
  let cursor0 = 0, cursor1 = 0
  let localIdx0 = new Uint32Array(0)

  for (const entry of procedural) {
    const [cx, cy, cz] = entry.center
    const rawPick = Math.sin(cx * 12.9898 + cz * 78.233) * 43758.5453
    const hash = rawPick - Math.floor(rawPick)
    // night.ts: pick < .25 → unlit, .25–.55 → warm uplight, > .55 → jade. Named scenic peaks are always lit
    // (as in the real city at night); generated DEM peaks keep the random mix including unlit ones.
    const pickFrac = entry.name.startsWith('auto-') ? hash : .25 + hash * .75
    const pickVal = Math.round(pickFrac * 65535)

    const lod0 = entry.lods[0], lod1 = entry.lods[1]
    const riverCliff=entry.name==='伏波山'
    const radius = fillLevel(lod0, cx, cy, cz, pickVal, pos0, norm0, col0, height0, pick0, cursor0, true,riverCliff)
    if(!sharedLevel)fillLevel(lod1, cx, cy, cz, pickVal, pos1, norm1, col1, height1, pick1, cursor1, false,riverCliff)
    if(entry.name==='月牙山') {
      clearYueyaRoad(pos0,norm0,cursor0,lod0.vertices)
      if(!sharedLevel)clearYueyaRoad(pos1,norm1,cursor1,lod1.vertices)
    }

    const template0 = getShared(lod0.indexOffset, lod0.indices)
    if (!localIdx0.length) localIdx0 = Uint32Array.from(template0)
    const idx0 = new Uint32Array(template0.length)
    for (let i = 0; i < template0.length; i++) idx0[i] = template0[i] + cursor0

    const template1 = getShared(lod1.indexOffset, lod1.indices)
    const idx1 = total1 > 65535 ? new Uint32Array(template1.length) : new Uint16Array(template1.length)
    for (let i = 0; i < template1.length; i++) idx1[i] = template1[i] + cursor1

    peaks.push({
      name: entry.name,
      center: entry.center,
      radius,
      vStart0: cursor0,
      vCount0: lod0.vertices,
      idx0,
      idx1,
    })

    cursor0 += lod0.vertices
    cursor1 += lod1.vertices
  }

  const transfer: Transferable[] = [
    pos0.buffer, norm0.buffer, col0.buffer, height0.buffer, pick0.buffer,
    pos1.buffer, norm1.buffer, col1.buffer, height1.buffer, pick1.buffer,
    localIdx0.buffer,
    ...peaks.flatMap(p => [p.idx0.buffer, p.idx1.buffer]),
  ]
  const out: PeakWorkerOutput = {pos0, norm0, col0, height0, pick0, pos1, norm1, col1, height1, pick1, localIdx0, peaks}
  ;(self as unknown as Worker).postMessage(out, [...new Set(transfer)])
}
