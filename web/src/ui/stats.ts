// 帧率 + 网速 + 在线人数读数（IDOK-178）。三格读数各自可关，全关就整条不显示。
import './stats.css'
import {onPrefs, prefs} from './prefs'
import {onOnline, startLive} from './live'
import {onUser, openAccount} from './account'
import type {MpStatus} from './mp-pref'
import {toggleRoster} from './mp-roster-panel'
import {debugHud} from '../deeplink'

const FPS_WINDOW = 500
const NET_WINDOW = 1000

function tile(className: string) {
  const element = document.createElement('span')
  element.className = className
  return element
}

function speed(bytesPerSecond: number) {
  if (bytesPerSecond >= 1048576) return `${(bytesPerSecond / 1048576).toFixed(1)} MB/s`
  if (bytesPerSecond >= 1024) return `${Math.round(bytesPerSecond / 1024)} KB/s`
  return `${Math.round(bytesPerSecond)} B/s`
}

export function mountStats() {
  const chip = document.createElement('div')
  chip.className = 'hud-stats'
  chip.setAttribute('role', 'status')
  chip.setAttribute('aria-live', 'off')
  const fpsTile = tile('hud-stat hud-stat--fps')
  const netTile = tile('hud-stat hud-stat--net')
  const onlineTile = tile('hud-stat hud-stat--online')
  // 同城联机（IDOK-192）：开着联机时这一格替代「在线」，显示同城人数；断线时变成可点的重连。
  const mpTile = document.createElement('button')
  mpTile.type = 'button'
  mpTile.className = 'hud-stat hud-stat--mp'
  mpTile.hidden = true
  chip.append(fpsTile, netTile, onlineTile, mpTile)
  document.body.append(chip)
  registerPageUI(chip)

  let frames = 0
  let frameAt = performance.now()
  let fps = 0
  let bytes = 0
  let byteAt = performance.now()
  let online: number | null = null
  let mp: MpStatus = {state: 'off', online: 0}
  let signedIn = false
  let shownDev = debugHud()

  function syncVisibility() {
    const current = prefs().stats, dev = shownDev = debugHud()
    fpsTile.hidden = !dev || !current.fps
    netTile.hidden = !dev || !current.net
    onlineTile.hidden = !dev || !current.online || online === null || mp.state !== 'off'
    mpTile.hidden = mp.state === 'off'
    chip.hidden = fpsTile.hidden && netTile.hidden && onlineTile.hidden && mpTile.hidden
    chip.classList.toggle('hud-stats--mp', !mpTile.hidden)
  }

  function paintFps() {
    fpsTile.textContent = `${fps.toFixed(0)} FPS`
    registerPageUI(fpsTile,true)
  }

  function paintNet() {
    netTile.textContent = speed(bytes / Math.max(0.001, (performance.now() - byteAt) / 1000))
  }

  const loop = () => {
    frames += 1
    const now = performance.now()
    if (now - frameAt >= FPS_WINDOW) {
      // 半秒一算，取整到 5 帧以内，数字不抖。
      fps = (frames * 1000) / (now - frameAt)
      frames = 0
      frameAt = now
      paintFps()
      // 调试开关可在运行中切（控制台改 body[data-debug]、量测脚本还原玩家视角），半秒内跟上。
      if (shownDev !== debugHud()) { syncVisibility(); paintMp() }
    }
    requestAnimationFrame(loop)
  }

  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
        // 缓存命中时 transferSize 为 0，说明这次没走网络，不计入。
        if (entry.transferSize > 0) bytes += entry.transferSize
      }
    })
    observer.observe({type: 'resource', buffered: false})
  } catch {
    // 老浏览器没有 Resource Timing：网速那格一直显示 0 B/s。
  }

  setInterval(() => {
    const now = performance.now()
    const rate = bytes / Math.max(0.001, (now - byteAt) / 1000)
    bytes = 0
    byteAt = now
    netTile.textContent = speed(rate)
    registerPageUI(netTile,true)
  }, NET_WINDOW)

  startLive()
  onOnline(value => {
    online = value
    onlineTile.textContent = value === null ? '' : `在线 ${value}`
    registerPageUI(onlineTile,true)
    syncVisibility()
  })
  onPrefs(syncVisibility)

  function paintMp() {
    mpTile.dataset.state = mp.state === 'offline' && !signedIn ? 'login' : mp.state
    mpTile.disabled = mp.state === 'connecting'
    // 在线人数不常驻（IDOK-468）：按钮只写「同城」，人数留在无障碍名称和名单里。
    mpTile.textContent = mp.state === 'online' ? (debugHud() ? `同城 ${mp.online} 人` : '同城')
      : mp.state === 'connecting' ? '联机连接中'
      : mp.state === 'replaced' ? '已在其他设备联机 · 重连'
      : signedIn ? '联机已断开 · 重连' : '登录后联机'
    mpTile.title = mp.state === 'online' ? '查看同城在线玩家和他们的位置' : ''
    registerPageUI(mpTile,true)
    if (mp.state === 'online') mpTile.setAttribute('aria-label', `同城在线 ${mp.online} 人`)
    else mpTile.removeAttribute('aria-label')
    syncVisibility()
  }
  mpTile.onclick = () => {
    if (mp.state === 'online') { toggleRoster(); return }
    if (!signedIn) void openAccount()
    else window.dispatchEvent(new Event('glol:mp-reconnect'))
  }
  addEventListener('glol:mp-status', event => {
    mp = (event as CustomEvent<MpStatus>).detail
    paintMp()
  })
  onUser(user => { signedIn = !!user; paintMp() })

  paintFps()
  paintNet()
  syncVisibility()
  requestAnimationFrame(loop)
  return chip
}
import {registerPageUI} from '../capture-page'
