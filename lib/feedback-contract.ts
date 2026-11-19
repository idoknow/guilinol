export const kinds = ['缺失建筑', '位置或朝向不对', '外观不像', '道路水系', '其他']
export const views = ['正面', '左侧', '右侧', '背面', '远景', '细节', '内部']
export const labels: Record<string, string> = {
  draft: '草稿',
  submitted: '已提交',
  queued: '已进入建模队列',
  modelling: 'AI 建模中',
  reviewing: '审核中',
  live: '已上线',
  need_info: '需要补充信息',
  rejected: '未采纳',
  duplicate: '与已有反馈重复',
}
export const edges: Record<string, string[]> = {
  submitted: ['queued'],
  queued: ['modelling', 'reviewing', 'live', 'need_info', 'rejected', 'duplicate'],
  modelling: ['reviewing', 'live', 'need_info', 'rejected', 'duplicate'],
  reviewing: ['modelling', 'live', 'need_info', 'rejected', 'duplicate'],
  need_info: ['rejected', 'duplicate'],
}
