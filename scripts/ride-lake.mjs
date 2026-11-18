import assert from 'node:assert/strict'

export async function lakeChecks(page,data,output){
  async function enter(x,z){await page.evaluate(async([x,z])=>{const walk=window.viewer.walk;walk.leave();if(!await walk.enter(x,z,0,'harbor'))throw Error('no landing')},[x,z])}
  async function photo(name,target,offset){await page.evaluate(({target,offset})=>{const camera=window.viewer.camera,original=camera.lookAt;camera.lookAt=function(){camera.position.set(...target.map((value,index)=>value+offset[index]));original.call(camera,...target)};window.restoreCamera=()=>{camera.lookAt=original}},{target,offset});await page.evaluate(()=>new Promise(requestAnimationFrame));await page.screenshot({path:`${output}/${name}.png`});await page.evaluate(()=>window.restoreCamera())}
  const row=data.bikes.filter(bike=>Math.hypot(bike[0]+112.7,bike[2]+794)<4);assert.equal(new Set(row.map(bike=>bike[4])).size,4)
  await enter(-115,-798);await photo('parked-four',[-112.75,149.65,-794],[5,2.6,2.2])
  const dock=data.docks['杉湖'],leg=data.routes.find(route=>route.start==='杉湖');await enter(dock[0],dock[2]);await page.waitForFunction(()=>document.querySelector('.vehicle-action')?.textContent.includes('杉湖'))
  const [x,y,z]=leg.path[0];await photo('painted-boat-dock',[x,y+.8,z],[8,4,6]);await page.keyboard.press('e')
  return page.evaluate(async()=>{const {walk,stream}=window.viewer;let samples=0,minimum=Infinity,last=null;for(let step=0;step<4000;step++){
    walk.tick(.2);const probe=walk.boatClearance();if(!probe||probe.kind!=='boat')throw Error('not on sightseeing boat')
    if(Number.isFinite(probe.clearance)){samples++;minimum=Math.min(minimum,probe.clearance);last=probe}else if(samples)return {samples,minimum,last}
    if(step%24===0){stream.tick(walk.position);await new Promise(resolve=>setTimeout(resolve,10))}
  }throw Error('no complete bridge passage')})
}
