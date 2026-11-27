/**
 * Host side of the landmark open stairwells (小香港 E1/E2/W1/W2, 十字街 nw/ne/se/sw): the terrain and street holes,
 * the invisible stepped-ramp 'road' collider and its floor query.
 *
 * Lazy on purpose: tunnels.ts starts loading this chunk at boot and keeps only thin hooks in the main chunk;
 * world.detail and forest.readTrees await `groundStairwellsReady`, so no tile or tree streams in before its well.
 */
import * as THREE from 'three'
import type {Tile} from './world'
import {carve,fan,type GroundStairwell,type Plane,type Point} from './tunnels'
import {xxgGroundStairwells} from './xiaoxianggang/frame'
import {szjGroundStairwells} from './shizijie/frame'

export const stairwells:readonly GroundStairwell[]=[...xxgGroundStairwells(),...szjGroundStairwells()]

function local(s:GroundStairwell,x:number,z:number){
  const dx=x-s.x,dz=z-s.z,c=Math.cos(s.yaw),n=Math.sin(s.yaw)
  return [dx*c-dz*n,dx*n+dz*c] as const
}

/** Walk line through the tread centres: grade at the top nosing apron, depth below it on the bottom landing. */
export function stairwellFloor(s:GroundStairwell,lz:number){
  return THREE.MathUtils.clamp(s.grade-s.riser/2-s.riser/s.tread*(s.zTop-lz),s.grade-s.depth,s.grade)
}

/** Ramp height under (x, z) for a walker at `foot`, or undefined off every well. */
export function floorAt(x:number,z:number,foot:number){
  for(const s of stairwells){
    const [lx,lz]=local(s,x,z)
    if(Math.abs(lx)>s.halfWidth+.06||lz<(s.land??s.zBack)-.05||lz>s.zTop+.25)continue
    const floor=stairwellFloor(s,lz)
    // Generous headroom: a jump inside the open well must stay on the ramp, not fall back to the cut terrain.
    if(foot>=floor-.95&&foot<=s.grade+3)return floor
  }
  return undefined
}

/** Keep trees 1.5 m clear of every opening. */
export function blocksTree(x:number,z:number){
  return stairwells.some(s=>{
    const [lx,lz]=local(s,x,z)
    return Math.abs(lx)<=s.halfWidth+1.5&&lz>=s.zBack-1.5&&lz<=s.zTop+1.5
  })
}

const near=(s:GroundStairwell,tile:Tile)=>s.x+12>=tile.x&&s.x-12<=tile.x+256&&s.z+12>=tile.z&&s.z-12<=tile.z+256

/** Tile-local convex volume of an opening, from the top nosing to the back of the hole (planes >= 0 inside). */
function cut(s:GroundStairwell,tile:Tile):Plane[]{
  const cos=Math.cos(s.yaw),sin=Math.sin(s.yaw),cx=s.x-tile.x,cz=s.z-tile.z
  const lx=(p:Point)=>(p[0]-cx)*cos-(p[2]-cz)*sin,lz=(p:Point)=>(p[0]-cx)*sin+(p[2]-cz)*cos
  const hw=s.halfWidth+.02,top=s.zTop+.02,back=s.zBack-.02
  return [p=>lx(p)+hw,p=>hw-lx(p),p=>lz(p)-back,p=>top-lz(p)]
}

/**
 * Terrain cuts and tile-local ramp quads for one tile: apron, tread-centre slope and bottom landing, plus (when the
 * landing runs on under the grade) side and end faces steep enough that the walker treats them as walls.
 */
export function tileWells(tile:Tile){
  const cuts:Plane[][]=[],quads:Point[][]=[]
  for(const s of stairwells){
    if(!near(s,tile))continue
    cuts.push(cut(s,tile))
    const cos=Math.cos(s.yaw),sin=Math.sin(s.yaw),cx=s.x-tile.x,cz=s.z-tile.z
    const at=(x:number,y:number,z:number):Point=>[cx+x*cos+z*sin,y,cz-x*sin+z*cos],fw=s.halfWidth+.12
    const foot=s.zTop+s.tread/2-s.depth*s.tread/s.riser,low=s.grade-s.depth,end=s.land??s.zBack-.4
    const profile:[number,number][]=[[s.zTop+.6,s.grade-.01],[s.zTop+s.tread/2,s.grade],[foot,low],[end,low]]
    for(let i=1;i<profile.length;i++){
      const [z0,y0]=profile[i-1],[z1,y1]=profile[i]
      quads.push([at(-fw,y0,z0),at(fw,y0,z0),at(fw,y1,z1),at(-fw,y1,z1)])
    }
    if(s.land===undefined)continue
    const w=s.halfWidth+.03,z0=s.zTop+1,y0=low-.2,y1=s.grade+1.1
    for(const x of [-w,w])quads.push([at(x,y0,z0),at(x,y0,end),at(x,y1,end),at(x,y1,z0)])
    quads.push([at(-w,y0,end),at(w,y0,end),at(w,low+3,end),at(-w,low+3,end)])
  }
  return {cuts,quads}
}

/** Open the street surface and the sidewalk/road walk soups over wells that sit on a street. */
export function cutStreets(tile:Tile,streets:{road:Float32Array,sidewalk:Float32Array,surface:THREE.BufferGeometry|null}){
  const cuts=stairwells.filter(s=>near(s,tile)).map(s=>cut(s,tile))
  if(!cuts.length)return
  const soup=(src:Float32Array,size:number)=>{
    const out:number[]=[]
    for(let at=0;at<src.length;at+=size*3){
      const tri=[0,1,2].map(k=>Array.from(src.subarray(at+k*size,at+k*size+size)) as Point),pieces=carve(tri,cuts)
      if(pieces)pieces.forEach(poly=>fan(poly,out));else for(const v of tri)out.push(...v)
    }
    return out
  }
  streets.road=Float32Array.from(soup(streets.road,3))
  streets.sidewalk=Float32Array.from(soup(streets.sidewalk,3))
  if(!streets.surface)return
  // Interleave every attribute behind the position so clipping interpolates colour, kind and along too.
  const flat=streets.surface.index?streets.surface.toNonIndexed():streets.surface,attrs=Object.entries(flat.attributes)
  const size=attrs.reduce((n,[,a])=>n+a.itemSize,0),count=flat.getAttribute('position').count,packed=new Float32Array(count*size)
  for(let i=0,o=0;i<count;i++)for(const [,a] of attrs)for(let k=0;k<a.itemSize;k++)packed[o++]=a.getComponent(i,k)
  const out=soup(packed,size),n=out.length/size,geometry=new THREE.BufferGeometry()
  let offset=0
  for(const [name,a] of attrs){
    const data=new Float32Array(n*a.itemSize)
    for(let i=0;i<n;i++)for(let k=0;k<a.itemSize;k++)data[i*a.itemSize+k]=out[i*size+offset+k]
    geometry.setAttribute(name,new THREE.BufferAttribute(data,a.itemSize));offset+=a.itemSize
  }
  if(flat!==streets.surface)flat.dispose()
  streets.surface.dispose()
  streets.surface=geometry
}
