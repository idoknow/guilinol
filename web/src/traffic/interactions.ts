import {Raycaster,Vector3,type Camera,type Scene} from 'three'
import {npcDefaults} from '../../../lib/npc'
import {rideSoundMuted,RIDE_SOUND_EVENT} from '../walk/ride-sound-pref'
import type {Traffic} from './sim'

type Actor=Traffic['actors'][number]
type State={id:number,next:number,lastBump:number}
export function interactions(scene:Scene,camera:Camera,rules:typeof npcDefaults){
  let audio:AudioContext|undefined,activeHorns=0,sequence=0,previous:Vector3|undefined,said:SpeechSynthesisUtterance|undefined
  const states=new WeakMap<Actor,State>(),bubbles=new Map<Actor,{element:HTMLElement,until:number}>()
  const hotspot=new Vector3(),direction=new Vector3(),ray=new Raycaster()
  const interval=(walk:boolean)=>walk?15+Math.random()*30:10+Math.random()*20
  const pick=(lines:string[])=>lines[Math.floor(Math.random()*lines.length)]
  function unlock(){if(!rideSoundMuted()){audio??=new AudioContext();void audio.resume().catch(()=>{})}}
  window.addEventListener('pointerdown',unlock,{passive:true})
  window.addEventListener(RIDE_SOUND_EVENT,()=>{if(rideSoundMuted()){void audio?.suspend();if(said)window.speechSynthesis?.cancel()}})
  function horn(actor:Actor,geometry:number){
    if(!audio||audio.state!=='running'||activeHorns>=2)return
    const ctx=audio,osc=ctx.createOscillator(),gain=ctx.createGain(),pan=ctx.createPanner()
    pan.distanceModel='inverse';pan.refDistance=8;pan.maxDistance=120
    hotspot.set(actor.x,actor.y,actor.z);camera.worldToLocal(hotspot);pan.setPosition(hotspot.x,hotspot.y,hotspot.z)
    osc.type=actor.kind==='scooter'?'sine':'triangle';osc.frequency.value=(actor.kind==='scooter'?500:210)+geometry*13
    gain.gain.setValueAtTime(.18*rules.volume,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.38)
    osc.connect(gain).connect(pan).connect(ctx.destination);activeHorns++
    osc.onended=()=>{activeHorns--;osc.disconnect();gain.disconnect();pan.disconnect()};osc.start();osc.stop(ctx.currentTime+.4)
  }
  function clear(){previous=undefined;for(const {element} of bubbles.values())element.remove();bubbles.clear();if(said)window.speechSynthesis.cancel()}
  function tick(actors:Actor[],time:number,dt:number,player:Vector3|undefined,vehicle:boolean,geometry:(actor:Actor)=>number){
    const listener=player??camera.position,dx=player&&previous?(player.x-previous.x)/dt:0,dz=player&&previous?(player.z-previous.z)/dt:0
    const audible=rules.volume>0&&!rideSoundMuted()
    for(const actor of actors){
      const walk=actor.kind==='person',state=states.get(actor)??{id:++sequence,next:time+interval(walk),lastBump:-Infinity};states.set(actor,state)
      const distance=Math.hypot(actor.x-listener.x,actor.z-listener.z,actor.y-listener.y)
      if(time>=state.next){
        state.next=time+interval(walk)
        if(audible&&!walk&&rules.horn&&distance<120)horn(actor,geometry(actor))
        const speech=window.speechSynthesis
        if(audible&&walk&&rules.mutter&&distance<25&&speech&&!speech.speaking&&!speech.pending&&!said){
          const voice=speech.getVoices().find(item=>/^zh(?:[-_]|$)/i.test(item.lang))
          if(voice){const line=new SpeechSynthesisUtterance(pick(rules.mutterLines));line.lang='zh-CN';line.voice=voice;line.volume=rules.volume*(1-distance/25);said=line
            line.onend=line.onerror=()=>{if(said===line)said=undefined};speech.speak(line);setTimeout(()=>{if(said===line){speech.cancel();said=undefined}},3000)}
        }
      }
      if(walk&&rules.bubble&&player&&previous&&time-state.lastBump>=6&&Math.abs(player.y-actor.y)<2.5&&Math.hypot(player.x-actor.x,player.z-actor.z)<(vehicle?1.4:.65)&&Math.hypot(dx-actor.speed*actor.track.dx,dz-actor.speed*actor.track.dz)>=rules.bumpSpeed){
        state.lastBump=time;const line=pick(rules.bumpLines),element=document.createElement('div'),text=document.createElement('span')
        bubbles.get(actor)?.element.remove();element.className='npc-bubble';text.className='npc-bubble__text';text.textContent=line;element.append(text);element.style.cssText='position:fixed;pointer-events:none;transform:translate(-50%,-100%)';document.body.append(element);bubbles.set(actor,{element,until:time+rules.bubbleSeconds})
        window.dispatchEvent(new CustomEvent('crowd:bump',{detail:{actorId:state.id,x:actor.x,y:actor.y,z:actor.z,line}}))
      }
    }
    previous=player?.clone()
    for(const [actor,{element,until}] of bubbles){
      if(time>=until||!actors.includes(actor)){element.remove();bubbles.delete(actor);continue}
      hotspot.set(actor.x,actor.y+1.95,actor.z);direction.copy(hotspot).sub(camera.position);ray.set(camera.position,direction.clone().normalize());ray.far=Math.max(0,direction.length()-.5)
      hotspot.project(camera);element.hidden=Math.abs(hotspot.x)>1||Math.abs(hotspot.y)>1||Math.abs(hotspot.z)>1||ray.intersectObjects(scene.children,true).some(hit=>{
        for(let object:typeof hit.object|null=hit.object;object;object=object.parent)if(!object.visible)return false
        return true
      })
      element.style.left=`${(1+hotspot.x)*50}vw`;element.style.top=`${(1-hotspot.y)*50}vh`
    }
  }
  return {tick,clear}
}
