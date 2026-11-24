/**
 * 田源米粉 · r6 GTA 动漫风表叔剧情演出导演
 *
 * 通过纯接口声明依赖（camera / container / getPlayerPos / npc / beats / portraits / playerPortrait / audio），
 * 不直接依赖宿主内部模块；存档独立写 `glol.mifen.story.v1`，坏档安全回退未解锁，绝不碰 `glol.mifen.v1`。
 */

import {
  createStoryCameraController,
  normalizeShotId,
  type CameraLike,
  type ShotAnchor,
  type StoryShotId,
  type Vec3Like,
} from './camera-shots.ts'

if (typeof document !== 'undefined') {
  void import('./dialogue.css')
}

export const STORY_STORAGE_KEY = 'glol.mifen.story.v1'
export const UNLOCK_BEAT_ID = 'meet'

export type DirectorSpeaker = 'uncle' | 'player'
export type DirectorExpr = 'neutral' | 'smile' | 'worry' | 'proud' | 'laugh'

export interface DirectorChoice {
  id: string
  text: string
  next: number
}

export interface DirectorLine {
  speaker: DirectorSpeaker
  expr: DirectorExpr
  shot: StoryShotId
  text: string
  choices?: readonly DirectorChoice[]
}

export interface DirectorBeat {
  id: string
  trigger: string
  lines: readonly DirectorLine[]
}

export interface DirectorNpcLike {
  readonly group: {
    readonly position: Vec3Like
    readonly rotation: { readonly y: number }
  }
  setMarker(mode: 'new' | 'none'): void
  setTalking(on: boolean): void
  setExpression(id: DirectorExpr): void
  headWorld(out?: Vec3Like): Vec3Like
}

export interface DirectorAudioLike {
  play(id: 'story_open' | 'story_choice' | 'story_unlock' | string): boolean
  playBlip(speaker: DirectorSpeaker): boolean
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface StoryDirectorOptions {
  camera: CameraLike
  container: HTMLElement | null
  getPlayerPos: () => Vec3Like | null
  npc: DirectorNpcLike
  beats: readonly DirectorBeat[]
  portraits: Readonly<Record<string, string>>
  playerPortrait: string
  audio?: DirectorAudioLike
  onUnlock?: () => void
  onBeatDone?: (beatId: string) => void
  storage?: StorageLike | null
}

export interface StoryDirectorProbe {
  implementation: 'story/director.ts'
  unlocked: boolean
  active: boolean
  canTalk: boolean
  completedBeats: string[]
  currentBeatId: string | null
  lineIndex: number
  currentShot: StoryShotId | null
  currentSpeaker: DirectorSpeaker | null
  currentExpr: DirectorExpr | null
  choices: string[]
  lastChoices: Record<string, string>
  lastSkippedBeatId: string | null
  marker: 'new' | 'none'
  cameraState: {
    active: boolean
    currentShot: StoryShotId | null
    savedFov: number | null
    currentFov: number | null
    restoreCount: number
  }
  [key: string]: unknown
}

export interface StoryDirectorController {
  step(dt: number): void
  isActive(): boolean
  isUnlocked(): boolean
  canTalk(): boolean
  talk(): boolean
  advance(): boolean
  choose(id: string): boolean
  skip(): boolean
  notify(event: string): boolean
  reset(): void
  getProbe(): StoryDirectorProbe
  dispose(): void
}

export interface PersistedStorySave {
  version: 1
  unlocked: boolean
  completedBeats: string[]
  lastChoices: Record<string, string>
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  } catch {
    // ignore inaccessible storage
  }
  return null
}

export function loadStorySave(storage: StorageLike | null = defaultStorage()): PersistedStorySave {
  const empty: PersistedStorySave = { version: 1, unlocked: false, completedBeats: [], lastChoices: {} }
  if (!storage) return empty
  try {
    const raw = storage.getItem(STORY_STORAGE_KEY)
    if (!raw) return empty
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty
    const obj = parsed as Record<string, unknown>
    if (typeof obj.unlocked !== 'boolean') return empty
    if (!Array.isArray(obj.completedBeats)) return empty
    const completedBeats = Array.from(
      new Set(obj.completedBeats.filter((b): b is string => typeof b === 'string' && b.trim().length > 0)),
    )
    // 必须同时具备 unlocked === true 与已完成 meet 段，防止坏档/半截存档错误放行
    const unlocked = obj.unlocked === true && completedBeats.includes(UNLOCK_BEAT_ID)
    if (!unlocked) return empty
    const lastChoices: Record<string, string> = {}
    if (obj.lastChoices && typeof obj.lastChoices === 'object' && !Array.isArray(obj.lastChoices)) {
      for (const [k, v] of Object.entries(obj.lastChoices as Record<string, unknown>)) {
        if (typeof v === 'string' && v.length > 0) lastChoices[k] = v
      }
    }
    return { version: 1, unlocked: true, completedBeats, lastChoices }
  } catch {
    return empty
  }
}

function persistStorySave(state: PersistedStorySave, storage: StorageLike | null): void {
  if (!storage) return
  try {
    storage.setItem(STORY_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore storage quota errors
  }
}

function setText(el: { textContent: string | null } | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false
  return !!(target as Element).closest('input,textarea,select,[contenteditable]')
}

function setBodyStoryFlag(active: boolean): void {
  if (typeof document === 'undefined' || !document.body) return
  document.body.dataset.mifenStoryActive = active ? '1' : '0'
}

function flushHeldWorldInput(): void {
  if (typeof window === 'undefined') return
  try {
    if (typeof document !== 'undefined' && document.pointerLockElement) {
      document.exitPointerLock?.()
    }
    window.dispatchEvent(new Event('blur'))
  } catch {
    // ignore headless/mock environment limitations
  }
}

export function createStoryDirector(opts: StoryDirectorOptions): StoryDirectorController {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage
  let save = loadStorySave(storage)

  let activeBeat: DirectorBeat | null = null
  let lineIndex = 0
  let revealedChars = 0
  let charAccum = 0
  let lineElapsed = 0
  let lastSkippedBeatId: string | null = null
  let disposed = false

  const camRig = createStoryCameraController()
  const preloadedImgs: HTMLImageElement[] = []

  // DOM 元素仅在浏览器且传入有效 container 时挂载，Node 纯单测可安全传 container: null
  let dialogEl: HTMLElement | null = null
  let portraitImg: HTMLImageElement | null = null
  let speakerEl: HTMLElement | null = null
  let skipBtn: HTMLButtonElement | null = null
  let textEl: HTMLElement | null = null
  let choicesEl: HTMLElement | null = null
  let footEl: HTMLElement | null = null
  let nextBtn: HTMLButtonElement | null = null

  if (typeof document !== 'undefined' && opts.container) {
    for (const url of [...Object.values(opts.portraits), opts.playerPortrait]) {
      if (!url || typeof Image === 'undefined') continue
      const img = new Image()
      img.src = url
      preloadedImgs.push(img)
    }

    dialogEl = document.createElement('section')
    dialogEl.className = 'mifen-story-dialog'
    dialogEl.dataset.storyDialog = '1'
    dialogEl.dataset.mifenPanel = 'story'
    dialogEl.hidden = true
    dialogEl.setAttribute('role', 'dialog')
    dialogEl.setAttribute('aria-modal', 'true')
    dialogEl.setAttribute('aria-label', '剧情对话')
    dialogEl.innerHTML = `
      <div class="mifen-story-portrait-wrap">
        <img class="mifen-story-portrait" data-story-portrait="1" alt="角色头像" />
      </div>
      <div class="mifen-story-body">
        <div class="mifen-story-head">
          <strong class="mifen-story-speaker" data-story-speaker="1"></strong>
          <button type="button" class="mifen-story-skip" data-story-skip="1" aria-label="跳过对话（Esc）">跳过</button>
        </div>
        <p class="mifen-story-text" data-story-text="1"></p>
        <div class="mifen-story-choices"></div>
        <div class="mifen-story-foot">
          <button type="button" class="mifen-story-next" data-story-next="1">继续</button>
        </div>
      </div>
    `
    opts.container.append(dialogEl)
    portraitImg = dialogEl.querySelector<HTMLImageElement>('[data-story-portrait]')
    speakerEl = dialogEl.querySelector<HTMLElement>('[data-story-speaker]')
    skipBtn = dialogEl.querySelector<HTMLButtonElement>('[data-story-skip]')
    textEl = dialogEl.querySelector<HTMLElement>('[data-story-text]')
    choicesEl = dialogEl.querySelector<HTMLElement>('.mifen-story-choices')
    footEl = dialogEl.querySelector<HTMLElement>('.mifen-story-foot')
    nextBtn = dialogEl.querySelector<HTMLButtonElement>('[data-story-next]')
  }

  function buildShotAnchor(): ShotAnchor {
    const p = opts.npc.group.position
    const head = opts.npc.headWorld()
    const player = opts.getPlayerPos()
    return {
      npcPos: [p.x, p.y, p.z],
      npcYaw: opts.npc.group.rotation.y,
      npcHead: [head.x, head.y, head.z],
      playerPos: player ? [player.x, player.y, player.z] : null,
    }
  }

  function renderCurrentLine(): void {
    if (!activeBeat) {
      if (dialogEl) dialogEl.hidden = true
      return
    }
    const line = activeBeat.lines[lineIndex]
    if (!line) return

    const isUncle = line.speaker === 'uncle'
    if (dialogEl) {
      dialogEl.hidden = false
      dialogEl.dataset.speaker = line.speaker
      dialogEl.dataset.shot = normalizeShotId(line.shot)
      dialogEl.dataset.expr = line.expr
    }
    setText(speakerEl, isUncle ? '表叔' : '我')
    if (portraitImg) {
      portraitImg.src = isUncle
        ? (opts.portraits[line.expr] ?? opts.portraits.neutral ?? opts.playerPortrait)
        : opts.playerPortrait
      portraitImg.alt = isUncle ? '表叔' : '我'
    }

    opts.npc.setTalking(isUncle)
    opts.npc.setExpression(line.expr ?? 'neutral')
    opts.audio?.playBlip(line.speaker)

    revealedChars = Math.min(line.text.length, 12)
    charAccum = 0
    lineElapsed = 0
    setText(textEl, line.text.slice(0, revealedChars))

    if (choicesEl && footEl && nextBtn) {
      choicesEl.innerHTML = ''
      const choices = line.choices ?? []
      if (choices.length > 0) {
        footEl.hidden = true
        nextBtn.hidden = true
        for (const c of choices) {
          const btn = document.createElement('button')
          btn.type = 'button'
          btn.className = 'mifen-story-choice'
          btn.dataset.storyChoice = c.id
          btn.textContent = c.text
          btn.addEventListener('click', ev => {
            ev.stopPropagation()
            choose(c.id)
          })
          choicesEl.append(btn)
        }
      } else {
        footEl.hidden = false
        nextBtn.hidden = false
        setText(nextBtn, lineIndex >= activeBeat.lines.length - 1 ? '完成' : '继续')
      }
    }

    camRig.setShot(normalizeShotId(line.shot), buildShotAnchor(), opts.camera)
  }

  function finishBeat(skipped: boolean): void {
    if (!activeBeat) return
    const beatId = activeBeat.id
    activeBeat = null
    lineIndex = 0
    revealedChars = 0
    charAccum = 0
    lineElapsed = 0
    if (skipped) lastSkippedBeatId = beatId

    if (dialogEl) {
      dialogEl.hidden = true
      delete dialogEl.dataset.speaker
      delete dialogEl.dataset.shot
      delete dialogEl.dataset.expr
    }
    setBodyStoryFlag(false)
    opts.npc.setTalking(false)
    opts.npc.setExpression('neutral')
    camRig.end(opts.camera)

    const wasUnlocked = save.unlocked
    const alreadyDone = save.completedBeats.includes(beatId)
    if (!alreadyDone || (beatId === UNLOCK_BEAT_ID && !wasUnlocked)) {
      const nextBeats = alreadyDone ? save.completedBeats : [...save.completedBeats, beatId]
      save = {
        version: 1,
        unlocked: save.unlocked || beatId === UNLOCK_BEAT_ID,
        completedBeats: nextBeats,
        lastChoices: { ...save.lastChoices },
      }
      persistStorySave(save, storage)
    }

    if (beatId === UNLOCK_BEAT_ID && !wasUnlocked) {
      opts.npc.setMarker('none')
      opts.onUnlock?.()
    }
    opts.onBeatDone?.(beatId)
  }

  function startBeat(beat: DirectorBeat): boolean {
    if (disposed || activeBeat) return false
    if (!beat.lines.length) return false
    activeBeat = beat
    lineIndex = 0
    setBodyStoryFlag(true)
    flushHeldWorldInput()
    camRig.begin(opts.camera)
    opts.audio?.play('story_open')
    renderCurrentLine()
    return true
  }

  function choose(id: string): boolean {
    if (disposed || !activeBeat) return false
    const line = activeBeat.lines[lineIndex]
    const choice = line?.choices?.find(c => c.id === id)
    if (!choice) return false
    save = {
      ...save,
      lastChoices: { ...save.lastChoices, [activeBeat.id]: choice.id },
    }
    opts.audio?.play('story_choice')
    if (choice.next < 0 || choice.next >= activeBeat.lines.length) {
      finishBeat(false)
      return true
    }
    lineIndex = choice.next
    renderCurrentLine()
    return true
  }

  function advance(): boolean {
    if (disposed || !activeBeat) return false
    const line = activeBeat.lines[lineIndex]
    if (!line) {
      finishBeat(false)
      return true
    }
    if (line.choices && line.choices.length > 0) {
      return choose(line.choices[0].id)
    }
    if (revealedChars < line.text.length && lineElapsed < 0.14) {
      revealedChars = line.text.length
      setText(textEl, line.text)
      return true
    }
    if (lineIndex + 1 >= activeBeat.lines.length) {
      finishBeat(false)
      return true
    }
    lineIndex += 1
    renderCurrentLine()
    return true
  }

  function skip(): boolean {
    if (disposed || !activeBeat) return false
    finishBeat(true)
    return true
  }

  function onSkipClick(ev: Event): void {
    ev.stopPropagation()
    skip()
  }

  function onNextClick(ev: Event): void {
    ev.stopPropagation()
    advance()
  }

  function onDialogClick(ev: Event): void {
    if ((ev.target as Element | null)?.closest('button')) return
    const line = activeBeat?.lines[lineIndex]
    if (line?.choices && line.choices.length > 0) return
    advance()
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (disposed || !activeBeat) return
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
    if (isEditableTarget(e.target)) return

    if (e.code === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      skip()
      return
    }

    const line = activeBeat.lines[lineIndex]
    if (line?.choices && line.choices.length > 0) {
      const m = /^Digit([1-9])$/.exec(e.code)
      if (m) {
        const idx = Number(m[1]) - 1
        if (line.choices[idx]) {
          e.preventDefault()
          e.stopPropagation()
          choose(line.choices[idx].id)
        }
      }
      return
    }

    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      advance()
    }
  }

  skipBtn?.addEventListener('click', onSkipClick)
  nextBtn?.addEventListener('click', onNextClick)
  dialogEl?.addEventListener('click', onDialogClick)
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown, true)
  }

  opts.npc.setMarker(save.unlocked ? 'none' : 'new')

  return {
    step(dt: number) {
      if (disposed || !activeBeat) return
      const safeDt = Math.min(0.1, Math.max(0, dt))
      lineElapsed += safeDt
      const line = activeBeat.lines[lineIndex]
      if (!line) return

      if (revealedChars < line.text.length) {
        charAccum += safeDt * 64
        const add = Math.floor(charAccum)
        if (add > 0) {
          charAccum -= add
          revealedChars = Math.min(line.text.length, revealedChars + add)
          setText(textEl, line.text.slice(0, revealedChars))
          opts.audio?.playBlip(line.speaker)
        }
      }

      camRig.step(safeDt, buildShotAnchor(), opts.camera)
    },

    isActive: () => activeBeat !== null,
    isUnlocked: () => save.unlocked,
    canTalk: () => !disposed && activeBeat === null && !save.unlocked,

    talk() {
      if (disposed || activeBeat || save.unlocked) return false
      const meetBeat = opts.beats.find(b => b.id === UNLOCK_BEAT_ID) ?? opts.beats[0]
      if (!meetBeat) return false
      return startBeat(meetBeat)
    },

    advance,
    choose,
    skip,

    notify(event: string) {
      if (disposed || activeBeat) return false
      const beat = opts.beats.find(b => b.trigger === event && !save.completedBeats.includes(b.id))
      if (!beat) return false
      return startBeat(beat)
    },

    reset() {
      if (activeBeat) {
        activeBeat = null
        lineIndex = 0
        revealedChars = 0
        charAccum = 0
        lineElapsed = 0
        if (dialogEl) dialogEl.hidden = true
        setBodyStoryFlag(false)
        opts.npc.setTalking(false)
        opts.npc.setExpression('neutral')
        camRig.end(opts.camera)
      }
      lastSkippedBeatId = null
      save = { version: 1, unlocked: false, completedBeats: [], lastChoices: {} }
      persistStorySave(save, storage)
      opts.npc.setMarker('new')
    },

    getProbe(): StoryDirectorProbe {
      const line = activeBeat?.lines[lineIndex] ?? null
      return {
        implementation: 'story/director.ts',
        unlocked: save.unlocked,
        active: activeBeat !== null,
        canTalk: !disposed && activeBeat === null && !save.unlocked,
        completedBeats: [...save.completedBeats],
        currentBeatId: activeBeat?.id ?? null,
        lineIndex,
        currentShot: line ? normalizeShotId(line.shot) : null,
        currentSpeaker: line?.speaker ?? null,
        currentExpr: line?.expr ?? null,
        choices: line?.choices ? line.choices.map(c => c.id) : [],
        lastChoices: { ...save.lastChoices },
        lastSkippedBeatId,
        marker: save.unlocked ? 'none' : 'new',
        cameraState: camRig.getState(),
      }
    },

    dispose() {
      if (disposed) return
      disposed = true
      if (activeBeat) {
        activeBeat = null
        setBodyStoryFlag(false)
        opts.npc.setTalking(false)
        opts.npc.setExpression('neutral')
        camRig.end(opts.camera)
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', onKeyDown, true)
      }
      skipBtn?.removeEventListener('click', onSkipClick)
      nextBtn?.removeEventListener('click', onNextClick)
      dialogEl?.removeEventListener('click', onDialogClick)
      dialogEl?.remove()
      preloadedImgs.length = 0
    },
  }
}
