import assert from 'node:assert/strict'

export async function handoff({page,other,url,api,output}){
  const door=client=>client.evaluate(()=>window.viewer.walkTo(-805.8,257.6,-1.57,'queue-handoff'))
  const show=client=>client.locator('.heli-prompt').evaluate(button=>button.click())
  const choose=async(client,text)=>{const button=client.getByRole('button',{name:text,exact:true});await button.waitFor();await button.evaluate(element=>element.click())}
  const wait=(client,fn)=>client.waitForFunction(fn,null,{timeout:120000,polling:250})
  assert.ok(await door(page));await page.evaluate(()=>window.viewer.freeze())
  try{await other.goto(url,{waitUntil:'domcontentloaded'});await wait(other,()=>window.viewer?.walk?.active);assert.ok(await door(other));await other.evaluate(()=>window.viewer.freeze())}finally{await page.evaluate(()=>window.viewer.resume())}
  console.log('Both accounts at the pad')
  await wait(page,()=>!document.querySelector('.heli-prompt').hidden);await show(page);await choose(page,'加入队列');await choose(page,'确认登机');await wait(page,()=>window.viewer.heli.queue()?.flight)
  api.advance(24000);await wait(page,()=>window.viewer.heli.phase==='cruise');await other.evaluate(()=>window.viewer.resume());await wait(other,()=>window.viewer.heli.queue()?.state==='flying');await show(other);await choose(other,'加入队列');await wait(other,()=>window.viewer.heli.queue()?.mine?.offered===false)
  assert.match(await other.locator('.heli-queue-status').innerText(),/前面 0 人 · 预计等待 [1-9]\d* 秒/)
  const stamp=await other.evaluate(()=>window.viewer.heli.queue().now),[first,second]=await Promise.all([page,other].map(client=>client.evaluate(time=>window.viewer.heli.positionAt(time),stamp)))
  const error=Math.hypot(first.x-second.x,first.y-second.y,first.z-second.z);assert.ok(error<=.5);console.log('Simultaneous airborne error (m)',error)
  await other.screenshot({path:`${output}/10-observer-queue.jpg`,timeout:120000});await other.locator('.heli-panel').evaluate(panel=>panel.close())
  await other.evaluate(async()=>{const viewer=window.viewer;await viewer.freeze();const point=viewer.heli.positionAt(viewer.heli.queue().now);viewer.camera.position.set(point.x+18,point.y+5,point.z+18);viewer.camera.lookAt(point.x,point.y,point.z);viewer.redrawGfx()});try{await other.screenshot({path:`${output}/10b-observer-aircraft.jpg`,timeout:120000})}finally{await other.evaluate(()=>window.viewer.resume())}
  const heartbeat=()=>other.evaluate(async()=>{const response=await fetch('/api/helicopter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'ping'})});return response.json()})
  for(let step=0;step<30;step++){const state=await heartbeat();assert.ok(state.mine);if(state.state==='unloading')break;api.advance(15000)}
  await wait(page,()=>window.viewer.heli.phase==='landed'&&!document.querySelector('.heli-prompt').hidden);await page.keyboard.press('KeyF');await wait(page,()=>window.viewer.heli.phase==='idle');await wait(other,()=>window.viewer.heli.queue()?.mine?.offered);await show(other);await choose(other,'确认登机');await wait(other,()=>window.viewer.heli.active);await other.screenshot({path:`${output}/11-next-passenger.jpg`,timeout:120000});console.log('A unloaded; B boarded')
}
