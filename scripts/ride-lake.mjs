import assert from 'node:assert/strict'

export async function lakeChecks(page,data,output){
  async function enter(x,z){await page.evaluate(async([x,z])=>{const walk=window.viewer.walk;walk.leave();if(!await walk.enter(x,z,0,'harbor'))throw Error('no landing')},[x,z])}
  async function photo(name,target,offset){await page.evaluate(({target,offset})=>{const camera=window.viewer.camera,original=camera.lookAt;camera.lookAt=function(){camera.position.set(...target.map((value,index)=>value+offset[index]));original.call(camera,...target)};window.restoreCamera=()=>{camera.lookAt=original}},{target,offset});await page.evaluate(()=>new Promise(requestAnimationFrame));await page.screenshot({path:`${output}/${name}.png`});await page.evaluate(()=>window.restoreCamera())}
  const row=[...data.bikes,...(data.bicycles??[])].filter(bike=>Math.hypot(bike[0]+112.7,bike[2]+794)<4);assert.equal(new Set(row.map(bike=>bike[4])).size,4)
  await enter(-115,-798);await photo('parked-four',[-112.75,149.65,-794],[5,2.6,2.2])
  const dock=data.docks['榕湖'],leg=data.routes.find(route=>route.kind==='boat'&&route.start==='榕湖');assert(leg,'缺少榕湖画舫');await enter(dock[0],dock[2]);await page.waitForFunction(()=>document.querySelector('.vehicle-action')?.textContent.includes('榕湖'))
  const [x,y,z]=leg.path[0];await photo('painted-boat-dock',[x,y+.8,z],[8,4,6]);await page.keyboard.press('f')
  assert.equal(leg.end,'桂湖')
  const measurement=await page.evaluate(async endpoint=>{
    const {walk,stream}=window.viewer;let samples=0,minimum=Infinity,roof=0,head=0
    for(let tick=0;tick<8000;tick++){
      walk.tick(.25)
      if(tick%32===0){stream.tick(walk.position);await new Promise(requestAnimationFrame)}
      if(tick%2===0){const probe=walk.boatClearance();if(probe?.kind!=='boat')throw Error('not on sightseeing boat')
        roof=Math.max(roof,probe.roof-walk.position.y);head=Math.max(head,probe.head-walk.position.y)
        if(Number.isFinite(probe.clearance)){samples++;minimum=Math.min(minimum,probe.clearance)}}
      if(Math.hypot(walk.position.x-endpoint[0],walk.position.z-endpoint[2])<2)return {samples,minimum,roof,head}
    }
    throw Error('未到达桂湖')
  },leg.path.at(-1))
  assert(measurement.samples>0&&measurement.minimum>=.4,JSON.stringify(measurement));console.log('榕湖 → 桂湖实船',measurement)
  return measurement
}
