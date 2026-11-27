import {addFrameTap} from './gear/frame-tap'
import {spots, waterDocks} from './play/spots'

export interface CheatCapturePacket {
  t?: 'cheat_capture'
  id: string
  token: string
  kind: string
  at: number
  uid?: number
  name?: string
  state?: string
  activity?: string
  activityDetail?: string
  foot?: boolean
  bike?: string
  speed?: number
  speedBasis?: string
  flatSpeed?: number | null
  vspeed?: number | null
  reportedSpeed?: number | null
  overflow?: number | null
  pos?: [number, number, number]
  attemptPos?: [number, number, number] | null
}

export interface CaptureClientContext {
  uid?: number
  nickname?: string
  activity: string
  activityDetail?: string
  stateLabel: string
  speedMs: number
  verticalSpeedMs?: number
  grounded: boolean
  foot: boolean
  bike: string
  x: number
  y: number
  z: number
}

export const CHEAT_KIND_LABELS: Record<string, string> = {
  speed: '超速移动',
  teleport: '违规瞬移',
  head_overlap: '贴在他人头顶跟随',
  altitude_unverified: '异常升空 / 滞空',
  ground_unverified: '疑似钻地',
  mount_player: '试图骑乘他人',
  foreign_position: '改写他人位置',
  oversize: '超大消息攻击',
  invalid_packet: '非法消息攻击',
  packet_rate: '刷包超频攻击',
}

const EXTRA_LANDMARKS: ReadonlyArray<{name: string; x: number; z: number}> = [
  {name: '田源米粉', x: -1139, z: -56},
  {name: '靖江王城', x: -588, z: -227},
  {name: '花桥', x: 414, z: 333},
  {name: '丽泽桥', x: -1598, z: -185},
  {name: '木龙湖', x: -58, z: -1160},
  {name: '桂林站', x: -2191, z: 1794},
  {name: '穿山', x: -52, z: 2892},
]

const ALL_LANDMARKS: ReadonlyArray<{name: string; x: number; z: number}> = [
  ...spots.map((s) => ({name: s.name, x: s.x, z: s.z})),
  ...waterDocks.map((d) => ({name: d.name, x: d.x, z: d.z})),
  ...EXTRA_LANDMARKS,
]

export function nearestLandmark(x: number, z: number): {name: string; dist: number} | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  let best = Infinity
  let name = ''
  for (const item of ALL_LANDMARKS) {
    const distSq = (item.x - x) ** 2 + (item.z - z) ** 2
    if (distSq < best) {
      best = distSq
      name = item.name
    }
  }
  return name ? {name, dist: Math.round(Math.sqrt(best))} : null
}

export function formatBeijingTime(ms: number): string {
  const safe = Number.isFinite(ms) ? ms : Date.now()
  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(safe))
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
  } catch {
    return new Date(safe).toISOString().replace('T', ' ').slice(0, 19)
  }
}

export interface OverlayCopy {
  kindLabel: string
  playerLine: string
  timeLine: string
  statePrimary: string
  stateSub: string
  speedPrimary: string
  speedSub: string
  posPrimary: string
  posSub: string
  landmark: {name: string; dist: number} | null
}

export function buildOverlayCopy(packet: CheatCapturePacket, ctx: CaptureClientContext): OverlayCopy {
  const kindLabel = CHEAT_KIND_LABELS[packet.kind] ?? packet.kind
  const uid = packet.uid ?? ctx.uid ?? 0
  const name = (packet.name || ctx.nickname || '未命名玩家').slice(0, 24)
  const playerLine = `${name} · UID ${uid || '未知'}`
  const timeLine = `${formatBeijingTime(packet.at || Date.now())} (UTC+8)`

  const serverState = (packet.state || '').trim()
  const clientState = (ctx.stateLabel || serverState || '未知').trim()
  const statePrimary = clientState
  const stateSub = serverState && serverState !== clientState
    ? `服务端判定：${serverState}`
    : `活动：${ctx.activityDetail ? `${ctx.activity} / ${ctx.activityDetail}` : ctx.activity || packet.activity || 'walk'}`

  const serverSpeed = typeof packet.speed === 'number' && Number.isFinite(packet.speed) ? packet.speed : null
  const clientSpeed = Number.isFinite(ctx.speedMs) ? Math.max(0, ctx.speedMs) : 0
  const speedPrimary = serverSpeed === null ? '采样不足' : `${serverSpeed.toFixed(1)} m/s (${(serverSpeed * 3.6).toFixed(1)} km/h)`
  const speedDetails: string[] = []
  if (serverSpeed !== null) speedDetails.push(packet.speedBasis==='accepted-horizontal'?'已接受轨迹 · 水平均速':'旧版单包估算')
  speedDetails.push(`客户端 ${clientSpeed.toFixed(1)} m/s`)
  const vspeed = typeof packet.vspeed === 'number' && Number.isFinite(packet.vspeed)
    ? packet.vspeed
    : (typeof ctx.verticalSpeedMs === 'number' && Number.isFinite(ctx.verticalSpeedMs) ? ctx.verticalSpeedMs : 0)
  if (Math.abs(vspeed) >= 2.5) speedDetails.push(`垂直 ${vspeed >= 0 ? '+' : ''}${vspeed.toFixed(1)} m/s`)
  const speedSub = speedDetails.join(' · ')

  const posX = Number.isFinite(ctx.x) ? ctx.x : (packet.pos?.[0] ?? 0)
  const posY = Number.isFinite(ctx.y) ? ctx.y : (packet.pos?.[1] ?? 0)
  const posZ = Number.isFinite(ctx.z) ? ctx.z : (packet.pos?.[2] ?? 0)
  const landmark = nearestLandmark(posX, posZ)
  const landmarkPrefix = landmark ? `${landmark.name} 约 ${landmark.dist}m · ` : ''
  const posPrimary = `${landmarkPrefix}X ${posX.toFixed(1)}  Y ${posY.toFixed(1)}  Z ${posZ.toFixed(1)}`

  let posSub = ''
  if (packet.attemptPos && packet.attemptPos.length >= 3) {
    const [ax, ay, az] = packet.attemptPos
    const delta = Math.hypot(ax - posX, az - posZ)
    if (delta >= 1.5 || Math.abs(ay - posY) >= 1.5) {
      posSub = `尝试落点：X ${ax.toFixed(1)}  Y ${ay.toFixed(1)}  Z ${az.toFixed(1)}（偏移 ${Math.round(delta)}m）`
    }
  }
  if (!posSub && packet.pos && packet.pos.length >= 3) {
    const [sx, sy, sz] = packet.pos
    posSub = `服务端坐标：X ${sx.toFixed(1)}  Y ${sy.toFixed(1)}  Z ${sz.toFixed(1)}`
  }

  return {kindLabel, playerLine, timeLine, statePrimary, stateSub, speedPrimary, speedSub, posPrimary, posSub, landmark}
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (!text || ctx.measureText(text).width <= maxWidth) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo > 0 ? text.slice(0, lo) + '…' : ''
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

const FONT_SANS = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",system-ui,-apple-system,sans-serif'
const FONT_MONO = '"SFMono-Regular","Menlo","Consolas","PingFang SC",monospace'

export function renderEvidenceCanvas(
  source: HTMLCanvasElement | null,
  packet: CheatCapturePacket,
  ctx: CaptureClientContext,
): {canvas: HTMLCanvasElement; copy: OverlayCopy; fallback: boolean} {
  let width = 960
  let height = 540
  let fallback = true

  if (source && source.width > 0 && source.height > 0) {
    const maxEdge = 1280
    const srcLong = Math.max(source.width, source.height)
    const scale = Math.min(1, maxEdge / srcLong)
    width = Math.max(480, Math.round((source.width * scale) / 2) * 2)
    height = Math.max(320, Math.round((source.height * scale) / 2) * 2)
    fallback = false
  }

  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const g = out.getContext('2d')!
  const copy = buildOverlayCopy(packet, ctx)

  if (!fallback && source) {
    const filter = source.style?.filter || 'none'
    g.filter = filter
    g.drawImage(source, 0, 0, width, height)
    g.filter = 'none'
  } else {
    const bg = g.createLinearGradient(0, 0, 0, height)
    bg.addColorStop(0, '#131922')
    bg.addColorStop(1, '#0b0f14')
    g.fillStyle = bg
    g.fillRect(0, 0, width, height)
    g.fillStyle = 'rgba(226, 232, 240, 0.72)'
    g.font = `600 18px ${FONT_SANS}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('游戏画布当前未在前台渲染，已记录服务端与客户端实时取证信息', width / 2, height * 0.36)
    g.textAlign = 'left'
  }

  // Top-left evidence stamp pill
  const pad = Math.round(Math.max(12, Math.min(20, width * 0.018)))
  const badgeFont = width < 680 ? 12 : 14
  g.font = `700 ${badgeFont}px ${FONT_SANS}`
  const badgeText = `反外挂自动取证 · ${copy.kindLabel}`
  const badgeW = Math.min(width - pad * 2, Math.ceil(g.measureText(badgeText).width) + 28)
  const badgeH = badgeFont + 14
  g.fillStyle = 'rgba(185, 38, 32, 0.9)'
  roundRectPath(g, pad, pad, badgeW, badgeH, 6)
  g.fill()
  g.fillStyle = '#ffffff'
  g.textBaseline = 'middle'
  g.fillText(fitText(g, badgeText, badgeW - 20), pad + 12, pad + badgeH / 2 + 0.5)

  // Bottom structured HUD panel
  const stacked = width < 720
  const headerH = stacked ? 44 : 34
  const cardH = stacked ? 46 : 62
  const gap = 8
  const panelH = headerH + (stacked ? cardH * 3 + gap * 2 : cardH) + pad * 2
  const panelY = Math.max(badgeH + pad * 2, height - panelH)

  g.fillStyle = 'rgba(10, 14, 20, 0.86)'
  g.fillRect(0, panelY, width, height - panelY)
  g.fillStyle = '#e0483e'
  g.fillRect(0, panelY, width, 3)

  const innerX = pad
  const innerW = width - pad * 2
  const headerY = panelY + pad + 2

  g.textBaseline = 'top'
  if (stacked) {
    g.font = `700 13px ${FONT_SANS}`
    g.fillStyle = '#f8fafc'
    g.fillText(fitText(g, copy.playerLine, innerW), innerX, headerY)
    g.font = `500 11.5px ${FONT_MONO}`
    g.fillStyle = '#cbd5e1'
    g.fillText(fitText(g, copy.timeLine, innerW), innerX, headerY + 18)
  } else {
    g.font = `700 15px ${FONT_SANS}`
    g.fillStyle = '#f8fafc'
    g.fillText(fitText(g, copy.playerLine, innerW * 0.56), innerX, headerY + 2)
    g.font = `500 13px ${FONT_MONO}`
    g.fillStyle = '#cbd5e1'
    g.textAlign = 'right'
    g.fillText(fitText(g, copy.timeLine, innerW * 0.42), innerX + innerW, headerY + 4)
    g.textAlign = 'left'
  }

  const blocks: Array<{label: string; value: string; sub: string; accent: string}> = [
    {label: '当前状态', value: copy.statePrimary, sub: copy.stateSub, accent: '#38bdf8'},
    {label: '服务端估速', value: copy.speedPrimary, sub: copy.speedSub, accent: '#fbbf24'},
    {label: '当前位置', value: copy.posPrimary, sub: copy.posSub, accent: '#34d399'},
  ]

  const cardsY = panelY + pad + headerH
  if (stacked) {
    blocks.forEach((block, idx) => {
      const by = cardsY + idx * (cardH + gap)
      g.fillStyle = 'rgba(255, 255, 255, 0.06)'
      roundRectPath(g, innerX, by, innerW, cardH, 6)
      g.fill()
      g.fillStyle = block.accent
      g.fillRect(innerX, by + 6, 3, cardH - 12)
      g.font = `600 11px ${FONT_SANS}`
      g.fillStyle = '#94a3b8'
      g.fillText(block.label, innerX + 10, by + 5)
      g.font = `700 12.5px ${FONT_MONO}`
      g.fillStyle = '#f8fafc'
      g.fillText(fitText(g, block.value, innerW - 76), innerX + 66, by + 4)
      g.font = `400 11px ${FONT_SANS}`
      g.fillStyle = '#cbd5e1'
      g.fillText(fitText(g, block.sub, innerW - 18), innerX + 10, by + 25)
    })
  } else {
    const colW = (innerW - gap * 2) / 3
    blocks.forEach((block, idx) => {
      const bx = innerX + idx * (colW + gap)
      g.fillStyle = 'rgba(255, 255, 255, 0.06)'
      roundRectPath(g, bx, cardsY, colW, cardH, 8)
      g.fill()
      g.fillStyle = block.accent
      g.fillRect(bx, cardsY + 8, 3, cardH - 16)
      g.font = `600 11.5px ${FONT_SANS}`
      g.fillStyle = '#94a3b8'
      g.fillText(block.label, bx + 11, cardsY + 7)
      g.font = `700 13.5px ${FONT_MONO}`
      g.fillStyle = '#f8fafc'
      g.fillText(fitText(g, block.value, colW - 18), bx + 11, cardsY + 23)
      g.font = `400 11px ${FONT_SANS}`
      g.fillStyle = '#cbd5e1'
      g.fillText(fitText(g, block.sub, colW - 18), bx + 11, cardsY + 42)
    })
  }

  return {canvas: out, copy, fallback}
}

function encodeBase64UrlUtf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function captureNextWebGLFrame(timeoutMs = 1500): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      untap()
      resolve(null)
    }, timeoutMs)
    const untap = addFrameTap((canvas) => {
      if (settled || !canvas.width || !canvas.height) return
      settled = true
      clearTimeout(timer)
      untap()
      const snapshot = document.createElement('canvas')
      snapshot.width = canvas.width
      snapshot.height = canvas.height
      const copyCtx = snapshot.getContext('2d')
      if (!copyCtx) {
        resolve(null)
        return
      }
      copyCtx.drawImage(canvas, 0, 0)
      snapshot.style.filter = canvas.style.filter
      resolve(snapshot)
    })
  })
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality = 0.84): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
  })
}

const uploadedIds = new Set<string>()
let inflight = false

export async function triggerCheatCapture(
  packet: CheatCapturePacket,
  getContext: () => CaptureClientContext,
): Promise<boolean> {
  if (!packet?.id || !packet?.token) return false
  if (inflight || uploadedIds.has(packet.id)) return false
  inflight = true
  try {
    const context = getContext()
    const frame = await captureNextWebGLFrame(1500)
    const {canvas, copy, fallback} = renderEvidenceCanvas(frame, packet, context)
    const blob = await canvasToJpegBlob(canvas, 0.84)
    if (!blob || blob.size < 64) return false

    const meta = {
      stateLabel: context.stateLabel,
      activity: context.activity,
      activityDetail: context.activityDetail ?? '',
      speedMs: Number.isFinite(context.speedMs) ? +context.speedMs.toFixed(2) : 0,
      verticalSpeedMs: Number.isFinite(context.verticalSpeedMs) ? +(context.verticalSpeedMs ?? 0).toFixed(2) : 0,
      grounded: context.grounded,
      pos: [+context.x.toFixed(2), +context.y.toFixed(2), +context.z.toFixed(2)],
      landmark: copy.landmark?.name ?? '',
      landmarkDist: copy.landmark?.dist ?? null,
      fallback,
    }

    const response = await fetch('/api/mp/cheat-capture', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Cheat-Capture-Token': packet.token,
        'X-Cheat-Capture-Meta': encodeBase64UrlUtf8(JSON.stringify(meta)),
      },
      body: blob,
    })
    if (response.ok) {
      uploadedIds.add(packet.id)
      if (uploadedIds.size > 64) {
        const oldest = uploadedIds.values().next().value
        if (oldest) uploadedIds.delete(oldest)
      }
      return true
    }
    return false
  } catch {
    return false
  } finally {
    inflight = false
  }
}
