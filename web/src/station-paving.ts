import * as THREE from 'three'

type Point=THREE.Vector3
type Cut=[number,number,number,number,number,number,number,boolean,[number,number][]?]

function split(poly:Point[],side:(p:Point)=>number):[Point[],Point[]]{
  const inside:Point[]=[],outside:Point[]=[]
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],da=side(a),db=side(b)
    ;(da>=0?inside:outside).push(a)
    if((da>=0)!==(db>=0)){
      const cut=a.clone().lerp(b,da/(da-db))
      inside.push(cut);outside.push(cut)
    }
  }
  return [inside,outside]
}

// Preserve the original triangles beyond every rebuilt strip. Covered bores
// also keep independently supported roads overhead.
export function stationPaving(cuts:Cut[]){
  const bins=new Map<string,Cut[]>()
  for(const cut of cuts){
    const [ax,az,bx,bz,w]=cut
    for(let i=Math.floor((Math.min(ax,bx)-w)/8);i<=Math.floor((Math.max(ax,bx)+w)/8);i++)
      for(let j=Math.floor((Math.min(az,bz)-w)/8);j<=Math.floor((Math.max(az,bz)+w)/8);j++){
        const key=i+','+j
        if(!bins.has(key))bins.set(key,[])
        bins.get(key)!.push(cut)
      }
  }
  return (a:Point,b:Point,c:Point)=>{
    const candidates=new Set<Cut>()
    for(const p of [a,b,c])for(const cut of bins.get(Math.floor(p.x/8)+','+Math.floor(p.z/8))??[])candidates.add(cut)
    let polygons=[[a,b,c]]
    for(const [ax,az,bx,bz,width,ay,by,open,footprint] of candidates){
      const len=Math.hypot(bx-ax,bz-az),dx=(bx-ax)/len,dz=(bz-az)/len
      const along=(p:Point)=>(p.x-ax)*dx+(p.z-az)*dz
      const side=(p:Point)=>(p.z-az)*dx-(p.x-ax)*dz
      const planes=[along,(p:Point)=>len-along(p),(p:Point)=>width+side(p),(p:Point)=>width-side(p)]
      if(footprint){
        const [[ax,az],[bx,bz],[cx,cz]]=footprint
        const sign=Math.sign((bx-ax)*(cz-az)-(bz-az)*(cx-ax))
        for(let i=0;i<3;i++){
          const [x,z]=footprint[i],[u,v]=footprint[(i+1)%3]
          planes.push((p:Point)=>sign*((u-x)*(p.z-z)-(v-z)*(p.x-x)))
        }
      }
      if(!open)planes.push((p:Point)=>ay+(by-ay)*along(p)/len+4.45-p.y)
      const remaining:Point[][]=[]
      for(const polygon of polygons){
        if(planes.some(plane=>polygon.every(p=>plane(p)<=0))){remaining.push(polygon);continue}
        const fragments:Point[][]=[]
        let part=polygon
        for(const plane of planes){
          const [inside,outside]=split(part,plane)
          if(outside.length>=3)fragments.push(outside)
          part=inside
          if(part.length<3)break
        }
        // Splitting against half-planes can subdivide a triangle far from
        // the actual cut. Keep it intact unless a positive area is removed.
        const area=part.reduce((sum,p,i)=>{
          const q=part[(i+1)%part.length]
          return sum+p.x*q.z-q.x*p.z
        },0)
        if(Math.abs(area)>1e-9)remaining.push(...fragments)
        else remaining.push(polygon)
      }
      polygons=remaining
    }
    return polygons
  }
}
export type {Cut as StationPavingCut}
