import { getPlayMode } from '../game/play-mode'
import { record } from '../telemetry'
import type { Host } from '../play/host'
import type { mapView } from '../play/map'
import { spots, waterDocks } from '../play/spots'
import { APPEAL, TERMINAL_STATUSES, appealReasons, kinds, labels, photosOptional, type FeedbackView } from '../../../lib/feedback-contract'
import { ll2xz, xz2ll } from '../../../lib/projection'
import { readJson, jsonError } from '../lib/json'
import { photoPicker } from './feedback-photo'
import { cameraSupported, shootFeedbackPhoto } from './feedback-camera'
import {
  buildFeedbackDraftPayload,
  clampFeedbackPosition,
  describeFeedbackMedia,
  safeFeedbackLocation,
  shouldUploadDefaultShotPhoto,
  shouldUploadFeedbackViewShot,
  validateFeedbackSubmit,
} from './feedback-state'
import { inline } from './loading'
import './feedback.css'

type MapApi = ReturnType<typeof mapView>
interface Item {
  messages: { id: number; author_kind: string; author_name: string; body: string; created_at: number }[]
  view: FeedbackView | null
  has_view_shot: boolean
  id: string
  title: string
  status: string
  kind?: string
  lat: number
  lon: number
  body: string
  ban_record_id?: string | null
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
  const result = await readJson(response)
  if (!response.ok) throw Error(result.error?.message ?? `请求失败（${response.status}）`)
  return result
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const node = document.createElement(tag)
  node.textContent = text
  if (className) node.className = className
  return node
}

const ROUTE = '【沿路拍摄】'
const truncateChars = (value: string, max: number) => Array.from(value).slice(0, max).join('')
const when = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

const TERMINAL = new Set<string>(TERMINAL_STATUSES)
const LAST_BAN_KEY = 'glol.lastMpBan'
const LAST_BAN_KEEP_MS = 24 * 60 * 60 * 1000
function readRecentBanId(): string {
  try {
    const raw = globalThis.sessionStorage?.getItem(LAST_BAN_KEY)
    if (!raw) return ''
    const parsed = JSON.parse(raw) as { recordId?: unknown; savedAt?: unknown } | null
    if (!parsed || typeof parsed !== 'object') return ''
    const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : NaN
    const age = Date.now() - savedAt
    if (!(age >= 0 && age <= LAST_BAN_KEEP_MS)) return ''
    return typeof parsed.recordId === 'string' ? parsed.recordId.trim().slice(0, 64) : ''
  } catch {
    return ''
  }
}

function pill(status: string) {
  return el('span', labels[status] ?? status, `fb-pill fb-status--${status}`)
}

function pickDefaultPosition(host: Host, view?: FeedbackView | null) {
  const player = host.walker()?.active ? host.walker()!.position : host.camera?.position
  const target = view?.target
  const chosen = target && (view?.landmark_id || target.distance <= 250) ? target : player
  return clampFeedbackPosition(chosen)
}

function describeLocation(
  host: Host,
  x: number,
  z: number,
  view?: FeedbackView | null,
  mapApi?: MapApi,
) {
  const parts: string[] = []
  const landmarkName = view?.landmark_id
    ? host.manifest.landmarks?.find((entry) => entry.id === view.landmark_id)?.name ?? view.landmark_id
    : undefined
  if (landmarkName) parts.push(landmarkName)

  const road = mapApi?.roadAt(x, z, 60)?.name
  if (road && !parts.some((p) => p.includes(road))) parts.push(`${road}附近`)

  if (!landmarkName && host.manifest.landmarks?.length) {
    const nearLandmark = host.manifest.landmarks
      .filter((entry) => entry.name)
      .map((entry) => ({
        name: entry.name!,
        dist: Math.hypot(entry.position[0] - x, entry.position[2] - z),
      }))
      .sort((a, b) => a.dist - b.dist)[0]
    if (nearLandmark && nearLandmark.dist <= 90 && !parts.some((p) => p.includes(nearLandmark.name))) {
      parts.unshift(nearLandmark.dist <= 30 ? nearLandmark.name : `${nearLandmark.name}附近`)
    }
  }

  if (!parts.length) {
    const places = [...spots, ...waterDocks]
      .map((p) => ({ name: p.name, dist: Math.hypot(p.x - x, p.z - z) }))
      .sort((a, b) => a.dist - b.dist)
    const nearest = places[0]
    if (nearest && nearest.dist <= 220) {
      parts.push(nearest.dist <= 65 ? nearest.name : `${nearest.name}附近`)
    }
  }

  if (!parts.length && host.manifest.peaks?.entries?.length) {
    const peak = host.manifest.peaks.entries
      .map((p) => ({ name: p.name, dist: Math.hypot(p.center[0] - x, p.center[2] - z) }))
      .sort((a, b) => a.dist - b.dist)[0]
    if (peak && peak.dist <= 260) parts.push(`${peak.name}附近`)
  }

  if (!parts.length) parts.push(view?.mode === 'walk' ? '步行当前位置' : '桂林城区')
  return parts.join(' · ')
}

export async function openFeedback(
  host: Host,
  ensureMap: () => Promise<MapApi | undefined>,
  initialId?: string,
  banId?: string,
) {
  record('funnel', { step: 'feedbackOpen' })
  if (document.querySelector('.fb-panel,.fb-aim-bar')) return
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

  const canCapture = typeof host.captureView === 'function'
  let captured: Awaited<ReturnType<Host['captureView']>> | undefined
  let initialCaptureAttempted = false
  let initialCaptureFailed = false
  if (canCapture && !initialId && !banId) {
    initialCaptureAttempted = true
    try {
      captured = await host.captureView()
    } catch {
      initialCaptureFailed = true
      // 默认取景失败不阻断反馈弹窗打开，用户可稍后重截或按类型无图提交
    }
  }
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
  for (const event of ['keydown', 'keyup']) dialog.addEventListener(event, (e) => e.stopPropagation())
  dialog.addEventListener('paste', (event) => {
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
      file.type.startsWith('image/'),
    )
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
    note.classList.remove('fb-note--error')
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
      empty.append(
        el('p', '还没有提交过反馈。点开新反馈会自动带上当前画面和位置，写一句说明就能提交。'),
      )
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
    if (item.has_view_shot) {
      const image = el('img', '', 'fb-view-shot')
      image.alt = '反馈时看到的画面'
      image.src = `/api/feedback/${id}/view-shot`
      body.append(image)
    }
    const [route, text] = item.body.startsWith(ROUTE)
      ? [
          item.body.slice(ROUTE.length).split('\n\n')[0],
          item.body.slice(ROUTE.length).split('\n\n').slice(1).join('\n\n'),
        ]
      : ['', item.body]
    const facts = el('dl', '', 'fb-facts')
    const fact = (k: string, v: string) => v && facts.append(el('dt', k), el('dd', v))
    fact('类型', item.kind ?? '')
    fact('记录编号', item.ban_record_id ?? '')
    if (item.kind !== APPEAL || Math.abs(item.lat) > 1e-4 || Math.abs(item.lon) > 1e-4) {
      fact('位置', `${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}`)
    }
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
    body.append(el('h4', '进度与对话', 'fb-section-title'))
    const timeline = el('ol', '', 'fb-timeline')
    const paintChat = (record: Item) => {
      timeline.replaceChildren()
      head.replaceChildren(el('h3', record.title), pill(record.status))
      for (const event of [...record.events, ...record.messages].sort(
        (left, right) => left.created_at - right.created_at,
      )) {
        if ('author_kind' in event) {
          const msg = el('li', '', `fb-msg fb-msg--${event.author_kind}`),
            meta = el('span', '', 'fb-msg-meta')
          meta.append(
            el('b', event.author_kind === 'user' ? '我' : event.author_name),
            el('time', when(event.created_at)),
          )
          msg.append(meta, el('p', event.body, 'fb-msg-body'))
          timeline.append(msg)
          continue
        }
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
      if (!record.events.length) timeline.append(el('li', '还没有进度记录', 'fb-status--draft'))
    }
    paintChat(item)
    timeline.classList.add('fb-chat')
    body.append(timeline)
    const actions = el('div', '', 'fb-actions')
    body.append(actions)
    if (item.status !== 'draft' && !TERMINAL.has(item.status)) {
      const input = el('textarea'),
        photo = el('input'),
        compose = el('div', '', 'fb-compose'),
        attach = el('label', '', 'fb-compose-attach'),
        tools = el('div', '', 'fb-compose-tools')
      input.maxLength = 1000
      input.rows = 2
      input.placeholder = '回复协调人，或补充说明…'
      input.setAttribute('aria-label', '回复内容')
      photo.type = 'file'
      photo.accept = 'image/jpeg,image/png,image/webp'
      photo.setAttribute('aria-label', '回复照片')
      attach.append(photo, el('span', '附照片'))
      photo.onchange = () => {
        attach.querySelector('span')!.textContent = photo.files?.[0] ? '已选 1 张' : '附照片'
      }
      tools.append(attach)
      compose.append(input, tools)
      body.insertBefore(compose, actions)
      button(tools, '发送回复', async () => {
        let message = input.value.trim()
        if (!message) throw Error('请输入回复')
        const attachment = photo.files?.[0]
        if (attachment) {
          const fresh = await api<Item>('feedback/' + id),
            slot = Math.max(0, ...fresh.photos.map((p) => p.n)) + 1
          if (slot > 20) throw Error('照片数量已达上限')
          message += `（照片 #${slot}）`
          if ([...message].length > 1000) throw Error('回复过长')
          const upload = await fetch(`/api/feedback/${id}/photos/${slot}`, { method: 'PUT', body: attachment })
          if (!upload.ok) throw Error('照片上传失败')
        }
        await api(`feedback/${id}/messages`, { body: message })
        await detail(id)
      })
    }
    const refresh = async () => {
      if (document.hidden || !timeline.isConnected) return
      try {
        const latest = await api<Item>('feedback/' + id)
        if (timeline.isConnected) paintChat(latest)
      } catch {
        /* ignore background refresh errors */
      }
    }
    const timer = setInterval(refresh, 15000)
    document.addEventListener('visibilitychange', refresh)
    const previous = dispose
    dispose = () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      previous()
    }
    if (getPlayMode() === 'tour' && (item.view || item.status === 'live'))
      button(
        actions,
        '飞过去看看',
        async () => {
          if (getPlayMode() === 'solo') return
          if (item.view) {
            await host.setView(item.view)
            dialog.close()
            return
          }
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
          if (!response.ok) throw Error(await jsonError(response))
          await list()
        },
        'quiet',
      )
  }

  async function form(item?: Item) {
    const supplement = item?.status === 'need_info'
    reset(supplement ? '补充信息' : item ? '继续上传' : '反馈', item ? '' : 'new')
    const formEl = el('form', '', item ? 'fb-form fb-form--legacy' : 'fb-form fb-form--onepage')
    body.append(formEl)

    let id = item?.id
    let draftSignature = ''
    let mediaResetSeq = 0
    let captureFailed = false
    let selection: Awaited<ReturnType<Host['captureView']>> | undefined
    if (!item && !banId) {
      if (captured) {
        selection = captured
        captured = undefined
        initialCaptureAttempted = false
        initialCaptureFailed = false
      } else if (initialCaptureAttempted) {
        captureFailed = initialCaptureFailed
        initialCaptureAttempted = false
        initialCaptureFailed = false
      } else if (canCapture) {
        try {
          selection = await host.captureView()
        } catch {
          captureFailed = true
          // 切回新反馈时自动取景失败不阻断表单，按类型在界面提示
        }
      }
    }
    let useDefaultShot = !!selection
    let viewShotUploaded = false
    let defaultPhotoUploaded = false
    let formDisposed = false
    let activePos = pickDefaultPosition(host, selection?.view)
    let location = item ? { lat: item.lat, lon: item.lon } : xz2ll(activePos.x, activePos.z)
    let mapApi: MapApi | undefined
    let locSummary = item ? '' : describeLocation(host, activePos.x, activePos.z, selection?.view, mapApi)

    const recentBanId = !item ? (banId?.trim() || readRecentBanId()) : ''
    const kind = el('div', '', 'fb-chips'),
      name = el('input'),
      banRecordInput = el('input'),
      appealReasonWrap = el('div', '', 'fb-appeal-reasons'),
      description = el('textarea')
    let describeField: HTMLElement | undefined
    let banRecordField: HTMLElement | undefined

    const chosenKind = () =>
      item?.kind ?? (kind.querySelector('input:checked') as HTMLInputElement | null)?.value ?? kinds[0]
    let syncSummary = () => {}

    // —— 1. 截图区域（一页模式为紧凑横卡，续传/补充沿用视角预览） ——
    const mediaCard = el('section', '', 'fb-media')
    mediaCard.hidden = !!banId && !item && !selection
    const previewWrap = el('figure', '', 'fb-view-frame'),
      previewImg = el('img', '', 'fb-view-shot'),
      previewCross = el('span', '＋', 'fb-view-cross')
    previewImg.alt = '反馈问题截图'
    previewWrap.append(previewImg, previewCross)

    const mediaMain = el('div', '', 'fb-media-main'),
      mediaHead = el('div', '', 'fb-media-head'),
      mediaTitle = el('strong', '当前游戏画面', 'fb-media-title'),
      mediaMeta = el('span', '默认附图，可直接提交', 'fb-media-meta'),
      mediaActions = el('div', '', 'fb-media-actions'),
      retakeBtn = el('button', '重拍', 'fb-mini-btn'),
      replaceBtn = el('button', '更换', 'fb-mini-btn'),
      removeBtn = el('button', '移除', 'fb-mini-btn fb-mini-btn--quiet'),
      captureNowBtn = el('button', '截取当前画面', 'fb-mini-btn'),
      pickBtn = el('button', '选择图片', 'fb-mini-btn')
    retakeBtn.type = replaceBtn.type = removeBtn.type = captureNowBtn.type = pickBtn.type = 'button'
    mediaHead.append(mediaTitle, mediaMeta)
    mediaActions.append(retakeBtn, replaceBtn, removeBtn)

    const pickerHost = el('div', '', 'fb-media-picker')
    mediaMain.append(mediaHead, mediaActions, pickerHost)
    mediaCard.append(previewWrap, mediaMain)
    formEl.append(mediaCard)

    // —— 2. 自动位置摘要条（仅新反馈且非封禁申诉） ——
    const locBar = el('div', '', 'fb-loc'),
      locLeft = el('div', '', 'fb-loc-main'),
      locTag = el('span', '当前位置', 'fb-loc-tag'),
      locName = el('strong', '', 'fb-loc-name'),
      locCoords = el('span', '', 'fb-loc-coords ui-num')
    locLeft.append(locTag, locName)
    locBar.append(locLeft, locCoords)
    locBar.hidden = !!banId
    if (!item) formEl.append(locBar)

    const updateLocationDisplay = () => {
      if (item) return
      const view = selection?.view
      locSummary = describeLocation(host, activePos.x, activePos.z, view, mapApi)
      locName.textContent = locSummary
      const headingText = view ? ` · 朝向 ${Math.round(view.heading)}°` : ''
      locCoords.textContent = `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}${headingText}`
    }
    updateLocationDisplay()

    if (!item) {
      void ensureMap().then((apiResult) => {
        if (!apiResult || formDisposed) return
        mapApi = apiResult
        updateLocationDisplay()
      })
    }

    // —— 3. 类型、标题与文字描述 ——
    if (!item) {
      const what = el('div', '', 'fb-what')
      kind.setAttribute('role', 'radiogroup')
      kind.setAttribute('aria-label', '问题类型')
      const visibleKinds = banId || recentBanId ? kinds : kinds.filter((value) => value !== APPEAL)
      visibleKinds.forEach((value, i) => {
        const chip = el('label', '', 'fb-chip'),
          radio = el('input')
        radio.type = 'radio'
        radio.name = 'fb-kind'
        radio.value = value
        radio.checked = banId ? value === APPEAL : i === 0
        radio.onchange = () => syncSummary()
        chip.append(radio, el('span', value))
        kind.append(chip)
      })
      what.append(kind)

      const fields = el('div', '', 'fb-fields')
      const field = (label: string, control: HTMLElement) => {
        const wrapper = el('label', '', 'fb-field')
        wrapper.append(el('span', label), control)
        fields.append(wrapper)
        return wrapper
      }
      name.maxLength = 40
      name.placeholder = '一句话说明，例如：逍遥楼屋顶颜色不对'
      field('标题', name)

      banRecordInput.type = 'text'
      banRecordInput.maxLength = 64
      banRecordInput.placeholder = '自动带入或粘贴记录编号（可选）'
      banRecordInput.setAttribute('data-field', 'ban-record-id')
      if (recentBanId) banRecordInput.value = recentBanId
      banRecordField = field('记录编号（可选）', banRecordInput)
      banRecordField.hidden = !banId

      appealReasonWrap.setAttribute('role', 'group')
      appealReasonWrap.setAttribute('aria-label', '常见情况快捷填写')
      for (const reasonText of appealReasons) {
        const chipBtn = el('button', reasonText, 'fb-reason-chip')
        chipBtn.type = 'button'
        chipBtn.onclick = () => {
          const cur = description.value.trim()
          if (!cur) description.value = reasonText + '：'
          else if (!cur.includes(reasonText)) description.value = `${reasonText}；${cur}`
          description.focus()
        }
        appealReasonWrap.append(chipBtn)
      }
      appealReasonWrap.hidden = !banId
      fields.append(appealReasonWrap)

      description.maxLength = 1400
      description.rows = 3
      if (banId) name.value = APPEAL
      description.placeholder = '补充细节（可选，不填标题也会自动按位置命名）'
      describeField = field('描述（可选）', description)
      what.append(fields)
      formEl.append(what)
    } else if (supplement) {
      const what = el('div', '', 'fb-fields')
      const wrapper = el('label', '', 'fb-field')
      description.required = true
      description.maxLength = 1000
      description.rows = 3
      description.placeholder = '按处理意见补充信息（最多 1000 字）'
      wrapper.append(el('span', '补充内容'), description)
      what.append(wrapper)
      formEl.append(what)
    }

    // —— 4. 底部提交栏 ——
    const footer = el('div', '', 'fb-submit'),
      count = el('span', '', 'fb-count'),
      send = el('button', supplement ? '提交补充' : '提交反馈', 'fb-btn fb-btn--primary')
    send.type = 'submit'
    footer.append(count, send)
    formEl.append(footer)

    let shotUrl = ''
    const clearShotUrl = () => {
      if (shotUrl) {
        URL.revokeObjectURL(shotUrl)
        shotUrl = ''
      }
    }

    let photoCount = item?.photos.length ?? 0
    const picker = photoPicker(
      pickerHost,
      item?.photos.map((photo) => photo.n) ?? [],
      (message) => {
        note.textContent = message
        note.classList.add('fb-note--error')
      },
      () => id,
      run,
      (n) => {
        photoCount = n
        syncSummary()
      },
      item && cameraSupported()
        ? async () => {
            const scroll = body.scrollTop
            dialog.remove()
            dialog.removeAttribute('open')
            document.exitPointerLock?.()
            try {
              return await shootFeedbackPhoto()
            } catch (error) {
              note.textContent = String((error as Error).message ?? error)
              note.classList.add('fb-note--error')
              return null
            } finally {
              document.body.append(dialog)
              dialog.showModal()
              body.scrollTop = scroll
            }
          }
        : undefined,
      { compact: !item },
    )

    const paintMedia = () => {
      clearShotUrl()
      if (item) {
        mediaCard.classList.toggle('fb-media--empty', !item.has_view_shot && !selection)
        if (selection) {
          shotUrl = URL.createObjectURL(selection.shot)
          previewImg.src = shotUrl
          previewWrap.hidden = false
          previewCross.hidden = !selection.view.target
          mediaTitle.textContent = '已重新取景'
          mediaMeta.textContent = `${selection.view.lat.toFixed(5)}, ${selection.view.lon.toFixed(5)}`
        } else if (item.has_view_shot) {
          previewImg.src = `/api/feedback/${item.id}/view-shot`
          previewWrap.hidden = false
          previewCross.hidden = !item.view?.target
          mediaTitle.textContent = '当前反馈画面'
          mediaMeta.textContent = item.view
            ? `${item.view.lat.toFixed(5)}, ${item.view.lon.toFixed(5)}`
            : '保留原画面'
        } else {
          previewImg.removeAttribute('src')
          previewWrap.hidden = true
          mediaTitle.textContent = '附加照片'
          mediaMeta.textContent = photoCount ? `已附 ${photoCount} 张` : '可直接添加照片'
        }
        mediaActions.replaceChildren(...(canCapture ? [retakeBtn] : []))
        return
      }

      const presentation = describeFeedbackMedia({
        kind: chosenKind(),
        hasItem: false,
        hasSelection: !!selection,
        useDefaultShot,
        photoCount,
        canCapture,
        captureFailed,
      })
      mediaCard.hidden = false
      mediaCard.classList.toggle('fb-media--empty', presentation.mode === 'empty' || presentation.mode === 'appeal-empty')
      mediaCard.classList.toggle('fb-media--custom', presentation.mode === 'photos')
      mediaTitle.textContent = presentation.title
      mediaMeta.textContent = presentation.meta
      replaceBtn.textContent = presentation.replaceLabel

      if (presentation.mode === 'default-shot' && selection) {
        shotUrl = URL.createObjectURL(selection.shot)
        previewImg.src = shotUrl
        previewWrap.hidden = false
        previewCross.hidden = !selection.view.target
        mediaActions.replaceChildren(
          ...(presentation.showRetake ? [retakeBtn] : []),
          replaceBtn,
          removeBtn,
        )
        return
      }

      previewWrap.hidden = true
      previewImg.removeAttribute('src')
      if (presentation.mode === 'photos') {
        mediaActions.replaceChildren(
          ...(presentation.showCaptureNow ? [captureNowBtn] : []),
          ...(presentation.showRetake ? [retakeBtn] : []),
          replaceBtn,
          removeBtn,
        )
        return
      }

      mediaActions.replaceChildren(
        ...(presentation.showCaptureNow ? [captureNowBtn] : []),
        pickBtn,
      )
    }

    syncSummary = () => {
      const current = chosenKind()
      const bug = photosOptional(current)
      paintMedia()
      if (!item) {
        const isAppeal = current === APPEAL
        if (banRecordField) banRecordField.hidden = !isAppeal
        appealReasonWrap.hidden = !isAppeal
        locBar.hidden = isAppeal
        if (isAppeal) {
          if (!name.value.trim()) name.value = APPEAL
          if (!banRecordInput.value.trim() && recentBanId) banRecordInput.value = recentBanId
          name.placeholder = '封禁申诉'
          description.placeholder = '请说明当时正在做什么、网络或画面情况'
          description.required = true
          describeField!.querySelector('span')!.textContent = '申诉说明（必填）'
        } else {
          if (name.value.trim() === APPEAL) name.value = ''
          name.placeholder = bug
            ? '一句话说明，例如：骑车过桥时卡住了'
            : '一句话说明，例如：逍遥楼屋顶颜色不对'
          description.placeholder = bug
            ? '发生了什么、如何触发、使用的是电脑还是手机？'
            : '补充细节（可选，不填标题也会自动按位置命名）'
          description.required = bug
          describeField!.querySelector('span')!.textContent = bug ? '描述（必填）' : '描述（可选）'
        }
      }

      const presentation = describeFeedbackMedia({
        kind: current,
        hasItem: !!item,
        supplement,
        itemHasViewShot: !!item?.has_view_shot,
        hasSelection: !!selection,
        useDefaultShot,
        photoCount,
        canCapture,
        captureFailed,
      })
      count.textContent = presentation.countText
      count.classList.toggle('fb-count--empty', presentation.countEmpty)
    }

    const startAim = () => {
      dialog.remove()
      dialog.removeAttribute('open')
      const bar = el('aside', '', 'fb-aim-bar'),
        take = el('button', '截取'),
        cancel = el('button', '取消')
      bar.append('移动到要反馈的位置，对准物体后点“截取”', take, cancel)
      document.body.append(bar)
      const restore = () => {
        bar.remove()
        document.exitPointerLock?.()
        document.body.append(dialog)
        dialog.showModal()
        retakeBtn.focus()
      }
      cancel.onclick = restore
      take.onclick = async () => {
        take.disabled = cancel.disabled = true
        try {
          selection = await host.captureView()
          captureFailed = false
          useDefaultShot = true
          viewShotUploaded = false
          defaultPhotoUploaded = false
          activePos = pickDefaultPosition(host, selection.view)
          location = xz2ll(activePos.x, activePos.z)
          updateLocationDisplay()
          note.textContent = ''
          note.classList.remove('fb-note--error')
          syncSummary()
        } catch (error) {
          captureFailed = true
          note.textContent = String((error as Error)?.message || error)
          note.classList.add('fb-note--error')
          syncSummary()
        } finally {
          restore()
        }
      }
    }

    retakeBtn.onclick = () => {
      if (!busy && canCapture) startAim()
    }
    replaceBtn.onclick = () => {
      if (!busy) picker.open()
    }
    pickBtn.onclick = () => {
      if (!busy) picker.open()
    }
    removeBtn.onclick = () => {
      if (busy) return
      useDefaultShot = false
      mediaResetSeq += 1
      picker.clear()
      syncSummary()
    }
    captureNowBtn.onclick = () =>
      void run(async () => {
        if (!canCapture) throw Error('当前无法截取游戏画面')
        try {
          selection = await host.captureView()
          captureFailed = false
        } catch (error) {
          captureFailed = true
          syncSummary()
          throw error
        }
        useDefaultShot = true
        viewShotUploaded = false
        defaultPhotoUploaded = false
        activePos = pickDefaultPosition(host, selection.view)
        location = xz2ll(activePos.x, activePos.z)
        updateLocationDisplay()
        syncSummary()
      })

    if (!item) {
      mediaCard.ondragover = (event) => {
        event.preventDefault()
        if (!busy) mediaCard.classList.add('fb-media--over')
      }
      mediaCard.ondragleave = () => mediaCard.classList.remove('fb-media--over')
      mediaCard.ondrop = (event) => {
        event.preventDefault()
        mediaCard.classList.remove('fb-media--over')
        if (busy) return
        const files = event.dataTransfer?.files
        if (files?.length) picker.add(Array.from(files))
      }
    }

    syncSummary()
    onPaste = (files) => {
      if (!busy) picker.add(files)
    }
    const prevDispose = dispose
    dispose = () => {
      formDisposed = true
      clearShotUrl()
      picker.dispose()
      prevDispose()
    }

    formEl.onsubmit = (event) => {
      event.preventDefault()
      void run(async () => {
        const current = chosenKind()
        const appeal = current === APPEAL
        const optional = photosOptional(current)
        const text = (item && !supplement ? item.body ?? '' : description.value).trim()
        const recordIdVal = appeal ? banRecordInput.value.trim() : ''
        const check = validateFeedbackSubmit({
          kind: current,
          hasItem: !!item,
          supplement,
          itemHasViewShot: !!item?.has_view_shot,
          hasSelection: !!selection,
          useDefaultShot,
          photoCount: picker.count(),
          canCapture,
          captureFailed,
          bodyText: text,
          banRecordId: recordIdVal,
        })
        if (!check.ok) throw Error(check.error)

        const fallbackName = truncateChars(`${current} · ${locSummary || '当前位置'}`, 40)
        const resolvedTitle =
          name.value.trim() || (text ? truncateChars(text.replace(/\s+/g, ' '), 40) : fallbackName)

        let skippedDefaultShot = false
        send.textContent = '正在提交…'
        try {
          if (check.needsAutoCapture && !selection) {
            if (!canCapture) throw Error('请先截取游戏画面')
            try {
              selection = await host.captureView()
              captureFailed = false
              viewShotUploaded = false
              defaultPhotoUploaded = false
              activePos = pickDefaultPosition(host, selection.view)
              location = xz2ll(activePos.x, activePos.z)
              updateLocationDisplay()
            } catch {
              captureFailed = true
              syncSummary()
              throw Error('请先截取游戏画面')
            }
          }
          const safeLoc = appeal ? xz2ll(0, 0) : safeFeedbackLocation(location)
          const nextSignature = !item
            ? JSON.stringify({
                current,
                resolvedTitle,
                text,
                recordIdVal,
                useDefaultShot,
                mediaResetSeq,
                lat: safeLoc.lat,
                lon: safeLoc.lon,
                view: appeal ? null : selection?.view ?? null,
              })
            : ''
          if (!item && id && draftSignature && draftSignature !== nextSignature) {
            const deleted = await fetch(`/api/feedback/${id}`, { method: 'DELETE' })
            if (!deleted.ok && deleted.status !== 404) throw Error(await jsonError(deleted))
            id = undefined
            draftSignature = ''
            viewShotUploaded = false
            defaultPhotoUploaded = false
            picker.resetDone()
          }
          if (!id) {
            if (!optional && !selection) throw Error('请先截取游戏画面')
            id = (
              await api<{ id: string }>(
                'feedback',
                buildFeedbackDraftPayload({
                  kind: current,
                  title: resolvedTitle,
                  body: text,
                  location: safeLoc,
                  view: selection?.view ?? null,
                  banRecordId: recordIdVal,
                }),
              )
            ).id
            draftSignature = nextSignature
          }

          const defaultShotOptionalFallback = !item && optional && !appeal && picker.count() === 0
          const shouldUploadViewShot = shouldUploadFeedbackViewShot({
            kind: current,
            hasSelection: !!selection,
            useDefaultShot,
            photoCount: picker.count(),
            viewShotUploaded,
          })
          if (shouldUploadViewShot && selection) {
            try {
              const response = await fetch(`/api/feedback/${id}/view-shot`, {
                method: 'PUT',
                headers: {
                  'Content-Type': 'image/jpeg',
                  'X-Feedback-View': JSON.stringify(selection.view).replace(
                    /[^\x20-\x7e]/g,
                    (char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'),
                  ),
                },
                body: selection.shot,
              })
              if (!response.ok) throw Error(await jsonError(response))
              viewShotUploaded = true
            } catch (error) {
              if (!defaultShotOptionalFallback) throw error
              skippedDefaultShot = true
            }
          }

          if (picker.count() > 0) {
            await picker.upload(id)
          } else if (
            !skippedDefaultShot &&
            shouldUploadDefaultShotPhoto({
              hasItem: !!item,
              kind: current,
              hasSelection: !!selection,
              useDefaultShot,
              photoCount: picker.count(),
              defaultPhotoUploaded,
            }) &&
            selection
          ) {
            try {
              const uploadDefault = await fetch(`/api/feedback/${id}/photos/1`, {
                method: 'PUT',
                headers: {
                  'Content-Type': 'image/jpeg',
                  'X-Photo-Meta': encodeURIComponent(JSON.stringify({})),
                },
                body: selection.shot,
              })
              if (!uploadDefault.ok) throw Error(await jsonError(uploadDefault))
              defaultPhotoUploaded = true
            } catch (error) {
              if (!defaultShotOptionalFallback) throw error
              skippedDefaultShot = true
            }
          }

          await api(`feedback/${id}/${supplement ? 'supplement' : 'submit'}`, { body: text })
          if (!supplement) record('funnel', { step: 'feedbackSuccess' })
        } finally {
          send.textContent = supplement ? '提交补充' : '提交反馈'
        }
        await detail(id)
        note.textContent = appeal
          ? '申诉已提交，我们会尽快核实并在进度中回复。'
          : skippedDefaultShot
            ? '已提交（默认截图上传失败，已自动改为无图提交）。'
            : '已提交，我们会尽快处理。进度会显示在这里。'
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
        el(
          'p',
          '发现哪里建得不像、位置不对或遇到问题？登录后点开反馈即可自动带上当前画面和位置，一键提交。',
        ),
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
    if (initialId) await detail(initialId)
    else await form()
  })
}
