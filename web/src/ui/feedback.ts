import type { Host } from '../play/host'
import type { mapView } from '../play/map'
import { kinds, labels } from '../../../lib/feedback-contract'
import { ll2xz, xz2ll } from '../../../lib/projection'
import { photoPicker } from './feedback-photo'
import './feedback.css'

type MapApi = ReturnType<typeof mapView>
interface Item {
  id: string
  title: string
  status: string
  kind?: string
  lat: number
  lon: number
  body: string
  submitted_at?: number | null
  updated_at?: number
  photos: { n: number }[]
  events: { status: string; message: string; created_at: number; screenshot_url: string | null }[]
}
async function api<T>(path: string, data?: object): Promise<T> {
  const response = await fetch(
    '/api/' + path,
    data
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
      : {},
  )
  const result = await response.json()
  if (!response.ok) throw Error(result.error.message)
  return result
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const node = document.createElement(tag)
  node.textContent = text
  if (className) node.className = className
  return node
}
const ROUTE = '【沿路拍摄】'
const when = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
function pill(status: string) {
  return el('span', labels[status] ?? status, `fb-pill fb-status--${status}`)
}

/** Location picker drawn with the game's own map painter: drag to pan, wheel/pinch to zoom, tap to drop the pin. */
function locationPicker(host: Host, map: MapApi, start: { x: number; z: number }, onPick: (x: number, z: number) => void) {
  const wrap = el('div', '', 'fb-map'),
    canvas = el('canvas'),
    tools = el('div', '', 'fb-map-tools'),
    hint = el('p', '拖动平移 · 滚轮或双指缩放 · 点一下放置定位针', 'fb-map-hint')
  canvas.setAttribute('aria-label', '在地图上点选反馈位置')
  const tool = (label: string, aria: string, fn: () => void) => {
    const b = el('button', label)
    b.type = 'button'
    b.setAttribute('aria-label', aria)
    b.title = aria
    b.onclick = fn
    tools.append(b)
  }
  wrap.append(canvas, tools, hint)
  const [left, top, width, depth] = map.extent
  const view = { x: start.x, z: start.z, scale: 0.9 }
  let pin = { ...start },
    frame = 0
  const clamp = () => {
    view.scale = Math.min(3, Math.max(0.08, view.scale))
    view.x = Math.min(left + width, Math.max(left, view.x))
    view.z = Math.min(top + depth, Math.max(top, view.z))
  }
  function draw() {
    frame = 0
    const w = canvas.clientWidth,
      h = canvas.clientHeight
    if (!w || !h) return
    const dpr = Math.min(2, devicePixelRatio)
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    const g = canvas.getContext('2d')!
    map.paint(g, w, h, dpr, view.x, view.z, view.scale, false)
    // Pin: vermilion seal drop with a paper core, tip on the chosen point.
    const x = w / 2 + (pin.x - view.x) * view.scale,
      y = h / 2 + (pin.z - view.z) * view.scale
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = 'rgba(42,48,44,.22)'
    g.beginPath()
    g.ellipse(x, y, 7, 2.6, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#a9503c'
    g.strokeStyle = '#f4efe2'
    g.lineWidth = 2
    g.beginPath()
    g.arc(x, y - 19, 9, Math.PI * 0.82, Math.PI * 2.18)
    g.lineTo(x, y)
    g.closePath()
    g.fill()
    g.stroke()
    g.fillStyle = '#f4efe2'
    g.beginPath()
    g.arc(x, y - 19, 3.2, 0, Math.PI * 2)
    g.fill()
  }
  const redraw = () => {
    if (!frame) frame = requestAnimationFrame(draw)
  }
  const pointers = new Map<number, { x: number; y: number }>()
  let moved = 0,
    pinch = 0
  canvas.onpointerdown = (e) => {
    canvas.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    moved = 0
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinch = Math.hypot(a.x - b.x, a.y - b.y)
    }
  }
  canvas.onpointermove = (e) => {
    const last = pointers.get(e.pointerId)
    if (!last) return
    if (pointers.size === 1) {
      view.x -= (e.clientX - last.x) / view.scale
      view.z -= (e.clientY - last.y) / view.scale
      moved += Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y)
      wrap.classList.toggle('fb-map--drag', moved > 6)
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()],
        d = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinch) view.scale *= d / pinch
      pinch = d
      moved = 99
    }
    clamp()
    redraw()
  }
  canvas.onpointerup = (e) => {
    pointers.delete(e.pointerId)
    pinch = 0
    wrap.classList.remove('fb-map--drag')
    if (moved < 6 && pointers.size === 0) {
      const r = canvas.getBoundingClientRect()
      pin = { x: view.x + (e.clientX - r.left - r.width / 2) / view.scale, z: view.z + (e.clientY - r.top - r.height / 2) / view.scale }
      onPick(pin.x, pin.z)
      redraw()
    }
  }
  canvas.onpointercancel = (e) => {
    pointers.delete(e.pointerId)
    pinch = 0
  }
  canvas.onwheel = (e) => {
    e.preventDefault()
    const r = canvas.getBoundingClientRect(),
      ox = e.clientX - r.left - r.width / 2,
      oy = e.clientY - r.top - r.height / 2
    const before = { x: view.x + ox / view.scale, z: view.z + oy / view.scale }
    view.scale *= Math.exp(-e.deltaY * 0.0015)
    clamp()
    view.x = before.x - ox / view.scale
    view.z = before.z - oy / view.scale
    clamp()
    redraw()
  }
  const zoom = (k: number) => {
    view.scale *= k
    clamp()
    redraw()
  }
  tool('+', '放大', () => zoom(1.5))
  tool('−', '缩小', () => zoom(1 / 1.5))
  tool('◎', '回到我现在的位置', () => {
    const walker = host.walker(),
      p = walker?.active ? walker.position : host.camera.position
    view.x = pin.x = p.x
    view.z = pin.z = p.z
    onPick(pin.x, pin.z)
    redraw()
  })
  const resize = new ResizeObserver(redraw)
  resize.observe(canvas)
  return { node: wrap, dispose: () => resize.disconnect() }
}

export async function openFeedback(host: Host, ensureMap: () => Promise<MapApi | undefined>) {
  if (document.querySelector('.fb-panel')) return
  const dialog = el('dialog', '', 'about-panel fb-panel')
  dialog.setAttribute('aria-label', '反馈')
  const header = el('header'),
    title = el('h2', '反馈'),
    tabs = el('nav', '', 'fb-tabs'),
    close = el('button', '关闭', 'about-close'),
    body = el('div', '', 'fb-body'),
    note = el('p', '', 'fb-note')
  close.type = 'button'
  note.setAttribute('role', 'status')
  header.append(title, tabs, close)
  dialog.append(header, body, note)
  document.body.append(dialog)
  dialog.showModal()
  requestAnimationFrame(() => dialog.classList.add('fb-open'))
  close.onclick = () => dialog.close()
  let dispose = () => {},
    busy = false,
    onPaste: ((files: File[]) => void) | undefined
  dialog.onclose = () => {
    dispose()
    dialog.remove()
  }
  dialog.oncancel = (event) => {
    if (busy) event.preventDefault()
  }
  dialog.onclick = (event) => {
    if (event.target === dialog && !busy) dialog.close()
  }
  for (const event of ['keydown', 'keyup']) dialog.addEventListener(event, (event) => event.stopPropagation())
  dialog.addEventListener('paste', (event) => {
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'))
    if (!files.length || !onPaste) return
    event.preventDefault()
    onPaste(files)
  })
  async function run(work: () => Promise<void>) {
    if (busy) return
    busy = true
    dialog.classList.add('fb-busy')
    note.textContent = ''
    note.classList.remove('fb-note--error')
    try {
      await work()
    } catch (error) {
      note.textContent = String((error as Error).message)
      note.classList.add('fb-note--error')
    } finally {
      busy = false
      dialog.classList.remove('fb-busy')
    }
  }
  function reset(heading: string, tab: 'new' | 'mine' | '') {
    dispose()
    dispose = () => {}
    onPaste = undefined
    title.textContent = heading
    body.replaceChildren()
    note.textContent = ''
    tabs.replaceChildren()
    for (const [key, label, go] of [
      ['new', '新反馈', () => form()],
      ['mine', '我的反馈', list],
    ] as const) {
      const b = el('button', label, 'fb-tab')
      b.type = 'button'
      b.setAttribute('aria-pressed', String(key === tab))
      b.onclick = () => void run(go)
      tabs.append(b)
    }
    body.scrollTop = 0
  }
  function button(parent: HTMLElement, text: string, work: () => Promise<void>, kind = '') {
    const node = el('button', text, 'fb-btn' + (kind ? ' fb-btn--' + kind : ''))
    node.type = 'button'
    node.onclick = () => void run(work)
    parent.append(node)
    return node
  }
  async function list() {
    const items = await api<Item[]>('feedback?mine=1')
    reset('我的反馈', 'mine')
    if (!items.length) {
      const empty = el('div', '', 'fb-empty')
      empty.append(el('p', '还没有反馈。看到哪里建得不对、缺了什么，拍几张照片告诉我们。'))
      button(empty, '提交第一条反馈', () => form(), 'primary')
      body.append(empty)
      return
    }
    const ul = el('ul', '', 'fb-list')
    for (const item of items) {
      const li = el('li'),
        b = el('button', '', 'fb-card')
      b.type = 'button'
      const head = el('span', '', 'fb-card-head')
      head.append(el('b', item.title || '（未命名草稿）'), pill(item.status))
      const t = item.updated_at ?? item.submitted_at
      b.append(head, el('small', `${item.kind ?? ''}${t ? ' · 更新于 ' + when(t) : ''}`))
      b.onclick = () => void run(() => detail(item.id))
      li.append(b)
      ul.append(li)
    }
    body.append(ul)
  }
  async function detail(id: string) {
    const item = await api<Item>('feedback/' + id)
    reset('反馈详情', 'mine')
    const head = el('div', '', 'fb-detail-head')
    head.append(el('h3', item.title), pill(item.status))
    body.append(head)
    const [route, text] = item.body.startsWith(ROUTE)
      ? [item.body.slice(ROUTE.length).split('\n\n')[0], item.body.slice(ROUTE.length).split('\n\n').slice(1).join('\n\n')]
      : ['', item.body]
    const facts = el('dl', '', 'fb-facts')
    const fact = (k: string, v: string) => v && facts.append(el('dt', k), el('dd', v))
    fact('类型', item.kind ?? '')
    fact('位置', `${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}`)
    fact('行走路径', route)
    fact('描述', text)
    body.append(facts)
    if (item.photos.length) {
      const gallery = el('div', '', 'fb-grid fb-grid--view')
      for (const photo of item.photos) {
        const a = el('a', '', 'fb-photo fb-photo--done')
        a.href = `/api/feedback/${id}/photos/${photo.n}`
        a.target = '_blank'
        a.rel = 'noreferrer'
        const image = el('img')
        image.alt = `照片 ${photo.n}`
        image.loading = 'lazy'
        image.src = a.href
        a.append(image)
        gallery.append(a)
      }
      body.append(gallery)
    }
    body.append(el('h4', '进度', 'fb-section-title'))
    const timeline = el('ol', '', 'fb-timeline')
    for (const event of [...item.events].reverse()) {
      const line = el('li', '', `fb-status--${event.status}`)
      line.append(el('b', labels[event.status] ?? event.status), el('time', when(event.created_at)))
      if (event.message && event.message !== labels[event.status]) line.append(el('p', event.message))
      if (event.screenshot_url) {
        const link = el('a', '查看建模截图')
        link.href = event.screenshot_url
        link.rel = 'noreferrer'
        link.target = '_blank'
        line.append(link)
      }
      timeline.append(line)
    }
    if (!item.events.length) timeline.append(el('li', '还没有进度记录', 'fb-status--draft'))
    body.append(timeline)
    const actions = el('div', '', 'fb-actions')
    body.append(actions)
    if (item.status === 'live')
      button(
        actions,
        '飞过去看看',
        async () => {
          const { x, z } = ll2xz(item.lat, item.lon)
          host.fly()
          host.camera.position.set(x, Math.max(host.camera.position.y, 350), z)
          dialog.close()
        },
        'primary',
      )
    if (item.status === 'need_info' || item.status === 'draft')
      button(actions, item.status === 'draft' ? '继续上传' : '补充信息', () => form(item), 'primary')
    button(actions, '刷新进度', () => detail(id))
    if (item.status === 'draft')
      button(
        actions,
        '删除草稿',
        async () => {
          if (!confirm('确定删除草稿和照片？')) return
          const response = await fetch(`/api/feedback/${id}`, { method: 'DELETE' })
          if (!response.ok) throw Error((await response.json()).error.message)
          await list()
        },
        'quiet',
      )
  }
  async function form(item?: Item) {
    const supplement = item?.status === 'need_info'
    reset(supplement ? '补充信息' : item ? '继续上传' : '提交反馈', item ? '' : 'new')
    const form = el('form', '', 'fb-form')
    body.append(form)
    let id = item?.id
    const walker = host.walker(),
      position = walker?.active ? walker.position : host.camera.position
    let location = item ? { lat: item.lat, lon: item.lon } : xz2ll(position.x, position.z)
    const section = (n: string, heading: string) => {
      const box = el('section', '', 'fb-step')
      const h = el('h3')
      h.append(el('i', n), heading)
      box.append(h)
      form.append(box)
      return box
    }
    const field = (parent: HTMLElement, label: string, control: HTMLElement, hint = '') => {
      const wrapper = el('label', '', 'fb-field')
      wrapper.append(el('span', label), control)
      if (hint) wrapper.append(el('small', hint))
      parent.append(wrapper)
      return wrapper
    }
    const kind = el('div', '', 'fb-chips'),
      name = el('input'),
      description = el('textarea'),
      route = el('textarea'),
      mode = { route: false }
    let routeField: HTMLElement | undefined
    if (!item) {
      const where = section('1', '在哪里')
      const rule = el('div', '', 'fb-rule')
      rule.innerHTML =
        '<b>每次只反馈一个地点。</b>如果是沿一条路连续拍的多张照片，请选「沿路拍摄」，写清从哪里走到哪里、朝哪个方向走，照片按行走顺序添加。'
      const modes = el('div', '', 'fb-seg')
      modes.setAttribute('role', 'radiogroup')
      const addr = el('p', '', 'fb-addr')
      where.append(rule, modes)
      const slot = el('div', '', 'fb-map fb-map--loading')
      slot.append(el('p', '地图加载中…', 'fb-map-hint'))
      where.append(slot, addr)
      const describe = (x: number, z: number) => {
        location = xz2ll(x, z)
        const road = mapApi?.roadAt(x, z, 40)?.name
        addr.replaceChildren(
          el('b', (mode.route ? '起点：' : '') + (road ? road + '附近' : '已选位置')),
          el('span', `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}`),
        )
      }
      let mapApi: MapApi | undefined
      for (const [value, label] of [
        [false, '单个地点'],
        [true, '沿路拍摄'],
      ] as const) {
        const b = el('button', label)
        b.type = 'button'
        b.setAttribute('role', 'radio')
        b.setAttribute('aria-checked', String(mode.route === value))
        b.onclick = () => {
          mode.route = value
          for (const other of Array.from(modes.children)) other.setAttribute('aria-checked', String(other === b))
          routeField!.hidden = !value
          route.required = value
          const p = ll2xz(location.lat, location.lon)
          describe(p.x, p.z)
        }
        modes.append(b)
      }
      route.maxLength = 600
      route.rows = 2
      route.placeholder = '例：从十字街沿解放东路向东走到解放桥西桥头，照片按行走顺序排列'
      routeField = field(where, '行走路径和方向', route, '写清起点、终点和行走方向；起点就是地图上的定位针')
      routeField.hidden = true
      describe(position.x, position.z)
      void ensureMap().then((api) => {
        if (!api || !slot.isConnected) {
          if (slot.isConnected) slot.replaceChildren(el('p', '地图暂时不可用，将使用你当前所在的位置', 'fb-map-hint'))
          return
        }
        mapApi = api
        const picker = locationPicker(host, api, ll2xz(location.lat, location.lon), describe)
        slot.replaceWith(picker.node)
        const prev = dispose
        dispose = () => {
          picker.dispose()
          prev()
        }
        const p = ll2xz(location.lat, location.lon)
        describe(p.x, p.z)
      })
      const what = section('2', '哪里不对')
      kind.setAttribute('role', 'radiogroup')
      kinds.forEach((value, i) => {
        const chip = el('label', '', 'fb-chip'),
          radio = el('input')
        radio.type = 'radio'
        radio.name = 'fb-kind'
        radio.value = value
        radio.checked = i === 0
        chip.append(radio, el('span', value))
        kind.append(chip)
      })
      what.append(kind)
      name.required = true
      name.maxLength = 40
      name.placeholder = '一句话说明，例如：逍遥楼屋顶颜色不对'
      field(what, '标题', name)
      description.maxLength = 1400
      description.rows = 3
      description.placeholder = '哪里和现实不一样？现实中是什么样子？'
      field(what, '描述（可选）', description)
    } else if (supplement) {
      const what = section('1', '补充说明')
      description.required = true
      description.maxLength = 2000
      description.rows = 4
      description.placeholder = '按处理意见补充信息'
      field(what, '补充内容', description)
    }
    const shots = section(item ? (supplement ? '2' : '1') : '3', '照片')
    shots.append(
      el('p', '尽量多拍几个角度：正面、左右两侧、背面、远景和细节。可以给每张标上视角。', 'fb-step-hint'),
    )
    const footer = el('div', '', 'fb-submit'),
      count = el('span', '', 'fb-count'),
      send = el('button', supplement ? '提交补充' : '提交反馈', 'fb-btn fb-btn--primary')
    send.type = 'submit'
    footer.append(count, send)
    form.append(footer)
    const setCount = (n: number) => {
      count.textContent = n ? `已选 ${n} 张照片` : '至少需要 1 张照片'
      count.classList.toggle('fb-count--empty', !n)
    }
    const picker = photoPicker(
      shots,
      item?.photos.map((photo) => photo.n) ?? [],
      (message) => {
        note.textContent = message
        note.classList.add('fb-note--error')
      },
      () => id,
      run,
      setCount,
    )
    onPaste = (files) => picker.add(files)
    const prevDispose = dispose
    dispose = () => {
      picker.dispose()
      prevDispose()
    }
    form.onsubmit = (event) => {
      event.preventDefault()
      void run(async () => {
        if (!picker.count()) throw Error('请至少添加一张照片')
        const text =
          mode.route && route.value.trim()
            ? `${ROUTE}${route.value.trim()}\n\n${description.value.trim()}`
            : description.value.trim()
        send.textContent = '正在上传…'
        try {
          if (!id) {
            id = (
              await api<{ id: string }>('feedback', {
                ...location,
                kind: (kind.querySelector('input:checked') as HTMLInputElement | null)?.value ?? kinds[0],
                title: name.value.trim(),
                body: text,
              })
            ).id
            for (const box of Array.from(form.querySelectorAll<HTMLElement>('.fb-step'))) box.inert = box !== shots
          }
          await picker.upload(id)
          await api(`feedback/${id}/${supplement ? 'supplement' : 'submit'}`, { body: text })
        } finally {
          send.textContent = supplement ? '提交补充' : '提交反馈'
        }
        await detail(id)
        note.textContent = '已提交，我们会尽快处理。进度会显示在这里。'
      })
    }
  }
  await run(async () => {
    const me = await fetch('/api/me')
    if (me.status === 401) {
      reset('反馈', '')
      tabs.replaceChildren()
      const empty = el('div', '', 'fb-empty')
      empty.append(
        el('p', '发现哪里建得不像、位置不对或者缺了建筑？登录后上传照片，AI 会按照片重新建模，你可以在这里跟踪进度。'),
      )
      button(
        empty,
        '登录 / 注册',
        async () => {
          dialog.close()
          document.querySelector<HTMLButtonElement>('.account-entry')?.click()
        },
        'primary',
      )
      body.append(empty)
      return
    }
    if (!me.ok) throw Error('账号暂时不可用')
    await form()
  })
}
