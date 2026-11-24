/**
 * 田源米粉 · 全流程音效目录清单与元数据契约
 */

export type MifenSoundCategory = 'boil' | 'meat' | 'counter' | 'economy' | 'story' | 'ui'

export type MifenSoundId =
  | 'boil_bubbling'
  | 'boil_dip'
  | 'boil_lock_perfect'
  | 'boil_lock_miss'
  | 'meat_chop'
  | 'meat_plate'
  | 'brine_pour'
  | 'brine_stop'
  | 'condiment_add'
  | 'serve_complete'
  | 'cash_register'
  | 'story_open'
  | 'story_blip_uncle'
  | 'story_blip_player'
  | 'story_choice'
  | 'story_unlock'
  | 'action_reject'

export interface SoundSpec {
  id: MifenSoundId
  category: MifenSoundCategory
  label: string
  trigger: string
  durationSec: number
  loop: boolean
  defaultVolume: number
}

export const SOUND_CATALOG: Record<MifenSoundId, SoundSpec> = {
  boil_bubbling: {
    id: 'boil_bubbling',
    category: 'boil',
    label: '沸水大锅滚泡',
    trigger: '煮锅台烫粉期间（cooking.isBoiling() === true 持续循环）',
    durationSec: 2.2,
    loop: true,
    defaultVolume: 0.48,
  },
  boil_dip: {
    id: 'boil_dip',
    category: 'boil',
    label: '笊篱入水涮粉',
    trigger: '在煮锅台开单进入 boil 或竹笊篱下锅瞬间触发',
    durationSec: 0.36,
    loop: false,
    defaultVolume: 0.72,
  },
  boil_lock_perfect: {
    id: 'boil_lock_perfect',
    category: 'boil',
    label: '起锅沥水落碗',
    trigger: '烫粉命中黄金区起锅并切换至 carry_to_meat 时触发',
    durationSec: 0.48,
    loop: false,
    defaultVolume: 0.78,
  },
  boil_lock_miss: {
    id: 'boil_lock_miss',
    category: 'boil',
    label: '烫粉偏候提示',
    trigger: '烫粉偏生或偏软离锅起竹笊篱时触发',
    durationSec: 0.34,
    loop: false,
    defaultVolume: 0.66,
  },
  meat_chop: {
    id: 'meat_chop',
    category: 'meat',
    label: '砧板切码剁肉',
    trigger: '肉台点击任一肉码（锅烧/牛肉/叉烧/卤蛋/油条）切片触发',
    durationSec: 0.26,
    loop: false,
    defaultVolume: 0.84,
  },
  meat_plate: {
    id: 'meat_plate',
    category: 'meat',
    label: '肉码装碗去前台',
    trigger: '点击装碗去前台（commitMeatForCounter -> carry_to_counter）触发',
    durationSec: 0.4,
    loop: false,
    defaultVolume: 0.76,
  },
  brine_pour: {
    id: 'brine_pour',
    category: 'counter',
    label: '长勺倾倒热老卤',
    trigger: '前台按住「按住淋卤」（startBrinePour）期间持续循环，并可单条试听',
    durationSec: 1.2,
    loop: true,
    defaultVolume: 0.62,
  },
  brine_stop: {
    id: 'brine_stop',
    category: 'counter',
    label: '收勺磕桶滴卤',
    trigger: '松手收勺（stopBrinePour）或自动满杯收勺触发',
    durationSec: 0.3,
    loop: false,
    defaultVolume: 0.7,
  },
  condiment_add: {
    id: 'condiment_add',
    category: 'counter',
    label: '加辣椒油与小料',
    trigger: '切换辣椒油芯片（toggle-chili）或小料台交互触发',
    durationSec: 0.24,
    loop: false,
    defaultVolume: 0.72,
  },
  serve_complete: {
    id: 'serve_complete',
    category: 'counter',
    label: '前台出餐成品提示',
    trigger: '点击「前台出餐」（finishAndServe）端给顾客时触发',
    durationSec: 0.65,
    loop: false,
    defaultVolume: 0.8,
  },
  cash_register: {
    id: 'cash_register',
    category: 'economy',
    label: '堂食外卖外售入账',
    trigger: '门店资金实际入账增长（堂食结算/外卖/外售/成就奖金）触发',
    durationSec: 0.55,
    loop: false,
    defaultVolume: 0.75,
  },
  story_open: {
    id: 'story_open',
    category: 'story',
    label: '剧情对话定场开场',
    trigger: '触发任一 StoryBeat 开场并拉起 GTA 对话镜位时触发',
    durationSec: 0.5,
    loop: false,
    defaultVolume: 0.7,
  },
  story_blip_uncle: {
    id: 'story_blip_uncle',
    category: 'story',
    label: '表叔中音逐字对话音',
    trigger: '表叔台词逐字显现节拍触发（内建 >=45ms 节流防刺耳）',
    durationSec: 0.1,
    loop: false,
    defaultVolume: 0.58,
  },
  story_blip_player: {
    id: 'story_blip_player',
    category: 'story',
    label: '玩家清朗逐字对话音',
    trigger: '玩家台词逐字显现节拍触发（内建 >=45ms 节流防刺耳）',
    durationSec: 0.09,
    loop: false,
    defaultVolume: 0.55,
  },
  story_choice: {
    id: 'story_choice',
    category: 'story',
    label: '剧情选项与翻页确认',
    trigger: '对话点击下一句或点选剧情分支选项时触发',
    durationSec: 0.18,
    loop: false,
    defaultVolume: 0.68,
  },
  story_unlock: {
    id: 'story_unlock',
    category: 'story',
    label: '围裙钥匙解锁开店',
    trigger: '表叔对话结束解锁经营权限（onUnlock）或重要里程碑完成触发',
    durationSec: 0.92,
    loop: false,
    defaultVolume: 0.82,
  },
  action_reject: {
    id: 'action_reject',
    category: 'ui',
    label: '跳工位或未解锁拦截',
    trigger: '未找表叔解锁前做粉或跳工位/隔墙操作被拦截时触发',
    durationSec: 0.24,
    loop: false,
    defaultVolume: 0.68,
  },
}

export const SOUND_IDS = Object.keys(SOUND_CATALOG) as MifenSoundId[]
