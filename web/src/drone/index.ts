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
  /** Test hook: third-person chase camera on the placed / flying drone (null = normal camera). */
  debugChase?(view:{distance:number; height:number; side:number}|null):void
}

const PLACE_DISTANCE = 4.2
const PLACE_SIDE = .42
// IDOK-255: loads are weights, not fixed presets. The player may carry cargo or a car as long as
// the total stays inside the airframe's payload (FlyCart 200 = 200 kg), so the hangar gates the
// chips by weight instead of pretending a 1.2 t car is "超载" and letting it fly anyway.
const LOAD_KINDS:LoadKind[] = ['none','cargo','person','car']
const LOAD_FIXED:Record<LoadKind,number> = {none:0,cargo:0,person:80000,car:1200000}
const LOAD_TITLE:Record<LoadKind,string> = {none:'空载',cargo:'运货',person:'运人',car:'运车'}
const CARGO_DEFAULT = 100000

export function droneMode(host:Host, deps:{groundAt:(x:number,z:number)=>number; name:()=>string}):DroneMode {
  const input = new PilotInput()
  let placed:DroneId|null = null
  let mesh:DroneMesh|null = null
  let flight:Flight|null = null
  let rc:RcView|null = null
  let loadKind:LoadKind = 'none'
  let cargoG = CARGO_DEFAULT
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

  // 载重：重量是唯一标准。货重可调，货/人/车都只在「不超过该机型载荷」时可选。
  function payloadOf(id:DroneId|null):number { return id ? drone(id).payloadG ?? 0 : 0 }
  function loadGrams():number {
    if (loadKind === 'none') return 0
    const grams = loadKind === 'cargo' ? cargoG : LOAD_FIXED[loadKind]
    const cap = payloadOf(placed)
    return cap ? Math.min(grams,cap) : grams
  }
  function loadStaysInside(kind:LoadKind,id:DroneId|null):boolean {
    const grams = kind === 'cargo' ? cargoG : LOAD_FIXED[kind]
    const cap = payloadOf(id)
    return !cap || grams <= cap
  }
  function loadText(kind:LoadKind):string {
    const grams = kind === 'none' ? 0 : kind === 'cargo' ? cargoG : LOAD_FIXED[kind]
    const kg = grams >= 1000 ? `${(grams / 1000).toFixed(grams % 1000 ? 1 : 0)} kg` : `${grams} g`
    return kind === 'none' ? '空载' : `${LOAD_TITLE[kind]} ${kg}`
  }
  function kgText(grams:number):string {
    return grams % 1000 ? `${(grams / 1000).toFixed(1)} kg` : `${(grams / 1000).toFixed(0)} kg`
  }

  function renderHangar() {
    grid.innerHTML = DRONE_IDS.map(id => {
      const spec = drone(id)
      const isOut = placed === id
      const cap = spec.payloadG ?? 0
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
        ${cap ? `<span class="drone-load">载荷 ${(cap / 1000).toFixed(0)} kg · 当前 ${loadText(loadKind)}</span>
          <span class="drone-loads">${LOAD_KINDS.map(kind => {
            const inside = loadStaysInside(kind,id)
            const grams = kind === 'cargo' ? cargoG : LOAD_FIXED[kind]
            const title = inside ? '' : ` title="超重：${kgText(grams)} 超过 ${kgText(cap)} 载荷"`
            return `<i data-load="${kind}" data-drone-load="${id}"${title} class="${kind === loadKind ? 'on' : ''}${inside ? '' : ' over'}">${loadText(kind)}</i>`
          }).join('')}</span>
          ${loadKind === 'cargo' ? `<span class="drone-cargo">
            <input type="range" data-cargoweight min="10" max="${cap / 1000}" step="10" value="${Math.min(cargoG / 1000,cap / 1000)}">
            <b data-cargoval>${(cargoG / 1000).toFixed(0)} kg</b></span>` : ''}
          <span class="drone-note" data-load-note hidden></span>` : ''}
        <span class="drone-cta">${isOut ? '召回' : '放到身前'}</span>
      </button>`
    }).join('')
    for (const card of Array.from(grid.querySelectorAll<HTMLElement>('[data-drone]'))) {
      card.onclick = () => void choose(card.dataset.drone as DroneId)
    }
    for (const chip of Array.from(grid.querySelectorAll<HTMLElement>('[data-load]'))) {
      chip.onclick = event => {
        event.stopPropagation()
        const id = chip.dataset.droneLoad as DroneId
        const kind = chip.dataset.load as LoadKind
        if (!loadStaysInside(kind,id)) {
          const cap = payloadOf(id)
          const grams = kind === 'cargo' ? cargoG : LOAD_FIXED[kind]
          const note = chip.closest('.drone-card')?.querySelector<HTMLElement>('[data-load-note]')
          if (note) {
            note.hidden = false
            note.textContent = `超重：${kgText(grams)} 超过 ${kgText(cap)} 载荷，飞不起来`
          }
          return
        }
        loadKind = kind
        if (flight) flight.load = loadGrams()
        renderHangar()
      }
    }
    for (const slider of Array.from(grid.querySelectorAll<HTMLInputElement>('[data-cargoweight]'))) {
      slider.oninput = () => {
        cargoG = Math.round(Number(slider.value) * 1000)
        const label = slider.closest('.drone-cargo')?.querySelector<HTMLElement>('[data-cargoval]')
        if (label) label.textContent = `${(cargoG / 1000).toFixed(0)} kg`
        const chip = slider.closest('.drone-card')?.querySelector<HTMLElement>('[data-load="cargo"]')
        if (chip) chip.textContent = loadText('cargo')
        const loadLine = slider.closest('.drone-card')?.querySelector<HTMLElement>('.drone-load')
        const cardId = slider.closest<HTMLElement>('[data-drone]')?.dataset.drone as DroneId | undefined
        if (loadLine && cardId) loadLine.textContent = `载荷 ${kgText(payloadOf(cardId))} · 当前 ${loadText(loadKind)}`
        if (flight && loadKind === 'cargo') flight.load = loadGrams()
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
    flight.load = loadGrams()
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
  // IDOK-275: winch mode — the cargo box comes off, a cable pays out from the `winch` node of the glTF
  // and the load (a real passer-by figure / the street car model) rests on the ground until the
  // cable goes taut. `rig` hangs at the cable end; `drop` is the cable length the frame loop sets.
  let payload:{group:THREE.Group; cable:THREE.Mesh; rig:THREE.Group; maxDrop:number; below:number; token:number}|null = null
  let payloadToken = 0
  function hookPoint() {
    const winch = mesh?.root.getObjectByName('winch')
    if (!mesh || !winch) return new THREE.Vector3(0,-.25,0)
    mesh.root.updateMatrixWorld(true)
    return mesh.root.worldToLocal(winch.getWorldPosition(new THREE.Vector3()))
  }
  function setCargoBox(visible:boolean) {
    const box = mesh?.root.getObjectByName('cargo_box')
    if (box) box.visible = visible
  }
  function attachLoad() {
    detachLoad()
    if (!mesh || !flight?.spec.payloadG || loadKind === 'none') { setCargoBox(true); return }
    setCargoBox(false)
    const kind = loadKind
    const token = ++payloadToken
    const group = new THREE.Group()
    group.name = 'drone-payload'
    group.position.copy(hookPoint())
    const strap = new THREE.MeshStandardMaterial({color:'#2a2d2c',roughness:.75,metalness:.2})
    const orange = new THREE.MeshStandardMaterial({color:'#e08a2e',roughness:.55,metalness:.1})
    // unit-length cable, scaled to the paid-out length every frame
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,1,6).translate(0,-.5,0),strap)
    group.add(cable)
    const rig = new THREE.Group()
    group.add(rig)
    const hook = new THREE.Mesh(new THREE.TorusGeometry(.06,.016,6,14,Math.PI * 1.4),orange)
    hook.rotation.z = Math.PI * .8
    hook.position.y = -.05
    rig.add(hook)
    const sling = (from:THREE.Vector3,to:THREE.Vector3,r = .01) => {
      const len = from.distanceTo(to)
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r,r,len,5),strap)
      m.position.copy(from).add(to).multiplyScalar(.5)
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),to.clone().sub(from).normalize())
      rig.add(m)
    }
    payload = {group,cable,rig,maxDrop:2.4,below:1,token}
    if (kind === 'cargo') {
      const canvas = new THREE.MeshStandardMaterial({color:'#c96b3a',roughness:.85})
      // IDOK-255: crate grows with the slider weight (10 kg small, 200 kg big)
      const scale = Math.max(.55,Math.min(1.25,Math.cbrt(Math.max(1,loadGrams()) / 100000)))
      const crate = new THREE.Mesh(new THREE.BoxGeometry(.7,.55,.9),canvas)
      crate.scale.setScalar(scale)
      crate.position.y = -.36 - .275 * scale
      rig.add(crate)
      const band = new THREE.Mesh(new THREE.BoxGeometry(.72,.08,.92),strap)
      band.scale.set(scale,1,scale)
      band.position.y = -.4
      rig.add(band)
      for (const [x,z] of [[.33,.43],[-.33,.43],[.33,-.43],[-.33,-.43]]) sling(new THREE.Vector3(0,-.08,0),new THREE.Vector3(x,-.36,z))
      payload.below = .9
    } else if (kind === 'person') {
      // harness: short strops from the hook to the chest; the figure itself loads async
      for (const x of [-.12,.12]) sling(new THREE.Vector3(0,-.08,0),new THREE.Vector3(x,-.5,0),.012)
      payload.maxDrop = 2.6
      payload.below = 1.95
      void Promise.all([import('../traffic/crowd'),import('../walk/character'),import('../walk/avatar-rig')]).then(async ([crowd,character,avatarRig]) => {
        const model = await character.previewCharacter(crowd.randomPasserby(Math.random))
        if (!payload || payload.token !== token) { character.disposeCharacterParts(model.scene); return }
        const figure = model.scene
        // feet hang ~1.9 m below the hook; arms reach up to the strops, legs relaxed
        figure.position.y = -1.95
        const joints = avatarRig.getAvatarJoints(figure)
        joints.ArmL?.rotation.set(0,0,-2.55)
        joints.ArmR?.rotation.set(0,0,2.55)
        joints.ForearmL?.rotation.set(0,0,-.35)
        joints.ForearmR?.rotation.set(0,0,.35)
        joints.ThighL?.rotation.set(.18,0,0)
        joints.ThighR?.rotation.set(-.08,0,0)
        joints.ShinL?.rotation.set(-.3,0,0)
        joints.ShinR?.rotation.set(-.12,0,0)
        figure.userData.dronePayloadFigure = true
        rig.add(figure)
      }).catch(error => console.warn('drone passenger unavailable',error))
    } else {
      // the street car model on a four-leg sling through the wheel arches
      payload.maxDrop = 2.2
      void import('../walk/vehicle-model').then(({vehicleModel}) => {
        if (!payload || payload.token !== token) return
        const car = vehicleModel('car',Math.floor(Math.random() * 4)) as THREE.Mesh
        car.userData.sharedGeometry = true
        const geometry = car.geometry
        if (!geometry.boundingBox) geometry.computeBoundingBox()
        const bb = geometry.boundingBox!
        const top = .6
        car.position.y = -top - bb.max.y
        rig.add(car)
        const lift = -top - bb.max.y + (bb.max.y - bb.min.y) * .35
        const hw = (bb.max.x - bb.min.x) * .5 + .04, hl = (bb.max.z - bb.min.z) * .32
        const spreader = new THREE.Vector3(0,-.12,0)
        for (const [x,z] of [[hw,hl],[-hw,hl],[hw,-hl],[-hw,-hl]]) sling(spreader,new THREE.Vector3(x,lift,z),.014)
        if (payload) payload.below = top + (bb.max.y - bb.min.y)
      }).catch(error => console.warn('drone car payload unavailable',error))
    }
    loadMesh = group
    mesh.root.add(group)
  }
  function detachLoad() {
    setCargoBox(true)
    payload = null
    if (!loadMesh) return
    loadMesh.removeFromParent()
    loadMesh.traverse(node => {
      const withGeometry = node as THREE.Mesh
      // the street car shares its geometry with traffic — never dispose that one
      if (withGeometry.geometry && !node.userData.sharedGeometry) withGeometry.geometry.dispose()
    })
    loadMesh = null
  }
  /** Cable pays out with altitude, so the load lifts off the ground instead of clipping through it. */
  function stepPayload() {
    if (!payload || !flight) return
    const hookAgl = flight.agl + flight.spec.height * .5 + payload.group.position.y
    const drop = THREE.MathUtils.clamp(hookAgl - payload.below,.15,payload.maxDrop)
    payload.cable.scale.y = drop
    payload.rig.position.y = -drop
    const sway = flight.phase === 'landed' ? 0 : Math.min(1,hookAgl / 4)
    payload.rig.rotation.z = Math.sin(flight.elapsed * 1.1) * .03 * sway
  }

  // --- RC session
  let rcActive = false
  let ownsPhotoFlag = false
  let savedCamera:{pos:THREE.Vector3; quat:THREE.Quaternion; fov:number}|null = null

  function enterRc() {
    if (!flight || rcActive) return
    if (flight.phase !== 'landed') return
    // IDOK-278: 雨天不起飞 —— DJI 安全规范里雨雪是禁飞条件，这里挡在进入遥控之前。
    if (host.clock.weather === 'rain') {
      window.dispatchEvent(new CustomEvent('walk:toast', {
        detail: {text: '雨天不能在室外起飞 · 请等天气放晴后再飞', ms: 4200},
      }))
      return
    }
    const cap = flight.spec.payloadG ?? 0
    if (cap && flight.load > cap) {
      window.dispatchEvent(new CustomEvent('walk:toast', {
        detail: {text: `超重 ${(flight.load / 1000).toFixed(0)} kg > ${(cap / 1000).toFixed(0)} kg 载荷，先卸货再起飞`, ms: 4200},
      }))
      return
    }
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
    if (action === 'takeoff') {
      if (flight.phase === 'landed') {
        const cap = flight.spec.payloadG ?? 0
        if (cap && flight.load > cap) { rc.toast(`超重 ${(flight.load / 1000).toFixed(0)} kg > ${(cap / 1000).toFixed(0)} kg 载荷`); return }
        liftOff(flight)
      } else landNow(flight)
    }
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
      // IDOK-278: 雨天 dock 按钮标灰，点了也只弹提示
      const grounded = host.clock.weather === 'rain'
      entry.textContent = rcActive ? '遥控中' : grounded ? '雨天禁飞' : '飞无人机'
      entry.dataset.stage = rcActive ? 'rc' : grounded ? 'no-fly' : 'ready'
      entry.setAttribute('aria-label',rcActive ? '遥控中' : grounded ? '雨天不能在室外起飞' : '起飞无人机')
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
    // IDOK-278: 天气切换（手动或自动流转）时刷新 dock 的禁飞状态
    window.addEventListener('sky:weather', refreshDock as EventListener)
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
    stepPayload()

    if (rcActive && rc) {
      lensPose(flight,lens)
      host.camera.position.copy(lens.pos)
      host.camera.rotation.set(lens.pitch,lens.yaw,0,'YXZ')
      host.camera.updateMatrixWorld()
      rc.update(telemetry(flight),!!recording)
      if (flight.phase === 'returning' && entry) entry.textContent = '返航中'
      chaseView()
    } else if (placed) {
      const d = host.walker()?.active
        ? host.walker()!.position.distanceTo(flight.pos)
        : host.camera.position.distanceTo(flight.pos)
      showHint(`${flight.spec.short} 就位 · ${flight.battery.toFixed(0)}% 电量 · 点「飞无人机」起飞${d > 60 ? '（离得有点远）' : ''}`)
      chaseView()
    }
  }

  // Test hook (screenshots): a third-person chase camera instead of the gimbal view.
  let chase:{distance:number; height:number; side:number}|null = null
  function chaseView() {
    if (!chase || !flight) return
    const back = new THREE.Vector3(Math.sin(flight.yaw),0,Math.cos(flight.yaw))
    const right = new THREE.Vector3(Math.cos(flight.yaw),0,-Math.sin(flight.yaw))
    host.camera.position.copy(flight.pos).addScaledVector(back,chase.distance).addScaledVector(right,chase.side).add(new THREE.Vector3(0,chase.height,0))
    host.camera.lookAt(flight.pos.x,flight.pos.y - chase.height * .25,flight.pos.z)
    host.camera.updateMatrixWorld()
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
    debugChase: view => { chase = view; chaseView() },
    debugState: () => ({placed,rc:rcActive,load:loadKind,mesh:mesh?.root.name ?? null,
      model:mesh ? {source:mesh.root.userData.source ?? 'procedural',props:mesh.props.map(node => node.name),gimbal:mesh.gimbal.name,lens:mesh.lens.name,gear:mesh.gear?.name ?? null,cargoBox:mesh.root.getObjectByName('cargo_box')?.visible ?? null} : null,
      payload:payload ? {kind:loadKind,parts:payload.rig.children.length,figure:payload.rig.children.some(node => node.userData.dronePayloadFigure)} : null,flight:flight ? telemetry(flight) : null,recording:!!recording}),
  }
  if (typeof window !== 'undefined') { window.droneDebug = api.debugState; window.droneStep = api.debugStep; window.droneChase = api.debugChase }
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
    droneChase?:(view:{distance:number; height:number; side:number}|null) => void
    lastDronePhoto?:{name:string;bytes:number;width:number;height:number;drone:string|null}
    lastDroneClip?:{name:string;container:string;mime:string;seconds:number;width:number;height:number;fps:number}
  }
}
