import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'

export async function captureFlight(page,directory){
  await page.evaluate(()=>window.viewer.walkTo(-805.9,256.8,-1.57,'rear-left-door'))
  await page.locator('.heli-prompt').click();await page.locator('input[value=dynamic]').check({force:true})
  await page.getByRole('button',{name:'加入队列'}).click();await page.getByRole('button',{name:'确认登机'}).click()
  await page.waitForFunction(()=>window.viewer.heli.active)
  const seat=await page.evaluate(()=>window.viewer.heli.queue().flight.seat);assert.equal(seat,2)
  const seek=async time=>page.evaluate(async value=>{window.viewer.heli.seek(value,1.25);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)},time)
  const capture=async(file,time)=>{await seek(time);await page.screenshot({path:`${directory}/${file}.jpg`,quality:86,timeout:120000})}
  for(const [name,time] of [['board-approach',-6.8],['board-open',-5.4],['board-step',-4.8],['board-seat',-3.65],['side',-3.05],['rotor-idle',-2.9],['rotor-transition',-1.5],['downwash',1.2],['rotor-cruise',62]])await capture(name,time)
  await page.keyboard.press('KeyT');await page.waitForFunction(()=>window.viewer.heli.first);await capture('rear-first',64);await page.keyboard.press('KeyT')
  const frames=`${directory}/frames`;await mkdir(frames,{recursive:true})
  for(let frame=0;frame<120;frame++){await seek(62+frame/10);await page.screenshot({path:`${frames}/${String(frame).padStart(3,'0')}.jpg`,quality:80,timeout:120000})}
  execFileSync('ffmpeg',['-y','-loglevel','error','-framerate','10','-i',`${frames}/%03d.jpg`,'-c:v','libvpx-vp9','-b:v','0','-crf','38',`${directory}/cruise.webm`])
}
