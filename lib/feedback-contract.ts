import { ll2xz } from './projection'

export const kinds = ['缺失建筑', '位置或朝向不对', '外观不像', '道路水系', '其他']
export const views = ['正面', '左侧', '右侧', '背面', '远景', '细节', '内部']
export const labels: Record<string, string> = {
  draft: '草稿',
  submitted: '已收到，正在确认细节',
  approved: '已开始 AI 制作',
  queued: '已进入建模队列',
  modelling: 'AI 建模中',
  reviewing: '审核中',
  live: '已上线',
  need_info: '需要补充信息',
  rejected: '未采纳',
  duplicate: '与已有反馈重复',
}
export const edges: Record<string, string[]> = {
  submitted: ['approved','need_info','rejected','duplicate'],
  approved: ['queued'],
  queued: ['modelling', 'reviewing', 'live', 'need_info', 'rejected', 'duplicate'],
  modelling: ['reviewing', 'live', 'need_info', 'rejected', 'duplicate'],
  reviewing: ['modelling', 'live', 'need_info', 'rejected', 'duplicate'],
  need_info: ['approved','rejected', 'duplicate'],
}

type Point = { x: number; y: number; z: number; lat: number; lon: number }
export type FeedbackView = Point & {
  mode: 'walk' | 'fly'
  yaw: number
  pitch: number
  fov: number
  alt: number
  heading: number
  target: (Point & { distance: number }) | null
  landmark_id: string | null
  build: string
}
export function validView(value: unknown): value is FeedbackView {
  const keys = (obj: unknown, list: string): obj is Record<string, unknown> =>
    !!obj &&
    typeof obj === 'object' &&
    !Array.isArray(obj) &&
    Object.keys(obj).every((key) => list.split(' ').includes(key))
  const range = (num: unknown, min: number, max: number): num is number =>
    typeof num === 'number' && Number.isFinite(num) && num >= min && num <= max
  const point = (obj: Record<string, unknown>) => {
    if (
      !range(obj.x, -3072, 3072) ||
      !range(obj.z, -3328, 3328) ||
      !range(obj.y, -500, 6000) ||
      !range(obj.lat, -90, 90) ||
      !range(obj.lon, -180, 180)
    )
      return false
    const projected = ll2xz(obj.lat, obj.lon)
    return Math.abs(projected.x - obj.x) < 1 && Math.abs(projected.z - obj.z) < 1
  }
  return (
    keys(value, 'mode x y z lat lon yaw pitch fov alt heading target landmark_id build') &&
    point(value) &&
    (value.mode === 'walk' || value.mode === 'fly') &&
    range(value.yaw, -180, 180) &&
    range(value.pitch, -90, 90) &&
    range(value.fov, 1, 179) &&
    range(value.alt, -500, 6000) &&
    range(value.heading, 0, 360) &&
    typeof value.build === 'string' &&
    /^[a-f0-9]{40}$/.test(value.build) &&
    (value.landmark_id === null ||
      (value.target !== null &&
        typeof value.landmark_id === 'string' &&
        /^[\w-]{1,120}$/.test(value.landmark_id))) &&
    (value.target === null ||
      (keys(value.target, 'x y z lat lon distance') &&
        point(value.target) &&
        range(value.target.distance, 0, 16000)))
  )
}
export function viewToken(view: FeedbackView) {
  return btoa(JSON.stringify(view)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}
