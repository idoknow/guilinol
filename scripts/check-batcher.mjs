// Node-side behaviour check for the bucketed ChunkBatcher (web/src/batch.ts).
//
// It bundles the real module with esbuild and drives it with synthetic tiles, so the bucketing,
// the "only the touched bucket rebuilds" rule and the dispose-on-empty path are exercised outside
// the browser (no WebGL context needed: nothing is rendered).
//
//   node scripts/check-batcher.mjs
import {build} from 'esbuild'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import * as THREE from 'three'

const dir = await mkdtemp(join(tmpdir(), 'glol-batch-'))
const outfile = join(dir, 'batch.mjs')

await build({
  stdin: {
    contents: "export {ChunkBatcher} from './web/src/batch.ts'\nexport {setBusShelterClearance} from './web/src/traffic/bus-shelter-clearance.ts'\n",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
})

const {ChunkBatcher, setBusShelterClearance} = await import(`${pathToFileURL(outfile).href}`)

const failures = []
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
  if (!ok) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// StaticLayerBatch copies a fixed attribute set, so the fixture has to carry every attribute the
// building and street layers read.
function geometry() {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3))
  g.setAttribute('aFloor', new THREE.Float32BufferAttribute([0, 0, 0], 1))
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute([0, 1, 2], 1))
  g.setAttribute('aKind', new THREE.Uint8BufferAttribute([0, 0, 0], 1))
  g.setAttribute('aRoof', new THREE.Uint8BufferAttribute([0, 0, 0], 1))
  g.setAttribute('aSurface', new THREE.Uint8BufferAttribute([0, 0, 0], 1))
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute([0, 1, 2], 1))
  g.setIndex([0, 1, 2])
  g.userData.farIndexCount = 3
  return g
}

function tile(x, z) {
  return {
    tile: {x, z, file: `chunk_${x}_${z}.glc`, bytes: 0},
    minY: 140,
    maxY: 160,
    midY: 150,
    walls: geometry(),
    pond: null,
    bridge: null,
    streetSurface: geometry(),
    furnitureMatrices: new Float32Array(0),
    furnitureColors: new Float32Array(0),
    detailCount: 0,
    railLodCount: 0,
    parked: new Float32Array(0),
  }
}

const focus = new THREE.Vector3(0, 150, 0)
const camera = new THREE.PerspectiveCamera(55, 1.5, 1, 5000)
camera.position.set(0, 200, 0)
camera.updateMatrixWorld()

const scene = new THREE.Scene()
const batcher = new ChunkBatcher(scene)

// bucketTiles default is 3 → span 768 m: x=0 and x=256 share a bucket, x=768 opens a second one.
// remove() keys on the tile object identity, exactly like Stream (which reuses manifest tiles).
const t00 = tile(0, 0)
const t256 = tile(256, 0)
const t768 = tile(768, 0)
batcher.add(t00)
batcher.add(t256)
batcher.add(t768)
batcher.update(focus, camera)

const bucketsAfterAdd = [...batcher.buckets.keys()]
check('bucket count for two buckets', bucketsAfterAdd.length, 2)
check('bucket keys are block-aligned', bucketsAfterAdd.sort(), ['0:0', '1:0'])

const meshesOf = (key) => {
  const bucket = batcher.buckets.get(key)
  return [bucket.buildings.mesh, bucket.water.mesh, bucket.bridges.mesh, bucket.streets.mesh]
}
const before = new Map(bucketsAfterAdd.map((key) => [key, meshesOf(key).map((mesh) => mesh.geometry.uuid)]))

// Add a fourth tile into the first bucket; the second bucket must not be rebuilt.
const t0256 = tile(0, 256)
batcher.add(t0256)
batcher.update(focus, camera)
const afterAdd = new Map(bucketsAfterAdd.map((key) => [key, meshesOf(key).map((mesh) => mesh.geometry.uuid)]))
check('touched bucket rebuilt', afterAdd.get('0:0')[0] !== before.get('0:0')[0], true)
check('untouched bucket kept its geometry', afterAdd.get('1:0')[0] === before.get('1:0')[0], true)

// Draining a bucket must dispose its meshes and leave the scene.
const sceneChildrenBefore = scene.children.length
batcher.remove(t00.tile)
batcher.remove(t256.tile)
batcher.remove(t0256.tile)
check('emptied bucket removed', [...batcher.buckets.keys()], ['1:0'])
check('four meshes left the scene', scene.children.length, sceneChildrenBefore - 4)

batcher.remove(t768.tile)
check('no buckets left', batcher.buckets.size, 0)

const bikeTile=()=>({...tile(512,256),parked:Float32Array.from(new THREE.Matrix4().makeTranslation(3,150,4).elements)})
const initial=bikeTile();batcher.add(initial)
const candidate=batcher.nearestBike(515,260,150,2)
check('parked bike world position',[candidate.x,candidate.z],[515,260])
check('take once',batcher.takeBike(candidate.id),true)
check('duplicate take',batcher.takeBike(candidate.id),false)
batcher.remove(initial.tile);batcher.add(bikeTile())
check('no duplicate after tile reload',batcher.nearestBike(515,260,150,2),null)
batcher.returnBike(candidate.id)
check('restored same instance',batcher.nearestBike(515,260,150,2).id,candidate.id)
const shelterYaw = 0, shelterNx = Math.sin(shelterYaw), shelterNz = Math.cos(shelterYaw)
const shelterStopX = 515 - 2.6, shelterStopZ = 260 + 1.15
const shelterStop = {
  id: 0,
  key: `${shelterStopX.toFixed(2)},${shelterStopZ.toFixed(2)}`,
  x: shelterStopX,
  z: shelterStopZ,
  yaw: shelterYaw,
  shelter: true,
  side: 1,
  name: '',
  en: '',
  tx: shelterNz,
  tz: -shelterNx,
  nx: shelterNx,
  nz: shelterNz,
}
setBusShelterClearance({stops: [shelterStop], excluded: []})
check('bike inside bus shelter clearance has no boarding candidate', batcher.nearestBike(515, 260, 150, 2), null)
check('bike inside bus shelter clearance cannot be checked out by id', batcher.takeBike(candidate.id), false)
setBusShelterClearance(null)
check('bike restored after bus shelter clearance cleared', batcher.nearestBike(515, 260, 150, 2)?.id ?? null, candidate.id)
// Render-loop closure: stationary camera must hide/restore parked mesh via onBusShelterClearance -> invalidateFurniture.
const bikeFocus = new THREE.Vector3(515, 150, 260)
const bikeCamera = new THREE.PerspectiveCamera(55, 1.5, 0.5, 5000)
bikeCamera.position.set(515, 151.6, 265)
bikeCamera.lookAt(515, 150, 260)
bikeCamera.updateMatrixWorld()
batcher.update(bikeFocus, bikeCamera)
check('parked bike drawn before bus shelter clearance arrives', Boolean(batcher.parked?.visible) && batcher.parked?.count === 1, true)
setBusShelterClearance({stops: [shelterStop], excluded: []})
batcher.update(bikeFocus, bikeCamera)
check('parked bike hidden on stationary camera after bus shelter clearance arrives', batcher.parked?.count === 0 && batcher.parked?.visible === false, true)
setBusShelterClearance(null)
batcher.update(bikeFocus, bikeCamera)
check('parked bike drawn again after bus shelter clearance cleared', Boolean(batcher.parked?.visible) && batcher.parked?.count === 1, true)

// Whole-row clearance: 3 bikes spaced 1.25 m apart on a fresh tile (512, 0) near (600, 240); shelter zone covers only index 0.
const rowTileX = 512, rowTileZ = 0
const rowCenterX = 600, rowCenterZ = 240
const rowYaw = 0.75
const rowPositions = [-1.25, 0, 1.25].map(dx => [rowCenterX + dx, rowCenterZ])
const rowParked = new Float32Array(rowPositions.length * 16)
const rowMat = new THREE.Matrix4()
rowPositions.forEach(([wx, wz], i) => {
  rowMat.makeRotationY(rowYaw).setPosition(wx - rowTileX, 150, wz - rowTileZ)
  rowParked.set(rowMat.elements, i * 16)
})
const rowTile = {...tile(rowTileX, rowTileZ), parked: rowParked}
batcher.add(rowTile)
const rowIds = rowPositions.map((_, i) => `${rowTileX}:${rowTileZ}:${i}`)
check('all 3 row bikes available before shelter clearance', rowPositions.map(([wx, wz]) => batcher.nearestBike(wx, wz, 150, 0.5)?.id ?? null), rowIds)
// Shelter zone centred at (596.25, 240) with halfAlong=3.0 (x in [593.25, 599.25]): covers 598.75 only, leaves 600.00 and 601.25 outside.
const rowShelterX = 596.25 - 2.6, rowShelterZ = 240 + 1.15
const rowShelterStop = {
  ...shelterStop,
  id: 1,
  key: `${rowShelterX.toFixed(2)},${rowShelterZ.toFixed(2)}`,
  x: rowShelterX,
  z: rowShelterZ,
}
setBusShelterClearance({stops: [rowShelterStop], excluded: []})
check('whole row cleared from nearestBike when only bike 0 is in shelter zone', rowPositions.map(([wx, wz]) => batcher.nearestBike(wx, wz, 150, 2)), [null, null, null])
check('whole row blocked from takeBike when only bike 0 is in shelter zone', rowIds.map(id => batcher.takeBike(id)), [false, false, false])
const rowFocus = new THREE.Vector3(rowCenterX, 150, rowCenterZ)
const rowCamera = new THREE.PerspectiveCamera(55, 1.5, 0.5, 5000)
rowCamera.position.set(rowCenterX, 151.6, rowCenterZ + 5)
rowCamera.lookAt(rowCenterX, 150, rowCenterZ)
rowCamera.updateMatrixWorld()
batcher.update(rowFocus, rowCamera)
check('whole row hidden from parked mesh when only bike 0 is in shelter zone', batcher.parked?.count === 0 && batcher.parked?.visible === false, true)
setBusShelterClearance(null)
batcher.update(rowFocus, rowCamera)
check('whole row restored in parked mesh after shelter clearance cleared', Boolean(batcher.parked?.visible) && batcher.parked?.count === 3, true)
batcher.remove(rowTile.tile)
batcher.add({...tile(-768,-256),parked:Float32Array.from(new THREE.Matrix4().makeTranslation(180,150,44).elements)})
check('decor in pedestrian district has no boarding candidate',batcher.nearestBike(-588,-212,150,2),null)
check('decor in pedestrian district cannot be checked out by id',batcher.takeBike('-768:-256:0'),false)

// Wire fences live on a dedicated lazy batch so non-fence buckets emit 0 extra meshes/discard shaders.
const fenceGeom = new THREE.BufferGeometry()
fenceGeom.setAttribute('position', new THREE.Float32BufferAttribute([0, 150, 0, 1, 150, 0, 0, 151.4, 0], 3))
fenceGeom.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
fenceGeom.setAttribute('color', new THREE.Float32BufferAttribute([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 3))
fenceGeom.setAttribute('aAlong', new THREE.Float32BufferAttribute([0, 1, 0], 1))
const tFence = {...tile(1536, 0), streetFence: fenceGeom}
const sceneBeforeFence = scene.children.length
batcher.add(tFence)
batcher.update(new THREE.Vector3(1600, 150, 100), camera)
check('fence bucket attached 5 meshes (including lazy wire-fence layer)', scene.children.length, sceneBeforeFence + 5)
check('fence bucket has wire-fence mesh', Boolean(batcher.buckets.get('2:0')?.fences?.mesh), true)
batcher.remove(tFence.tile)
check('fence bucket removal cleaned all 5 meshes', scene.children.length, sceneBeforeFence)

await rm(dir, {recursive: true, force: true})

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}
console.log('\nall batcher cases passed')
