import type {Atlas} from './atlas'
import views from '../../../pipeline/viewpoints.json'
import type {mapPaper} from './paper'

export type Site={n:string;x:number;z:number;yaw?:number}
export function explore(atlas:Atlas,paper:ReturnType<typeof mapPaper>,seen:Set<string>,here:()=>{x:number;z:number},go:(site:Site)=>void,close:()=>void){
  const panel=document.createElement('section');panel.className='tour-map';panel.hidden=true
  panel.innerHTML=`<canvas aria-label="桂林地图"></canvas><header><input type="search" placeholder="搜索地点" aria-label="搜索地点"><button>返回</button></header><div class="tour-results"></div><aside></aside><div class="tour-destination" hidden><strong></strong><button>前往</button></div>`
  document.body.append(panel)
  const canvas=panel.querySelector('canvas')!,ctx=canvas.getContext('2d')!,search=panel.querySelector('input')!,results=panel.querySelector('.tour-results')!,counter=panel.querySelector('aside')!,dest=panel.querySelector<HTMLElement>('.tour-destination')!
  let centerX=0,centerZ=0,scale=.35,selected:Site|undefined
  function draw(){canvas.width=innerWidth;canvas.height=innerHeight;ctx.fillStyle='#cad2be';ctx.fillRect(0,0,canvas.width,canvas.height)
    const ox=innerWidth/2-centerX*scale,oz=innerHeight/2-centerZ*scale
    ctx.save();ctx.translate(ox,oz);ctx.scale(scale,scale);paper(ctx);ctx.restore()
    ctx.font='14px "Noto Serif SC",serif';ctx.lineWidth=3;ctx.strokeStyle='#f4efe2';const occupied=new Set<string>()
    function label(site:Site,marker:string){const px=site.x*scale+ox,py=site.z*scale+oz;if(px< -90||px>innerWidth||py<0||py>innerHeight)return
      const slot=`${Math.floor(px/88)},${Math.floor(py/22)}`;if(!marker&&occupied.has(slot))return;occupied.add(slot)
      ctx.fillStyle='#1c2c2a';ctx.strokeText(marker+site.n,px,py);ctx.fillText(marker+site.n,px,py)}
    for(const view of views)label(view,seen.has(view.n)?'◆ ':'◇ ')
    if(scale>.25)for(const place of atlas.places)if((scale>1||place.k!=='road')&&!views.some(view=>view.n.includes(place.n)))label(place,'')
    const pos=here();ctx.fillStyle='#c4553a';ctx.beginPath();ctx.arc(pos.x*scale+ox,pos.z*scale+oz,5,0,Math.PI*2);ctx.fill()
    if(selected){ctx.strokeStyle='#c4553a';ctx.beginPath();ctx.arc(selected.x*scale+ox,selected.z*scale+oz,10,0,Math.PI*2);ctx.stroke()}}
  function choose(site:Site){selected=site;centerX=site.x;centerZ=site.z;scale=Math.max(scale,.7);dest.hidden=false;dest.querySelector('strong')!.textContent=site.n;results.replaceChildren();search.blur();draw()}
  search.oninput=()=>{results.replaceChildren();dest.hidden=true;selected=undefined;const query=search.value.trim();if(!query)return
    const sites=[...views.filter(view=>view.n.includes(query)),...atlas.search(query,8)];for(const site of sites.slice(0,6)){const button=document.createElement('button');button.textContent=site.n;button.onclick=()=>choose(site);results.append(button)}if(!sites.length)results.textContent='没有找到地点'}
  panel.querySelector('header button')!.addEventListener('click',close);dest.querySelector('button')!.onclick=()=>{if(selected)go(selected)}
  const pointers=new Map<number,number[]>();let dragged=false,origin=[0,0]
  function gesture(){const [first,second]=pointers.values();return second?[(first[0]+second[0])/2,(first[1]+second[1])/2,Math.max(1,Math.hypot(first[0]-second[0],first[1]-second[1]))]:[...first,1]}
  function move(before:number[],after:number[]){const next=Math.max(.08,Math.min(4,scale*after[2]/before[2]));centerX+=(before[0]-innerWidth/2)/scale-(after[0]-innerWidth/2)/next;centerZ+=(before[1]-innerHeight/2)/scale-(after[1]-innerHeight/2)/next;scale=next;draw()}
  canvas.onpointerdown=event=>{canvas.setPointerCapture(event.pointerId);origin=[event.clientX,event.clientY];pointers.set(event.pointerId,origin);dragged=pointers.size>1}
  canvas.onpointermove=event=>{if(!pointers.has(event.pointerId))return;const before=gesture();pointers.set(event.pointerId,[event.clientX,event.clientY]);if(Math.hypot(origin[0]-event.clientX,origin[1]-event.clientY)>4)dragged=true;move(before,gesture())}
  canvas.onpointerup=event=>{pointers.delete(event.pointerId);if(dragged)return;const x=centerX+(event.clientX-innerWidth/2)/scale,z=centerZ+(event.clientY-innerHeight/2)/scale
    const nearest=[...views,...atlas.places].find(site=>Math.hypot(site.x-x,site.z-z)*scale<24);if(nearest)choose(nearest)}
  canvas.onpointercancel=event=>pointers.delete(event.pointerId);canvas.onwheel=event=>{event.preventDefault();move([event.clientX,event.clientY,1],[event.clientX,event.clientY,Math.exp(-event.deltaY*.002)])}
  addEventListener('resize',()=>{if(!panel.hidden)draw()})
  return {panel,open(){panel.hidden=false;const pos=here();centerX=pos.x;centerZ=pos.z;selected=undefined;dest.hidden=true;results.replaceChildren();search.value='';counter.textContent=`已发现 ${views.filter(view=>seen.has(view.n)).length}/${views.length}`;draw()}}
}
