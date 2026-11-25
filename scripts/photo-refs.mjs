import {existsSync} from 'node:fs'
import {resolve, join} from 'node:path'

export const refs = process.env.GLOL_OPS_ROOT && resolve(process.env.GLOL_OPS_ROOT, 'docs/refs/rock')
export const hasPhotos = Boolean(refs && existsSync(join(refs, 'photo-locations.json')))
export const skipPhotos = '跳过同机位：GLOL_OPS_ROOT 未指向含照片资料的 ops 检出目录。'
