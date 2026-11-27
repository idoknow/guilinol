// 误封回归：Shift 冲刺 + 网络抖动不应被拒；持续超速仍要拒
import {checkMove, LIMITS} from './anti-cheat.mjs'
const mk=()=>({x:0,y:100,z:0,posAt:1_000_000,foot:true})
let fails=0
const assert=(c,m)=>{if(!c){fails++;console.log('FAIL',m)}else console.log('PASS',m)}

// 1) 正常冲刺 9 m/s，20Hz，带 ±40ms 抖动
{
  const p=mk(); let at=p.posAt, x=0, bad=0
  const jitter=[50,50,16,90,50,34,50,50,66,50]
  for(let i=0;i<200;i++){
    const dt=jitter[i%jitter.length]; at+=dt; x+=9*dt/1000
    const v=checkMove(p,x,100,0,at)
    if(v.reject) bad++
    else {p.x=x;p.y=100;p.z=0;p.posAt=at}
  }
  assert(bad===0, `冲刺 9m/s + 抖动 200 包：拒包 ${bad} 次应为 0`)
}
// 2) 冲刺中偶尔一个 7m/56ms 的尖峰（真实日志里的现象）
{
  const p=mk(); let at=p.posAt, x=0, bad=0
  for(let i=0;i<80;i++){
    const dt=50; at+=dt
    x += (i===40 ? 7.6 : 9*dt/1000)
    const v=checkMove(p,x,100,0,at)
    if(v.reject) bad++
    else {p.x=x;p.posAt=at}
  }
  assert(bad===0, `冲刺中单包尖峰 7.6m：拒包 ${bad} 次应为 0`)
}
// 3) 持续 25 m/s（作弊）必须拒
{
  const p=mk(); let at=p.posAt, x=0, bad=0
  for(let i=0;i<60;i++){ const dt=50; at+=dt; x+=25*dt/1000
    const v=checkMove(p,x,100,0,at); if(v.reject) bad++; else {p.x=x;p.posAt=at} }
  assert(bad>0, `持续 25m/s：应被拒（实际拒 ${bad} 次）`)
}
// 4) 40 m/s 徒步刷包必须拒
{
  const p=mk(); let at=p.posAt, x=0, bad=0
  for(let i=0;i<40;i++){ const dt=50; at+=dt; x+=40*dt/1000
    const v=checkMove(p,x,100,0,at); if(v.reject) bad++; else {p.x=x;p.posAt=at} }
  assert(bad>5, `持续 40m/s：应被拒（实际拒 ${bad} 次）`)
}
// 5) 汽车 150km/h（41.7 m/s）不误判
{
  const p=mk(); p.foot=false; p.bike=true; p.bikeAt=p.posAt-3000
  let at=p.posAt, x=0, bad=0
  for(let i=0;i<60;i++){ const dt=50; at+=dt; x+=41.7*dt/1000
    const v=checkMove(p,x,100,0,at); if(v.reject) bad++; else {p.x=x;p.posAt=at} }
  assert(bad===0, `汽车 150km/h：拒包 ${bad} 次应为 0`)
}

// 6) 篡改：客户端谎报速度 0，但每包位移 40 m/s → 必须拒
{
  const p=mk(); p.v=0; p.reportedSpeed=0; let at=p.posAt, x=0, bad=0
  for(let i=0;i<60;i++){ const dt=50; at+=dt; x+=40*dt/1000
    const v=checkMove(p,x,100,0,at); if(v.reject) bad++; else {p.x=x;p.posAt=at} }
  assert(bad>10, `谎报速度 0 但实跑 40m/s：应被拒（拒 ${bad}）`)
}
// 7) 篡改：同一毫秒内灌 20 包（burst）累计 30 米 → 必须拒
{
  const p=mk(); let at=p.posAt, x=0, bad=0
  for(let i=0;i<20;i++){ at+=1; x+=1.5
    const v=checkMove(p,x,100,0,at); if(v.reject) bad++; else {p.x=x;p.posAt=at} }
  assert(bad>0, `1ms 内灌 20 包共 30 米：应被拒（拒 ${bad}）`)
}
// 8) 篡改：单包 60 米（低于瞬移阈值 200）→ 必须拒
{
  const p=mk(); const v=checkMove(p,60,100,0,p.posAt+100)
  assert(!!v.reject, '单包 60 米：应被拒')
}
console.log(fails? `\n${fails} 项失败`:'\n全部通过')
process.exit(fails?1:0)
