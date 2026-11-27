import profile from '../../pipeline/data/landmarks/yangqiao-grade.json'
import channel from '../../pipeline/data/landmarks/yangqiao-channel.json'
import {BufferGeometry,Color,Float32BufferAttribute} from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {bindStreetSurface} from './streets'
import {carve,carvePaving,fan,type Plane,type Point} from './tunnels'

const mix=(start:number,end:number,fraction:number)=>start+(end-start)*fraction
export function openYangqiaoChannel(tile:{x:number,z:number},bed:Int16Array,water:Int16Array){
  if(tile.z!==256||!(tile.x===-1280||tile.x===-1024))return
  for(const [east,south,level] of channel.cuts){
    const column:number=(east-tile.x)/4,row:number=(south-tile.z)/4
    if(column<0||column>64||row<0||row>64)continue
    const index=row*65+column
    bed[index]=Math.min(bed[index],level)
    if(bed[index]<channel.waterDm)water[index]=channel.waterDm
  }
}
function vertex(tile:{x:number,z:number},row:number,col:number):Point{
  const station=profile.stations[row],fraction=profile.lateral[col]
  const coordinate=(axis:number)=>mix(mix(profile.south[0][axis],profile.south[1][axis],fraction),mix(profile.north[0][axis],profile.north[1][axis],fraction),station)
  return [coordinate(0)-tile.x,profile.levels[row][col],coordinate(1)-tile.z]
}

function southInlay(tile:{x:number,z:number},road:Float32Array,ground:(x:number,z:number)=>number){
  const col=profile.bands.indexOf('asphalt'),low=profile.lateral[col],high=profile.lateral[col+1]
  const rows=[0,1].map(row=>[vertex(tile,row,col),vertex(tile,row,col+1)])
  const centers=[[.3539,.41535,.499,.505,.57005,.6317],[.377,.44,.499,.505,.565,.628]]
  const yellow=new Color(0xe8bb43),parts:BufferGeometry[]=[]
  const [west,east]=rows[0],edgeTriangles:Float32Array[]=[]
  for(let at=0;at<road.length;at+=9){
    const triangle=road.subarray(at,at+9)
    if([0,2].some(axis=>Math.max(triangle[axis],triangle[axis+3],triangle[axis+6])<Math.min(west[axis],east[axis])||
      Math.min(triangle[axis],triangle[axis+3],triangle[axis+6])>Math.max(west[axis],east[axis])))continue
    edgeTriangles.push(triangle)
  }
  function point(row:number,lateral:number):Point{
    const [left,right]=rows[row],fraction=(lateral-low)/(high-low)
    const pos=left.map((value,index)=>mix(value,right[index],fraction)) as Point
    if(row===1)return pos
    const [x,,z]=pos
    let level=ground(x,z)+.012
    for(const [ax,ay,az,bx,by,bz,cx,cy,cz] of edgeTriangles){
      const det=(bx-ax)*(cz-az)-(bz-az)*(cx-ax)
      if(Math.abs(det)<1e-8)continue
      const u=((x-ax)*(cz-az)-(z-az)*(cx-ax))/det,v=((bx-ax)*(z-az)-(bz-az)*(x-ax))/det
      if(u>=-.0001&&v>=-.0001&&u+v<=1.0001)level=Math.max(level,ay+u*(by-ay)+v*(cy-ay))
    }
    pos[1]=level;return pos
  }
  const edges=centers.map(row=>[low,...row.flatMap((value,index)=>{
    const half=index===2||index===3?.0015:.0016;return [value-half,value+half]
  }),high])
  for(let band=0;band<edges[0].length-1;band++){
    const paint=band%2===1,positions:number[]=[]
    const steps=Math.max(1,Math.ceil((edges[0][band+1]-edges[0][band])*50))
    let ends=edges.map((row,index)=>point(index,row[band]))
    for(let step=1;step<=steps;step++){
      const next=edges.map((row,index)=>point(index,mix(row[band],row[band+1],step/steps)))
      positions.push(...ends[0],...next[0],...next[1],...ends[0],...next[1],...ends[1]);ends=next
    }
    const geom=new BufferGeometry();geom.setAttribute('position',new Float32BufferAttribute(positions,3));bindStreetSurface(geom,paint?'marking':'road')
    geom.setAttribute('aSurface',new Float32BufferAttribute(geom.getAttribute('aSurface').array,1))
    if(band===5||band===7){const color=geom.getAttribute('color');for(let i=0;i<color.count;i++)color.setXYZ(i,yellow.r,yellow.g,yellow.b)}
    parts.push(geom)
  }
  const merged=mergeGeometries(parts)!;parts.forEach(part=>part.dispose());return merged
}

export function yangqiaoDeck(tile:{x:number,z:number},deck:Float32Array,thin:Set<number>,asphalt:number[],streets:{sidewalk:Float32Array,road:Float32Array,surface:BufferGeometry|null},ground:(x:number,z:number)=>number){
  if(tile.z!==256||!(tile.x===-1280||tile.x===-1024))return {deck,thin,asphalt}
  const lastCol=profile.lateral.length-1,lastRow=profile.stations.length-1
  const ring=[vertex(tile,0,0),vertex(tile,0,lastCol),vertex(tile,lastRow,lastCol),vertex(tile,lastRow,0)]
  const planes:Plane[]=ring.map((start,index)=>{const end=ring[(index+1)%4];return point=>(point[0]-start[0])*(end[2]-start[2])-(point[2]-start[2])*(end[0]-start[0])})
  const oldAsphalt=new Set(asphalt),newAsphalt:number[]=[],newThin=new Set<number>()
  function outside(raw:Float32Array,deckFlags=false){const out:number[]=[]
    for(let at=0;at<raw.length;at+=9){
      const face=[0,3,6].map(offset=>Array.from(raw.subarray(at+offset,at+offset+3)) as Point)
      const pieces=carve(face,[planes])??[face]
      for(const piece of pieces){const first=out.length/9;fan(piece,out)
        if(deckFlags)for(let index=first;index<out.length/9;index++){
          if(thin.has(at/9))newThin.add(index);if(oldAsphalt.has(at/9))newAsphalt.push(index)
        }
      }
    }return out
  }
  const result=outside(deck,true),walkPaving:number[]=[],pavedTops=new Set<number>()
  const inlay=tile.x===-1280?southInlay(tile,streets.road,ground):null
  const flushEnds=new Set<number>()
  streets.sidewalk=Float32Array.from(outside(streets.sidewalk));streets.road=Float32Array.from(outside(streets.road))
  const tileExterior:Plane[][]=[[point=>-point[0]],[point=>point[0]-256]]
  for(let row=0;row<lastRow;row++)for(let col=0;col<lastCol;col++){
    const quad=[vertex(tile,row,col),vertex(tile,row,col+1),vertex(tile,row+1,col+1),vertex(tile,row+1,col)]
    const faces=[[quad[0],quad[1],quad[2]],[quad[0],quad[2],quad[3]]]
    for(const face of faces)for(const piece of carve(face,tileExterior)??[face]){
      const first=result.length/9;fan(piece,result)
      const band=profile.bands[col]
      if(band==='walk')fan(piece,walkPaving)
      for(let index=first;index<result.length/9;index++){newThin.add(index);if(band==='asphalt'){
        newAsphalt.push(index);if(row===0&&inlay){pavedTops.add(index);if(face===faces[0])flushEnds.add(index*9)}
      }else if(band==='walk')pavedTops.add(index)}
    }
  }
  if(streets.surface)streets.surface=carvePaving(streets.surface,[planes])
  if(walkPaving.length){
    const paving=new BufferGeometry()
    paving.setAttribute('position',new Float32BufferAttribute(walkPaving,3));bindStreetSurface(paving,'sidewalk')
    if(streets.surface){
      paving.setAttribute('aSurface',new Float32BufferAttribute(paving.getAttribute('aSurface').array,1))
      const merged=mergeGeometries([streets.surface,paving]);streets.surface.dispose();paving.dispose();streets.surface=merged
    }else streets.surface=paving
  }
  if(inlay&&streets.surface){const merged=mergeGeometries([streets.surface,inlay]);streets.surface.dispose();inlay.dispose();streets.surface=merged}
  return {deck:Float32Array.from(result),thin:newThin,asphalt:newAsphalt,pavedTops,flushEnds}
}

export function approachDecor(tile:{x:number,z:number},decor:number[][]){
  if(tile.z!==256||!(tile.x===-1280||tile.x===-1024))return decor
  const end=profile.stations.length-1
  const road=profile.bands.indexOf('asphalt')
  const lane=[vertex(tile,0,road),vertex(tile,0,road+1),vertex(tile,end,road+1),vertex(tile,end,road)]
  for(const [near,far] of [[0,3],[1,2]]){
    const dx=lane[far][0]-lane[near][0],dz=lane[far][2]-lane[near][2],scale=10/Math.hypot(dx,dz)
    lane[near][0]-=dx*scale;lane[near][2]-=dz*scale;lane[far][0]+=dx*scale;lane[far][2]+=dz*scale
  }
  return decor.filter(([kind,east,south])=>kind!==1||!lane.every(([ax,,az],index)=>{
    const [bx,,bz]=lane[(index+1)%lane.length]
    return (east/10-ax)*(bz-az)-(south/10-az)*(bx-ax)>=0
  }))
}
