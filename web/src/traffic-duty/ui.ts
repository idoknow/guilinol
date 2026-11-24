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

  function renderPanel(): void {
    const snap = lastSnapshot
    const lb = lastLeaderboard
    const fines = opts.getFineTable()
    for (const btn of tabBtns) {
      btn.setAttribute('aria-selected', String(btn.dataset.tdTab === activeTab))
    }

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
        <footer class="td-panel-foot">
          ${snap?.phase !== 'active' ? `<button type="button" class="td-btn td-btn--primary" data-td-action="start">开始执勤</button>` : ''}
        </footer>
      `
      bindPanelActions()
      return
    }

    const rulesHtml = `
      <div class="td-rules-grid">
        <div class="td-rule-item"><span>${VIOLATION_LABELS.no_helmet}</span><strong>¥${fines.no_helmet}</strong></div>
        <div class="td-rule-item"><span>${VIOLATION_LABELS.bike_double}</span><strong>¥${fines.bike_double}</strong></div>
        <div class="td-rule-item"><span>${VIOLATION_LABELS.ebike_overload}</span><strong>¥${fines.ebike_overload}</strong></div>
      </div>
    `

    if (snap?.phase === 'summary') {
      const titleText = snap.reportTitle ?? ''
      bodyEl.innerHTML = `
        <section class="td-summary-card" aria-label="执勤战报">
          <div class="td-report-title" data-td-report-title="1">${escapeHtml(titleText)}</div>
          <div class="td-summary-metrics">
            <b>¥${snap.totalFineYuan}</b>
            <span>劝导 ${snap.citedCount} 起${snap.lastRecordRank ? ` · 本榜第 ${snap.lastRecordRank} 名` : ''}</span>
          </div>
          ${rulesHtml.replace(`¥${fines.no_helmet}`, `${snap.breakdown.no_helmet} 起`).replace(`¥${fines.bike_double}`, `${snap.breakdown.bike_double} 起`).replace(`¥${fines.ebike_overload}`, `${snap.breakdown.ebike_overload} 起`)}
        </section>
        <footer class="td-panel-foot">
          <button type="button" class="td-btn" data-td-action="rank">榜单</button>
          <button type="button" class="td-btn td-btn--primary" data-td-action="start">再执一班</button>
        </footer>
      `
      bindPanelActions()
      return
    }

    if (snap?.phase === 'active') {
      bodyEl.innerHTML = `
        <section class="td-summary-card">
          <div class="td-summary-metrics">
            <b>¥${snap.totalFineYuan}</b>
            <span>剩余 ${formatClock(snap.remainingSec)} · 劝导 ${snap.citedCount} 起</span>
          </div>
        </section>
        ${rulesHtml}
        <footer class="td-panel-foot">
          <button type="button" class="td-btn" data-td-action="abandon">结束</button>
          <button type="button" class="td-btn td-btn--primary" data-td-action="close">继续执勤</button>
        </footer>
      `
      bindPanelActions()
      return
    }

    const goBtn = !snap?.inDutyZone && opts.onGoBridge
      ? `<button type="button" class="td-btn" data-td-action="go-bridge">前往解放桥</button>`
      : ''

    bodyEl.innerHTML = `
      ${rulesHtml}
      <footer class="td-panel-foot">
        ${goBtn}
        <button type="button" class="td-btn" data-td-action="rank">榜单</button>
        <button type="button" class="td-btn td-btn--primary" data-td-action="start">开始执勤</button>
      </footer>
    `
    bindPanelActions()
  }

  function bindPanelActions(): void {
    const actionEls = Array.from(bodyEl.querySelectorAll<HTMLButtonElement>('[data-td-action]'))
    for (const btn of actionEls) {
      btn.onclick = () => {
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
      }
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
    entry.hidden = !showEntry
    if (leaderboard.bestFineYuan > 0) {
      entryBestEl.hidden = false
      entryBestEl.textContent = `¥${leaderboard.bestFineYuan}`
    } else {
      entryBestEl.hidden = true
    }

    bar.hidden = snapshot.phase !== 'active'
    if (snapshot.phase === 'active') {
      timerEl.textContent = formatClock(snapshot.remainingSec)
      timerEl.classList.toggle('is-urgent', snapshot.remainingSec < 30)
      fineEl.textContent = `¥${snapshot.totalFineYuan}`
      countEl.textContent = `${snapshot.citedCount} 起`
    }

    if (!opts.arbiterWired && snapshot.phase === 'active' && candidate) {
      whistleBtn.hidden = false
      whistleBtn.textContent = `[F] ${candidate.label}`
      whistleBtn.setAttribute('aria-label', candidate.label)
    } else {
      whistleBtn.hidden = true
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
    activeTab = lastSnapshot?.phase === 'summary' ? 'duty' : 'duty'
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
