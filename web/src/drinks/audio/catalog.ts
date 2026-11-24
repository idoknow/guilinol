export const DRINK_SOUND_IDS = [
  'order_chime',
  'cup_drop',
  'ice_scoop',
  'tea_pour',
  'shaker_shake',
  'cup_seal',
  'call_number',
  'straw_poke',
  'drink_sip',
  'action_reject',
] as const

export type DrinkSoundId = (typeof DRINK_SOUND_IDS)[number]

export type DrinkSoundCategory = 'counter' | 'prep' | 'handheld' | 'ui'

export interface DrinkSoundSpec {
  readonly id: DrinkSoundId
  readonly category: DrinkSoundCategory
  readonly label: string
  readonly trigger: string
  readonly durationSec: number
  readonly defaultVolume: number
}

export const DRINK_SOUND_CATALOG: Readonly<Record<DrinkSoundId, DrinkSoundSpec>> = {
  order_chime: {
    id: 'order_chime',
    category: 'counter',
    label: '点单叮咚',
    trigger: '点单收银下单成功（双音轻快叮咚）',
    durationSec: 0.42,
    defaultVolume: 0.68,
  },
  cup_drop: {
    id: 'cup_drop',
    category: 'prep',
    label: '落杯轻叩',
    trigger: '选杯落台/出杯递到手中',
    durationSec: 0.24,
    defaultVolume: 0.62,
  },
  ice_scoop: {
    id: 'ice_scoop',
    category: 'prep',
    label: '铲冰加冰',
    trigger: '冰铲取冰块落入透明杯壁的清脆冰晶撞击',
    durationSec: 0.56,
    defaultVolume: 0.72,
  },
  tea_pour: {
    id: 'tea_pour',
    category: 'prep',
    label: '萃取注茶',
    trigger: '打茶机注水/淋茶底液位上升声',
    durationSec: 0.92,
    defaultVolume: 0.66,
  },
  shaker_shake: {
    id: 'shaker_shake',
    category: 'prep',
    label: '雪克摇茶',
    trigger: '雪克杯手摇融合果茶与冰块的双连节奏摇晃声',
    durationSec: 0.78,
    defaultVolume: 0.76,
  },
  cup_seal: {
    id: 'cup_seal',
    category: 'prep',
    label: '热封压膜',
    trigger: '封口机卡位下压“咔哒-嘶”滚膜密封声',
    durationSec: 0.64,
    defaultVolume: 0.74,
  },
  call_number: {
    id: 'call_number',
    category: 'counter',
    label: '出杯叫号',
    trigger: '饮品制作完成叫号取杯三连铃声',
    durationSec: 0.75,
    defaultVolume: 0.72,
  },
  straw_poke: {
    id: 'straw_poke',
    category: 'handheld',
    label: '扎破封膜',
    trigger: '手持吸管扎开热封膜瞬间的清脆弹性“啵”声',
    durationSec: 0.26,
    defaultVolume: 0.7,
  },
  drink_sip: {
    id: 'drink_sip',
    category: 'handheld',
    label: '手持吸饮',
    trigger: '玩家手持饮品喝一口（气泡吸吮+微弱冰块碰壁）',
    durationSec: 0.58,
    defaultVolume: 0.68,
  },
  action_reject: {
    id: 'action_reject',
    category: 'ui',
    label: '操作提示',
    trigger: '余额不足、未解锁或空杯时温和拒绝提示音',
    durationSec: 0.28,
    defaultVolume: 0.55,
  },
}
