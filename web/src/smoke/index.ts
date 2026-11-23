/**
 * 抽烟系统总装：背包 / 快捷栏 / 状态机 / 三维道具 / 烟雾 / 联机同步。
 *
 * 由 web/src/walk/index.ts 在进入步行模式时创建一次，每帧按这个顺序调：
 *   1. advance(dt)  —— 推进状态机（取烟 → 点烟 → 抽）
 *   2. character.pose(dt, {..., smoke: smoking.pose()})  —— 手臂举起来
 *   3. follow()     —— 相机 / 人物最终位置
 *   4. place(dt)    —— 道具跟手、火星冒烟
 */

import * as THREE from 'three'
import './smoke.css'
import {readAvatar, type Figure} from '../walk/figure'
import {skinTones} from '../../../lib/avatar'
import {
  assignPack,
  brandOf,
  clearSlot,
  HOTBAR_SLOTS,
  loadInventory,
  packAt,
  saveInventory,
  takeCigarette,
  type Inventory,
} from './data'
import {IDLE_VIEW, brandIndex, SmokeSession, type SmokeView} from './session'
import {SmokeKit} from './kit'
import {SMOKE_ANCHORS, VIEW_ANCHORS} from './anchors'
import {createMitt, createSmokePlume, Parts, type SmokePlume} from './models'
import {createSmokeUi, type SmokeUi} from './ui'

/** 第一人称道具单独一层，水面镜像（只画 layer 0）就不会把自己照进河里 */
const VIEW_LAYER = 2

export interface SmokingOptions {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  /** 当前人物（换外形会换掉整个 Figure） */
  figure(): Figure
  /** 步行模式是否激活 */
  active(): boolean
  /** 是否第一人称 */
  firstPerson(): boolean
}

export interface Smoking {
  /** 进 / 出步行模式 */
  show(on: boolean): void
  advance(dt: number): void
  /** 给 character.pose 的 smoke 参数 */
  pose(): {hold: number; carry: number; light: number; puff: number}
  place(dt: number): void
  /** 联机上报的几个数 */
  net(): {sc: number; sb: number; sp: number; br: number}
  /** 调试 / 自动化测试用 */
  debug(): {
    inventory: Inventory
    phase: string
    burn: number
    packId: string | null
    bagOpen: boolean
    burning: boolean
  }
  dispose(): void
}

export function createSmoking(options: SmokingOptions): Smoking {
  const inventory = loadInventory()
  const session = new SmokeSession()
  const scene = options.scene
  const camera = options.camera

  let visible = false
  /** 吸了几口的累计序号：翻到 1000 就从 0 再来，联机靠它识别「又吸了一口」 */
  let puffSeq = 0
  let smokeAccum = 0
  let puffBurst = false
  let skin = readAvatarSkin()
  let skinTimer = 1

  const initialBrand = inventory.packs[0]?.brand ?? 'nanxi'
  const kit = new SmokeKit(scene, initialBrand)
  const viewKit = new SmokeKit(scene, initialBrand, VIEW_LAYER)
  const plume: SmokePlume = createSmokePlume(scene, 0xffb070)

  // —— 第一人称的假手 + 道具，整组跟着相机走 ——
  const viewRoot = new THREE.Group()
  viewRoot.name = 'smoke-viewmodel'
  scene.add(viewRoot)
  const mittParts = new Parts()
  const mittL = createMitt(skin, false, mittParts)
  const mittR = createMitt(skin, true, mittParts)
  viewRoot.add(viewKit.root, mittL, mittR)
  viewRoot.traverse(node => node.layers.set(VIEW_LAYER))
  viewRoot.visible = false
  camera.layers.enable(VIEW_LAYER)

  const handL = new THREE.Vector3()
  const handR = new THREE.Vector3()
  const mouth = new THREE.Vector3()
  const handQuat = new THREE.Quaternion()
  const viewHandL = new THREE.Vector3()
  const viewHandR = new THREE.Vector3()
  const viewMouth = new THREE.Vector3()
  const tip = new THREE.Vector3()
  let figureRoot: THREE.Object3D | null = null

  const ui: SmokeUi = createSmokeUi({
    inventory: () => inventory,
    use: slot => useSlot(slot),
    assign: (packId, slot) => {
      if (!assignPack(inventory, packId, slot)) return
      saveInventory(inventory)
      ui.refresh()
      ui.toast(`已放进快捷栏 ${slot + 1}`)
    },
    clear: slot => {
      if (!clearSlot(inventory, slot)) return
      saveInventory(inventory)
      ui.refresh()
    },
    dropPack: packId => {
      // 丢弃整包：从 packs 移除，快捷栏里引用它的格子一起清空
      const index = inventory.packs.findIndex(pack => pack.id === packId)
      if (index < 0) return
      const dropped = inventory.packs[index]
      const name = brandOf(dropped.brand).name
      inventory.packs.splice(index, 1)
      inventory.hotbar = inventory.hotbar.map(id => (id === packId ? null : id))
      saveInventory(inventory)
      ui.refresh()
      ui.toast('已丢弃 ' + (name || '香烟'))
    },
    onBagToggle: open => {
      if (open) document.exitPointerLock?.()
    },
  })

  /* ------------------------------------------------------------- 交互 */

  function useSlot(slot: number) {
    if (!visible || slot < 0 || slot >= HOTBAR_SLOTS) return
    if (ui.bagOpen) return
    const pack = packAt(inventory, slot)
    if (!pack) {
      ui.toast('这个格子是空的 · 按 TAB 打开背包放烟')
      return
    }
    const brand = brandOf(pack.brand)
    // 已经点着这一包：再按就是吸一口
    if (session.active && session.packId === pack.id) {
      if (session.phase === 'ready') {
        // 取出来了，这一下才点火
        if (session.light()) {
          ui.toast('打火机点火…')
          ui.refresh()
        }
        return
      }
      if (session.phase === 'draw') {
        ui.toast('正在取烟…')
        return
      }
      if (session.phase !== 'smoking') {
        ui.toast('正在点烟…')
        return
      }
      if (session.puffing) return
      if (session.puffReadyIn > 0) {
        ui.toast(`刚抽过 · 还要等 ${session.puffReadyIn} 秒`)
        return
      }
      if (session.puff()) {
        puffSeq = (puffSeq + 1) % 1000
        puffBurst = true
      }
      return
    }
    // 换一支：先把上一支掐掉
    if (session.active) stopSession()
    if (pack.cigarettes <= 0) {
      ui.toast(`这包${brand.name}已经空了 · 去背包换一包`)
      return
    }
    // 注意：这里不扣香烟数，等真的点着了再扣（advance 里看 session.ignited），
    // 否则按错键 / 连着换几包会把烟白白抽掉。
    kit.setBrand(pack.brand)
    viewKit.setBrand(pack.brand)
    session.start(pack.brand, pack.id)
    ui.refresh()
    ui.toast(`${brand.name} · 取出一根，再按一次点火`)
  }

  /** 点着了才真正从包里少一根 */
  function consumeCigarette() {
    const pack = inventory.packs.find(item => item.id === session.packId)
    if (!pack) return
    if (!takeCigarette(pack)) return
    saveInventory(inventory)
    ui.refresh()
  }

  function stopSession() {
    session.stop()
    plume.clear()
    smokeAccum = 0
    puffBurst = false
    ui.setBurning(null, 0)
  }

  /* ------------------------------------------------------------- 键盘 */

  function onKey(event: KeyboardEvent) {
    if (!visible) return
    // 正在输入框里打字（反馈、账号）就别抢键
    const target = event.target as HTMLElement | null
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
    if (event.code === 'Tab') {
      event.preventDefault()
      event.stopImmediatePropagation()
      ui.toggleBag()
      return
    }
    if (event.code === 'Escape' && ui.bagOpen) {
      event.preventDefault()
      event.stopImmediatePropagation()
      ui.toggleBag(false)
      return
    }
    const match = /^Digit([1-6])$/.exec(event.code)
    if (match) {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.repeat) return
      useSlot(Number(match[1]) - 1)
    }
  }
  window.addEventListener('keydown', onKey, {capture: true})

  /* --------------------------------------------------------- 每帧推进 */

  function advance(dt: number) {
    if (!visible) return
    const wasIgniting = session.phase === 'light'
    const finished = session.advance(dt)
    if (session.ignited) {
      consumeCigarette()
      ui.toast('烟点着了 · 再按一次吸一口')
    }
    if (finished) {
      dropStub()
      ui.setBurning(null, 0)
      ui.toast('抽完了，烟头掉在地上')
    } else if (session.phase === 'smoking') {
      ui.setBurning(session.packId, session.length)
    } else if (wasIgniting || session.phase === 'idle') {
      ui.setBurning(null, 0)
    }
    // 换人（改外形）时把假手的肤色跟上——每秒查一次就够，别每帧都去 JSON.parse
    skinTimer -= dt
    if (skinTimer <= 0) {
      skinTimer = 1
      const nextSkin = readAvatarSkin()
      if (nextSkin !== skin) {
        skin = nextSkin
        paintMitt(mittL)
        paintMitt(mittR)
      }
    }
  }

  function readAvatarSkin() {
    try {
      return skinTones[readAvatar().skin] ?? skinTones[2]
    } catch {
      return skinTones[2]
    }
  }

  function paintMitt(mitt: THREE.Object3D) {
    mitt.traverse(node => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const material = mesh.material as THREE.MeshStandardMaterial
      material.color.set(skin)
    })
  }

  function dropStub() {
    const frame = options.figure()
    kit.dropStub(frame.root.position, frame.root.rotation.y)
  }

  /* ------------------------------------------------------------ 摆放 */

  function place(dt: number) {
    const now = performance.now()
    kit.tick(now)
    viewKit.tick(now)
    plume.update(dt)
    if (!visible) return

    const view = session.view()
    const frame = options.figure()
    if (figureRoot !== frame.root) {
      figureRoot = frame.root
      frame.root.add(kit.root)
    }

    // 第一人称也不再画那对「相机空间的手」：人物模型的胳膊本来就在镜头前，
    // 再叠一对假手就会出现「低头两只手」。统一用骨骼锚点，烟永远在真手上。
    const firstPerson = options.firstPerson()
    kit.root.visible = true
    viewRoot.visible = false

    if (false && firstPerson) {
      viewRoot.position.copy(camera.position)
      viewRoot.quaternion.copy(camera.quaternion)
      viewHandL.copy(VIEW_ANCHORS.handL)
      viewHandR.copy(VIEW_ANCHORS.handR).lerp(VIEW_ANCHORS.handRLight, view.light)
      viewMouth.copy(VIEW_ANCHORS.mouth)
      viewKit.apply(view, {handL: viewHandL, handR: viewHandR, mouth: viewMouth})
      // 左手：烟盒收回去时跟着落到画面外，右手：一直在夹烟
      mittL.position.copy(VIEW_ANCHORS.handL).lerp(VIEW_ANCHORS.restL, 1 - view.carry)
      mittR.position.copy(viewHandR)
      mittL.visible = view.carry > 0.02
      mittR.visible = view.hold > 0.02
      viewKit.tipWorld(tip)
    } else {
      if (!frame.jointLocal('hand_l', handL)) handL.copy(SMOKE_ANCHORS.packL)
      if (!frame.jointLocal('hand_r', handR)) handR.copy(SMOKE_ANCHORS.smokeR)
      frame.mouthLocal(mouth)
      // 手心朝向：烟要跟着手转，否则手一抬烟就横着穿出手背
      const hasQuat = !!frame.jointQuat('hand_r', handQuat)
      kit.apply(view, {handL, handR, mouth, handQuat: hasQuat ? handQuat : undefined})
      kit.tipWorld(tip)
      mittL.visible = false
      mittR.visible = false
    }

    // —— 冒烟 ——
    if (view.ember > 0.05) {
      // 没在吸的时候细细一缕（大约每秒 2 颗）
      smokeAccum += dt * 1.9
      const wisps = Math.min(3, Math.floor(smokeAccum))
      for (let i = 0; i < wisps; i++) {
        smokeAccum -= 1
        plume.emit(tip, 1, 0.1)
      }
      if (smokeAccum > 3) smokeAccum = 0
    } else {
      smokeAccum = 0
    }
    // 吸一口：烟头喷一大股
    if (view.puff > 0.18 && !puffBurst) {
      puffBurst = true
      plume.emit(tip, 8, 1)
    }
    if (view.puff <= 0.02) puffBurst = false
  }

  /* -------------------------------------------------------------- 对外 */

  return {
    show(on: boolean) {
      if (on === visible) return
      visible = on
      ui.setVisible(on)
      if (!on) {
        stopSession()
        kit.root.visible = false
        viewRoot.visible = false
        plume.clear()
      }
    },
    advance,
    pose() {
      if (!visible) return {hold: 0, carry: 0, light: 0, puff: 0}
      const view = session.view()
      return {hold: view.hold, carry: view.carry, light: view.light, puff: view.puff}
    },
    place,
    net() {
      const brand = brandIndex(session.brand)
      if (!visible) return {sc: 0, sb: 0, sp: puffSeq, br: brand}
      const phase = session.phase
      const sc = phase === 'idle' ? 0 : phase === 'smoking' ? 2 : 1
      return {sc, sb: Math.round(session.burn * 10), sp: puffSeq, br: session.active ? brand : 0}
    },
    debug() {
      return {
        inventory,
        phase: session.phase,
        burn: session.burn,
        packId: session.packId,
        bagOpen: ui.bagOpen,
        burning: session.phase === 'smoking',
      }
    },
    dispose() {
      window.removeEventListener('keydown', onKey, {capture: true})
      ui.dispose()
      kit.dispose()
      viewKit.dispose()
      plume.dispose()
      viewRoot.removeFromParent()
      mittParts.dispose()
      camera.layers.disable(VIEW_LAYER)
    },
  }
}

/** 给联机层用的默认空视图 */
export {IDLE_VIEW}
export type {SmokeView}
