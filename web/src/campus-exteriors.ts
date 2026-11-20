export interface CampusExterior {
  bounds:number[]; ring:number[][]; wall:number|null
}

export function campusAt(regions:CampusExterior[],x:number,z:number) {
  return regions.find(({bounds,ring})=>{
    if(x<bounds[0]||x>bounds[2]||z<bounds[1]||z>bounds[3])return false
    let inside=false, previous=ring[ring.length-1]
    for(const current of ring){
      if((current[1]>z)!==(previous[1]>z) && x<(previous[0]-current[0])*(z-current[1])/(previous[1]-current[1])+current[0])inside=!inside
      previous=current
    }
    return inside
  })
}
