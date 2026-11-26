// Emit exact rendered vertex differences for the station scope audit.
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {gunzipSync} from 'node:zlib'
import {tileFaces} from './dingjiang-visible-surfaces'

import {nearbyTunnels} from '../web/src/station-tunnels'

const [reference, candidate, referenceSource, scopeFile] = process.argv.slice(2)
const openingFaces: typeof tileFaces = referenceSource
  ? (await import(pathToFileURL(path.resolve(referenceSource, 'scripts/dingjiang-visible-surfaces.ts')).href)).tileFaces
  : tileFaces
const scope = scopeFile ? new Set<string>(JSON.parse(fs.readFileSync(scopeFile, 'utf8'))) : undefined
const worlds = [reference, candidate]
const manifests = worlds.map(world => JSON.parse(fs.readFileSync(path.join(world, 'manifest.json'), 'utf8')))
const tiles = manifests.map(m => new Map<string, any>(m.chunks.map(t => [t.file, t])))
const buildingChanges: string[] = []
const vertices = []

for (const file of new Set([...tiles[0].keys(), ...tiles[1].keys()])) {
  const pair = tiles.map(lookup => lookup.get(file))
  if (pair.some(t => !t)) throw new Error('Missing tile ' + file)
  const bytes = worlds.map(world => fs.readFileSync(path.join(world, file)))
  const inScope = !scope || scope.has(file)
  if (!inScope && bytes[0].equals(bytes[1])) continue
  if (!referenceSource && bytes[0].equals(bytes[1]) && JSON.stringify(pair[0]) === JSON.stringify(pair[1])
      && JSON.stringify(nearbyTunnels(manifests[0].tunnels, pair[0].x, pair[0].z)) ===
         JSON.stringify(nearbyTunnels(manifests[1].tunnels, pair[1].x, pair[1].z))) continue
  const buildings = bytes.map(raw => {
    const b = gunzipSync(raw)
    return b.subarray(16924, 16924 + 9 * b.readUInt32LE(4) + 4 * b.readUInt32LE(8))
  })
  if (!buildings[0].equals(buildings[1])) buildingChanges.push(file)
  if (!inScope) continue
  const sets = worlds.map((world, i) => {
    const keys = new Set<string>()
    const render = i === 0 ? openingFaces : tileFaces
    render(world, pair[i], manifests[i].tunnels, (face, role, owner) => {
      if (!role.startsWith('paving-') && role !== 'graded-floor') return
      for (const vertex of face) keys.add(JSON.stringify([role, owner ?? 0, ...vertex]))
    }, true)
    return keys
  })
  for (const side of [0, 1]) for (const key of sets[side]) {
    if (!sets[1 - side].has(key)) vertices.push([side, ...JSON.parse(key)])
  }
}
process.stdout.write(JSON.stringify({buildingChanges, vertices}))
