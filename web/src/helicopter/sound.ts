import {masterVolume,rideSoundMuted} from '../walk/ride-sound-pref'

export function rotorSound(){
  let ctx:AudioContext|undefined,source:AudioBufferSourceNode|undefined,filter:BiquadFilterNode|undefined,gain:GainNode|undefined
  function unlock(){
    if(!window.AudioContext)return
    ctx??=new AudioContext();void ctx.resume().catch(()=>{})
  }
  function stop(){source?.stop();source?.disconnect();filter?.disconnect();gain?.disconnect();source=undefined}
  return {unlock,update(rpm:number,inside:boolean,distance:number){
    if(!ctx||ctx.state!=='running')return
    if(rpm<.01||rideSoundMuted()||distance>120){if(source)stop();return}
    if(!source){
      const length=Math.round(ctx.sampleRate),buffer=ctx.createBuffer(1,length,ctx.sampleRate),data=buffer.getChannelData(0)
      let seed=137
      for(let index=0;index<length;index++){
        seed=(Math.imul(seed,1664525)+1013904223)>>>0
        const cycles=index/length*26,pulse=Math.exp(-8*(cycles%1))
        data[index]=.42*Math.sin(2*Math.PI*cycles)+pulse*(seed/2147483648-1)*.58
      }
      source=ctx.createBufferSource();source.buffer=buffer;source.loop=true;filter=ctx.createBiquadFilter();filter.type='lowpass';gain=ctx.createGain();gain.gain.value=0
      source.connect(filter).connect(gain).connect(ctx.destination);source.start()
    }
    source.playbackRate.setTargetAtTime(.12+.88*rpm,ctx.currentTime,.04)
    filter!.frequency.setTargetAtTime(inside?440:1800,ctx.currentTime,.08)
    gain!.gain.setTargetAtTime(masterVolume()*rpm*(inside?.35:.22)/(1+distance*.04),ctx.currentTime,.08)
  }}
}
