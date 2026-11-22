import {
  defaultAvatar,
  hairColors,
  hairNames,
  hairStyles,
  lookNames,
  looks,
  skinTones,
  type Avatar,
} from '../../../lib/avatar'
import {creatorStage} from './creator-stage'
import './creator.css'

export async function createCharacter(
  nickname: string,
  initial: Avatar | undefined,
  save: (a: Avatar, equipStarter: boolean) => Promise<void>,
  enterWorld = true,
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
  dialog.innerHTML = `<div class="creator-stage"><h1></h1><div class="creator-hills"></div></div><section class="creator-panel">
    <button type="button" class="creator-handle" aria-label="调整选项面板高度"></button><nav aria-label="创建步骤"></nav>
    <div class="creator-options"></div><div class="creator-actions"><div><button data-random><span aria-hidden="true">⚄</span> 随机</button><button data-reset>重置</button><button data-skip></button></div>
    <p role="status"></p><button class="creator-next"></button></div></section>`
  document.body.append(dialog)
  dialog.showModal()
  const el = <E extends HTMLElement>(s: string) => dialog.querySelector<E>(s)!
  const stage = creatorStage(el('.creator-stage'), reduced),
    options = el('.creator-options'),
    next = el<HTMLButtonElement>('.creator-next')
  const title = el('h1'),
    skip = el<HTMLButtonElement>('[data-skip]'),
    status = el('[role=status]')
  title.textContent = initial ? '修改外形' : '创建角色'
  skip.textContent = initial ? '取消' : '跳过'
  let resolve!: (finished: boolean) => void
  const done = new Promise<boolean>((r) => (resolve = r))
  const close = (finished: boolean) => {
    roll++
    stage.dispose()
    dialog.close()
    dialog.remove()
    resolve(finished)
  }
  const labels = ['体型', '样貌', '发型', '穿搭', '确认'],
    nav = el('nav')
  function render() {
    nav.replaceChildren()
    const paths = [
      'M8 20v-5l-2 1-1-2 4-4h6l4 4-1 2-2-1v5M14 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
      'M5 10c0-8 14-8 14 0 0 6-4 10-7 10s-7-4-7-10z M8 10h2m4 0h2m-6 5q2 2 4 0',
      'M4 16V9a8 8 0 0 1 16 0v7 M4 12q6-1 9-7 1 5 7 6',
      'M9 4l-6 3 2 5 3-1v9h8v-9l3 1 2-5-6-3q-3 4-6 0z',
      'm4 12 5 5L20 6',
    ]
    labels.forEach((label, i) => {
      const b = document.createElement('button')
      b.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="' + paths[i] + '"/></svg>'
      b.append(label)
      b.setAttribute('aria-current', String(i === step))
      b.onclick = () => go(i)
      nav.append(b)
    })
    options.replaceChildren()
    next.textContent = step === 4 ? (initial ? '保存外形' : '进入桂林') : '下一步'
    function group<K extends keyof Avatar>(
      name: string,
      key: K,
      values: readonly Avatar[K][],
      names: readonly string[],
      colors?: readonly string[],
    ) {
      const h = document.createElement('h2')
      h.textContent = name
      options.append(h)
      const grid = document.createElement('div')
      grid.className = colors ? 'creator-swatches' : 'creator-grid'
      options.append(grid)
      values.forEach((v, i) => {
        const b = document.createElement('button')
        b.setAttribute('aria-pressed', String(draft[key] === v))
        b.setAttribute('aria-label', names[i])
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
          pic.style.backgroundPosition = (i * 100) / 5 + '% ' + row * 10 + '%'
          b.append(pic, document.createTextNode(names[i]))
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
    if (step === 0) group('选择体型', 'body', ['m', 'f'], ['男', '女'])
    if (step === 1) {
      group('肤色', 'skin', [0, 1, 2, 3, 4], ['浅暖', '暖米', '自然', '小麦', '深麦'], skinTones)
      group('脸型', 'face', [0, 1, 2], ['圆脸', '鹅蛋脸', '方下颌'])
      group('眉形', 'brows', [0, 1, 2], ['平直眉', '舒展眉', '微挑眉'])
      group('眼型', 'eyes', [0, 1, 2], ['细长眼', '杏仁眼', '内双眼'])
    }
    if (step === 2) {
      group('发型', 'hair', hairStyles[draft.body], hairNames[draft.body])
      group('发色', 'hairColor', [0, 1, 2, 3], ['自然黑', '深棕', '栗棕', '灰棕'], hairColors)
    }
    if (step === 3) group('首套穿搭', 'look', looks, lookNames)
    if (step === 4) {
      const h = document.createElement('h2')
      h.textContent = nickname
      const p = document.createElement('p')
      p.textContent = [
        draft.body === 'm' ? '男' : '女',
        hairNames[draft.body][hairStyles[draft.body].findIndex((h) => h === draft.hair)],
        lookNames[looks.indexOf(draft.look)],
      ].join(' · ')
      options.append(h, p)
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
    step = i
    stage.frameHead(i === 1 || i === 2)
    render()
    options.scrollTop = 0
    options.animate(
      reduced
        ? [{opacity: 0.3}, {opacity: 1}]
        : [
            {opacity: 0.3, transform: 'translateX(12px)'},
            {opacity: 1, transform: 'none'},
          ],
      {duration: 180},
    )
  }
  async function finish(useDefault = false) {
    if (busy) return
    busy = true
    roll++
    try {
      if (useDefault) {
        draft = defaultAvatar()
      }
      if (!await update()) throw Error('外形加载失败，请重试')
      await save(draft,equipStarter)
      stage.frameHead(false)
      await stage.finish()
      if (enterWorld) {
        const cover = document.createElement('div')
        cover.className = 'creator-arrival'
        cover.setAttribute('role', 'status')
        cover.setAttribute('aria-label', '正在进入桂林')
        document.body.append(cover)
      }
      await dialog.animate([{opacity: 1}, {opacity: 0, backgroundColor: 'white'}], {
        duration: reduced ? 120 : 600,
        fill: 'forwards',
      }).finished
      close(true)
    } catch (e) {
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
    if (!reduced) el('[data-random] span').animate([{rotate: '0deg'}, {rotate: '360deg'}], 300)
    const body = r(2) ? 'm' : 'f'
    const target: Avatar = {
      ...draft,
      body,
      skin: r(5),
      face: r(3),
      brows: r(3),
      eyes: r(3),
      hair: hairStyles[body][r(6)],
      hairColor: r(4),
      look: looks[r(6)],
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
  if (!await update()) {
    close(false)
    throw Error('外形加载失败，请重试')
  }
  return done
}
