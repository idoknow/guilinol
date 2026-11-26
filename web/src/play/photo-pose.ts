// IDOK-226：拍照模式里的「动作」键 + 表情轮盘显隐。
// 快门出片期间（shot）和录像期间（rec）键与轮盘都收起，人物动作照常播放；
// 关掉「人物」或当前不能做表情时键还在、只是置灰，轮盘不许开。
export type PhotoBusy = '' | 'shot' | 'rec'

export interface PoseInputs {
  figure: boolean
  capturing: boolean
  recording: boolean
  /** 走路层此刻允许做表情（canEmote && 表情开关）。 */
  ready: boolean
}

export interface PoseView {
  busy: PhotoBusy
  /** 「动作」键可见（快门/录像期间收起）。 */
  button: boolean
  /** 「动作」键可点。 */
  enabled: boolean
  /** 轮盘可以开着；false 时已开的轮盘要关掉。 */
  wheel: boolean
}

export function poseView({figure, capturing, recording, ready}: PoseInputs): PoseView {
  const busy: PhotoBusy = recording ? 'rec' : capturing ? 'shot' : ''
  const enabled = figure && ready
  return {busy, button: !busy, enabled, wheel: !busy && enabled}
}
