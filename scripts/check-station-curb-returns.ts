// Sample both sides of each section 12 tie using the emitted pavement triangles.
import fs from 'node:fs'
import path from 'node:path'
import {tileFaces} from './dingjiang-visible-surfaces'

type Vertex = [number, number, number]
type Face = Vertex[]
const [reference, candidate] = process.argv.slice(2)
const worlds = [reference, candidate]
const manifests = worlds.map(w => JSON.parse(fs.readFileSync(path.join(w, 'manifest.json'), 'utf8')))
const design = JSON.parse(fs.readFileSync('pipeline/rail-sections/12-guilin-station.json','utf8'))
const results = []

function surface(faces: Face[], x: number, z: number) {
  let top = -Infinity
  for (const [p,q,r] of faces) {
    const ax=q[0]-p[0], az=q[2]-p[2], bx=r[0]-p[0], bz=r[2]-p[2]
    const det=ax*bz-az*bx
    if (Math.abs(det)<1e-10) continue
    const u=((x-p[0])*bz-(z-p[2])*bx)/det, v=(ax*(z-p[2])-az*(x-p[0]))/det
    if (u < -1e-8 || v < -1e-8 || u+v > 1+1e-8) continue
    top=Math.max(top,p[1]+u*(q[1]-p[1])+v*(r[1]-p[1]))
  }
  return top
}

function roadHeight(chord, distance: number) {
  const levels=chord.stations
  const i=levels.findIndex(([s])=>s>=distance)
  if (i<0) return levels.at(-1)[1]
  if (!i) return levels[0][1]
  const [a,y]=levels[i-1], [b,h]=levels[i]
  return y+(h-y)*(distance-a)/(b-a)
}

for (const [key,profile] of Object.entries(design.priorRoadProfiles['01']) as [string,{curbReturns:number[],pavingNodes:number[]}][]) {
  const way=Number(key)
  for (const node of profile.curbReturns) {
    const index=profile.pavingNodes.indexOf(node)
    const chords=manifests.map(m=>m.tunnels.find(t=>t.way===way && t.nodes[index]===node))
    if (chords.some(c=>!c)) throw Error('Missing tie '+node)
    const [x,y,z]=chords[0].portals[index], other=chords[0].portals[1-index]
    const dx=(other[0]-x)/chords[0].length, dz=(other[2]-z)/chords[0].length
    const width=chords[0].halfWidth, reach=width+8
    const meshes=worlds.map((world,i)=>{
      const faces:Face[]=[]
      for (const tile of manifests[i].chunks) {
        if (x+reach<tile.x || x-reach>tile.x+256 || z+reach<tile.z || z-reach>tile.z+256) continue
        tileFaces(world,tile,manifests[i].tunnels,(face,role,owner)=>{
          if (!(role.startsWith('paving-') || (role==='graded-floor' && owner===way))) return
          if (face.every(p=>p[1]>y+1) || face.every(p=>p[1]<y-1)) return
          if (face.every(p=>p[0]<x-reach)||face.every(p=>p[0]>x+reach)||face.every(p=>p[2]<z-reach)||face.every(p=>p[2]>z+reach)) return
          faces.push(face)
        },true)
      }
      return faces
    })
    for (const side of [-1,1]) {
      let maxRevealError=0, missing=0, samples=0
      const sections=[]
      for (const along of [-.02,.02,.25,.5,1,1.5,2,2.5,3,3.5,4]) {
        const px=x+along*dx,pz=z+along*dz
        const centers=chords.map(chord=>roadHeight(chord,index ? chord.length-along : along))
        let worst=null
        for (let j=1;j<=40;j++) {
          const offset=side*(width+j/20)
          const levels=meshes.map(faces=>surface(faces,px-offset*dz,pz+offset*dx))
          if (!Number.isFinite(levels[0])) continue
          if (!Number.isFinite(levels[1])) {missing++;continue}
          const reveal=levels.map((h,i)=>h-centers[i])
          const error=Math.abs(reveal[1]-reveal[0])
          samples++
          maxRevealError=Math.max(maxRevealError,error)
          if (!worst || error>worst.error) worst={offset,reference:reveal[0],candidate:reveal[1],error}
        }
        sections.push({along,worst})
      }
      results.push({way,node,side,samples,missing,maxRevealError,sections})
    }
  }
}
console.log(JSON.stringify(results,null,2))
if (results.some(r=>!r.samples || r.missing || r.maxRevealError>.020001)) process.exitCode=1
