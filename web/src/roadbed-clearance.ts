import {Vector3} from 'three'
import {split} from './station-paving'

export function clearTerrain(face:Vector3[],ground:(east:number,south:number)=>number,step:number,clearance:number){
  const west=Math.floor(Math.min(...face.map(point=>point.x))/step)*step
  const north=Math.floor(Math.min(...face.map(point=>point.z))/step)*step
  const east=Math.ceil(Math.max(...face.map(point=>point.x))/step)*step
  const south=Math.ceil(Math.max(...face.map(point=>point.z))/step)*step
  const minimum=Math.min(...face.map(point=>point.y))
  let highest=-Infinity
  for(let row=north;row<=south;row+=step)for(let col=west;col<=east;col+=step)highest=Math.max(highest,ground(col,row))
  if(minimum>=highest+clearance)return [face]
  let pieces=[face]
  function partition(distance:(point:Vector3)=>number){
    pieces=pieces.flatMap(poly=>poly.some(point=>distance(point)>1e-8)&&poly.some(point=>distance(point)<-1e-8)?split(poly,distance):[poly])
  }
  for(let col=west+step;col<east;col+=step)partition(point=>point.x-col)
  for(let row=north+step;row<south;row+=step)partition(point=>point.z-row)
  for(let diag=west+north+step;diag<east+south;diag+=step)partition(point=>point.x+point.z-diag)
  const gap=(point:Vector3)=>point.y-ground(point.x,point.z)-clearance
  if(pieces.every(poly=>poly.every(point=>gap(point)>=0)))return [face]
  partition(gap)
  return pieces.map(poly=>poly.map(point=>gap(point)<0?new Vector3(point.x,ground(point.x,point.z)+clearance,point.z):point))
}
