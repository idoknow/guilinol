import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'

export async function captureFlight(page,directory){
  await page.evaluate(()=>window.viewer.walkTo(-805.9,256.8,-1.57,'rear-left-door'))
  await page.locator('.heli-prompt').click();await page.locator('input[value=dynamic]').check({force:true})
  await page.getByRole('button',{name:'加入队列'}).click();await page.getByRole('button',{name:'确认登机'}).click()
  await page.waitForFunction(()=>window.viewer.heli.active)
  await page.addStyleTag({content:'.spot-card{display:none!important}'})
  const seat=await page.evaluate(()=>window.viewer.heli.queue().flight.seat);assert.equal(seat,2)
  const seek=async(time,yaw=1.25,pitch=.45)=>page.evaluate(async args=>{window.viewer.heli.seek(...args);document.querySelector('.spot-card.show .card-close')?.click();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)},[time,yaw,pitch])
  const capture=async(file,time,yaw,pitch)=>{await seek(time,yaw,pitch);await page.locator('.spot-card:visible').waitFor({state:'hidden'});await page.screenshot({path:`${directory}/${file}.jpg`,quality:89,timeout:120000})}
  await capture('rotor-cruise',62,1.25,.46)
  await page.keyboard.press('KeyT');await page.waitForFunction(()=>window.viewer.heli.first);await capture('rear-first',64,0,8*Math.PI/180);await capture('rear-rotor',64,1.33,-.36);await page.keyboard.press('KeyT')
  const frames=`${directory}/frames`;await mkdir(frames,{recursive:true})
  for(let frame=0;frame<120;frame++){await seek(62+frame/10);await page.screenshot({path:`${frames}/${String(frame).padStart(3,'0')}.jpg`,quality:80,timeout:120000})}
  execFileSync('ffmpeg',['-y','-loglevel','error','-framerate','10','-i',`${frames}/%03d.jpg`,'-frames:v','120','-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','6','-b:v','0','-crf','38',`${directory}/cruise.webm`])
}
