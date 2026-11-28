import {bindingLabel, hits} from '../../input/keymap.ts'
import {generateSimulatedQrMatrix} from '../handover/receipt-model.ts'
import {ALL_ACTIVE_VIOLATIONS, VIOLATION_LABELS, type ActiveViolation} from '../types.ts'
import {R8_DEFAULT_FINE_YUAN, resolveFineTable} from './engine.ts'
import {createFineTerminalModel, type FineTerminalVisualModel} from './model.ts'
import type {FineTerminalOpenOptions, FineTerminalSession, FineTerminalSnapshot} from './types.ts'

const STYLE_ELEMENT_ID = 'td-fine-terminal-style'

export const TERMINAL_OVERLAY_CSS = `
.td-fine-terminal {
  position: fixed;
  left: calc(14px + env(safe-area-inset-left, 0px));
  top: calc(152px + env(safe-area-inset-top, 0px));
  width: min(378px, calc(100vw - 28px));
  z-index: 68;
  background: rgba(20, 33, 30, 0.98);
  border: 1px solid rgba(201, 169, 110, 0.52);
  border-radius: 16px;
  box-shadow: 0 16px 40px rgba(8, 14, 12, 0.55);
  color: #f4efe2;
  font-family: var(--ui-serif, 'Noto Serif SC', 'Songti SC', Georgia, serif);
  padding: 11px 14px 12px;
  box-sizing: border-box;
  pointer-events: auto;
}
body[data-photo='on'] .td-fine-terminal,
body[data-home] .td-fine-terminal,
body[data-shop-open='1'] .td-fine-terminal { display: none !important; }
.td-ft-hero {
  display: flex; align-items: center; gap: 11px;
  border-bottom: 1px solid rgba(244, 239, 226, 0.14); padding-bottom: 9px; margin-bottom: 9px;
}
.td-ft-illust { width: 58px; height: 68px; flex-shrink: 0; display: block; }
.td-ft-head-copy { flex: 1; min-width: 0; }
.td-ft-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 5px; }
.td-ft-title { margin: 0; font-size: 14px; font-weight: 700; letter-spacing: 0.03em; color: #f4efe2; white-space: nowrap; }
.td-ft-badge {
  font-size: 10.5px; letter-spacing: 0.04em; padding: 2px 7px; border-radius: 999px;
  background: #223832; color: #d9be89; border: 1px solid rgba(201, 169, 110, 0.38);
  white-space: nowrap; flex-shrink: 0;
}
.td-ft-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
.td-ft-step {
  text-align: center; font-size: 10.5px; padding: 3px 4px; border-radius: 6px;
  border: 1px solid rgba(244, 239, 226, 0.14); color: rgba(244, 239, 226, 0.56);
  background: rgba(13, 22, 20, 0.72);
}
.td-ft-step.is-active { color: #f4efe2; background: #a9503c; border-color: #c56a56; font-weight: 700; }
.td-ft-step.is-done { color: #cbe7d5; background: #234638; border-color: rgba(114, 184, 145, 0.45); }
.td-ft-field { display: flex; flex-direction: column; gap: 3px; margin-bottom: 7px; }
.td-ft-label { font-size: 11px; color: rgba(244, 239, 226, 0.72); }
.td-ft-input, .td-ft-select {
  width: 100%; box-sizing: border-box; background: #0f1917; color: #f4efe2;
  border: 1px solid rgba(244, 239, 226, 0.24); border-radius: 7px;
  padding: 6px 9px; font-size: 12.5px; font-family: inherit;
}
.td-ft-chips { display: grid; grid-template-columns: repeat(2, 1fr); gap: 5px; margin-bottom: 7px; }
.td-ft-chip {
  display: flex; align-items: center; justify-content: space-between; padding: 5px 8px;
  border-radius: 7px; border: 1px solid rgba(244, 239, 226, 0.18);
  background: #12201d; color: rgba(244, 239, 226, 0.78); font-family: inherit; font-size: 11.5px; cursor: pointer;
}
.td-ft-chip.is-selected { background: #a9503c; border-color: #d0735e; color: #f4efe2; font-weight: 700; }
.td-ft-ticket {
  background: #f7f3e7; color: #14211e; border-radius: 8px; border: 1px dashed #6b6352;
  padding: 9px 11px; margin-bottom: 8px; font-size: 12px; line-height: 1.5;
}
.td-ft-ticket-head {
  font-weight: 700; font-size: 12.5px; border-bottom: 1px dashed rgba(20, 33, 30, 0.28);
  padding-bottom: 4px; margin-bottom: 5px; display: flex; justify-content: space-between;
}
.td-ft-ticket-body { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.td-ft-lines { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.td-ft-stack-banner {
  display: inline-flex; align-items: center; align-self: flex-start;
  padding: 2px 7px; margin-bottom: 3px; border-radius: 999px;
  background: #a9503c; color: #f7f3e7; font-size: 11px; font-weight: 700; letter-spacing: 0.04em;
}
.td-ft-line-row { display: flex; justify-content: space-between; font-size: 12px; }
.td-ft-line-total {
  display: flex; justify-content: space-between; font-weight: 700; color: #a9503c;
  border-top: 1px solid rgba(20, 33, 30, 0.2); margin-top: 3px; padding-top: 3px; font-size: 13px;
}
.td-ft-qr {
  width: 54px; height: 54px; flex-shrink: 0; border: 1px solid rgba(20, 33, 30, 0.22);
  background: #ffffff; image-rendering: pixelated;
}
.td-ft-progress-track {
  width: 100%; height: 7px; background: #0e1715; border-radius: 4px; overflow: hidden;
  border: 1px solid rgba(244, 239, 226, 0.18); margin: 6px 0 5px;
}
.td-ft-progress-fill { height: 100%; background: #a9503c; width: 0%; transition: width 80ms linear; }
.td-ft-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
.td-ft-btn {
  border-radius: 8px; border: 1px solid rgba(244, 239, 226, 0.22); padding: 7px 11px;
  font-size: 12.5px; font-family: inherit; cursor: pointer; color: #f4efe2; background: #1d2e29;
}
.td-ft-btn-primary { flex: 1; background: #a9503c; border-color: #c26853; font-weight: 700; }
.td-ft-btn-deliver { flex: 1; background: #285d47; border-color: #468a6d; font-weight: 700; }
.td-ft-btn:disabled { opacity: 0.48; cursor: default; }
.td-ft-meta { font-size: 11px; color: rgba(244, 239, 226, 0.68); margin: 3px 0 0; }
.td-ft-warn { font-size: 11.5px; color: #e69d8d; margin: 5px 0 0; }
.td-ft-input-layout { display: contents; }
.td-ft-col-left, .td-ft-col-right { display: contents; }
@media (hover: none) and (pointer: coarse) and (not (any-pointer: fine)) {
  .td-ft-kbd { display: none; }
}
@media (max-height: 520px) {
  .td-fine-terminal {
    left: calc(10px + env(safe-area-inset-left, 0px));
    top: calc(8px + env(safe-area-inset-top, 0px));
    width: min(590px, calc(100vw - 20px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)));
    max-height: calc(100dvh - 16px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
    padding: 8px 11px 9px;
    border-radius: 12px;
  }
  .td-ft-hero { gap: 8px; padding-bottom: 6px; margin-bottom: 6px; }
  .td-ft-illust { width: 38px; height: 44px; }
  .td-ft-head { margin-bottom: 4px; }
  .td-ft-title { font-size: 13px; }
  .td-ft-step { font-size: 10px; padding: 2px 4px; }
  .td-ft-input-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.18fr) minmax(0, 0.82fr);
    gap: 10px;
    align-items: start;
  }
  .td-ft-col-left, .td-ft-col-right { display: flex; flex-direction: column; min-width: 0; }
  .td-ft-field { gap: 2px; margin-bottom: 5px; }
  .td-ft-label { font-size: 10.5px; }
  .td-ft-input, .td-ft-select { padding: 4px 7px; font-size: 12px; }
  .td-ft-chips { gap: 4px; margin-bottom: 0; }
  .td-ft-chip { padding: 4px 6px; font-size: 11px; }
  .td-ft-ticket { padding: 7px 9px; margin-bottom: 6px; font-size: 11.5px; line-height: 1.4; }
  .td-ft-line-row { font-size: 11.5px; }
  .td-ft-line-total { font-size: 12.5px; }
  .td-ft-actions { margin-top: 4px; gap: 6px; }
  .td-ft-btn { padding: 6px 9px; font-size: 12px; }
}
`

function ensureStylesInjected(doc: Document): void {
  if (doc.getElementById(STYLE_ELEMENT_ID)) return
  const style = doc.createElement('style')
  style.id = STYLE_ELEMENT_ID
  style.textContent = TERMINAL_OVERLAY_CSS
  ;(doc.head ?? doc.body).appendChild(style)
}

/**
 * 精致矢量圆角热敏打印机 + 真皮皮套黄铜按扣 + 动态出纸凭条立绘 SVG（纯色山水印矢量，0 渐变）。
 */
function buildPrinterIllustrationSvg(snap: FineTerminalSnapshot): string {
  const paperH =
    snap.phase === 'printing'
      ? Math.round(4 + snap.printProgress * 18)
      : snap.phase === 'deliver'
        ? 18
        : 3
  const paperY = 20 - paperH
  const tornShiftX = snap.paperTornOff ? 4 : 0
  return `<svg class="td-ft-illust" viewBox="0 0 64 76" fill="none" aria-hidden="true">
    <rect x="19" y="${paperY}" width="26" height="${paperH}" rx="2" transform="translate(${tornShiftX},0)" fill="#f7f3e7" stroke="#6b6352" stroke-width="1"/>
    <line x1="${23 + tornShiftX}" y1="${paperY + 4}" x2="${41 + tornShiftX}" y2="${paperY + 4}" stroke="#a9503c" stroke-width="1.6"/>
    <rect x="11" y="18" width="42" height="52" rx="10" fill="#1c2c27" stroke="#c9a96e" stroke-width="1.3"/>
    <rect x="13" y="18" width="38" height="11" rx="5" fill="#a9503c"/>
    <rect x="18" y="20" width="28" height="2.6" rx="1" fill="#0b100e"/>
    <circle cx="45" cy="23.5" r="2" fill="#52d68a"/>
    <rect x="16" y="32" width="32" height="19" rx="4" fill="#16332c" stroke="#c9a96e" stroke-width="1"/>
    <line x1="20" y1="38" x2="42" y2="38" stroke="#cbe7d5" stroke-width="1.6"/>
    <line x1="20" y1="44" x2="36" y2="44" stroke="#e7c17a" stroke-width="2"/>
    <rect x="9" y="49" width="46" height="22" rx="8" fill="#322119" stroke="#6b4c3b" stroke-width="1"/>
    <rect x="15" y="45" width="11" height="16" rx="3.5" fill="#462f23" stroke="#7c5945" stroke-width="0.9"/>
    <circle cx="20.5" cy="56" r="2.6" fill="#dca542"/>
    <rect x="31" y="55" width="16" height="6" rx="3" fill="#a9503c"/>
  </svg>`
}

function createQrCanvas(doc: Document, payload: string): HTMLCanvasElement {
  const canvas = doc.createElement('canvas')
  canvas.className = 'td-ft-qr'
  const matrix = generateSimulatedQrMatrix(payload)
  const n = matrix.length
  const cell = 3
  canvas.width = n * cell + 6
  canvas.height = n * cell + 6
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#14211e'
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matrix[r][c]) {
          ctx.fillRect(3 + c * cell, 3 + r * cell, cell, cell)
        }
      }
    }
  }
  return canvas
}

function buildTicketLinesNode(doc: Document, snap: FineTerminalSnapshot): HTMLElement {
  const wrap = doc.createElement('div')
  wrap.className = 'td-ft-lines'
  if (snap.lineItems.length > 1) {
    const stackBanner = doc.createElement('div')
    stackBanner.className = 'td-ft-stack-banner'
    stackBanner.dataset.tdStackedBanner = '1'
    const formula = `${snap.lineItems.map(item => `¥${item.fineYuan}`).join('+')}=¥${snap.fineYuan}`
    stackBanner.textContent = `数罪并罚 · ${formula}`
    wrap.appendChild(stackBanner)
  }
  for (const item of snap.lineItems) {
    const r = doc.createElement('div')
    r.className = 'td-ft-line-row'
    r.dataset.tdFineItem = item.violation
    const l = doc.createElement('span')
    l.textContent = item.label
    const v = doc.createElement('span')
    v.textContent = `¥${item.fineYuan}`
    r.append(l, v)
    wrap.appendChild(r)
  }
  const tot = doc.createElement('div')
  tot.className = 'td-ft-line-total'
  tot.dataset.tdFineTotal = '1'
  const tl = doc.createElement('span')
  tl.textContent = snap.lineItems.length > 1 ? `数罪并罚合计（${snap.lineItems.length}项）` : '合计'
  const tv = doc.createElement('span')
  tv.textContent = `¥${snap.fineYuan}`
  tot.append(tl, tv)
  wrap.appendChild(tot)
  return wrap
}

export interface FineTerminalMountHandle {
  updateDom(): void
  cleanup(): void
}

export function mountFineTerminalOverlay(
  session: FineTerminalSession,
  options: FineTerminalOpenOptions,
): FineTerminalMountHandle {
  if (options.headless || typeof document === 'undefined') {
    return {
      updateDom() {},
      cleanup() {},
    }
  }

  const initialPhase = session.getPhase()
  if (initialPhase === 'done' || initialPhase === 'cancelled') {
    return {
      updateDom() {},
      cleanup() {},
    }
  }

  const doc = document
  const container = options.mountContainer ?? doc.body
  ensureStylesInjected(doc)
  const priceTable = resolveFineTable(options.fineTable ?? R8_DEFAULT_FINE_YUAN)

  let model: FineTerminalVisualModel | null = null
  const mount3DParent = options.firstPersonCamera ?? options.handAnchor ?? null
  if (mount3DParent) {
    model = createFineTerminalModel()
    if (options.firstPersonCamera && mount3DParent === options.firstPersonCamera) {
      model.group.position.set(0.19, -0.115, -0.52)
      model.group.rotation.set(0.26, -0.22, 0.03)
      model.group.scale.setScalar(1.22)
    }
    mount3DParent.add(model.group)
    model.update(session.getSnapshot())
  }

  const root = doc.createElement('div')
  root.className = 'td-fine-terminal td-panel'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', '文明交通劝导电子终端')
  doc.body.dataset.tdTerminalOpen = '1'

  let heroIllustHost: HTMLDivElement | null = null
  let plateInput: HTMLInputElement | null = null
  let progressBarFill: HTMLDivElement | null = null
  let progressText: HTMLParagraphElement | null = null
  let deliverHintEl: HTMLParagraphElement | null = null
  let deliverWarnEl: HTMLParagraphElement | null = null
  let deliverBtnEl: HTMLButtonElement | null = null
  let lastRenderedSig = ''

  const stepClass = (targetStep: 1 | 2 | 3, snap: FineTerminalSnapshot): string => {
    const order = snap.phase === 'input' ? 1 : snap.phase === 'printing' ? 2 : snap.phase === 'deliver' ? 3 : 4
    if (order > targetStep) return 'td-ft-step is-done'
    if (order === targetStep) return 'td-ft-step is-active'
    return 'td-ft-step'
  }

  const syncDeliverDynamicDom = (snap: FineTerminalSnapshot) => {
    const fKey = bindingLabel('dutyTicket').split(' / ')[0]
    const qKey = bindingLabel('dutyWhistle').split(' / ')[0]
    if (deliverHintEl) {
      if (snap.isHandingOver) {
        deliverHintEl.textContent = `正将凭单塞入对方${snap.handedSide === 'left' ? '左手' : '右手'}…`
      } else if (!snap.canDeliverWithinRange && snap.distanceToTargetM !== null) {
        deliverHintEl.textContent = `凭单已从腰挂机扯下，相距 ${snap.distanceToTargetM.toFixed(1)}m，走到 1.5m 内按 ${fKey} 就近塞他手上（可按 ${qKey} 吹哨）`
      } else {
        deliverHintEl.textContent = `凭单已从腰挂机扯下，按 ${fKey} / Enter 就近塞进对方手里`
      }
    }
    if (deliverWarnEl) {
      deliverWarnEl.textContent = snap.deliverError ?? ''
      deliverWarnEl.hidden = !snap.deliverError
    }
    if (deliverBtnEl) {
      deliverBtnEl.disabled = snap.isHandingOver || !snap.canDeliverWithinRange
      deliverBtnEl.textContent = snap.isHandingOver
        ? '塞单中…'
        : snap.canDeliverWithinRange
          ? `扯下塞进他手里 (${fKey})`
          : '走近 1.5m 内塞单'
    }
  }

  const renderPhase = (force = false) => {
    const snap = session.getSnapshot()
    model?.update(snap)

    const phaseSig = `${snap.phase}|${snap.paperTornOff ? 1 : 0}|${snap.violations.join(',')}|${snap.fineYuan}`
    if (!force && lastRenderedSig === phaseSig) {
      if (heroIllustHost && snap.phase === 'printing') {
        heroIllustHost.innerHTML = buildPrinterIllustrationSvg(snap)
      }
      if (snap.phase === 'input' && plateInput && doc.activeElement !== plateInput) {
        plateInput.value = snap.typing.completed ? snap.plateNo : snap.typing.typedPlateNo
      } else if (snap.phase === 'printing' && progressBarFill && progressText) {
        const pct = Math.round(snap.printProgress * 100)
        progressBarFill.style.width = `${pct}%`
        progressText.textContent = pct >= 100 ? '热敏吐纸完毕，请扯下凭单' : `腰挂热敏机吐纸中（${pct}%）…`
      } else if (snap.phase === 'deliver') {
        syncDeliverDynamicDom(snap)
      }
      return
    }
    lastRenderedSig = phaseSig
    root.replaceChildren()

    // 顶部精致立绘 + 步骤条一体区
    const hero = doc.createElement('div')
    hero.className = 'td-ft-hero'
    heroIllustHost = doc.createElement('div')
    heroIllustHost.innerHTML = buildPrinterIllustrationSvg(snap)

    const headCopy = doc.createElement('div')
    headCopy.className = 'td-ft-head-copy'
    const head = doc.createElement('div')
    head.className = 'td-ft-head'
    const hTitle = doc.createElement('h3')
    hTitle.className = 'td-ft-title'
    hTitle.textContent = `${snap.zoneName} · 执勤便携打单机`
    const badge = doc.createElement('span')
    badge.className = 'td-ft-badge'
    badge.textContent = snap.officerBadgeId
    head.append(hTitle, badge)

    const steps = doc.createElement('div')
    steps.className = 'td-ft-steps'
    const labels: readonly [1 | 2 | 3, string][] = [
      [1, '1 勾选核对'],
      [2, '2 吐纸扯下'],
      [3, '3 就近塞单'],
    ]
    for (const [idx, text] of labels) {
      const s = doc.createElement('div')
      s.className = stepClass(idx, snap)
      s.textContent = text
      steps.appendChild(s)
    }
    headCopy.append(head, steps)
    hero.append(heroIllustHost, headCopy)
    root.appendChild(hero)

    if (snap.phase === 'input') {
      const plateField = doc.createElement('div')
      plateField.className = 'td-ft-field'
      const pLbl = doc.createElement('label')
      pLbl.className = 'td-ft-label'
      pLbl.textContent = '车辆识别代号（模拟编号）'
      plateInput = doc.createElement('input')
      plateInput.className = 'td-ft-input'
      plateInput.value = snap.typing.completed ? snap.plateNo : snap.typing.typedPlateNo
      plateInput.addEventListener('focus', () => {
        session.completeTyping()
        if (plateInput) plateInput.value = session.getSnapshot().plateNo
      })
      plateInput.addEventListener('input', () => {
        if (plateInput) session.setPlateNo(plateInput.value)
      })
      plateField.append(pLbl, plateInput)

      const chipLbl = doc.createElement('div')
      chipLbl.className = 'td-ft-label'
      chipLbl.textContent = '违法事项（支持多选数罪并罚）'

      const chips = doc.createElement('div')
      chips.className = 'td-ft-chips'
      for (const v of ALL_ACTIVE_VIOLATIONS) {
        const selected = snap.violations.includes(v)
        const btn = doc.createElement('button')
        btn.type = 'button'
        btn.className = selected ? 'td-ft-chip is-selected' : 'td-ft-chip'
        btn.dataset.violationChip = v
        btn.setAttribute('aria-pressed', String(selected))
        const nameSpan = doc.createElement('span')
        nameSpan.textContent = VIOLATION_LABELS[v]
        const priceSpan = doc.createElement('span')
        priceSpan.textContent = `¥${priceTable[v]}`
        btn.append(nameSpan, priceSpan)
        btn.addEventListener('click', () => {
          session.toggleViolation(v, true)
          renderPhase(true)
        })
        chips.appendChild(btn)
      }

      const previewBox = doc.createElement('div')
      previewBox.className = 'td-ft-ticket'
      previewBox.appendChild(buildTicketLinesNode(doc, snap))

      const actions = doc.createElement('div')
      actions.className = 'td-ft-actions'
      const cancelBtn = doc.createElement('button')
      cancelBtn.className = 'td-ft-btn'
      cancelBtn.type = 'button'
      cancelBtn.innerHTML = '收起<span class="td-ft-kbd"> (Esc)</span>'
      cancelBtn.addEventListener('click', () => session.cancel('cancelled'))

      const printBtn = doc.createElement('button')
      printBtn.className = 'td-ft-btn td-ft-btn-primary'
      printBtn.type = 'button'
      printBtn.innerHTML = `打印吐纸 ¥${snap.fineYuan}<span class="td-ft-kbd"> (Enter)</span>`
      printBtn.addEventListener('click', () => session.confirmInput())

      actions.append(cancelBtn, printBtn)
      const layout = doc.createElement('div')
      layout.className = 'td-ft-input-layout'
      const colLeft = doc.createElement('div')
      colLeft.className = 'td-ft-col-left'
      colLeft.append(plateField, chipLbl, chips)
      const colRight = doc.createElement('div')
      colRight.className = 'td-ft-col-right'
      colRight.append(previewBox, actions)
      layout.append(colLeft, colRight)
      root.append(layout)
    } else if (snap.phase === 'printing') {
      const box = doc.createElement('div')
      box.className = 'td-ft-ticket'
      const th = doc.createElement('div')
      th.className = 'td-ft-ticket-head'
      th.innerHTML = `<span>${snap.zoneName}模拟劝导凭条</span><span>${snap.receiptNo}</span>`
      const tbody = doc.createElement('div')
      tbody.className = 'td-ft-ticket-body'
      tbody.append(buildTicketLinesNode(doc, snap), createQrCanvas(doc, snap.qrPayload))
      box.append(th, tbody)

      const track = doc.createElement('div')
      track.className = 'td-ft-progress-track'
      progressBarFill = doc.createElement('div')
      progressBarFill.className = 'td-ft-progress-fill'
      progressBarFill.style.width = `${Math.round(snap.printProgress * 100)}%`
      track.appendChild(progressBarFill)

      progressText = doc.createElement('p')
      progressText.className = 'td-ft-meta'
      progressText.textContent = `腰挂热敏机吐纸中（${Math.round(snap.printProgress * 100)}%）…`

      const actions = doc.createElement('div')
      actions.className = 'td-ft-actions'
      const cancelBtn = doc.createElement('button')
      cancelBtn.className = 'td-ft-btn'
      cancelBtn.type = 'button'
      cancelBtn.innerHTML = '中止打印<span class="td-ft-kbd"> (Esc)</span>'
      cancelBtn.addEventListener('click', () => session.cancel('cancelled'))
      actions.appendChild(cancelBtn)

      if (snap.printProgress >= 1 && !snap.paperTornOff) {
        const tearBtn = doc.createElement('button')
        tearBtn.className = 'td-ft-btn td-ft-btn-primary'
        tearBtn.type = 'button'
        tearBtn.innerHTML = '扯下凭单<span class="td-ft-kbd"> (Enter)</span>'
        tearBtn.addEventListener('click', () => session.tearOff())
        actions.appendChild(tearBtn)
      }

      root.append(box, track, progressText, actions)
    } else if (snap.phase === 'deliver') {
      const ticket = doc.createElement('div')
      ticket.className = 'td-ft-ticket'
      const th = doc.createElement('div')
      th.className = 'td-ft-ticket-head'
      th.innerHTML = `<span>${snap.zoneName}文明交通劝导单 · ${snap.plateNo}</span><span>${snap.receiptNo}</span>`
      const tbody = doc.createElement('div')
      tbody.className = 'td-ft-ticket-body'
      tbody.append(buildTicketLinesNode(doc, snap), createQrCanvas(doc, snap.qrPayload))
      ticket.append(th, tbody)

      deliverHintEl = doc.createElement('p')
      deliverHintEl.className = 'td-ft-meta'

      deliverWarnEl = doc.createElement('p')
      deliverWarnEl.className = 'td-ft-warn'
      deliverWarnEl.hidden = true

      const actions = doc.createElement('div')
      actions.className = 'td-ft-actions'
      const cancelBtn = doc.createElement('button')
      cancelBtn.className = 'td-ft-btn'
      cancelBtn.type = 'button'
      cancelBtn.textContent = '作废收起'
      cancelBtn.disabled = snap.isHandingOver
      cancelBtn.addEventListener('click', () => session.cancel('cancelled'))

      deliverBtnEl = doc.createElement('button')
      deliverBtnEl.className = 'td-ft-btn td-ft-btn-deliver'
      deliverBtnEl.type = 'button'
      deliverBtnEl.addEventListener('click', () => session.confirmDeliver())

      actions.append(cancelBtn, deliverBtnEl)
      root.append(ticket, deliverHintEl, deliverWarnEl, actions)
      syncDeliverDynamicDom(snap)
    }
  }

  const onKeyDown = (ev: KeyboardEvent) => {
    const snap = session.getSnapshot()
    if (ev.key === 'Escape') {
      ev.preventDefault()
      ev.stopPropagation()
      session.cancel('cancelled')
      return
    }
    if (hits(ev.code, 'dutyWhistle')) {
      return
    }
    if (hits(ev.code, 'dutyFlag')) {
      ev.preventDefault()
      ev.stopPropagation()
      return
    }
    if (ev.key === 'Enter') {
      ev.preventDefault()
      ev.stopPropagation()
      if (snap.phase === 'input') session.confirmInput()
      else if (snap.phase === 'printing' && snap.printProgress >= 1) session.tearOff()
      else if (snap.phase === 'deliver') session.confirmDeliver()
      return
    }
    if (hits(ev.code, 'dutyTicket') && doc.activeElement !== plateInput) {
      if (snap.phase === 'printing' && snap.printProgress >= 1) {
        ev.preventDefault()
        ev.stopPropagation()
        session.tearOff()
      } else if (snap.phase === 'deliver') {
        ev.preventDefault()
        ev.stopPropagation()
        session.confirmDeliver()
      }
    }
  }

  container.appendChild(root)
  doc.addEventListener('keydown', onKeyDown, true)
  renderPhase(true)

  let rafId = 0
  let lastMs = typeof performance !== 'undefined' ? performance.now() : Date.now()
  let cleaned = false

  const tick = (nowMs: number) => {
    if (cleaned) return
    const dt = Math.max(0, Math.min(0.1, (nowMs - lastMs) / 1000))
    lastMs = nowMs
    session.step(dt)
    renderPhase(false)
    const ph = session.getPhase()
    if (ph !== 'done' && ph !== 'cancelled') {
      rafId = requestAnimationFrame(tick)
    }
  }
  if (typeof requestAnimationFrame === 'function') {
    rafId = requestAnimationFrame(tick)
  }

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId)
    doc.removeEventListener('keydown', onKeyDown, true)
    delete doc.body.dataset.tdTerminalOpen
    root.remove()
    model?.dispose()
    model = null
  }

  void session.result.finally(() => cleanup())

  return {
    updateDom: () => renderPhase(false),
    cleanup,
  }
}
