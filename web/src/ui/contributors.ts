/**
 * 「关于」页的贡献者名单（IDOK-148）。按人列，写清每个人具体做了什么，而不是贴仓库的 contributors 列表。
 *
 * 维护：
 * - 合入代码 → 在对应的人下面加一条 `code`；新的人就新加一项。
 * - 玩家反馈被处理（docs/feedback.md 流程）→ 用游戏里的昵称加一条 `feedback`，写反馈的是什么。
 * - 美术、Logo、实拍照片等 → `design` / `photo`。
 * 只写昵称和公开主页，不写邮箱、真名或其它个人信息。
 */
export type ContribKind = 'lead'|'code'|'design'|'photo'|'feedback'

export interface Contribution {kind:ContribKind; text:string}
export interface Contributor {
  name:string
  /** GitHub 用户名（有才写；用于主页链接） */
  github?:string
  /** 一句话的身份，比如「发起人」 */
  role:string
  items:Contribution[]
}

export const KIND_LABEL:Record<ContribKind,{seal:string,label:string}> = {
  lead:{seal:'起',label:'发起'},
  code:{seal:'码',label:'写代码'},
  design:{seal:'绘',label:'设计'},
  photo:{seal:'摄',label:'实拍'},
  feedback:{seal:'言',label:'反馈'},
}

/** Logo 设计者。名字待确认前保持空串：卡片照常显示，名字处写「网上桂林成员」。 */
export const LOGO_DESIGNER:string = ''

export const contributors:Contributor[] = [
  {name:'Rock', github:'RockChinQ', role:'发起人', items:[
    {kind:'lead', text:'发起网上桂林，定下「真实地图 + 青绿山水」的方向'},
    {kind:'code', text:'带着 AI 协作者搭起整座城和大部分界面'},
    {kind:'photo', text:'走街串巷补拍地标、学校和街面参考照片'},
    {kind:'feedback', text:'江边灯柱的数量和朝向'},
  ]},
  {name:'py Xie', github:'CheatAndei', role:'玩法与地标', items:[
    {kind:'code', text:'人物手感、电动车、自由划船，四种载具一键上下'},
    {kind:'code', text:'换装衣橱、微笑堂服装店、十字街电动车店和任务经济'},
    {kind:'code', text:'日月双塔、象鼻山、桂林剧院和多所学校的地标精模'},
    {kind:'code', text:'桂林行道树、进城更快的第一轮提速'},
  ]},
  {name:'HelloFHZ', github:'fhzit', role:'账号与上线', items:[
    {kind:'code', text:'QQ / 微信一键登录'},
    {kind:'code', text:'更新游戏不用停服，玩着也不掉线'},
    {kind:'code', text:'街区和水面倒影的优化，画面更流畅'},
    {kind:'feedback', text:'学校缺了校门'},
  ]},
  {name:'haohaoxuedili', github:'haohaoxuedili', role:'开场与路面', items:[
    {kind:'code', text:'随机开场机位，和「回到上次离开的地方」'},
    {kind:'feedback', text:'低机位下路面读成一块块黑色硬边'},
    {kind:'feedback', text:'街道多边形溢出、地标外观不像'},
  ]},
  {name:'Woods Chen', role:'手机体验', items:[
    {kind:'code', text:'竖屏手机一键横屏入口'},
    {kind:'feedback', text:'手机上要有视角摇杆、要能横屏玩'},
    {kind:'feedback', text:'行道树的排列和路边缺的两栋楼'},
  ]},
  {name:'神铭', role:'玩家', items:[
    {kind:'feedback', text:'按键位置错位'},
  ]},
]
