import * as T from 'three'
import type {Walker} from '../play/host'
import {onPrefs, prefs} from '../ui/prefs'
import {camera, type BodyId, type CameraBody} from './cameras'
import {buildCameraPropAsync, disposeCameraProp} from './models'

// 手上的机身（IDOK-182）。
//
// 徒步时把当前装备的相机挂到 `handAnchor()` 上；飞 / 骑行 / 拍照时摘下来。
// 模型异步构建（优先 glTF），换机时用 token 丢弃过期的构建结果。

type Mount = {id: BodyId; root: T.Group; source: string; anchor: T.Object3D}

let mount: Mount | null = null
let token = 0
let wanted = false
// 最近一次传进来的 walker：换机 / prefs 变化时手上不一定有人再传 walker，
// 记住它才能重新拿到手部锚点（IDOK-182）。
let lastWalker: Walker | null = null

function anchorNow(): T.Object3D | undefined {
  return lastWalker?.handAnchor?.()
}

export function equippedBody(): CameraBody {
  return camera(prefs().gear.equipped)
}

function detach() {
  lastWalker?.setCameraHold?.(false)
  if (!mount) return
  disposeCameraProp(mount.root)
  mount = null
}

function attach(root: T.Group, id: BodyId, anchor: T.Object3D) {
  // 机身自带 lens 朝 -Z；手上稍微往下压一点，看起来像持机取景。
  root.rotation.x = 0.12
  root.rotation.z = 0.08
  root.position.set(0, 0.01, 0.02)
  anchor.add(root)
  mount = {id, root, source: String(root.userData.source ?? 'procedural'), anchor}
  // IDOK-188：同时把右臂抬起来，机身才露在身侧看得见。
  lastWalker?.setCameraHold?.(true)
}

async function rebuild() {
  const mine = ++token
  detach()
  if (!wanted) return
  const body = equippedBody()
  const root = await buildCameraPropAsync(body)
  if (mine !== token || !wanted) {
    disposeCameraProp(root)
    return
  }
  const anchor = anchorNow()
  if (!anchor) {
    disposeCameraProp(root)
    return
  }
  attach(root, body.id, anchor)
}

/** 让机身跟随装备状态：飞行/骑行前调用 `setCameraShown(false)`。
 *  每帧调用也安全：机身已在手上、walker 也没换时直接返回（IDOK-188 修正了持机姿势不生效的链路）。 */
export function setCameraShown(on: boolean, walker?: Walker) {
  const freshWalker = !!walker && lastWalker !== walker
  if (walker) lastWalker = walker
  if (on && wanted && mount) {
    // 机身已在手上，只是这时候才拿到 walker —— 补一次持机姿势。
    if (freshWalker) lastWalker?.setCameraHold?.(true)
    return
  }
  if (on === wanted) return
  wanted = on
  if (on) {
    void rebuild()
  } else {
    token += 1
    detach()
  }
}

/** 换机后重挂（已经显示时才重建）。 */
export function refreshCamera(walker?: Walker) {
  if (walker) lastWalker = walker
  if (!wanted) return
  void rebuild()
}

export function mountedCamera(): {id: BodyId; source: string} | null {
  return mount ? {id: mount.id, source: mount.source} : null
}

onPrefs(next => {
  if (!wanted) return
  if (mount && next.gear.equipped === mount.id) return
  void rebuild()
})
