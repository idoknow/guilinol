import * as THREE from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
// 从「青桂出行」的程序化单车工程移植过来的 JS 模块
import {createMaterials} from './qingju/bike/materials.js'
import {buildBike} from './qingju/bike/bike.js'
import {DIM} from './qingju/bike/dims.js'

// 车架尺寸（米）：坐垫高 0.792、车把高 1.128、把宽 ±0.318
export const BIKE_DIM = DIM as {
  seatTop: number
  barY: number
  barHalfWidth: number
  deckTop: number
  wheelR: number
}

export interface BikeInstance {
  root: THREE.Group
  update(dt: number, state: {speed: number; wheelTravel: number; steer: number; lean: number; riding?: boolean}): void
  setLights(on: boolean): void
  setSteer(angle: number): void
  parts: Record<string, unknown>
  shadow: THREE.Mesh
}

// 材质里要读 renderer 的各向异性上限；没传 renderer 时给个保守值
let materials: ReturnType<typeof createMaterials> | undefined
function bikeMaterials(renderer?: THREE.WebGLRenderer) {
  materials ??= createMaterials(
    renderer ?? ({capabilities: {getMaxAnisotropy: () => 4}} as unknown as THREE.WebGLRenderer),
  )
  return materials
}

const PAINT = [0x2bcfbd, 0xe8e4d8, 0xe2a2ad, 0x36485e]

/** 给整车换车漆：只改原来的青色涂装 */
function tint(root: THREE.Object3D, paint: number) {
  const target = new THREE.Color('#2bcfbd')
  const replacement = new THREE.Color(PAINT[paint % PAINT.length])
  root.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of list) {
      const standard = material as THREE.MeshPhysicalMaterial
      if (!standard?.color) continue
      if (
        Math.abs(standard.color.r - target.r) < 0.02 &&
        Math.abs(standard.color.g - target.g) < 0.02 &&
        Math.abs(standard.color.b - target.b) < 0.02
      ) {
        standard.color.copy(replacement)
      }
    }
  })
}

/** 完整可动的单车（骑行时用：大灯、转向、轮子动画） */
export function createBike(paint = 0, renderer?: THREE.WebGLRenderer): BikeInstance {
  const bike = buildBike(bikeMaterials(renderer)) as unknown as BikeInstance
  bike.root.name = 'qingju-bike'
  bike.root.userData.paint = paint
  tint(bike.root, paint)
  return bike
}

/**
 * 全城 964 个停车点：按材质分组合并几何体，再用 InstancedMesh 一次画完。
 * 这样既能保留原车漆/轮胎/坐垫/屏幕贴图和「青桂出行」字样，又只花十几次 draw call。
 */
export interface ParkedRecord {
  x: number
  y: number
  z: number
  angle: number
  paint: number
  slots: {mesh: THREE.InstancedMesh; index: number}[]
  hidden: boolean
}

let parkedBatches: {geometry: THREE.BufferGeometry; material: THREE.Material}[] | undefined
function bikeBatches() {
  if (parkedBatches) return parkedBatches
  const bike = buildBike(bikeMaterials(), {noLights: true}) as unknown as BikeInstance
  bike.root.updateMatrixWorld(true)
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>()
  bike.root.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material
    if (!material) return
    const source = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).clone()
    source.applyMatrix4(mesh.matrixWorld)
    // 合并时只保留通用属性（位置/法线/UV），颜色和贴图都走材质本身
    for (const name of Object.keys(source.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) source.deleteAttribute(name)
    }
    if (!source.getAttribute('normal')) source.computeVertexNormals()
    if (!source.getAttribute('uv')) source.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(source.getAttribute('position').count * 2), 2))
    const list = byMaterial.get(material) ?? []
    list.push(source)
    byMaterial.set(material, list)
  })
  parkedBatches = []
  for (const [material, list] of byMaterial) {
    const merged = mergeGeometries(list, false)
    for (const part of list) part.dispose()
    if (merged) parkedBatches.push({geometry: merged, material})
  }
  return parkedBatches
}

/** 为一批停车点生成 InstancedMesh 组 */
/** 远距离用的色系合并批：把十几个材质并成 4 组，用顶点色代替贴图。 */
const bucketed = new Map<string, {geometry: THREE.BufferGeometry; material: THREE.Material}[]>()
function colorBucket(color: THREE.Color) {
  const hsl = {h: 0, s: 0, l: 0}
  color.getHSL(hsl)
  if (hsl.l < 0.18) return 0 // 黑件：轮胎/把套/坐垫
  if (hsl.s < 0.22) return 2 // 金属/灰白
  if (hsl.l > 0.72) return 3 // 浅色：灯罩/屏幕/贴纸
  return 1 // 车漆与彩色件
}
function bikeBuckets() {
  const key = 'buckets'
  if (bucketed.has(key)) return bucketed.get(key)!
  const bike = buildBike(bikeMaterials(), {noLights: true}) as unknown as BikeInstance
  bike.root.updateMatrixWorld(true)
  const groups: THREE.BufferGeometry[][] = [[], [], [], []]
  bike.root.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
    const color = material?.color ? material.color.clone() : new THREE.Color(0xffffff)
    const bucket = colorBucket(color)
    const source = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).clone()
    source.applyMatrix4(mesh.matrixWorld)
    for (const name of Object.keys(source.attributes)) {
      if (!['position', 'normal'].includes(name)) source.deleteAttribute(name)
    }
    if (!source.getAttribute('normal')) source.computeVertexNormals()
    const count = source.getAttribute('position').count
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b
    }
    source.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    groups[bucket].push(source)
  })
  const list: {geometry: THREE.BufferGeometry; material: THREE.Material}[] = []
  for (const parts of groups) {
    if (!parts.length) continue
    const merged = mergeGeometries(parts, false)
    for (const part of parts) part.dispose()
    if (!merged) continue
    list.push({geometry: merged, material: new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.7, metalness: 0.12})})
  }
  bucketed.set(key, list)
  return list
}

export function parkedBikes(points: {x: number; y: number; z: number; angle: number; paint: number}[], options?: {bucketed?: boolean}) {
  const batches = options?.bucketed ? bikeBuckets() : bikeBatches()
  const group = new THREE.Group()
  group.name = 'qingju-bikes'
  const records: ParkedRecord[] = points.map(point => ({...point, slots: [], hidden: false}))
  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3(1, 1, 1)
  const position = new THREE.Vector3()
  // 每种车漆一套实例（车漆是共享材质，不能按实例改色，所以按涂装分组）
  for (const paint of new Set(points.map(point => point.paint % PAINT.length))) {
    const indices = records.map((record, index) => ({record, index})).filter(item => item.record.paint % PAINT.length === paint)
    if (!indices.length) continue
    const materialSet = batches.map(batch => {
      // 同一种材质在换漆后要单独一份（只改车漆，其余共享）
      const material = batch.material
      const mesh = new THREE.InstancedMesh(batch.geometry, material, indices.length)
      mesh.name = `qingju-bikes-${paint}`
      mesh.frustumCulled = false
      group.add(mesh)
      return mesh
    })
    indices.forEach(({record}, local) => {
      position.set(record.x, record.y, record.z)
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), record.angle)
      matrix.compose(position, quaternion, scale)
      for (const mesh of materialSet) {
        mesh.setMatrixAt(local, matrix)
        record.slots.push({mesh, index: local})
      }
    })
    for (const mesh of materialSet) mesh.instanceMatrix.needsUpdate = true
  }
  return {group, records, meshes: group.children as THREE.InstancedMesh[]}
}