/**
 * 田源米粉 · 表叔剧情脚本与分支台词
 *
 * 与 story/uncle/index.ts（NPC 与大头像）及 story/director.ts（GTA 风对话演出与镜头）对接：
 * - `meet`：三多路老铺门前初遇腕伤表叔，顶班接过围裙与后厨钥匙 -> 对话结束触发 shop 解锁与赚钱机制
 * - `first_bowl`：按三工位亲手做出第一碗粉出餐 -> 表叔肯定火候老卤，正式放权经营堂食/外卖/外售
 * - `shop_lv2`：扩店升级双开间旺铺 -> 叮嘱守住老卤与脆皮锅烧节奏，留住熟客回头率
 * - `shop_lv3`：升级三多路旗舰大店 -> 表叔腕伤痊愈欣慰交棒，三多路传世粉摊招牌正式交托
 */

export type StorySpeaker = 'uncle' | 'player'

export type StoryExpr = 'neutral' | 'smile' | 'worry' | 'proud' | 'laugh'

export type StoryShot = 'wide' | 'uncle' | 'player' | 'two' | 'shop'

export interface StoryChoice {
  id: string
  text: string
  /** 当前段 `lines` 中的 0-based 目标台词索引 */
  next: number
}

export interface StoryLine {
  speaker: StorySpeaker
  expr: StoryExpr
  shot: StoryShot
  text: string
  choices?: StoryChoice[]
}

export type StoryBeatId = 'meet' | 'first_bowl' | 'shop_lv2' | 'shop_lv3'

export interface StoryBeat {
  id: StoryBeatId
  trigger: string
  lines: StoryLine[]
}

export const STORY_BEATS: readonly StoryBeat[] = [
  {
    id: 'meet',
    trigger: 'uncle_interact',
    lines: [
      {
        speaker: 'uncle',
        expr: 'worry',
        shot: 'wide',
        text: '阿侄来得正好！早上掀老卤大锅盖没稳住，滚卤溅到手腕，现在拎笊篱都发抖……',
      },
      {
        speaker: 'player',
        expr: 'worry',
        shot: 'player',
        text: '表叔，三多路门口老街坊都排开队了，你缠着绷带怎么撑一上午？',
      },
      {
        speaker: 'uncle',
        expr: 'neutral',
        shot: 'uncle',
        text: '粉筐、脆锅烧、老卤全备齐了，就是这手端不动锅。你替表叔进店顶这一班，行不行？',
        choices: [
          { id: 'accept_direct', text: '别硬撑了，围裙和钥匙给我，我马上开火！', next: 5 },
          { id: 'ask_steps', text: '行，但我先把三道工位顺序问清楚。', next: 3 },
        ],
      },
      {
        speaker: 'player',
        expr: 'neutral',
        shot: 'two',
        text: '进后厨是不是先煮粉，再到肉台和前台？',
      },
      {
        speaker: 'uncle',
        expr: 'smile',
        shot: 'uncle',
        text: '对头！先到后厨煮锅台盯紧黄金区烫粉，端碗转去肉台按单切码，最后回前台明档淋老卤出餐。',
      },
      {
        speaker: 'uncle',
        expr: 'proud',
        shot: 'two',
        text: '好小子！这件米色围裙和后厨钥匙收好——进门就能接票开煮，第一批客人别让人等急了！',
      },
    ],
  },
  {
    id: 'first_bowl',
    trigger: 'first_bowl_served',
    lines: [
      {
        speaker: 'uncle',
        expr: 'laugh',
        shot: 'shop',
        text: '稳当！锅烧酥边配着老卤香飘半条街，门口阿婆嗦完一口直点大拇指！',
      },
      {
        speaker: 'player',
        expr: 'smile',
        shot: 'player',
        text: '三道工位踩顺之后手感真不错，汤卤也不容易淋过头。',
      },
      {
        speaker: 'uncle',
        expr: 'proud',
        shot: 'uncle',
        text: '第一碗站住脚，后面堂食连击、午晚汤卤分离外卖、柜台瓶装老卤都能放开跑，账本交给你我放心！',
        choices: [
          { id: 'keep_rhythm', text: '明白，盯紧翻台和库存，把店稳步做大。', next: 3 },
        ],
      },
      {
        speaker: 'uncle',
        expr: 'smile',
        shot: 'two',
        text: '趁热打铁接着出单，早市不误客，咱们凑够本钱就打通隔壁！',
      },
    ],
  },
  {
    id: 'shop_lv2',
    trigger: 'shop_level_2',
    lines: [
      {
        speaker: 'uncle',
        expr: 'laugh',
        shot: 'wide',
        text: '哈，真把隔壁门面打通成双开间了！七格小料台一摆开，连西巷熟客都往里挤。',
      },
      {
        speaker: 'player',
        expr: 'proud',
        shot: 'player',
        text: '多亏扩了座位和煮锅位，早高峰排队也没那么压单了。',
      },
      {
        speaker: 'uncle',
        expr: 'neutral',
        shot: 'uncle',
        text: '摊子大了更要盯紧细节：脆皮锅烧别一次炸太多，外卖记得分格装，别砸了田源老字号口碑。',
      },
      {
        speaker: 'uncle',
        expr: 'smile',
        shot: 'two',
        text: '照这股劲头再攒攒，三多路旗舰大店的金字招牌准能挂起来！',
      },
    ],
  },
  {
    id: 'shop_lv3',
    trigger: 'shop_level_3',
    lines: [
      {
        speaker: 'uncle',
        expr: 'proud',
        shot: 'shop',
        text: '抬头看看那块田源三多路旗舰总店金字招牌——我手腕早利索了，可真没想过能被你带到这光景！',
      },
      {
        speaker: 'player',
        expr: 'laugh',
        shot: 'player',
        text: '还不是表叔那锅二十八味老卤打底，外地游客和老街坊一来三多路就认这口正宗！',
      },
      {
        speaker: 'uncle',
        expr: 'laugh',
        shot: 'two',
        text: '哈哈！少贫嘴。老卤秘方册和这把老铁勺今天正式交给你，三多路这碗粉，往后就靠你立住咯！',
      },
    ],
  },
]

export function getStoryBeat(id: string): StoryBeat | undefined {
  return STORY_BEATS.find(b => b.id === id)
}

export function getStoryBeatByTrigger(trigger: string): StoryBeat | undefined {
  return STORY_BEATS.find(b => b.trigger === trigger)
}
