import * as THREE from 'three'
import {drone, type DroneId, type DroneSpec} from './specs'

// IDOK-215: procedural fleet, in the same spirit as web/src/gear/models.ts — build a believable
// silhouette now, and swap in sg claude's glTF (`./models/drones/<id>.glb`) when it lands.
const ROOT = './models/drones/'
const cache = new Map<string,THREE.MeshStandardMaterial>()

function mat(color:string, rough = .55, metal = .25) {
  const key = `${color}|${rough}|${metal}`
  const hit = cache.get(key)
  if (hit) return hit
  const made = new THREE.MeshStandardMaterial({color,roughness:rough,metalness:metal})
  cache.set(key,made)
  return made
}
function glow(color:string) {
  const key = `glow|${color}`
  const hit = cache.get(key)
  if (hit) return hit
  const made = new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:1.4,roughness:.4,metalness:0})
  cache.set(key,made)
  return made
}

function box(w:number,h:number,d:number,material:THREE.Material,round = .012) {
  const shape = new THREE.BoxGeometry(w,h,d,1,1,1)
  if (round > 0) {
    const pos = shape.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
      // Pull the corners in a hair so the body does not read as a raw cube.
      pos.setXYZ(i, x * (1 - round), y * (1 - round * .6), z * (1 - round))
    }
    shape.computeVertexNormals()
  }
  return new THREE.Mesh(shape, material)
}
function cyl(rt:number,rb:number,h:number,seg:number,material:THREE.Material) {
  return new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg),material)
}
function sphere(r:number,material:THREE.Material,seg = 16) {
  return new THREE.Mesh(new THREE.SphereGeometry(r,seg,Math.max(8,seg/2)),material)
}

/** Two blades per hub, grouped so the rig can spin them. */
function propeller(radius:number,material:THREE.Material) {
  const group = new THREE.Group()
  for (let i = 0; i < 2; i++) {
    const blade = box(radius,.006,radius * .17,material,0)
    blade.position.x = radius * .5
    blade.rotation.z = .12
    const arm = new THREE.Group()
    arm.add(blade)
    arm.rotation.y = i * Math.PI
    group.add(arm)
  }
  return group
}

export interface DroneMesh {
  root:THREE.Group
  props:THREE.Object3D[]
  gimbal:THREE.Object3D
  lens:THREE.Object3D
  lights:THREE.Object3D[]
  gear?:THREE.Object3D
}

function armature(spec:DroneSpec, opts:{bodyW:number, bodyH:number, bodyD:number, reach:number, motorR:number, propR:number}) {
  const shell = mat(spec.color.shell)
  const dark = mat(spec.color.dark,.7,.35)
  const accent = mat(spec.color.accent,.45,.4)
  const metal = mat(spec.color.metal,.35,.85)

  const root = new THREE.Group()
  const props:THREE.Object3D[] = []
  const body = new THREE.Group()
  root.add(body)

  // hull + top shell + battery hatch
  const hull = box(opts.bodyW,opts.bodyH,opts.bodyD,shell,.06)
  body.add(hull)
  const top = box(opts.bodyW * .74,opts.bodyH * .42,opts.bodyD * .62,dark,.08)
  top.position.y = opts.bodyH * .62
  body.add(top)
  const hatch = box(opts.bodyW * .42,.008,opts.bodyD * .3,accent,.02)
  hatch.position.set(0,opts.bodyH * .84,-opts.bodyD * .02)
  body.add(hatch)
  // greebles: vents on the flanks, a seam, the nose badge
  for (const side of [-1,1]) {
    for (let i = 0; i < 4; i++) {
      const vent = box(.004,opts.bodyH * .18,opts.bodyD * .1,dark,0)
      vent.position.set(side * opts.bodyW * .5, opts.bodyH * .1, -opts.bodyD * .3 + i * opts.bodyD * .17)
      body.add(vent)
    }
  }
  const badge = cyl(.012,.012,.004,12,accent)
  badge.rotation.x = Math.PI / 2
  badge.position.set(0,opts.bodyH * .2,-opts.bodyD * .5 - .002)
  body.add(badge)

  const corners:Array<[number,number]> = [[1,1],[1,-1],[-1,1],[-1,-1]]
  for (let i = 0; i < corners.length; i++) {
    const [sx,sz] = corners[i]
    const armGroup = new THREE.Group()
    armGroup.position.set(sx * opts.bodyW * .35, 0, sz * opts.bodyD * .3)
    body.add(armGroup)
    const length = opts.reach - Math.hypot(opts.bodyW * .35,opts.bodyD * .3)
    const arm = box(length,.022 * opts.motorR * 8,.03,dark,0)
    arm.position.set(sx * length * .5,0,0)
    arm.rotation.y = Math.atan2(sz * opts.bodyD * .3, sx * opts.bodyW * .35) * .35
    armGroup.add(arm)
    const motor = cyl(opts.motorR,opts.motorR * 1.08,opts.motorR * .9,14,metal)
    motor.position.set(sx * length,opts.motorR * .55,0)
    armGroup.add(motor)
    const hub = cyl(opts.motorR * .5,opts.motorR * .5,opts.motorR * .22,12,dark)
    hub.position.set(sx * length,opts.motorR * 1.12,0)
    armGroup.add(hub)
    const prop = propeller(opts.propR,mat('#202428',.7,.1))
    prop.position.set(sx * length,opts.motorR * 1.22,0)
    prop.rotation.y = i * Math.PI / 2
    prop.name = `prop_${i + 1}`
    armGroup.add(prop)
    props.push(prop)
  }

  return {root, body, props}
}

function gimbalBlock(spec:DroneSpec, size:{w:number,h:number,d:number}, lenses:number) {
  const dark = mat(spec.color.dark,.6,.4)
  const metal = mat(spec.color.metal,.3,.9)
  const glass = mat('#101418',.15,.6)
  const gimbal = new THREE.Group()
  gimbal.name = 'gimbal'
  const yoke = new THREE.Group()
  gimbal.add(yoke)
  const arm = box(.018,.05,.018,metal,0)
  arm.position.y = -.02
  yoke.add(arm)
  const head = new THREE.Group()
  head.position.y = -.05
  yoke.add(head)
  const barrel = box(size.w,size.h,size.d,dark,.06)
  head.add(barrel)
  const lens = new THREE.Group()
  lens.name = 'lens'
  head.add(lens)
  for (let i = 0; i < lenses; i++) {
    const front = cyl(size.h * (lenses > 1 ? .26 : .38),size.h * (lenses > 1 ? .28 : .4),size.d * .34,16,metal)
    front.rotation.x = Math.PI / 2
    front.position.set((i - (lenses - 1) / 2) * size.w * .3,-size.h * .05,-size.d * .5)
    lens.add(front)
    const pupil = cyl(size.h * (lenses > 1 ? .17 : .26),size.h * (lenses > 1 ? .17 : .26),size.d * .06,16,glass)
    pupil.rotation.x = Math.PI / 2
    pupil.position.set((i - (lenses - 1) / 2) * size.w * .3,-size.h * .05,-size.d * .5 - size.d * .17)
    lens.add(pupil)
  }
  return {gimbal, lens}
}

function landingGear(style:'legs'|'skids'|'transform', spread:number, height:number, material:THREE.Material) {
  const gear = new THREE.Group()
  gear.name = 'gear'
  if (style === 'skids') {
    for (const side of [-1,1]) {
      const skid = cyl(.012,.012,spread * 1.1,8,material)
      skid.rotation.x = Math.PI / 2
      skid.position.set(side * spread * .34,-height,0)
      gear.add(skid)
      for (const z of [-.32,.32]) {
        const strut = box(.014,height,.014,material,0)
        strut.position.set(side * spread * .34,-height * .5,z * spread)
        gear.add(strut)
      }
    }
    return gear
  }
  for (const [sx,sz] of [[1,1],[1,-1],[-1,1],[-1,-1]] as Array<[number,number]>) {
    const strut = box(.016,height,.016,material,0)
    strut.position.set(sx * spread * .3,-height * .5,sz * spread * .26)
    strut.rotation.z = sx * (style === 'transform' ? .35 : .16)
    gear.add(strut)
    const foot = sphere(.018,material,10)
    foot.position.set(sx * spread * .3 + sx * height * (style === 'transform' ? .16 : .07),-height,sz * spread * .26)
    gear.add(foot)
  }
  return gear
}

function buildMavic4(spec:DroneSpec):DroneMesh {
  const {root,body,props} = armature(spec,{bodyW:.20,bodyH:.075,bodyD:.30,reach:.42,motorR:.028,propR:.20})
  const {gimbal,lens} = gimbalBlock(spec,{w:.075,h:.06,d:.07},3)
  gimbal.position.set(0,-.05,-.14)
  body.add(gimbal)
  const gear = landingGear('legs',.22,.07,mat(spec.color.dark,.65,.3))
  body.add(gear)
  // forward binocular sensor bar + status LEDs
  const sensor = box(.11,.014,.014,glow('#2f4a58'),0)
  sensor.position.set(0,.02,-.2)
  body.add(sensor)
  const light = sphere(.008,glow('#e2452f'),8)
  light.position.set(0,-.03,.16)
  body.add(light)
  return {root,props,gimbal,lens,lights:[light,sensor],gear}
}

function buildMini5(spec:DroneSpec):DroneMesh {
  const {root,body,props} = armature(spec,{bodyW:.12,bodyH:.052,bodyD:.18,reach:.19,motorR:.018,propR:.095})
  const {gimbal,lens} = gimbalBlock(spec,{w:.045,h:.04,d:.045},1)
  gimbal.position.set(0,-.036,-.075)
  body.add(gimbal)
  const gear = landingGear('legs',.11,.045,mat(spec.color.dark,.65,.3))
  body.add(gear)
  const light = sphere(.005,glow('#35c26a'),8)
  light.position.set(0,-.02,.1)
  body.add(light)
  return {root,props,gimbal,lens,lights:[light],gear}
}

function buildAir3S(spec:DroneSpec):DroneMesh {
  const {root,body,props} = armature(spec,{bodyW:.16,bodyH:.066,bodyD:.24,reach:.33,motorR:.024,propR:.165})
  const {gimbal,lens} = gimbalBlock(spec,{w:.062,h:.05,d:.06},2)
  gimbal.position.set(0,-.044,-.115)
  body.add(gimbal)
  const gear = landingGear('legs',.18,.06,mat(spec.color.dark,.65,.3))
  body.add(gear)
  const light = sphere(.006,glow('#e2452f'),8)
  light.position.set(0,-.026,.13)
  body.add(light)
  return {root,props,gimbal,lens,lights:[light],gear}
}

function buildFlyCart(spec:DroneSpec):DroneMesh {
  const {root,body,props} = armature(spec,{bodyW:.62,bodyH:.24,bodyD:.90,reach:1.30,motorR:.075,propR:.55})
  // eight-arm layout: the armature gives four, so mirror a second set lower for the heavy-lift look
  const spare = armature(spec,{bodyW:.44,bodyH:.10,bodyD:.62,reach:1.05,motorR:.065,propR:.46})
  spare.root.position.y = -.14
  spare.root.scale.setScalar(.94)
  body.add(spare.root)
  props.push(...spare.props)
  const cargo = box(.42,.22,.5,mat('#252a26',.8,.15),.04)
  cargo.position.set(0,-.2,.06)
  body.add(cargo)
  const strap = box(.44,.02,.52,mat(spec.color.accent,.6,.2),0)
  strap.position.set(0,-.09,.06)
  body.add(strap)
  const {gimbal,lens} = gimbalBlock(spec,{w:.13,h:.10,d:.09},1)
  gimbal.position.set(0,-.14,-.46)
  body.add(gimbal)
  const winch = cyl(.06,.06,.05,14,mat(spec.color.metal,.35,.8))
  winch.position.set(0,-.34,0)
  body.add(winch)
  const gear = landingGear('skids',.62,.42,mat(spec.color.metal,.35,.8))
  body.add(gear)
  const light = sphere(.014,glow('#e08a2e'),10)
  light.position.set(0,-.12,.44)
  body.add(light)
  return {root,props,gimbal,lens,lights:[light],gear}
}

const builders:Record<DroneId,(spec:DroneSpec)=>DroneMesh> = {
  mavic4pro:buildMavic4, mini5pro:buildMini5, air3s:buildAir3S, flycart200:buildFlyCart,
}

export function buildDrone(id:DroneId):DroneMesh {
  const spec = drone(id)
  const made = builders[id](spec)
  made.root.name = `drone-${id}`
  made.root.userData.spec = spec.id
  return made
}

/** sg claude's glTF, when present: expect nodes prop_*, gimbal, lens, gear. */
export async function buildDroneAsync(id:DroneId):Promise<DroneMesh> {
  try {
    const {GLTFLoader} = await import('three/addons/loaders/GLTFLoader.js')
    const loader = new GLTFLoader()
    const [gltf, manifest] = await Promise.all([
      loader.loadAsync(`${ROOT}${id}.glb`),
      fetch(`${ROOT}manifest.json`).then(r => r.ok ? r.json() : null).catch(() => null),
    ])
    const entry = manifest?.drones?.[id]
    const root = new THREE.Group()
    const scene = gltf.scene
    if (entry?.scale) scene.scale.setScalar(entry.scale)
    if (entry?.rot) scene.rotation.fromArray(entry.rot)
    if (entry?.offset) scene.position.fromArray(entry.offset)
    root.add(scene)
    root.name = `drone-${id}`
    root.userData.spec = id
    root.userData.source = 'gltf'
    const props:THREE.Object3D[] = []
    scene.traverse(node => { if (/^prop/i.test(node.name)) props.push(node) })
    return {
      root, props,
      gimbal:scene.getObjectByName('gimbal') ?? root,
      lens:scene.getObjectByName('lens') ?? root,
      gear:scene.getObjectByName('gear'),
      lights:[],
    }
  } catch {
    return buildDrone(id)
  }
}

export function disposeDrone(mesh:DroneMesh) {
  mesh.root.removeFromParent()
  mesh.root.traverse(node => {
    const withGeometry = node as THREE.Mesh
    // Materials come from the module cache, so only geometry is owned here.
    if (withGeometry.geometry) withGeometry.geometry.dispose()
  })
}

/** Prop blur: the rig calls this every frame while the rotors are spinning. */
export function spinProps(mesh:DroneMesh, dt:number, throttle:number) {
  const rate = 40 + throttle * 90
  for (const prop of mesh.props) prop.rotation.y += rate * dt
}
