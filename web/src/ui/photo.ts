import type {skyClock} from './sky'
import {label,type Weather} from '../look/time'

const filters=['none','sepia(.32) saturate(.9) contrast(1.06)','sepia(.24) hue-rotate(80deg) saturate(.88)','grayscale(1)']
export function photo(canvas:HTMLCanvasElement,clock:ReturnType<typeof skyClock>,render:()=>void,close:()=>void){
  const bar=document.createElement('section');bar.className='photo-bar';bar.hidden=true
  bar.innerHTML=`<label><span></span><input aria-label="时段" type="range" min="0" max="24" step="0.1"></label><select aria-label="天气"><option value="clear">晴</option><option value="mist">雾</option><option value="rain">雨</option></select><select aria-label="滤镜">${['原色','胶片暖','青绿','黑白'].map(name=>`<option>${name}</option>`).join('')}</select><button>快门</button><button>返回</button><small role="status"></small>`
  document.body.append(bar);const time=bar.querySelector('input')!,[weather,filter]=bar.querySelectorAll('select'),[shutter,back]=bar.querySelectorAll('button'),status=bar.querySelector('small')!
  let saved={hour:0,weather:clock.weather,flowing:true,goal:null as number|null}
  function set(){clock.set(Number(time.value),weather.value as Weather);bar.querySelector('span')!.textContent=label(clock.hour)}
  time.oninput=set;weather.onchange=set;filter.onchange=()=>{canvas.style.filter=filters[filter.selectedIndex]};back.onclick=close
  shutter.onclick=async()=>{shutter.disabled=true;try{
    const image=document.createElement('canvas');image.width=canvas.width;image.height=canvas.height;const ink=image.getContext('2d')!
    render();ink.filter=filters[filter.selectedIndex];ink.drawImage(canvas,0,0);ink.filter='none';ink.font=`${Math.max(12,Math.round(image.width*.016))}px serif`;ink.textAlign='right';ink.shadowColor='#1c2c2a';ink.shadowBlur=3;ink.fillStyle='#f4efe2';ink.fillText('网上桂林 · glol.rcpd.cc',image.width-16,image.height-16)
    const blob=await new Promise<Blob>((resolve,reject)=>image.toBlob(value=>value?resolve(value):reject(Error('PNG')),'image/png'));const file=new File([blob],'网上桂林.png',{type:'image/png'})
    if(matchMedia('(pointer:coarse)').matches&&navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file]});return}catch(error){if((error as Error).name==='AbortError')return}}
    const link=document.createElement('a');link.href=URL.createObjectURL(file);link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),30000)
  }catch{status.textContent='照片未保存，请重试'}finally{shutter.disabled=false}}
  return {open(){saved={hour:clock.hour,weather:clock.weather,flowing:clock.flowing,goal:clock.goal};clock.flowing=false;time.value=String(clock.hour);weather.value=clock.weather;filter.selectedIndex=0;status.textContent='';set();bar.hidden=false},close(){bar.hidden=true;canvas.style.filter='';Object.assign(clock,saved);clock.set(saved.hour,saved.weather);clock.goal=saved.goal}}
}
