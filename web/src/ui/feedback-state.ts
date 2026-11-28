import { APPEAL, photosOptional, stripAppealTemplate, type FeedbackView } from '../../../lib/feedback-contract'
import { ll2xz, xz2ll } from '../../../lib/projection'

export const FEEDBACK_MAX_X = 3072
export const FEEDBACK_MAX_Z = 3328
export const SUPPLEMENT_MAX_CHARS = 1000
const BAN_RECORD_ID_RE = /^[A-Za-z0-9_-]{6,64}$/

export interface FeedbackMediaState {
  kind: string
  hasItem: boolean
  supplement?: boolean
  itemHasViewShot?: boolean
  hasSelection: boolean
  useDefaultShot: boolean
  photoCount: number
  canCapture: boolean
  captureFailed?: boolean
}

export interface FeedbackMediaPresentation {
  mode: 'appeal-empty' | 'photos' | 'default-shot' | 'empty'
  title: string
  meta: string
  countText: string
  countEmpty: boolean
  replaceLabel: '更换' | '继续添加'
  showCaptureNow: boolean
  showRetake: boolean
}

export interface FeedbackSubmitState extends FeedbackMediaState {
  supplement: boolean
  bodyText: string
  banRecordId?: string
}

export type FeedbackSubmitCheck =
  | { ok: true; needsAutoCapture: boolean }
  | { ok: false; error: string }

export function clampFeedbackPosition(pos?: { x?: number; z?: number } | null): { x: number; z: number } {
  const rawX = pos?.x
  const rawZ = pos?.z
  const x = typeof rawX === 'number' && Number.isFinite(rawX)
    ? Math.max(-FEEDBACK_MAX_X, Math.min(FEEDBACK_MAX_X, rawX))
    : 0
  const z = typeof rawZ === 'number' && Number.isFinite(rawZ)
    ? Math.max(-FEEDBACK_MAX_Z, Math.min(FEEDBACK_MAX_Z, rawZ))
    : 0
  return { x, z }
}

export function safeFeedbackLocation(loc?: { lat?: number; lon?: number } | null): { lat: number; lon: number } {
  const lat = loc?.lat
  const lon = loc?.lon
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return xz2ll(0, 0)
  }
  const projected = ll2xz(lat, lon)
  if (
    !Number.isFinite(projected.x) ||
    !Number.isFinite(projected.z) ||
    Math.abs(projected.x) > FEEDBACK_MAX_X ||
    Math.abs(projected.z) > FEEDBACK_MAX_Z
  ) {
    const clamped = clampFeedbackPosition(projected)
    return xz2ll(clamped.x, clamped.z)
  }
  return { lat, lon }
}

export function describeFeedbackMedia(state: FeedbackMediaState): FeedbackMediaPresentation {
  const {
    kind,
    hasItem,
    supplement = false,
    itemHasViewShot = false,
    hasSelection,
    useDefaultShot,
    photoCount,
    canCapture,
    captureFailed = false,
  } = state
  const isAppeal = kind === APPEAL
  const optional = photosOptional(kind)
  const hasDefault = !hasItem && !isAppeal && useDefaultShot && hasSelection
  const hasView = hasItem ? itemHasViewShot || hasSelection : hasSelection

  if (supplement) {
    return {
      mode: photoCount > 0 ? 'photos' : 'empty',
      title: photoCount > 0 ? `已选图片（${photoCount} 张）` : '附加照片',
      meta: photoCount > 0 ? '随补充说明一起上传' : '补充说明必填，照片可选',
      countText: photoCount > 0 ? `已附 ${photoCount} 张图片` : '填写补充说明后提交，照片可选',
      countEmpty: false,
      replaceLabel: photoCount > 0 ? '继续添加' : '更换',
      showCaptureNow: false,
      showRetake: canCapture,
    }
  }

  if (isAppeal && photoCount === 0) {
    return {
      mode: 'appeal-empty',
      title: '申诉截图（可选）',
      meta: '可附上提示或异常截图',
      countText: '可直接提交申诉',
      countEmpty: false,
      replaceLabel: '更换',
      showCaptureNow: false,
      showRetake: false,
    }
  }

  if (photoCount > 0) {
    const missingRequiredView = !optional && !hasView
    return {
      mode: 'photos',
      title: `已选图片（${photoCount} 张）`,
      meta: isAppeal
        ? '随申诉一起上传'
        : hasView
          ? '已保留当前视角供定位'
          : missingRequiredView
            ? !canCapture
              ? '当前无法截取游戏画面，可改选「游戏 bug」'
              : captureFailed
                ? '当前视角暂无法截屏，可移动后重试或改选「游戏 bug」'
                : '还需截取游戏画面用于定位'
            : '随反馈一起上传',
      countText: missingRequiredView
        ? !canCapture
          ? '当前无法截屏，可改选「游戏 bug」'
          : captureFailed
            ? `已附 ${photoCount} 张图片，还需截取游戏画面（或改选「游戏 bug」）`
            : `已附 ${photoCount} 张图片，还需截取游戏画面`
        : `已附 ${photoCount} 张图片${!hasItem && !isAppeal ? '与当前位置' : ''}`,
      countEmpty: missingRequiredView,
      replaceLabel: '继续添加',
      showCaptureNow: !isAppeal && canCapture && !hasSelection,
      showRetake: !isAppeal && canCapture && hasSelection,
    }
  }

  if (hasDefault) {
    return {
      mode: 'default-shot',
      title: '当前游戏画面',
      meta: '默认附图 · 可直接提交',
      countText: '已带当前画面与位置',
      countEmpty: false,
      replaceLabel: '更换',
      showCaptureNow: false,
      showRetake: canCapture,
    }
  }

  if (optional) {
    return {
      mode: 'empty',
      title: '暂未附带图片（可选）',
      meta: canCapture ? '可直接提交，也可补截图' : '可直接提交，也可附本地图片',
      countText: isAppeal ? '可直接提交申诉' : '截图可选，可直接提交',
      countEmpty: false,
      replaceLabel: '更换',
      showCaptureNow: !isAppeal && canCapture,
      showRetake: false,
    }
  }

  if (!hasView) {
    return {
      mode: 'empty',
      title: '暂未附带图片',
      meta: !canCapture
        ? '当前无法截取游戏画面，可改选「游戏 bug」'
        : captureFailed
          ? '当前视角暂无法截屏，可移动后重试或改选「游戏 bug」'
          : '该类型需先截取游戏画面，也可附本地图片',
      countText: !canCapture
        ? '当前无法截屏，可改选「游戏 bug」'
        : captureFailed
          ? '请先截取游戏画面，或改选「游戏 bug」'
          : '请先截取游戏画面',
      countEmpty: true,
      replaceLabel: '更换',
      showCaptureNow: canCapture,
      showRetake: false,
    }
  }

  return {
    mode: 'empty',
    title: '暂未附带图片',
    meta: canCapture ? '可截取当前画面或从本地选择' : '请从本地选择图片',
    countText: canCapture ? '请截取画面或选择图片' : '请选择图片',
    countEmpty: true,
    replaceLabel: '更换',
    showCaptureNow: canCapture,
    showRetake: false,
  }
}

export function validateFeedbackSubmit(state: FeedbackSubmitState): FeedbackSubmitCheck {
  const {
    kind,
    hasItem,
    supplement,
    itemHasViewShot = false,
    hasSelection,
    useDefaultShot,
    photoCount,
    canCapture,
    bodyText,
    banRecordId,
  } = state
  const isAppeal = kind === APPEAL
  const optional = photosOptional(kind)
  const trimmed = bodyText.trim()

  if (supplement) {
    if (!trimmed) return { ok: false, error: '请填写补充内容' }
    if (Array.from(trimmed).length > SUPPLEMENT_MAX_CHARS) {
      return { ok: false, error: `补充内容最多 ${SUPPLEMENT_MAX_CHARS} 字` }
    }
    return { ok: true, needsAutoCapture: false }
  }

  const hasDefault = !hasItem && !isAppeal && useDefaultShot && hasSelection
  const hasAnyImage = photoCount > 0 || hasDefault
  const hasView = hasItem ? itemHasViewShot || hasSelection : hasSelection

  if (!optional) {
    if (!hasView) {
      if (!canCapture) return { ok: false, error: '当前无法截取游戏画面，请切换为「游戏 bug」反馈' }
      if (photoCount > 0) return { ok: true, needsAutoCapture: true }
      return { ok: false, error: '请先截取游戏画面' }
    }
    if (!hasAnyImage) return { ok: false, error: '请截取当前画面或选择一张图片' }
  }

  if (optional && !trimmed) {
    return { ok: false, error: '请描述一下遇到的问题' }
  }
  if (isAppeal) {
    if (Array.from(stripAppealTemplate(trimmed)).length < 2) {
      return { ok: false, error: '请填写具体的申诉说明，不能留空或只保留模板' }
    }
    const cleanRecordId = (banRecordId ?? '').trim()
    if (cleanRecordId && !BAN_RECORD_ID_RE.test(cleanRecordId)) {
      return { ok: false, error: '记录编号格式不正确，请核对后重试' }
    }
  }
  return { ok: true, needsAutoCapture: false }
}

export function shouldUploadFeedbackViewShot(opts: {
  kind: string
  hasSelection: boolean
  useDefaultShot: boolean
  photoCount: number
  viewShotUploaded: boolean
}): boolean {
  return (
    opts.kind !== APPEAL &&
    opts.hasSelection &&
    (opts.useDefaultShot || opts.photoCount > 0) &&
    !opts.viewShotUploaded
  )
}

export function shouldUploadDefaultShotPhoto(opts: {
  hasItem: boolean
  kind: string
  hasSelection: boolean
  useDefaultShot: boolean
  photoCount: number
  defaultPhotoUploaded: boolean
}): boolean {
  return (
    !opts.hasItem &&
    opts.kind !== APPEAL &&
    opts.photoCount === 0 &&
    opts.useDefaultShot &&
    opts.hasSelection &&
    !opts.defaultPhotoUploaded
  )
}

export function buildFeedbackDraftPayload(opts: {
  kind: string
  title: string
  body: string
  location: { lat: number; lon: number }
  view?: FeedbackView | null
  banRecordId?: string
}) {
  const appeal = opts.kind === APPEAL
  const safeLoc = appeal ? xz2ll(0, 0) : safeFeedbackLocation(opts.location)
  const view = appeal ? null : (opts.view ?? null)
  return {
    ...safeLoc,
    view,
    heading: view ? view.heading : null,
    landmark_id: view ? view.landmark_id : null,
    kind: opts.kind,
    title: opts.title,
    body: opts.body,
    ...(appeal && opts.banRecordId ? { ban_record_id: opts.banRecordId } : {}),
  }
}
