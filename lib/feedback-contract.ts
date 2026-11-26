import { ll2xz } from './projection'

// 游戏 bug（IDOK-219）：功能故障、卡住、显示错误等，不需要实景照片，截图可选。
export const BUG = '游戏 bug'
export const APPEAL = '封禁申诉'
export const kinds = ['缺失建筑', '位置或朝向不对', '外观不像', '道路水系', BUG, APPEAL, '其他']
export const photosOptional = (kind?: string | null) => kind === BUG || kind === APPEAL
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
  // 问了提交人但没等回复就修好并上线了（IDOK-180/181）：bridge 可直接标已上线
  need_info: ['approved','live','rejected', 'duplicate'],
}

type Point = { x: number; y: number; z: number; lat: number; lon: number }
export type HitDiagnostic = {layer:string;name:string;owner:string;distance:number;triangle:number[][];box:number[][]}
export type PickDiagnostic = {static:HitDiagnostic|null;dynamic:HitDiagnostic|null}
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
  diagnostic?: PickDiagnostic
}
export function validView(value: unknown, area: 'feedback' | 'saved' = 'feedback'): value is FeedbackView {
  const keys = (obj: unknown, list: string): obj is Record<string, unknown> =>
    !!obj &&
    typeof obj === 'object' &&
    !Array.isArray(obj) &&
    Object.keys(obj).every((key) => list.split(' ').includes(key))
  const range = (num: unknown, min: number, max: number): num is number =>
    typeof num === 'number' && Number.isFinite(num) && num >= min && num <= max
  const point = (obj: Record<string, unknown>) => {
    if (
      typeof obj.x !== 'number' || !Number.isFinite(obj.x) ||
      typeof obj.z !== 'number' || !Number.isFinite(obj.z) ||
      (area === 'feedback' && (Math.abs(obj.x)>3072 || Math.abs(obj.z)>3328)) ||
      !range(obj.y, -500, 6000) ||
      !range(obj.lat, -90, 90) ||
      !range(obj.lon, -180, 180)
    )
      return false
    const projected = ll2xz(obj.lat, obj.lon)
    return Math.abs(projected.x - obj.x) < 1 && Math.abs(projected.z - obj.z) < 1
  }
  return (
    keys(value, 'mode x y z lat lon yaw pitch fov alt heading target landmark_id build diagnostic') &&
    (value.diagnostic===undefined || (keys(value.diagnostic,'static dynamic') &&
      ['static','dynamic'].every(key=>{
        const hit=(value.diagnostic as Record<string,unknown>)[key]
        const vectors=(points:unknown,count:number)=>Array.isArray(points)&&points.length===count&&points.every(vec=>Array.isArray(vec)&&vec.length===3&&vec.every(n=>range(n,-1e8,1e8)))
        return hit===null || (keys(hit,'layer name owner distance triangle box') &&
          ['layer','name','owner'].every(field=>typeof hit[field]==='string'&&(hit[field] as string).length<=120)&&range(hit.distance,0,1e8)&&vectors(hit.triangle,3)&&vectors(hit.box,2))
      }))) &&
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
  const {diagnostic:_,...pose}=view
  return btoa(JSON.stringify(pose)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}
