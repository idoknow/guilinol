import * as THREE from 'three'
import type {Host} from '../play/host'
import './drone.css'
import {DRONE_IDS, drone, type DroneId} from './specs'
import {buildDroneAsync, disposeDrone, spinProps, type DroneMesh} from './models'
import {createFlight, cancelReturn, landNow, lensPose, liftOff, requestHome, stepFlight, telemetry, type Flight, type Sticks} from './flight'
import {PilotInput, type DroneAction} from './input'
import {createRc, type RcView} from './rc-ui'
import {createNav, type NavMark, type NavTarget, type NavView} from './radar'
import {createRoute, type RouteView} from './route'
import {addWear, batteryOf, chargeFleet, clearDamage, damageOf, DAMAGE_INTEGRITY, healthSnapshot, integrityOf, raiseDamage, resetHealth, setBattery, stateOf, type DamageCause} from './health'
import {recordingProblem, startRecording, saveRecording, type Recording} from '../gear/video'

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
  /** IDOK-529: reset the hangar records (battery + damage) between test runs. */
  debugReset?():void
  debugCrash?(cause?:DamageCause):boolean
  debugRepair?(seconds:number):number|null
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

export function droneMode(host:Host, deps:{
  groundAt:(x:number,z:number)=>number
  name:()=>string
  spots?:()=>NavTarget[]
  /** IDOK-529: solid-world probe for 自动避障 and for spotting a crash into a building. */
  blockedAt?:(x:number,y:number,z:number)=>boolean
  /** IDOK-529: 桂林的天气 —— 淋雨会把机身泡坏。 */
  raining?:()=>boolean
  /** IDOK-529: 水面高度（没有水就是 null），落水直接报废。 */
  waterY?:(x:number,z:number)=>number|null
}):DroneMode {
  const input = new PilotInput()
  let placed:DroneId|null = null
  let mesh:DroneMesh|null = null
  let flight:Flight|null = null
  let rc:RcView|null = null
  // IDOK-527: 空中导航 —— 小地图/雷达（radar.ts）+ 目标循环 + 自动飞。
  let nav:NavView|null = null
  let navSpots:NavTarget[] = []
  let navIndex = 0
  let navAuto = false
  // IDOK-529: 避障开关、损坏/维修状态、返航路线、寻找损坏机的信标。
  let avoidance = true
  let obstacle = 0
  let repairTimer = 0
  /** IDOK-530: 机内进水量（%）。下雨慢慢渗、贴水面猛灌，满了才算坏 —— 不是淋一下就报废。 */
  let moisture = 0
  /** 撞击连击冷却，避免同一堵墙每帧扣一次完整度。 */
  let hitCooldown = 0
  /** 四面障碍距离（米），避障红边用它画。 */
  const near = {front:Infinity,back:Infinity,left:Infinity,right:Infinity}
  /** IDOK-530: 云台不再跟着滑块瞬移，滑到目标值再慢慢追（灵敏度调低）。 */
  let gimbalTarget = 0
  /** IDOK-530: 地图上手动点的导航点。 */
  let customTarget:NavTarget|null = null
  /** 上一帧机身是否已经在实体里 —— 只有「刚撞上」才算事故（IDOK-529）。 */
  let wasBlocked = false
  let route:RouteView|null = null
  let beacon:THREE.Group|null = null
  let repairButton:HTMLButtonElement|null = null
  let findHint = ''
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
      <p class="drone-foot">选一台放到身前；放好后点物品栏的遥控器进遥控画面（键盘 5）。键盘：WASD 平移，↑↓ 升降，←→ 转向，R 返航，P 拍照，V 录像。</p>
    </div>`
  document.body.append(mask)
  const grid = mask.querySelector<HTMLElement>('.drone-grid')!
  mask.querySelector<HTMLButtonElement>('.about-close')!.onclick = () => closeHangar()
  mask.addEventListener('pointerdown',event => { if (event.target === mask) closeHangar() })

  // 载重：重量是唯一标准。货重可调，货/人/车都只在「不超过该机型载荷」时可选。
  function payloadOf(id:DroneId|null):number { return id ? drone(id).payloadG ?? 0 : 0 }
  /** IDOK-529: what the hangar card shows — parked battery plus any damage the airframe took. */
  function stateFor(id:DroneId) {
    const state = stateOf(id)
    return {battery:state.battery,charging:state.charging,damage:state.damage,integrity:state.integrity}
  }
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
      const health = stateFor(id)
      const broken = health.damage
      const battery = Math.round(health.battery)
      // IDOK-530: 损坏的机身也要看得到电量 —— 修好之后能飞多久是选它的关键。
      const state = `<span class="drone-batt${battery < 20 ? ' is-low' : ''}${health.charging && battery < 100 ? ' is-charging' : ''}"><i style="width:${battery}%"></i><b>${battery}%${health.charging && battery < 100 ? ' 充电中' : ''}</b></span>`
      // IDOK-530: 完整度没满时要看得见 —— 撞过但还没坏的机身会带着伤留在机库里。
      const wear = !broken && health.integrity < 99.5
        ? `<span class="drone-wear${health.integrity < 45 ? ' is-low' : ''}">完整度 ${Math.round(health.integrity)}%</span>`
        : ''
      const cta = broken ? '寻找无人机' : isOut ? '召回' : '放到身前'
      return `<button class="drone-card${isOut ? ' out' : ''}${broken ? ' broken' : ''}" data-drone="${id}" type="button">
        <span class="drone-name">${spec.name}</span>
        <span class="drone-tag">${spec.tagline}</span>
        ${state}
        ${broken ? `<span class="drone-damage">${broken.cause}损坏</span>` : ''}
        ${wear}
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
        <span class="drone-cta">${cta}</span>
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
    // IDOK-526: the hangar is reachable from inside the RC screen too — leaving the session first,
    // otherwise the mask renders under a panel that owns the pointer layer.
    if (rcActive) exitRc()
    renderHangar()
    mask.hidden = false
    requestAnimationFrame(() => mask.classList.add('show'))
  }
  function closeHangar() {
    mask.classList.remove('show')
    setTimeout(() => { if (!mask.classList.contains('show')) mask.hidden = true },220)
  }

  async function choose(id:DroneId) {
    if (placing) return
    // IDOK-529: 损坏的飞机不能拿出去飞 —— 卡片变成「寻找无人机」，先把人带到残骸跟前。
    const damage = damageOf(id)
    if (damage) {
      closeHangar()
      seekWreck(id)
      return
    }
    if (rcActive) exitRc()
    if (placed === id) { recall(); closeHangar(); return }
    await place(id)
    closeHangar()
  }

  async function place(id:DroneId) {
    if(document.body.dataset.helicopter)return
    if (placing) return
    if (damageOf(id)) {
      window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text:`${drone(id).short} 还损坏着，先修好再飞`,ms:3200}}))
      return
    }
    placing = true
    try {
      // IDOK-529: 换机 = 旧机回仓充电，新机带上自己在仓库里攒下的电量。
      recall()
      const built = await buildDroneAsync(id)
      mesh = built
      placed = id
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
      wasBlocked = false
      flight.load = loadGrams()
      flight.battery = batteryOf(id)
      setBattery(id,flight.battery,false)
      built.root.position.set(x,y,z)
      built.root.rotation.y = yaw
      showHint(`已放置 ${spec.short} · ${flight.battery.toFixed(0)}% 电量 · 点物品栏的遥控器进遥控画面`)
      refreshDock()
      notifySlot()
    } finally {
      placing = false
    }
  }

  function recall() {
    if (rcActive) exitRc()
    // IDOK-529: 回仓的飞机开始充电，电量留在仓库里。
    if (placed && flight) setBattery(placed,flight.battery,true)
    if (mesh) { disposeDrone(mesh); mesh = null }
    detachLoad()
    flight = null
    placed = null
    hideHint()
    refreshDock()
    notifySlot()
  }

  function showHint(text:string) {
    if (!hint) { hint = document.createElement('div'); hint.className = 'drone-hint'; document.body.append(hint) }
    hint.textContent = text
    hint.hidden = false
  }
  function hideHint() { if (hint) hint.hidden = true }

  // --- 损坏 / 维修 / 寻找（IDOK-529）
  // A crashed airframe stays in the world as a wreck: the hangar card turns into 「寻找无人机」,
  // the pilot walks up to it, holds 维修 for 30 s and the fleet gets the aircraft back.
  let wreck:{id:DroneId; pos:THREE.Vector3; mesh:DroneMesh; cause:DamageCause}|null = null

  function crash(cause:DamageCause) {
    if (!flight || !mesh || !placed) return
    const id = placed
    const at = flight.pos.clone()
    raiseDamage(id,cause,{x:at.x,y:at.y,z:at.z})
    if (rcActive) exitRc()
    const wreckMesh = mesh
    wreckMesh.root.position.y = deps.groundAt(at.x,at.z) + drone(id).height * .32
    wreckMesh.root.rotation.set(cause === '落水' ? 0 : .35,wreckMesh.root.rotation.y,1.15)
    wreck = {id,pos:wreckMesh.root.position.clone(),mesh:wreckMesh,cause}
    mesh = null
    flight = null
    placed = null
    hideHint()
    refreshDock()
    notifySlot()
    window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text:`${drone(id).short} ${cause}损坏，走近它点击维修`,ms:5200}}))
  }

  function seekWreck(id:DroneId) {
    const damage = damageOf(id)
    if (!damage) return
    if (!wreck || wreck.id !== id) {
      // Reloaded session: rebuild the wreck where it fell so the pilot can still walk there.
      void buildDroneAsync(id).then(built => {
        if (wreck) return
        host.scene.add(built.root)
        built.root.position.set(damage.x,deps.groundAt(damage.x,damage.z) + drone(id).height * .32,damage.z)
        built.root.rotation.set(.35,0,1.15)
        wreck = {id,pos:built.root.position.clone(),mesh:built,cause:damage.cause}
        showBeacon(wreck.pos)
      })
    } else showBeacon(wreck.pos)
    findHint = `${drone(id).short} 损坏在 ${spotText(damage.x,damage.z)}`
    updateRepairButton()
    window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text:`跟着绿色光柱去修 ${drone(id).short}`,ms:3600}}))
  }

  function spotText(x:number,z:number) {
    const walker = host.walker()
    const from = walker?.active ? walker.position : host.camera.position
    const dx = x - from.x
    const dz = z - from.z
    const dist = Math.hypot(dx,dz)
    const bearing = (Math.atan2(dx,-dz) * 180 / Math.PI + 360) % 360
    const names = ['北','东北','东','东南','南','西南','西','西北']
    const dir = names[Math.round(bearing / 45) % 8]
    return `${dist.toFixed(0)} m ${dir}`
  }

  function showBeacon(at:THREE.Vector3) {
    hideBeacon()
    const group = new THREE.Group()
    group.name = 'drone-wreck-beacon'
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(.5,.9,26,12,1,true),
      new THREE.MeshBasicMaterial({color:0x3ddc84,transparent:true,opacity:.22,depthWrite:false,side:THREE.DoubleSide}),
    )
    column.position.y = 13
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.4,2.2,24),
      new THREE.MeshBasicMaterial({color:0x3ddc84,transparent:true,opacity:.75,depthWrite:false,side:THREE.DoubleSide}),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = .12
    ring.name = 'ring'
    group.add(column,ring)
    group.position.copy(at)
    host.scene.add(group)
    beacon = group
  }
  function hideBeacon() {
    if (!beacon) return
    host.scene.remove(beacon)
    beacon.traverse(node => {
      const mesh = node as THREE.Mesh
      mesh.geometry?.dispose?.()
      const material = mesh.material as THREE.Material | undefined
      material?.dispose?.()
    })
    beacon = null
  }

  function updateRepairButton() {
    if (!wreck) { repairButton?.remove(); repairButton = null; return }
    const walker = host.walker()
    const from = walker?.active ? walker.position : host.camera.position
    const near = Math.hypot(wreck.pos.x - from.x,wreck.pos.z - from.z) < 7
    // IDOK-530: 走开就立刻打断 —— 人跑了，手上那把螺丝刀也得停。
    if (repairTimer > 0 && !near) {
      repairTimer = 0
      walker?.hold?.(false)
      window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text:'离得太远，维修中断了',ms:3200}}))
    }
    if (!near && repairTimer <= 0) { repairButton?.remove(); repairButton = null; return }
    if (!repairButton) {
      repairButton = document.createElement('button')
      repairButton.className = 'drone-repair'
      repairButton.type = 'button'
      repairButton.onclick = () => {
        if (repairTimer > 0) {
          repairTimer = 0
          host.walker()?.hold?.(false)
          paintRepair()
          return
        }
        repairTimer = 30
        // 维修中不能走：按住 walker 的操控，进度条才站得住。
        host.walker()?.hold?.(true)
        paintRepair()
      }
      document.body.append(repairButton)
    }
    paintRepair()
  }

  function paintRepair() {
    if (!repairButton || !wreck) return
    const running = repairTimer > 0
    repairButton.classList.toggle('on',running)
    const left = Math.max(0,repairTimer)
    const pct = Math.min(100,Math.max(0,(30 - left) / 30 * 100))
    repairButton.innerHTML = running
      ? `<b>维修中 ${left.toFixed(1)}s</b><i><u style="width:${pct.toFixed(1)}%"></u></i><span>走开就会中断 · 再点暂停</span>`
      : `<b>维修 ${wreck.cause}损坏的${drone(wreck.id).short}</b><i><u style="width:0%"></u></i><span>站在机身旁边点这里，需要 30 秒</span>`
  }

  function stepRepair(dt:number) {
    if (beacon) {
      const ring = beacon.getObjectByName('ring')
      if (ring) ring.scale.setScalar(1 + Math.sin(performance.now() / 320) * .18)
    }
    if (!wreck) return
    if (findHint) {
      const damage = damageOf(wreck.id)
      if (damage) {
        showHint(`修复点 · ${spotText(damage.x,damage.z)}`)
      }
    }
    updateRepairButton()
    if (repairTimer <= 0) return
    repairTimer -= dt
    paintRepair()
    if (repairTimer > 0) return
    // 30 秒到：机身修好，仓库里可以重新取用。
    repairTimer = 0
    const id = wreck.id
    disposeDrone(wreck.mesh)
    wreck = null
    hideBeacon()
    findHint = ''
    hideHint()
    repairButton?.remove()
    repairButton = null
    clearDamage(id,Math.max(35,batteryOf(id)))
    renderHangar()
    notifySlot()
    window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text:`${drone(id).short} 维修完成，机库可以重新取用`,ms:4200}}))
  }

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
  let placing = false
  let ownsPhotoFlag = false
  let lookYaw = 0
  let lookPitch = 0
  let savedCamera:{pos:THREE.Vector3; quat:THREE.Quaternion; fov:number}|null = null

  /** IDOK-526: tell the hotbar whether the 遥控器 slot should be offered. */
  function notifySlot() {
    window.dispatchEvent(new CustomEvent('drone:slot', {detail: {placed: !!placed, rc: rcActive}}))
  }

  function enterRc() {
    if(document.body.dataset.helicopter)return
    if (!flight || rcActive) return
    if (flight.phase !== 'landed') return
    // IDOK-529: 坏了或没电的飞机飞不了 —— 先在机库里看电量、走近残骸修好它。
    const damage = damageOf(flight.spec.id)
    if (damage) {
      window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text:`${drone(flight.spec.id).short} ${damage.cause}损坏，先维修`,ms:3600}}))
      return
    }
    if (flight.battery < 10) {
      window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text:`电量 ${flight.battery.toFixed(0)}%，回仓充电一会再飞`,ms:3600}}))
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
    lookYaw = 0
    lookPitch = 0
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
    // IDOK-589: 上一趟下机时如果摇杆没回中（手指滑出垫子、pointercancel 丢了），
    // 或者 W 还按着，这些残留会让新起的飞机「自己往某个方向飞」。进遥控一律先归零。
    input.reset()
    near.front = near.back = near.left = near.right = Infinity
    obstacle = 0
    wasBlocked = false
    // IDOK-527: 进场时挑最近的三处景点当导航目标，再算一次就够，飞起来目标不会乱跳。
    const spots = deps.spots?.() ?? []
    navSpots = [...spots]
      .sort((a,b) => Math.hypot(a.x - flight!.pos.x,a.z - flight!.pos.z) - Math.hypot(b.x - flight!.pos.x,b.z - flight!.pos.z))
      .slice(0,3)
    navIndex = 0
    navAuto = false
    // IDOK-530: 云台目标角度从当前姿态起步，滑块只在后面慢慢追。
    gimbalTarget = flight.gimbal
    customTarget = null
    moisture = 0
    hitCooldown = 0
    rc = createRc(flight.spec,{
      takeoff:() => { if (!flight) return; if (flight.phase === 'landed') liftOff(flight); else landNow(flight) },
      land:() => { if (flight) landNow(flight) },
      rth:() => { if (flight) { requestHome(flight); rc?.toast('自动返航') } },
      // IDOK-530: 取消返航 —— 返航途中想自己飞，按一下就把控制权收回来。
      cancel:() => { if (flight && cancelReturn(flight)) rc?.toast('已取消返航 · 手动悬停') },
      photo:() => void snapshot(),
      record:() => void toggleRecord(),
      exit:() => exitRc(),
      gimbal:deg => { gimbalTarget = deg },
      sticks:patch => input.setTouch(patch),
      hangar:() => { exitRc(); openHangar() },
      avoid:(on:boolean) => {
        avoidance = on
        rc?.setAvoid(avoidance,obstacle > 0)
        rc?.toast(on ? '避障已打开' : '避障已关闭')
      },
      look:(dx,dy) => {
        // 傻瓜式向：镜头跟手转，左右不限，上下收在 ±1.1 rad 以内免得翻过去。
        lookYaw -= dx
        lookPitch = THREE.MathUtils.clamp(lookPitch - dy,-1.1,1.1)
      },
    })
    document.body.append(rc.root)
    // IDOK-527: 导航盘挂在遥控器里，退出遥控时随 rc.root 一起摘掉。
    nav = createNav(flight.spec,{cycle:() => cycleTarget(),auto:() => toggleAuto(),pick:(x,z) => pickSpot(x,z)})
    rc.root.append(nav.root)
    liftOff(flight)
    refreshDock()
    notifySlot()
  }

  function exitRc() {
    if (!rcActive) return
    rcActive = false
    input.enabled = false
    input.detach()
    if (recording) { void stopRecord() }
    rc?.root.remove()
    rc = null
    nav = null
    navAuto = false
    navIndex = 0
    customTarget = null
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
    notifySlot()
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
      const problem = recordingProblem(result) ?? '录像保存失败'
      window.lastDroneClipProblem = problem
      rc.toast(problem)
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
    // IDOK-529: 工具里的入口永远是「无人机机库」——「飞无人机」会让玩家在驾驶时点不动它，换不了机。
    entry.textContent = '无人机'
    entry.dataset.stage = rcActive ? 'rc' : placed ? 'ready' : 'none'
    entry.setAttribute('aria-label',rcActive ? '遥控中（点开查看机库）' : '无人机机库')
  }
  function mountEntry(host_:HTMLElement) {
    if (entry) return
    entry = document.createElement('button')
    entry.className = 'dock-drone'
    entry.type = 'button'
    entry.onclick = () => {
      if (rcActive) return
      openHangar()
    }
    host_.append(entry)
    refreshDock()
  }

  // --- 空中导航（IDOK-527）
  /** 目标表：地图上手动点的自选点排最前，然后机库、飞行员站位、进场时最近的三处景点。 */
  function navTargets():NavTarget[] {
    const list:NavTarget[] = []
    if (!flight) return list
    if (customTarget) list.push(customTarget)
    list.push({label:'机库',x:flight.home.x,z:flight.home.z})
    const walker = host.walker()
    if (walker?.active) list.push({label:'我',x:walker.position.x,z:walker.position.z})
    list.push(...navSpots)
    return list
  }

  /** IDOK-530: 在地图上点一个点 → 直接变成导航目标（空中就顺手开始自动飞过去）。 */
  function pickSpot(x:number, z:number) {
    const walker = host.walker()
    const from = walker?.active ? walker.position : host.camera.position
    const dist = Math.hypot(x - from.x,z - from.z)
    // 别把点选在城里太离谱的地方：离自己 2 km 以上就按 2 km 收一下，免得飞到世界外面。
    const scale = dist > 2000 ? 2000 / dist : 1
    customTarget = {label:'自选点',x:from.x + (x - from.x) * scale,z:from.z + (z - from.z) * scale,picked:true}
    navIndex = 0
    rc?.toast('导航目标 · 自选点')
    if (flight && flight.phase !== 'landed') navAuto = true
  }

  function currentTarget():NavTarget|null {
    const list = navTargets()
    if (!list.length) return null
    return list[Math.min(navIndex,list.length - 1)] ?? null
  }

  function cycleTarget() {
    const list = navTargets()
    if (!list.length) return
    navIndex = (navIndex + 1) % list.length
    const target = currentTarget()
    if (target) rc?.toast(`导航目标 · ${target.label}`)
  }

  function toggleAuto() {
    if (!flight || flight.phase === 'landed') { rc?.toast('先起飞，再自动飞'); return }
    const target = currentTarget()
    if (!target) { rc?.toast('没有可选目标'); return }
    navAuto = !navAuto
    rc?.toast(navAuto ? `自动飞往 ${target.label} · 推摇杆可接管` : '自动导航已关闭')
  }

  /** 场景里的其它飞行物：带 userData.aircraft 的对象（观光直升机、以后可能加的飞机/鸟群）。 */
  function sceneAircraft():THREE.Object3D[] {
    const list:THREE.Object3D[] = []
    host.scene.traverse(node => {
      const label = node.userData?.aircraft
      if (typeof label !== 'string' || !label) return
      // 只收最外层那一个：螺旋桨、机身这些零件的父级已经报过点了；自己这架不算「附近」。
      if (node.parent?.userData?.aircraft) return
      if (mesh && (node === mesh.root || node === loadMesh)) return
      list.push(node)
    })
    return list
  }

  /** 导航盘的测试快照：目标、自动飞、盘面点数，以及到目标的水平距离。 */
  function navSnapshot() {
    if (!flight) return null
    const target = currentTarget()
    return {
      target,auto:navAuto,index:navIndex,spots:navSpots.length,marks:navMarks().length,
      radar:flight.spec.id === 'fpv',
      dist:target ? Math.hypot(target.x - flight.pos.x,target.z - flight.pos.z) : null,
      // 给套件/调试看的转向量：当前 yaw 与目标方位差（正=该往右/东转）。
      yaw:flight.yaw,
      turn:target ? Math.atan2(Math.sin(Math.atan2(target.x - flight.pos.x,-(target.z - flight.pos.z)) - flight.yaw),
        Math.cos(Math.atan2(target.x - flight.pos.x,-(target.z - flight.pos.z)) - flight.yaw)) : null,
    }
  }

  /** 小地图上的点：自己、机库、飞行员、附近所有飞行物（直升机/飞机…），以及所有景点。 */
  function navMarks():NavMark[] {
    const marks:NavMark[] = []
    if (!flight) return marks
    marks.push({kind:'home',label:'机库',x:flight.home.x,z:flight.home.z})
    const walker = host.walker()
    if (walker?.active) marks.push({kind:'player',label:'玩家',x:walker.position.x,z:walker.position.z})
    for (const node of sceneAircraft()) {
      const agl = node.position.y - deps.groundAt(node.position.x,node.position.z)
      marks.push({kind:'air',label:String(node.userData.aircraft),x:node.position.x,z:node.position.z,agl})
    }
    for (const spot of navSpots) marks.push({kind:'spot',label:spot.label,x:spot.x,z:spot.z})
    return marks
  }

  /** 自动飞的摇杆解：先把机头转向目标，再按距离给俯仰，高度锁在 30 m。 */
  function autoSticks(target:NavTarget):Sticks {
    const drone = flight!
    const dx = target.x - drone.pos.x
    const dz = target.z - drone.pos.z
    const dist = Math.hypot(dx,dz)
    // 机头前进向量是 (-sin yaw, -cos yaw)，所以「自正北顺时针」的方位角 = -yaw。
    let err = -Math.atan2(dx,-dz) - drone.yaw
    while (err > Math.PI) err -= Math.PI * 2
    while (err < -Math.PI) err += Math.PI * 2
    return {
      // 摇杆向右（正）是 yaw 变小，所以这里取 -err，否则会越转越偏、绕圈飞走。
      yaw: THREE.MathUtils.clamp(-err * 1.8,-1,1),
      throttle: THREE.MathUtils.clamp((30 - drone.agl) * .08,-.55,.6),
      pitch: Math.abs(err) > 1.1 ? .12 : dist > 14 ? .6 : .18,
      roll: 0,
    }
  }

  /**
   * IDOK-529: 自动避障。探三条前方射线（2.5 / 5 / 9 m），撞上实体就把俯仰/横滚按距离收回来；
   * 上升时也看头顶，免得顶进牌楼或屋檐。返回收窄后的杆量，剩余交给飞行模型。
   * IDOK-530: 2.2 m 内直接锁死前进（推到底也撞不上去），侧面贴太近时把横滚也归零。
   */
  function avoidSticks(sticks:Sticks):Sticks {
    if (!flight || !deps.blockedAt) return sticks
    const fwd = new THREE.Vector3(-Math.sin(flight.yaw),0,-Math.cos(flight.yaw))
    let hit = 0
    for (const step of [2.5,5,9]) {
      if (deps.blockedAt(flight.pos.x + fwd.x * step,flight.pos.y,flight.pos.z + fwd.z * step)) { hit = step; break }
    }
    // 贴脸时把机身侧滑也压住：右边是墙就别再往右滚
    let roll = sticks.roll
    if (near.right < 1.6 && roll > 0) roll = 0
    if (near.left < 1.6 && roll < 0) roll = 0
    if (!hit) {
      obstacle = 0
      if (sticks.throttle > .1 && deps.blockedAt(flight.pos.x,flight.pos.y + 3,flight.pos.z)) {
        return {...sticks,roll,throttle:Math.min(0,sticks.throttle)}
      }
      return roll === sticks.roll ? sticks : {...sticks,roll}
    }
    obstacle = hit
    // IDOK-589: 避障只压制飞行员已经在推的那根杆，绝不自己给速度。
    // 以前贴脸（≤3 m）时无条件 `pitch:-.18` + 偏航减半，飞机贴墙悬停时会自己倒着飞、自己慢慢转，
    // 用户看到的就是「起飞后自己乱动」。现在前进推不动、后退完全不拦、偏航按原样。
    if (hit <= 3) return {throttle:sticks.throttle,yaw:sticks.yaw,pitch:Math.min(0,sticks.pitch),roll}
    const damping = THREE.MathUtils.clamp(hit / 9,.12,.75)
    return {
      throttle:sticks.throttle,
      yaw:sticks.yaw,
      pitch:sticks.pitch > 0 ? sticks.pitch * damping : sticks.pitch,
      // 侧滑是绕开障碍的主要手段，只按 near 挡，不做额外衰减。
      roll,
    }
  }

  /**
   * IDOK-530: 某一方向 1..8 m 内最近的实体距离（Infinity = 空）。
   * 避障红边和「贴脸锁死」都靠它，所以顺路把四面距离缓存到 `near`。
   */
  function probe(x:number,z:number):number {
    if (!flight || !deps.blockedAt) return Infinity
    for (let step = 1; step <= 8; step += 1) {
      if (deps.blockedAt(flight.pos.x + x * step,flight.pos.y,flight.pos.z + z * step)) return step
    }
    return Infinity
  }

  function scanNear() {
    if (!flight) return
    const fx = -Math.sin(flight.yaw)
    const fz = -Math.cos(flight.yaw)
    const rx = -fz
    const rz = fx
    near.front = probe(fx,fz)
    near.back = probe(-fx,-fz)
    near.left = probe(-rx,-rz)
    near.right = probe(rx,rz)
  }

  // --- Frame
  function advance(dt:number) {
    // IDOK-529: 仓库里的飞机一直在慢充；残骸的维修进度、信标和「维修」按钮也走这一层。
    chargeFleet(dt)
    stepRepair(dt)
    if (!flight || !mesh) return
    const gnd = (x:number,z:number) => deps.groundAt(x,z)
    // IDOK-527: 自动飞在这一层接管摇杆；只要飞行员自己推了摇杆就立刻交还控制权。
    const manual = input.read()
    let sticks:Sticks = manual
    if (navAuto && flight.phase !== 'landed') {
      const target = currentTarget()
      const push = Math.abs(manual.throttle) + Math.abs(manual.yaw) + Math.abs(manual.pitch) + Math.abs(manual.roll)
      if (!target) navAuto = false
      else if (push > .35) { navAuto = false; rc?.toast('手动接管 · 自动导航已退出') }
      else if (Math.hypot(target.x - flight.pos.x,target.z - flight.pos.z) < 10) {
        navAuto = false
        rc?.toast(`已到达 ${target.label}`)
      } else sticks = autoSticks(target)
    }
    scanNear()
    if (avoidance && flight.phase !== 'landed') sticks = avoidSticks(sticks)
    if (flight.phase !== 'landed') stepFlight(flight,Math.min(dt,.1),sticks,gnd)
    else stepFlight(flight,Math.min(dt,.1),{throttle:0,yaw:manual.yaw * .4,pitch:0,roll:0},gnd)
    // IDOK-529: 电量跟着飞行走，仓库卡片才看得见每台飞机还剩多少。
    setBattery(flight.spec.id,flight.battery,false)
    // IDOK-530: 撞击按力度扣完整度，扣到阈值以下才报废；进水/淋雨走累计值。
    // 撞墙只在「从通畅变成受阻」的那一帧记账：机身本来就在屋檐/牌楼的碰撞体里起飞时不该立刻炸。
    hitCooldown = Math.max(0,hitCooldown - dt)
    const speed = Math.hypot(flight.vel.x,flight.vel.y,flight.vel.z)
    const blocked = deps.blockedAt?.(flight.pos.x,flight.pos.y,flight.pos.z) ?? false
    if (blocked && !wasBlocked && speed > 3 && flight.phase !== 'takeoff' && flight.phase !== 'landing' && hitCooldown <= 0) {
      const id = flight.spec.id
      const dmg = THREE.MathUtils.clamp((speed - 2.5) * 6,5,70)
      const left = addWear(id,dmg)
      hitCooldown = .6
      if (left <= DAMAGE_INTEGRITY) { crash('撞击'); return }
      // 没到报废就先弹开：把机身推离墙面、速度清零，别继续往里钻。
      const back = new THREE.Vector3(flight.vel.x,0,flight.vel.z)
      if (back.lengthSq() > 1e-4) back.normalize()
      flight.pos.addScaledVector(back,-.6)
      flight.vel.set(0,0,0)
      wasBlocked = false
      rc?.toast(`撞击 · 完整度 ${left.toFixed(0)}%`)
    }
    wasBlocked = blocked
    const water = deps.waterY?.(flight.pos.x,flight.pos.z) ?? null
    const soaking = water !== null && flight.pos.y - flight.spec.height * .5 <= water + .25
    const raining = (deps.raining?.() ?? false) && flight.phase !== 'landed'
    if (soaking) moisture += 30 * dt
    else if (raining) moisture += 3.5 * dt
    else moisture = Math.max(0,moisture - 4 * dt)
    if (moisture >= 100) { crash(soaking ? '落水' : '淋雨'); return }
    // IDOK-530: 云台追着目标角度走，滑块和 Q/E 不再瞬间跳到位。
    flight.gimbal += THREE.MathUtils.clamp(gimbalTarget - flight.gimbal,-18 * dt,18 * dt)
    mesh.root.position.copy(flight.pos)
    mesh.root.rotation.y = flight.yaw
    const throttle = flight.phase === 'landed' ? .06 : .5 + Math.min(.5,Math.hypot(flight.vel.x,flight.vel.y,flight.vel.z) / Math.max(1,flight.spec.speed))
    spinProps(mesh,dt,throttle)
    mesh.gimbal.rotation.x = THREE.MathUtils.degToRad(flight.gimbal) * .35
    if (loadMesh) loadMesh.rotation.y = Math.sin(flight.elapsed * .7) * .04
    stepPayload()

    // IDOK-529: 返航路线 —— 绿色弧线 + 沿弧线流动的亮点，只在返航时出现。
    // IDOK-530: 光柱要落到地面（起落点在地面上），所以把机库脚下的地面高度一起传进去。
    const returning = flight.phase === 'returning'
    route ??= createRoute(host.scene)
    route.update(flight.pos,flight.home,returning,flight.elapsed,deps.groundAt(flight.home.x,flight.home.z))
    if (obstacle > 0 && rcActive) rc?.toast('避障：前方有障碍')

    if (rcActive && rc) {
      lensPose(flight,lens)
      host.camera.position.copy(lens.pos)
      // IDOK-526: the 傻瓜式 remote is the only one steered by the mouse/finger — add its look offset.
      const simple = flight.spec.rc === 'simple'
      host.camera.rotation.set(lens.pitch + (simple ? lookPitch : 0),lens.yaw + (simple ? lookYaw : 0),0,'YXZ')
      host.camera.updateMatrixWorld()
      rc.update(telemetry(flight),!!recording)
      // IDOK-527: 只有 FPV 带扫描扇面；其余机型看的是普通小地图。
      const fpvView = flight.spec.id === 'fpv'
      nav?.update({
        x:flight.pos.x,z:flight.pos.z,yaw:flight.yaw,
        marks:navMarks(),target:currentTarget(),
        // IDOK-527: 穿越机看得远（观光直升机常在 500 m 外的停机坪），普通航拍机量程收一点。
        radar:fpvView,range:fpvView ? 1000 : 400,auto:navAuto,
      })
      // IDOK-529: 返航时中间出现绿色返航条 + 距离，同时机身下面那条绿色弧线一起走。
      rc.setReturning(returning ? Math.hypot(flight.pos.x - flight.home.x,flight.pos.z - flight.home.z) : null)
      rc.setAvoid(avoidance,obstacle > 0)
      // IDOK-530: 靠近建筑的那一侧画面泛红；顶栏报完整度与进水量。
      rc.setProximity(near.front,near.back,near.left,near.right)
      rc.setHealth(integrityOf(flight.spec.id),moisture)
      chaseView()
    } else if (placed) {
      const d = host.walker()?.active
        ? host.walker()!.position.distanceTo(flight.pos)
        : host.camera.position.distanceTo(flight.pos)
      if (findHint) showHint(findHint)
      else showHint(`${flight.spec.short} 就位 · ${flight.battery.toFixed(0)}% 电量 · 点物品栏的遥控器起飞${d > 60 ? '（离得有点远）' : ''}`)
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
    if (!rcActive || !flight || event.ctrlKey || event.metaKey || event.altKey) return
    // IDOK-526: Q/E walk the gimbal up and down without taking the hands off WASD/arrows.
    // IDOK-530: 按键只推目标角度，真正的云台在 advance() 里慢慢追上去。
    if (event.code === 'KeyQ' || event.code === 'KeyE') {
      const dir = event.code === 'KeyQ' ? -1 : 1
      const {tiltMin,tiltMax} = flight.spec.gimbal
      gimbalTarget = THREE.MathUtils.clamp(gimbalTarget + dir * 1.5,tiltMin,tiltMax)
      event.preventDefault()
    }
    // IDOK-530: X 取消返航，回到手动悬停。
    if (event.code === 'KeyX') {
      if (cancelReturn(flight)) rc?.toast('已取消返航 · 手动悬停')
      event.preventDefault()
    }
    // IDOK-526: G opens the hangar mid-session (same as the 机库 button).
    if (event.code === 'KeyG') { exitRc(); openHangar(); event.preventDefault() }
    // IDOK-527: T 换导航目标、B 开关自动飞。
    if (event.code === 'KeyT') { cycleTarget(); event.preventDefault() }
    if (event.code === 'KeyB') { toggleAuto(); event.preventDefault() }
  })
  // IDOK-526: the hotbar's 遥控器 slot enters/exits the RC session.
  window.addEventListener('drone:rc',() => {
    if (rcActive) { exitRc(); return }
    if (placed && flight && flight.phase === 'landed') enterRc()
    else openHangar()
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
    // IDOK-529: 测试钩子 —— 清空仓库状态 / 让当前飞机摔下来 / 快进维修计时。
    debugReset: () => { resetHealth(); renderHangar(); notifySlot(); refreshDock() },
    debugCrash: (cause:DamageCause = '撞击') => { crash(cause); return !!wreck },
    debugRepair: (seconds:number) => {
      if (!wreck) return null
      repairTimer = Math.max(0,seconds)
      paintRepair()
      return repairTimer
    },
    debugState: () => ({placed,rc:rcActive,load:loadKind,mesh:mesh?.root.name ?? null,
      model:mesh ? {source:mesh.root.userData.source ?? 'procedural',props:mesh.props.map(node => node.name),gimbal:mesh.gimbal.name,lens:mesh.lens.name,gear:mesh.gear?.name ?? null,cargoBox:mesh.root.getObjectByName('cargo_box')?.visible ?? null} : null,
      payload:payload ? {kind:loadKind,parts:payload.rig.children.length,figure:payload.rig.children.some(node => node.userData.dronePayloadFigure)} : null,flight:flight ? telemetry(flight) : null,recording:!!recording,
      // IDOK-526: simple-mode drag look offsets, so tests can see the camera actually turned.
      look: {yaw:lookYaw,pitch:lookPitch},
      // IDOK-527: 导航盘目标/自动飞状态，套件据此断言小地图与雷达确实在更新。
      nav: navSnapshot(),
      // IDOK-529: 避障、损坏/维修、仓库电量 —— 套件与截图脚本要能看到这些状态。
      avoid: {on:avoidance, obstacle},
      wreck: wreck ? {id:wreck.id,cause:wreck.cause,x:wreck.pos.x,y:wreck.pos.y,z:wreck.pos.z,repair:Math.max(0,repairTimer)} : null,
      repair: Math.max(0,repairTimer),
      // IDOK-530: 机身完整度、进水量、四面障碍距离、云台目标角度、地图自选点。
      integrity: placed ? integrityOf(placed) : null,
      moisture,
      // Infinity 过不了 JSON，空方向报 99 m。
      proximity: {front:capMeters(near.front),back:capMeters(near.back),left:capMeters(near.left),right:capMeters(near.right)},
      gimbalTarget,
      rained: deps.raining?.() ?? false,
      picked: customTarget ? {x:customTarget.x,z:customTarget.z} : null,
      rain: moisture,
      // IDOK-529: 返航航线是否画在场景里（绿色弧线 + 流动光点）。
      route: {active: !!route?.root.visible, points: route?.root.children.length ?? 0},
      health: healthSnapshot()}),
  }
  if (typeof window !== 'undefined') {
    window.droneDebug = api.debugState
    window.droneStep = api.debugStep
    window.droneChase = api.debugChase
    // IDOK-527: 截图/核对脚本用一步到位的放置+起飞，省掉点机库那一串点击。
    window.droneStart = api.debugStart
    // IDOK-529: 仓库状态与损坏/维修的测试钩子。
    window.droneReset = api.debugReset
    window.droneCrash = api.debugCrash
    window.droneRepair = api.debugRepair
    // IDOK-530: 截图脚本直接开库（加载遮罩会吞掉合成点击，只能走这个口子）。
    window.droneOpen = () => openHangar()
  }
  return api
}

/** IDOK-530: 障碍距离过不了 JSON（Infinity），空方向的 99 m 只给调试/套件看。 */
function capMeters(meters:number) {
  return Number.isFinite(meters) ? Math.round(meters * 10) / 10 : 99
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
    droneStart?:(id:DroneId) => Promise<void>
    droneReset?:() => void
    droneCrash?:(cause?:DamageCause) => boolean
    droneRepair?:(seconds:number) => number|null
    droneOpen?:() => void
    droneChase?:(view:{distance:number; height:number; side:number}|null) => void
    lastDronePhoto?:{name:string;bytes:number;width:number;height:number;drone:string|null}
    lastDroneClip?:{name:string;container:string;mime:string;seconds:number;width:number;height:number;fps:number}
    lastDroneClipProblem?:string
  }
}
