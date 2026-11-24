import * as THREE from 'three'
import type {Host} from '../play/host'
import './drone.css'
import {DRONE_IDS, drone, type DroneId} from './specs'
import {buildDroneAsync, disposeDrone, spinProps, type DroneMesh} from './models'
import {createFlight, landNow, lensPose, liftOff, requestHome, stepFlight, telemetry, type Flight, type Sticks} from './flight'
import {PilotInput, type DroneAction} from './input'
import {createRc, type RcView} from './rc-ui'
import {startRecording, saveRecording, type Recording} from '../gear/video'

// IDOK-215: 机库 → 放置 → 起飞 → 遥控画面。The dock entry opens the hangar; once a drone is out,
// the same entry becomes 起飞, and the RC overlay takes over the camera until 退出.

export type LoadKind = 'none' | 'cargo' | 'person' | 'car'

export interface DroneMode {
  tick(dt:number):void
  open():void
  get active():boolean
  get placed():DroneId|null
  mountEntry(host:HTMLElement):void
  /** Test hook: place + lift off + enter RC without a pointer. */
  debugStart?(id:DroneId):Promise<void>
  /**
   * Test hook: advance the flight model without waiting for animation frames. Software rendering
   * can drop to a frame every few seconds, so wall-clock stepping makes the suite flaky.
   */
  debugStep?(dt:number, repeats?:number):Record<string,unknown>|null
  debugState?():Record<string,unknown>
}

const PLACE_DISTANCE = 4.2
const PLACE_SIDE = .42
const LOAD_WEIGHT:Record<LoadKind,number> = {none:0,cargo:200000,person:80000,car:1200000}
const LOAD_LABEL:Record<LoadKind,string> = {none:'空载',cargo:'运货 200 kg',person:'运人 80 kg',car:'运车（超载）'}

export function droneMode(host:Host, deps:{groundAt:(x:number,z:number)=>number; name:()=>string}):DroneMode {
  const input = new PilotInput()
  let placed:DroneId|null = null
  let mesh:DroneMesh|null = null
  let flight:Flight|null = null
  let rc:RcView|null = null
  let loadKind:LoadKind = 'none'
  let loadMesh:THREE.Object3D|null = null
  let recording:{rec:Recording; started:number}|null = null
  let hint:HTMLElement|null = null
  const lens = {pos:new THREE.Vector3(),yaw:0,pitch:0}

  // --- Hangar (机库): pick an aircraft, it lands a few metres ahead.
  const mask = document.createElement('div')
  mask.className = 'about-mask drone-mask'
  mask.hidden = true
  mask.innerHTML = `<div class="about-panel drone-panel" role="dialog" aria-label="无人机">
      <header><h2>无人机机库</h2><button class="about-close" aria-label="关闭">×</button></header>
      <div class="drone-grid"></div>
      <p class="drone-foot">选一台放到身前；放好后点「飞无人机」进遥控画面。键盘：WASD 平移，↑↓ 升降，←→ 转向，R 返航，P 拍照，V 录像。</p>
    </div>`
  document.body.append(mask)
  const grid = mask.querySelector<HTMLElement>('.drone-grid')!
  mask.querySelector<HTMLButtonElement>('.about-close')!.onclick = () => closeHangar()
  mask.addEventListener('pointerdown',event => { if (event.target === mask) closeHangar() })

  function renderHangar() {
    grid.innerHTML = DRONE_IDS.map(id => {
      const spec = drone(id)
      const isOut = placed === id
      return `<button class="drone-card${isOut ? ' out' : ''}" data-drone="${id}" type="button">
        <span class="drone-name">${spec.name}</span>
        <span class="drone-tag">${spec.tagline}</span>
        <dl>
          <div><dt>相机</dt><dd>${spec.camera.sensor}</dd></div>
          <div><dt>画质</dt><dd>${spec.video.res}${spec.video.fps} · ${spec.camera.mp}MP</dd></div>
          <div><dt>续航</dt><dd>${spec.flightMin} 分钟</dd></div>
          <div><dt>极速</dt><dd>${spec.speed} m/s</dd></div>
          <div><dt>升限</dt><dd>${spec.ceiling} m</dd></div>
          <div><dt>图传</dt><dd>${spec.transmitKm} km</dd></div>
          <div><dt>重量</dt><dd>${(spec.weightG / 1000).toFixed(2)} kg</dd></div>
          <div><dt>遥控</dt><dd>${spec.rc === 'simple' ? '傻瓜式' : '专业遥控器'}</dd></div>
        </dl>
        ${spec.payloadG ? `<span class="drone-load">载荷 ${spec.payloadG / 1000} kg · 当前 ${LOAD_LABEL[loadKind]}</span>
          <span class="drone-loads">${(['none','cargo','person','car'] as LoadKind[]).map(kind =>
            `<i data-load="${kind}" class="${kind === loadKind ? 'on' : ''}">${LOAD_LABEL[kind]}</i>`).join('')}</span>` : ''}
        <span class="drone-cta">${isOut ? '召回' : '放到身前'}</span>
      </button>`
    }).join('')
    for (const card of Array.from(grid.querySelectorAll<HTMLElement>('[data-drone]'))) {
      card.onclick = () => void choose(card.dataset.drone as DroneId)
    }
    for (const chip of Array.from(grid.querySelectorAll<HTMLElement>('[data-load]'))) {
      chip.onclick = event => {
        event.stopPropagation()
        loadKind = chip.dataset.load as LoadKind
        if (flight) flight.load = flight.spec.payloadG ? LOAD_WEIGHT[loadKind] : 0
        renderHangar()
      }
    }
  }

  function openHangar() {
    if (rcActive) return
    renderHangar()
    mask.hidden = false
    requestAnimationFrame(() => mask.classList.add('show'))
  }
  function closeHangar() {
    mask.classList.remove('show')
    setTimeout(() => { if (!mask.classList.contains('show')) mask.hidden = true },220)
  }

  async function choose(id:DroneId) {
    if (placed === id) { recall(); closeHangar(); return }
    await place(id)
    closeHangar()
  }

  async function place(id:DroneId) {
    recall()
    placed = id
    const built = await buildDroneAsync(id)
    mesh = built
    host.scene.add(built.root)
    const spec = drone(id)
    const origin = host.walker()?.active ? host.walker()!.position : host.camera.position
    const yaw = host.walker()?.active ? host.walker()!.yaw : 0
    // Ahead and a little to the right, so the third-person camera behind the walker can see it.
    const aim = yaw - PLACE_SIDE
    const x = origin.x - Math.sin(aim) * PLACE_DISTANCE
    const z = origin.z - Math.cos(aim) * PLACE_DISTANCE
    const groundY = deps.groundAt(x,z)
    const y = (Number.isFinite(groundY) ? groundY : origin.y) + spec.height * .8
    flight = createFlight(spec,new THREE.Vector3(x,y,z),yaw)
    flight.load = spec.payloadG ? LOAD_WEIGHT[loadKind] : 0
    built.root.position.set(x,y,z)
    built.root.rotation.y = yaw
    showHint(`已放置 ${spec.short} · 点「飞无人机」进遥控画面`)
    refreshDock()
  }

  function recall() {
    if (rcActive) exitRc()
    if (mesh) { disposeDrone(mesh); mesh = null }
    detachLoad()
    flight = null
    placed = null
    hideHint()
    refreshDock()
  }

  function showHint(text:string) {
    if (!hint) { hint = document.createElement('div'); hint.className = 'drone-hint'; document.body.append(hint) }
    hint.textContent = text
    hint.hidden = false
  }
  function hideHint() { if (hint) hint.hidden = true }

  // --- Payload (FlyCart): a crate, a passenger in a harness, or a car on the sling.
  function attachLoad() {
    detachLoad()
    if (!mesh || !flight?.spec.payloadG || loadKind === 'none') return
    const group = new THREE.Group()
    const dark = new THREE.MeshStandardMaterial({color:'#24282a',roughness:.8,metalness:.15})
    const canvas = new THREE.MeshStandardMaterial({color:'#c96b3a',roughness:.85})
    if (loadKind === 'cargo') {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(.7,.55,.9),canvas)
      crate.position.y = -.9
      group.add(crate)
      const band = new THREE.Mesh(new THREE.BoxGeometry(.72,.08,.92),dark)
      band.position.y = -.72
      group.add(band)
    } else if (loadKind === 'person') {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(.22,.85,4,10),new THREE.MeshStandardMaterial({color:'#3d4a6a',roughness:.7}))
      body.position.y = -1.1
      group.add(body)
      const head = new THREE.Mesh(new THREE.SphereGeometry(.16,12,10),new THREE.MeshStandardMaterial({color:'#d8b08a',roughness:.7}))
      head.position.y = -.6
      group.add(head)
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.7,6),dark)
      rope.position.y = -.25
      group.add(rope)
    } else {
      const shell = new THREE.Mesh(new THREE.BoxGeometry(1.7,.62,3.9),new THREE.MeshStandardMaterial({color:'#7d2f2a',roughness:.55,metalness:.3}))
      shell.position.y = -1.5
      group.add(shell)
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5,.5,1.7),new THREE.MeshStandardMaterial({color:'#1b2226',roughness:.4,metalness:.4}))
      cabin.position.set(0,-1.1,-.2)
      group.add(cabin)
      for (const [x,z] of [[.8,1.2],[-.8,1.2],[.8,-1.2],[-.8,-1.2]] as Array<[number,number]>) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.3,.3,.16,12),dark)
        wheel.rotation.z = Math.PI / 2
        wheel.position.set(x,-1.8,z)
        group.add(wheel)
      }
    }
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(.02,.02,1.4,6),dark)
    rope.position.y = -.2
    group.add(rope)
    loadMesh = group
    mesh.root.add(group)
  }
  function detachLoad() {
    if (!loadMesh) return
    loadMesh.removeFromParent()
    loadMesh.traverse(node => {
      const withGeometry = node as THREE.Mesh
      if (withGeometry.geometry) withGeometry.geometry.dispose()
    })
    loadMesh = null
  }

  // --- RC session
  let rcActive = false
  let ownsPhotoFlag = false
  let savedCamera:{pos:THREE.Vector3; quat:THREE.Quaternion; fov:number}|null = null

  function enterRc() {
    if (!flight || rcActive) return
    if (flight.phase !== 'landed') return
    rcActive = true
    attachLoad()
    savedCamera = {pos:host.camera.position.clone(),quat:host.camera.quaternion.clone(),fov:host.camera.fov}
    host.walker()?.hold(true)
    host.cinema = true
    document.body.dataset.drone = 'rc'
    // Reuse the photo-mode contract: every HUD piece (keys card, hotbar, chat, mission pills…) already
    // hides under data-photo=on, and global hotkeys (R 复位, J 景册…) stand down while it is set.
    ownsPhotoFlag = document.body.dataset.photo !== 'on'
    document.body.dataset.photo = 'on'
    hideHint()
    input.enabled = true
    input.attach()
    input.onAction(act)
    rc = createRc(flight.spec,{
      takeoff:() => { if (!flight) return; if (flight.phase === 'landed') liftOff(flight); else landNow(flight) },
      land:() => { if (flight) landNow(flight) },
      rth:() => { if (flight) { requestHome(flight); rc?.toast('自动返航') } },
      photo:() => void snapshot(),
      record:() => void toggleRecord(),
      exit:() => exitRc(),
      gimbal:deg => { if (flight) flight.gimbal = deg },
      sticks:patch => input.setTouch(patch),
    })
    document.body.append(rc.root)
    liftOff(flight)
    refreshDock()
  }

  function exitRc() {
    if (!rcActive) return
    rcActive = false
    input.enabled = false
    input.detach()
    if (recording) { void stopRecord() }
    rc?.root.remove()
    rc = null
    delete document.body.dataset.drone
    if (ownsPhotoFlag) delete document.body.dataset.photo
    ownsPhotoFlag = false
    host.cinema = false
    host.walker()?.hold(false)
    if (savedCamera) {
      // Leave the pilot where they stood: the walk rig reclaims the camera next frame, but the fov
      // and orientation are restored first so a solo (no walker) session still looks sane.
      host.camera.fov = savedCamera.fov
      host.camera.updateProjectionMatrix()
      savedCamera = null
    }
    if (flight && flight.phase !== 'landed') landNow(flight)
    refreshDock()
  }

  function act(action:DroneAction) {
    if (!flight || !rc) return
    if (action === 'takeoff') { if (flight.phase === 'landed') liftOff(flight); else landNow(flight) }
    if (action === 'rth') { requestHome(flight); rc.toast('自动返航') }
    if (action === 'photo') void snapshot()
    if (action === 'record') void toggleRecord()
    if (action === 'land') landNow(flight)
    if (action === 'stop') exitRc()
  }

  async function snapshot() {
    if (!rc) return
    const renderer = host.renderer
    const ratio = renderer.getPixelRatio()
    const long = Math.max(innerWidth,innerHeight)
    const hi = Math.min(4096 / long,Math.max(ratio,2560 / long))
    const size = renderer.getSize(new THREE.Vector2())
    renderer.setPixelRatio(hi)
    renderer.setSize(innerWidth,innerHeight,false)
    host.draw()
    const grab = document.createElement('canvas')
    grab.width = renderer.domElement.width
    grab.height = renderer.domElement.height
    grab.getContext('2d')!.drawImage(renderer.domElement,0,0)
    renderer.setPixelRatio(ratio)
    renderer.setSize(size.x,size.y,false)
    host.draw()
    const blob = await new Promise<Blob|null>(resolve => grab.toBlob(resolve,'image/jpeg',.94))
    if (!blob) return
    const name = `${deps.name() || '桂林'}-航拍-${stamp()}.jpg`
    save(blob,name)
    window.lastDronePhoto = {name,bytes:blob.size,width:grab.width,height:grab.height,drone:flight?.spec.id ?? null}
    window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text:`已保存航拍 ${name}`,ms:2600}}))
    rc.toast(`已保存 ${name}`)
  }

  async function toggleRecord() {
    if (!flight || !rc) return
    if (recording) { await stopRecord(); return }
    const spec = flight.spec
    const preset = {label:`${spec.video.res}${spec.video.fps}`,width:1920,height:1080,fps:Math.min(60,spec.video.fps),bitrate:20000000}
    const started = await startRecording(host.renderer.domElement,{} as never,preset)
    if (!started) { rc.toast('这台机器开不了录像'); return }
    recording = {rec:started,started:performance.now()}
    rc.setRecording(true)
    rc.toast('开始录像')
  }

  async function stopRecord() {
    if (!recording || !rc) return
    const current = recording
    recording = null
    rc.setRecording(false)
    const result = await current.rec.stop()
    const saved = saveRecording(result,'航拍')
    if (!saved) {
      rc.toast('这台机器录不出画面（浏览器编码器没有输出）')
      return
    }
    window.lastDroneClip = {name:saved,container:result.container,mime:result.mime,seconds:result.seconds,width:result.width,height:result.height,fps:result.fps}
    rc.toast(result.container === 'webm' ? `已保存 ${saved}（本机编不出 MP4）` : `已保存 ${saved}`)
  }

  function save(blob:Blob,name:string) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.rel = 'noopener'
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url),8000)
  }

  // --- Dock entry
  let entry:HTMLButtonElement|null = null
  function refreshDock() {
    if (!entry) return
    if (placed) {
      entry.textContent = rcActive ? '遥控中' : '飞无人机'
      entry.dataset.stage = rcActive ? 'rc' : 'ready'
      entry.setAttribute('aria-label',rcActive ? '遥控中' : '起飞无人机')
    } else {
      entry.textContent = '无人机'
      entry.dataset.stage = 'none'
      entry.setAttribute('aria-label','无人机机库')
    }
  }
  function mountEntry(host_:HTMLElement) {
    if (entry) return
    entry = document.createElement('button')
    entry.className = 'dock-drone'
    entry.type = 'button'
    entry.onclick = () => {
      if (rcActive) return
      if (placed) enterRc()
      else openHangar()
    }
    host_.append(entry)
    refreshDock()
  }

  // --- Frame
  function advance(dt:number) {
    if (!flight || !mesh) return
    const gnd = (x:number,z:number) => deps.groundAt(x,z)
    if (flight.phase !== 'landed') stepFlight(flight,Math.min(dt,.1),input.read(),gnd)
    else stepFlight(flight,Math.min(dt,.1),{throttle:0,yaw:input.read().yaw * .4,pitch:0,roll:0},gnd)
    mesh.root.position.copy(flight.pos)
    mesh.root.rotation.y = flight.yaw
    const throttle = flight.phase === 'landed' ? .06 : .5 + Math.min(.5,Math.hypot(flight.vel.x,flight.vel.y,flight.vel.z) / Math.max(1,flight.spec.speed))
    spinProps(mesh,dt,throttle)
    mesh.gimbal.rotation.x = THREE.MathUtils.degToRad(flight.gimbal) * .35
    if (loadMesh) loadMesh.rotation.y = Math.sin(flight.elapsed * .7) * .04

    if (rcActive && rc) {
      lensPose(flight,lens)
      host.camera.position.copy(lens.pos)
      host.camera.rotation.set(lens.pitch,lens.yaw,0,'YXZ')
      host.camera.updateMatrixWorld()
      rc.update(telemetry(flight),!!recording)
      if (flight.phase === 'returning' && entry) entry.textContent = '返航中'
    } else if (placed) {
      const d = host.walker()?.active
        ? host.walker()!.position.distanceTo(flight.pos)
        : host.camera.position.distanceTo(flight.pos)
      showHint(`${flight.spec.short} 就位 · ${flight.battery.toFixed(0)}% 电量 · 点「飞无人机」起飞${d > 60 ? '（离得有点远）' : ''}`)
    }
  }

  function tick(dt:number) { advance(dt) }

  window.addEventListener('keydown',event => {
    if (event.code === 'Escape' && !mask.hidden) { closeHangar(); event.stopPropagation() }
  })

  const api:DroneMode = {
    tick, open: openHangar,
    get active() { return rcActive },
    get placed() { return placed },
    mountEntry,
    debugStart: async (id:DroneId) => { await place(id); if (flight) enterRc() },
    debugStep: (dt:number, repeats = 1) => {
      for (let i = 0; i < Math.max(1,repeats); i++) advance(dt)
      return flight ? telemetry(flight) : null
    },
    debugState: () => ({placed,rc:rcActive,load:loadKind,mesh:mesh?.root.name ?? null,flight:flight ? telemetry(flight) : null,recording:!!recording}),
  }
  if (typeof window !== 'undefined') { window.droneDebug = api.debugState; window.droneStep = api.debugStep }
  return api
}

function stamp() {
  const now = new Date()
  const pad = (value:number) => String(value).padStart(2,'0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

declare global {
  interface Window {
    droneDebug?:() => Record<string,unknown>
    droneStep?:(dt:number, repeats?:number) => Record<string,unknown>|null
    lastDronePhoto?:{name:string;bytes:number;width:number;height:number;drone:string|null}
    lastDroneClip?:{name:string;container:string;mime:string;seconds:number;width:number;height:number;fps:number}
  }
}
