import {checkMove, LIMITS, speedCap} from './anti-cheat.mjs'
const p={x:0,y:100,z:0,posAt:1_000_000,foot:true}
let at=p.posAt, x=0
for(let i=0;i<40;i++){
  at+=50; x+=25*0.05
  const v=checkMove(p,x,100,0,at)
  if(i%5===0||v.reject) console.log(i, 'flat', (x-p.x).toFixed(2), 'budget', (p.moveBudget?.m??0).toFixed(2), v.reject?'REJECT':'ok')
  if(!v.reject){p.x=x;p.y=100;p.z=0;p.posAt=at}
}
console.log('walk cap', speedCap(p,at), 'refill', speedCap(p,at)*LIMITS.winTol)
