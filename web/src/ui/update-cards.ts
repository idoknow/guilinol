import {isModalOrOverlayOpen,isTextInputTarget} from '../walk/input-guard'
import './update-cards.css'

type Card={id:string;kind?:'gameplay'|'modeling';title:string;summary:string;how_to:string;images:string[]}
type Hooks={open?:()=>Promise<void>;mock?:(cards:Card[])=>void}
declare global {interface Window {updateCards?:Hooks}}
const KIND={gameplay:'新玩法',modeling:'新建模'} as const
const pause=()=>new Promise(resolve=>setTimeout(resolve,200))
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className='',text='')=>{const node=document.createElement(tag);if(className)node.className=className;if(text)node.textContent=text;return node}
async function unseen():Promise<Card[]>{
  const response=await fetch('/api/updates/unseen',{cache:'no-store'})
  if(!response.ok)throw Error('读取卡片失败')
  return response.json()
}
export async function startCards(verify:boolean){
  let mock:Card[]|undefined,running=false
  async function open(){
    if(running)return
    running=true
    try{
      const cards=mock?.slice()??await unseen()
      if(!cards.length)return
      while(document.hidden||isModalOrOverlayOpen()||document.body.dataset.photo==='on'||document.querySelector('.chat-dock[data-open="1"]')||isTextInputTarget(document.activeElement)||[1,2].includes(window.__loading?.level??0))await pause()
      const dialog=el('dialog','update-cards');dialog.setAttribute('aria-label','更新介绍')
      const head=el('header','update-cards-head'),badge=el('span','update-cards-badge'),count=el('span','update-cards-count'),dots=el('span','update-cards-dots')
      head.append(badge,count,dots)
      const article=el('article','update-card')
      const status=el('p','update-cards-status');status.setAttribute('role','status')
      const nav=el('nav','update-cards-nav')
      dialog.append(head,article,status,nav);document.body.append(dialog)
      const recorded=new Set<string>();let index=0,lastBatch=cards.length
      async function mark(card:Card,action:'viewed'|'skipped'){
        if(recorded.has(card.id))return
        if(!mock){const response=await fetch(`/api/updates/${card.id}/seen`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action}),keepalive:true});if(!response.ok)throw Error('保存失败，请重试')}
        recorded.add(card.id)
      }
      async function more(){
        if(mock||lastBatch<10)return false
        const batch=await unseen();lastBatch=batch.length;cards.push(...batch);return !!batch.length
      }
      function chrome(){
        const card=cards[index],kind=card.kind??'gameplay'
        dialog.dataset.kind=kind;badge.textContent=KIND[kind]??'更新'
        const total=cards.length+(lastBatch>=10&&!mock?'+':'')
        count.textContent=`${index+1} / ${total}`
        dots.hidden=cards.length<2||cards.length>8
        dots.replaceChildren(...cards.map((_,i)=>{const dot=el('i');if(i===index)dot.className='on';return dot}))
        prev.disabled=index===0
        const last=index+1===cards.length&&(!!mock||lastBatch<10)
        next.textContent=last?'知道了':'下一张';skip.hidden=last
      }
      async function draw(direction=0){
        const card=cards[index]
        const media=el('div','update-card-media')
        if(card.images.length){
          const strip=el('div','update-card-strip')
          strip.append(...card.images.map((url,i)=>{const img=el('img');img.src=url;img.alt=i?'':card.title;img.decoding='async';img.draggable=false;return img}))
          media.append(strip)
          if(card.images.length>1){
            const pips=el('span','update-card-pips');pips.append(...card.images.map((_,i)=>{const pip=el('i');if(!i)pip.className='on';return pip}))
            strip.addEventListener('scroll',()=>{const at=Math.round(strip.scrollLeft/Math.max(1,strip.clientWidth));Array.from(pips.children).forEach((pip,i)=>pip.classList.toggle('on',i===at))},{passive:true})
            media.append(pips)
          }
        }else media.classList.add('empty')
        const body=el('div','update-card-body')
        const how=el('div','update-card-how');how.append(el('b','','怎么体验'),el('p','',card.how_to))
        body.append(el('h2','',card.title),el('p','update-card-summary',card.summary),how)
        article.replaceChildren(media,body)
        article.dataset.enter=direction<0?'back':direction>0?'fwd':'';void article.offsetWidth;article.classList.remove('enter');article.classList.add('enter')
        chrome()
        await mark(card,'viewed')
      }
      let busy=false
      async function run(fn:()=>Promise<void>){
        if(busy)return
        busy=true;nav.inert=true;status.textContent='';try{await fn()}catch{status.textContent='保存或读取失败，请重试'}finally{busy=false;nav.inert=false}
      }
      function button(label:string,className:string,fn:()=>Promise<void>){const element=el('button',className,label);element.type='button';element.onclick=()=>void run(fn);return element}
      const goPrev=async()=>{if(!index)return;await mark(cards[index],'viewed');index--;await draw(-1)}
      const goNext=async()=>{await mark(cards[index],'viewed');if(index+1===cards.length&&!await more())dialog.close();else{index++;await draw(1)}}
      const skip=button('跳过全部','update-cards-skip',async()=>{await mark(cards[index],'viewed');let from=index+1;do{for(const card of cards.slice(from))await mark(card,'skipped');from=cards.length}while(await more());dialog.close()})
      const prev=button('上一张','update-cards-prev',goPrev)
      const next=button('下一张','update-cards-next',goNext)
      nav.append(skip,el('span','update-cards-gap'),prev,next)
      dialog.addEventListener('keydown',event=>{
        if(event.key==='ArrowRight'){event.preventDefault();void run(goNext)}
        else if(event.key==='ArrowLeft'){event.preventDefault();void run(goPrev)}
      })
      // Swipe between cards anywhere outside the image strip (the strip scrolls its own images).
      let touch:{x:number;y:number}|undefined
      article.addEventListener('pointerdown',event=>{if(event.pointerType!=='mouse'&&!(event.target as Element).closest('.update-card-strip'))touch={x:event.clientX,y:event.clientY}})
      article.addEventListener('pointerup',event=>{
        if(!touch)return
        const dx=event.clientX-touch.x,dy=event.clientY-touch.y;touch=undefined
        if(Math.abs(dx)>48&&Math.abs(dx)>Math.abs(dy)*1.4)void run(dx<0?goNext:goPrev)
      })
      article.addEventListener('pointercancel',()=>{touch=undefined})
      dialog.oncancel=event=>event.preventDefault();document.exitPointerLock?.();dialog.tabIndex=-1;dialog.showModal();dialog.focus()
      window.dispatchEvent(new Event('updates:open'))
      const closed=new Promise<void>(resolve=>dialog.addEventListener('close',()=>resolve(),{once:true}))
      await run(draw);await closed;dialog.remove();window.dispatchEvent(new Event('updates:close'))
    }finally{running=false}
  }
  window.updateCards=verify?{open,mock:cards=>{mock=cards}}:{}
  await open()
}
