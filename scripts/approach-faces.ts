// Emit finished pavement triangles for the requested crossing footprints.
import fs from 'node:fs'
import path from 'node:path'
import { tileFaces } from './dingjiang-visible-surfaces'

const world = process.argv[2]
const roles = new Set(['graded-floor', 'paving-0', 'paving-1', 'paving-2', 'paving-6'])
if (process.argv.includes('--with-ground')) roles.add('terrain')
if (process.argv.includes('--platform-bricks')) roles.add('paving-9')
const boxes: number[][] = JSON.parse(fs.readFileSync(0, 'utf8'))
const manifest = JSON.parse(fs.readFileSync(path.join(world, 'manifest.json'), 'utf8'))
const hits = (a: number[], b: number[]) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
for (const tile of manifest.chunks) {
  const local = boxes.filter(b => hits(b, [tile.x, tile.z, tile.x + 256, tile.z + 256]))
  if (!local.length) continue
  tileFaces(world, tile, manifest.tunnels, (points, role) => {
    if (!roles.has(role)) return
    const xs = points.map(p => p[0]), zs = points.map(p => p[2])
    if (local.some(b => hits(b, [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)])))
      console.log(JSON.stringify([role, points]))
  })
}
