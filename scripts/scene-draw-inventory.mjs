// Called inside the benchmark page so object labels and GL counters cover the same frames.
export function installDrawInventory(){
  const {scene}=window.viewer.stream
  const hooked=new WeakSet(),textures=new Map(),geometries=new Map()
  let counts={}
  function hook(obj){
    if(!obj.isMesh||hooked.has(obj))return
    hooked.add(obj)
    const names=[]
    for(let parent=obj;parent;parent=parent.parent)if(parent.name)names.unshift(parent.name)
    const label=names.join('/')||obj.type
    const old=obj.onBeforeRender
    obj.onBeforeRender=function(renderer,scene,camera,geometry,material,...args){
      const pass=camera===window.viewer.camera?'main':'mirror'
      const key=pass+' '+label
      counts[key]=(counts[key]??0)+1
      geometries.set(geometry.uuid,label)
      const maps=Object.entries(material).filter(([,v])=>v?.isTexture)
      if(obj.skeleton?.boneTexture)maps.push(['skeleton',obj.skeleton.boneTexture])
      for(const [role,t] of maps)textures.set(t.uuid,[label,role,t.name||'',t.image?.currentSrc||t.image?.src||'',t.image?.width,t.image?.height])
      return old.call(this,renderer,scene,camera,geometry,material,...args)
    }
  }
  window.__drawInventory={
    start(){counts={};scene.traverse(hook)},
    frame(){return counts},
    resources(){return {textures:[...textures.values()],geometries:[...geometries.values()]}}
  }
}
