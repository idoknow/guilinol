import type {Avatar} from '../../../lib/avatar'

export type CreatorLook = Omit<Avatar, 'v' | 'createdAt'>

/**
 * 捏人第一步的整套预设。名字是风格短词，不能和任何选项按钮的无障碍名称重名
 * （e2e 按 exact 名称点「女」「小麦」「通勤」之类的按钮）。
 */
export const creatorPresets: readonly {name: string; look: CreatorLook}[] = [
  {
    name: '街巷少年',
    look: {body: 'm', skin: 2, face: 0, brows: 2, eyes: 1, hair: 'm_crop', hairColor: 0, look: 'hoodie'},
  },
  {
    name: '骑行通勤',
    look: {body: 'm', skin: 3, face: 2, brows: 3, eyes: 0, hair: 'm_fade', hairColor: 1, look: 'denim'},
  },
  {
    name: '书卷气',
    look: {body: 'm', skin: 1, face: 3, brows: 1, eyes: 2, hair: 'm_part', hairColor: 1, look: 'knit'},
  },
  {
    name: '江边晨跑',
    look: {body: 'f', skin: 2, face: 1, brows: 1, eyes: 3, hair: 'f_pony', hairColor: 0, look: 'track'},
  },
  {
    name: '山野徒步',
    look: {body: 'f', skin: 3, face: 5, brows: 2, eyes: 1, hair: 'f_wolf', hairColor: 2, look: 'shell'},
  },
  {
    name: '国风少女',
    look: {body: 'f', skin: 0, face: 3, brows: 0, eyes: 0, hair: 'f_bun', hairColor: 0, look: 'chinese'},
  },
]

export function matchesPreset(a: Avatar, p: CreatorLook) {
  return (Object.keys(p) as (keyof CreatorLook)[]).every((k) => a[k] === p[k])
}
