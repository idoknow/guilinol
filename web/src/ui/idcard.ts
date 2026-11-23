/**
 * 市民二代身份证
 *
 * · 卡号：450326 + 注册日期(YYYYMMDD) + 市民码（uid 里的数字，补足）
 * · 版面：赛璐璐风格（扁平色块 + 2px 深色描边 + 硬阴影），左侧信息，右侧人物画像，底部条形码
 * · 入口：市民卡开卡成功后 / 首页右上角 / 地址栏 #id=<卡号>
 */
import qrcode from 'qrcode-generator'
import './idcard.css'

interface CivicLike {
  uid: string
  name: string
  registeredAt?: number
  createdAt?: number
}

const PREFIX = '450326'

function hashString(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function digitsOf(text: string) {
  return text.replace(/\D/g, '')
}

export function idNumberFor(civic: CivicLike) {
  const stamp = new Date(civic.registeredAt ?? civic.createdAt ?? Date.now())
  const date = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}`
  const raw = digitsOf(civic.uid)
  const civicCode = (raw || '0000').slice(0, 4).padStart(4, '0')
  const tail = String(hashString(civic.uid) % 100).padStart(2, '0')
  return {number: `${PREFIX}${date}${civicCode}${tail}`, date, code: civicCode}
}

/** 赛璐璐头像：纯色块 + 描边，按外形参数画一个正面头肩像 */
function drawPortrait(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, civic: CivicLike) {
  let body = 'm'
  let hair = 'm_crop'
  let skin = 2
  let look = 'sport'
  try {
    const raw = JSON.parse(localStorage.getItem('glol.avatar.v1') ?? 'null')
    if (raw) {
      body = raw.body ?? body
      hair = raw.hair ?? hair
      skin = Number(raw.skin ?? skin)
      look = raw.look ?? look
    }
  } catch {
    /* 忽略 */
  }
  const skins = ['#f3d3b6', '#e8bd97', '#d9a97e', '#c08a5f', '#a86f47']
  const skinColor = skins[Math.max(0, Math.min(skins.length - 1, skin))] ?? '#e8bd97'
  const shirt = look === 'chinese' ? '#b03a2e' : look === 'campus' ? '#3b527a' : look === 'office' ? '#4a4f56' : look === 'outdoor' ? '#4f6b3a' : '#2f6b4f'
  const hairColor = body === 'f' ? '#2c2118' : '#1f1a16'
  const long = /pony|long|bob|wave|twin/i.test(hair)

  ctx.save()
  ctx.translate(x, y)
  // 底
  ctx.fillStyle = '#dfeae4'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#1c2b24'
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, w - 2, h - 2)
  // 肩
  ctx.beginPath()
  ctx.fillStyle = shirt
  ctx.arc(w / 2, h + 6, w * 0.52, Math.PI * 1.08, Math.PI * 1.92)
  ctx.fill()
  ctx.lineWidth = 2
  ctx.stroke()
  // 长发
  if (long) {
    ctx.beginPath()
    ctx.fillStyle = hairColor
    ctx.roundRect(w * 0.24, h * 0.2, w * 0.52, h * 0.62, 14)
    ctx.fill()
    ctx.stroke()
  }
  // 脖子
  ctx.beginPath()
  ctx.fillStyle = skinColor
  ctx.fillRect(w * 0.43, h * 0.62, w * 0.14, h * 0.16)
  ctx.stroke()
  // 头
  ctx.beginPath()
  ctx.fillStyle = skinColor
  ctx.ellipse(w / 2, h * 0.47, w * 0.21, h * 0.23, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = 2.5
  ctx.stroke()
  // 头发
  ctx.beginPath()
  ctx.fillStyle = hairColor
  ctx.ellipse(w / 2, h * 0.36, w * 0.215, h * 0.13, 0, Math.PI, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  // 眼睛
  ctx.fillStyle = '#1c2b24'
  ctx.beginPath()
  ctx.ellipse(w * 0.44, h * 0.48, 3, 3.6, 0, 0, Math.PI * 2)
  ctx.ellipse(w * 0.56, h * 0.48, 3, 3.6, 0, 0, Math.PI * 2)
  ctx.fill()
  // 嘴
  ctx.beginPath()
  ctx.strokeStyle = '#9c5c48'
  ctx.lineWidth = 2
  ctx.moveTo(w * 0.45, h * 0.56)
  ctx.quadraticCurveTo(w / 2, h * 0.59, w * 0.55, h * 0.56)
  ctx.stroke()
  ctx.restore()
}

export function shareUrl(number: string) {
  const base = location.origin && location.origin !== 'null' ? location.origin : 'https://guiling.gxufl.top'
  return `${base}/id.html?id=${number}`
}

/** 四角桂树纹样：一个花枝 + 三片叶子，纯线条平涂 */
function drawOsmanthus(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, flip: 1 | -1, color: string) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(flip, 1)
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  // 枝
  ctx.beginPath()
  ctx.moveTo(-size * 0.5, size * 0.42)
  ctx.quadraticCurveTo(0, size * 0.1, size * 0.45, -size * 0.4)
  ctx.stroke()
  // 叶子
  for (const [dx, dy, rot] of [
    [-0.1, -0.1, -0.7],
    [0.22, -0.28, 0.35],
    [0.02, 0.22, 1.9],
  ] as [number, number, number][]) {
    ctx.save()
    ctx.translate(dx * size, dy * size)
    ctx.rotate(rot)
    ctx.beginPath()
    ctx.ellipse(0, 0, size * 0.3, size * 0.14, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  // 花点
  ctx.fillStyle = color
  for (const [dx, dy] of [
    [0.3, -0.05],
    [0.42, -0.24],
    [0.12, -0.3],
  ] as [number, number][]) {
    ctx.beginPath()
    ctx.arc(dx * size, dy * size, 1.9, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** 模拟钢印：圆形压痕 + 高光 + 环形文字，压在照片与卡片交界处 */
function drawSteelStamp(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
  ctx.save()
  // 压痕底：半透明白 + 内阴影，形成凹陷感
  const grad = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.3, radius * 0.1, cx, cy, radius)
  grad.addColorStop(0, 'rgba(255,255,255,0.34)')
  grad.addColorStop(0.62, 'rgba(226,236,229,0.18)')
  grad.addColorStop(1, 'rgba(120,140,128,0.05)')
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fillStyle = grad
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(88,110,98,0.5)'
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, radius - 7, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  // 环形文字
  const text = '网上桂林 · 官方认证 · GUILIN ONLINE ·'
  ctx.fillStyle = 'rgba(64,86,74,0.72)'
  ctx.font = '700 11px system-ui,-apple-system,"PingFang SC",sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const chars = [...text]
  const step = (Math.PI * 2) / chars.length
  chars.forEach((ch, index) => {
    const angle = -Math.PI / 2 + index * step
    ctx.save()
    ctx.translate(cx + Math.cos(angle) * (radius - 16), cy + Math.sin(angle) * (radius - 16))
    ctx.rotate(angle + Math.PI / 2)
    ctx.fillText(ch, 0, 0)
    ctx.restore()
  })
  // 中间五角星 + 高光弧
  ctx.beginPath()
  ctx.fillStyle = 'rgba(64,86,74,0.6)'
  for (let i = 0; i < 5; i++) {
    const outer = radius * 0.34
    const inner = outer * 0.42
    const a1 = -Math.PI / 2 + (i * Math.PI * 2) / 5
    const a2 = a1 + Math.PI / 5
    ctx.lineTo(cx + Math.cos(a1) * outer, cy + Math.sin(a1) * outer)
    ctx.lineTo(cx + Math.cos(a2) * inner, cy + Math.sin(a2) * inner)
  }
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx, cy, radius - 3, -Math.PI * 0.9, -Math.PI * 0.1)
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 2.5
  ctx.stroke()
  ctx.restore()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

/** 真二维码：qrcode-generator 生成矩阵，按模块画方块（ECC M，容错够用） */
function drawQR(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, text: string) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const count = qr.getModuleCount()
  const quiet = 2
  const cell = size / (count + quiet * 2)
  ctx.save()
  ctx.fillStyle = '#fff'
  ctx.fillRect(x, y, size, size)
  ctx.fillStyle = '#10211b'
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (!qr.isDark(r, c)) continue
      ctx.fillRect(x + (c + quiet) * cell, y + (r + quiet) * cell, Math.ceil(cell), Math.ceil(cell))
    }
  }
  ctx.restore()
}

/** 条形码图案（宽度由卡号散列决定；微信扫不出网页，只作版面识别用） */
function drawBarcode(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: string) {
  let h2 = hashString(seed)
  ctx.save()
  ctx.fillStyle = '#10211b'
  let cursor = x
  while (cursor < x + w) {
    h2 = Math.imul(h2 ^ (h2 >>> 13), 1274126177) >>> 0
    const bar = 1 + (h2 % 3)
    const gap = 1 + ((h2 >>> 3) % 3)
    ctx.fillRect(cursor, y, bar, h)
    cursor += bar + gap
  }
  ctx.restore()
}

/** 性别从捏脸数据里的体型读（body: m / f） */
function genderOf() {
  try {
    const raw = JSON.parse(localStorage.getItem('glol.avatar.v1') ?? 'null')
    if (raw && raw.body === 'f') return '女'
    if (raw && raw.body === 'm') return '男'
  } catch {
    /* 忽略 */
  }
  return '男'
}

/** 只要画布（独立页面用）：不弹层、不挂遮罩 */
export async function renderIdCardCanvas(
  civic: CivicLike,
  opts: {number?: string; gender?: string; photoUrl?: string; photoData?: string} = {},
) {
  const {canvas} = await renderCard(civic as CivicLike, opts)
  return canvas
}

/** 这张卡是不是本机的（是才用真实大头照） */
function isOwnCard(civic: CivicLike) {
  try {
    const raw = JSON.parse(localStorage.getItem('guiling.civic.v1') ?? 'null')
    return !!raw && raw.uid === civic.uid
  } catch {
    return false
  }
}

async function renderCard(civic: CivicLike, opts: {number?: string; gender?: string; photoUrl?: string; photoData?: string} = {}) {
  const idInfo = idNumberFor(civic)
  const number = opts.number && /^450326\d{14}$/.test(opts.number) ? opts.number : idInfo.number
  const date = number.slice(6, 14)
  const code = number.slice(14, 18)
  const W = 1120
  const H = 690
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  // 卡面：低饱和青灰绿平涂 + 大圆角
  const R = 34
  ctx.fillStyle = '#7d9a90'
  ctx.beginPath()
  ctx.roundRect(0, 0, W, H, R)
  ctx.fill()
  // 内层浅色信息区（同一张卡上的色块分区，不做渐变）
  ctx.fillStyle = '#f2f6f1'
  ctx.beginPath()
  ctx.roundRect(28, 118, W - 56, H - 156, 22)
  ctx.fill()
  // 白色硬勾线（赛璐璐标志）
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(9, 9, W - 18, H - 18, R - 7)
  ctx.stroke()
  // 外层极淡深色描边，把卡片和背景分开
  ctx.strokeStyle = 'rgba(16,33,27,.28)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(1.5, 1.5, W - 3, H - 3, R - 1)
  ctx.stroke()
  // 顶部色带
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(0, 0, W, 100, [R, R, 0, 0])
  ctx.clip()
  ctx.fillStyle = '#3f6b5e'
  ctx.fillRect(0, 0, W, 100)
  ctx.restore()
  ctx.fillStyle = '#9bf7c9'
  ctx.fillRect(0, 100, W, 5)
  ctx.strokeStyle = '#16261e'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(0, 97)
  ctx.lineTo(W, 97)
  ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.font = '800 40px system-ui,-apple-system,"PingFang SC",sans-serif'
  ctx.fillText('桂林市市民身份证', 92, 62)
  ctx.font = '500 17px ui-monospace,monospace'
  ctx.fillStyle = '#bfe8d5'
  ctx.fillText('GUILIN · CITIZEN ID · SECOND GENERATION', 92, 84)
  // 四角桂树纹样（赛璐璐单线平涂）
  const corners: [number, number, 1 | -1][] = [
    [40, 74, 1],
    [W - 40, 44, -1],
    [40, H - 44, 1],
    [W - 40, H - 44, -1],
  ]
  for (const [cx, cy, flip] of corners) {
    drawOsmanthus(ctx, cx, cy, 12, flip, cy < H / 2 ? '#ffffff' : '#3d5b52')
  }

  // 左栏信息
  const rows: [string, string][] = [
    ['姓　　名', civic.name],
    ['性　　别', opts.gender ?? genderOf()],
    ['注册时间', `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`],
    ['市 民 码', `GL${civic.uid.slice(0, 8).toUpperCase()}`],
    ['身份证号', number],
  ]
  let y = 168
  for (const [label, value] of rows) {
    ctx.fillStyle = '#5c7568'
    ctx.font = '500 20px system-ui,-apple-system,"PingFang SC",sans-serif'
    ctx.fillText(label, 48, y)
    ctx.fillStyle = '#16261e'
    ctx.font = '700 30px system-ui,-apple-system,"PingFang SC",sans-serif'
    ctx.fillText(value, 210, y)
    y += 68
  }
  // 小字说明
  ctx.fillStyle = '#8a9c92'
  ctx.font = '400 15px system-ui,-apple-system,"PingFang SC",sans-serif'
  ctx.fillText('本证由「网上桂林」二创站签发，仅用于站内身份识别', 48, y + 6)
  ctx.fillText('GXGL-' + code, 48, y + 32)

  // 右栏画像
  // 真实角色大头照（离屏渲染）；没有就退回手绘
  // 照片三级回退：① 服务器上那张（任何设备都能看到） ② 本机现渲染 ③ 手绘头像
  const loadImage = (src: string) =>
    new Promise<HTMLImageElement | null>(resolve => {
      const image = new Image()
      image.onload = () => resolve(image.naturalWidth > 0 ? image : null)
      image.onerror = () => resolve(null)
      image.src = src
    })
  let photo: HTMLImageElement | null = null
  if (opts.photoData) photo = await loadImage(opts.photoData)
  if (!photo && opts.photoUrl) photo = await loadImage(opts.photoUrl)
  if (!photo) {
    try {
      const data = await (await import('./portrait')).characterPortrait()
      if (data) photo = await loadImage(data)
    } catch {
      photo = null
    }
  }
  if (photo && photo.naturalWidth > 0) {
    ctx.save()
    ctx.fillStyle = '#dfeae4'
    ctx.fillRect(W - 400, 150, 300, 400)
    // 人像缩到相框的 78% 居中放（之前是撑满，显得太大）
    const frameW = 300
    const frameH = 400
    const fill = 0.93
    const scale = Math.min((frameW * fill) / photo.naturalWidth, (frameH * fill) / photo.naturalHeight)
    const dw = photo.naturalWidth * scale
    const dh = photo.naturalHeight * scale
    ctx.drawImage(photo, W - 400 + (frameW - dw) / 2, 150 + (frameH - dh) / 2, dw, dh)
    ctx.strokeStyle = '#1c2b24'
    ctx.lineWidth = 2
    ctx.strokeRect(W - 400, 150, 300, 400)
    ctx.restore()
  } else {
    drawPortrait(ctx, W - 400 + 10, 150 + 12, 280, 376, civic)
  }

  // 官方认证钢印：压在照片与卡片交界处（照片左边缘 + 底部）
  drawSteelStamp(ctx, W - 400 + 34, 150 + 400 - 40, 74)

  // 真二维码：微信扫一扫直接打开 /id.html?id=<卡号>
  drawQR(ctx, W - 236, H - 244, 168, shareUrl(number))
  ctx.fillStyle = '#41544a'
  ctx.font = '500 15px system-ui,-apple-system,"PingFang SC",sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('微信扫一扫 · 电子身份证', W - 152, H - 58)
  ctx.textAlign = 'left'
  // 底部条形码（版面装饰）
  drawBarcode(ctx, 48, H - 96, W - 500, 48, number)
  ctx.fillStyle = '#41544a'
  ctx.font = '500 16px ui-monospace,monospace'
  ctx.fillText(number, 48, H - 20)

  return {canvas, number}
}

let mask: HTMLElement | null = null

export async function openIdCard(civic?: CivicLike | null) {
  const who = civic ?? (() => {
    try {
      return JSON.parse(localStorage.getItem('guiling.civic.v1') ?? 'null') as CivicLike | null
    } catch {
      return null
    }
  })()
  if (!who || !who.uid) {
    alert('还没有市民卡，请先开卡')
    return
  }
  const provisional = idNumberFor(who).number
  const {canvas, number} = await renderCard(who, {photoUrl: '/api/citizen/photo?id=' + provisional})
  if (!mask) {
    mask = document.createElement('div')
    mask.className = 'idcard-mask'
    mask.innerHTML = `
      <div class="idcard-panel">
        <button class="idcard-close" type="button" aria-label="关闭">×</button>
        <div class="idcard-canvas"></div>
        <div class="idcard-actions">
          <button type="button" class="idcard-save">保存图片</button>
        </div>
      </div>`
    document.body.append(mask)
    mask.querySelector('.idcard-close')!.addEventListener('click', () => {
      mask!.hidden = true
    })
    mask.addEventListener('click', event => {
      if (event.target === mask) mask!.hidden = true
    })
  }
  // 自己的卡：把大头照传到服务器，别人扫码才能看到真人（每天最多传一次）
  if (isOwnCard(who)) {
    void (async () => {
      try {
        const key = 'guiling.photo.' + number
        if (localStorage.getItem(key)) return
        const data = await (await import('./portrait')).characterPortrait()
        if (!data) return
        const response = await fetch('/api/citizen/photo', {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({id: number, portrait: data}),
        })
        if (response.ok) localStorage.setItem(key, '1')
      } catch {
        /* 传不上去就算了 */
      }
    })()
  }
  const holder = mask.querySelector<HTMLElement>('.idcard-canvas')!
  holder.replaceChildren(canvas)
  mask.hidden = false
  const save = mask.querySelector<HTMLButtonElement>('.idcard-save')!
  save.onclick = () => {
    const link = document.createElement('a')
    link.download = `市民身份证-${number}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

}

/** 地址栏 #id=450326… 时直接打开大图 */
export function openIdCardFromHash() {
  const match = /^#id=(\d+)/.exec(location.hash)
  if (!match) return
  let civic: CivicLike | null = null
  try {
    civic = JSON.parse(localStorage.getItem('guiling.civic.v1') ?? 'null')
  } catch {
    civic = null
  }
  if (civic && idNumberFor(civic).number === match[1]) {
    openIdCard(civic)
    return
  }
  // 不是本机市民卡：用卡号反推一个只读展示（姓名未知时显示卡号）
  openIdCard({uid: match[1].slice(-6) || '000000', name: '市民', registeredAt: Date.now()})
}
