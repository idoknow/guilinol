/**
 * 香烟的界面：底部 6 格快捷栏 + 背包面板。
 *
 * 交互（对齐需求）：
 *   · 端游：1–6 用快捷栏，TAB 开/关背包；
 *   · 手游：直接点快捷栏格子用，点右下「香烟背包」按钮开/关背包；
 *   · 从背包把烟拖到快捷栏（触屏用「点一下香烟，再点快捷栏格子」等价操作）。
 */

import {brandOf, HOTBAR_SLOTS, type Inventory, type Pack} from './data'

export interface SmokeUiEnv {
  inventory(): Inventory
  /** 用快捷栏第 slot 格 */
  use(slot: number): void
  /** 把一包烟放进第 slot 格 */
  assign(packId: string, slot: number): void
  /** 把第 slot 格清空 */
  clear(slot: number): void
  /** 丢弃整包（背包移除 + 快捷栏同步清空） */
  dropPack(packId: string): void
  /** 背包开合状态变化 */
  onBagToggle?(open: boolean): void
}

export interface SmokeUi {
  setVisible(visible: boolean): void
  /** 数据变了重画 */
  refresh(): void
  /** 正在燃烧的那包 + 剩余比例 0..1 */
  setBurning(packId: string | null, ratio: number): void
  toggleBag(force?: boolean): void
  readonly bagOpen: boolean
  toast(text: string): void
  dispose(): void
}

const DROP = 'data-drop'

function packFace(pack: Pack): string {
  const brand = brandOf(pack.brand)
  return `<span class="sb-pack-face" style="--a:${brand.pack};--b:${brand.lid};--f:${brand.ink}">` +
    `<b>${brand.name}</b><i></i><small>${brand.en}</small></span>`
}

export function createSmokeUi(env: SmokeUiEnv): SmokeUi {
  const hotbar = document.createElement('div')
  hotbar.className = 'smoke-hotbar'
  hotbar.id = 'smoke-hotbar'
  hotbar.setAttribute('role', 'toolbar')
  hotbar.setAttribute('aria-label', '香烟快捷栏')

  const bagButton = document.createElement('button')
  bagButton.type = 'button'
  bagButton.className = 'smoke-bag-btn'
  bagButton.textContent = '背包'
  bagButton.title = '香烟背包（TAB）'
  bagButton.setAttribute('aria-label', '打开香烟背包')

  const toastEl = document.createElement('div')
  toastEl.className = 'smoke-toast'
  toastEl.setAttribute('role', 'status')

  const mask = document.createElement('div')
  mask.className = 'smoke-bag-mask'
  mask.hidden = true
  mask.innerHTML = `
    <section class="ui-panel about-panel smoke-bag-panel" role="dialog" aria-modal="true" aria-label="物品背包">
      <header>
        <div class="sb-head">
          <h2>物品背包</h2>
          <p>香烟固定 20 包 · 每包 20 根 · 其它物品可查看 / 丢弃</p>
        </div>
        <button type="button" class="about-close" aria-label="关闭背包">关闭</button>
      </header>
      <div class="smoke-bag-body" ${DROP}="bag">
        <div class="smoke-bag-grid" role="list"></div>
        <div class="smoke-bag-items">
          <h3>物品<span class="sb-items-empty">（暂无，开市民卡会得到身份证）</span></h3>
          <div class="sb-items" role="list"></div>
        </div>
        <div class="smoke-bag-foot">
          <h3>快捷栏</h3>
          <div class="sb-hotbar"></div>
          <p class="smoke-bag-tip">把烟拖到下面的格子里；手机上点一下香烟，再点格子也行。游戏里按 1–6 就是这几个格子。</p>
        </div>
      </div>
    </section>`

  // 背包按钮放进快捷栏最左边（1 号格之前），而不是右下角单独一个
  hotbar.append(bagButton)
  document.body.append(hotbar, toastEl, mask)

  const grid = mask.querySelector<HTMLElement>('.smoke-bag-grid')!
  const bagHotbar = mask.querySelector<HTMLElement>('.sb-hotbar')!

  let selected: string | null = null
  let burningPack: string | null = null
  let burningRatio = 1
  let lastPaintedRatio = -1
  let toastTimer = 0

  /* --------------------------------------------------------------- 渲染 */

  function renderHotbar(container: HTMLElement, inBag: boolean) {
    const inventory = env.inventory()
    container.replaceChildren()
    // 背包按钮要固定在 1 号格左边：replaceChildren 会清掉它，这里补回去
    if (container === hotbar) container.append(bagButton)
    for (let slot = 0; slot < HOTBAR_SLOTS; slot++) {
      const pack = inventory.packs.find(item => item.id === inventory.hotbar[slot])
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'smoke-slot' + (pack ? '' : ' is-empty')
      if (pack && pack.id === burningPack) button.classList.add('is-burning')
      if (pack && pack.id === selected) button.classList.add('is-selected')
      button.dataset.slot = String(slot)
      button.setAttribute(
        'aria-label',
        pack
          ? `快捷栏 ${slot + 1}：${brandOf(pack.brand).name}，剩 ${pack.cigarettes} 根`
          : `快捷栏 ${slot + 1}：空`,
      )
      if (pack) {
        const brand = brandOf(pack.brand)
        button.innerHTML =
          `<span class="ss-key">${slot + 1}</span>` +
          `<span class="ss-chip" style="background:linear-gradient(160deg,${brand.pack},${brand.lid})"></span>` +
          `<span class="ss-name">${brand.name}</span>` +
          `<span class="ss-left">${pack.cigarettes}根</span>` +
          `<span class="ss-bar"><i></i></span><span class="ss-drop" role="button" aria-label="从快捷栏丢下">×</span>`
        const bar = button.querySelector<HTMLElement>('.ss-bar i')
        if (bar) bar.style.width = pack.id === burningPack ? `${Math.round(burningRatio * 100)}%` : '0%'
        // 快捷栏丢弃：× 把这一格清空（背包里那包还在）
        const drop = button.querySelector<HTMLElement>('.ss-drop')
        if (drop) {
          drop.addEventListener('pointerdown', event => {
            event.preventDefault()
            event.stopPropagation()
          })
          drop.addEventListener('click', event => {
            event.stopPropagation()
            env.clear(slot)
            api.refresh()
          })
        }
      } else {
        button.innerHTML = `<span class="ss-key">${slot + 1}</span><span class="ss-empty">空</span>`
        // 空
      }
      if (inBag) {
        button.setAttribute(DROP, String(slot))
        button.addEventListener('pointerdown', event => beginDrag(event, pack?.id ?? null, slot, button))
      } else {
        button.addEventListener('pointerdown', event => {
          event.preventDefault()
          if (api.bagOpen) return
          env.use(slot)
        })
      }
      container.append(button)
    }
  }

  function renderBag() {
    const inventory = env.inventory()
    const slotOf = new Map<string, number>()
    inventory.hotbar.forEach((id, index) => {
      if (id) slotOf.set(id, index)
    })
    grid.replaceChildren()
    for (const pack of inventory.packs) {
      const brand = brandOf(pack.brand)
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'sb-pack' + (pack.cigarettes <= 0 ? ' is-empty' : '')
      card.setAttribute('role', 'listitem')
      card.dataset.pack = pack.id
      card.setAttribute(DROP, 'bag')
      card.setAttribute('aria-label', `${brand.name}，剩 ${pack.cigarettes} 根`)
      if (pack.id === selected) card.classList.add('is-selected')
      const slot = slotOf.get(pack.id)
      if (slot !== undefined) {
        card.classList.add('is-placed')
        card.dataset.slot = String(slot + 1)
      }
      card.innerHTML = `${packFace(pack)}<span class="sb-pack-count">${pack.cigarettes} 根</span><span class="sb-pack-drop" role="button" tabindex="0" aria-label="丢弃这包烟">丢弃</span>`
      // 丢弃这一包（从背包移除，快捷栏里的同 id 也会消失）
      const dropButton = card.querySelector<HTMLElement>('.sb-pack-drop')!
      dropButton.addEventListener('pointerdown', event => event.stopPropagation())
      dropButton.addEventListener('click', event => {
        event.stopPropagation()
        if (!confirm('丢弃「' + brand.name + '」这一包？')) return
        env.dropPack(pack.id)
        renderBag()
      })
      card.addEventListener('pointerdown', event => beginDrag(event, pack.id, null, card))
      grid.append(card)
    }
    renderHotbar(bagHotbar, true)
    renderHotbar(hotbar, false)
    renderItems()
    lastPaintedRatio = burningRatio
  }

  /** 背包里的非香烟物品（身份证等）：查看 / 丢弃 */
  function renderItems() {
    const holder = mask.querySelector<HTMLElement>('.sb-items')
    const empty = mask.querySelector<HTMLElement>('.sb-items-empty')
    if (!holder) return
    void import('../items').then(module => {
      const items = module.listItems()
      if (empty) empty.hidden = items.length > 0
      holder.replaceChildren()
      for (const item of items) {
        const card = document.createElement('div')
        card.className = 'sb-item'
        card.setAttribute('role', 'listitem')
        card.innerHTML =
          '<span class="sb-item-icon" aria-hidden="true">证</span>' +
          '<span class="sb-item-text"><b></b><small></small></span>' +
          '<span class="sb-item-actions">' +
          '<button type="button" data-use>查看</button>' +
          '<button type="button" data-drop>丢弃</button>' +
          '</span>'
        card.querySelector('b')!.textContent = item.name
        const no = item.data && typeof item.data.number === 'string' ? item.data.number : ''
        card.querySelector('small')!.textContent = no ? '编号 ' + no : ''
        card.querySelector<HTMLButtonElement>('[data-use]')!.onclick = () => void module.useItem(item)
        card.querySelector<HTMLButtonElement>('[data-drop]')!.onclick = () => {
          if (!confirm('丢弃「' + item.name + '」？丢了可以重新开卡领取')) return
          module.dropItem(item.id)
          renderItems()
          toastEl.textContent = '已丢弃 ' + item.name
          toastEl.classList.add('show')
          window.setTimeout(() => toastEl.classList.remove('show'), 1800)
        }
        holder.append(card)
      }
    })
  }

  /* --------------------------------------------------------------- 拖动 */

  interface DragState {
    packId: string
    fromSlot: number | null
    startX: number
    startY: number
    pointerId: number
    moved: boolean
    ghost: HTMLElement | null
    target: HTMLElement | null
  }

  let drag: DragState | null = null

  function highlight(target: HTMLElement | null) {
    for (const element of Array.from(mask.querySelectorAll('.is-over'))) element.classList.remove('is-over')
    if (target && target.dataset.drop !== 'bag') target.classList.add('is-over')
  }

  function beginDrag(event: PointerEvent, packId: string | null, fromSlot: number | null, source: HTMLElement) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (!packId) {
      // 空格子被点：把手上选中的那包放进来
      if (fromSlot !== null && selected) {
        event.preventDefault()
        env.assign(selected, fromSlot)
        selected = null
        renderBag()
      }
      return
    }
    event.preventDefault()
    drag = {
      packId,
      fromSlot,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
      moved: false,
      ghost: null,
      target: null,
    }
    try {
      source.setPointerCapture(event.pointerId)
    } catch {
      /* 某些浏览器对已释放的指针会抛，忽略 */
    }
    window.addEventListener('pointermove', onMove, {passive: false})
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  function onMove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 7) return
    event.preventDefault()
    if (!drag.moved) {
      drag.moved = true
      const pack = env.inventory().packs.find(item => item.id === drag!.packId)
      if (pack) {
        const ghost = document.createElement('div')
        ghost.className = 'smoke-ghost'
        ghost.innerHTML = packFace(pack)
        document.body.append(ghost)
        drag.ghost = ghost
      }
    }
    if (drag.ghost) {
      drag.ghost.style.left = `${event.clientX}px`
      drag.ghost.style.top = `${event.clientY}px`
    }
    const under = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
    const drop = under?.closest<HTMLElement>(`[${DROP}]`) ?? null
    const inside = drop && mask.contains(drop) ? drop : null
    if (drag.target !== inside) {
      drag.target = inside
      highlight(inside)
    }
  }

  function stopTracking() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }

  function onUp() {
    stopTracking()
    if (!drag) return
    const current = drag
    drag = null
    current.ghost?.remove()
    highlight(null)

    if (!current.moved) {
      // 轻点：背包里的烟 = 选中 / 取消选中；快捷栏格子 = 把选中的放下
      if (current.fromSlot === null) {
        selected = selected === current.packId ? null : current.packId
        renderBag()
        return
      }
      if (selected && selected !== current.packId) {
        env.assign(selected, current.fromSlot)
        selected = null
        renderBag()
        return
      }
      selected = selected === current.packId ? null : current.packId
      renderBag()
      return
    }

    const under = current.target
    if (!under) return
    const kind = under.dataset.drop
    if (kind === 'bag') {
      if (current.fromSlot !== null) env.clear(current.fromSlot)
      selected = null
      renderBag()
      return
    }
    if (kind !== undefined && kind !== '') {
      env.assign(current.packId, Number(kind))
      selected = null
      renderBag()
    }
  }

  /* ------------------------------------------------------------- 对外 */

  const api: SmokeUi = {
    setVisible(next: boolean) {
      hotbar.hidden = !next
      bagButton.hidden = !next
      if (!next) api.toggleBag(false)
    },
    refresh: renderBag,
    setBurning(packId: string | null, ratio: number) {
      const nextRatio = Math.max(0, Math.min(1, ratio))
      if (packId !== burningPack) {
        burningPack = packId
        burningRatio = nextRatio
        renderBag()
        return
      }
      burningRatio = nextRatio
      if (Math.abs(nextRatio - lastPaintedRatio) < 0.012) return
      lastPaintedRatio = nextRatio
      for (const container of [hotbar, bagHotbar]) {
        const bar = container.querySelector<HTMLElement>('.smoke-slot.is-burning .ss-bar i')
        if (bar) bar.style.width = `${Math.round(nextRatio * 100)}%`
      }
    },
    toggleBag(force?: boolean) {
      const open = force ?? mask.hidden
      if (open === !mask.hidden) return
      mask.hidden = !open
      if (!open) {
        selected = null
        highlight(null)
      }
      renderBag()
      env.onBagToggle?.(open)
    },
    get bagOpen() {
      return !mask.hidden
    },
    toast(text: string) {
      toastEl.textContent = text
      toastEl.classList.add('show')
      clearTimeout(toastTimer)
      toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2000)
    },
    dispose() {
      clearTimeout(toastTimer)
      stopTracking()
      hotbar.remove()
      bagButton.remove()
      toastEl.remove()
      mask.remove()
    },
  }

  bagButton.addEventListener('click', () => api.toggleBag())
  mask.querySelector<HTMLElement>('.about-close')!.addEventListener('click', () => api.toggleBag(false))
  mask.addEventListener('pointerdown', event => {
    if (event.target === mask) api.toggleBag(false)
  })

  hotbar.hidden = true
  bagButton.hidden = true
  renderBag()
  return api
}
