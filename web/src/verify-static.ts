import * as THREE from 'three'
import type {Host} from './play/host'
import type {Tile} from './world'

export async function makeStaticVerifier(host:Host){
  const file=(host.manifest.peaks as {autoCatalog?:string}).autoCatalog
  const rows:{name:string;target:number}[]=file?await fetch('./world/'+file).then(response=>response.json()):[]
  return staticVerifier(host,new Map(rows.map(row=>[row.name,row.target])))
}

export function staticVerifier(host:Host,summits:ReadonlyMap<string,number>=new Map()){
  const issues:{layer:string;owner:string;mesh:string;reason:string;box:number[][];limit:number[][]}[]=[]
  const seen=new Set<string>(), vertex=new THREE.Vector3()
  let samples=0
  function box(x:number,y:number,z:number,ex:number,ey:number,ez:number){return new THREE.Box3(new THREE.Vector3(x,y,z),new THREE.Vector3(ex,ey,ez))}
  const coords=(bounds:THREE.Box3)=>[bounds.min.toArray(),bounds.max.toArray()]
  function inspect(layer:string,owner:string,mesh:THREE.Mesh,actual:THREE.Box3,limit:THREE.Box3,reason='bounds'){
    if(reason==='bounds'&&limit.containsBox(actual))return
    const key=[layer,owner,mesh.name,reason].join('|');if(seen.has(key)||issues.length>=128)return
    seen.add(key);issues.push({layer,owner,mesh:mesh.name||mesh.type,reason,box:coords(actual),limit:coords(limit)})
  }
  function check(){
    samples++
    const tileLimits=new Map<Tile,THREE.Box3>()
    for(const [tile,item] of host.stream.loaded){
      const limit=box(tile.x-12,item.batch.minY-32,tile.z-12,tile.x+268,item.batch.maxY+32,tile.z+268)
      tileLimits.set(tile,limit)
      item.group.traverse(node=>{if(node instanceof THREE.Mesh)inspect('terrain',tile.file,node,new THREE.Box3().setFromObject(node),limit)})
    }
    for(const [entry,root] of host.stream.landmarks){
      const [x,y,z,radius]=entry.sphere,center=new THREE.Vector3(x,y,z).applyAxisAngle(new THREE.Vector3(0,1,0),entry.rotation*Math.PI/180).add(new THREE.Vector3(...entry.position))
      const limit=new THREE.Box3(center.clone(),center.clone()).expandByScalar(radius+3)
      root.traverse(node=>{if(node instanceof THREE.Mesh){const bounds=new THREE.Box3().setFromObject(node);if(!limit.containsBox(bounds))inspect('landmark',entry.id,node,new THREE.Box3().setFromObject(node,true),limit)}})
    }
    host.scene.traverse(node=>{
      if(!(node instanceof THREE.Mesh))return
      const geometry=node.geometry,pos=geometry.getAttribute('position');if(!pos)return
      const ranges:{end:number;limit:THREE.Box3;owner:string}[]=[]
      const slices=node.userData.tileSlices?.() as {tile:Tile;vertexStart:number}[]|undefined
      if(slices)for(const [index,slice] of slices.entries()){
        const limit=tileLimits.get(slice.tile);if(!limit)return
        ranges.push({end:slices[index+1]?.vertexStart??pos.count,limit,owner:slice.tile.file})
      }
      const peaks=node.userData.peakRanges?.();if(peaks)for(const [index,peak] of peaks.peaks.entries()){
        const [x,y,z]=peak.center;ranges.push({end:peaks.ends[index],limit:box(x-328,y-328,z-328,x+328,(summits.get(peak.name)??y)+6,z+328),owner:peak.name})
      }
      if(!ranges.length)return
      let start=0
      const owners=new Uint16Array(pos.count)
      for(const [index,range] of ranges.entries()){
        const bounds=new THREE.Box3();owners.fill(index,start,range.end)
        for(let i=start;i<range.end;i++)bounds.expandByPoint(vertex.fromBufferAttribute(pos,i))
        if(range.end>start)inspect(peaks?'peak':'batch',range.owner,node,bounds.applyMatrix4(node.matrixWorld),range.limit)
        start=range.end
      }
      const indices=geometry.index;if(!indices)return
      const end=Math.min(indices.count,geometry.drawRange.start+geometry.drawRange.count)
      for(let i=geometry.drawRange.start;i<end;i+=3){
        const a=indices.getX(i),b=indices.getX(i+1),c=indices.getX(i+2)
        if(a<pos.count&&b<pos.count&&c<pos.count&&owners[a]===owners[b]&&owners[b]===owners[c])continue
        const range=ranges[owners[a]??0],actual=new THREE.Box3()
        for(const idx of [a,b,c])actual.expandByPoint(vertex.fromBufferAttribute(pos,idx).applyMatrix4(node.matrixWorld))
        inspect('indices',range.owner,node,actual,range.limit,'triangle crosses owner or buffer');break
      }
    })
    return {samples,issues}
  }
  return {check,issues,get samples(){return samples}}
}
