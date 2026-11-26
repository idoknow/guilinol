/**
 * 解放桥交警岗前 GTA 风剧情状态机与对话导演（web/src/traffic-duty/story/director.ts）
 *
 * - 纯状态机可在 Node 单元测试无 DOM 运行；浏览器环境下挂载上下电影黑边、双侧真实离屏头像框与山水印对话卡片
 * - 集成 `camera-shots.ts` 5 机位切换（全景 / 交警近景 / 玩家反打 / 双人中景 / 桥面态势），对话结束 1:1 还原玩家机位
 * - 集成 `portraits.ts` 离屏渲染交警 4 表情与随换装实时更新的玩家头像，对话框左右两边同时展示头像
 * - 严禁私绑 `KeyF`（统一交由 walk/interact-arbiter 发起 `open()`）
 */

import {
  createDutyStoryCameraController,
  normalizeDutyShotId,
  type DutyCameraLike,
  type DutyShotAnchor,
  type DutyShotId,
  type DutyStoryCameraState,
  type DutyVec3Like,
} from './camera-shots.ts'
import {
  createDutyStoryPortraitManager,
  isPlaceholderPortrait,
  normalizePortraitExpr,
  OFFICER_PORTRAIT_EXPRESSIONS,
  type DutyPortraitBundle,
  type DutyStoryPortraitManager,
  type PortraitRendererHooks,
} from './portraits.ts'
import {
  getDutyStoryBeat,
  resolveDutySettlement,
  type DutyShiftSettlement,
  type DutyStoryBeat,
  type DutyStoryBeatId,
  type DutyStoryExpr,
  type DutyStoryLine,
  type ResolvedDutySettlement,
} from './script.ts'

if (typeof document !== 'undefined') {
  void import('./dialogue.css')
}

export interface DutyStoryGearReward {
  readonly hasWhistle: boolean
  readonly hasFlag: boolean
}

export interface DutyStorySnapshot {
  readonly active: boolean
  readonly beatId: DutyStoryBeatId | null
  readonly lineIndex: number
  readonly lineCount: number
  readonly line: DutyStoryLine | null
  readonly currentShot: DutyShotId | null
  readonly gearHandedOver: boolean
  readonly completedOnce: boolean
  readonly portraitsReady: boolean
  readonly officerPortraitUrl: string | null
  readonly playerPortraitUrl: string | null
  readonly outfitKey: string
  readonly cameraState: DutyStoryCameraState
}

export interface DutyStoryCompletePayload {
  readonly beatId: DutyStoryBeatId
  readonly accepted: boolean
  readonly skipped: boolean
  readonly gear: DutyStoryGearReward
  readonly lastChoiceId: string | null
}

export interface DutyStorySettledPayload {
  readonly settlement: ResolvedDutySettlement
  readonly skipped: boolean
  readonly lastChoiceId: string | null
}

export interface DutyStoryDirectorOptions {
  container?: HTMLElement | null
  mountDom?: boolean
  camera?: DutyCameraLike | null
  getPlayerPos?: () => DutyVec3Like | null
  getOfficerAnchor?: () => DutyShotAnchor | null
  portraitManager?: DutyStoryPortraitManager
  portraitHooks?: PortraitRendererHooks
  onOfficerExpression?: (expr: DutyStoryExpr) => void
  onOfficerLookTarget?: (pos: DutyVec3Like | null) => void
  onOpen?: (beatId: DutyStoryBeatId) => void
  onLineChange?: (line: DutyStoryLine, index: number, beat: DutyStoryBeat) => void
  onGearHandover?: (gear: DutyStoryGearReward) => void
  onComplete?: (payload: DutyStoryCompletePayload) => void
  onSettled?: (payload: DutyStorySettledPayload) => void
  onCancel?: (beatId: DutyStoryBeatId) => void
}

export interface DutyStoryDirectorHandle {
  open(beatId?: DutyStoryBeatId): boolean
  openOffDuty(
    settlement?: DutyShiftSettlement | null,
    onSettled?: (payload: DutyStorySettledPayload) => void,
  ): boolean
  step(dt: number): void
  advance(): boolean
  choose(choiceId: string): boolean
  skip(): boolean
  cancel(): boolean
  isActive(): boolean
  hasCompletedBriefing(): boolean
  getSnapshot(): DutyStorySnapshot
  refreshPortraits(forcePlayerRefresh?: boolean): Promise<DutyPortraitBundle | null>
  dispose(): void
}

interface ViewerRuntimeFallback {
  camera?: DutyCameraLike
  walk?: {
    position?: DutyVec3Like
    yaw?: number
    showFigure?: (on: boolean) => void
  }
  dutyOfficers?: {
    officers?: {
      jiefang?: {
        officerRoot?: {position?: DutyVec3Like; rotation?: {y: number}}
        position?: {x: number; y: number; z: number}
        headWorld?: () => DutyVec3Like
        setExpression?: (expr: string) => void
        setLookTarget?: (pos: {x: number; y?: number; z: number} | null) => void
      }
    }
  }
}

function getRuntimeViewer(): ViewerRuntimeFallback | null {
  if (typeof globalThis === 'undefined') return null
  const w = (globalThis as {window?: {viewer?: ViewerRuntimeFallback}}).window
  return w?.viewer ?? null
}

function setBodyFlag(active: boolean): void {
  if (typeof document === 'undefined' || !document.body) return
  document.body.dataset.tdStoryActive = active ? '1' : '0'
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false
  return Boolean((target as Element).closest('input,textarea,select,[contenteditable]'))
}

function flushPointerLock(): void {
  if (typeof document === 'undefined') return
  try {
    if (document.pointerLockElement) document.exitPointerLock?.()
  } catch {
    // ignore pointer lock release errors
  }
}

export function createDutyStoryDirector(opts: DutyStoryDirectorOptions = {}): DutyStoryDirectorHandle {
  let active = false
  let beat: DutyStoryBeat | null = null
  let lineIndex = 0
  let revealedChars = 0
  let charAccum = 0
  let gearHandedOver = false
  let completedOnce = false
  let lastChoiceId: string | null = null
  let pendingSettlement: ResolvedDutySettlement | null = null
  let pendingOnSettled: ((payload: DutyStorySettledPayload) => void) | null = null
  let settledEmitted = false
  let disposed = false

  const camRig = createDutyStoryCameraController()
  let activeCamera: DutyCameraLike | null = opts.camera ?? null
  const ownsPortraitManager = !opts.portraitManager
  const portraits: DutyStoryPortraitManager =
    opts.portraitManager ?? createDutyStoryPortraitManager(opts.portraitHooks)

  let topBarEl: HTMLElement | null = null
  let bottomBarEl: HTMLElement | null = null
  let dialogEl: HTMLElement | null = null
  let officerSlotEl: HTMLElement | null = null
  let playerSlotEl: HTMLElement | null = null
  let officerImgEl: HTMLImageElement | null = null
  let playerImgEl: HTMLImageElement | null = null
  let speakerEl: HTMLElement | null = null
  let progressEl: HTMLElement | null = null
  let textEl: HTMLElement | null = null
  let gearPillEl: HTMLElement | null = null
  let choicesEl: HTMLElement | null = null
  let footEl: HTMLElement | null = null
  let nextBtnEl: HTMLButtonElement | null = null
  let skipBtnEl: HTMLButtonElement | null = null
  let cancelBtnEl: HTMLButtonElement | null = null

  const shouldMountDom =
    opts.mountDom === true || (opts.mountDom !== false && typeof document !== 'undefined')

  function currentLine(): DutyStoryLine | null {
    if (!active || !beat) return null
    return beat.lines[lineIndex] ?? null
  }

  function resolveCamera(): DutyCameraLike | null {
    return opts.camera ?? activeCamera ?? getRuntimeViewer()?.camera ?? null
  }

  function resolvePlayerPos(): DutyVec3Like | null {
    return opts.getPlayerPos?.() ?? getRuntimeViewer()?.walk?.position ?? null
  }

  function resolveAnchor(): DutyShotAnchor {
    const custom = opts.getOfficerAnchor?.()
    if (custom) {
      return {
        npcPos: custom.npcPos,
        npcYaw: custom.npcYaw,
        npcHead: custom.npcHead,
        playerPos: custom.playerPos ?? (() => {
          const p = resolvePlayerPos()
          return p ? [p.x, p.y, p.z] : null
        })(),
      }
    }
    const viewer = getRuntimeViewer()
    const jiefang = viewer?.dutyOfficers?.officers?.jiefang
    const npcPosRaw = jiefang?.position ?? {x: -265.87, y: 151.85, z: 26.86}
    const npcYaw = jiefang?.officerRoot?.rotation?.y ?? 0.8
    const headRaw = jiefang?.headWorld?.() ?? {
      x: npcPosRaw.x,
      y: npcPosRaw.y + 1.62,
      z: npcPosRaw.z,
    }
    const player = resolvePlayerPos()
    return {
      npcPos: [npcPosRaw.x, npcPosRaw.y, npcPosRaw.z],
      npcYaw,
      npcHead: [headRaw.x, headRaw.y, headRaw.z],
      playerPos: player ? [player.x, player.y, player.z] : null,
    }
  }

  function applyOfficerLiveSignals(expr: DutyStoryExpr, activeLook: boolean): void {
    const mapped = normalizePortraitExpr(expr)
    if (opts.onOfficerExpression) {
      opts.onOfficerExpression(mapped)
    } else {
      getRuntimeViewer()?.dutyOfficers?.officers?.jiefang?.setExpression?.(mapped)
    }
    const targetPos = activeLook ? resolvePlayerPos() : null
    if (opts.onOfficerLookTarget) {
      opts.onOfficerLookTarget(targetPos)
    } else {
      getRuntimeViewer()?.dutyOfficers?.officers?.jiefang?.setLookTarget?.(
        targetPos ? {x: targetPos.x, y: targetPos.y, z: targetPos.z} : null,
      )
    }
  }

  function syncPortraitImgs(line: DutyStoryLine | null): void {
    if (!dialogEl) return
    const offUrl = line ? portraits.getOfficerUrl(line.expr) : portraits.getOfficerUrl('serious')
    const plUrl = portraits.getPlayerUrl()
    if (officerImgEl) {
      if (offUrl && !isPlaceholderPortrait(offUrl)) {
        if (officerImgEl.src !== offUrl) officerImgEl.src = offUrl
        officerImgEl.dataset.portraitLoaded = '1'
      } else {
        officerImgEl.removeAttribute('src')
        officerImgEl.dataset.portraitLoaded = '0'
      }
      if (line) {
        officerImgEl.dataset.officerExpr = normalizePortraitExpr(line.expr)
      }
    }
    if (playerImgEl) {
      if (plUrl && !isPlaceholderPortrait(plUrl)) {
        if (playerImgEl.src !== plUrl) playerImgEl.src = plUrl
        playerImgEl.dataset.portraitLoaded = '1'
      } else {
        playerImgEl.removeAttribute('src')
        playerImgEl.dataset.portraitLoaded = '0'
      }
      playerImgEl.dataset.outfitKey = portraits.getOutfitKey()
    }
    if (officerSlotEl) {
      officerSlotEl.hidden = false
    }
    if (playerSlotEl) {
      playerSlotEl.hidden = false
    }
  }

  function setLetterboxOpen(openState: boolean): void {
    if (topBarEl) {
      topBarEl.hidden = !openState
      topBarEl.dataset.open = openState ? '1' : '0'
    }
    if (bottomBarEl) {
      bottomBarEl.hidden = !openState
      bottomBarEl.dataset.open = openState ? '1' : '0'
    }
  }

  function getSnapshot(): DutyStorySnapshot {
    const line = currentLine()
    return {
      active,
      beatId: beat?.id ?? null,
      lineIndex,
      lineCount: beat?.lines.length ?? 0,
      line,
      currentShot: line ? normalizeDutyShotId(line.shot) : null,
      gearHandedOver,
      completedOnce,
      portraitsReady: portraits.isReady(),
      officerPortraitUrl: portraits.getOfficerUrl(line?.expr ?? 'serious'),
      playerPortraitUrl: portraits.getPlayerUrl(),
      outfitKey: portraits.getOutfitKey(),
      cameraState: camRig.getState(),
    }
  }

  function emitGearIfNeeded(line: DutyStoryLine): void {
    if (line.grantGear && !gearHandedOver) {
      gearHandedOver = true
      opts.onGearHandover?.({hasWhistle: true, hasFlag: true})
    }
  }

  function renderDom(resetTypewriter = false): void {
    const line = currentLine()
    if (!dialogEl) {
      setBodyFlag(Boolean(active && beat && line))
      return
    }
    if (!active || !beat || !line) {
      dialogEl.hidden = true
      delete dialogEl.dataset.speaker
      delete dialogEl.dataset.expr
      delete dialogEl.dataset.shot
      setLetterboxOpen(false)
      setBodyFlag(false)
      return
    }

    dialogEl.hidden = false
    dialogEl.dataset.speaker = line.speaker
    dialogEl.dataset.expr = normalizePortraitExpr(line.expr)
    dialogEl.dataset.shot = normalizeDutyShotId(line.shot)
    setLetterboxOpen(true)
    setBodyFlag(true)

    syncPortraitImgs(line)

    if (speakerEl) speakerEl.textContent = line.speakerLabel
    if (progressEl) progressEl.textContent = `${lineIndex + 1} / ${beat.lines.length}`
    if (resetTypewriter) {
      revealedChars = Math.min(line.text.length, Math.max(24, Math.floor(line.text.length * 0.65)))
      charAccum = 0
    }
    if (textEl) {
      textEl.textContent = line.text.slice(0, revealedChars || line.text.length)
    }
    if (gearPillEl) {
      if (beat.id === 'off_duty' && lineIndex >= beat.lines.length - 1 && pendingSettlement) {
        gearPillEl.hidden = false
        gearPillEl.textContent = `交差清点：开单 ${pendingSettlement.citedCount} 笔 · 合计 ${pendingSettlement.totalFineYuan} 元 · ${pendingSettlement.shareRatePct}% 分得 ${pendingSettlement.rewardYuan} 元`
      } else {
        gearPillEl.hidden = !line.grantGear
        gearPillEl.textContent = '已领装备：执勤哨 · 指挥旗 · 打印终端'
      }
    }

    if (choicesEl) {
      choicesEl.innerHTML = ''
      if (line.choices && line.choices.length > 0) {
        for (const choice of line.choices) {
          const btn = document.createElement('button')
          btn.type = 'button'
          btn.className = 'td-story-choice'
          btn.dataset.tdStoryChoice = choice.id
          btn.textContent = choice.text
          btn.onclick = () => {
            choose(choice.id)
          }
          choicesEl.append(btn)
        }
      }
    }

    const isOffDuty = beat.id === 'off_duty'
    if (skipBtnEl) {
      skipBtnEl.textContent = isOffDuty ? '快速交差' : '快进上岗'
    }
    if (cancelBtnEl) {
      cancelBtnEl.textContent = isOffDuty ? '暂不交差' : '暂不上岗'
    }
    const hasChoices = Boolean(line.choices && line.choices.length > 0)
    if (footEl) footEl.hidden = hasChoices
    if (nextBtnEl) {
      const isFinal = Boolean(line.endMode) || lineIndex >= beat.lines.length - 1
      nextBtnEl.textContent =
        line.endMode === 'decline'
          ? '先歇会儿'
          : isFinal
            ? isOffDuty
              ? '领款下岗'
              : '领装上岗'
            : '继续'
    }
  }

  function restoreCameraAndActor(): void {
    const cam = resolveCamera()
    if (cam && camRig.isActive()) {
      camRig.end(cam)
    }
    activeCamera = null
    applyOfficerLiveSignals('serious', false)
  }

  function finishBeat(accepted: boolean, skipped: boolean): void {
    const finishedBeat = beat
    if (!finishedBeat) return
    const isOffDuty = finishedBeat.id === 'off_duty'
    if (accepted && !isOffDuty && !gearHandedOver) {
      gearHandedOver = true
      opts.onGearHandover?.({hasWhistle: true, hasFlag: true})
    }
    if (accepted && !isOffDuty) completedOnce = true
    const shouldEmitSettled = isOffDuty && accepted && !settledEmitted
    const settledCallback = pendingOnSettled
    const settlementSnapshot = pendingSettlement ?? resolveDutySettlement(null)
    if (shouldEmitSettled) settledEmitted = true
    pendingSettlement = null
    pendingOnSettled = null
    active = false
    beat = null
    lineIndex = 0
    revealedChars = 0
    charAccum = 0
    restoreCameraAndActor()
    renderDom()
    if (shouldEmitSettled) {
      const settledPayload: DutyStorySettledPayload = {
        settlement: settlementSnapshot,
        skipped,
        lastChoiceId,
      }
      settledCallback?.(settledPayload)
      if (opts.onSettled && opts.onSettled !== settledCallback) {
        opts.onSettled(settledPayload)
      }
    }
    opts.onComplete?.({
      beatId: finishedBeat.id,
      accepted,
      skipped,
      gear: accepted && !isOffDuty ? {hasWhistle: true, hasFlag: true} : {hasWhistle: false, hasFlag: false},
      lastChoiceId,
    })
  }

  function enterLine(nextIdx: number): void {
    if (!beat) return
    lineIndex = Math.max(0, Math.min(beat.lines.length - 1, nextIdx))
    const line = beat.lines[lineIndex]
    emitGearIfNeeded(line)
    applyOfficerLiveSignals(line.speaker === 'officer' ? line.expr : 'serious', true)
    const cam = resolveCamera()
    if (cam) {
      activeCamera = cam
      camRig.setShot(normalizeDutyShotId(line.shot), resolveAnchor(), cam)
    }
    opts.onLineChange?.(line, lineIndex, beat)
    renderDom(true)
  }

  function triggerAsyncPortraitSync(): void {
    void portraits
      .ensureReady(false)
      .then(() => {
        if (!disposed) syncPortraitImgs(currentLine())
      })
      .catch(() => {
        // Offscreen WebGL may be unavailable inside pure headless DOM tests without GL
      })
  }

  function beginBeat(nextBeat: DutyStoryBeat): boolean {
    if (disposed || active) return false
    beat = nextBeat
    active = true
    gearHandedOver = false
    lastChoiceId = null
    flushPointerLock()

    // Ensure avatar visible in player reverse-shot / two-shot even if walking view was first-person
    getRuntimeViewer()?.walk?.showFigure?.(true)

    const cam = resolveCamera()
    if (cam) {
      activeCamera = cam
      camRig.begin(cam)
    }
    opts.onOpen?.(beat.id)
    enterLine(0)
    void portraits
      .refreshPlayerIfChanged()
      .then(bundle => {
        if (!disposed && !bundle) triggerAsyncPortraitSync()
        else if (!disposed) syncPortraitImgs(currentLine())
      })
      .catch(() => {})
    return true
  }

  function open(beatId?: DutyStoryBeatId): boolean {
    if (disposed || active) return false
    const resolvedId: DutyStoryBeatId = beatId ?? (completedOnce ? 'briefing_repeat' : 'briefing_intro')
    pendingSettlement = resolvedId === 'off_duty' ? resolveDutySettlement(null) : null
    pendingOnSettled = null
    settledEmitted = false
    return beginBeat(getDutyStoryBeat(resolvedId, pendingSettlement))
  }

  function openOffDuty(
    settlement?: DutyShiftSettlement | null,
    onSettled?: (payload: DutyStorySettledPayload) => void,
  ): boolean {
    if (disposed || active) return false
    pendingSettlement = resolveDutySettlement(settlement)
    pendingOnSettled = onSettled ?? null
    settledEmitted = false
    return beginBeat(getDutyStoryBeat('off_duty', pendingSettlement))
  }

  function step(dt: number): void {
    if (disposed || !active || !beat) return
    const safeDt = Math.min(0.1, Math.max(0, dt))
    const line = beat.lines[lineIndex]
    if (!line) return

    if (revealedChars < line.text.length) {
      charAccum += safeDt * 240
      const add = Math.floor(charAccum)
      if (add > 0) {
        charAccum -= add
        revealedChars = Math.min(line.text.length, revealedChars + add)
        if (textEl && textEl.textContent !== line.text.slice(0, revealedChars)) {
          textEl.textContent = line.text.slice(0, revealedChars)
        }
      }
    }

    const cam = resolveCamera()
    if (cam) {
      activeCamera = cam
      if (!camRig.isActive()) camRig.begin(cam)
      camRig.step(safeDt, resolveAnchor(), cam)
    }
  }

  function advance(): boolean {
    if (!active || !beat) return false
    const line = beat.lines[lineIndex]
    if (!line) return false
    if (line.choices && line.choices.length > 0) return false
    if (line.endMode === 'decline') {
      finishBeat(false, false)
      return true
    }
    if (line.endMode === 'accept' || lineIndex >= beat.lines.length - 1) {
      finishBeat(true, false)
      return true
    }
    enterLine(lineIndex + 1)
    return true
  }

  function choose(choiceId: string): boolean {
    if (!active || !beat) return false
    const line = beat.lines[lineIndex]
    if (!line?.choices?.length) return false
    const matched = line.choices.find(c => c.id === choiceId)
    if (!matched) return false
    lastChoiceId = matched.id
    if (matched.next >= beat.lines.length) {
      finishBeat(true, false)
      return true
    }
    enterLine(matched.next)
    return true
  }

  function skip(): boolean {
    if (!active || !beat) return false
    finishBeat(true, true)
    return true
  }

  function cancel(): boolean {
    if (!active || !beat) return false
    const cancelledId = beat.id
    pendingSettlement = null
    pendingOnSettled = null
    settledEmitted = false
    active = false
    beat = null
    lineIndex = 0
    revealedChars = 0
    charAccum = 0
    gearHandedOver = false
    restoreCameraAndActor()
    renderDom()
    opts.onCancel?.(cancelledId)
    return true
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!active || isEditableElement(e.target)) return
    // 绝不私绑 KeyF（统一交由 walk/interact-arbiter 发起 open）；仅响应对话确认/数字选分支/退出
    if (e.code === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      cancel()
      return
    }
    const line = currentLine()
    if (!line) return
    if (line.choices && line.choices.length > 0) {
      if (e.code === 'Digit1' && line.choices[0]) {
        e.preventDefault()
        choose(line.choices[0].id)
      } else if (e.code === 'Digit2' && line.choices[1]) {
        e.preventDefault()
        choose(line.choices[1].id)
      }
      return
    }
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      advance()
    }
  }

  const onAppearanceChange = () => {
    void portraits
      .refreshPlayerIfChanged()
      .then(() => {
        if (!disposed && active) syncPortraitImgs(currentLine())
      })
      .catch(() => {})
  }

  const onGameEvent = (e: Event) => {
    const type = (e as CustomEvent<{type?: string}> | undefined)?.detail?.type
    if (type === 'outfit:equip' || type === 'save:loaded') {
      onAppearanceChange()
    }
  }

  if (shouldMountDom && typeof document !== 'undefined') {
    const container = opts.container ?? document.body
    if (container) {
      topBarEl = document.createElement('div')
      topBarEl.className = 'td-story-cinema-bar-top'
      topBarEl.dataset.tdStoryCinemaBar = 'top'
      topBarEl.hidden = true

      bottomBarEl = document.createElement('div')
      bottomBarEl.className = 'td-story-cinema-bar-bottom'
      bottomBarEl.dataset.tdStoryCinemaBar = 'bottom'
      bottomBarEl.hidden = true

      const root = document.createElement('section')
      root.className = 'td-story-dialog'
      root.dataset.tdStoryDialog = '1'
      root.hidden = true
      root.setAttribute('role', 'dialog')
      root.setAttribute('aria-label', '解放桥交警岗前对话')
      root.innerHTML = `
        <div class="td-story-portrait-slot" data-td-story-portrait="officer">
          <img class="td-story-portrait-img" data-td-story-portrait-img="officer" alt="解放桥交警头像" />
          <span class="td-story-portrait-tag">解放桥执勤岗</span>
        </div>
        <div class="td-story-body">
          <div class="td-story-head">
            <div class="td-story-head-left">
              <span class="td-story-speaker" data-td-story-speaker="1">解放桥交警</span>
              <span class="td-story-progress" data-td-story-progress="1"></span>
            </div>
            <div class="td-story-head-actions">
              <button type="button" class="td-story-util-btn" data-td-story-action="skip">快进上岗</button>
              <button type="button" class="td-story-util-btn" data-td-story-action="cancel">暂不上岗</button>
            </div>
          </div>
          <p class="td-story-text" data-td-story-text="1"></p>
          <div class="td-story-gear-pill" data-td-story-gear="1" hidden></div>
          <div class="td-story-choices" data-td-story-choices="1"></div>
          <div class="td-story-foot" data-td-story-foot="1">
            <button type="button" class="td-story-next" data-td-story-action="next">继续</button>
          </div>
        </div>
        <div class="td-story-portrait-slot" data-td-story-portrait="player">
          <img class="td-story-portrait-img" data-td-story-portrait-img="player" alt="玩家角色头像" />
          <span class="td-story-portrait-tag">市民志愿者</span>
        </div>
      `
      root.addEventListener('pointerdown', e => e.stopPropagation())
      container.append(topBarEl, bottomBarEl, root)

      dialogEl = root
      officerSlotEl = root.querySelector('[data-td-story-portrait="officer"]')
      playerSlotEl = root.querySelector('[data-td-story-portrait="player"]')
      officerImgEl = root.querySelector('[data-td-story-portrait-img="officer"]')
      playerImgEl = root.querySelector('[data-td-story-portrait-img="player"]')
      speakerEl = root.querySelector('[data-td-story-speaker]')
      progressEl = root.querySelector('[data-td-story-progress]')
      textEl = root.querySelector('[data-td-story-text]')
      gearPillEl = root.querySelector('[data-td-story-gear]')
      choicesEl = root.querySelector('[data-td-story-choices]')
      footEl = root.querySelector('[data-td-story-foot]')
      nextBtnEl = root.querySelector('[data-td-story-action="next"]')
      skipBtnEl = root.querySelector('[data-td-story-action="skip"]')
      cancelBtnEl = root.querySelector('[data-td-story-action="cancel"]')

      if (nextBtnEl) nextBtnEl.onclick = () => advance()
      if (skipBtnEl) skipBtnEl.onclick = () => skip()
      if (cancelBtnEl) cancelBtnEl.onclick = () => cancel()

      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('glol:avatar-change', onAppearanceChange)
        window.addEventListener('glol:wardrobe-change', onAppearanceChange)
        window.addEventListener('game:event', onGameEvent)
      }

      // Eagerly pre-warm WebGL portraits when browser WebGL is available
      if (typeof fetch === 'function') {
        triggerAsyncPortraitSync()
      }
    }
  }

  const unsubPortraits = portraits.subscribe(() => {
    if (!disposed && active) syncPortraitImgs(currentLine())
  })

  return {
    open,
    openOffDuty,
    step,
    advance,
    choose,
    skip,
    cancel,
    isActive: () => active,
    hasCompletedBriefing: () => completedOnce,
    getSnapshot,
    async refreshPortraits(forcePlayerRefresh = false) {
      if (disposed) return null
      try {
        const res = await portraits.ensureReady(forcePlayerRefresh)
        if (!disposed) syncPortraitImgs(currentLine())
        return res
      } catch {
        return null
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      pendingSettlement = null
      pendingOnSettled = null
      settledEmitted = false
      if (active) {
        active = false
        beat = null
        restoreCameraAndActor()
      }
      setBodyFlag(false)
      unsubPortraits()
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('glol:avatar-change', onAppearanceChange)
        window.removeEventListener('glol:wardrobe-change', onAppearanceChange)
        window.removeEventListener('game:event', onGameEvent)
      }
      topBarEl?.remove()
      bottomBarEl?.remove()
      dialogEl?.remove()
      topBarEl = null
      bottomBarEl = null
      dialogEl = null
      if (ownsPortraitManager) portraits.dispose()
    },
  }
}

export {OFFICER_PORTRAIT_EXPRESSIONS}
export type {
  DutyShiftSettlement,
  DutyStoryBeat,
  DutyStoryBeatId,
  DutyStoryExpr,
  DutyStoryLine,
  DutyStorySpeaker,
  ResolvedDutySettlement,
} from './script.ts'
