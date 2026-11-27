import profile from '../../pipeline/data/landmarks/yangqiao-grade.json'
import channel from '../../pipeline/data/landmarks/yangqiao-channel.json'
import {BufferGeometry,Color,Float32BufferAttribute} from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {bindStreetSurface} from './streets'
import {carve,carvePaving,fan,type Plane,type Point} from './tunnels'

const mix=(start:number,end:number,fraction:number)=>start+(end-start)*fraction
function bounds(points:Point[]):Plane[]{
  return points.map((start,index)=>{const end=points[(index+1)%points.length];return point=>(point[0]-start[0])*(end[2]-start[2])-(point[2]-start[2])*(end[0]-start[0])})
}
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

export function yangqiaoDeck(tile:{x:number,z:number},deck:Float32Array,thin:Set<number>,asphalt:number[],streets:{sidewalk:Float32Array,road:Float32Array,surface:BufferGeometry|null}){
  if(tile.z!==256||!(tile.x===-1280||tile.x===-1024))return {deck,thin,asphalt}
  const lastCol=profile.lateral.length-1,lastRow=profile.stations.length-1
  const ring=[vertex(tile,0,0),vertex(tile,0,lastCol),vertex(tile,lastRow,lastCol),vertex(tile,lastRow,0)]
  const planes=bounds(ring)
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
  const paint:{planes:Plane[],height:(point:Point)=>number}[]=[],yellow:number[]=[]
  streets.sidewalk=Float32Array.from(outside(streets.sidewalk));streets.road=Float32Array.from(outside(streets.road))
  const tileExterior:Plane[][]=[[point=>-point[0]],[point=>point[0]-256]]
  for(let row=0;row<lastRow;row++)for(let col=0;col<lastCol;col++){
    const quad=[vertex(tile,row,col),vertex(tile,row,col+1),vertex(tile,row+1,col+1),vertex(tile,row+1,col)]
    const faces=[[quad[0],quad[1],quad[2]],[quad[0],quad[2],quad[3]]]
    if(row===0&&profile.bands[col]==='asphalt'){
      for(const face of faces){
        const [first,second,third]=face,edges=bounds(face),area=edges[0](third)
        paint.push({planes:edges,height:point=>(edges[1](point)*first[1]+edges[2](point)*second[1]+edges[0](point)*third[1])/area})
        for(const center of [.499,.505]){
          const rail=(offset:number)=>[0,1].map(index=>{
            const left=vertex(tile,index,col),right=vertex(tile,index,col+1)
            const fraction=(center+offset-profile.lateral[col])/(profile.lateral[col+1]-profile.lateral[col])
            return left.map((value,axis)=>mix(value,right[axis],fraction)) as Point
          })
          const [leftStart,leftEnd]=rail(-.0015),[rightStart,rightEnd]=rail(.0015)
          const limits=bounds([leftStart,rightStart,rightEnd,leftEnd])
          const outside=limits.map(plane=>[(point:Point)=>-plane(point)])
          for(const piece of carve(face,[...outside,...tileExterior])??[face])fan(piece.map(([east,height,south])=>[east,height+.022,south]),yellow)
        }
      }
    }
    for(const face of faces)for(const piece of carve(face,tileExterior)??[face]){
      const first=result.length/9;fan(piece,result)
      const band=profile.bands[col]
      if(band==='walk')fan(piece,walkPaving)
      for(let index=first;index<result.length/9;index++){newThin.add(index);if(band==='asphalt')newAsphalt.push(index);else if(band==='walk')pavedTops.add(index)}
    }
  }
  if(streets.surface)streets.surface=carvePaving(streets.surface,[planes],paint)
  if(yellow.length&&streets.surface){
    const stripes=new BufferGeometry();stripes.setAttribute('position',new Float32BufferAttribute(yellow,3));bindStreetSurface(stripes,'marking')
    stripes.setAttribute('aSurface',new Float32BufferAttribute(stripes.getAttribute('aSurface').array,1))
    const colors=stripes.getAttribute('color'),tone=new Color('#cfa346')
    for(let index=0;index<colors.count;index++)colors.setXYZ(index,tone.r,tone.g,tone.b)
    const merged=mergeGeometries([streets.surface,stripes]);streets.surface.dispose();stripes.dispose();streets.surface=merged
  }
  if(walkPaving.length){
    const paving=new BufferGeometry()
    paving.setAttribute('position',new Float32BufferAttribute(walkPaving,3));bindStreetSurface(paving,'sidewalk')
    if(streets.surface){
      paving.setAttribute('aSurface',new Float32BufferAttribute(paving.getAttribute('aSurface').array,1))
      const merged=mergeGeometries([streets.surface,paving]);streets.surface.dispose();paving.dispose();streets.surface=merged
    }else streets.surface=paving
  }
  const southLength=Math.hypot(ring[1][0]-ring[0][0],ring[1][2]-ring[0][2])
  const joinedEdge=(east:number,south:number)=>Math.abs(planes[0]([east,0,south]))<.01*southLength&&east>=ring[0][0]-.01&&east<=ring[1][0]+.01
  return {deck:Float32Array.from(result),thin:newThin,asphalt:newAsphalt,pavedTops,joinedEdge}
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
