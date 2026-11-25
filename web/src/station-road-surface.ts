// Positions are tile-local metres. Null levels mark protected main pavement.
export type StationRoadSegment=[number,number,number,number,number,number|null,number|null,number?]

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
  const nearby=(x:number,z:number)=>bins.get(Math.floor(x/8)+128*Math.floor(z/8))??[]
  const protectedAt=(x:number,z:number)=>nearby(x,z).some(([ax,az,bx,bz,width,level])=>{
    if(level!==null)return false
    const dx=bx-ax,dz=bz-az
    const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)))
    return Math.hypot(x-ax-t*dx,z-az-t*dz)<=width+.02
  })
  const height=(x:number,z:number,base:number)=>{
    let grades:Map<number,{distance:number,level:number,width:number}>|undefined
    let closest=Infinity,y=base,blend=0,protection=1,precise=false,paved=false
    for(const [ax,az,bx,bz,width,ay,by,graded] of nearby(x,z)){
      const dx=bx-ax,dz=bz-az
      const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)))
      const distance=Math.hypot(x-ax-t*dx,z-az-t*dz)
      if(ay===null || by===null){paved ||= distance<=width+.02;protection=Math.min(protection,Math.max(0,(distance-width-4.1)/4));continue}
      if(graded && distance<width){
        grades??=new Map()
        if(distance<(grades.get(graded)?.distance??Infinity))grades.set(graded,{distance,level:ay+t*(by-ay),width})
      }
      if(distance>=closest||distance>=width)continue
      closest=distance
      precise=!!graded
      y=ay+t*(by-ay)
      blend=Math.min(1,(width-distance)/4)
    }
    // At an at-grade fork, blend both carriageways across their shared
    // shoulder before returning to the independent longitudinal profiles.
    if(precise && grades && grades.size>1)for(const grade of grades.values()){
      const weight=Math.min(1,(grade.width-grade.distance)/3)
      y=Math.min(y,y+(grade.level-y)*weight)
    }
    if(precise)y=Math.min(y,base)
    return base+(y-base)*blend*(precise ? Number(!paved) : protection)
  }
  return {height,protectedAt}
}
