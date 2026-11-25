import * as T from 'three'

// Restrict the first-person mesh to the original arms and their garment vertices.
// The source mesh, skeleton, UVs, material groups and clothing shader stay in use.
function forearms(mesh:T.SkinnedMesh){
  const source=mesh.geometry,skin=source.getAttribute('skinIndex'),weights=source.getAttribute('skinWeight')
  if(!skin||!weights)return
  const arm=mesh.skeleton.bones.map(b=>/^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_/.test(b.name))
  const rest=source.getAttribute('position')
  const keep=Array.from({length:skin.count},(_,i)=>{
    if(Math.abs(rest.getX(i))>.25 && rest.getY(i)>1.25)return true
    for(let j=0;j<4;j++)if(arm[skin.getComponent(i,j)]&&weights.getComponent(i,j)>.2)return true
    return false
  })
  const index=source.index,count=index?.count??skin.count
  const subset=new T.BufferGeometry(),indices:number[]=[]
  for(const [name,attribute] of Object.entries(source.attributes))subset.setAttribute(name,attribute)
  for(const group of source.groups.length?source.groups:[{start:0,count,materialIndex:0}]){
    const start=indices.length
    for(let i=group.start;i<Math.min(count,group.start+group.count);i+=3){
      const a=index?.getX(i)??i,b=index?.getX(i+1)??i+1,c=index?.getX(i+2)??i+2
      if(keep[a]||keep[b]||keep[c])indices.push(a,b,c)
    }
    subset.addGroup(start,indices.length-start,group.materialIndex)
  }
  subset.setIndex(indices)
  return subset
}
export function firstPersonArms(figure:T.Object3D,props:T.Object3D){
  const cache=new Map<T.BufferGeometry,T.BufferGeometry>()
  const restore:(()=>void)[]=[]
  function show(on:boolean){
    if(on===Boolean(restore.length))return
    if(!on){while(restore.length)restore.pop()!();return}
    figure.traverse(node=>{
      if(!(node instanceof T.Mesh))return
      for(let ancestor=node.parent;ancestor;ancestor=ancestor.parent)if(ancestor===props)return
      if(node instanceof T.SkinnedMesh && node.name!=='creator-body-outline'){
        const original=node.geometry,subset=cache.get(original)??forearms(node)
        if(subset){
          cache.set(original,subset);node.geometry=subset
          restore.push(()=>{node.geometry=original})
          return
        }
      }
      const mask=node.layers.mask
      node.layers.mask=0
      restore.push(()=>{node.layers.mask=mask})
    })
  }
  return {show,dispose(){
    show(false)
    for(const subset of cache.values()){
      for(const name of Object.keys(subset.attributes))subset.deleteAttribute(name)
      subset.dispose()
    }
    cache.clear()
  }}
}
