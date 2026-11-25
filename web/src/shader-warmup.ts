import type {Camera,Object3D,Scene,WebGLRenderer} from 'three'

type Program=NonNullable<WebGLRenderer['info']['programs']>[number]
type Pending={resolve:()=>void,reject:(error:unknown)=>void,promise:Promise<void>}

function reflectionQueue(renderer:WebGLRenderer){
  const complete=new WeakSet<Program>(),pending=new Map<Program,Pending>()
  let scheduled=false
  function slice(){
    const deadline=performance.now()+8
    for(const [program,job] of pending){
      try{
        if(renderer.info.programs?.includes(program)){
          if(!(program as Program&{isReady():boolean}).isReady())continue
          program.getUniforms();program.getAttributes();complete.add(program)
        }
        job.resolve()
      }catch(error){job.reject(error)}
      pending.delete(program)
      if(performance.now()>=deadline)break
    }
    scheduled=pending.size>0
    if(scheduled)requestAnimationFrame(slice)
  }
  return (program:Program)=>{
    if(complete.has(program))return
    if(!pending.has(program)){
      let resolve!:()=>void,reject!:(error:unknown)=>void
      const promise=new Promise<void>((ok,fail)=>{resolve=ok;reject=fail})
      pending.set(program,{promise,resolve,reject})
      if(!scheduled){scheduled=true;requestAnimationFrame(slice)}
    }
    return pending.get(program)!.promise
  }
}
const queues=new WeakMap<WebGLRenderer,ReturnType<typeof reflectionQueue>>()
export async function warmShaders(renderer:WebGLRenderer,root:Object3D,camera:Camera,scene:Scene){
  renderer.compile(root,camera,scene)
  let enqueue=queues.get(renderer)
  if(!enqueue){enqueue=reflectionQueue(renderer);queues.set(renderer,enqueue)}
  const seen=new Set<Program>()
  do{
    const batch=(renderer.info.programs??[]).filter(program=>!seen.has(program))
    if(!batch.length)break
    for(const program of batch)seen.add(program)
    await Promise.all(batch.map(enqueue))
  }while(root===scene)
}
