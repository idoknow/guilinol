import shores from './shores.json' with {type:'json'}

export function nearestFishingShore(x:number,z:number){
  let water=shores[0],shore=water.banks[0],best=Infinity
  for(const zone of shores){
    if(Math.hypot(zone.spot.x-x,zone.spot.z-z)>best+121)continue
    for(const bank of zone.banks){
      const distance=Math.hypot(bank.x-x,bank.z-z)
      if(distance<best){best=distance;shore=bank;water=zone}
    }
  }
  return {id:water.id,shore,distance:best,inZone:best<=water.radius}
}
