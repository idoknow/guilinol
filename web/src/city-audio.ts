let shared:AudioContext|null=null
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

export async function prepareCityAudioDuringLoad(){
  if(existingCityAudio())return
  try{
    const Ctor=audioCtor()
    if(!Ctor)return
    const context=new Ctor()
    if(context.state==='running')await context.suspend()
    shared=context
  }catch{shared=null}
}
