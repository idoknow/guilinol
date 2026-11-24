import './ui.css'
import {
  VIOLATION_LABELS,
  type DutyFineTable,
  type LeaderboardSummary,
  type TrafficDutyInteractCandidate,
  type TrafficDutySnapshot,
} from './types.ts'

export interface TrafficDutyUiOptions {
  container: HTMLElement
  arbiterWired: boolean
  alwaysShowEntry: boolean
  onStart: () => void
  onAbandon: () => void
  onFinish: () => void
  onWhistle: () => void
  onGoBridge?: () => void
  getFineTable: () => DutyFineTable
}

export interface TrafficDutyUiHandle {
  render(snapshot: TrafficDutySnapshot, leaderboard: LeaderboardSummary, candidate: TrafficDutyInteractCandidate | null): void
  openPanel(tab?: 'duty' | 'rank'): void
  closePanel(): void
  isPanelOpen(): boolean
  dispose(): void
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function stopPointerLeak(el: HTMLElement): void {
  el.addEventListener('pointerdown', e => e.stopPropagation())
}

export function mountTrafficDutyUi(opts: TrafficDutyUiOptions): TrafficDutyUiHandle {
  const root = document.createElement('div')
  root.className = 'td-hud-root'
  opts.container.append(root)

  const entry = document.createElement('button')
  entry.type = 'button'
  entry.className = 'td-entry'
  entry.dataset.tdEntry = '1'
  entry.setAttribute('aria-label', '打开解放桥交通劝导执勤面板')
  entry.innerHTML = '<span>解放桥劝导</span><span class="td-entry-best" hidden></span>'
  stopPointerLeak(entry)
  root.append(entry)

  const bar = document.createElement('section')
  bar.className = 'td-bar'
  bar.dataset.tdBar = '1'
  bar.hidden = true
  bar.setAttribute('aria-label', '交通劝导执勤状态')
  bar.innerHTML = `
    <span class="td-stat td-stat--timer" data-td-stat="timer">10:00</span>
    <span class="td-stat" data-td-stat="fine">¥0</span>
    <span class="td-stat td-stat--muted" data-td-stat="count">0 起</span>
    <button type="button" class="td-btn" data-td-action="rank">排行</button>
    <button type="button" class="td-btn" data-td-action="abandon">结束</button>
  `
  stopPointerLeak(bar)
  root.append(bar)

  const whistleBtn = document.createElement('button')
  whistleBtn.type = 'button'
  whistleBtn.className = 'td-whistle-btn'
  whistleBtn.dataset.tdAction = 'whistle'
  whistleBtn.hidden = true
  stopPointerLeak(whistleBtn)
  root.append(whistleBtn)

  const bubblesLayer = document.createElement('div')
  bubblesLayer.className = 'td-bubbles'
  bubblesLayer.setAttribute('aria-live', 'polite')
  root.append(bubblesLayer)

  const dialog = document.createElement('dialog')
  dialog.className = 'td-panel'
  dialog.dataset.tdPanel = '1'
  dialog.setAttribute('aria-label', '解放桥交通劝导')
  dialog.innerHTML = `
    <header class="td-panel-head">
      <h2>解放桥交通劝导</h2>
      <div class="td-panel-actions">
        <div class="td-tabs" role="tablist">
          <button type="button" class="td-tab" role="tab" data-td-tab="duty" aria-selected="true">执勤</button>
          <button type="button" class="td-tab" role="tab" data-td-tab="rank" aria-selected="false">榜单</button>
        </div>
        <button type="button" class="td-close" data-td-action="close" aria-label="关闭">×</button>
      </div>
    </header>
    <div class="td-panel-body"></div>
  `
  stopPointerLeak(dialog)
  root.append(dialog)

  const entryBestEl = entry.querySelector<HTMLElement>('.td-entry-best')!
  const timerEl = bar.querySelector<HTMLElement>('[data-td-stat="timer"]')!
  const fineEl = bar.querySelector<HTMLElement>('[data-td-stat="fine"]')!
  const countEl = bar.querySelector<HTMLElement>('[data-td-stat="count"]')!
  const bodyEl = dialog.querySelector<HTMLElement>('.td-panel-body')!
  const tabBtns = Array.from(dialog.querySelectorAll<HTMLButtonElement>('[data-td-tab]'))

  let activeTab: 'duty' | 'rank' = 'duty'
  let lastSnapshot: TrafficDutySnapshot | null = null
  let lastLeaderboard: LeaderboardSummary = {entries: [], bestFineYuan: 0}
  let renderedPanelSig = ''
  let panelFineEl: HTMLElement | null = null
  let panelMetaEl: HTMLElement | null = null
  let renderedEntryShow = false
  let renderedBestFine = -1
  let renderedBarVisible = false
  let renderedClock = ''
  let renderedUrgent = false
  let renderedFine = ''
  let renderedCount = ''
  let renderedWhistleText = ''

  function renderViolationGrid(items: readonly {label: string; value: string}[]): string {
    return `<div class="td-rules-grid">${items
      .map(item => `<div class="td-rule-item"><span>${item.label}</span><strong>${item.value}</strong></div>`)
      .join('')}</div>`
  }

  function leaderboardSig(lb: LeaderboardSummary): string {
    return `${lb.bestFineYuan}|${lb.entries
      .slice(0, 5)
      .map(e => `${e.id}:${e.totalFineYuan}:${e.citedCount}:${e.playerName}`)
      .join(';')}`
  }

  bodyEl.addEventListener('click', e => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-td-action]')
    if (!btn) return
    const action = btn.dataset.tdAction
    if (action === 'start') {
      dialog.close()
      opts.onStart()
    } else if (action === 'abandon') {
      opts.onAbandon()
    } else if (action === 'rank') {
      activeTab = 'rank'
      renderPanel()
    } else if (action === 'go-bridge') {
      dialog.close()
      opts.onGoBridge?.()
    } else if (action === 'close') {
      dialog.close()
    }
  })

  function renderPanel(): void {
    const snap = lastSnapshot
    const lb = lastLeaderboard
    const fines = opts.getFineTable()
    for (const btn of tabBtns) {
      btn.setAttribute('aria-selected', String(btn.dataset.tdTab === activeTab))
    }

    let nextSig = ''
    if (activeTab === 'rank') {
      nextSig = `rank|${snap?.phase !== 'active' ? 1 : 0}|${leaderboardSig(lb)}`
    } else if (snap?.phase === 'summary') {
      nextSig = `summary|${snap.totalFineYuan}|${snap.citedCount}|${snap.lastRecordRank ?? ''}|${snap.breakdown.no_helmet}|${snap.breakdown.bike_double}|${snap.breakdown.ebike_overload}`
    } else if (snap?.phase === 'active') {
      nextSig = `active|${fines.no_helmet}|${fines.bike_double}|${fines.ebike_overload}`
    } else {
      nextSig = `idle|${!snap?.inDutyZone && opts.onGoBridge ? 1 : 0}|${fines.no_helmet}|${fines.bike_double}|${fines.ebike_overload}`
    }

    if (nextSig !== renderedPanelSig) {
      renderedPanelSig = nextSig
      panelFineEl = null
      panelMetaEl = null

      if (activeTab === 'rank') {
        const top = lb.entries.slice(0, 5)
        const listHtml = top.length
          ? `<ol class="td-rank-list" aria-label="本地模拟罚单排行">${top
              .map(
                (item, idx) => `
              <li class="td-rank-row">
                <span class="td-rank-no">${idx + 1}</span>
                <span class="td-rank-name">${escapeHtml(item.playerName)}</span>
                <span class="td-rank-count">${item.citedCount} 起</span>
                <strong class="td-rank-fine">¥${item.totalFineYuan}</strong>
              </li>`,
              )
              .join('')}</ol>`
          : `<p class="td-empty">暂无执勤记录</p>`
        bodyEl.innerHTML = `
          ${listHtml}
          <div class="td-panel-foot">
            ${snap?.phase !== 'active' ? `<button type="button" class="td-btn td-btn--primary" data-td-action="start">开始执勤</button>` : ''}
          </div>
        `
        return
      }

      const rulesHtml = renderViolationGrid([
        {label: VIOLATION_LABELS.no_helmet, value: `¥${fines.no_helmet}`},
        {label: VIOLATION_LABELS.bike_double, value: `¥${fines.bike_double}`},
        {label: VIOLATION_LABELS.ebike_overload, value: `¥${fines.ebike_overload}`},
      ])

      if (snap?.phase === 'summary') {
        const titleText = snap.reportTitle ?? ''
        const countsHtml = renderViolationGrid([
          {label: VIOLATION_LABELS.no_helmet, value: `${snap.breakdown.no_helmet} 起`},
          {label: VIOLATION_LABELS.bike_double, value: `${snap.breakdown.bike_double} 起`},
          {label: VIOLATION_LABELS.ebike_overload, value: `${snap.breakdown.ebike_overload} 起`},
        ])
        bodyEl.innerHTML = `
          <section class="td-summary-card" aria-label="执勤战报">
            <div class="td-report-title" data-td-report-title="1">${escapeHtml(titleText)}</div>
            <div class="td-summary-metrics">
              <b>¥${snap.totalFineYuan}</b>
              <span>劝导 ${snap.citedCount} 起${snap.lastRecordRank ? ` · 本榜第 ${snap.lastRecordRank} 名` : ''}</span>
            </div>
            ${countsHtml}
          </section>
          <div class="td-panel-foot">
            <button type="button" class="td-btn" data-td-action="rank">榜单</button>
            <button type="button" class="td-btn td-btn--primary" data-td-action="start">再执一班</button>
          </div>
        `
        return
      }

      if (snap?.phase === 'active') {
        bodyEl.innerHTML = `
          <section class="td-summary-card">
            <div class="td-summary-metrics">
              <b data-td-panel-fine="1">¥${snap.totalFineYuan}</b>
              <span data-td-panel-meta="1">剩余 ${formatClock(snap.remainingSec)} · 劝导 ${snap.citedCount} 起</span>
            </div>
          </section>
          ${rulesHtml}
          <div class="td-panel-foot">
            <button type="button" class="td-btn" data-td-action="abandon">结束</button>
            <button type="button" class="td-btn td-btn--primary" data-td-action="close">继续执勤</button>
          </div>
        `
        panelFineEl = bodyEl.querySelector<HTMLElement>('[data-td-panel-fine]')
        panelMetaEl = bodyEl.querySelector<HTMLElement>('[data-td-panel-meta]')
        return
      }

      const goBtn = !snap?.inDutyZone && opts.onGoBridge
        ? `<button type="button" class="td-btn" data-td-action="go-bridge">前往解放桥</button>`
        : ''

      bodyEl.innerHTML = `
        ${rulesHtml}
        <div class="td-panel-foot">
          ${goBtn}
          <button type="button" class="td-btn" data-td-action="rank">榜单</button>
          <button type="button" class="td-btn td-btn--primary" data-td-action="start">开始执勤</button>
        </div>
      `
      return
    }

    if (activeTab === 'duty' && snap?.phase === 'active' && panelFineEl && panelMetaEl) {
      const fineText = `¥${snap.totalFineYuan}`
      const metaText = `剩余 ${formatClock(snap.remainingSec)} · 劝导 ${snap.citedCount} 起`
      if (panelFineEl.textContent !== fineText) panelFineEl.textContent = fineText
      if (panelMetaEl.textContent !== metaText) panelMetaEl.textContent = metaText
    }
  }

  function render(
    snapshot: TrafficDutySnapshot,
    leaderboard: LeaderboardSummary,
    candidate: TrafficDutyInteractCandidate | null,
  ): void {
    lastSnapshot = snapshot
    lastLeaderboard = leaderboard

    const showEntry = snapshot.phase !== 'active' && (opts.alwaysShowEntry || snapshot.inDutyZone)
    if (showEntry !== renderedEntryShow) {
      renderedEntryShow = showEntry
      entry.hidden = !showEntry
    }
    if (leaderboard.bestFineYuan !== renderedBestFine) {
      renderedBestFine = leaderboard.bestFineYuan
      if (leaderboard.bestFineYuan > 0) {
        entryBestEl.hidden = false
        entryBestEl.textContent = `¥${leaderboard.bestFineYuan}`
      } else {
        entryBestEl.hidden = true
      }
    }

    const barVisible = snapshot.phase === 'active'
    if (barVisible !== renderedBarVisible) {
      renderedBarVisible = barVisible
      bar.hidden = !barVisible
    }
    if (barVisible) {
      const clock = formatClock(snapshot.remainingSec)
      if (clock !== renderedClock) {
        renderedClock = clock
        timerEl.textContent = clock
      }
      const urgent = snapshot.remainingSec < 30
      if (urgent !== renderedUrgent) {
        renderedUrgent = urgent
        timerEl.classList.toggle('is-urgent', urgent)
      }
      const fineText = `¥${snapshot.totalFineYuan}`
      if (fineText !== renderedFine) {
        renderedFine = fineText
        fineEl.textContent = fineText
      }
      const countText = `${snapshot.citedCount} 起`
      if (countText !== renderedCount) {
        renderedCount = countText
        countEl.textContent = countText
      }
    }

    const nextWhistle = !opts.arbiterWired && snapshot.phase === 'active' && candidate ? `[F] ${candidate.label}` : ''
    if (nextWhistle !== renderedWhistleText) {
      renderedWhistleText = nextWhistle
      if (nextWhistle && candidate) {
        whistleBtn.hidden = false
        whistleBtn.textContent = nextWhistle
        whistleBtn.setAttribute('aria-label', candidate.label)
      } else {
        whistleBtn.hidden = true
      }
    }

    const activeIds = new Set(snapshot.bubbles.map(b => b.id))
    for (const child of Array.from(bubblesLayer.children)) {
      const id = (child as HTMLElement).dataset.tdBubbleId
      if (!id || !activeIds.has(id)) child.remove()
    }
    for (const bubble of snapshot.bubbles) {
      let el = bubblesLayer.querySelector<HTMLElement>(`[data-td-bubble-id="${bubble.id}"]`)
      if (!el) {
        el = document.createElement('div')
        el.className = 'td-bubble'
        el.dataset.tdBubbleId = bubble.id
        el.setAttribute('role', 'status')
        const strong = document.createElement('strong')
        strong.textContent = bubble.title
        const span = document.createElement('span')
        span.textContent = bubble.line
        el.append(strong, span)
        bubblesLayer.append(el)
      }
      el.hidden = !bubble.visible
      if (bubble.visible) {
        el.style.left = `${bubble.screenX.toFixed(1)}px`
        el.style.top = `${bubble.screenY.toFixed(1)}px`
      }
    }

    if (dialog.open) renderPanel()
  }

  entry.onclick = () => {
    activeTab = 'duty'
    renderPanel()
    if (!dialog.open) dialog.showModal()
  }

  bar.querySelector<HTMLButtonElement>('[data-td-action="rank"]')!.onclick = () => {
    activeTab = 'rank'
    renderPanel()
    if (!dialog.open) dialog.showModal()
  }

  bar.querySelector<HTMLButtonElement>('[data-td-action="abandon"]')!.onclick = () => {
    opts.onAbandon()
  }

  whistleBtn.onclick = () => opts.onWhistle()

  dialog.querySelector<HTMLButtonElement>('[data-td-action="close"]')!.onclick = () => {
    if (dialog.open) dialog.close()
  }
  for (const btn of tabBtns) {
    btn.onclick = () => {
      activeTab = btn.dataset.tdTab === 'rank' ? 'rank' : 'duty'
      renderPanel()
    }
  }
  dialog.addEventListener('click', e => {
    if (e.target === dialog) dialog.close()
  })

  return {
    render,
    openPanel(tab = 'duty') {
      activeTab = tab
      renderPanel()
      if (!dialog.open) dialog.showModal()
    },
    closePanel() {
      if (dialog.open) dialog.close()
    },
    isPanelOpen: () => dialog.open,
    dispose() {
      if (dialog.open) dialog.close()
      root.remove()
    },
  }
}
