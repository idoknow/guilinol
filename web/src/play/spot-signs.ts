import * as THREE from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import type {ObstacleVolumeSpec} from '../walk/obstacle-volumes'
import {spots} from './spots'

// 观景点实体立牌：浮空印章是导航标记，地上补一块低模牌（石座 + 双立柱 + 牌匾 + 顶檐），不加光源。
// 落点 2026-11-26 无头实测：站点外 5–20 m、非车道、非水面、地面起伏 < .15 m、头顶无屋檐、两侧 .3 m 内无墙；解放桥放北侧人行道
// （桥体局部 x −17.7、z −20.3，灯柱 ±18.9 与石栏杆 ±21.1 之间），牌面朝车道。
// [x, 地面 y, z, yaw]，yaw 让牌面（+z）朝向站点。
const PLACES: Record<string, readonly [number, number, number, number]> = {
  elephant: [-675.19, 149, 1183.95, -1.767],
  pagodas: [-907.89, 153.16, 515.68, .59],
  bridge: [-178.37, 151.48, 15.14, -.322],
  xiaoyao: [-239.59, 146.68, -122.45, 1.08],
  fubo: [-30, 147.1, -631.5, 0],
  diecai: [-198.01, 190.51, -1390.2, -2.749],
  duxiu: [-509.29, 157.67, -588.49, -1.964],
  southgate: [-1430.1, 153.05, 173.99, 1.375],
  lanes: [-479.51, 155.7, -186.98, .294],
  crossing: [-862.52, 151.65, -172.65, -1.178],
}
const SHOW = 120, COLS = 2, CELL_W = 512, CELL_H = 256, BLANK = 16
const PAPER = '#f4efe2', SEAL = '#a9503c', INK = '#2b2622'
const SERIF = '"Noto Serif SC","Source Han Serif SC","Songti SC",serif'

function drawFace(g: CanvasRenderingContext2D, x: number, y: number, seal: string, name: string) {
  g.fillStyle = PAPER; g.fillRect(x, y, CELL_W, CELL_H)
  g.lineWidth = 4; g.strokeStyle = SEAL; g.strokeRect(x + 12, y + 12, CELL_W - 24, CELL_H - 24)
  g.fillStyle = SEAL; g.beginPath(); g.roundRect(x + 36, y + 40, 176, 176, 14); g.fill()
  g.lineWidth = 5; g.strokeStyle = PAPER; g.beginPath(); g.roundRect(x + 50, y + 54, 148, 148, 8); g.stroke()
  g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillStyle = PAPER; g.font = `600 112px ${SERIF}`; g.fillText(seal, x + 124, y + 134)
  g.fillStyle = INK; g.font = `700 80px ${SERIF}`; g.fillText(name, x + 360, y + 132, 250)
}

/** 统一成 position/normal/uv/color 四个属性的非索引几何，石座立柱和牌面才能并成一个网格。 */
function paint(geo: THREE.BufferGeometry, hex: number, uv?: readonly [number, number]) {
  const g = geo.index ? geo.toNonIndexed() : geo, c = new THREE.Color(hex), n = g.attributes.position.count
  const colors = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  if (uv) for (let i = 0; i < n; i++) g.attributes.uv.setXY(i, uv[0], uv[1])
  return g
}

/** 牌面四边形：正反两面都读得正，UV 落在图集第 index 格。 */
function faceGeometry(index: number, rows: number, height: number) {
  const u0 = (index % COLS) / COLS, u1 = u0 + 1 / COLS
  const v1 = 1 - Math.floor(index / COLS) * CELL_H / height, v0 = v1 - CELL_H / height
  const front = new THREE.PlaneGeometry(1.16, .58).translate(0, 1.74, .042)
  const back = new THREE.PlaneGeometry(1.16, .58).rotateY(Math.PI).translate(0, 1.74, -.042)
  for (const g of [front, back]) {
    const uv = g.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0))
  }
  return [paint(front, 0xffffff), paint(back, 0xffffff)]
}

export function createSpotSigns(scene: THREE.Scene, addCollider?: (spec: ObstacleVolumeSpec) => void) {
  const list = spots.filter(spot => PLACES[spot.id])
  const rows = Math.ceil(list.length / COLS), height = CELL_H * rows + BLANK
  // 图集底部留一条纯白：石座立柱的 UV 都指向这里，颜色只取顶点色。
  const canvas = document.createElement('canvas'); canvas.width = CELL_W * COLS; canvas.height = height
  const g = canvas.getContext('2d')!
  g.fillStyle = '#fff'; g.fillRect(0, CELL_H * rows, canvas.width, BLANK)
  list.forEach((spot, i) => drawFace(g, (i % COLS) * CELL_W, Math.floor(i / COLS) * CELL_H, spot.seal, spot.name))
  const atlas = new THREE.CanvasTexture(canvas); atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4
  const material = new THREE.MeshStandardMaterial({map: atlas, vertexColors: true, roughness: .85, metalness: .05})
  const white = [.5, BLANK / 2 / height] as const
  const body = [
    paint(new THREE.BoxGeometry(1.36, .22, .46).translate(0, .11, 0), 0x8c867c, white),
    paint(new THREE.BoxGeometry(.07, 1.9, .07).translate(-.55, 1.17, 0), 0x2f3437, white),
    paint(new THREE.BoxGeometry(.07, 1.9, .07).translate(.55, 1.17, 0), 0x2f3437, white),
    paint(new THREE.BoxGeometry(1.26, .68, .08).translate(0, 1.74, 0), 0x3a3330, white),
    paint(new THREE.BoxGeometry(1.4, .06, .16).translate(0, 2.11, 0), 0x2f3437, white),
  ]
  const signs = list.map((spot, i) => {
    const [x, y, z, yaw] = PLACES[spot.id]
    // 一块牌一个网格、一个 draw call。
    const mesh = new THREE.Mesh(mergeGeometries([...body, ...faceGeometry(i, rows, height)])!, material)
    mesh.name = `spot-sign-${spot.id}`
    mesh.position.set(x, y, z); mesh.rotation.y = yaw; mesh.visible = false
    scene.add(mesh)
    addCollider?.({id: mesh.name, origin: [x, y, z], rotationY: yaw, boxes: [{minX: -.7, maxX: .7, minZ: -.24, maxZ: .24, minY: 0, maxY: 2.2}]})
    return mesh
  })
  return {
    signs,
    /** 只画玩家 120 m 内的牌，远处不占 draw call。 */
    tick(x: number, z: number) { for (const s of signs) s.visible = (s.position.x - x) ** 2 + (s.position.z - z) ** 2 < SHOW * SHOW },
  }
}
