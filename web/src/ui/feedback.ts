import type { Host } from '../play/host'
import { type Atlas, loadAtlas } from '../map/atlas'
import { kinds, labels } from '../../../lib/feedback-contract'
import { ll2xz, xz2ll } from '../../../lib/projection'
import { photoPicker } from './feedback-photo'
import './feedback.css'

interface Item {
  id: string
  title: string
  status: string
  lat: number
  lon: number
  body: string
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
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '') {
  const node = document.createElement(tag)
  node.textContent = text
  return node
}
export async function openFeedback(host: Host, atlas: Atlas | undefined) {
  if (document.querySelector('.fb-panel')) return
  const dialog = el('dialog')
  dialog.className = 'about-panel account fb-panel'
  dialog.setAttribute('aria-label', '反馈')
  const header = el('header'),
    title = el('h2', '反馈'),
    close = el('button', '关闭'),
    body = el('div'),
    note = el('p')
  body.className = 'about-body'
  note.setAttribute('role', 'status')
  close.className = 'about-close'
  header.append(title, close)
  dialog.append(header, body, note)
  document.body.append(dialog)
  dialog.showModal()
  close.onclick = () => dialog.close()
  let dispose = () => {},
    busy = false
  dialog.onclose = () => {
    dispose()
    dialog.remove()
  }
  dialog.oncancel = (event) => {
    if (busy) event.preventDefault()
  }
  for (const event of ['keydown', 'keyup']) dialog.addEventListener(event, (event) => event.stopPropagation())
  async function run(work: () => Promise<void>) {
    if (busy) return
    busy = true
    dialog.inert = true
    try {
      await work()
    } catch (error) {
      note.textContent = String((error as Error).message)
    } finally {
      busy = false
      dialog.inert = false
    }
  }
  function reset(heading: string) {
    dispose()
    dispose = () => {}
    title.textContent = heading
    body.replaceChildren()
    note.textContent = ''
  }
  function button(parent: HTMLElement, text: string, work: () => Promise<void>) {
    const node = el('button', text)
    node.type = 'button'
    node.className = 'about-close'
    node.onclick = () => void run(work)
    parent.append(node)
    return node
  }
  async function list() {
    const items = await api<Item[]>('feedback?mine=1')
    reset('我的反馈')
    button(body, '新反馈', () => form())
    for (const item of items) button(body, `${item.title} · ${labels[item.status]}`, () => detail(item.id))
    if (!items.length) body.append(el('p', '还没有反馈'))
  }
  async function detail(id: string) {
    const item = await api<Item>('feedback/' + id)
    reset(item.title)
    button(body, '我的反馈', list)
    const status = el('p', labels[item.status])
    status.className = 'fb-status--' + item.status
    body.append(status, el('p', item.body), el('p', `${item.lat.toFixed(6)}, ${item.lon.toFixed(6)}`))
    const gallery = el('div')
    gallery.className = 'fb-grid'
    for (const photo of item.photos) {
      const image = el('img')
      image.alt = `照片 ${photo.n}`
      image.src = `/api/feedback/${id}/photos/${photo.n}`
      gallery.append(image)
    }
    body.append(gallery)
    const timeline = el('ol')
    timeline.className = 'fb-timeline'
    for (const event of item.events) {
      const line = el(
        'li',
        `${new Date(event.created_at * 1000).toLocaleString()} · ${labels[event.status]}：${event.message}`,
      )
      if (event.screenshot_url) {
        const link = el('a', '查看截图')
        link.href = event.screenshot_url
        link.rel = 'noreferrer'
        link.target = '_blank'
        line.append(link)
      }
      timeline.append(line)
    }
    body.append(timeline)
    button(body, '刷新进度', () => detail(id))
    if (item.status === 'draft')
      button(body, '删除草稿', async () => {
        if (!confirm('确定删除草稿和照片？')) return
        const response = await fetch(`/api/feedback/${id}`, { method: 'DELETE' })
        if (!response.ok) throw Error((await response.json()).error.message)
        await list()
      })
    if (item.status === 'need_info' || item.status === 'draft')
      button(body, item.status === 'draft' ? '继续上传' : '补充信息', () => form(item))
    if (item.status === 'live')
      button(body, '飞过去看看', async () => {
        const { x, z } = ll2xz(item.lat, item.lon)
        host.fly()
        host.camera.position.set(x, Math.max(host.camera.position.y, 350), z)
        dialog.close()
      })
  }
  async function form(item?: Item) {
    reset(item?.status === 'need_info' ? '补充信息' : '提交反馈')
    button(body, '我的反馈', list)
    const form = el('form'),
      details = el('fieldset'),
      photos = el('fieldset'),
      send = el('button', item ? '提交' : '提交反馈')
    send.className = 'about-close'
    body.append(form)
    form.append(details, photos, send)
    let id = item?.id
    const walker = host.walker(),
      position = walker?.active ? walker.position : host.camera.position
    let location = item ? { lat: item.lat, lon: item.lon } : xz2ll(position.x, position.z)
    const kind = el('select'),
      name = el('input'),
      description = el('textarea')
    function field(label: string, control: HTMLElement) {
      const wrapper = el('label', label)
      wrapper.append(control)
      details.append(wrapper)
    }
    if (!item) {
      const canvas = el('canvas'),
        coords = el('output')
      canvas.width = 300
      canvas.height = 190
      canvas.className = 'fb-map'
      canvas.setAttribute('aria-label', '点选反馈位置')
      details.append(canvas, coords)
      atlas ??= await loadAtlas(host.manifest)
      const [left, top, width, depth] = atlas.extent
      const ctx = canvas.getContext('2d')!
      const roads = new Path2D()
      for (const road of atlas.roads) {
        if (road.c > 2) continue
        for (let i = 0; i < road.p.length; i += 2)
          roads[i ? 'lineTo' : 'moveTo'](
            ((road.p[i] - left) / width) * canvas.width,
            ((road.p[i + 1] - top) / depth) * canvas.height,
          )
      }
      function draw() {
        coords.textContent = `纬度 ${location.lat.toFixed(6)} · 经度 ${location.lon.toFixed(6)}`
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.strokeStyle = getComputedStyle(dialog).color
        ctx.lineWidth = 0.4
        ctx.stroke(roads)
        const point = ll2xz(location.lat, location.lon)
        ctx.beginPath()
        ctx.arc(
          ((point.x - left) / width) * canvas.width,
          ((point.z - top) / depth) * canvas.height,
          4,
          0,
          2 * Math.PI,
        )
        ctx.lineWidth = 2
        ctx.stroke()
      }
      canvas.onclick = (event) => {
        if (details.disabled) return
        const rect = canvas.getBoundingClientRect()
        location = xz2ll(
          left + ((event.clientX - rect.left) / rect.width) * width,
          top + ((event.clientY - rect.top) / rect.height) * depth,
        )
        draw()
      }
      draw()
      kinds.forEach((value) => kind.add(new Option(value)))
      field('类型', kind)
      field('标题', name)
      name.required = true
      name.maxLength = 40
    }
    if (!item || item.status === 'need_info') {
      field('描述', description)
      description.maxLength = 2000
      description.required = item?.status === 'need_info'
    }
    photos.append(el('legend', '多视角照片（最多 20 张）'))
    const picker = photoPicker(
      photos,
      item?.photos.map((photo) => photo.n) ?? [],
      (message) => (note.textContent = message),
      () => id,
      run,
    )
    dispose = picker.dispose
    form.onsubmit = (event) => {
      event.preventDefault()
      void run(async () => {
        if (!picker.count()) throw Error('请至少选择一张照片')
        if (!id) {
          id = (
            await api<{ id: string }>('feedback', {
              ...location,
              kind: kind.value,
              title: name.value,
              body: description.value,
            })
          ).id
          details.disabled = true
        }
        await picker.upload(id)
        await api(`feedback/${id}/${item?.status === 'need_info' ? 'supplement' : 'submit'}`, {
          body: description.value,
        })
        await detail(id)
      })
    }
  }
  await run(async () => {
    const me = await fetch('/api/me')
    if (me.status === 401) {
      note.textContent = '登录后可以提交和查看反馈'
      button(body, '去登录', async () => {
        dialog.close()
        document.querySelector<HTMLButtonElement>('.account-entry')?.click()
      })
      return
    }
    if (!me.ok) throw Error('账号暂时不可用')
    await form()
  })
}
