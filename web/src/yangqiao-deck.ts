import profile from '../../pipeline/data/landmarks/yangqiao-grade.json'
import type {BufferGeometry} from 'three'
import {carve,carvePaving,fan,type Plane,type Point} from './tunnels'

const mix=(start:number,end:number,fraction:number)=>start+(end-start)*fraction
function vertex(tile:{x:number,z:number},row:number,col:number):Point{
  const station=profile.stations[row],fraction=profile.lateral[col]
  const coordinate=(axis:number)=>mix(mix(profile.south[0][axis],profile.south[1][axis],fraction),mix(profile.north[0][axis],profile.north[1][axis],fraction),station)
  return [coordinate(0)-tile.x,profile.levels[row][col],coordinate(1)-tile.z]
}

export function yangqiaoDeck(tile:{x:number,z:number},deck:Float32Array,thin:Set<number>,asphalt:number[],streets:{sidewalk:Float32Array,road:Float32Array,surface:BufferGeometry|null}){
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
  const result=outside(deck,true)
  if(streets.surface)streets.surface=carvePaving(streets.surface,[planes])
  streets.sidewalk=Float32Array.from(outside(streets.sidewalk));streets.road=Float32Array.from(outside(streets.road))
  const tileExterior:Plane[][]=[[point=>-point[0]],[point=>point[0]-256]]
  for(let row=0;row<lastRow;row++)for(let col=0;col<lastCol;col++){
    const quad=[vertex(tile,row,col),vertex(tile,row,col+1),vertex(tile,row+1,col+1),vertex(tile,row+1,col)]
    const faces=[[quad[0],quad[1],quad[2]],[quad[0],quad[2],quad[3]]]
    for(const face of faces)for(const piece of carve(face,tileExterior)??[face]){
      const first=result.length/9;fan(piece,result)
      for(let index=first;index<result.length/9;index++){newThin.add(index);if(col===2)newAsphalt.push(index)}
    }
  }
  return {deck:Float32Array.from(result),thin:newThin,asphalt:newAsphalt}
}
