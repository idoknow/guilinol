import {Vector3} from 'three'
import {split} from './station-paving.ts'

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

export interface DividerSpanGrade {
  midX: number
  midZ: number
  midY: number
  lowY: number
  highY: number
  flatLength: number
  slopeLength: number
  yaw: number
  pitch: number
  /** Extra skirt depth needed below the mid-span so neither end floats above sloped or crowned roadbeds. */
  embedDepth: number
}

/**
 * Samples roadbed elevation along a road divider leg [start -> end] to keep curbs, planter walls,
 * and guardrail plinths grounded on graded carriageways & bridge approaches without floating or sinking.
 */
export function sampleDividerSpanGrade(
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  baseLevel: (x: number, z: number) => number,
  roadLift = 0.045,
): DividerSpanGrade {
  const dx = endX - startX
  const dz = endZ - startZ
  const flatLength = Math.hypot(dx, dz)
  const midX = (startX + endX) * 0.5
  const midZ = (startZ + endZ) * 0.5
  const yStart = baseLevel(startX, startZ) + roadLift
  const yEnd = baseLevel(endX, endZ) + roadLift
  const yMidSample = baseLevel(midX, midZ) + roadLift
  const yLinear = (yStart + yEnd) * 0.5
  const lowY = Math.min(yStart, yEnd, yMidSample)
  const highY = Math.max(yStart, yEnd, yMidSample)
  const yaw = -Math.atan2(dz, dx)
  const pitch = flatLength > 1e-4 ? Math.atan2(yEnd - yStart, flatLength) : 0
  const slopeLength = Math.hypot(flatLength, yEnd - yStart)
  const sag = Math.max(0, yLinear - yMidSample)
  return {
    midX,
    midZ,
    midY: yLinear,
    lowY,
    highY,
    flatLength,
    slopeLength,
    yaw,
    pitch,
    embedDepth: Math.min(0.28, 0.05 + sag + Math.abs(yEnd - yStart) * 0.12),
  }
}
