import type {PerspectiveCamera} from 'three'
import type {Manifest} from '../world'
import type {skyClock} from './sky'
import {loadAtlas} from '../map/atlas'
import {mapPaper} from '../map/paper'
import {explore,type Site} from '../map/explore'
import views from '../../../pipeline/viewpoints.json'
import {photo} from './photo'
import './tour.css'

export async function tour(manifest:Manifest,camera:PerspectiveCamera,canvas:HTMLCanvasElement,clock:ReturnType<typeof skyClock>,hero:()=>{x:number;z:number}|undefined,travel:(site:Site)=>Promise<void>,photoWalk:(on:boolean)=>void,render:()=>void){
  const atlas=await loadAtlas(manifest),paper=mapPaper(atlas),here=()=>hero()??camera.position
  let seen=new Set<string>();try{seen=new Set(JSON.parse(localStorage.getItem('guilin.discoveries')??'[]'))}catch{}
  const hud=document.createElement('section');hud.className='tour-hud';hud.innerHTML=`<span class="road-name"></span><div class="mini-tools"><button class="mini" aria-label="打开地图"><canvas width="180" height="180"></canvas></button><div><button aria-label="切换地图朝向">随行</button><button>拍照</button></div></div><article hidden><strong></strong><p></p><span></span><button>拍一张</button></article>`;document.body.append(hud)
  const [mini,orient,shoot,cardShoot]=hud.querySelectorAll('button'),ctx=mini.querySelector('canvas')!.getContext('2d')!,card=hud.querySelector('article')!,road=hud.querySelector<HTMLElement>('.road-name')!
  let north=false,active='',busy=false,last= -Infinity,prevRoad='',timer=0,currentView='',prevMini='',firstOpenMs=0,samples=0,cost=0
  const map=explore(atlas,paper,seen,here,async site=>{if(busy)return;busy=true;document.body.classList.add('tour-ink');try{await new Promise(resolve=>setTimeout(resolve,200));await travel(site);close()}finally{document.body.classList.remove('tour-ink');busy=false}},close)
  const photoBar=photo(canvas,clock,render,close),savedCamera=camera.clone()
  function close(){if(active==='photo'){photoBar.close();photoWalk(false);if(!hero()){camera.position.copy(savedCamera.position);camera.quaternion.copy(savedCamera.quaternion)}}map.panel.hidden=true;active='';delete document.body.dataset.tour}
  function open(mode:string){if(busy||active)return;document.exitPointerLock?.();active=mode;document.body.dataset.tour=mode
    if(mode==='map'){const start=performance.now();map.open();if(!firstOpenMs)firstOpenMs=performance.now()-start}else{savedCamera.copy(camera);photoWalk(true);photoBar.open()}}
  mini.onclick=()=>open('map');orient.onclick=()=>{north=!north;orient.textContent=north?'朝北':'随行'};shoot.onclick=cardShoot.onclick=()=>open('photo')
  window.addEventListener('keydown',event=>{if(event.repeat)return;if(active&&event.code==='Escape'){if(!busy)close();event.stopImmediatePropagation();return}if(event.target instanceof HTMLInputElement&&event.code!=='Escape')return
    const mode=event.code==='KeyM'?'map':event.code==='KeyP'?'photo':'';if(mode){event.preventDefault();if(active===mode&&!busy)close();else open(mode)}},true)
  return {get mode(){return active},metrics(){return {firstOpenMs,miniMeanMs:cost/Math.max(1,samples),samples}},tick(now:number){if(active||now-last<80)return;last=now;const pos=here(),angle=camera.rotation.y
    const name=atlas.roadAt(pos.x,pos.z)?.name??'';if(name!==prevRoad){prevRoad=name;clearTimeout(timer);road.classList.remove('visible');timer=window.setTimeout(()=>{road.textContent=name;road.classList.toggle('visible',!!name)},250)}
    const view=hero()&&views.find(site=>Math.hypot(site.x-pos.x,site.z-pos.z)<=site.radius);if(currentView!==(view?.n??'')){currentView=view?.n??'';card.hidden=!view;if(view){card.querySelector('strong')!.textContent=view.n;card.querySelector('p')!.textContent=view.text;card.querySelector('span')!.textContent=`已发现 · 最佳：${view.best}`;seen.add(view.n);try{localStorage.setItem('guilin.discoveries',JSON.stringify([...seen]))}catch{}}}
    const key=`${Math.round(pos.x)},${Math.round(pos.z)},${angle.toFixed(2)},${north}`;if(key===prevMini)return;prevMini=key;const start=performance.now();ctx.fillStyle='#cad2be';ctx.fillRect(0,0,180,180);ctx.save();ctx.translate(90,90);if(!north)ctx.rotate(angle);ctx.scale(.45,.45);ctx.translate(-pos.x,-pos.z);paper(ctx);ctx.restore();ctx.save();ctx.translate(90,90);if(north)ctx.rotate(-angle);ctx.fillStyle='#c4553a';ctx.beginPath();ctx.moveTo(0,-11);ctx.lineTo(7,8);ctx.lineTo(0,5);ctx.lineTo(-7,8);ctx.closePath();ctx.fill();ctx.restore();samples++;cost+=performance.now()-start}}
}
