import {defaultAvatar, type Avatar} from '../../../lib/avatar'

/**
 * 「关于」页的贡献者名单（IDOK-148）。按人列，每项贡献写几个字，而不是贴仓库的 contributors 列表。
 *
 * 维护：
 * - 合入代码 → 在对应的人下面加一条 `code`；新的人就新加一项。
 * - 玩家反馈被处理：**不用改这里**。反馈上线后 bridge 自动写入署名，「关于」页从 /api/contributors 取并合进本名单，
 *   头像按该账号的游戏角色现场渲染（IDOK-186）。同名的人（这里的 name = 游戏昵称）会合并成一张卡。
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
  /** 头像：public/contributors/<portrait>.webp，由 `node scripts/contributor-portraits.mjs` 按 avatar 渲染 */
  portrait:string
  /** 该账号在网上桂林里的角色外形（glol.avatar.v1，取自线上存档）；没建过角色的用默认外形 */
  avatar:Avatar
  items:Contribution[]
}

export const KIND_LABEL:Record<ContribKind,{seal:string,label:string}> = {
  lead:{seal:'起',label:'发起'},
  code:{seal:'码',label:'写代码'},
  design:{seal:'绘',label:'设计'},
  photo:{seal:'摄',label:'实拍'},
  feedback:{seal:'言',label:'反馈'},
}

const DEFAULT = defaultAvatar(1)
const m = (a:Partial<Avatar>):Avatar => ({...DEFAULT, ...a})

export const contributors:Contributor[] = [
  {name:'Rock', github:'RockChinQ', role:'发起人', portrait:'rock', avatar:m({look:'campus'}), items:[
    {kind:'lead', text:'发起项目'},
    {kind:'code', text:'城市与界面'},
    {kind:'photo', text:'实拍参考'},
    {kind:'feedback', text:'江边灯柱'},
  ]},
  {name:'唐援朝', github:'yxwyxw520', role:'Logo 与联机', portrait:'tangyuanchao', avatar:m({eyes:1, face:2, skin:4}), items:[
    {kind:'design', text:'像素 Logo'},
    {kind:'code', text:'多人联机'},
    {kind:'code', text:'青桂电动车'},
    {kind:'code', text:'市民卡'},
  ]},
  {name:'py Xie', github:'CheatAndei', role:'玩法与地标', portrait:'pyxie', avatar:DEFAULT, items:[
    {kind:'code', text:'人物与载具'},
    {kind:'code', text:'换装与商店'},
    {kind:'code', text:'地标精模'},
    {kind:'code', text:'行道树'},
  ]},
  {name:'HelloFHZ', github:'fhzit', role:'账号与上线', portrait:'hellofhz', avatar:DEFAULT, items:[
    {kind:'code', text:'QQ / 微信登录'},
    {kind:'code', text:'不停服更新'},
    {kind:'code', text:'画面提速'},
    {kind:'feedback', text:'校门'},
  ]},
  {name:'haohaoxuedili', github:'haohaoxuedili', role:'开场与路面', portrait:'haohaoxuedili', avatar:DEFAULT, items:[
    {kind:'code', text:'随机开场'},
    {kind:'feedback', text:'路面观感'},
    {kind:'feedback', text:'街道与地标'},
  ]},
  {name:'Woods Chen', role:'手机体验', portrait:'woodschen', avatar:DEFAULT, items:[
    {kind:'code', text:'一键横屏'},
    {kind:'feedback', text:'手机操控'},
    {kind:'feedback', text:'行道树'},
  ]},
  {name:'神铭', role:'玩家', portrait:'shenming', avatar:m({face:1, eyes:2, hair:'m_perm', look:'office', skin:1}), items:[
    {kind:'feedback', text:'按键错位'},
  ]},
]
