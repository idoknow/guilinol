import route from './ride-path.json' with {type:'json'}
const [approach,zhongshan]=route

export async function rideToCrossroads(page,atlas){
  const position=await page.evaluate(()=>window.viewer.manifest.landmarks.find(entry=>entry.id==='shizijie')?.position)
  if(!position)throw Error('Missing manifest landmark: shizijie')
  const end={x:position[0],z:position[2]},roads=atlas.roads.filter(road=>road.n==='中山中路').map(road=>road.p)
  return page.evaluate(async({approach,zhongshan,end,roads,trace})=>{
    const {walk,stream}=window.viewer,keys=new Set(),distanceToRoad=(x,z)=>Math.min(...roads.flatMap(path=>{
      const distances=[];for(let index=0;index+3<path.length;index+=2){const dx=path[index+2]-path[index],dz=path[index+3]-path[index+1],offsetX=x-path[index],offsetZ=z-path[index+1],fraction=Math.max(0,Math.min(1,(offsetX*dx+offsetZ*dz)/(dx*dx+dz*dz||1)));distances.push(Math.hypot(offsetX-dx*fraction,offsetZ-dz*fraction))}return distances}))
    function press(code,on){if(keys.has(code)===on)return;window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code}));if(on)keys.add(code);else keys.delete(code)}
    let total=0,main=0,seconds=0,maxSpeed=0,crossed=false;const start=walk.position.toArray(),advance=walk.tick;walk.tick=()=>{}
    try{
    for(const [leg,points] of [approach,[...zhongshan,[end.x,end.z]]].entries())for(const [x,z] of points){
      const initial=walk.position.clone(),limit=40+Math.hypot(x-initial.x,z-initial.z)/2;let checkpoint=initial.clone(),detour=0,attempt=0
      for(let iteration=0;;iteration++){
        const pos=walk.position.clone(),dx=x-pos.x,dz=z-pos.z,gap=Math.hypot(dx,dz);if(gap<2.2)break
        const tile=window.viewer.manifest.chunks.find(tile=>x>=tile.x&&x<tile.x+256&&z>=tile.z&&z<tile.z+256)
        if(tile&&!stream.loaded.has(tile)){const deadline=performance.now()+15000;while(!stream.loaded.has(tile)&&performance.now()<deadline){stream.tick(pos.clone().set(tile.x+128,pos.y,tile.z+128));await new Promise(resolve=>setTimeout(resolve,20))}}
        if(iteration*.06>limit)throw Error(`stuck: target ${x},${z} at ${pos.toArray()}, ${walk.obstacle}, ${JSON.stringify(walk.probe())}`)
        if(iteration&&iteration%48===0){if(checkpoint.distanceTo(pos)<.8){attempt++;detour=iteration+48}checkpoint=pos.clone()}
        const offset=iteration<detour?(attempt%2?1:-1)*1.1:0,angle=Math.atan2(-dx,-dz)+offset-walk.heading,error=Math.atan2(Math.sin(angle),Math.cos(angle));press('KeyA',error>.035);press('KeyD',error<-.035)
        const desired=Math.abs(error)>.4?0:Math.min(25/3.6,1.8+gap*.5);press('KeyW',walk.speed<desired);press('KeyS',walk.speed>desired+.1)
        advance(.06);const now=walk.position.clone(),delta=Math.hypot(now.x-pos.x,now.z-pos.z);total+=delta;seconds+=.06;maxSpeed=Math.max(maxSpeed,walk.speed)
        if(trace&&now.x>-425&&now.x<-280&&Math.abs(now.z)<55&&iteration%20===0&&iteration<160){const p=walk.probe();console.log('bridge-trace',JSON.stringify([now.x,now.z,p.foot,p.renderY,p.deck,[...stream.landmarks.keys()].some(e=>e.id==='jiefang_bridge'),p.hits.slice(0,1)]))}
        if(leg===1){if(distanceToRoad(now.x,now.z)>18)throw Error('outside Zhongshan corridor');main+=delta;if(Math.hypot(now.x+817,now.z+377)<18)crossed=true}
        if(walk.probe().inHouse||walk.speed>25/3.6+.001)throw Error('unsafe ride')
        if(iteration%80===0){stream.tick(now);await new Promise(resolve=>setTimeout(resolve,0))}
      }
    }
    for(const code of [...keys])press(code,false);const finish=walk.position.clone();return {start,total,main,seconds,maxKmh:maxSpeed*3.6,crossed,targetDistance:Math.hypot(end.x-finish.x,end.z-finish.z)}
    }finally{walk.tick=advance;for(const code of [...keys])press(code,false)}
  },{approach,zhongshan,end,roads,trace:!!process.env.TRACE_BRIDGE})
}
