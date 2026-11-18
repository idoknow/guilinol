// 观景点 (M4). Stand point x/z is where the walker unlocks the card; `at` is what the best view looks at.
// `summit` marks peaks with a real stair path: the card offers 登顶, which lifts the camera to the top.
// Facts are kept to well-documented ones; images and long texts stay out of the bundle.
export interface Spot {
  id:string; name:string; seal:string; sub:string; intro:string
  x:number; z:number; at:[number,number]
  best:{label:string; hour:number}
  summit?:{x:number; z:number; at:[number,number]; label:string}
}

export const spots:Spot[] = [
  {id:'elephant', name:'象鼻山', seal:'象', sub:'水月洞 · 桂林城徽',
    intro:'古称漓山，山形像一头巨象临江伸鼻饮水。鼻与腿之间的圆洞就是水月洞，江水穿洞而过，月夜里洞影和月影一起落在水上。',
    x:-685, z:1182, at:[-855,1098], best:{label:'黄昏到月夜',hour:18.1}},
  {id:'pagodas', name:'日月双塔', seal:'塔', sub:'杉湖 · 两江四湖',
    intro:'杉湖中的两座塔：日塔是铜塔，九层；月塔是琉璃塔，七层，两塔之间由湖底隧道相连。入夜亮灯，倒映在湖里。',
    x:-905, z:520, at:[-977,631], best:{label:'入夜',hour:20.3}},
  {id:'bridge', name:'解放桥', seal:'桥', sub:'漓江 · 城中与七星之间',
    intro:'城中心跨漓江的主桥。站在桥中间往北看是伏波山，再远是叠彩山；往南是漓江转弯，象鼻山就在下游。',
    x:-185, z:35, at:[-86,-685], best:{label:'黄昏',hour:18.1}},
  {id:'xiaoyao', name:'逍遥楼', seal:'楼', sub:'东城墙 · 临江城楼',
    intro:'唐代就有的临江城楼，楼名相传出自颜真卿手书，今楼为重建。登楼东望七星山，脚下就是漓江。',
    x:-235, z:-120, at:[300,60], best:{label:'清晨',hour:6.6}},
  {id:'fubo', name:'伏波山', seal:'伏', sub:'还珠洞 · 试剑石',
    intro:'半枕陆地、半插漓江，山名纪念汉代伏波将军马援。山脚的还珠洞贴着江水，洞里有千佛岩和一根悬空的试剑石。',
    x:-30, z:-620, at:[-86,-690], best:{label:'午后',hour:15},
    summit:{x:-86, z:-685, at:[-180,-1400], label:'伏波山顶'}},
  {id:'diecai', name:'叠彩山', seal:'叠', sub:'明月峰 · 拿云亭',
    intro:'岩层一层层横叠，像堆起的彩缎，所以叫叠彩。主峰明月峰顶有拿云亭，是看全城山水最好的地方；半山的风洞前后贯通，夏天也有凉风。',
    x:-200, z:-1395, at:[-111,-1463], best:{label:'清晨薄雾',hour:6.6},
    summit:{x:-111, z:-1463, at:[-560,200], label:'明月峰顶'}},
  {id:'duxiu', name:'独秀峰', seal:'秀', sub:'靖江王城 · 南天一柱',
    intro:'王城里拔地而起的一座孤峰，人称南天一柱。“桂林山水甲天下”这句诗，就刻在山脚读书岩旁。沿三百多级石阶可登顶俯瞰全城。',
    x:-525, z:-595, at:[-513,-679], best:{label:'上午',hour:9.5},
    summit:{x:-513, z:-679, at:[-700,400], label:'独秀峰顶'}},
  {id:'southgate', name:'古南门', seal:'榕', sub:'榕湖 · 古榕双桥',
    intro:'桂林古城墙留下来的城门，门洞上一棵古榕盘根错节，已有数百年，“榕城”之名由此而来。门前就是榕湖。',
    x:-1425, z:175, at:[-1411,121], best:{label:'清晨',hour:7.5}},
  {id:'lanes', name:'东西巷', seal:'巷', sub:'正阳门外 · 老街巷',
    intro:'靖江王城正阳门外的老街区，青砖灰瓦、窄巷相通，是明清桂林城留下来的格局。白天看老屋，夜里灯笼亮起最热闹。',
    x:-478, z:-182, at:[-590,-235], best:{label:'夜里',hour:20.3}},
  {id:'crossing', name:'十字街', seal:'街', sub:'中山中路 · 解放路',
    intro:'中山路和解放路交汇的路口，几十年来都是桂林城的中心，四周商场林立，往东走几步就是正阳步行街。',
    x:-881, z:-165, at:[-881,-420], best:{label:'华灯初上',hour:19.5}},
]

export const yawToward = (x:number,z:number,[tx,tz]:[number,number])=>Math.atan2(-(tx-x),-(tz-z))
