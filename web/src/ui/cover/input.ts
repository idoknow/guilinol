// 指针/触屏/滚轮：全部挂在同一个 AbortSignal 上。触屏竖直为主的手势直接放弃（交给页面 pan-y）。
export interface InputSink {
  /** 鼠标移动（NDC），用于视差与悬停；null = 离开或在 UI 上 */
  hover(nx: number, ny: number, mouse: boolean): void
  leave(): void
  grab(): void
  drag(dx: number, dy: number, dt: number): void
  release(): void
  zoom(delta: number): void
  tap(nx: number, ny: number): void
  /** 当前是否悬停在地标上（决定 pointer 光标） */
  hot(): boolean
}

const TAP_PX = 6, TAP_MS = 350

export function bindInput(
  surface: HTMLElement,
  canvas: HTMLCanvasElement,
  ignore: ((t: Element) => boolean) | undefined,
  sink: InputSink,
  signal: AbortSignal,
) {
  const original = surface.style.cursor
  type P = {id: number; x0: number; y0: number; x: number; y: number; t0: number; tl: number; mode: 'pending' | 'drag' | 'none'; touch: boolean}
  const ptrs = new Map<number, P>()
  let pinch = 0
  const skip = (e: Event) => e.target instanceof Element && !!ignore?.(e.target)
  const ndc = (e: PointerEvent | MouseEvent): [number, number] => {
    const r = canvas.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1]
  }
  const cursor = (c: string) => {
    if (surface.style.cursor !== c) surface.style.cursor = c
  }
  const refresh = () => cursor([...ptrs.values()].some((p) => p.mode === 'drag') ? 'grabbing' : sink.hot() ? 'pointer' : 'grab')
  const opt = {signal}

  surface.addEventListener(
    'pointerdown',
    (e) => {
      if (skip(e) || (e.pointerType === 'mouse' && e.button !== 0)) return
      const now = performance.now()
      ptrs.set(e.pointerId, {id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: now, tl: now, mode: 'pending', touch: e.pointerType !== 'mouse'})
      const touches = [...ptrs.values()].filter((p) => p.touch)
      if (touches.length === 2) {
        pinch = Math.hypot(touches[0].x - touches[1].x, touches[0].y - touches[1].y)
        for (const p of touches) p.mode = 'none'
        sink.release()
      }
    },
    opt,
  )
  surface.addEventListener(
    'pointermove',
    (e) => {
      let p = ptrs.get(e.pointerId)
      // 按下后在 surface 外松开（未捕获）会漏掉 pointerup：按键已松就当作结束
      if (p && !p.touch && e.buttons === 0) {
        if (p.mode === 'drag') sink.release()
        ptrs.delete(e.pointerId)
        p = undefined
      }
      if (!p) {
        if (e.pointerType !== 'mouse') return
        if (skip(e)) {
          sink.leave()
          return cursor(original)
        }
        const [x, y] = ndc(e)
        sink.hover(x, y, true)
        return refresh()
      }
      const now = performance.now()
      const touches = [...ptrs.values()].filter((q) => q.touch)
      if (p.touch && touches.length >= 2) {
        p.x = e.clientX
        p.y = e.clientY
        const d = Math.hypot(touches[0].x - touches[1].x, touches[0].y - touches[1].y)
        if (pinch > 0) sink.zoom((d / pinch - 1) * 0.5)
        pinch = d
        return
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y
      if (p.mode === 'pending' && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > TAP_PX) {
        // 触屏：竖直为主 → 放弃，不 preventDefault，让页面滚动
        if (p.touch && Math.abs(e.clientY - p.y0) > Math.abs(e.clientX - p.x0)) {
          p.mode = 'none'
          return
        }
        p.mode = 'drag'
        try {
          surface.setPointerCapture(e.pointerId)
        } catch {
          /* 指针已释放 */
        }
        sink.grab()
        refresh()
      }
      if (p.mode === 'drag') {
        sink.drag(dx, p.touch ? 0 : dy, (now - p.tl) / 1000)
        if (e.pointerType === 'mouse') {
          const [x, y] = ndc(e)
          sink.hover(x, y, false)
        }
      }
      p.x = e.clientX
      p.y = e.clientY
      p.tl = now
    },
    opt,
  )
  const end = (e: PointerEvent, cancel: boolean) => {
    const p = ptrs.get(e.pointerId)
    if (!p) return
    ptrs.delete(e.pointerId)
    if (!ptrs.size) pinch = 0
    if (p.mode === 'drag') sink.release()
    else if (!cancel && p.mode === 'pending' && performance.now() - p.t0 < TAP_MS && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < TAP_PX) {
      const [x, y] = ndc(e)
      sink.tap(x, y)
    }
    if (e.pointerType === 'mouse') refresh()
  }
  surface.addEventListener('pointerup', (e) => end(e, false), opt)
  surface.addEventListener('pointercancel', (e) => end(e, true), opt)
  surface.addEventListener(
    'pointerleave',
    (e) => {
      if (e.pointerType !== 'mouse' || ptrs.has(e.pointerId)) return
      sink.leave()
      cursor(original)
    },
    opt,
  )
  surface.addEventListener(
    'wheel',
    (e) => {
      if (skip(e)) return
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      sink.zoom(-T(d) * 0.06)
    },
    {signal, passive: true},
  )
  return () => {
    surface.style.cursor = original
  }
}

const T = (d: number) => Math.max(-1, Math.min(1, d / 100))
