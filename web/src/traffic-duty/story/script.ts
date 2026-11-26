/**
 * 解放桥交警岗前对话脚本（web/src/traffic-duty/story/script.ts）
 *
 * 合规约束：
 *  - 严禁出现敏感执法字样与真实编号
 *  - 全量文本无 emoji、无渐变、无外链图片依赖
 *  - 每句台词明确配置电影机位 (`shot`) 与角色神态 (`expr`)
 *  - 仅在对话走完交接台词（grantGear: true）时发放执勤哨与指挥旗并正式开启解放桥值班
 */

import type {DutyShotId} from './camera-shots.ts'

export type DutyStorySpeaker = 'officer' | 'player'

export type DutyStoryExpr = 'serious' | 'smile' | 'remind' | 'thumbs_up' | 'curious' | 'neutral' | 'handoff'

export type DutyStoryBeatId = 'briefing_intro' | 'briefing_repeat' | 'off_duty'

export interface DutyShiftSettlement {
  readonly citedCount?: number
  readonly totalFineYuan?: number
  readonly rewardYuan?: number
  readonly playerCutYuan?: number
  readonly pendingEarningsYuan?: number
  readonly playerShareRate?: number
  readonly stackedCount?: number
  readonly multiViolationCount?: number
  readonly overloadNoHelmetCount?: number
  readonly stackedFineYuan?: number
  readonly elapsedSec?: number
  readonly stoppedCount?: number
  readonly warnedCount?: number
}

export interface ResolvedDutySettlement {
  readonly citedCount: number
  readonly totalFineYuan: number
  readonly shareRatePct: number
  readonly rewardYuan: number
  readonly stackedCount: number
  readonly stackedFineYuan: number
}

export interface DutyStoryChoice {
  readonly id: string
  readonly text: string
  /** 当前段 `lines` 中的 0-based 目标索引 */
  readonly next: number
}

export interface DutyStoryLine {
  readonly speaker: DutyStorySpeaker
  readonly speakerLabel: string
  readonly expr: DutyStoryExpr
  readonly shot: DutyShotId
  readonly text: string
  readonly choices?: readonly DutyStoryChoice[]
  /** 是否在该台词正式交接执勤哨与指挥旗 */
  readonly grantGear?: boolean
  /** 走到该台词并继续时结束对话；默认仅最后一行结束并视为接受任务 */
  readonly endMode?: 'accept' | 'decline'
}

export interface DutyStoryBeat {
  readonly id: DutyStoryBeatId
  readonly title: string
  readonly lines: readonly DutyStoryLine[]
}

export const DUTY_STORY_BEATS: readonly DutyStoryBeat[] = Object.freeze([
  {
    id: 'briefing_intro',
    title: '解放桥文明劝导岗前交接',
    lines: [
      {
        speaker: 'officer',
        speakerLabel: '解放桥交警',
        expr: 'serious',
        shot: 'wide',
        text: '这位市民来得正是时候！早高峰刚起来，桥上黑色非机动车道两轮车越来越密，有人不戴头盔还贴着逆行，我一个人守着西桥头顾不过来。',
      },
      {
        speaker: 'player',
        speakerLabel: '市民志愿者',
        expr: 'curious',
        shot: 'player',
        text: '交警同志，我在桥头原地就能接班当辅警吗？用不用跑去十字街看信号灯？',
      },
      {
        speaker: 'officer',
        speakerLabel: '解放桥交警',
        expr: 'smile',
        shot: 'officer',
        text: '不用跑十字街，也不用管红绿灯！这一班只守解放桥桥面范围，护栏外是黑色非机动车道。要先听一遍值勤要领，还是直接领上哨旗就地开干？',
        choices: [
          {
            id: 'ask_rules',
            text: '先把桥面范围、Q/E/F 键用法和递交凭单流程讲清楚。',
            next: 3,
          },
          {
            id: 'ready_now',
            text: '我清楚了，把口哨和指挥旗交给我，现在原地就上岗！',
            next: 5,
          },
        ],
      },
      {
        speaker: 'officer',
        speakerLabel: '解放桥交警',
        expr: 'remind',
        shot: 'bridge',
        text: '记住范围就在解放桥三道连续护栏所在桥面上——走出桥头会显示「正在值班」并把你拉回。按 Q 吹哨警告周围违规车，按 E 挥旗点车靠边，长按 E 放行。',
      },
      {
        speaker: 'player',
        speakerLabel: '市民志愿者',
        expr: 'smile',
        shot: 'player',
        text: '车拦停之后呢？是不是靠近按 F 取出手持终端输入车牌、打印出纸，再走到骑手跟前按 F 递给他？',
      },
      {
        speaker: 'officer',
        speakerLabel: '解放桥交警',
        expr: 'thumbs_up',
        shot: 'two',
        grantGear: true,
        endMode: 'accept',
        text: '一点就通，太稳当了！哨子、指挥旗和手持打印终端都交给你——一班十分钟，安全第一，解放桥原地现在开始值班！',
      },
    ],
  },
  {
    id: 'briefing_repeat',
    title: '解放桥续班点验',
    lines: [
      {
        speaker: 'officer',
        speakerLabel: '解放桥交警',
        expr: 'smile',
        shot: 'wide',
        text: '辛苦啦！刚歇口气，解放桥上又迎来一波非机动车高峰，口哨、指挥旗和终端都还顺手吗？要不要原地再接一班十分钟文明劝导？',
        choices: [
          {
            id: 'repeat_accept',
            text: '没问题，吹哨挥旗再接一班，接着守好解放桥！',
            next: 1,
          },
          {
            id: 'repeat_decline',
            text: '先在桥边看会儿江景，待会儿再来接班。',
            next: 2,
          },
        ],
      },
      {
        speaker: 'officer',
        speakerLabel: '解放桥交警',
        expr: 'thumbs_up',
        shot: 'two',
        grantGear: true,
        endMode: 'accept',
        text: '够劲！装备全部点验到位，按 Q 吹哨、E 挥旗、F 开单递交，请在解放桥执勤范围内安全上岗！',
      },
      {
        speaker: 'officer',
        speakerLabel: '解放桥交警',
        expr: 'remind',
        shot: 'officer',
        endMode: 'decline',
        text: '行嘞，你先在桥头人行道歇着，注意离机动车道远点，什么时候想继续执勤随时找我！',
      },
    ],
  },
])

export function resolveDutySettlement(raw?: DutyShiftSettlement | null): ResolvedDutySettlement {
  const citedCount = Math.max(0, Math.round(raw?.citedCount ?? 0))
  const totalFineYuan = Math.max(0, Math.round(raw?.totalFineYuan ?? 0))
  const rawRate = raw?.playerShareRate
  const shareRate = typeof rawRate === 'number' && Number.isFinite(rawRate) && rawRate > 0 && rawRate <= 1 ? rawRate : 0.1
  const shareRatePct = Math.round(shareRate * 100)
  const explicitReward = raw?.rewardYuan ?? raw?.playerCutYuan ?? raw?.pendingEarningsYuan
  const rewardYuan =
    typeof explicitReward === 'number' && Number.isFinite(explicitReward)
      ? Math.max(0, Math.round(explicitReward))
      : Math.round(totalFineYuan * shareRate)
  const rawStacked = raw?.stackedCount ?? raw?.multiViolationCount ?? raw?.overloadNoHelmetCount ?? 0
  const stackedCount = Math.max(0, Math.round(rawStacked))
  const stackedFineYuan = Math.max(0, Math.round(raw?.stackedFineYuan ?? 0))
  return {
    citedCount,
    totalFineYuan,
    shareRatePct,
    rewardYuan,
    stackedCount,
    stackedFineYuan,
  }
}

export function buildOffDutyStoryBeat(settlement?: DutyShiftSettlement | null): DutyStoryBeat {
  const s = resolveDutySettlement(settlement)
  const line0Text =
    s.citedCount > 0
      ? `辛苦这一班！刚跟桥头台账核对过数字：你本班累计开单 ${s.citedCount} 笔，罚款合计 ${s.totalFineYuan} 元，解放桥非机动车道比早高峰稳当多啦！`
      : '辛苦这一班！今天站在西桥头稳住了桥面秩序，台账显示本班开单 0 笔、罚款合计 0 元，过往骑手大多听从劝导主动规范行驶。'

  const line1Text =
    s.stackedCount > 0 && s.stackedFineYuan > 0
      ? `另外单独提一嘴你的「数罪并罚」：今天遇到超载加未戴头盔这类多项叠加违规，你一并核对开出了 ${s.stackedCount} 笔（单此类合计 ${s.stackedFineYuan} 元），抓重点抓得非常准。`
      : s.stackedCount > 0
        ? `另外单独表扬一句你的「数罪并罚」：桥上遇到超载加未戴头盔两项并罚时，你一丝不苟合并处置了 ${s.stackedCount} 起，把双倍路面风险压下去了。`
        : '另外单独提醒一句「数罪并罚」：以后在桥面再遇上超载加未戴头盔等两项同时违规，记得终端里一并勾选合并开单，教育劝导分量才够足。'

  const line2Text =
    s.citedCount > 0
      ? '收到，我记下啦！下回看到超载加未戴头盔肯定两项合并核查到位——那按开岗说好的规矩，这班我能领走多少劳务分红？'
      : '明白，遇到叠加违规我肯定盯紧「数罪并罚」不漏项！那这班台账都核对妥当了，是不是现在就能结清下岗？'

  const line3Text = `全部核清！按约定 ${s.shareRatePct}% 执勤分成核算，本班罚款合计 ${s.totalFineYuan} 元中的 ${s.shareRatePct}% 归你——实发分得 ${s.rewardYuan} 元，先收好下岗歇会儿，想搭班随时回桥头！`

  return {
    id: 'off_duty',
    title: '解放桥交差下岗结算',
    lines: [
      {
        speaker: 'officer',
        speakerLabel: '解放桥交警',
        expr: 'smile',
        shot: 'officer',
        text: line0Text,
      },
      {
        speaker: 'officer',
        speakerLabel: '解放桥交警',
        expr: s.stackedCount > 0 ? 'serious' : 'remind',
        shot: 'two',
        text: line1Text,
      },
      {
        speaker: 'player',
        speakerLabel: '市民志愿者',
        expr: 'smile',
        shot: 'player',
        text: line2Text,
      },
      {
        speaker: 'officer',
        speakerLabel: '解放桥交警',
        expr: 'thumbs_up',
        shot: 'two',
        endMode: 'accept',
        text: line3Text,
      },
    ],
  }
}

export function getDutyStoryBeat(id: DutyStoryBeatId, settlement?: DutyShiftSettlement | null): DutyStoryBeat {
  if (id === 'off_duty') return buildOffDutyStoryBeat(settlement)
  return DUTY_STORY_BEATS.find(b => b.id === id) ?? DUTY_STORY_BEATS[0]
}
