// Wire IDs are permanent. Append new entries without renumbering existing ones.
export const emotes = [
  {id: 1, key: 'thumbs_up', label: '点赞', duration: 4},
  {id: 2, key: 'yixia_fanshang', label: '以下犯上', duration: 3},
  {id: 3, key: 'naiwa_laugh', label: '奶蛙笑', duration: 4.25},
] as const
export const emoteById = (id: number) => emotes.find((item) => item.id === id)
export function interrupted(id: number, moving: boolean, busy: boolean) {
  return busy || (moving && (id === 1 || id === 2))
}
export function emotesEnabled() {
  return localStorage.getItem('glol.emotes') !== '0'
}
