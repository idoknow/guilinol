import type {DroneSpec} from './specs'

// IDOK-527/530: 空中导航盘。原来叫「雷达」，只在穿越机上才把飞行物扫出来；现在改成**地图**：
// 盘面上永远能看到机库、自己、玩家、所有飞行物（起飞的无人机/观光直升机…）和附近景点，
// 而扫描扇面留着当动效 —— 扇面扫过飞行物时给它一个亮环，扫完也照样看得见。
// 点一下盘面就是「在地图上选个点」，飞控会把它当成导航目标（可以接着按自动飞过去）。
export type MarkKind = 'self' | 'air' | 'player' | 'home' | 'spot'

export interface NavMark {
  kind:MarkKind
  label:string
  x:number
  z:number
  /** 飞行物的离地高度（米），只有 kind==='air' 时有意义。 */
  agl?:number
}

export interface NavTarget {label:string; x:number; z:number; picked?:boolean}

export interface NavState {
  /** 自己的位置与机头朝向（rad，正北为 0，逆时针增加，与 flight.yaw 同号）。 */
  x:number
  z:number
  yaw:number
  marks:NavMark[]
  target:NavTarget|null
  /** 是否画扫描扇面（穿越机）。 */
  radar:boolean
  range:number
  auto:boolean
}

export interface NavHandlers {
  cycle():void
  auto():void
  /** IDOK-530: 在地图上点了一个坐标（世界坐标，米）。 */
  pick(x:number, z:number):void
}

export interface NavView {
  root:HTMLElement
  update(state:NavState):void
}

const TONE:Record<MarkKind,string> = {
  self:'#f4efe2',
  air:'#e0a63f',
  player:'#cfe3f5',
  home:'#8fd08f',
  spot:'#7fb8d8',
}

const SWEEP_MS = 2600
const HOLD_MS = 3000

export function createNav(spec:DroneSpec, handlers:NavHandlers):NavView {
  const root = document.createElement('div')
  root.className = `rc-nav rc-nav--${spec.id}`
  root.innerHTML = `
    <div class="rc-nav-head"><span class="rc-nav-kicker">地图</span><button class="rc-nav-tg" type="button"></button></div>
    <canvas class="rc-nav-map" width="132" height="132" aria-label="飞行地图（点一下选导航点）"></canvas>
    <div class="rc-nav-foot"><span class="rc-nav-dist">—</span><span class="rc-nav-brg"></span></div>
    <button class="rc-nav-auto" type="button">自动飞</button>`
  const canvas = root.querySelector<HTMLCanvasElement>('.rc-nav-map')!
  const kicker = root.querySelector<HTMLElement>('.rc-nav-kicker')!
  const toggle = root.querySelector<HTMLElement>('.rc-nav-tg')!
  const distText = root.querySelector<HTMLElement>('.rc-nav-dist')!
  const brgText = root.querySelector<HTMLElement>('.rc-nav-brg')!
  const autoButton = root.querySelector<HTMLButtonElement>('.rc-nav-auto')!
  toggle.onclick = () => handlers.cycle()
  autoButton.onclick = () => handlers.auto()

  const ctx = canvas.getContext('2d')!
  /** 每个飞行器上一次被扫到的时刻，扇面扫过时给它一个亮环（位置仍然一直显示）。 */
  const seen = new Map<string, number>()
  let sweepBearing = 0
  let last = performance.now()
  let state:NavState|null = null

  const key = (mark:NavMark) => `${mark.kind}:${mark.label}`
  const wrap = (angle:number) => ((angle % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI

  // IDOK-530: 点盘面 = 选点。屏幕位移换算回世界坐标（正北朝上，所以 -z 向上）。
  canvas.addEventListener('pointerup',event => {
    if (!state) return
    const rect = canvas.getBoundingClientRect()
    const half = rect.width / 2
    const unit = (half - 2) / state.range
    const dx = (event.clientX - rect.left - half) / unit
    const dz = (event.clientY - rect.top - half) / unit
    handlers.pick(state.x + dx,state.z + dz)
  })

  function draw(current:NavState) {
    const now = performance.now()
    const dt = Math.min(120,now - last)
    last = now
    // 扇面按方位角走：0 = 正北，顺时针一圈。地图模式下也留着，只当动效。
    sweepBearing = (sweepBearing + dt / SWEEP_MS * Math.PI * 2) % (Math.PI * 2)

    const dpr = Math.min(2,window.devicePixelRatio || 1)
    const box = canvas.clientWidth || 132
    if (canvas.width !== Math.round(box * dpr)) {
      canvas.width = Math.round(box * dpr)
      canvas.height = Math.round(box * dpr)
    }
    const size = canvas.width
    ctx.setTransform(1,0,0,1,0,0)
    ctx.clearRect(0,0,size,size)
    ctx.scale(dpr,dpr)
    const half = size / dpr / 2
    const R = half - 2
    const unit = R / current.range

    // 盘面
    const disc = ctx.createRadialGradient(half,half,half * .1,half,half,half)
    disc.addColorStop(0,'rgba(16,26,28,.62)')
    disc.addColorStop(1,'rgba(10,16,18,.78)')
    ctx.fillStyle = disc
    ctx.beginPath(); ctx.arc(half,half,half,0,Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(244,239,226,.16)'
    ctx.lineWidth = 1
    for (const ring of [.5,1]) {
      ctx.beginPath(); ctx.arc(half,half,half * ring,0,Math.PI * 2); ctx.stroke()
    }
    ctx.beginPath(); ctx.moveTo(half,half - half); ctx.lineTo(half,half + half); ctx.moveTo(half - half,half); ctx.lineTo(half + half,half); ctx.stroke()
    // 正北
    ctx.fillStyle = 'rgba(244,239,226,.7)'
    ctx.font = `600 ${Math.round(9)}px ui-sans-serif,system-ui,sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText('N',half,2)

    // 扫描扇面（穿越机）
    if (current.radar) {
      const wedge = ctx.createRadialGradient(half,half,0,half,half,half)
      wedge.addColorStop(0,'rgba(120,220,160,.30)')
      wedge.addColorStop(1,'rgba(120,220,160,0)')
      ctx.fillStyle = wedge
      ctx.beginPath(); ctx.moveTo(half,half)
      ctx.arc(half,half,half,sweepBearing - Math.PI / 2 - .55,sweepBearing - Math.PI / 2)
      ctx.closePath(); ctx.fill()
      ctx.strokeStyle = 'rgba(140,235,175,.55)'
      ctx.beginPath(); ctx.moveTo(half,half)
      ctx.lineTo(half + Math.cos(sweepBearing - Math.PI / 2) * half,half + Math.sin(sweepBearing - Math.PI / 2) * half)
      ctx.stroke()
    }

    const project = (x:number,z:number) => {
      const dx = (x - current.x) * unit
      const dz = (z - current.z) * unit
      return {x:half + dx,y:half + dz,d:Math.hypot(dx,dz)}
    }

    for (const mark of current.marks) {
      if (mark.kind === 'self') continue
      const spot = project(mark.x,mark.z)
      const inside = spot.d <= R + .5
      // 地图：盘面外的东西压到边缘上画个半透明的，让飞行员知道方向（不再像雷达那样直接消失）。
      const edge = inside ? null : R / spot.d
      const px = inside ? spot.x : half + (spot.x - half) * edge!
      const py = inside ? spot.y : half + (spot.y - half) * edge!
      let alpha = inside ? 1 : .38
      if (mark.kind === 'air') {
        // 扇面扫过的瞬间给个亮环，扫完也照样显示（地图模式）。
        const bearing = (Math.atan2(mark.x - current.x,-(mark.z - current.z)) + Math.PI * 2) % (Math.PI * 2)
        if (Math.abs(wrap(sweepBearing - bearing)) < .2) seen.set(key(mark),now)
        const hit = seen.get(key(mark))
        if (hit !== undefined && now - hit < HOLD_MS) alpha = Math.min(1,.55 + (1 - (now - hit) / HOLD_MS) * .45)
      }
      const label = mark.kind === 'air'
        ? `${mark.label} ${fmtRange(Math.hypot(mark.x - current.x,mark.z - current.z))}`
        : mark.label
      drawMark(ctx,px,py,TONE[mark.kind],mark.kind,alpha,label,half * 2)
    }

    if (current.target) {
      const spot = project(current.target.x,current.target.z)
      const clampedX = half + (spot.x - half) * Math.min(1,R / Math.max(spot.d,.0001))
      const clampedY = half + (spot.y - half) * Math.min(1,R / Math.max(spot.d,.0001))
      ctx.strokeStyle = 'rgba(244,239,226,.5)'
      ctx.setLineDash([3,3])
      ctx.beginPath(); ctx.moveTo(half,half); ctx.lineTo(clampedX,clampedY); ctx.stroke()
      ctx.setLineDash([])
      ctx.strokeStyle = current.target.picked ? '#7fb8d8' : '#f4efe2'
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(clampedX,clampedY,4.5,0,Math.PI * 2); ctx.stroke()
    }

    // 自己：三角形照着机头方向转（yaw 越大越往西，屏幕即逆时针）
    ctx.save()
    ctx.translate(half,half)
    ctx.rotate(-current.yaw)
    ctx.fillStyle = '#f4efe2'
    ctx.beginPath(); ctx.moveTo(0,-6); ctx.lineTo(4.4,4.6); ctx.lineTo(0,2.4); ctx.lineTo(-4.4,4.6); ctx.closePath(); ctx.fill()
    ctx.restore()
  }

  function update(next:NavState) {
    state = next
    const label = next.target?.label ?? '选目标'
    toggle.textContent = label
    const nearby = next.marks.filter(mark => mark.kind === 'air'
      && Math.hypot(mark.x - next.x,mark.z - next.z) <= next.range).length
    // 地图上把「附近有几架飞行物」报出来，扫掠只是动效。
    kicker.textContent = `${next.radar ? '雷达' : '地图'}${nearby ? ` ${nearby}` : ''} · ${fmtRange(next.range)}`
    if (next.target) {
      const dist = Math.hypot(next.target.x - next.x,next.target.z - next.z)
      const bearing = (Math.atan2(next.target.x - next.x,-(next.target.z - next.z)) * 180 / Math.PI + 360) % 360
      distText.textContent = `${dist >= 1000 ? (dist / 1000).toFixed(2) + ' km' : Math.round(dist) + ' m'}`
      brgText.textContent = `${['北','东北','东','东南','南','西南','西','西北'][Math.round(bearing / 45) % 8]} ${Math.round(bearing)}°`
    } else {
      distText.textContent = '—'
      brgText.textContent = '点地图选点'
    }
    autoButton.classList.toggle('on',next.auto)
    autoButton.textContent = next.auto ? '取消自动' : '自动飞'
    autoButton.hidden = !next.target
    root.dataset.radar = next.radar ? '1' : '0'
    root.dataset.picked = next.target?.picked ? '1' : '0'
    draw(next)
  }

  return {root,update}
}

function fmtRange(meters:number) {
  if (meters < 1000) return `${Math.round(meters)}m`
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)}km`
}

function drawMark(ctx:CanvasRenderingContext2D, x:number, y:number, tone:string, kind:MarkKind, alpha:number, label:string, limit = Infinity) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = tone
  ctx.strokeStyle = tone
  ctx.lineWidth = 1.2
  if (kind === 'home') {
    ctx.strokeRect(x - 3.2,y - 3.2,6.4,6.4)
  } else if (kind === 'air') {
    ctx.beginPath(); ctx.moveTo(x,y - 4.6); ctx.lineTo(x + 4,y); ctx.lineTo(x,y + 4.6); ctx.lineTo(x - 4,y); ctx.closePath(); ctx.fill()
  } else if (kind === 'player') {
    ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI * 2); ctx.fill()
  } else {
    ctx.beginPath(); ctx.arc(x,y,2.6,0,Math.PI * 2); ctx.stroke()
  }
  if (kind === 'air' && alpha > .35) {
    ctx.globalAlpha = Math.min(1,alpha)
    ctx.font = '600 8px ui-sans-serif,system-ui,sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    // 靠右边缘的亮点把标签翻到左边，别被盘面裁掉
    const width = ctx.measureText(label).width
    const flipped = x + 6 + width > limit - 2
    if (flipped) ctx.textAlign = 'right'
    ctx.fillText(label,flipped ? x - 6 : x + 6,y)
  }
  ctx.restore()
}
