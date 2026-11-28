import './ui.css'
import {formatEscapeAriaLabel} from './jiefang-escape.ts'
import {
  ALL_ACTIVE_VIOLATIONS,
  DEFAULT_OFFICER_TALK_RANGE_M,
  formatViolationFormula,
  VIOLATION_LABELS,
  type DutyBubbleSnapshot,
  type DutyFineTable,
  type DutySignalKind,
  type DutyZoneId,
  type FineTerminalRequest,
  type FineTerminalResult,
  type LeaderboardSummary,
  type TrafficDutyInteractCandidate,
  type TrafficDutySnapshot,
} from './types.ts'

/** 逃逸气泡：距视口边缘最小留白（px）。 */
const ESCAPE_EDGE_MARGIN_PX = 12
/** 逃逸气泡：与顶部 HUD / 底部执勤三键坞的最小间距（px）。 */
const ESCAPE_HUD_GAP_PX = 8
/** 逃逸气泡：尾巴高度（px，需与 ui.css `--td-escape-tail` 一致）。 */
const ESCAPE_TAIL_PX = 9
/** 逃逸气泡：尾巴距气泡左右边缘的最小内缩（px）。 */
const ESCAPE_TAIL_INSET_PX = 16
/** 逃逸气泡淡出时长（与 ui.css 200ms 一致）。 */
const ESCAPE_FADE_OUT_MS = 200
const ESCAPE_FADE_OUT_SEC = ESCAPE_FADE_OUT_MS / 1000

interface EscapeSafeBand {
  width: number
  top: number
  bottom: number
}

export interface TrafficDutyUiOptions {
  container: HTMLElement
  arbiterWired: boolean
  alwaysShowEntry: boolean
  onTalkOfficer: () => void
  onReportOffDuty?: () => void
  onAbandon: () => void
  onFinish: () => void
  onInteract: () => void
  onSignal: (kind: DutySignalKind) => void
  onGoBridge?: () => void
  onGoZone?: (zoneId: DutyZoneId) => void
  getFineTable: () => DutyFineTable
}

export interface TrafficDutyUiHandle {
  render(snapshot: TrafficDutySnapshot, leaderboard: LeaderboardSummary, candidate: TrafficDutyInteractCandidate | null): void
  openPanel(tab?: 'duty' | 'rank'): void
  closePanel(): void
  isPanelOpen(): boolean
  openFallbackFineTerminal?(req: FineTerminalRequest): Promise<FineTerminalResult>
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

  // Idle guidance pill: opens duty info / leaderboard / teleport to officer — NEVER directly starts duty
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.className = 'td-entry'
  entry.dataset.tdEntry = '1'
  entry.setAttribute('aria-label', '查看解放桥交警执勤站与榜单')
  const entryLabelEl = document.createElement('span')
  entryLabelEl.className = 'td-entry-label'
  entryLabelEl.textContent = '解放桥交警'
  const entryBestEl = document.createElement('span')
  entryBestEl.className = 'td-entry-best'
  entryBestEl.hidden = true
  entry.append(entryLabelEl, entryBestEl)
  stopPointerLeak(entry)
  root.append(entry)

  // Screen-space overhead badge pinned to the Jiefang Bridge officer so players spot him immediately
  const officerMarker = document.createElement('button')
  officerMarker.type = 'button'
  officerMarker.className = 'td-officer-marker'
  officerMarker.dataset.tdOfficerMarker = '1'
  officerMarker.hidden = true
  officerMarker.setAttribute('aria-label', '解放桥交警执勤位置')
  stopPointerLeak(officerMarker)
  root.append(officerMarker)

  const topStack = document.createElement('div')
  topStack.className = 'td-top-stack'

  // Active duty status strip: real-time count, total fines, 10% pending commission & prominent off-duty check-in button
  const bar = document.createElement('section')
  bar.className = 'td-bar'
  bar.dataset.tdBar = '1'
  bar.hidden = true
  bar.setAttribute('aria-label', '解放桥交通劝导执勤状态')
  const timerEl = document.createElement('span')
  timerEl.className = 'td-stat td-stat--timer'
  timerEl.dataset.tdStat = 'timer'
  timerEl.textContent = '10:00'
  const countEl = document.createElement('span')
  countEl.className = 'td-stat td-stat--muted'
  countEl.dataset.tdStat = 'count'
  countEl.textContent = '开单 0 单'
  const fineEl = document.createElement('span')
  fineEl.className = 'td-stat'
  fineEl.dataset.tdStat = 'fine'
  fineEl.textContent = '罚款 ¥0'
  const earningsEl = document.createElement('span')
  earningsEl.className = 'td-stat td-stat--earnings'
  earningsEl.dataset.tdStat = 'earnings'
  earningsEl.textContent = '待领10% ¥0'
  const offDutyBarBtn = document.createElement('button')
  offDutyBarBtn.type = 'button'
  offDutyBarBtn.className = 'td-btn td-btn--primary'
  offDutyBarBtn.dataset.tdAction = 'report-off-duty'
  offDutyBarBtn.textContent = '下岗交差'
  const rankBarBtn = document.createElement('button')
  rankBarBtn.type = 'button'
  rankBarBtn.className = 'td-btn'
  rankBarBtn.dataset.tdAction = 'rank'
  rankBarBtn.textContent = '排行'
  const abandonBarBtn = document.createElement('button')
  abandonBarBtn.type = 'button'
  abandonBarBtn.className = 'td-btn'
  abandonBarBtn.dataset.tdAction = 'abandon'
  abandonBarBtn.textContent = '放弃'
  bar.append(timerEl, countEl, fineEl, earningsEl, offDutyBarBtn, rankBarBtn, abandonBarBtn)
  stopPointerLeak(bar)

  // Active duty whistle, command-flag & ticket 3-key action dock (desktop keycaps + touch buttons)
  const signalDock = document.createElement('div')
  signalDock.className = 'td-signal-dock'
  signalDock.dataset.tdSignalDock = '1'
  signalDock.hidden = true
  signalDock.setAttribute('aria-label', '执勤哨、指挥旗与开单操作')
  const makeSignalBtn = (sig: string, keyCap: string, label: string, primary = false) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = primary ? 'td-btn td-btn--primary' : 'td-btn'
    btn.dataset.tdSignal = sig
    const kbd = document.createElement('kbd')
    kbd.className = 'td-kbd'
    kbd.textContent = keyCap
    const span = document.createElement('span')
    span.textContent = label
    if (sig === 'ticket') span.dataset.tdTicketLabel = '1'
    btn.append(kbd, span)
    return {btn, span}
  }
  const whistleSig = makeSignalBtn('whistle', 'Q', '吹哨', true)
  const stopSig = makeSignalBtn('flag_stop', 'E', '挥旗拦停')
  const goSig = makeSignalBtn('flag_go', '长按E', '放行')
  const ticketSig = makeSignalBtn('ticket', 'F', '开单')
  signalDock.append(whistleSig.btn, stopSig.btn, goSig.btn, ticketSig.btn)
  stopPointerLeak(signalDock)

  // Out-of-bounds warning banner while on duty
  const boundsBanner = document.createElement('div')
  boundsBanner.className = 'td-bounds-banner'
  boundsBanner.dataset.tdBoundsBanner = '1'
  boundsBanner.setAttribute('role', 'status')
  boundsBanner.hidden = true

  topStack.append(bar, signalDock, boundsBanner)
  root.append(topStack)

  // Standalone fallback interact button (only shown when walk/interact-arbiter is not wired)
  const whistleBtn = document.createElement('button')
  whistleBtn.type = 'button'
  whistleBtn.className = 'td-whistle-btn'
  whistleBtn.dataset.tdAction = 'interact'
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
  const panelHead = document.createElement('header')
  panelHead.className = 'td-panel-head'
  const headingEl = document.createElement('h2')
  headingEl.dataset.tdHeading = '1'
  headingEl.textContent = '解放桥交通劝导'
  const panelActions = document.createElement('div')
  panelActions.className = 'td-panel-actions'
  const tabsWrap = document.createElement('div')
  tabsWrap.className = 'td-tabs'
  tabsWrap.setAttribute('role', 'tablist')
  const dutyTabBtn = document.createElement('button')
  dutyTabBtn.type = 'button'
  dutyTabBtn.className = 'td-tab'
  dutyTabBtn.setAttribute('role', 'tab')
  dutyTabBtn.dataset.tdTab = 'duty'
  dutyTabBtn.setAttribute('aria-selected', 'true')
  dutyTabBtn.textContent = '执勤'
  const rankTabBtn = document.createElement('button')
  rankTabBtn.type = 'button'
  rankTabBtn.className = 'td-tab'
  rankTabBtn.setAttribute('role', 'tab')
  rankTabBtn.dataset.tdTab = 'rank'
  rankTabBtn.setAttribute('aria-selected', 'false')
  rankTabBtn.textContent = '榜单'
  tabsWrap.append(dutyTabBtn, rankTabBtn)
  const closeDialogBtn = document.createElement('button')
  closeDialogBtn.type = 'button'
  closeDialogBtn.className = 'td-close'
  closeDialogBtn.dataset.tdAction = 'close'
  closeDialogBtn.setAttribute('aria-label', '关闭')
  closeDialogBtn.textContent = '×'
  panelActions.append(tabsWrap, closeDialogBtn)
  panelHead.append(headingEl, panelActions)
  const bodyEl = document.createElement('div')
  bodyEl.className = 'td-panel-body'
  dialog.append(panelHead, bodyEl)
  stopPointerLeak(dialog)
  root.append(dialog)

  // Fallback fine confirmation dialog (used only when external fineTerminal bridge is not wired)
  const fallbackFineDialog = document.createElement('dialog')
  fallbackFineDialog.className = 'td-panel td-fine-fallback'
  fallbackFineDialog.dataset.tdFineFallback = '1'
  fallbackFineDialog.setAttribute('aria-label', '电子罚单确认')
  stopPointerLeak(fallbackFineDialog)
  root.append(fallbackFineDialog)

  const tabBtns = [dutyTabBtn, rankTabBtn]

  let activeTab: 'duty' | 'rank' = 'duty'
  let lastSnapshot: TrafficDutySnapshot | null = null
  let lastLeaderboard: LeaderboardSummary = {entries: [], bestFineYuan: 0}
  let renderedPanelSig = ''
  let panelFineEl: HTMLElement | null = null
  let panelMetaEl: HTMLElement | null = null
  let renderedEntryShow = false
  let renderedEntryLabel = ''
  let renderedBestFine = -1
  let renderedBarVisible = false
  let renderedDockVisible = false
  let renderedBoundsText = ''
  let renderedClock = ''
  let renderedUrgent = false
  let renderedFine = ''
  let renderedEarnings = ''
  let renderedCount = ''
  let renderedWhistleText = ''
  // 全局 [F] 提示按钮（walk/vehicles.ts 建、interact-arbiter 写 data-interact-action），断开后重新找。
  let promptEl: HTMLButtonElement | null = null
  let pendingFallbackResolve: ((res: FineTerminalResult) => void) | null = null

  function renderViolationGrid(items: readonly {label: string; value: string}[]): string {
    // 7 项（含「走人行道」）改 4 列两行：桌面与手机横屏 844×390 均不内滚
    const cls = items.length >= 7 ? 'td-rules-grid td-rules-grid--7' : 'td-rules-grid'
    return `<div class="${cls}" data-td-rules-count="${items.length}">${items
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
    if (action === 'talk-officer') {
      dialog.close()
      opts.onTalkOfficer()
    } else if (action === 'report-off-duty') {
      dialog.close()
      if (opts.onReportOffDuty) opts.onReportOffDuty()
      else opts.onTalkOfficer()
    } else if (action === 'abandon') {
      opts.onAbandon()
    } else if (action === 'rank') {
      activeTab = 'rank'
      renderPanel()
    } else if (action === 'go-bridge') {
      dialog.close()
      if (opts.onGoZone) opts.onGoZone('jiefang')
      else opts.onGoBridge?.()
    } else if (action === 'close') {
      dialog.close()
    }
  })

  signalDock.addEventListener('click', e => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-td-signal]')
    if (!btn) return
    const kind = btn.dataset.tdSignal
    if (kind === 'ticket') {
      opts.onInteract()
      return
    }
    if (kind === 'whistle' || kind === 'flag_stop' || kind === 'flag_go') {
      opts.onSignal(kind)
    }
  })

  function renderPanel(): void {
    const snap = lastSnapshot
    const lb = lastLeaderboard
    const fines = opts.getFineTable()
    for (const btn of tabBtns) {
      btn.setAttribute('aria-selected', String(btn.dataset.tdTab === activeTab))
    }
    const headingText = '解放桥交通劝导'
    if (headingEl.textContent !== headingText) headingEl.textContent = headingText

    const nearOfficer = snap?.officerDistanceM !== null && snap?.officerDistanceM !== undefined && snap.officerDistanceM <= DEFAULT_OFFICER_TALK_RANGE_M + 0.5
    const fineSig = ALL_ACTIVE_VIOLATIONS.map(k => fines[k]).join(',')
    let nextSig = ''
    if (activeTab === 'rank') {
      nextSig = `rank|${snap?.phase !== 'active' ? 1 : 0}|${nearOfficer ? 1 : 0}|${leaderboardSig(lb)}`
    } else if (snap?.phase === 'summary') {
      const bdSig = ALL_ACTIVE_VIOLATIONS.map(k => snap.breakdown[k] ?? 0).join(',')
      nextSig = `summary|${snap.totalFineYuan}|${snap.settledEarningsYuan}|${snap.pendingEarningsYuan}|${snap.citedCount}|${snap.lastRecordRank ?? ''}|${snap.reportTitle ?? ''}|${nearOfficer ? 1 : 0}|${bdSig}`
    } else if (snap?.phase === 'active') {
      nextSig = `active|${nearOfficer ? 1 : 0}|${fineSig}`
    } else {
      const distBucket = snap?.officerDistanceM != null ? Math.round(snap.officerDistanceM) : -1
      nextSig = `idle|${nearOfficer ? 1 : 0}|${distBucket}|${opts.onGoZone || opts.onGoBridge ? 1 : 0}|${fineSig}`
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
        const cta =
          snap?.phase === 'active'
            ? ''
            : nearOfficer
              ? `<button type="button" class="td-btn td-btn--primary" data-td-action="talk-officer">与交警对话上岗</button>`
              : opts.onGoZone || opts.onGoBridge
                ? `<button type="button" class="td-btn td-btn--primary" data-td-action="go-bridge">前往解放桥交警</button>`
                : ''
        bodyEl.innerHTML = `
          ${listHtml}
          <div class="td-panel-foot">${cta}</div>
        `
        return
      }

      const rulesHtml = renderViolationGrid(
        ALL_ACTIVE_VIOLATIONS.map(k => ({label: VIOLATION_LABELS[k], value: `¥${fines[k]}`})),
      )

      if (snap?.phase === 'summary') {
        const titleText = snap.reportTitle ?? ''
        const countsHtml = renderViolationGrid(
          ALL_ACTIVE_VIOLATIONS.map(k => ({label: VIOLATION_LABELS[k], value: `${snap.breakdown[k] ?? 0} 起`})),
        )
        const earningsLine =
          snap.settledEarningsYuan > 0
            ? `已向交警交差下岗，10% 执勤分成 ¥${snap.settledEarningsYuan} 已入账。`
            : snap.pendingEarningsYuan > 0
              ? `尚有待领 10% 执勤分成 ¥${snap.pendingEarningsYuan}，请找解放桥交警交差领取。`
              : snap.totalFineYuan > 0
                ? '本次未向交警交差下岗，执勤分成未发放。'
                : '本次无开单记录，随时可找解放桥交警再接一班。'
        const nextShiftBtn =
          snap.pendingEarningsYuan > 0
            ? `<button type="button" class="td-btn td-btn--primary" data-td-action="report-off-duty">${nearOfficer ? '向交警交差领分成' : '去交警岗交差领分成'}</button>`
            : nearOfficer
              ? `<button type="button" class="td-btn td-btn--primary" data-td-action="talk-officer">找交警再接一班</button>`
              : `<button type="button" class="td-btn td-btn--primary" data-td-action="go-bridge">回解放桥交警岗</button>`
        bodyEl.innerHTML = `
          <section class="td-summary-card" aria-label="执勤战报">
            <div class="td-report-title" data-td-report-title="1">${escapeHtml(titleText)}</div>
            <div class="td-summary-metrics">
              <b>¥${snap.totalFineYuan}</b>
              <span>劝导 ${snap.citedCount} 起${snap.lastRecordRank ? ` · 本榜第 ${snap.lastRecordRank} 名` : ''}</span>
            </div>
            <p class="td-guide-note">${escapeHtml(earningsLine)}</p>
            ${countsHtml}
          </section>
          <div class="td-panel-foot">
            <button type="button" class="td-btn" data-td-action="rank">榜单</button>
            ${nextShiftBtn}
          </div>
        `
        return
      }

      if (snap?.phase === 'active') {
        const offDutyBtn = `<button type="button" class="td-btn td-btn--primary" data-td-action="report-off-duty">${nearOfficer ? '下岗交差' : '回交警岗下岗交差'}</button>`
        bodyEl.innerHTML = `
          <section class="td-summary-card">
            <div class="td-summary-metrics">
              <b data-td-panel-fine="1">罚款 ¥${snap.totalFineYuan}</b>
              <span data-td-panel-meta="1">剩余 ${formatClock(snap.remainingSec)} · 开单 ${snap.citedCount} 单 · 待领10% ¥${snap.pendingEarningsYuan}</span>
            </div>
            <p class="td-guide-note">执勤范围限定在解放桥桥面内；多项违法按「数罪并罚」叠加开单，10% 分成待向交警下岗交差后一次性入账。</p>
          </section>
          ${rulesHtml}
          <div class="td-panel-foot">
            <button type="button" class="td-btn" data-td-action="abandon">直接放弃</button>
            ${offDutyBtn}
            <button type="button" class="td-btn" data-td-action="close">继续执勤</button>
          </div>
        `
        panelFineEl = bodyEl.querySelector<HTMLElement>('[data-td-panel-fine]')
        panelMetaEl = bodyEl.querySelector<HTMLElement>('[data-td-panel-meta]')
        return
      }

      const distLine =
        snap?.officerDistanceM != null
          ? nearOfficer
            ? '已抵达解放桥交警身旁，按 F 对话领取哨子与指挥旗即可原地开始执勤。'
            : `解放桥西桥头交警距当前位置约 ${Math.round(snap.officerDistanceM)} 米，需先找交警对话领装后上岗。`
          : '请前往解放桥西桥头与交警对话，领取执勤哨与指挥旗后在桥面原地开始执勤。'

      const actionBtn = nearOfficer
        ? `<button type="button" class="td-btn td-btn--primary" data-td-action="talk-officer">与交警对话领任务</button>`
        : opts.onGoZone || opts.onGoBridge
          ? `<button type="button" class="td-btn td-btn--primary" data-td-action="go-bridge">前往解放桥交警</button>`
          : `<button type="button" class="td-btn" data-td-action="close">知道了</button>`

      bodyEl.innerHTML = `
        <section class="td-summary-card">
          <div class="td-report-title">解放桥桥面定点执勤</div>
          <p class="td-guide-note">${escapeHtml(distLine)}</p>
        </section>
        ${rulesHtml}
        <div class="td-panel-foot">
          <button type="button" class="td-btn" data-td-action="rank">榜单</button>
          ${actionBtn}
        </div>
      `
      return
    }

    if (activeTab === 'duty' && snap?.phase === 'active' && panelFineEl && panelMetaEl) {
      const fineText = `罚款 ¥${snap.totalFineYuan}`
      const metaText = `剩余 ${formatClock(snap.remainingSec)} · 开单 ${snap.citedCount} 单 · 待领10% ¥${snap.pendingEarningsYuan}`
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

    const showEntry =
      snapshot.phase !== 'active' &&
      !snapshot.storyActive &&
      (opts.alwaysShowEntry || snapshot.inDutyZone || (snapshot.officerDistanceM !== null && snapshot.officerDistanceM <= 260))
    if (showEntry !== renderedEntryShow) {
      renderedEntryShow = showEntry
      entry.hidden = !showEntry
    }

    // 距离只报一处（IDOK-468）：交警在画面里时由头顶标记报，走到跟前由 [F] 提示接手，入口只留名字。
    const officerInView =
      !snapshot.terminalOpen &&
      !snapshot.knockdownActive &&
      Boolean(snapshot.officerScreen?.visible) &&
      snapshot.officerDistanceM !== null &&
      snapshot.officerDistanceM <= 180
    const nextEntryLabel =
      snapshot.officerDistanceM !== null && snapshot.officerDistanceM > DEFAULT_OFFICER_TALK_RANGE_M && !officerInView
        ? `解放桥交警 · ${Math.round(snapshot.officerDistanceM)}m`
        : '解放桥交警'
    if (nextEntryLabel !== renderedEntryLabel) {
      renderedEntryLabel = nextEntryLabel
      entryLabelEl.textContent = nextEntryLabel
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

    // Overhead screen-space officer marker: only a locator while the officer is out of talking range.
    // Within range the standard [F] prompt (.vehicle-action) carries 领任务 / 下岗交差, so the marker steps aside (IDOK-468).
    const showMarker =
      !snapshot.storyActive &&
      !snapshot.terminalOpen &&
      !snapshot.knockdownActive &&
      Boolean(snapshot.officerScreen?.visible) &&
      snapshot.officerDistanceM !== null &&
      snapshot.officerDistanceM > DEFAULT_OFFICER_TALK_RANGE_M &&
      snapshot.officerDistanceM <= 180
    officerMarker.hidden = !showMarker
    if (showMarker && snapshot.officerScreen && snapshot.officerDistanceM !== null) {
      const label = `解放桥交警 · ${Math.round(snapshot.officerDistanceM)}m`
      if (officerMarker.textContent !== label) officerMarker.textContent = label
      officerMarker.style.left = `${snapshot.officerScreen.x.toFixed(1)}px`
      officerMarker.style.top = `${snapshot.officerScreen.y.toFixed(1)}px`
    }

    const barVisible = snapshot.phase === 'active' && !snapshot.storyActive
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
      const countText = `开单 ${snapshot.citedCount} 单`
      if (countText !== renderedCount) {
        renderedCount = countText
        countEl.textContent = countText
      }
      const fineText = `罚款 ¥${snapshot.totalFineYuan}`
      if (fineText !== renderedFine) {
        renderedFine = fineText
        fineEl.textContent = fineText
      }
      // 下岗交差只出现一处：[F] 提示真的在报「下岗交差」时（仲裁选中了交警，而不是下车/上车），状态栏这颗按钮才让位。
      if (!promptEl?.isConnected) promptEl = document.querySelector<HTMLButtonElement>('.vehicle-action')
      const reportAtPrompt =
        Boolean(candidate?.isOffDutyReport) && !!promptEl && !promptEl.hidden && promptEl.dataset.interactAction === 'talk_officer'
      if (offDutyBarBtn.hidden !== reportAtPrompt) offDutyBarBtn.hidden = reportAtPrompt
      const earningsText = `待领10% ¥${snapshot.pendingEarningsYuan}`
      if (earningsText !== renderedEarnings) {
        renderedEarnings = earningsText
        earningsEl.textContent = earningsText
        earningsEl.classList.toggle('is-nonzero', snapshot.pendingEarningsYuan > 0)
      }
    }

    const dockVisible =
      snapshot.phase === 'active' &&
      !snapshot.storyActive &&
      !snapshot.terminalOpen &&
      !snapshot.knockdownActive &&
      (snapshot.gear.hasWhistle || snapshot.gear.hasFlag)
    if (dockVisible !== renderedDockVisible) {
      renderedDockVisible = dockVisible
      signalDock.hidden = !dockVisible
    }
    if (dockVisible) {
      whistleSig.btn.disabled = false
      stopSig.btn.disabled = snapshot.hasPendingCitation || snapshot.terminalOpen
      goSig.btn.disabled = snapshot.terminalOpen
      const nextTicketLbl = snapshot.handoverPending ? '递交罚单' : '开单'
      if (ticketSig.span.textContent !== nextTicketLbl) ticketSig.span.textContent = nextTicketLbl
    }
    if ((snapshot.storyActive || snapshot.terminalOpen || snapshot.knockdownActive) && dialog.open) {
      dialog.close()
    }

    const boundsText = snapshot.phase === 'active' && snapshot.outOfBoundsWarning ? snapshot.outOfBoundsWarning : ''
    if (boundsText !== renderedBoundsText) {
      renderedBoundsText = boundsText
      boundsBanner.hidden = !boundsText
      if (boundsText) boundsBanner.textContent = boundsText
    }

    const nextWhistle =
      !opts.arbiterWired && !snapshot.storyActive && !snapshot.terminalOpen && candidate
        ? `[F] ${candidate.label}`
        : ''
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
      const el = child as HTMLElement
      const id = el.dataset.tdBubbleId
      if (id && activeIds.has(id)) continue
      if (el.dataset.tdBubbleKind === 'escape') retireEscapeBubble(el)
      else el.remove()
    }
    let escapeBand: EscapeSafeBand | null = null
    for (const bubble of snapshot.bubbles) {
      const kind = bubble.kind === 'escape' ? 'escape' : 'citation'
      let el = bubblesLayer.querySelector<HTMLElement>(`[data-td-bubble-id="${bubble.id}"]`)
      if (!el) {
        el = kind === 'escape' ? createEscapeBubble(bubble) : createCitationBubble(bubble)
        bubblesLayer.append(el)
      }
      el.hidden = !bubble.visible
      if (!bubble.visible) continue
      if (kind === 'escape') {
        if (!escapeBand) escapeBand = measureEscapeSafeBand()
        placeEscapeBubble(el, bubble, escapeBand)
        if (bubble.remainingSec <= ESCAPE_FADE_OUT_SEC) el.classList.add('td-bubble--leaving')
      } else {
        el.style.left = `${bubble.screenX.toFixed(1)}px`
        el.style.top = `${bubble.screenY.toFixed(1)}px`
      }
    }

    if (dialog.open) renderPanel()
  }

  // ─── 气泡：开单（米纸）/ 逃逸（墨玉）───

  function createCitationBubble(bubble: DutyBubbleSnapshot): HTMLElement {
    const el = document.createElement('div')
    el.className = 'td-bubble'
    el.dataset.tdBubbleId = bubble.id
    el.dataset.tdBubbleKind = 'citation'
    el.setAttribute('role', 'status')
    const strong = document.createElement('strong')
    strong.textContent = bubble.title
    const span = document.createElement('span')
    span.textContent = bubble.line
    el.append(strong, span)
    return el
  }

  function createEscapeBubble(bubble: DutyBubbleSnapshot): HTMLElement {
    const el = document.createElement('div')
    el.className = 'td-bubble td-bubble--escape'
    el.dataset.tdBubbleId = bubble.id
    el.dataset.tdBubbleKind = 'escape'
    el.setAttribute('role', 'status')
    const shout = bubble.shout ?? bubble.title
    const vow = bubble.vow ?? bubble.line
    el.setAttribute(
      'aria-label',
      bubble.violations && bubble.violations.length > 0
        ? formatEscapeAriaLabel(bubble.violations)
        : `违规车加速逃离：${shout}${vow}`,
    )
    const shoutEl = document.createElement('strong')
    shoutEl.className = 'td-bubble-shout'
    shoutEl.dataset.tdBubblePart = 'shout'
    shoutEl.textContent = shout
    const vowEl = document.createElement('span')
    vowEl.className = 'td-bubble-vow'
    vowEl.dataset.tdBubblePart = 'vow'
    vowEl.textContent = vow
    el.append(shoutEl, vowEl)
    return el
  }

  const retireTimers = new Set<ReturnType<typeof setTimeout>>()

  /** 逃逸气泡退场：200ms 淡出后移除；减少动态效果时立即移除。 */
  function retireEscapeBubble(el: HTMLElement): void {
    if (el.dataset.tdBubbleRetiring === '1') return
    el.dataset.tdBubbleRetiring = '1'
    if (prefersReducedMotion() || el.hidden) {
      el.remove()
      return
    }
    el.classList.add('td-bubble--leaving')
    const timer = globalThis.setTimeout(() => {
      retireTimers.delete(timer)
      el.remove()
    }, ESCAPE_FADE_OUT_MS + 40)
    retireTimers.add(timer)
  }

  /** 逃逸气泡可用安全带：顶部避开执勤条 / 信号坞 / 越界横幅，底部避开执勤三键坞与独立吹哨键。 */
  function measureEscapeSafeBand(): EscapeSafeBand {
    const vw =
      (typeof window !== 'undefined' ? window.innerWidth : 0) ||
      (typeof document !== 'undefined' ? document.documentElement?.clientWidth : 0) ||
      0
    const vh =
      (typeof window !== 'undefined' ? window.innerHeight : 0) ||
      (typeof document !== 'undefined' ? document.documentElement?.clientHeight : 0) ||
      0
    let top = ESCAPE_EDGE_MARGIN_PX
    for (const hudEl of [bar, signalDock, boundsBanner]) {
      if (hudEl.hidden || !hudEl.isConnected) continue
      const r = hudEl.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0 || r.top > vh * 0.5) continue
      top = Math.max(top, r.bottom + ESCAPE_HUD_GAP_PX)
    }
    let bottom = vh - ESCAPE_EDGE_MARGIN_PX
    const dock = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('.td-duty-keys-dock') : null
    for (const lowEl of [dock, whistleBtn]) {
      if (!lowEl || lowEl.hidden || !lowEl.isConnected) continue
      const r = lowEl.getBoundingClientRect()
      if (r.width > 0 && r.height > 0 && r.top > vh * 0.4) bottom = Math.min(bottom, r.top - ESCAPE_HUD_GAP_PX)
    }
    return {width: vw, top, bottom}
  }

  function placeEscapeBubble(el: HTMLElement, bubble: DutyBubbleSnapshot, band: EscapeSafeBand): void {
    const w = el.offsetWidth
    const h = el.offsetHeight
    const minX = ESCAPE_EDGE_MARGIN_PX + w / 2
    const maxX = Math.max(minX, band.width - ESCAPE_EDGE_MARGIN_PX - w / 2)
    const x = Math.min(maxX, Math.max(minX, bubble.screenX))
    // 锚点 = 尾巴尖（骑手头顶）；气泡主体位于锚点上方 h + 尾巴高度
    const minY = band.top + h + ESCAPE_TAIL_PX
    const maxY = band.bottom
    if (minY > maxY) {
      // 矮屏 + 越界横幅同时出现时安全带不足：本帧不显示，绝不压住顶部状态条或底部执勤键
      el.hidden = true
      return
    }
    const y = Math.min(maxY, Math.max(minY, bubble.screenY))
    el.style.left = `${x.toFixed(1)}px`
    el.style.top = `${y.toFixed(1)}px`
    const tailLimit = Math.max(0, w / 2 - ESCAPE_TAIL_INSET_PX)
    const tailShift = Math.max(-tailLimit, Math.min(tailLimit, bubble.screenX - x))
    el.style.setProperty('--td-tail-x', `${tailShift.toFixed(1)}px`)
    // 被纵向夹紧（骑手贴近顶部 HUD / 底部按键）时尾巴已无法指向骑手：收起尾巴
    el.dataset.tdTail = Math.abs(y - bubble.screenY) > 2 ? 'off' : 'on'
  }

  function prefersReducedMotion(): boolean {
    if (typeof matchMedia !== 'function') return false
    try {
      return matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      return false
    }
  }

  function openFallbackFineTerminal(req: FineTerminalRequest): Promise<FineTerminalResult> {
    if (pendingFallbackResolve) {
      pendingFallbackResolve({issued: false, cancelled: true})
      pendingFallbackResolve = null
    }
    const fines = opts.getFineTable()
    const viols = req.violations && req.violations.length > 0 ? req.violations : [req.violation]
    const isStacked = viols.length > 1
    const stackedFormula = isStacked ? formatViolationFormula(viols, fines) : ''
    const itemsHtml = isStacked
      ? renderViolationGrid(viols.map(v => ({label: VIOLATION_LABELS[v], value: `¥${fines[v]}`})))
      : ''
    fallbackFineDialog.innerHTML = `
      <header class="td-panel-head">
        <h2>${isStacked ? '电子罚单终端 · 数罪并罚' : '电子罚单终端'}</h2>
        <button type="button" class="td-close" data-td-fine="cancel" aria-label="取消">×</button>
      </header>
      <div class="td-panel-body">
        <section class="td-summary-card">
          <div class="td-report-title">${escapeHtml(req.zoneName)} · ${isStacked ? `数罪并罚（${escapeHtml(stackedFormula)}）` : escapeHtml(req.violationLabel)}</div>
          <div class="td-summary-metrics">
            <b>¥${req.fineYuan}</b>
            <span>车型：${req.vehicleSubtype === 'bicycle' ? '单车' : '两轮电动车'}</span>
          </div>
          ${itemsHtml}
          <p class="td-guide-note">确认核对无误后签发模拟电子罚单；取消将不计入本班劝导成绩。</p>
        </section>
        <div class="td-panel-foot">
          <button type="button" class="td-btn" data-td-fine="cancel">取消</button>
          <button type="button" class="td-btn td-btn--primary" data-td-fine="issue">签发并交付</button>
        </div>
      </div>
    `
    return new Promise<FineTerminalResult>(resolve => {
      pendingFallbackResolve = resolve
      const finish = (issued: boolean) => {
        if (!pendingFallbackResolve) return
        const done = pendingFallbackResolve
        pendingFallbackResolve = null
        if (fallbackFineDialog.open) fallbackFineDialog.close()
        done(
          issued
            ? {
                issued: true,
                fineYuan: req.fineYuan,
                violations: req.violations,
                ticketId: `GL-${Date.now().toString(36).toUpperCase()}`,
              }
            : {issued: false, cancelled: true},
        )
      }
      fallbackFineDialog.onclick = e => {
        if (e.target === fallbackFineDialog) {
          finish(false)
          return
        }
        const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-td-fine]')
        if (!btn) return
        finish(btn.dataset.tdFine === 'issue')
      }
      fallbackFineDialog.oncancel = e => {
        e.preventDefault()
        finish(false)
      }
      if (!fallbackFineDialog.open) fallbackFineDialog.showModal()
    })
  }

  entry.onclick = () => {
    activeTab = 'duty'
    renderPanel()
    if (!dialog.open) dialog.showModal()
  }

  officerMarker.onclick = () => {
    if (lastSnapshot?.phase === 'active' || (lastSnapshot?.phase === 'summary' && lastSnapshot.pendingEarningsYuan > 0)) {
      if (opts.onReportOffDuty) opts.onReportOffDuty()
      else opts.onTalkOfficer()
    } else {
      opts.onTalkOfficer()
    }
  }

  offDutyBarBtn.onclick = () => {
    if (opts.onReportOffDuty) opts.onReportOffDuty()
    else opts.onTalkOfficer()
  }

  rankBarBtn.onclick = () => {
    activeTab = 'rank'
    renderPanel()
    if (!dialog.open) dialog.showModal()
  }

  abandonBarBtn.onclick = () => {
    opts.onAbandon()
  }

  whistleBtn.onclick = () => opts.onInteract()

  closeDialogBtn.onclick = () => {
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
    isPanelOpen: () => dialog.open || fallbackFineDialog.open,
    openFallbackFineTerminal,
    dispose() {
      for (const t of retireTimers) globalThis.clearTimeout(t)
      retireTimers.clear()
      if (pendingFallbackResolve) {
        pendingFallbackResolve({issued: false, cancelled: true})
        pendingFallbackResolve = null
      }
      if (fallbackFineDialog.open) fallbackFineDialog.close()
      if (dialog.open) dialog.close()
      root.remove()
    },
  }
}
