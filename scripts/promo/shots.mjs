// IDOK-159 promo film shot list. World metres: +x east, +z south, y up (ground ≈150, Li river ≈146).
// Static shots fly `keys` (eye/look Catmull-Rom); ride shots steer the real e-bike/car along `route`
// and film it with a rider-relative camera: offset=[behind, up, right], look=[ahead, up].
// `v` overrides a shot for the 9:16 cut (keys/cam/fov/dur).
export const variants = {
  h:{width:1920,height:1080,fov:50,shots:['s01','s02','s03','s04','s05','s06','s07','s08','s09','s10','s11','s12','s13','s15']},
  v:{width:1080,height:1920,fov:72,shots:['s01','s02','s03','s07','s09','s10','s11','s12','s13','s15']},
}
// Tested e-bike route (scripts/ride-path.json): spawn plaza → Jiefang Rd E → Jiefang Bridge → east bank.
const RIDE = [[-537,-80.7],[-511,-74.7],[-490,-67.7],[-463,-58.7],[-378,-29.7],[-347,-18.7],[-303,-3.7],[-261,10.3],[-197,32.3],[-75,78],[-36,90],[-21,95],[21,108],[157,152]]
const orbit = (c,r,y,a0,a1,n=5)=>[...Array(n).keys()].map(i=>{const a=a0+(a1-a0)*i/(n-1);return {eye:[c[0]+r*Math.sin(a),y,c[2]+r*Math.cos(a)],look:c}})
export const shots = [
  // ---- 山水 (guzheng / dizi) ----
  {id:'s01',title:'晨雾漓江 → 象鼻山',dur:5,hour:6.6,weather:'mist',traffic:false,ease:'out',
    keys:[{eye:[-140,250,-230],look:[-100,195,-1300]},{eye:[-125,228,-430],look:[-100,195,-1300]}]},
  {id:'s02',title:'象鼻山 水月洞',dur:4,hour:7.6,traffic:false,ease:'linear',
    keys:[{eye:[-690,151,1215],look:[-855,160,1105]},{eye:[-698,151,1175],look:[-855,160,1100]}]},
  {id:'s03',title:'杉湖 日月双塔',dur:4,hour:9,ease:'linear',
    keys:orbit([-977,165,631],190,162,3.3,3.7).map(k=>({...k,look:[-977,170,631]}))},
  {id:'s04',title:'叠彩山顶 南望全城',dur:4,hour:10.5,traffic:false,radius:1400,ease:'linear',
    keys:[{eye:[-111,300,-1463],look:[-560,170,200]},{eye:[-150,285,-1380],look:[-560,170,200]}]},
  // ---- 古城 ----
  {id:'s05',title:'靖江王城 中轴 → 独秀峰',dur:4,hour:14,
    keys:[{eye:[-581,172,-280],look:[-535,222,-679]},{eye:[-584,180,-370],look:[-520,228,-679]}]},
  {id:'s06',title:'东西巷',dur:3,hour:16,ease:'linear',
    keys:[{eye:[-575,174,-236],look:[-430,156,-240]},{eye:[-525,171,-237],look:[-400,156,-241]}]},
  // ---- 城市 骑行 (modern pop) ----
  {id:'s07',title:'骑电驴出发',dur:4,hour:15,
    ride:{vehicle:'bike',parkNear:[-539,-95],speed:25,preroll:8,cam:{offset:[[4.5,1.6,1.8],[6,2.4,-1.2]],look:[6,1.1]},
      route:RIDE}},
  {id:'s08',title:'十字街 车流',dur:3,hour:15.5,ease:'linear',
    keys:[{eye:[-840,'+30',-130],look:[-882,'+0',-168]},{eye:[-836,'+32',-134],look:[-882,'+0',-170]}]},
  {id:'s09',title:'迎面骑来',dur:3,hour:16.5,
    ride:{vehicle:'bike',parkNear:[-539,-95],speed:25,preroll:9,cam:{offset:[[-7,1.2,.8],[-5,1.4,.6]],look:[-1,1.2]},
      route:RIDE}},
  {id:'s10',title:'夕阳 骑过解放桥',dur:4,hour:[17.7,18.1],
    ride:{vehicle:'bike',parkNear:[-539,-95],speed:25,preroll:47,cam:{offset:[[1,2.2,-7],[-2,2.6,-8]],look:[2,1.2]},
      route:RIDE}},
  {id:'s11',title:'雨夜 开车',dur:4,hour:21,weather:'rain',
    ride:{vehicle:'car',parkNear:[-433,-59],speed:45,preroll:3,cam:{offset:[[7,2.6,0],[8,3,1.5]],look:[10,1]},
      route:[[-443,-62],[-457,-66],[-475,-72],[-491,-77],[-410,-48],[-378,-25],[-347,-14],[-303,1],[-261,15],[-197,37],[-75,78],[-36,90],[21,108]]}},
  // ---- 夜 ----
  {id:'s12',title:'日月双塔 夜',dur:4,hour:20.5,ease:'linear',
    keys:orbit([-977,165,631],170,158,3.35,2.85).map(k=>({...k,look:[-977,172,631]}))},
  {id:'s13',title:'东西巷 灯笼',dur:3,hour:20.5,weather:'rain',ease:'linear',
    keys:[{eye:[-560,169,-237],look:[-430,157,-240]},{eye:[-528,168,-238],look:[-400,157,-241]}]},
  {id:'s15',title:'夜桥车流 → 升空全城',dur:7,hour:22,radius:2000,ease:'inout',
    keys:[{eye:[-120,160,50],look:[-90,158,62],t:0},{eye:[-122,163,52],look:[-90,158,62],t:.18},{eye:[-200,300,140],look:[-500,160,-200]},{eye:[-60,620,900],look:[-500,150,-400]}]},
]

// Extra clearance from queued traffic on the portrait street and bridge approaches.
for(const shot of shots.filter(s=>s.id==='s09'||s.id==='s10')){
  const untilX = shot.id==='s09' ? -463 : -197
  shot.v = {...shot.v, route:RIDE.map(([x,z])=>[x,z-(x<=untilX?1:0)])}
}

// 9:16 cut (~31 s): shorter takes of the same moves.
const vDur = {s01:3,s02:3,s03:3,s07:3,s09:3,s10:3,s11:3,s12:3,s13:2.5,s15:5.5}
for(const s of shots) if(vDur[s.id]) s.v = {...s.v, dur:vDur[s.id]}
