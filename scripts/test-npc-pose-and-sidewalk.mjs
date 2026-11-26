import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {gunzipSync} from 'node:zlib'
import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {blendPasserbyWeights, syncPasserbyActions} from '../web/src/traffic/crowd-anim.ts'
import {Traffic, WALK_OFFSET} from '../web/src/traffic/sim.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('IDOK-377: a station walker continues across overlapping fragments, then idles at the destination', () => {
  const walks = [[0, 0, -.4315, -5.586], [-.2842, -2.1689, -.829, -21.6159]]
  const lane = {id: 4, from: 1, to: 2, offset: 0, kind: 'motor', width: 3, cls: 'primary', speedKmh: 30, street: 'station', npcWalks: walks}
  const graph = {nodes: [{id: 1, x: 12, y: 0, z: 0}, {id: 2, x: 12, y: 0, z: -30}], lanes: [lane], signals: [], walks: []}
  const sim = new Traffic(graph, () => .5, 0)
  const track = [...sim.allTracks()].find(track => track.walk && track.start.z === 0)
  const actor = {track, dist: 0, speed: 1.4, pace: 1.4, kind: 'person', down: 0, dodge: 0, x: 0, y: 0, z: 0, yaw: track.yaw, scale: 1, leaving: false, halfWidth: .3, halfLength: .3, height: 1.5}
  sim.actors = [actor]
  const camera = {x: 0, y: 1, z: 1}
  for (let tick = 0; tick < 600; tick++) {
    const lastZ = actor.z
    sim.step(.05, camera, undefined, () => true)
    assert.ok(actor.z <= lastZ + .01, `walker reversed at ${lastZ.toFixed(2)} m`)
  }
  assert.ok(actor.z < -21 && actor.speed === 0 && !actor.leaving)
  for (let tick = 0; tick < 20; tick++) sim.step(.05, camera, undefined, () => false)
  assert.equal(sim.actors.length, 0)
})

async function loadFigure(file) {
  const avatarDir = join(root, 'public/avatar')
  const origLoad = THREE.FileLoader.prototype.load
  THREE.FileLoader.prototype.load = function (url, onLoad) {
    const name = String(url).replace(/^.*\//, '')
    const raw = readFileSync(join(avatarDir, name))
    const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
    setImmediate(() => onLoad(ab))
  }
  try {
    const raw = readFileSync(join(avatarDir, file))
    const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
    return await new Promise((resolve, reject) => new GLTFLoader().parse(ab, 'avatar/', resolve, reject))
  } finally {
    THREE.FileLoader.prototype.load = origLoad
  }
}

function armDownDeg(scene, side) {
  scene.updateMatrixWorld(true)
  const sh = scene.getObjectByName('upperarm_' + side)
  const el = scene.getObjectByName('lowerarm_' + side)
  assert.ok(sh && el, `missing arm bones for side ${side}`)
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3()
  sh.getWorldPosition(p0)
  el.getWorldPosition(p1)
  const dir = p1.sub(p0).normalize()
  return Math.acos(THREE.MathUtils.clamp(-dir.y, -1, 1)) * 180 / Math.PI
}

test('IDOK-376: NPC walk/idle repeated start-stop and frustum culling never fall back to bind-pose T-Pose', async () => {
  for (const file of ['figure_m.glb', 'figure_f.glb']) {
    const gltf = await loadFigure(file)
    const scene = gltf.scene
    // Confirm raw bind pose really is T-Pose (~85-95 deg) so the arm angle check is non-vacuous.
    const bindL = armDownDeg(scene, 'l')
    const bindR = armDownDeg(scene, 'r')
    assert.ok(bindL > 65 && bindR > 65, `${file} bind pose expected horizontal arms, got L=${bindL.toFixed(1)} R=${bindR.toFixed(1)}`)

    const mixer = new THREE.AnimationMixer(scene)
    const walkClip = gltf.animations.find(c => c.name === 'walk')
    const idleClip = gltf.animations.find(c => c.name === 'idle')
    assert.ok(walkClip && idleClip, `${file} missing walk/idle clips`)
    const walk = mixer.clipAction(walkClip)
    const idle = mixer.clipAction(idleClip)
    walk.reset().setLoop(THREE.LoopRepeat, Infinity)
    idle.reset().setLoop(THREE.LoopRepeat, Infinity)

    // Spawn stationary: frame 0 must immediately evaluate idle (no first-frame T-Pose).
    let walkWeight = 0
    syncPasserbyActions(walk, idle, walkWeight)
    mixer.update(0)
    assert.ok(armDownDeg(scene, 'l') < 42 && armDownDeg(scene, 'r') < 42, `${file} spawn frame-0 T-Pose`)

    // Run 12 rapid start-stop / mid-blend interruption / frustum-skip cycles.
    const phases = [
      {moving: true, steps: 12, dt: 0.05, culled: false},
      {moving: false, steps: 12, dt: 0.05, culled: false},
      {moving: true, steps: 2, dt: 0.05, culled: false},   // mid-blend interrupt
      {moving: false, steps: 2, dt: 0.05, culled: false},  // rapid toggle
      {moving: true, steps: 10, dt: 0.05, culled: true},   // off-frustum skip
      {moving: false, steps: 10, dt: 0.05, culled: false}, // re-enter frustum & stop
      {moving: true, steps: 8, dt: 0.05, culled: false},
      {moving: false, steps: 8, dt: 0.05, culled: false},
    ]
    let animAcc = 0
    let maxArmL = 0, maxArmR = 0
    for (let round = 0; round < 3; round++) {
      for (const phase of phases) {
        // Also verify self-healing if an action was unexpectedly disabled externally.
        if (round === 1 && phase.moving) walk.enabled = false
        if (round === 2 && !phase.moving) idle.enabled = false
        for (let step = 0; step < phase.steps; step++) {
          walkWeight = blendPasserbyWeights(walkWeight, phase.moving, phase.dt)
          syncPasserbyActions(walk, idle, walkWeight)
          assert.equal(walk.enabled, true, `${file} walk action disabled`)
          assert.equal(idle.enabled, true, `${file} idle action disabled`)
          assert.ok(Math.abs(walk.getEffectiveWeight() + idle.getEffectiveWeight() - 1) < 1e-6, `${file} weight sum drifted`)
          if (phase.culled) {
            animAcc = Math.min(0.5, animAcc + phase.dt)
          } else {
            mixer.update(phase.dt + animAcc)
            animAcc = 0
            const l = armDownDeg(scene, 'l'), r = armDownDeg(scene, 'r')
            maxArmL = Math.max(maxArmL, l)
            maxArmR = Math.max(maxArmR, r)
            assert.ok(l < 45 && r < 45, `${file} T-Pose regression: L=${l.toFixed(1)}deg R=${r.toFixed(1)}deg weight=${walkWeight.toFixed(2)}`)
          }
        }
      }
    }
    assert.ok(maxArmL < 45 && maxArmR < 45)
  }
})

test('IDOK-376: synthetic roads block road-middle walks, push verge walks to outer sidewalk, and clamp dodge away from motor lanes', () => {
  // 1) Divided arterial with median walk (z=0), verge walk (z=5.5), and outer sidewalk at z in [10, 14].
  //    Motor lanes at z=-4 (width 4) and z=+4 (width 4).
  const dividedGraph = {
    nodes: [
      {id: 1, x: 0, y: 0, z: -4}, {id: 2, x: 100, y: 0, z: -4},
      {id: 3, x: 100, y: 0, z: 4}, {id: 4, x: 0, y: 0, z: 4},
    ],
    lanes: [
      {id: 10, from: 1, to: 2, offset: 0, width: 4, kind: 'motor', cls: 'primary', speedKmh: 40, street: '中山路', npcWalks: [
        [0, 0, 100, 0],     // BAD: median directly between the two carriageways
        [0, 4, 100, 4],     // BAD: directly on carriageway centerline
      ]},
      {id: 11, from: 3, to: 4, offset: 0, width: 4, kind: 'motor', cls: 'primary', speedKmh: 40, street: '中山路', npcWalks: [
        [0, 6.8, 100, 6.8], // BAD: planting verge (kind=4) between carriageway and cycleway
      ]},
    ],
    walks: [],
    signals: [],
  }
  const dividedSurface = (_x, z) => {
    if (Math.abs(z - 4) <= 2 || Math.abs(z + 4) <= 2) return [0]
    if (z > 6 && z <= 8.2) return [4]
    if (z > 8.2 && z <= 11.2) return [5]
    if (z > 11.2 && z <= 15.0) return [1]
    if (z < -6 && z >= -10) return [1]
    return []
  }
  let seed = 7
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
  const sim = new Traffic(dividedGraph, rand, 40, {classes: ['trunk', 'primary', 'secondary'], carMin: 1, carMax: 2, personMin: 4, personMax: 6}, dividedSurface)
  let personSamples = 0
  for (let tick = 0; tick < 300; tick++) {
    sim.step(0.05, {x: 50, y: 0, z: 0})
    for (const actor of sim.actors) {
      if (actor.kind !== 'person') continue
      personSamples++
      assert.equal(sim.hitsMotorLane(actor.x, actor.z, 0.35), false, `pedestrian inside motor lane at z=${actor.z.toFixed(2)}`)
      assert.equal(sim.sideClearances(actor.x, actor.z, actor.track.dx, actor.track.dz).betweenMotors, false, `pedestrian in road median at z=${actor.z.toFixed(2)}`)
      const ks = dividedSurface(actor.x, actor.z)
      assert.ok(ks.includes(1) || ks.includes(6), `pedestrian left outer sidewalk (kinds=${JSON.stringify(ks)}) at z=${actor.z.toFixed(2)}`)
    }
  }
  assert.ok(personSamples > 200, `expected active pedestrians on pushed outer sidewalk, got ${personSamples}`)

  // 2) Narrow road without dedicated cycleway: stale walk on centerline must shift outside carriageway,
  //    and oncoming pedestrian dodge must never push walkers into the motor lane.
  const narrowGraph = {
    nodes: [{id: 1, x: 0, y: 0, z: 0}, {id: 2, x: 80, y: 0, z: 0}],
    lanes: [{
      id: 20, from: 1, to: 2, offset: 0, width: 6, kind: 'motor', cls: 'secondary', speedKmh: 30, street: '无非机动车道窄路',
      npcWalks: [
        [0, 0, 80, 0],     // BAD: centerline of narrow road
        [0, 3.55, 80, 3.55], // Tight outer curb edge just 0.55m outside motor edge (halfW=3.0)
      ],
    }],
    walks: [],
    signals: [],
  }
  const narrowSim = new Traffic(narrowGraph, rand, 0)
  const narrowWalks = [...narrowSim.allTracks()].filter(t => t.walk)
  assert.ok(narrowWalks.length >= 2, 'narrow road should keep outer walk tracks')
  for (const t of narrowWalks) {
    assert.ok(Math.abs(t.start.z) >= 3.45 && Math.abs(t.end.z) >= 3.45, `walk track too close to road middle: z=${t.start.z}`)
  }
  // Force oncoming pedestrians to dodge on the tight curb-side track (z=3.55, motor edge at z=3.0).
  const tightFwd = narrowWalks.find(t => Math.abs(t.start.z - 3.55) < 0.05 && t.dx > 0)
  const tightRev = narrowWalks.find(t => Math.abs(t.start.z - 3.55) < 0.05 && t.dx < 0)
  assert.ok(tightFwd && tightRev)
  narrowSim.actors = [
    {track: tightFwd, dist: 30, speed: 1.4, pace: 1.4, kind: 'person', down: 0, dodge: 0, x: 30, y: 0, z: 3.55, yaw: Math.PI / 2, scale: 1, leaving: false, halfWidth: 0.3, halfLength: 0.3, height: 1.5},
    {track: tightRev, dist: 42, speed: 1.4, pace: 1.4, kind: 'person', down: 0, dodge: 0, x: 38, y: 0, z: 3.55, yaw: -Math.PI / 2, scale: 1, leaving: false, halfWidth: 0.3, halfLength: 0.3, height: 1.5},
  ]
  for (let tick = 0; tick < 200; tick++) {
    narrowSim.step(0.05, {x: 40, y: 0, z: 0})
    for (const actor of narrowSim.actors) {
      assert.equal(narrowSim.hitsMotorLane(actor.x, actor.z, 0.35), false, `dodge pushed pedestrian into carriageway at z=${actor.z.toFixed(2)} dodge=${actor.dodge.toFixed(2)}`)
      assert.ok(actor.z >= 3.35, `pedestrian stepped toward carriageway edge: z=${actor.z.toFixed(2)} (WALK_OFFSET=${WALK_OFFSET})`)
    }
  }
})

test('IDOK-376: real Guilin urban corridors keep 0 pedestrians in motor lanes, medians, cycleways, or verges', () => {
  const graphPath = join(root, 'public/world/roads/graph.json.gz')
  const manifestPath = join(root, 'public/world/manifest.json')
  if (!existsSync(graphPath) || !existsSync(manifestPath)) return
  const graph = JSON.parse(gunzipSync(readFileSync(graphPath)))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const tiles = new Map(manifest.chunks.map(t => [`${t.x},${t.z}`, t]))
  const cache = new Map()
  const inside = (x, z, ring) => {
    let hit = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[j]
      if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) hit = !hit
    }
    return hit
  }
  const surfaceAt = (x, z) => {
    const size = manifest.chunkSize, ox = Math.floor(x / size) * size, oz = Math.floor(z / size) * size, key = `${ox},${oz}`
    if (!cache.has(key)) {
      const tile = tiles.get(key)
      if (!tile) { cache.set(key, null); return undefined }
      const bytes = gunzipSync(readFileSync(join(root, 'public/world', tile.file)))
      const start = 24 + 4 * (size / manifest.grid + 1) ** 2 + 9 * bytes.readUInt32LE(4) + 4 * bytes.readUInt32LE(8)
      const faces = JSON.parse(bytes.toString('utf8', start, start + bytes.readUInt32LE(12)))[1][0]
      const indexed = []
      for (const [k, shell, ...holes] of faces) {
        if (k !== 0 && k !== 1 && k !== 4 && k !== 5 && k !== 6) continue
        if (!shell || shell.length < 3) continue
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
        for (const [rx, rz] of shell) {
          if (rx < minX) minX = rx; if (rx > maxX) maxX = rx
          if (rz < minZ) minZ = rz; if (rz > maxZ) maxZ = rz
        }
        indexed.push({k, minX, maxX, minZ, maxZ, shell, holes})
      }
      cache.set(key, indexed)
    }
    const faces = cache.get(key)
    if (!faces) return undefined
    const lx = (x - ox) * 100, lz = (z - oz) * 100
    const out = []
    for (const f of faces) {
      if (lx < f.minX || lx > f.maxX || lz < f.minZ || lz > f.maxZ) continue
      if (inside(lx, lz, f.shell) && !f.holes.some(h => inside(lx, lz, h))) out.push(f.k)
    }
    return out
  }

  const sites = [
    ['解放东路', -583, -98],
    ['解放西路', -1215, -222],
    ['中山中路', -885, -135],
    ['中山南路', -1680, 1020],
    ['自由路', 90, 136],
    ['解放桥', -168, 40],
    ['滨江路', -185, -306],
    ['穿山路', -72, 707],
    ['信义路', -1788, -234],
  ]
  let totalSamples = 0, motorViolations = 0, medianViolations = 0, roadCycleViolations = 0, vergeViolations = 0
  let seed = 101
  const sim = new Traffic(graph, () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32), 100, undefined, surfaceAt)
  for (const [label, x, z] of sites) {
    sim.actors = []
    let siteSamples = 0
    for (let tick = 0; tick < 300; tick++) {
      sim.step(0.05, {x, y: 150, z})
      for (const actor of sim.actors) {
        if (actor.kind !== 'person') continue
        siteSamples++
        totalSamples++
        if (sim.hitsMotorLane(actor.x, actor.z, 0.35)) motorViolations++
        if (sim.sideClearances(actor.x, actor.z, actor.track.dx, actor.track.dz).betweenMotors) medianViolations++
        const ks = surfaceAt(actor.x, actor.z)
        if (ks) {
          if (ks.includes(0) || ks.includes(5)) roadCycleViolations++
          if (ks.includes(4) && !ks.includes(1) && !ks.includes(6)) vergeViolations++
        }
      }
    }
    assert.ok(siteSamples > 0, `${label}: expected active pedestrians along outer sidewalks`)
  }
  assert.ok(totalSamples > 5000, `insufficient urban pedestrian samples: ${totalSamples}`)
  assert.equal(motorViolations, 0, `pedestrians inside motor lanes: ${motorViolations}`)
  assert.equal(medianViolations, 0, `pedestrians in road medians: ${medianViolations}`)
  assert.equal(roadCycleViolations, 0, `pedestrians on carriageway/cycleway: ${roadCycleViolations}`)
  assert.equal(vergeViolations, 0, `pedestrians on planting verges: ${vergeViolations}`)
})
