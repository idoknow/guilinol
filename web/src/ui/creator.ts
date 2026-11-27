import {
  defaultAvatar,
  hairColors,
  hairNames,
  hairStyles,
  lookNames,
  faceNames,
  browNames,
  eyeNames,
  looks,
  skinTones,
  type Avatar,
} from '../../../lib/avatar'
import {creatorStage, type CreatorShot} from './creator-stage'
import {creatorPresets, matchesPreset} from './creator-presets'
import './creator.css'

const SHOTS: CreatorShot[] = ['body', 'face', 'hair', 'outfit', 'confirm']
const STEP_ICONS = [
  'M8 20v-5l-2 1-1-2 4-4h6l4 4-1 2-2-1v5M14 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  'M5 10c0-8 14-8 14 0 0 6-4 10-7 10s-7-4-7-10z M8 10h2m4 0h2m-6 5q2 2 4 0',
  'M4 16V9a8 8 0 0 1 16 0v7 M4 12q6-1 9-7 1 5 7 6',
  'M9 4l-6 3 2 5 3-1v9h8v-9l3 1 2-5-6-3q-3 4-6 0z',
  'm4 12 5 5L20 6',
]
const icon = (body: string) => `<svg aria-hidden="true" viewBox="0 0 24 24">${body}</svg>`
const DICE = icon(
  '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="8.6" cy="8.6" r="1.25"/><circle cx="15.4" cy="8.6" r="1.25"/><circle cx="12" cy="12" r="1.25"/><circle cx="8.6" cy="15.4" r="1.25"/><circle cx="15.4" cy="15.4" r="1.25"/>',
)
const UNDO = icon('<path d="M5 12a7 7 0 1 0 2.2-5.1M5 4.5V9h4.5"/>')
const SKIN_NAMES = ['浅暖', '暖米', '自然', '小麦', '深麦']
const HAIR_COLOR_NAMES = ['自然黑', '深棕', '栗棕', '灰棕']

/** 预设半身像只拍一次（同一会话里重开捏人页直接复用）。 */
const presetShots = new Map<string, string>()

export async function createCharacter(
  nickname: string,
  initial: Avatar | undefined,
  save: (a: Avatar, equipStarter: boolean) => Promise<void>,
) {
  let draft = {...(initial ?? defaultAvatar())},
    step = 0,
    busy = false,
    roll = 0,
    equipStarter = !initial
  const reduced = matchMedia('(prefers-reduced-motion:reduce)').matches
  const dialog = document.createElement('dialog')
  dialog.className = 'creator'
  dialog.setAttribute('aria-label', initial ? '修改外形' : '创建角色')
  dialog.innerHTML = `<div class="creator-stage"></div><div class="creator-veil" aria-hidden="true"></div>
    <section class="creator-panel">
      <button type="button" class="creator-handle" aria-label="调整选项面板高度"></button>
      <header class="creator-head"><h1></h1><p class="creator-who"></p></header>
      <nav aria-label="创建步骤"></nav>
      <div class="creator-options"></div>
      <div class="creator-actions">
        <div class="creator-tools"><button type="button" data-random>${DICE}<span>随机</span></button><button type="button" data-reset>${UNDO}<span>重置</span></button><button type="button" data-skip></button></div>
        <p role="status"></p>
        <button type="button" class="creator-next"></button>
      </div>
    </section><div class="creator-curtain" aria-hidden="true"></div>`
  document.body.append(dialog)
  dialog.showModal()
  window.dispatchEvent(new CustomEvent('glol:creator', {detail: {open: true}}))
  const el = <E extends HTMLElement>(s: string) => dialog.querySelector<E>(s)!
  const host = el('.creator-stage'),
    panel = el('.creator-panel')
  const stage = creatorStage(host, reduced),
    options = el('.creator-options'),
    next = el<HTMLButtonElement>('.creator-next')
  const skip = el<HTMLButtonElement>('[data-skip]'),
    status = el('[role=status]')
  el('h1').textContent = initial ? '修改外形' : '创建角色'
  el('.creator-who').textContent = nickname
  skip.textContent = initial ? '取消' : '跳过'

  // The panel covers part of the full-bleed stage; tell the camera what is left so the character sits in it.
  function layout() {
    if (dialog.classList.contains('creator--leaving')) return
    const W = dialog.clientWidth,
      side = panel.offsetLeft > W * 0.35
    if (side) {
      const right = Math.max(0, host.offsetLeft + host.clientWidth - panel.offsetLeft)
      stage.inset({right})
      dialog.style.setProperty('--focus-x', (((W - right) / 2 / W) * 100).toFixed(1) + '%')
    } else {
      stage.inset({bottom: Math.max(0, host.offsetTop + host.clientHeight - panel.offsetTop)})
      dialog.style.setProperty('--focus-x', '50%')
    }
  }
  const layoutObserver = new ResizeObserver(layout)
  layoutObserver.observe(dialog)
  layoutObserver.observe(panel)

  let resolve!: (finished: boolean) => void
  const done = new Promise<boolean>((r) => (resolve = r))
  let closed = false
  const close = (finished: boolean) => {
    roll++
    if (closed) return
    closed = true
    layoutObserver.disconnect()
    stage.dispose()
    dialog.close()
    dialog.remove()
    window.dispatchEvent(new CustomEvent('glol:creator', {detail: {open: false}}))
    resolve(finished)
  }

  const labels = ['体型', '样貌', '发型', '穿搭', '确认'],
    nav = el('nav')
  const steps = labels.map((label, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.innerHTML = icon('<path d="' + STEP_ICONS[i] + '"/>') + '<span>' + label + '</span>'
    b.onclick = () => go(i)
    nav.append(b)
    return b
  })

  /** Option buttons on screen and how to tell whether each is the current choice. */
  let pressed: [HTMLElement, () => boolean][] = [],
    built = ''
  function render() {
    steps.forEach((b, i) => {
      b.setAttribute('aria-current', String(i === step))
      b.classList.toggle('is-done', i < step)
    })
    next.textContent = step === 4 ? (initial ? '保存外形' : '进入桂林') : '下一步'
    const signature = step + draft.body + (step === 4 ? JSON.stringify(draft) : '')
    if (signature !== built) build(signature)
    for (const [b, on] of pressed) b.setAttribute('aria-pressed', String(on()))
  }
  function build(signature: string) {
    built = signature
    pressed = []
    options.replaceChildren()
    const section = (title?: string) => {
      const s = document.createElement('section')
      s.className = 'creator-group'
      if (title) {
        const h = document.createElement('h2')
        h.textContent = title
        s.append(h)
      }
      options.append(s)
      return s
    }
    function group<K extends keyof Avatar>(
      name: string | undefined,
      key: K,
      values: readonly Avatar[K][],
      names: readonly string[],
      colors?: readonly string[],
    ) {
      const grid = document.createElement('div')
      grid.className = colors ? 'creator-swatches' : key === 'body' ? 'creator-grid creator-grid--body' : 'creator-grid'
      section(name).append(grid)
      values.forEach((v, i) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.setAttribute('aria-label', names[i])
        pressed.push([b, () => draft[key] === v])
        if (colors) {
          b.style.backgroundColor = colors[i]
          b.title = names[i]
        } else {
          const pic = document.createElement('i')
          pic.style.backgroundImage = 'url(./avatar/creator-options.webp)'
          const row =
            key === 'body'
              ? 0
              : (draft.body === 'm' ? 1 : 6) + ['face', 'brows', 'eyes', 'hair', 'look'].indexOf(key)
          pic.style.backgroundPosition = (i * 100) / 11 + '% ' + row * 10 + '%'
          const label = document.createElement('span')
          label.textContent = names[i]
          b.append(pic, label)
        }
        b.onclick = () => {
          if (busy) return
          roll++
          if (key === 'body' || key === 'look') equipStarter = true
          if (key !== 'look' && draft[key] === v) return
          draft[key] = v
          if (key === 'body') {
            draft.hair = hairStyles[draft.body][0]
            draft.look = 'basic'
          }
          void update(key)
          render()
        }
        grid.append(b)
      })
    }
    if (step === 0) {
      group(undefined, 'body', ['m', 'f'], ['男', '女'])
      const grid = document.createElement('div')
      grid.className = 'creator-presets'
      section('预设').append(grid)
      creatorPresets.forEach((p, i) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.dataset.preset = String(i)
        b.setAttribute('aria-label', p.name)
        pressed.push([b, () => matchesPreset(draft, p.look)])
        const pic = document.createElement('span'),
          label = document.createElement('span')
        pic.className = 'creator-preset-pic'
        label.textContent = p.name
        const shot = presetShots.get(p.name)
        if (shot) pic.append(portraitImage(shot))
        b.append(pic, label)
        b.onclick = () => {
          if (busy) return
          roll++
          equipStarter = true
          if (matchesPreset(draft, p.look)) return
          draft = {...draft, ...p.look}
          void update('preset')
          render()
        }
        grid.append(b)
      })
    }
    if (step === 1) {
      group('肤色', 'skin', [0, 1, 2, 3, 4], SKIN_NAMES, skinTones)
      group('脸型', 'face', faceNames.map((_, i) => i), faceNames)
      group('眉形', 'brows', browNames.map((_, i) => i), browNames)
      group('眼型', 'eyes', eyeNames.map((_, i) => i), eyeNames)
    }
    if (step === 2) {
      group('发型', 'hair', hairStyles[draft.body], hairNames[draft.body])
      group('发色', 'hairColor', [0, 1, 2, 3], HAIR_COLOR_NAMES, hairColors)
    }
    if (step === 3) group(undefined, 'look', looks, lookNames)
    if (step === 4) options.append(card())
  }
  function portraitImage(src: string) {
    const img = new Image()
    img.alt = ''
    img.decoding = 'async'
    img.src = src
    return img
  }
  /** 确认步：角色卡。 */
  function card() {
    const root = document.createElement('article')
    root.className = 'creator-card'
    const seal = document.createElement('span')
    seal.className = 'creator-card-seal'
    seal.setAttribute('aria-hidden', 'true')
    seal.textContent = '桂林'
    const name = document.createElement('h2')
    name.textContent = nickname
    const rows: [string, string, string?][] = [
      ['体型', draft.body === 'm' ? '男' : '女'],
      ['肤色', SKIN_NAMES[draft.skin], skinTones[draft.skin]],
      ['样貌', [faceNames[draft.face], browNames[draft.brows], eyeNames[draft.eyes]].join(' · ')],
      [
        '发型',
        hairNames[draft.body][hairStyles[draft.body].findIndex((h) => h === draft.hair)] +
          ' · ' +
          HAIR_COLOR_NAMES[draft.hairColor],
        hairColors[draft.hairColor],
      ],
      ['穿搭', lookNames[looks.indexOf(draft.look)]],
    ]
    const list = document.createElement('dl')
    for (const [term, value, color] of rows) {
      const row = document.createElement('div'),
        dt = document.createElement('dt'),
        dd = document.createElement('dd')
      dt.textContent = term
      if (color) {
        const dot = document.createElement('i')
        dot.style.backgroundColor = color
        dd.append(dot)
      }
      dd.append(value)
      row.append(dt, dd)
      list.append(row)
    }
    const rule = document.createElement('hr')
    root.append(seal, name, rule, list)
    return root
  }
  function shootPresets() {
    for (const p of creatorPresets) {
      if (presetShots.has(p.name)) continue
      stage
        .portrait({...defaultAvatar(1), ...p.look})
        .then((src) => {
          presetShots.set(p.name, src)
          const i = creatorPresets.indexOf(p),
            pic = options.querySelector(`[data-preset="${i}"] .creator-preset-pic`)
          if (pic && !pic.firstChild) pic.append(portraitImage(src))
        })
        .catch(() => {
          // 拍不出来就保留骨架占位，不影响捏人
        })
    }
  }
  async function update(key = '') {
    try {
      await stage.apply({...draft}, key)
      status.textContent = ''
      return true
    } catch {
      status.textContent = '外形加载失败，请重试'
      return false
    }
  }
  function go(i: number) {
    if (busy) return
    const direction = i >= step ? 1 : -1
    step = i
    stage.shot(SHOTS[i])
    render()
    options.scrollTop = 0
    options.animate(
      reduced
        ? [{opacity: 0}, {opacity: 1}]
        : [
            {opacity: 0, transform: `translateX(${direction * 28}px)`},
            {opacity: 1, transform: 'none'},
          ],
      {duration: reduced ? 160 : 340, easing: 'cubic-bezier(.2,.8,.2,1)'},
    )
  }
  async function finish(useDefault = false) {
    if (busy) return
    busy = true
    dialog.setAttribute('aria-busy', 'true')
    roll++
    try {
      if (useDefault) {
        draft = defaultAvatar()
      }
      if (!await update()) throw Error('外形加载失败，请重试')
      await save(draft, equipStarter)
      // 收起面板，人物回到画面中央，挥手 → 相机后拉 → 夜色合拢
      dialog.classList.add('creator--leaving')
      stage.inset({})
      stage.shot('confirm')
      await stage.finish()
      const curtain = el('.creator-curtain')
      await curtain.animate([{opacity: 0}, {opacity: 1}], {
        duration: reduced ? 120 : 700,
        easing: 'cubic-bezier(.4,0,.6,1)',
        fill: 'forwards',
      }).finished
      await dialog.animate([{opacity: 1}, {opacity: 0}], {duration: reduced ? 100 : 420, fill: 'forwards'}).finished
      close(true)
    } catch (e) {
      dialog.classList.remove('creator--leaving')
      dialog.removeAttribute('aria-busy')
      layout()
      status.textContent = e instanceof Error ? e.message : '保存失败，请重试'
      busy = false
    }
  }
  next.onclick = () => (step === 4 ? void finish() : go(step + 1))
  skip.onclick = () => {
    if (!busy) initial ? close(false) : void finish(true)
  }
  dialog.oncancel = (e) => {
    e.preventDefault()
    if (initial && !busy) close(false)
  }
  el('[data-reset]').onclick = () => {
    if (!busy) {
      roll++
      equipStarter = true
      draft = defaultAvatar(draft.createdAt)
      render()
      void update()
    }
  }
  el('[data-random]').onclick = async () => {
    if (busy) return
    equipStarter = true
    const id = ++roll,
      r = (n: number) => Math.floor(Math.random() * n)
    if (!reduced)
      el('[data-random] svg').animate([{rotate: '0deg'}, {rotate: '360deg'}], {
        duration: 420,
        easing: 'cubic-bezier(.2,.8,.2,1)',
      })
    const body = r(2) ? 'm' : 'f'
    const target: Avatar = {
      ...draft,
      body,
      skin: r(5),
      face: r(faceNames.length),
      brows: r(browNames.length),
      eyes: r(eyeNames.length),
      hair: hairStyles[body][r(6)],
      hairColor: r(4),
      look: looks[r(looks.length)],
    }
    for (const key of ['body', 'skin', 'face', 'brows', 'eyes', 'hair', 'hairColor', 'look'] as const) {
      if (id !== roll) return
      draft = {...draft, [key]: target[key]}
      if (key === 'body') draft.hair = hairStyles[body][0]
      render()
      await update(key)
      if (!reduced) await new Promise((r) => setTimeout(r, 60))
    }
  }
  const handle = el('button.creator-handle')
  handle.onpointerdown = (e) => handle.setPointerCapture(e.pointerId)
  handle.onpointermove = (e) => {
    if (handle.hasPointerCapture(e.pointerId))
      dialog.style.setProperty('--stage-height', Math.max(28, Math.min(68, (e.clientY / innerHeight) * 100)) + '%')
  }
  handle.onclick = (e) => {
    if (!e.detail)
      dialog.style.setProperty(
        '--stage-height',
        dialog.style.getPropertyValue('--stage-height') === '35%' ? '52%' : '35%',
      )
  }
  dialog.onkeydown = (e) => e.stopPropagation()
  dialog.onkeyup = (e) => e.stopPropagation()
  render()
  layout()
  if (!await update()) {
    close(false)
    throw Error('外形加载失败，请重试')
  }
  shootPresets()
  return done
}
