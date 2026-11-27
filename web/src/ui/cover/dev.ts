// 开发预览页：全屏挂载 + stats；?tier=low|mid|high  ?reduced=1  ?safe=520（左侧菜单宽）  ?bottom=480（竖屏底部菜单高）  ?right=N（横屏右侧菜单宽，默认 0）  ?tod=0..1（定住时间）
// window.coverDbg：无头截图用（tod / hover / tap）
import {coverDebug} from './debug'
import {mountCover, type Cover, type CoverTier} from './index'

const q = new URLSearchParams(location.search)
const host = document.getElementById('host')!
const statsEl = document.getElementById('stats')!
const hoverEl = document.getElementById('hover')!
const safeEl = document.getElementById('safe')!
const safeB = document.getElementById('safeB')!
const tier = (['low', 'mid', 'high'] as const).find((t) => t === q.get('tier')) as CoverTier | undefined
const left = Number(q.get('safe') ?? 0)
const bottom = Number(q.get('bottom') ?? 0)
const right = Number(q.get('right') ?? 0)
safeEl.style.width = left + 'px'
safeB.style.height = bottom + 'px'

let cover: Cover | null = null
let log = ''
const t0 = performance.now()
try {
  cover = mountCover(host, {
    reduced: q.get('reduced') === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches,
    tier,
    safe: {left, right, bottom},
    ignore: (t) => !!t.closest('#stats'),
    onReady: () => ((log = `ready ${(performance.now() - t0).toFixed(0)} ms`), document.body.dataset.ready = '1'),
    onHover: (n) => (hoverEl.textContent = n ?? ''),
    onLost: () => (log = 'context lost'),
  })
  ;(window as unknown as {cover: Cover}).cover = cover
  ;(window as unknown as {coverDbg: unknown}).coverDbg = coverDebug.get(cover)
  if (q.has('tod')) coverDebug.get(cover)?.tod?.(Number(q.get('tod')))
} catch (e) {
  log = 'WebGL 不可用：' + (e as Error).message
}

const btn = document.createElement('button')
btn.textContent = 'dispose'
btn.onclick = () => {
  if (!cover) return
  const dbg = coverDebug.get(cover)
  cover.dispose()
  const d = dbg?.disposed
  log = d ? `disposed: geo ${d.before.geometries}→${d.after.geometries}  tex ${d.before.textures}→${d.after.textures}` : 'disposed'
  cover = null
}

function tick() {
  const s = cover?.stats()
  const m = cover ? coverDebug.get(cover)?.memory() : null
  statsEl.textContent = s
    ? `fps ${s.fps}\ncalls ${s.calls}\ntris ${(s.triangles / 1000).toFixed(1)}k\ntier ${s.tier}\ndpr ${s.dpr}\ngeo ${m?.geometries} tex ${m?.textures} prog ${m?.programs}\n${log}\n`
    : log + '\n'
  statsEl.append(btn)
  setTimeout(tick, 500)
}
tick()
addEventListener('resize', () => {
  // 竖屏/横屏切换时示范 setSafeArea
  if (!cover || q.get('auto') !== '1') return
  const portrait = innerHeight > innerWidth
  cover.setSafeArea(portrait ? {left: 0, right: 0, bottom: bottom || innerHeight * 0.55} : {left, right, bottom: 0})
})
