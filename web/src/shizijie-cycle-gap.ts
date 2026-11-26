import clip from 'polygon-clipping'
import {inRing} from './polygon'
import type {Streets} from './street-worker'

const west=17500, north=11000, east=19800, south=11900
const target=[19167,11337] as const

export function closeCycleGap(paths:Streets[0]):Streets[0]{
  const window: [number,number][][]=[[[west,north],[east,north],[east,south],[west,south]]]
  const paving=paths.filter(([kind])=>[0,1,4,5,6].includes(kind)).map(([, ...rings])=>rings)
  const gaps=clip.difference(window,...paving)
  for(const [shell,...holes] of gaps){
    if(holes.length || !inRing(...target,shell))continue
    if(shell.some(([x,z])=>x<=west || x>=east || z<=north || z>=south))continue
    const area=Math.abs(shell.slice(1).reduce((sum,[x,z],i)=>sum+shell[i][0]*z-shell[i][1]*x,0))/20000
    if(area<40 || area>46)continue
    return [...paths,[5,shell.slice(0,-1)]]
  }
  return paths
}
