// Wire IDs are permanent. Append new entries without renumbering existing ones.
// Keep `emotes` limited to the 3 wheel gestures expected by `scripts/emote-test.mjs`;
// duty gestures live in `dutyEmotes` and are resolved together by `emoteById`.
export const emotes = [
  {id: 1, key: 'thumbs_up', label: '点赞', duration: 4},
  {id: 2, key: 'yixia_fanshang', label: '以下犯上', duration: 3},
  {id: 3, key: 'naiwa_laugh', label: '奶蛙笑', duration: 4.25},
] as const

export const dutyEmotes = [
  {id: 4, key: 'duty_whistle', label: '吹哨执勤', duration: 1.8},
  {id: 5, key: 'duty_flag_stop', label: '挥旗拦停', duration: 2.4},
  {id: 6, key: 'duty_flag_pass', label: '挥旗放行', duration: 2.4},
] as const

export type DutyEmoteKey = (typeof dutyEmotes)[number]['key']
export const allEmotes = [...emotes, ...dutyEmotes] as const
export type EmoteEntry = (typeof allEmotes)[number]

export const emoteById = (id: number) => allEmotes.find((item) => item.id === id)
export const dutyEmoteByKey = (key: DutyEmoteKey) => dutyEmotes.find((item) => item.key === key)

export function interrupted(id: number, moving: boolean, busy: boolean) {
  return busy || (moving && (id === 1 || id === 2))
}
export function emotesEnabled() {
  return localStorage.getItem('glol.emotes') !== '0'
}
