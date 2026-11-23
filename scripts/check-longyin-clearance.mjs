import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {BufferAttribute,BufferGeometry,Mesh,Raycaster,Vector3} from 'three'

const directory = 'public/world/'
const {peaks} = JSON.parse(await readFile(directory + 'manifest.json'))
const entry = peaks.entries.find(peak => peak.name === '月牙山')
assert.ok(entry)
const packed = Uint8Array.from(await readFile(directory + peaks.file)).buffer
let reply
globalThis.self = {postMessage(message) { reply = message }}
await import('../web/src/peaks-worker.ts')
for (const coarse of [false,true]) {
  const lods = coarse ? [entry.lods[1],entry.lods[1]] : entry.lods
  await self.onmessage({data:{packed,entries:[{...entry,lods}],palette:Array(7).fill([0,0,0]),bareFrom:.5,rockShare:.5,jitter:0}})
  for (const [positions,indices] of [[reply.pos0,reply.peaks[0].idx0],[reply.pos1,reply.peaks[0].idx1]]) {
    let minClearance = Infinity, summit = -Infinity
    for (let at=0; at<positions.length; at+=3) {
      const [east,height,south] = positions.subarray(at,at+3)
      const northCycleway = 742.7 + (east-152.4)*(805.6-742.7)/(331.7-152.4)
      minClearance = Math.min(minClearance,(northCycleway-south)/Math.hypot(1,(805.6-742.7)/(331.7-152.4)))
      summit = Math.max(summit,height)
    }
    assert.ok(minClearance >= 5.5,`Mountain enters the road corridor: ${minClearance} m`)
    assert.ok(Math.abs(summit-entry.center[1]) < .1,`Summit changed: ${summit}`)
    const geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(positions,3))
    geometry.setIndex(new BufferAttribute(indices,1))
    const hill=new Mesh(geometry), origin=new Vector3(360,152,864), heading=-37*Math.PI/180
    let skyline=-1
    for(let degrees=0;degrees<=45;degrees++) {
      const direction=new Vector3(Math.sin(heading),Math.tan(degrees*Math.PI/180),-Math.cos(heading)).normalize()
      if(new Raycaster(origin,direction).intersectObject(hill).length)skyline=degrees
    }
    assert.ok(skyline>=2 && skyline<=15,`Unexpected southwest shoulder: ${skyline} degrees`)
    console.log({coarse,minClearance,summit,skyline})
  }
}
