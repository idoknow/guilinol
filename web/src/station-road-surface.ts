// Positions are tile-local metres. Null levels mark protected main pavement.
export type StationRoadSegment=[number,number,number,number,number,number|null,number|null]

export function stationRoadSurface(segments:StationRoadSegment[]){
  const bins=new Map<number,StationRoadSegment[]>()
  for(const segment of segments){
    const [ax,az,bx,bz,width]=segment
    for(let ix=Math.floor((Math.min(ax,bx)-width-4)/8);ix<=Math.floor((Math.max(ax,bx)+width+4)/8);ix++)
      for(let iz=Math.floor((Math.min(az,bz)-width-4)/8);iz<=Math.floor((Math.max(az,bz)+width+4)/8);iz++){
        const key=ix+iz*128
        if(!bins.has(key))bins.set(key,[])
        bins.get(key)!.push(segment)
      }
  }
  return (x:number,z:number,base:number)=>{
    let closest=Infinity,y=base,blend=0,protection=1
    for(const [ax,az,bx,bz,width,ay,by] of bins.get(Math.floor(x/8)+128*Math.floor(z/8))??[]){
      const dx=bx-ax,dz=bz-az
      const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)))
      const distance=Math.hypot(x-ax-t*dx,z-az-t*dz)
      if(ay===null || by===null){protection=Math.min(protection,Math.max(0,(distance-width-4.1)/4));continue}
      if(distance>=closest||distance>=width+4)continue
      closest=distance
      y=ay+t*(by-ay)
      blend=Math.min(1,(width+4-distance)/4)
    }
    return base+(y-base)*blend*protection
  }
}
