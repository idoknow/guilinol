/**
 * 联机客户端（M1）：连接 /ws，上报自己位置，画其他玩家，左上角在线人数。
 *
 * 头顶名字：纯 DOM，每帧把「头顶 3D 坐标」投影到屏幕，用 CSS 做白字黑描边、无背景。
 * 不用 Sprite / CanvasTexture（会牵涉着色器，之前导致过 useProgram 报错）。
 */
import * as THREE from 'three'
import {CSS2DObject, CSS2DRenderer} from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import {createFigure, readAvatar, type Figure} from './walk/figure'
import {packState, unpackState} from './net-pack'
import {defaultAvatar, sanitizeAvatar, type Avatar} from '../../lib/avatar'
import {createBike} from './walk/qingju-bike'
import {showBanScreen} from './ui/civic'
import {SmokeKit} from './smoke/kit'
import {createSmokePlume, type SmokePlume} from './smoke/models'
import {RemoteSmoke, type SmokeView} from './smoke/session'
import {SMOKE_ANCHORS} from './smoke/anchors'

type Vec = {
  x: number; y: number; z: number; yaw: number; v: number; bike: string
  bx: number; bz: number; byaw: number
  /** 抽烟状态：0 没抽 / 1 点烟 / 2 抽着；sb=剩余可燃时间×10；sp=吸了几口的计数；br=品牌序号 */
  sc?: number; sb?: number; sp?: number; br?: number
}

interface Peer extends Vec {
  id: string
  name: string
  mesh: THREE.Group
  label: CSS2DObject
  model: Figure | null
  prev: THREE.Vector3
  speed: number
  bikeRoot: THREE.Group | null
  bx: number
  bz: number
  byaw: number
  /** 对方身边站着的那辆车（hb=1 时有效），比如手机叫来的 */
  hb: number
  hx: number
  hz: number
  hyaw: number
  /** 1 = 蹲着 */
  cr: number
  /** 1 = 着地，0 = 在空中 */
  gr: number
  /** 1 = 在动，0 = 停下，-1 = 对方没上报（老版本） */
  mv: number
  /** 1 = 倒地 */
  dn: number
  /** 上一帧是不是已经倒地（用来只发一次击倒提示） */
  wasDown: boolean
  /** 上次建模用的外形指纹（避免重复重建） */
  avatarKey?: string
  /** 1 = 正在出拳 */
  pn: number
  /** 翘头 0..1（对应 0..30°） */
  wl: number
  /** 对方血量 0..100（出手方靠它看到自己打掉了多少） */
  hp: number
  /** 头顶血条上一次画出来的值，避免每帧写 DOM */
  shownHp: number
  /** 头顶血条元素 */
  hpRow: HTMLElement | null
  hpFill: HTMLElement | null
  /** 抽烟：远端状态机 + 三维道具 + 烟雾 */
  smoke: RemoteSmoke
  kit: SmokeKit | null
  plume: SmokePlume | null
  /** 这一口大烟已经喷过了（避免连续几帧重复喷） */
  puffBurst: boolean
  target: THREE.Vector3
  targetYaw: number
  lastSeen: number
}

const PALETTE = [0x2fd6a6, 0xffb347, 0x7aa2ff, 0xff8fa3, 0xffe166, 0x9b8cff]
const HEAD_OFFSET = 2.05

export interface NetHandle {
  tick(self: {x: number; y: number; z: number; yaw: number; v: number; mv?: number; bike: string; bx?: number; bz?: number; byaw?: number; hb?: number; hx?: number; hz?: number; hyaw?: number; cr?: number; gr?: number; dn?: number; pn?: number; wl?: number; hp?: number; sc?: number; sb?: number; sp?: number; br?: number}, dtMs: number): void
  dispose(): void
  /** 手动重连（徽标点一下就会调它） */
  retry(): void
  /** 出拳：打到面前最近的人就发 hit；没打到返回 null */
  punch?(): HitResult | null
  /** 扶起附近倒地的人；扶到了返回名字 */
  reviveNearest?(): string | null
  /** 自己被人打（damage / 出手者昵称 / 出手者 peer id） */
  onHit?(handler: (damage: number, by?: string, byId?: string) => void): void
  /** 自己被人扶起 */
  onRevive?(handler: (by?: string) => void): void
  /** 自己刚才打的那个人被打倒了（给出手方一个「击倒」提示） */
  onDown?(handler: (name: string) => void): void
  /** 某个 peer 现在的世界坐标（算挨打方向用），找不到返回 null */
  peerPosition?(id: string): {x: number; y: number; z: number} | null
  readonly online: number
  readonly peers: number
  dump(): Array<{name: string; dist: number; label: string | null; pos: number[]}>
}

/** 一次出拳命中的结果：给出手方的准心提示用 */
export interface HitResult {
  id: string
  name: string
  damage: number
  distance: number
  /** 打的是蹲着的人 */
  low: boolean
}

function hash(text: string) {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0
  return h
}

export function attachNet(scene: THREE.Scene, identity: {uid: string; name: string}, camera: THREE.Camera): NetHandle {
  const state = {online: 0, ws: null as WebSocket | null, ready: false}
  const peers = new Map<string, Peer>()
  let lastSend = 0
  const lastSelf = new THREE.Vector3()
  let lastSelfTime = 0
  let selfSpeed = 0
  let rosterTimer = 0
  let attempts = 0
  let retryTimer = 0
  let closed = false
  /** 是否已经把 join（带真实坐标）发给服务器 */
  let joined = false
  /** 收到的 pos 里有多少条缺 cr：攒够就说明服务端还没更新，蹲下/倒地/受击会全线失效 */
  let missingSyncFields = 0
  let staleWarned = false

  const labelRenderer = new CSS2DRenderer()
  labelRenderer.domElement.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:60'
  document.body.append(labelRenderer.domElement)
  const resizeLabels = () => labelRenderer.setSize(window.innerWidth, window.innerHeight)
  resizeLabels()
  window.addEventListener('resize', resizeLabels)

  const badge = document.createElement('div')
  badge.id = 'net-online'
  badge.textContent = '联机中…'
  badge.style.cssText =
    'position:fixed;left:12px;top:calc(96px + env(safe-area-inset-top));z-index:45;' +
    'padding:5px 11px;border-radius:999px;background:rgba(18,26,24,.62);' +
    'border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(12px);' +
    'color:#cfe4dc;font:600 11px/1.2 system-ui;pointer-events:auto;cursor:pointer;transition:opacity .3s ease'
  document.body.append(badge)

  const setBadge = (n: number) => {
    state.online = n
    badge.textContent = `在线玩家：${n} 人`
    badge.style.opacity = n > 1 ? '1' : '.7'
  }
  /** 连接状态提示：联机不可用时不要一直显示旧的在线数 */
  const setStatus = (text: string, alpha = 0.75) => {
    badge.textContent = text
    badge.style.opacity = String(alpha)
  }

  // 白字 + 黑描边，无背景；多方向 text-shadow 模拟描边（兼容中英文）
  const labelCss =
    'position:fixed;left:0;top:0;z-index:70;pointer-events:none;white-space:nowrap;' +
    'font:700 13px/1.25 system-ui,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;' +
    'color:#ffffff;letter-spacing:.02em;' +
    'text-shadow:0 0 2px #000,1px 0 1px #000,-1px 0 1px #000,0 1px 1px #000,0 -1px 1px #000,' +
    '1px 1px 1px #000,-1px -1px 1px #000,1px -1px 1px #000,-1px 1px 1px #000;' +
    'will-change:transform;'

  const makePeer = (raw: Record<string, unknown>) => {
    const id = String(raw.id)
    if (peers.has(id)) return
    const name = String(raw.name ?? '').trim() || '游客'
    const x = Number(raw.x) || 0
    const y = Number(raw.y) || 0
    const z = Number(raw.z) || 0
    const yaw = Number(raw.yaw) || 0

    const group = new THREE.Group()
    const color = PALETTE[Math.abs(hash(id)) % PALETTE.length]
    const skin = new THREE.MeshToonMaterial({color: 0xf0d7b8})
    const cloth = new THREE.MeshToonMaterial({color})
    const pants = new THREE.MeshToonMaterial({color: 0x3c4a52})
    const shoe = new THREE.MeshToonMaterial({color: 0x22282c})
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, 0); return m }
    group.add(part(new THREE.BoxGeometry(0.34, 0.5, 0.2), cloth, 0, 1.13))
    group.add(part(new THREE.SphereGeometry(0.135, 16, 12), skin, 0, 1.58))
    group.add(part(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), skin, 0, 1.43))
    for (const side of [-1, 1]) {
      const arm = part(new THREE.CapsuleGeometry(0.045, 0.34, 4, 8), cloth, side * 0.21, 1.12)
      arm.rotation.z = side * 0.1
      group.add(arm)
      group.add(part(new THREE.SphereGeometry(0.05, 10, 8), skin, side * 0.235, 0.94))
      group.add(part(new THREE.CapsuleGeometry(0.06, 0.42, 4, 8), pants, side * 0.09, 0.5))
      group.add(part(new THREE.BoxGeometry(0.1, 0.06, 0.18), shoe, side * 0.09, 0.06))
    }
    group.position.set(x, y, z)
    scene.add(group)

    const labelEl = document.createElement('div')
    labelEl.className = 'peer-label'
    labelEl.style.cssText = labelCss
    // 名字 + 一条小血条：血条让「扣血」看得见，也让出手方能确认自己真打掉了多少
    const nameEl = document.createElement('span')
    nameEl.className = 'peer-name'
    nameEl.textContent = name
    const hpRow = document.createElement('span')
    hpRow.className = 'peer-hp'
    const hpFill = document.createElement('i')
    hpRow.append(hpFill)
    labelEl.append(nameEl, hpRow)
    const label = new CSS2DObject(labelEl)
    label.position.set(0, 2.1, 0)
    group.add(label)

    const peer: Peer = {
      id, name, x, y, z, yaw,
      v: 0,
      bike: '',
      mesh: group,
      label,
      model: null,
      prev: new THREE.Vector3(x, y, z),
      speed: 0,
      bikeRoot: null,
      bx: 0,
      bz: 0,
      byaw: 0,
      hb: 0,
      hx: 0,
      hz: 0,
      hyaw: 0,
      cr: 0,
      gr: 1,
      mv: -1,
      dn: 0,
      wasDown: false,
      pn: 0,
      wl: 0,
      hp: typeof raw.hp === 'number' ? Math.max(0, Math.min(100, raw.hp)) : 100,
      shownHp: -1,
      hpRow,
      hpFill,
      sc: 0,
      sb: 0,
      sp: 0,
      br: 0,
      smoke: new RemoteSmoke(),
      kit: null,
      plume: null,
      puffBurst: false,
      target: new THREE.Vector3(x, y, z),
      targetYaw: yaw,
      lastSeen: performance.now(),
    }
    peers.set(id, peer)
    // 远端玩家用和本地同一套角色系统：外形来自对方上报的 avatar，动作走 figure.pose
    void swapModel(peer, sanitizeAvatar(raw.avatar) ?? defaultAvatar())
  }

  /** 给某个远端玩家装上/换掉模型（加载失败就保留占位人形） */
  async function swapModel(peer: Peer, avatar: Avatar) {
    try {
      // 外形没变就跳过重建：换模型那几百毫秒人物是空白的，重复的 avatar 消息会「闪一下不见」
      const key = JSON.stringify(avatar)
      if (peer.model && peer.avatarKey === key) return
      peer.avatarKey = key
      const model = await createFigure(avatar)
      if (peers.get(peer.id) !== peer) { model.dispose(); return }
      const previous = peer.model
      for (const child of [...peer.mesh.children]) if (child !== peer.label) peer.mesh.remove(child)
      // 关掉视锥剔除：蒙皮网格的包围球是按静息姿势算的，人物被缩放/骨骼大幅变形后
      // 球会算错——镜头一转就整个消失、转回来又出现，正是「人家突然不见又显示」的原因。
      model.root.traverse(object => {
        const mesh = object as THREE.Mesh & {isSkinnedMesh?: boolean}
        if (mesh.isMesh || mesh.isSkinnedMesh) mesh.frustumCulled = false
      })
      peer.mesh.add(model.root)
      peer.model = model
      previous?.dispose()
    } catch {
      /* 加载失败就保留占位人形 */
    }
  }

  const dropPeer = (id: string) => {
    const peer = peers.get(id)
    if (!peer) return
    scene.remove(peer.mesh)
    peer.mesh.remove(peer.label)
    peer.model?.dispose()
    peer.model = null
    peer.mesh.traverse(obj => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry.dispose()
      const material = mesh.material as THREE.Material | THREE.Material[]
      if (Array.isArray(material)) material.forEach(m => m.dispose())
      else material.dispose()
    })
    if (peer.bikeRoot) { scene.remove(peer.bikeRoot); peer.bikeRoot = null }
    peer.kit?.dispose()
    peer.plume?.dispose()
    peer.kit = null
    peer.plume = null
    smokeAccum.delete(id)
    peers.delete(id)
  }

  const rosterSync = () => {
    if (!state.ws || !state.ready) return
    try {
      state.ws.send(JSON.stringify({t: 'who'}))
    } catch {
      /* 忽略 */
    }
  }

  const connect = () => {
    if (closed || location.protocol === 'file:') return
    // 已经在连/已连上时不要重复开 socket
    if (state.ws && state.ws.readyState <= WebSocket.OPEN) return
    const url = localStorage.getItem('guiling.ws') || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
    setStatus(attempts ? '联机重连中…' : '联机中…', 0.7)
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      scheduleRetry()
      return
    }
    state.ws = ws
    ws.onopen = () => {
      attempts = 0
      state.ready = true
      if (rosterTimer) clearInterval(rosterTimer)
      rosterTimer = window.setInterval(rosterSync, 4000)
    }
    ws.onmessage = event => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(String(event.data))
      } catch {
        return
      }
      switch (msg.t) {
        case 'welcome':
          setBadge(Number(msg.online) || 1)
          for (const raw of (msg.players as Record<string, unknown>[]) ?? []) if (raw && raw.id) makePeer(raw)
          rosterSync()
          break
        case 'players':
          setBadge(Number(msg.online) || 1)
          for (const raw of (msg.players as Record<string, unknown>[]) ?? []) if (raw && raw.id) makePeer(raw)
          break
        case 'join':
          if (msg.player) makePeer(msg.player as Record<string, unknown>)
          break
        case 'leave':
          dropPeer(String(msg.id))
          break
        case 'avatar': {
          const peer = peers.get(String(msg.id))
          if (peer) void swapModel(peer, sanitizeAvatar(msg.avatar) ?? defaultAvatar())
          break
        }
        case 'pos': {
          const peer = peers.get(String(msg.id))
          if (!peer) break
          peer.target.set(Number(msg.x), Number(msg.y), Number(msg.z))
          peer.targetYaw = Number(msg.yaw) || 0
          peer.v = Number(msg.v) || 0
          peer.bike = typeof msg.bike === 'string' && !msg.bike.startsWith('S') ? msg.bike : ''
          peer.bx = Number(msg.bx) || 0
          peer.bz = Number(msg.bz) || 0
          peer.byaw = Number(msg.byaw) || 0
          peer.hb = Number(msg.hb) || 0
          peer.hx = Number(msg.hx) || 0
          peer.hz = Number(msg.hz) || 0
          peer.hyaw = Number(msg.hyaw) || 0
          // 老服务端不转发这些字段时保留上一次的值，别把状态清成「站着 / 满血」
          if (msg.cr === undefined) missingSyncFields++
          else {
            missingSyncFields = 0
            peer.cr = Number(msg.cr) || 0
          }
          peer.gr = msg.gr === undefined ? 1 : Number(msg.gr)
          // 对方显式告诉我们在不在动（1/0）；老服务端不转发时退回按速度猜
          peer.mv = msg.mv === undefined ? -1 : Number(msg.mv)
          peer.dn = msg.dn === undefined ? 0 : Number(msg.dn)
          peer.pn = msg.pn === undefined ? 0 : Number(msg.pn)
          // bike 字段既可能是车名，也可能是我们打包的状态串（旧服务端只会转发它）：
          // 是打包串就一定要解，且「是否在骑车」以打包结果为准——新服务端会原样转发这个串，
          // 不解包的话所有人都会被当成在骑车。
          if (typeof msg.bike === 'string' && msg.bike.startsWith('S')) {
            const packed = unpackState(msg.bike, Number(msg.x) || 0, Number(msg.z) || 0)
            if (packed) {
              peer.bike = packed.riding ? 'bike' : ''
              if (msg.cr === undefined) {
                peer.cr = packed.crouch ? 1 : 0
                peer.gr = packed.air ? 0 : 1
                peer.dn = packed.down ? 1 : 0
                peer.pn = packed.punch ? 1 : 0
                peer.wl = packed.wheelie
                peer.sc = packed.smokePhase
                peer.sb = packed.burn
                peer.sp = packed.puffs
                peer.br = packed.brand
                peer.hb = packed.nearBike ? 1 : 0
                peer.hx = packed.bikeX
                peer.hz = packed.bikeZ
                peer.hyaw = packed.bikeYaw
              }
            }
          }
          peer.wl = msg.wl === undefined ? 0 : Number(msg.wl)
          if (msg.hp !== undefined) peer.hp = Math.max(0, Math.min(100, Math.round(Number(msg.hp) || 0)))
          peer.sc = Number(msg.sc) || 0
          peer.sb = Number(msg.sb) || 0
          peer.sp = Number(msg.sp) || 0
          peer.br = Number(msg.br) || 0
          peer.lastSeen = performance.now()
          break
        }
        case 'banned':
          showBanScreen(String(msg.reason || '账号已被封禁'))
          state.ready = false
          closed = true
          state.ws?.close()
          break
        case 'hit': {
          // 被别人打中：伤害值由出手方算，这里只保证范围合法
          const dmg = Math.max(1, Math.min(40, Math.round(Number(msg.dmg) || 8)))
          const by = msg.by ? String(msg.by) : undefined
          const byId = msg.byId ? String(msg.byId) : undefined
          for (const handler of hitHandlers) handler(dmg, by, byId)
          break
        }
        case 'revive': {
          const by = msg.by ? String(msg.by) : undefined
          for (const handler of reviveHandlers) handler(by)
          break
        }
        case 'online':
          setBadge(Number(msg.online) || 1)
          break
      }
    }
    ws.onclose = () => {
      state.ready = false
      state.ws = null
      if (closed) return
      scheduleRetry()
    }
    ws.onerror = () => ws.close()
  }

  // 连不上就退避重连，别每 5 秒无脑试；试够次数后停手，点徽标可以手动重连
  const scheduleRetry = () => {
    if (closed) return
    attempts++
    if (attempts > 6) {
      setStatus('联机不可用 · 点此重连', 0.85)
      return
    }
    setStatus(`联机重连中… ${attempts}/6`, 0.7)
    clearTimeout(retryTimer)
    retryTimer = window.setTimeout(connect, Math.min(15000, 1000 * 2 ** (attempts - 1)))
  }
  const retry = () => {
    if (closed) return
    clearTimeout(retryTimer)
    attempts = 0
    connect()
  }
  badge.onclick = retry
  connect()
  // 改了外形就通知服务器转给别人（别人会就地换模型）
  const onAvatar = () => {
    if (state.ws && state.ready) {
      try {
        state.ws.send(JSON.stringify({t: 'avatar', avatar: readAvatar()}))
      } catch {
        /* 忽略 */
      }
    }
  }
  addEventListener('glol:avatar', onAvatar)

  // —— 别人的烟：道具挂在对方的模型根节点上，动作靠 state 权重驱动 ——
  const smokeHandL = new THREE.Vector3()
  const smokeHandR = new THREE.Vector3()
  const smokeMouth = new THREE.Vector3()
  const smokeTip = new THREE.Vector3()
  const smokeAccum = new Map<string, number>()

  function updatePeerSmoke(peer: Peer, view: SmokeView, dt: number) {
    // 烟雾粒子即使断了烟也要把剩下的飘完
    peer.plume?.update(dt)
    if (view.phase === 'idle' || !peer.model) {
      if (peer.kit) peer.kit.root.visible = false
      return
    }
    if (!peer.kit) {
      try {
        peer.kit = new SmokeKit(scene, view.brand)
        peer.plume = createSmokePlume(scene, 0xffb070)
      } catch {
        return
      }
    }
    if (peer.kit.brand.id !== view.brand) peer.kit.setBrand(view.brand)
    const root = peer.model.root
    if (peer.kit.root.parent !== root) root.add(peer.kit.root)
    peer.kit.root.visible = true
    if (!peer.model.jointLocal('hand_l', smokeHandL)) smokeHandL.copy(SMOKE_ANCHORS.packL)
    if (!peer.model.jointLocal('hand_r', smokeHandR)) smokeHandR.copy(SMOKE_ANCHORS.smokeR)
    peer.model.mouthLocal(smokeMouth)
    peer.kit.apply(view, {handL: smokeHandL, handR: smokeHandR, mouth: smokeMouth})
    peer.kit.tipWorld(smokeTip)
    const plume = peer.plume
    if (!plume) return
    if (view.ember > 0.05) {
      let pending = (smokeAccum.get(peer.id) ?? 0) + dt * 1.5
      while (pending >= 1) {
        pending -= 1
        plume.emit(smokeTip, 1, 0.1)
      }
      smokeAccum.set(peer.id, pending)
    }
    if (view.puff > 0.2 && !peer.puffBurst) {
      peer.puffBurst = true
      plume.emit(smokeTip, 6, 0.9)
    }
    if (view.puff <= 0.02) peer.puffBurst = false
  }


  const hitHandlers: Array<(damage: number, by?: string, byId?: string) => void> = []
  const reviveHandlers: Array<(by?: string) => void> = []
  const downHandlers: Array<(name: string) => void> = []
  /** 最近打过谁：对方倒地时只给「刚揍过他的人」发击倒提示 */
  const recentHits = new Map<string, number>()

  /** 出拳：面前 1.9 m 内、夹角 60° 以内最近的人 */
  function punch(): HitResult | null {
    if (!state.ws || !state.ready) return null
    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    forward.y = 0
    if (forward.lengthSq() < 1e-6) return null
    forward.normalize()
    const eye = camera.getWorldPosition(new THREE.Vector3())
    let best: Peer | undefined
    let bestDist = Infinity
    let bestId = ''
    for (const [id, peer] of peers) {
      // 已经倒地的人不再吃拳：不然挥空也会弹「命中」，看着像掉血其实没掉
      if (peer.dn !== 0) continue
      const dx = peer.target.x - eye.x
      const dz = peer.target.z - eye.z
      const dist = Math.hypot(dx, dz)
      if (dist > 1.9 || dist > bestDist) continue
      // 高度差：必须拿「脚底 vs 脚底」，不能拿对方脚底和自己的眼睛比——
      // 身高 1.6 m 恒大于阈值，那样每一拳都会被判空（这就是「锤人不掉血」的原因）。
      if (Math.abs(peer.target.y - lastSelf.y) > 1.35) continue
      const dot = (dx * forward.x + dz * forward.z) / Math.max(1e-4, dist)
      if (dot < 0.5) continue
      best = peer
      bestDist = dist
      bestId = id
    }
    if (!best) return null
    // 伤害：基础 9，贴脸最多 +4；打蹲着的人 +1（目标小但攻防都在同一高度，好发力）
    const low = best.cr !== 0
    const damage = Math.max(1, Math.round(9 + 4 * (1 - bestDist / 1.9) + (low ? 1 : 0)))
    try {
      state.ws.send(JSON.stringify({t: 'hit', id: bestId, dmg: damage}))
    } catch {
      return null
    }
    recentHits.set(bestId, performance.now())
    return {id: bestId, name: best.name, damage, distance: bestDist, low}
  }

  /** 扶起 2.2 m 内倒地的人 */
  function reviveNearest(): string | null {
    if (!state.ws || !state.ready) return null
    let best: Peer | undefined
    let bestDist = Infinity
    let bestId = ''
    for (const [id, peer] of peers) {
      if (peer.dn === 0) continue
      const dist = Math.hypot(peer.target.x - lastSelf.x, peer.target.z - lastSelf.z)
      if (dist > 2.2 || dist >= bestDist) continue
      best = peer
      bestDist = dist
      bestId = id
    }
    if (!best) return null
    try {
      state.ws.send(JSON.stringify({t: 'revive', id: bestId}))
    } catch {
      return null
    }
    return best.name
  }

  return {
    tick(self, dtMs) {
      const now = performance.now()
      // 连上之后的第一次 tick 才 join：这时才有真实坐标，
      // 否则对方会看到你从世界原点「飞」到出生点。
      if (state.ws && state.ready && !joined) {
        joined = true
        try {
          state.ws.send(JSON.stringify({t: 'join', uid: identity.uid, name: identity.name, avatar: readAvatar(), x: self.x, y: self.y, z: self.z, yaw: self.yaw}))
        } catch {
          joined = false
        }
      }
      if (lastSelfTime) {
        const d = Math.hypot(self.x - lastSelf.x, self.z - lastSelf.z)
        const dt = (now - lastSelfTime) / 1000
        // 这里原来是 dt > 0.016 才更新：240Hz 屏上 dt≈0.004，条件永远不成立，
        // selfSpeed 会冻在最后一次走路的值 → 对方永远看到你在走。只挡 dt≈0 即可。
        if (dt > 1e-3) selfSpeed = selfSpeed * 0.75 + (d / dt) * 0.25
        else if (d > 1e-3) selfSpeed = d / 1e-3
        else selfSpeed *= 0.5
      }
      lastSelf.set(self.x, self.y, self.z)
      lastSelfTime = now
      // 显式告诉别人我在不在动（比让对面从 v 去猜更可靠）
      const movingNow = selfSpeed > 0.45 || self.v > 0.45 ? 1 : 0
      if (state.ws && state.ready && now - lastSend > 66) {
        lastSend = now
        try {
          state.ws.send(JSON.stringify({t: 'pos', x: self.x, y: self.y, z: self.z, yaw: self.yaw, v: movingNow ? Math.max(self.v, selfSpeed) : 0, mv: movingNow, bike: packState(self), bx: self.bx ?? 0, bz: self.bz ?? 0, byaw: self.byaw ?? 0, hb: self.hb ?? 0, hx: self.hx ?? 0, hz: self.hz ?? 0, hyaw: self.hyaw ?? 0, cr: self.cr ?? 0, gr: self.gr ?? 1, dn: self.dn ?? 0, pn: self.pn ?? 0, wl: self.wl ?? 0, hp: self.hp ?? 100, sc: self.sc ?? 0, sb: self.sb ?? 0, sp: self.sp ?? 0, br: self.br ?? 0}))
        } catch {
          /* 忽略 */
        }
      }
      camera.updateMatrixWorld()
      // 服务端太旧：pos 里没有 cr/dn/pn/hp，蹲下、倒地、出拳、扣血都同步不过去。
      // 这条路只在「收到很多条 pos 但一个 cr 都没有」时才走，正常人一局都不会看到。
      if (!staleWarned && missingSyncFields > 40) {
        staleWarned = true
        console.warn(
          '[net] 联机服务没有下发 pos.cr —— 蹲下 / 倒地 / 出拳 / 扣血 都不会同步。\n' +
          '请把 deploy/realtime/server-realtime.mjs 更新到最新版并重启后端的联机服务。',
        )
        setStatus('联机服务版本过旧 · 蹲下/受击不同步', 0.95)
        window.setTimeout(() => {
          if (state.ready && state.online > 0) setBadge(state.online)
        }, 8000)
      }
      const k = Math.min(1, dtMs / 160)
      for (const [id, peer] of peers) {
        peer.mesh.position.lerp(peer.target, k)
        peer.mesh.rotation.y += (peer.targetYaw - peer.mesh.rotation.y) * k
        // 车：对端骑车时按车身坐标画；没骑但身边站着车（手机叫来的）也画一辆停在那儿
        if (peer.bike || peer.hb) {
          if (!peer.bikeRoot) {
            try {
              const inst = createBike(0) // 青桂本色；之前用 2 = 粉色车漆
              peer.bikeRoot = (inst as unknown as {root: THREE.Group}).root
              scene.add(peer.bikeRoot)
            } catch { /* 建车失败就跳过 */ }
          }
          if (peer.bikeRoot) {
            if (peer.bike) {
              // 车身高度：对方上报的是「人物原点」= 车座 − 0.91，而车座 = 车身 y + 0.792，
              // 所以 车身 y = 人物 y + 0.91 − 0.792 = 人物 y + 0.118。
              // 之前直接拿人物 y 当车身 y，车被画低 0.91 m，看起来就是人浮在半空往前飘。
              // 位置/朝向必须和人物一样插值：直接 set 会每 100 ms 跳一下，
              // 而人是平滑的 → 别人看就成了「一卡一卡的」。
              const wantX = peer.bx
              const wantY = peer.mesh.position.y + 0.118
              const wantZ = peer.bz
              if (peer.bikeRoot.position.lengthSq() === 0) {
                peer.bikeRoot.position.set(wantX, wantY, wantZ)
              } else {
                peer.bikeRoot.position.x += (wantX - peer.bikeRoot.position.x) * k
                peer.bikeRoot.position.y += (wantY - peer.bikeRoot.position.y) * k
                peer.bikeRoot.position.z += (wantZ - peer.bikeRoot.position.z) * k
              }
              const wantYaw = peer.byaw + Math.PI
              let spin = wantYaw - peer.bikeRoot.rotation.y
              spin = Math.atan2(Math.sin(spin), Math.cos(spin))   // 走最短弧，避免绕远
              peer.bikeRoot.rotation.y += spin * k
              // 翘头也要看得见：对端上报的是弧度倍数（1 = 30°）
              const wlAngle = (peer.wl || 0) * 1.55   // 满量程 = 89°，服务端夹 0..1 不丢范围
              peer.bikeRoot.rotation.x = -wlAngle
              // 关键：只转不补位移 = 绕车身原点转，后轮会被按进地里（别人看你像在往地下压车）。
              // 补偿和本地一致：y 抬 |rearZ|·sinθ，沿车身局部 +Z 补 rearZ·(1−cosθ)。
              if (wlAngle > 0.001) {
                const yawBike = peer.bikeRoot.rotation.y
                const back = -0.62 * (1 - Math.cos(wlAngle))
                peer.bikeRoot.position.y += 0.62 * Math.sin(wlAngle)
                peer.bikeRoot.position.x += Math.sin(yawBike) * back
                peer.bikeRoot.position.z += Math.cos(yawBike) * back
              }
              // 人只按自己的朝向：车是 heading+π（模型前脸朝 +Z），人再加 π 就变成反着坐
              peer.mesh.rotation.y = peer.byaw
            } else {
              // 停着的车：y 用对方脚下的地面高度，朝向就是停车角度（不用 +π）
              peer.bikeRoot.position.set(peer.hx, peer.mesh.position.y, peer.hz)
              peer.bikeRoot.rotation.y = peer.hyaw
            }
          }
        } else if (peer.bikeRoot) {
          scene.remove(peer.bikeRoot)
          peer.bikeRoot = null
        }
        const moved = peer.prev.distanceTo(peer.mesh.position)
        const instant = moved / Math.max(0.001, dtMs / 1000)
        peer.speed += (Math.max(instant, peer.v) - peer.speed) * 0.35
        peer.prev.copy(peer.mesh.position)
        // 头顶血条：只有数值变了才写 DOM
        if (peer.hp !== peer.shownHp) {
          peer.shownHp = peer.hp
          if (peer.hpFill) peer.hpFill.style.width = `${peer.hp}%`
          if (peer.hpRow) {
            peer.hpRow.classList.toggle('low', peer.hp <= 30)
            peer.hpRow.classList.toggle('hurt', peer.hp < 100)
          }
        }
        // 倒地的那一下：给刚揍过他的人弹一个「击倒」
        if (peer.dn !== 0 && !peer.wasDown) {
          peer.wasDown = true
          const hitAt = recentHits.get(peer.id)
          if (hitAt !== undefined && now - hitAt < 4000) {
            recentHits.delete(peer.id)
            for (const handler of downHandlers) handler(peer.name)
          }
        } else if (peer.dn === 0) {
          peer.wasDown = false
        }
        const step = dtMs / 1000
        // 抽烟：先按网络上报更新远端状态机，拿到这一帧的姿势权重再摆模型
        peer.smoke.update(peer.sc ?? 0, peer.sb ?? 0, peer.sp ?? 0, peer.br ?? 0, step)
        const smokeView = peer.smoke.view()
        if (peer.model) peer.model.pose(step, {moving: peer.mv >= 0 ? peer.mv !== 0 : peer.speed > 0.35, speed: Math.max(peer.speed, peer.v), grounded: peer.gr !== 0, crouch: peer.cr !== 0, riding: !!peer.bike, down: peer.dn !== 0, punch: peer.pn ? 1 : 0,
          smoke: {hold: smokeView.hold, carry: smokeView.carry, light: smokeView.light, puff: smokeView.puff}})
        updatePeerSmoke(peer, smokeView, step)
        if (now - peer.lastSeen > 120000) dropPeer(id) // 真掉线服务端会发 leave，这里只兜底 // 之前 10 秒就丢掉：网络抖一下人在你屏幕上就「消失」了
      }
      labelRenderer.render(scene, camera)
    },
    dispose() {
      closed = true
      clearTimeout(retryTimer)
      if (rosterTimer) clearInterval(rosterTimer)
      removeEventListener('glol:avatar', onAvatar)
      state.ws?.close()
      for (const id of [...peers.keys()]) dropPeer(id)
      badge.remove()
      labelRenderer.domElement.remove()
      window.removeEventListener('resize', resizeLabels)
    },
    retry,
    get online() {
      return state.online
    },
    get peers() {
      return peers.size
    },
    punch,
    reviveNearest,
    onHit(handler: (damage: number, by?: string, byId?: string) => void) {
      hitHandlers.push(handler)
    },
    onRevive(handler: (by?: string) => void) {
      reviveHandlers.push(handler)
    },
    onDown(handler: (name: string) => void) {
      downHandlers.push(handler)
    },
    peerPosition(id: string) {
      const peer = peers.get(id)
      if (!peer) return null
      return {x: peer.mesh.position.x, y: peer.mesh.position.y, z: peer.mesh.position.z}
    },
        dump() {
      return [...peers.values()].map(p => ({
        name: p.name,
        dist: +p.mesh.position.distanceTo(camera.position).toFixed(1),
        label: p.label.element.querySelector('.peer-name')?.textContent ?? p.label.element.textContent ?? null,
        body: p.model?.avatar.body ?? null,
        hair: p.model?.avatar.hair ?? null,
        model: !!p.model,
        pose: p.speed > 0.35,
        bike: p.bike || null,
        hb: p.hb,
        cr: p.cr,
        /** 实际应用到模型上的蹲下权重：0 说明姿势没生效，1 说明蹲下去了 */
        crouchWeight: p.model
          ? +(((p.model.root.userData.layers as {crouch?: number} | undefined)?.crouch ?? 0)).toFixed(2)
          : null,
        hp: p.hp,
        gr: p.gr,
        dn: p.dn,
        pn: p.pn,
        mv: p.mv,
        bikeRoot: !!p.bikeRoot,
        bxyz: [+p.bx.toFixed(1), +p.bz.toFixed(1), +p.byaw.toFixed(2)],
        pos: p.mesh.position.toArray().map(n => +n.toFixed(1)),
      }))
    },
  }
}
