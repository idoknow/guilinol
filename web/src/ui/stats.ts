// 帧率 + 网速 + 在线人数读数（IDOK-178）。三格读数各自可关，全关就整条不显示。
import './stats.css'
import {onPrefs, prefs} from './prefs'
import {onOnline, startLive} from './live'

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
  chip.append(fpsTile, netTile, onlineTile)
  document.body.append(chip)

  let frames = 0
  let frameAt = performance.now()
  let fps = 0
  let bytes = 0
  let byteAt = performance.now()
  let online: number | null = null

  function syncVisibility() {
    const current = prefs().stats
    fpsTile.hidden = !current.fps
    netTile.hidden = !current.net
    onlineTile.hidden = !current.online || online === null
    chip.hidden = fpsTile.hidden && netTile.hidden && onlineTile.hidden
  }

  function paintFps() {
    fpsTile.textContent = `${fps.toFixed(0)} FPS`
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
  }, NET_WINDOW)

  startLive()
  onOnline(value => {
    online = value
    onlineTile.textContent = value === null ? '' : `在线 ${value}`
    syncVisibility()
  })
  onPrefs(syncVisibility)

  paintFps()
  paintNet()
  syncVisibility()
  requestAnimationFrame(loop)
  return chip
}
