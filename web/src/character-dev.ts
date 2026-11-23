import * as THREE from 'three'
import {createCharacter, type Character, type CharacterConfig} from './look/character'

// 开发用预览页（不进生产包）：真正走 createCharacter 的拼装路径，检查脸型/搭配/动作。
//   /character.html                四个角色（男男 女女）并排
//   /character.html?walk=1         走路动作
//   /character.html?face=1         头部特写
//   /character.html?single=1&gender=male&face=0&top=1&pants=0&shoes=2
const q = new URLSearchParams(location.search)
const renderer = new THREE.WebGLRenderer({antialias: true})
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
document.body.append(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xc9d5d2)
scene.add(new THREE.HemisphereLight(0xdff0ef, 0x8b8a75, 1.5))
const key = new THREE.DirectionalLight(0xfff3e2, 2.6)
key.position.set(-2.4, 3.6, 2.6)
scene.add(key)
const rim = new THREE.DirectionalLight(0xbfd8e6, 1.2)
rim.position.set(2.6, 2.2, -2.4)
scene.add(rim)

const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.05, 60)
const group = new THREE.Group()
scene.add(group)

const configs: CharacterConfig[] = q.has('single')
  ? [{
      gender: (q.get('gender') as 'male' | 'female') ?? 'female',
      face: Number(q.get('face') ?? 0),
      top: Number(q.get('top') ?? 0),
      pants: Number(q.get('pants') ?? 0),
      shoes: Number(q.get('shoes') ?? 0),
    }]
  : [
      {gender: 'male', face: 0, top: 0, pants: 0, shoes: 0},
      {gender: 'male', face: 1, top: 1, pants: 1, shoes: 1},
      {gender: 'female', face: 0, top: 0, pants: 0, shoes: 0},
      {gender: 'female', face: 1, top: 1, pants: 1, shoes: 1},
    ]

const characters = await Promise.all(configs.map(config => createCharacter(config)))
characters.forEach((character, index) => {
  character.root.position.x = (index - (characters.length - 1) / 2) * 0.95
  group.add(character.root)
})

if (q.has('face')) {
  const head = 1.62
  camera.position.set(0.12, head, -0.6)
  camera.lookAt(0, head, 0)
  camera.fov = 30
  camera.updateProjectionMatrix()
} else {
  const width = characters.length * 0.95
  camera.position.set(0.25, 1.0, -width * 1.15 - 1.1)
  camera.lookAt(0, 0.92, 0)
}

if (q.has('ref')) {
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.7, 0.4), new THREE.MeshStandardMaterial({color: 0xcc5533}))
  box.position.set(1.2, 0.85, 0)
  scene.add(box)
  camera.position.set(0.2, 1.2, -6)
  camera.lookAt(0, 0.9, 0)
}
const clock = new THREE.Clock()
let frames = 0
const walking = q.has('walk')
function animate() {
  const dt = Math.min(0.05, clock.getDelta())
  for (const character of characters) {
    character.pose(dt, {moving: walking, speed: walking ? 3.6 : 0, grounded: true})
  }
  renderer.render(scene, camera)
  if (++frames === 3) document.body.dataset.ready = ''
  requestAnimationFrame(animate)
}
animate()

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight)
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
})

Object.assign(window, {
  lab: {characters: characters as Character[], ready: true, THREE},
})
