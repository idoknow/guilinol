import {inRing} from '../polygon'
import districts from './car-free-polygons.json'
import carriageways from './jiefang-junction.json'
import {getQuietZoneAt} from './quiet-zones'


export function getCarFreeAt(x:number,z:number){
  for(const zone of districts){
    const [left,top,right,bottom]=zone.bbox
    if(x<left||x>right||z<top||z>bottom)continue
    if(inRing(x,z,zone.rings[0])&&!zone.rings.some((ring,index)=>index>0&&inRing(x,z,ring)))return zone.name
  }
  return undefined
}

export function vehicleForbiddenAt(x:number,z:number){return !!(getCarFreeAt(x,z)||getQuietZoneAt(x,z))}

export function onJiefangJunction(x:number,z:number){
  return carriageways.some(({bbox:[left,top,right,bottom],ring})=>
    x>=left && x<=right && z>=top && z<=bottom && inRing(x,z,ring))
}
