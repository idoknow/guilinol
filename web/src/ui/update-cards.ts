import {isModalOrOverlayOpen,isTextInputTarget} from '../walk/input-guard'

type Card={id:string;title:string;summary:string;how_to:string;images:string[]}
type Hooks={open?:()=>Promise<void>;mock?:(cards:Card[])=>void}
declare global {interface Window {updateCards?:Hooks}}
const pause=()=>new Promise(resolve=>setTimeout(resolve,200))
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
      const dialog=document.createElement('dialog'); dialog.className='update-cards';dialog.setAttribute('aria-label','更新介绍')
      const article=document.createElement('article');article.className='update-card'
      const status=document.createElement('p');status.setAttribute('role','status')
      const nav=document.createElement('nav'); nav.className='update-cards-nav'
      dialog.append(article,status,nav);document.body.append(dialog)
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
      async function draw(){
        const card=cards[index],title=document.createElement('h2'),summary=document.createElement('p'),how=document.createElement('p')
        title.textContent=card.title;summary.textContent=card.summary;how.textContent=card.how_to;how.className='update-card-how'
        article.replaceChildren(title,...card.images.map(url=>{const img=document.createElement('img');img.src=url;img.alt=card.title;return img}),summary,how)
        await mark(card,'viewed')
      }
      let busy=false
      async function run(fn:()=>Promise<void>){
        if(busy)return
        busy=true;nav.inert=true;status.textContent='';try{await fn()}catch{status.textContent='保存或读取失败，请重试'}finally{busy=false;nav.inert=false}
      }
      function button(label:string,fn:()=>Promise<void>){const element=document.createElement('button');element.textContent=label;element.onclick=()=>void run(fn);nav.append(element)}
      button('上一张',async()=>{await mark(cards[index],'viewed');index=Math.max(0,index-1);await draw()})
      button('下一张',async()=>{await mark(cards[index],'viewed');if(index+1===cards.length&&!await more())dialog.close();else{index++;await draw()}})
      button('跳过全部',async()=>{await mark(cards[index],'viewed');let from=index+1;do{for(const card of cards.slice(from))await mark(card,'skipped');from=cards.length}while(await more());dialog.close()})
      dialog.oncancel=event=>event.preventDefault();document.exitPointerLock?.();dialog.showModal()
      window.dispatchEvent(new Event('updates:open'))
      const closed=new Promise<void>(resolve=>dialog.addEventListener('close',()=>resolve(),{once:true}))
      await run(draw);await closed;dialog.remove();window.dispatchEvent(new Event('updates:close'))
    }finally{running=false}
  }
  window.updateCards=verify?{open,mock:cards=>{mock=cards}}:{}
  await open()
}
