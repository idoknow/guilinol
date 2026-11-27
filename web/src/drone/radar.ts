import type {DroneSpec} from './specs'

// IDOK-527: 空中导航 + 小地图 + 穿越机雷达。
// 小小一块玻璃，圆心永远是自己（正北朝上），俯视半径 `range` 米：
//   · 小地图：所有飞行器（自己 / 同场景的直升机）、玩家、机库，以及附近景点；
//   · 雷达：只有 FPV 穿越机才有的扫描扇面，扫到飞机就在盘面上留一个三秒的亮点；
//   · 导航：目标名 + 距离 + 方位，`自动飞` 让飞控自己转过去（按住摇杆即接管）。
export type MarkKind = 'self' | 'air' | 'player' | 'home' | 'spot'

export interface NavMark {
  kind:MarkKind
  label:string
  x:number
  z:number
  /** 飞行物的离地高度（米），只有 kind==='air' 时有意义。 */
  agl?:number
}

export interface NavTarget {label:string; x:number; z:number}

export interface NavState {
  /** 自己的位置与机头朝向（rad，正北为 0，逆时针增加，与 flight.yaw 同号）。 */
  x:number
  z:number
  yaw:number
  marks:NavMark[]
  target:NavTarget|null
  /** FPV 才有扫描扇面。 */
  radar:boolean
  range:number
  auto:boolean
}

export interface NavHandlers {
  cycle():void
  auto():void
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
    <div class="rc-nav-head"><span class="rc-nav-kicker">${spec.id === 'fpv' ? '雷达' : '小地图'}</span><button class="rc-nav-tg" type="button"></button></div>
    <canvas class="rc-nav-map" width="132" height="132" aria-label="飞行器小地图"></canvas>
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
  /** 每个飞行器上一次被扫到的时刻，雷达亮点据此淡出。 */
  const seen = new Map<string, number>()
  let sweepBearing = 0
  let last = performance.now()

  const key = (mark:NavMark) => `${mark.kind}:${mark.label}`
  const wrap = (angle:number) => ((angle % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI

  function draw(state:NavState) {
    const now = performance.now()
    const dt = Math.min(120,now - last)
    last = now
    // 扇面按方位角走：0 = 正北，顺时针一圈。
    if (state.radar) sweepBearing = (sweepBearing + dt / SWEEP_MS * Math.PI * 2) % (Math.PI * 2)

    const dpr = Math.min(2,window.devicePixelRatio || 1)
    const box = canvas.clientWidth || 132
    if (canvas.width !== Math.round(box * dpr)) {
      canvas.width = Math.round(box * dpr)
      canvas.height = Math.round(box * dpr)
    }
    const size = canvas.width
    const c = size / 2
    const radius = c - 2 * dpr
    ctx.setTransform(1,0,0,1,0,0)
    ctx.clearRect(0,0,size,size)
    ctx.scale(dpr,dpr)
    const half = size / dpr / 2
    const R = radius / dpr
    const unit = R / state.range

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

    // 扫描扇面
    if (state.radar) {
      const wedge = ctx.createRadialGradient(half,half,0,half,half,half)
      wedge.addColorStop(0,'rgba(120,220,160,.32)')
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
      const dx = (x - state.x) * unit
      const dz = (z - state.z) * unit
      return {x:half + dx,y:half + dz,d:Math.hypot(dx,dz)}
    }

    for (const mark of state.marks) {
      if (mark.kind === 'self') continue
      const spot = project(mark.x,mark.z)
      const inside = spot.d <= R + .5
      const flying = mark.kind === 'air'
      let alpha = inside ? 1 : .22
      if (state.radar && flying) {
        // 方位：正北为 0，顺时针（屏幕坐标里 +z 向南）
        const bearing = (Math.atan2(mark.x - state.x,-(mark.z - state.z)) + Math.PI * 2) % (Math.PI * 2)
        if (inside && Math.abs(wrap(sweepBearing - bearing)) < .2) seen.set(key(mark),now)
        // 扫到过一次就记住位置（亮度下限 .36），不然扇面转过之后盘面上一片空。
        const hit = seen.get(key(mark))
        alpha = inside ? (hit === undefined ? 0 : Math.max(.36,1 - (now - hit) / HOLD_MS)) : .18
        if (alpha <= .02) continue
      } else if (mark.kind === 'air' && !inside) {
        continue
      }
      // 飞行物的标签带上距离：雷达要回答的是「附近有什么、多远」。
      const label = mark.kind === 'air'
        ? `${mark.label} ${fmtRange(Math.hypot(mark.x - state.x,mark.z - state.z))}`
        : mark.label
      drawMark(ctx,spot.x,spot.y,TONE[mark.kind],mark.kind,alpha,label,half * 2)
    }

    if (state.target) {
      const spot = project(state.target.x,state.target.z)
      const clampedX = half + (spot.x - half) * Math.min(1,R / Math.max(spot.d,.0001))
      const clampedY = half + (spot.y - half) * Math.min(1,R / Math.max(spot.d,.0001))
      ctx.strokeStyle = 'rgba(244,239,226,.5)'
      ctx.setLineDash([3,3])
      ctx.beginPath(); ctx.moveTo(half,half); ctx.lineTo(clampedX,clampedY); ctx.stroke()
      ctx.setLineDash([])
      ctx.strokeStyle = '#f4efe2'
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(clampedX,clampedY,4.5,0,Math.PI * 2); ctx.stroke()
    }

    // 自己：三角形照着机头方向转（yaw 越大越往西，屏幕即逆时针）
    ctx.save()
    ctx.translate(half,half)
    ctx.rotate(-state.yaw)
    ctx.fillStyle = '#f4efe2'
    ctx.beginPath(); ctx.moveTo(0,-6); ctx.lineTo(4.4,4.6); ctx.lineTo(0,2.4); ctx.lineTo(-4.4,4.6); ctx.closePath(); ctx.fill()
    ctx.restore()
  }

  function update(state:NavState) {
    const label = state.target?.label ?? '选目标'
    toggle.textContent = label
    // 盘面上报了到几架飞机——「扫描到附近的飞行物」得有个数字，不然扇面只是装饰。
    const nearby = state.marks.filter(mark => mark.kind === 'air'
      && Math.hypot(mark.x - state.x,mark.z - state.z) <= state.range).length
    kicker.textContent = `${state.radar ? '雷达' : '小地图'}${nearby ? ` ${nearby}` : ''} · ${fmtRange(state.range)}`
    if (state.target) {
      const dist = Math.hypot(state.target.x - state.x,state.target.z - state.z)
      const bearing = (Math.atan2(state.target.x - state.x,-(state.target.z - state.z)) * 180 / Math.PI + 360) % 360
      distText.textContent = `${dist >= 1000 ? (dist / 1000).toFixed(2) + ' km' : Math.round(dist) + ' m'}`
      brgText.textContent = `${['北','东北','东','东南','南','西南','西','西北'][Math.round(bearing / 45) % 8]} ${Math.round(bearing)}°`
    } else {
      distText.textContent = '—'
      brgText.textContent = ''
    }
    autoButton.classList.toggle('on',state.auto)
    autoButton.textContent = state.auto ? '取消自动' : '自动飞'
    autoButton.hidden = !state.target
    root.dataset.radar = state.radar ? '1' : '0'
    draw(state)
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
