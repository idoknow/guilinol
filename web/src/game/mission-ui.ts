import './mission-ui.css'
import {spots} from '../play/spots'
import {listMissionsForUi, type MissionRunnerEngine} from './missions'
import {getActiveSaveSnapshot as getSaveSnapshot} from './save'
import {getState, onState, type GameState} from './state'

export interface MissionUiController {
  openBoard(): void
  closeBoard(): void
  readonly boardOpen: boolean
  dispose(): void
}

export function mountMissionUi(
  runner: MissionRunnerEngine,
  getPlayerPos: () => {x: number; z: number} | undefined,
): MissionUiController {
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.className = 'gl-mission-entry'
  entry.setAttribute('aria-label', '打开接单与钱包面板')
  entry.innerHTML = '<b>¥200</b><i>接活</i>'
  document.body.append(entry)

  const hud = document.createElement('div')
  hud.className = 'gl-mission-hud'
  hud.hidden = true
  hud.innerHTML = `
    <section class="st-mission">
      <header>
        <span class="st-line"></span>
        <b class="st-step"></b>
        <time class="st-timer" hidden></time>
        <button type="button" class="gl-mission-abandon">放弃</button>
      </header>
      <div class="st-meter" hidden><span>汤</span><i><em></em></i></div>
      <p class="st-sub" hidden></p>
    </section>
  `
  document.body.append(hud)

  const dialog = document.createElement('dialog')
  dialog.className = 'mission-board'
  dialog.setAttribute('aria-label', '桂林通接单大厅')
  dialog.innerHTML = `
    <div class="mb-head">
      <h2>桂林通 · 接单大厅</h2>
      <div class="mb-wallet"><span></span><button type="button" class="mb-wardrobe-btn">衣橱</button><button type="button" class="mb-close" aria-label="关闭">×</button></div>
    </div>
    <div class="mb-body"></div>
  `
  document.body.append(dialog)

  const entryMoney = entry.querySelector('b')!
  const entryBadge = entry.querySelector('i')!
  const lineEl = hud.querySelector<HTMLElement>('.st-line')!
  const stepEl = hud.querySelector<HTMLElement>('.st-step')!
  const timerEl = hud.querySelector<HTMLElement>('.st-timer')!
  const abandonBtn = hud.querySelector<HTMLButtonElement>('.gl-mission-abandon')!
  const meterEl = hud.querySelector<HTMLElement>('.st-meter')!
  const meterLabelEl = meterEl.querySelector<HTMLElement>('span')!
  const meterFillEl = meterEl.querySelector<HTMLElement>('em')!
  const subEl = hud.querySelector<HTMLElement>('.st-sub')!
  const walletSpan = dialog.querySelector<HTMLElement>('.mb-wallet span')!
  const wardrobeBtn = dialog.querySelector<HTMLButtonElement>('.mb-wardrobe-btn')!
  const bodyEl = dialog.querySelector<HTMLElement>('.mb-body')!
  const closeBtn = dialog.querySelector<HTMLButtonElement>('.mb-close')!

  wardrobeBtn.onclick = () => {
    dialog.close()
    window.dispatchEvent(new CustomEvent('game:open-wardrobe'))
  }

  abandonBtn.onclick = () => {
    runner.abandon()
    renderBoard()
  }

  function renderBoard(): void {
    const s = getState()
    const save = getSaveSnapshot()
    walletSpan.textContent = `¥${s.money.toLocaleString('zh-CN')}`
    const items = listMissionsForUi()
    const claimedSpots = save.economy.claimedSpotBounties.length
    const quietHtml = s.zone.quiet
      ? `<div class="mb-quiet-banner">当前位于校园安静区（${s.zone.name ?? '学校周边'}）：禁止接单或召唤电摩，请走出校门后操作。</div>`
      : ''
    const spotTip = `<div class="mb-spots-tip">景册打卡赏金：已领 <b>${claimedSpots}</b> / ${spots.length} 处（每处首次打卡/拍照 +¥120）</div>`
    const cardsHtml = items
      .map(({def, firstClearDone, completions, firstClearReward, repeatReward}) => {
        const isCurrent = s.mission?.id === def.id
        const tagClass = def.line === 'errand' ? 'errand' : 'noodle'
        const tagText = ({errand: '商圈跑腿', noodle: '米粉外卖', taxi: '出租', race: '环城夜赛'})[def.line]
        const rewardText = firstClearDone
          ? `日常 ¥${repeatReward}（已首通）`
          : `首通 ¥${firstClearReward} · 复刷 ¥${repeatReward}`
        const metaText = firstClearDone ? `已完成 ${completions} 次` : '未首通 · 全额赏金'
        const btnHtml = isCurrent
          ? `<button type="button" class="mb-btn abandon" data-abandon="1">放弃任务</button>`
          : `<button type="button" class="mb-btn" data-start="${def.id}" ${s.zone.quiet || s.mission ? 'disabled' : ''}>${firstClearDone ? '再接一单' : '立即接单'}</button>`
        return `
          <article class="mb-card">
            <div class="mb-card-top">
              <div class="mb-card-title"><span class="mb-tag ${tagClass}">${tagText}</span><span>${def.title}</span></div>
              <span class="mb-reward">${rewardText}${def.line === 'taxi' ? ' + 计价器' : ''}</span>
            </div>
            <p class="mb-desc">${def.summary ?? ''}</p>
            <div class="mb-card-foot">
              <span class="mb-meta">${metaText} · ${def.steps.length} 步</span>
              ${btnHtml}
            </div>
          </article>
        `
      })
      .join('')
    bodyEl.innerHTML = `${quietHtml}${spotTip}${cardsHtml}`

    for (const btn of Array.from(bodyEl.querySelectorAll<HTMLButtonElement>('[data-start]'))) {
      btn.onclick = () => {
        const id = btn.dataset.start!
        const res = runner.start(id, getPlayerPos())
        if (res.ok) closeBoard()
        else renderBoard()
      }
    }
    const abortBtn = bodyEl.querySelector<HTMLButtonElement>('[data-abandon]')
    if (abortBtn) {
      abortBtn.onclick = () => {
        runner.abandon()
        renderBoard()
      }
    }
  }

  function renderHud(s: Readonly<GameState>): void {
    entryMoney.textContent = `¥${s.money.toLocaleString('zh-CN')}`
    entry.classList.toggle('quiet', s.zone.quiet)
    entryBadge.textContent = s.zone.quiet ? '安静区' : s.mission ? '进行中' : '接活'

    const m = s.mission
    hud.hidden = !m
    if (m) {
      lineEl.textContent = m.title
      stepEl.textContent = m.step
      if (m.timer !== undefined) {
        const mins = Math.floor(m.timer / 60)
        const secs = Math.floor(m.timer % 60)
        timerEl.hidden = false
        timerEl.textContent = m.frozen ? `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')} 暂停` : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
        timerEl.classList.toggle('low', m.timer < 30 && !m.frozen)
        timerEl.classList.toggle('frozen', !!m.frozen)
      } else {
        timerEl.hidden = true
      }
      if (m.meter) {
        meterEl.hidden = false
        meterLabelEl.textContent = m.meter.label
        meterFillEl.style.width = `${Math.round(Math.max(0, Math.min(1, m.meter.value)) * 100)}%`
      } else {
        meterEl.hidden = true
      }
      if (m.line) {
        subEl.hidden = false
        subEl.innerHTML = `<b>${m.line.who}</b>${m.line.text}`
      } else {
        subEl.hidden = true
      }
    }
    if (dialog.open) renderBoard()
  }

  function openBoard(): void {
    renderBoard()
    if (!dialog.open) dialog.showModal()
  }

  function closeBoard(): void {
    if (dialog.open) dialog.close()
  }

  entry.onclick = () => openBoard()
  closeBtn.onclick = () => closeBoard()
  dialog.addEventListener('click', event => {
    if (event.target === dialog) closeBoard()
  })

  const off = onState(renderHud)
  renderHud(getState())

  return {
    openBoard,
    closeBoard,
    get boardOpen() {
      return dialog.open
    },
    dispose() {
      off()
      entry.remove()
      hud.remove()
      dialog.remove()
    },
  }
}
