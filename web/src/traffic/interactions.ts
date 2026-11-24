import {Raycaster,Vector3,type Camera,type Scene} from 'three'
import {npcDefaults} from '../../../lib/npc'
import {rideSoundMuted,RIDE_SOUND_EVENT,masterVolume,VOLUME_EVENT} from '../walk/ride-sound-pref'
import type {Traffic} from './sim'
import './interactions.css'

type Actor=Traffic['actors'][number]
type State={id:number,next:number,lastBump:number}
export function interactions(scene:Scene,camera:Camera,rules:typeof npcDefaults){
  let audio:AudioContext|undefined,activeHorns=0,sequence=0,previous:Vector3|undefined,said:SpeechSynthesisUtterance|undefined
  const states=new WeakMap<Actor,State>(),bubbles=new Map<Actor,{element:HTMLElement,until:number,checkAt:number,occluded:boolean}>()
  const hotspot=new Vector3(),direction=new Vector3(),ray=new Raycaster()
  const interval=(walk:boolean)=>walk?15+Math.random()*30:10+Math.random()*20
  const pick=(lines:string[])=>lines[Math.floor(Math.random()*lines.length)]
  let output:GainNode|undefined,level=masterVolume(),muted=rideSoundMuted()
  function unlock(){if(!muted&&level>0){audio??=new AudioContext();if(!output){output=audio.createGain();output.gain.value=level;output.connect(audio.destination)}void audio.resume().catch(()=>{})}}
  window.addEventListener('pointerdown',unlock,{passive:true});window.addEventListener('keydown',unlock)
  function sync(){level=masterVolume();muted=rideSoundMuted();if(output)output.gain.value=muted?0:level;if(said)window.speechSynthesis?.cancel();if(!muted&&level>0&&audio?.state==='suspended')void audio.resume().catch(()=>{})}
  window.addEventListener(RIDE_SOUND_EVENT,sync);window.addEventListener(VOLUME_EVENT,sync)
  // 鸣笛：汽车是两个方波叠成的双音喇叭（约小三度），电驴是高一些的「嘀嘀」两声；每个车型音高略有不同
  function horn(actor:Actor,geometry:number){
    if(!audio||!output||audio.state!=='running'||activeHorns>=2)return
    const ctx=audio,now=ctx.currentTime,scooter=actor.kind==='scooter'
    const pan=ctx.createPanner(),tone=ctx.createBiquadFilter(),gain=ctx.createGain()
    pan.panningModel='HRTF';pan.distanceModel='inverse';pan.refDistance=8;pan.maxDistance=120;pan.rolloffFactor=1.2
    hotspot.set(actor.x,actor.y+1,actor.z);camera.worldToLocal(hotspot);pan.positionX.value=hotspot.x;pan.positionY.value=hotspot.y;pan.positionZ.value=hotspot.z
    tone.type='lowpass';tone.frequency.value=scooter?3200:2200;tone.Q.value=.8
    const base=(scooter?820:380)*(1+((geometry*37)%9-4)*.025),peak=.16*rules.volume
    const toots:[number,number][]=scooter?[[0,.11],[.17,.11]]:Math.random()<.35?[[0,.13],[.2,.42]]:[[0,.5]]
    gain.gain.setValueAtTime(0,now)
    for(const [at,length] of toots){
      gain.gain.setValueAtTime(0,now+at);gain.gain.linearRampToValueAtTime(peak,now+at+.012)
      gain.gain.setValueAtTime(peak,now+at+length-.03);gain.gain.linearRampToValueAtTime(0,now+at+length)
    }
    const end=now+toots.at(-1)![0]+toots.at(-1)![1]+.02
    const oscillators=(scooter?[1]:[1,1.19]).map(ratio=>{const osc=ctx.createOscillator();osc.type=scooter?'square':'sawtooth';osc.frequency.value=base*ratio;osc.connect(tone);osc.start(now);osc.stop(end);return osc})
    tone.connect(gain).connect(pan).connect(output);activeHorns++
    oscillators[0].onended=()=>{activeHorns--;for(const osc of oscillators)osc.disconnect();tone.disconnect();gain.disconnect();pan.disconnect()}
  }
  function clear(){previous=undefined;for(const {element} of bubbles.values())element.remove();bubbles.clear();if(said)window.speechSynthesis.cancel()}
  function tick(actors:Actor[],time:number,dt:number,player:Vector3|undefined,vehicle:boolean,geometry:(actor:Actor)=>number){
    const listener=player??camera.position,dx=player&&previous?(player.x-previous.x)/dt:0,dz=player&&previous?(player.z-previous.z)/dt:0
    const audible=rules.volume>0&&level>0&&!muted
    for(const actor of actors){
      const walk=actor.kind==='person',state=states.get(actor)??{id:++sequence,next:time+interval(walk),lastBump:-Infinity};states.set(actor,state)
      const distance=Math.hypot(actor.x-listener.x,actor.z-listener.z,actor.y-listener.y)
      if(time>=state.next){
        state.next=time+interval(walk)
        if(audible&&!walk&&rules.horn&&distance<120)horn(actor,geometry(actor))
        const speech=window.speechSynthesis
        if(audible&&walk&&rules.mutter&&distance<25&&speech&&!speech.speaking&&!speech.pending&&!said){
          const voice=speech.getVoices().find(item=>/^zh(?:[-_]|$)/i.test(item.lang))
          if(voice){const line=new SpeechSynthesisUtterance(pick(rules.mutterLines));line.lang='zh-CN';line.voice=voice;line.volume=level*rules.volume*(1-distance/25);said=line
            line.onend=line.onerror=()=>{if(said===line)said=undefined};speech.speak(line);setTimeout(()=>{if(said===line){speech.cancel();said=undefined}},3000)}
        }
      }
      if(walk&&rules.bubble&&player&&previous&&time-state.lastBump>=6&&Math.abs(player.y-actor.y)<2.5&&Math.hypot(player.x-actor.x,player.z-actor.z)<(vehicle?1.4:.65)&&Math.hypot(dx-actor.speed*actor.track.dx,dz-actor.speed*actor.track.dz)>=rules.bumpSpeed){
        state.lastBump=time;const line=pick(rules.bumpLines),element=document.createElement('div'),text=document.createElement('span')
        bubbles.get(actor)?.element.remove();element.className='npc-bubble';element.setAttribute('role','status');text.className='npc-bubble__text';text.textContent=line;element.append(text);document.body.append(element);bubbles.set(actor,{element,until:time+rules.bubbleSeconds,checkAt:-Infinity,occluded:false})
        window.dispatchEvent(new CustomEvent('crowd:bump',{detail:{actorId:state.id,x:actor.x,y:actor.y,z:actor.z,line}}))
      }
    }
    previous=player?.clone()
    for(const [actor,bubble] of bubbles){
      const {element,until}=bubble
      if(time>=until||!actors.includes(actor)){element.remove();bubbles.delete(actor);continue}
      element.classList.toggle('is-leaving',until-time<.26)
      hotspot.set(actor.x,actor.y+1.95,actor.z)
      // 遮挡检测要对整个场景做射线，开销大：每个气泡每 0.2 s 查一次，其余帧沿用上次结果
      if(time>=bubble.checkAt){
        bubble.checkAt=time+.2
        direction.copy(hotspot).sub(camera.position);ray.set(camera.position,direction.clone().normalize());ray.far=Math.max(0,direction.length()-.5)
        bubble.occluded=ray.intersectObjects(scene.children,true).some(hit=>{
          for(let object:typeof hit.object|null=hit.object;object;object=object.parent)if(!object.visible)return false
          return true
        })
      }
      hotspot.project(camera);element.hidden=bubble.occluded||Math.abs(hotspot.x)>1||Math.abs(hotspot.y)>1||Math.abs(hotspot.z)>1
      element.style.left=`${(1+hotspot.x)*50}vw`;element.style.top=`${(1-hotspot.y)*50}vh`
    }
  }
  return {tick,clear}
}
