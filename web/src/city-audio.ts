let shared:AudioContext|null=null
let pending:Promise<AudioContext|null>|undefined
let resuming:Promise<boolean>|undefined

export function audioCtor(){
  if(typeof window==='undefined')return null
  return window.AudioContext??(window as Window&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext??null
}

export function existingCityAudio(){return shared?.state==='closed'?null:shared}

export function resumeCityAudio(context:AudioContext){
  if(context.state==='running')return Promise.resolve(true)
  return resuming??=context.resume().then(()=>context.state==='running',()=>false).finally(()=>{resuming=undefined})
}

export function prepareCityAudio(){
  const current=existingCityAudio()
  if(current)return Promise.resolve(current)
  if(!pending)pending=new Promise<AudioContext|null>(resolve=>{
    const create=()=>{
      try{const Ctor=audioCtor();shared=Ctor?new Ctor():null}catch{shared=null}
      pending=undefined
      resolve(shared)
    }
    setTimeout(create,0)
  })
  return pending
}
