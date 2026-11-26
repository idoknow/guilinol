import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

export function sampledRailhead(dir: string, m, t, x: number, z: number) {
  const buf = gunzipSync(fs.readFileSync(path.join(dir, t.file)))
  const offset =
    24 + 4 * (m.chunkSize / m.grid + 1) ** 2 + 9 * buf.readUInt32LE(4) + 4 * buf.readUInt32LE(8)
  const rails = JSON.parse(buf.toString('utf8', offset, offset + buf.readUInt32LE(12)))[4]
  let nearest = Infinity,
    height = NaN
  for (const [ax, az, ay, bx, bz, by] of rails) {
    const dx = bx - ax,
      dz = bz - az,
      px = (x - t.x) * 100 - ax,
      pz = (z - t.z) * 100 - az
    const u = Math.max(0, Math.min(1, (px * dx + pz * dz) / (dx * dx + dz * dz)))
    const distance = Math.hypot(px - u * dx, pz - u * dz)
    if (distance < nearest) {
      nearest = distance
      height = (ay + u * (by - ay)) / 100
    }
  }
  assert(nearest < 2, 'Missing encoded rail at ' + [x, z])
  return height
}
