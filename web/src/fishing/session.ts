import * as THREE from 'three'
import {hotbarSlot,selectSlot} from '../ui/hotbar'
import {getActiveSaveSnapshot} from '../game/save'
import {FishingEngine,type Catch} from './engine'
import {chargePower,resolveCast,type Point,nearestFishingShore,nearby,species,tabs,waters,xpThresholds,type Method} from './config'
import {buy,certification,collect,consume,inventory,journal,refundFullCast,removeCatch,shop} from './inventory'
import {bait} from './bait'
import {fishThumb} from './fish-model'
import {reportCatch} from './report'
import {createRod,createWaterFx} from './fx'
import './fishing.css'

type Host={canUse:()=>boolean,position:()=>Point,heading:()=>number,onLand:(x:number,z:number)=>boolean,waterAt:(x:number,z:number)=>number|null,face:(angle:number)=>void,
  teleport:(x:number,z:number,angle:number)=>Promise<boolean>,hand:()=>THREE.Object3D|undefined,scene:THREE.Scene}
const textFocus=()=>document.activeElement?.matches('input,textarea,select,[contenteditable=true]')
const terminal=['equip','land','snap','escape','miss','junk','empty-hook']
const gradeClass=(grade:string)=>grade==='legendary'?'g-l':grade==='high'?'g-r':grade==='junk'?'g-j':'g-c'
const zoneName={red:'红区 · 传说出没',blue:'蓝区 · 高级鱼',green:'绿区 · 常见鱼'} as Record<string,string>
const coarse=()=>matchMedia('(pointer:coarse) and (not (any-pointer:fine))').matches
const esc=(text:string)=>text.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]!)
const BAG_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12c3-4.5 8.5-6 13-3l4-3v12l-4-3c-4.5 3-10 1.5-13-3z"/><circle cx="7.5" cy="11.2" r=".9"/></svg>'

function makeFloat(){
  // 浮标：上朱下白的纺锤 + 细标尖，咬口时整体下沉。
  const g=new THREE.Group()
  const top=new THREE.Mesh(new THREE.SphereGeometry(.035,14,10,0,Math.PI*2,0,Math.PI/2),new THREE.MeshStandardMaterial({color:0xd0694c,roughness:.4,emissive:0x3a120a}))
  const bottom=new THREE.Mesh(new THREE.SphereGeometry(.035,14,10,0,Math.PI*2,Math.PI/2,Math.PI/2),new THREE.MeshStandardMaterial({color:0xf4efe2,roughness:.5}))
  top.scale.y=bottom.scale.y=1.7
  const stick=new THREE.Mesh(new THREE.CylinderGeometry(.004,.004,.12,6),new THREE.MeshStandardMaterial({color:0xffc53d,emissive:0x6a4a10}));stick.position.y=.1
  g.add(top,bottom,stick);g.name='fishing-float';g.visible=false;return g
}

export function createFishing(host:Host,verify:boolean){
  const ui=document.createElement('section');ui.className='fishing-ui';ui.hidden=true
  ui.innerHTML=`<div class="fx-bar">
      <button type="button" data-close class="fx-x" title="收竿（4）" aria-label="收竿">✕</button>
      <button type="button" data-method class="fx-method" aria-label="切换钓法"><span data-m="路亚">路亚</span><span data-m="台钓">台钓</span></button>
      <label class="fx-bait"><span>饵</span><select aria-label="鱼饵"></select></label>
      <button type="button" data-menu class="fx-menu">${BAG_ICON}<span>渔利</span></button>
    </div>
    <p class="fx-where"></p>
    <div class="fx-cue" hidden></div>
    <div class="fx-fight" hidden><div class="ff-bar"><i class="ff-slack"></i><i class="ff-red"></i><b class="ff-fill"></b><em class="ff-mark"></em></div>
      <p class="ff-meta"><span class="ff-dist"></span><span class="ff-surge">鱼在冲 · 松线！</span><span class="ff-stam"></span></p></div>
    <p class="fx-hint"></p>
    <div class="fx-act">
      <div class="fx-charge" hidden><i></i><b></b></div>
      <button type="button" class="fx-main" data-action data-cast>按住蓄力</button>
    </div>
    <div class="fx-catch" hidden></div>`
  const drawer=document.createElement('aside');drawer.className='fx-drawer';drawer.hidden=true
  drawer.innerHTML=`<header><div class="fd-title"><h2>渔利</h2><span class="fd-rank"></span></div><span class="fd-wallet"></span><button type="button" class="fd-x" aria-label="关闭渔利">✕</button></header>
    <nav class="fd-tabs" aria-label="渔利分类"></nav><div class="fd-body"></div><footer class="fd-foot" hidden></footer>`
  document.body.append(ui,drawer)
  const q=<T extends HTMLElement>(sel:string,root:HTMLElement=ui)=>root.querySelector<T>(sel)!
  const baitSelect=q<HTMLSelectElement>('select'),where=q('.fx-where'),hint=q('.fx-hint'),cue=q('.fx-cue'),card=q('.fx-catch')
  const action=q<HTMLButtonElement>('[data-action]'),chargeBox=q('.fx-charge'),chargeFill=chargeBox.querySelector('i')!,chargeText=chargeBox.querySelector('b')!
  const fightBox=q('.fx-fight'),ffFill=fightBox.querySelector<HTMLElement>('.ff-fill')!,ffMark=fightBox.querySelector<HTMLElement>('.ff-mark')!,ffDist=fightBox.querySelector<HTMLElement>('.ff-dist')!,ffStam=fightBox.querySelector<HTMLElement>('.ff-stam')!
  let chargeStart:number|null=null,owner:string|null=null,target:Point|undefined
  const signal=(name:string,detail:unknown)=>window.dispatchEvent(new CustomEvent('fishing:'+name,{detail}))
  const engine=new FishingEngine((name,detail)=>{signal(name,detail);visual(name,detail);if(name==='state')stageChanged(String(detail));else if(name==='catch')showCatch(detail as Catch);else if(name==='snap')toast('断线了 · 鱼带着饵跑了','bad')},item=>{
    const result=collect(item)
    if(result.code==='BAG_FULL'){if(receipt)refundFullCast(receipt.baitId,receipt.key);toast('渔利背包已满 · 先去出售或丢弃','bad');return 'BAG_FULL'}
    return result.ok})
  let receipt:{key:string,baitId:string}|undefined
  // 竿子从右手斜向前上方伸出（比旧版更长更粗、竿头能弯）
  const tipLocal=new THREE.Vector3(0,2.1,0)
  const rodKit=createRod(tipLocal),rod=rodKit.root,tip=rodKit.tip,reel=rodKit.reel;rod.name='fishing-grip'
  const fx=createWaterFx(host.scene),targetVec=new THREE.Vector3(),endVec=new THREE.Vector3()
  let flying=false,fightSurge=false,castFrom:{x:number,z:number}|undefined
  const rodDir=new THREE.Vector3(),UP=new THREE.Vector3(0,1,0)
  function visual(name:string,detail:unknown){
    const d=(detail??{}) as {side?:number,size?:string,surge?:boolean}
    if(name==='fight'){const was=fightSurge;fightSurge=!!d.surge;if(fightSurge&&!was&&target)fx.surge(endVec)}
    if(!target)return
    targetVec.set(target.x,target.y,target.z)
    if(name==='approach')fx.approach(targetVec,d.side??0,d.size??'中型')
    else if(name==='nibble')fx.nibble(targetVec)
    else if(name==='hit'){fx.hit(targetVec);fx.pulse(targetVec,.3,1.3);navigator.vibrate?.(140)}
    else if(name==='hooked'){fx.stopPulse();fx.hooked(targetVec);navigator.vibrate?.([60,40,60])}
    else if(name==='spooked'){fx.stopPulse();fx.spook();toast('鱼被惊跑了 · 等它再游回来','dim')}
    else if(name==='missed'){fx.stopPulse();fx.spook()}
    else if(name==='catch')fx.landed(endVec)
    else if(name==='state'&&['equip','snap','escape','miss','empty-hook','idle'].includes(String(detail)))fx.clear()
  }
  const SEG=20,coords=new THREE.BufferAttribute(new Float32Array(SEG*3),3),geometry=new THREE.BufferGeometry().setAttribute('position',coords)
  const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0xe8e4d6,transparent:true,opacity:.75}));line.name='fishing-line';line.frustumCulled=false;line.visible=false;host.scene.add(line)
  const float=makeFloat();host.scene.add(float)
  const tipWorld=new THREE.Vector3(),mid=new THREE.Vector3();let method:Method='路亚',origin:ReturnType<typeof nearby>,previous:'hand'|'camera'='hand',clock=0,tab='鱼饵'

  function options(){
    const save=inventory(),rows=bait.filter(row=>(row.kind.startsWith('台钓')?'台钓':'路亚')===method)
    const keep=baitSelect.value
    baitSelect.replaceChildren(...rows.map(row=>{const n=save.bait[row.id]??0,o=new Option(`${row.name} ×${n}`,row.id);o.disabled=!n;return o}))
    const pick=rows.find(row=>row.id===keep&&(save.bait[row.id]??0)>0)??rows.find(row=>(save.bait[row.id]??0)>0)??rows[0];baitSelect.value=pick.id
    ui.dataset.way=method
    const rank=certification(),water=spot()
    where.textContent=water?`${water.name} · ${zoneName[water.zone]} · ${rank.rank} Lv ${rank.level}`:''
  }
  let bankCache:{x:number,z:number,angle:number,water:ReturnType<typeof nearby>}|undefined
  function spot(){
    const pos=host.position();if(!host.onLand(pos.x,pos.z))return undefined
    if(bankCache&&bankCache.x===pos.x&&bankCache.z===pos.z&&bankCache.water)return bankCache.water
    const water=nearby(pos.x,pos.z);if(!water)return undefined
    const {shore}=nearestFishingShore(pos.x,pos.z),aim=Math.atan2(shore.target[0]-pos.x,shore.target[2]-pos.z)
    for(let turn=0;turn<32;turn++){
      const angle=aim+Math.ceil(turn/2)*(turn%2?1:-1)*Math.PI/16
      if(resolveCast(pos,angle,1,host.waterAt)){bankCache={x:pos.x,z:pos.z,angle,water};return water}
    }
  }
  function active(){return hotbarSlot()==='fishing'&&host.canUse()}
  function toggle(){if(hotbarSlot()==='fishing'){selectSlot(previous);return}if(!host.canUse()||!spot())return
    const methods=spot()!.methods;if(!methods.includes(method))method=methods[0];q<HTMLButtonElement>('[data-method]').classList.toggle('single',methods.length===1)
    host.face(bankCache!.angle)
    previous=hotbarSlot()==='camera'?'camera':'hand';selectSlot('fishing');host.scene.add(rod);ui.hidden=false;document.body.dataset.fishing='on';engine.equip();options()}
  window.addEventListener('fishing:cancel',()=>{resetInput();rod.removeFromParent();float.visible=line.visible=false;fx.clear();flying=false;chargeBox.hidden=true;fightBox.hidden=true;ui.hidden=true;closeDrawer();delete document.body.dataset.fishing;origin=undefined;engine.cancel()})

  function stageChanged(stage:string){
    ui.dataset.stage=stage
    const lure=method==='路亚'
    const k=coarse()?'':'空格 · '
    action.textContent=terminal.includes(stage)?k+'按住蓄力':stage==='fight'?k+'按住收线':stage==='hit'?k+'提竿！':lure?k+'收线':k+'提竿'
    cue.hidden=!['hit','nibble','approach'].includes(stage);cue.className='fx-cue'+(stage==='hit'?' bite':'')
    cue.textContent=stage==='hit'?'咬钩了 · 快提竿！':stage==='nibble'?'有鱼在试探 · 别动':'鱼游过来了…'
    fightBox.hidden=stage!=='fight'
    const sp=coarse()?'':'空格'
    hint.textContent=terminal.includes(stage)?`按住${sp||'按钮'}蓄力，松开抛竿`:stage==='fight'?`按住${sp||'按钮'}收线，松开放线`:stage==='hit'?`咬钩了！马上按一下${sp||'提竿'}`:stage==='nibble'?'鱼在试探，先别动':stage==='approach'?'有鱼靠近了，稳住':lure?`等鱼来咬（按住${sp||'按钮'}收线能引鱼更快），咬钩后按一下提竿`:'盯住浮标，猛地一沉再提竿'
    if(stage==='empty-hook')toast('空钩 · 这一竿没上鱼','dim')
    else if(stage==='escape')toast(lure?'鱼脱钩了':'没等到咬口','dim')
    else if(stage==='miss')toast('提竿慢了，鱼溜了','dim')
    q<HTMLButtonElement>('[data-method]').disabled=!terminal.includes(stage)||(spot()?.methods.length??2)<2
  }
  let cardTimer=0
  function toast(text:string,tone:'bad'|'dim'){card.hidden=false;card.className=`fx-catch fx-toast ${tone}`;card.innerHTML=`<p>${esc(text)}</p>`;clearTimeout(cardTimer);cardTimer=window.setTimeout(()=>{card.hidden=true},2600)}
  function showCatch(item:Catch){
    reportCatch(item)
    const row=species.find(s=>s.id===item.speciesId),fresh=row&&inventory().bag.filter(b=>b.speciesId===row.id).length===1
    card.hidden=false;card.className=`fx-catch ${gradeClass(item.grade)}`
    card.innerHTML=row?`<img alt="" src="${fishThumb(row.id)}"><div><p class="fc-no">${row.number}${fresh?' · <b>新图鉴</b>':''}</p><h3>${esc(row.name)}</h3>
      <p class="fc-meta"><span class="fc-r">${row.rarity}</span>${row.size} · ${item.weight} kg · <b>¥${item.price}</b></p></div>${['high','legendary'].includes(item.grade)?`<button type="button" data-inspect="${item.id}">检视</button>`:''}`
      :`<div><p class="fc-no">杂物</p><h3>${esc(item.name)}</h3><p class="fc-meta">不入图鉴 · 回收 <b>¥${item.price}</b></p></div>`
    clearTimeout(cardTimer);cardTimer=window.setTimeout(()=>{card.hidden=true},row&&['high','legendary'].includes(item.grade)?7000:4200)
  }
  card.addEventListener('click',event=>{const id=(event.target as HTMLElement).dataset.inspect;if(id){card.hidden=true;void inspect(id)}})

  function cast(power:number){const water=spot();if(!active()||!water||!terminal.includes(engine.stage))return false
    if(!water.methods.includes(method))return false
    const pos=host.position(),landing=resolveCast({x:pos.x,y:pos.y,z:pos.z},host.heading(),power,host.waterAt)
    if(!landing){signal('cast-blocked',{reason:'no-open-water'});toast('抛到岸上了 · 未消耗饵','dim');return false}
    const id=baitSelect.value,key=crypto.randomUUID(),debit=consume(id,key);if(!debit.ok){toast(debit.code==='BAG_FULL'?'渔利背包已满 · 先去出售或丢弃':debit.code==='NO_BAIT'?'这款饵用完了 · 去渔利补货':debit.code,'dim');return false}
    receipt={key,baitId:id}
    const save=inventory(),tier=(prefix:string)=>Math.max(...save.owned.filter(value=>value.startsWith(prefix)).map(value=>Number(value.slice(prefix.length))))
    target=landing.to;origin=water;card.hidden=true;signal('cast',landing);castFrom={x:pos.x,z:pos.z}
    tip.getWorldPosition(tipWorld);flying=true;fx.cast(tipWorld,new THREE.Vector3(target.x,target.y,target.z),()=>{flying=false});signal('camera',{target:[target.x,target.y,target.z],zoom:method==='台钓'})
    const result=engine.cast({distance:landing.distance,water,method,bait:id,line:tier('line'),rod:tier(method==='台钓'?'pole':'lure'),float:save.owned.includes('float'),drag:save.owned.includes('drag')});options();return result}
  const inspect=(id:string)=>import('./inspect').then(module=>module.inspect(id))

  // —— 渔利：商店五类 + 背包 + 图鉴 + 钓鱼地图 ——
  const tabList=[...tabs,'背包','图鉴','地图'] as string[]
  q('.fd-tabs',drawer).innerHTML=tabList.map(name=>`<button type="button" data-tab="${name}"${['背包','图鉴','地图'].includes(name)?' class="fd-own"':''}>${name}</button>`).join('')
  const body=q('.fd-body',drawer),foot=q('.fd-foot',drawer)
  function openDrawer(){resetInput();drawer.hidden=false;document.body.dataset.fishMenu='1';render()}
  function closeDrawer(){drawer.hidden=true;delete document.body.dataset.fishMenu}
  const say=(code:string)=>({OK:'',locked:'段位不够，先去钓几条',INSUFFICIENT_FUNDS:'钱不够',ALREADY_OWNED:'已经有了',IN_FLIGHT:'',PERSIST_FAILED:'存档失败，稍后再试'} as Record<string,string>)[code]??code
  let note=''
  function render(){
    const save=getActiveSaveSnapshot(),rank=certification(),next=xpThresholds[rank.level]
    q('.fd-rank',drawer).textContent=`${rank.rank} · Lv ${rank.level}${next!==undefined?` · ${inventory().xp}/${next}`:''}`
    q('.fd-wallet',drawer).textContent=`¥${save.money.toLocaleString('zh-CN')}`
    drawer.querySelectorAll<HTMLElement>('[data-tab]').forEach(b=>{const on=b.dataset.tab===tab;b.classList.toggle('on',on);b.setAttribute("aria-pressed",String(on))})
    foot.hidden=true;foot.replaceChildren()
    const msg=note?`<p class="fd-note">${esc(note)}</p>`:'';note=''
    if(tab==='背包')return renderBag(msg)
    if(tab==='图鉴')return renderBook()
    if(tab==='地图')return renderMap()
    const rows=shop(tab)
    if(!rows.length){body.innerHTML=`<p class="fd-empty">礼盒和特殊饵料陆续上架，敬请期待。</p>`;return}
    body.innerHTML=msg+rows.map(item=>{
      const owned=item.tab!=='鱼饵'&&inventory().owned.includes(item.id),stock=item.tab==='鱼饵'?inventory().bait[item.id]??0:0
      const kind='kind' in item?String(item.kind):'tier' in item?`强度 ${item.tier} 级`:'配件'
      const effect='biteBonus' in item?'咬口窗口加长':'redBonus' in item?'红区多撑 0.4 秒':''
      return `<div class="fd-row${item.locked?' locked':''}"><div class="fd-main"><b>${esc(item.name)}</b><span>${kind}${effect?' · '+effect:''}${stock?` · 库存 ${stock}`:''}</span>${item.locked?`<em>🔒 ${item.unlock}</em>`:''}</div>
        <button type="button" data-buy="${item.id}"${item.locked||owned?' disabled':''}>${owned?'已拥有':`¥${item.price}`}</button></div>`}).join('')
  }
  function renderBag(msg:string){
    const bag=inventory().bag
    if(!bag.length){body.innerHTML=msg+'<p class="fd-empty">背包空空。站到岸点抛一竿试试。</p>';return}
    body.innerHTML=msg+bag.slice().reverse().map(item=>{const row=species.find(s=>s.id===item.speciesId),water=waters.find(w=>w.id===item.water)
      return `<div class="fd-row fd-fish ${gradeClass(item.grade)}">${row?`<img alt="" src="${fishThumb(row.id)}">`:'<i class="fd-junk"></i>'}
        <div class="fd-main"><b>${esc(item.name)}</b><span>${row?`<i class="fc-r">${row.rarity}</i> ${row.size} · ${item.weight} kg`:'杂物'} · ${water?.name??''} · ${item.method}</span></div>
        <div class="fd-acts">${row&&['high','legendary'].includes(item.grade)?`<button type="button" class="ghost" data-inspect="${item.id}">检视</button>`:''}<button type="button" class="ghost" data-drop="${item.id}" aria-label="丢弃 ${esc(item.name)}">丢</button><button type="button" data-sell="${item.id}">卖 ${item.price}</button></div></div>`}).join('')
    const total=bag.reduce((s,i)=>s+i.price,0)
    foot.hidden=false;foot.innerHTML=`<span>共 ${bag.length} 件 · 合计 ¥${total}</span><button type="button" class="ghost" data-drop-all>批量丢弃</button><button type="button" data-sell-all>批量出售</button>`
  }
  const filters:{rarity?:string,size?:string,water?:string,method?:string}={}
  function renderBook(){
    const book=journal(filters),sel=(key:keyof typeof filters,label:string,opts:[string,string][])=>`<select data-filter="${key}" aria-label="${label}"><option value="">${label}</option>${opts.map(([v,t])=>`<option value="${v}"${filters[key]===v?' selected':''}>${t}</option>`).join('')}</select>`
    body.innerHTML=`<div class="fd-filters">${sel('rarity','全部稀有度',[['常见','常见'],['稀有','稀有'],['典藏','典藏']])}${sel('size','全部体型',['巨型','大型','中型','小型','微型'].map(s=>[s,s]))}${sel('water','全部水域',waters.map(w=>[w.id,w.name]))}${sel('method','全部钓法',[['路亚','路亚'],['台钓','台钓']])}</div>
      <p class="fd-count">显示 ${book.rows.length} / ${book.total} 种 · 已收集 ${book.collected}<button type="button" class="ghost" data-tab-go="地图">打开钓鱼地图</button></p>
      <div class="fd-grid">${book.rows.map(row=>`<button type="button" class="fd-card ${gradeClass(row.grade)}${row.collected?'':' unknown'}" ${row.collected?`data-inspect-species="${row.id}"`:'disabled'}><img alt="" src="${fishThumb(row.id)}"><span>${row.number}</span><b>${row.collected?esc(row.name):'？？？'}</b><i class="fc-r">${row.rarity}</i></button>`).join('')}</div>`
  }
  let mapPick=''
  function renderMap(){
    const xs=waters.map(w=>w.circle.x),zs=waters.map(w=>w.circle.z),x0=Math.min(...xs)-160,x1=Math.max(...xs)+160,z0=Math.min(...zs)-140,z1=Math.max(...zs)+140
    const W=320,H=Math.round(W*(z1-z0)/(x1-x0)),px=(x:number)=>((x-x0)/(x1-x0)*W).toFixed(1),pz=(z:number)=>((z-z0)/(z1-z0)*H).toFixed(1),here=spot()?.id
    const pick=waters.find(w=>w.id===mapPick)??waters.find(w=>w.id===here)??waters[0]
    body.innerHTML=`<svg class="fd-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="钓鱼地图">${waters.map(w=>`<g class="fm-pt z-${w.zone}${w.id===pick.id?' on':''}" data-water="${w.id}"><circle cx="${px(w.circle.x)}" cy="${pz(w.circle.z)}" r="${w.id===pick.id?13:10}"/>${w.id===here?`<circle class="fm-here" cx="${px(w.circle.x)}" cy="${pz(w.circle.z)}" r="3.5"/>`:''}<text x="${px(w.circle.x)}" y="${(+pz(w.circle.z)+22).toFixed(1)}">${w.name.replace('漓江·','')}</text></g>`).join('')}</svg>
      <p class="fd-legend"><i class="z-red"></i>红 · 传说 3%<i class="z-blue"></i>蓝 · 高级<i class="z-green"></i>绿 · 常见为主</p>
      <div class="fd-water"><b>${pick.name}</b><span>${zoneName[pick.zone]} · 水深 ${pick.depth[0]}–${pick.depth[1]} m · ${pick.methods.join(' / ')}</span>
      <div class="fd-chips">${pick.fish.map(id=>{const row=species.find(s=>s.id===id)!;return `<i class="${gradeClass(row.grade)}">${inventory().collected.includes(id)?row.name:'？？？'}</i>`}).join('')}</div></div>`
  }
  drawer.addEventListener('change',event=>{const el=event.target as HTMLSelectElement;const key=el.dataset.filter as keyof typeof filters|undefined;if(key){filters[key]=el.value||undefined;render()}})
  drawer.addEventListener('click',event=>{
    const el=(event.target as HTMLElement).closest<HTMLElement>('button,[data-water]');if(!el)return
    const d=el.dataset
    if(el.classList.contains('fd-x')){closeDrawer();return}
    if(d.tab||d.tabGo){tab=d.tab??d.tabGo!;render();return}
    if(d.water){mapPick=d.water;render();return}
    if(d.buy){note=say(buy(d.buy).code);options()}
    else if(d.sell){note=say(removeCatch([d.sell],true).code)}
    else if(d.drop){note=say(removeCatch([d.drop],false).code)}
    else if('sellAll' in d){note=say(removeCatch(inventory().bag.map(i=>i.id),true).code)}
    else if('dropAll' in d){if(!confirm('丢弃背包里全部渔获？丢掉的不会返还。'))return;note=say(removeCatch(inventory().bag.map(i=>i.id),false).code)}
    else if(d.inspect){void inspect(d.inspect);return}
    else if(d.inspectSpecies){void inspect(d.inspectSpecies);return}
    render()
  })

  ui.addEventListener('click',event=>{const el=(event.target as HTMLElement).closest<HTMLElement>('button');if(!el)return
    if(el.hasAttribute('data-close'))selectSlot(previous)
    if(el.hasAttribute('data-method')&&terminal.includes(engine.stage)&&(spot()?.methods.length??0)>1){method=method==='路亚'?'台钓':'路亚';options();stageChanged(engine.stage)}
    if(el.hasAttribute('data-menu')){if(drawer.hidden)openDrawer();else closeDrawer()}})
  function resetInput(){owner=null;chargeStart=null;engine.reel=false}
  function press(id:string){if(owner!==null)return;owner=id
    if(terminal.includes(engine.stage)){chargeStart=performance.now();signal('charge',{power:0})}else engine.press()}
  function release(id:string,cancel=false){if(id!==owner)return;const start=chargeStart;resetInput()
    if(start!==null&&!cancel)cast(chargePower((performance.now()-start)/1000))}
  window.addEventListener('pointerdown',event=>{
    if(!active()||!drawer.hidden||event.button!==0)return
    const el=event.target as HTMLElement
    if(el!==action&&!(el.tagName==='CANVAS'&&event.pointerType==='mouse'))return
    if(el!==action&&document.pointerLockElement!==el)return
    event.preventDefault();event.stopImmediatePropagation();if(el===action)el.setPointerCapture(event.pointerId);press(String(event.pointerId))
  },true)
  for(const type of ['pointerup','pointercancel','lostpointercapture'] as const)window.addEventListener(type,event=>release(String(event.pointerId),type!=='pointerup'),true)
  function key(event:KeyboardEvent){if(event.code!=='Space'||!active()||textFocus()||!drawer.hidden)return
    event.stopImmediatePropagation();event.preventDefault();if(event.type==='keyup')release('space');else if(!event.repeat)press('space')}
  window.addEventListener('keydown',key,true);window.addEventListener('keyup',key,true);window.addEventListener('blur',resetInput)

  function tick(dt:number){if(hotbarSlot()!=='fishing')return;if(!active()||!spot()){selectSlot(previous);return}
    if(chargeStart!==null){const power=chargePower((performance.now()-chargeStart)/1000);signal('charge',{power})
      chargeBox.hidden=false;chargeBox.classList.toggle('full',power>=.95);chargeFill.style.transform=`scaleX(${power.toFixed(3)})`;chargeText.textContent=`${Math.round(6+24*power)} m`;action.textContent='松开抛竿'}
    else if(!chargeBox.hidden)chargeBox.hidden=true
    fx.tick(dt)
    const st=engine.stage
    rodKit.set(st==='fight'?.35+.65*engine.tension:st==='hit'?.35:st==='nibble'?.12:chargeStart!==null?-.25:.04,st==='fight'?engine.direction:0,st==='hit'?1:st==='nibble'?.4:st==='fight'&&engine.tension>.8?.6:0)
    rodKit.tick(dt)
    // 鱼竿挂在右手位置，朝人物前方斜向上（角力时压低指向鱼线）
    const hand=host.hand();if(hand){hand.updateWorldMatrix(true,false);hand.getWorldPosition(rod.position)}
    const a=host.heading(),fwd=rodDir.set(Math.sin(a),0,Math.cos(a)),lift=st==='fight'?.45:chargeStart!==null?1.6:.85
    fwd.y=lift;fwd.normalize();rod.quaternion.setFromUnitVectors(UP,fwd)
    clock+=dt;engine.tick(dt);line.visible=!!origin&&!terminal.includes(engine.stage);float.visible=line.visible&&method==='台钓'
    if(engine.reel)rodKit.spin(dt)
    if(line.visible&&origin&&target){
      tip.getWorldPosition(tipWorld);const fight=engine.stage==='fight',pos=host.position()
      const fl=flying?fx.flying():undefined
      if(fl)endVec.copy(fl)
      else{endVec.set(target.x,target.y,target.z);if(fight){const dx=target.x-pos.x,dz=target.z-pos.z,len=Math.hypot(dx,dz)||1,k=Math.min(1,Math.max(.08,engine.distance/len))
        endVec.set(pos.x+dx*k+engine.direction*.6*(fightSurge?1:0),target.y,pos.z+dz*k);fx.follow(endVec)}}
      const {x,y,z}=endVec
      fx.bait(method==='路亚'&&!flying?endVec:undefined)
      // 鱼线：竿梢到入水点的下垂弧，角力时绷直、随拉力抖动
      const sag=fight?.05*(1-engine.tension):.45,shake=fight?Math.sin(clock*40)*.03*engine.tension:0
      const end=endVec
      for(let i=0;i<SEG;i++){const u=i/(SEG-1);mid.lerpVectors(tipWorld,end,u);mid.y-=Math.sin(Math.PI*u)*sag*tipWorld.distanceTo(end)*.1;mid.x+=Math.sin(Math.PI*u)*shake;coords.setXYZ(i,mid.x,mid.y,mid.z)}
      coords.needsUpdate=true
      if(method==='台钓'){
        const bite=engine.stage==='hit',bob=bite?-.09-.03*Math.sin(clock*18):Math.sin(clock*2.2)*.012+(engine.stage==='wait'&&Math.sin(clock*7.3)>.96?-.02:0)
        float.visible=!flying;float.position.set(x,y+.02+bob,z);float.rotation.z=Math.sin(clock*1.7)*.06}
    }
    // 抛竿后走开超过 1.5 m：自动收线（不把人钉在原地）
    if(castFrom&&!terminal.includes(engine.stage)){const p=host.position();if(Math.hypot(p.x-castFrom.x,p.z-castFrom.z)>1.5){const lost=engine.stage==='fight';castFrom=undefined;fx.clear();flying=false;line.visible=float.visible=false;origin=undefined;engine.cancel();engine.equip();toast(lost?'走开了 · 鱼跑了':'走动了 · 已收线','dim')}}
    if(engine.stage==='fight'){
      ffFill.style.transform=`scaleX(${engine.tension.toFixed(3)})`;ffMark.style.left=`${(engine.tension*100).toFixed(1)}%`
      fightBox.classList.toggle('red',engine.tension>=.85);fightBox.classList.toggle('slack',engine.tension<=.1);fightBox.classList.toggle('surge',fightSurge)
      ffDist.textContent=`距岸 ${Math.max(0,engine.distance).toFixed(1)} m`;ffStam.textContent=`鱼体力 ${Math.round(engine.stamina*100)}%`
      hint.textContent=fightSurge?'鱼在冲，松开放线':engine.tension>=.85?'拉力太大，快松线':engine.tension<=.1?`线太松，按住${coarse()?'':'空格'}收线`:`按住${coarse()?'':'空格'}收线，松开放线`}
  }
  const teleportToSpot=async(id:string,index=0)=>{const bank=waters.find(row=>row.id===id)?.banks[index];return !!bank&&await host.teleport(bank.x,bank.z,bank.yaw)}
  Object.assign(window,{fishing:{waters,journal,profile:certification,inspect,state:()=>({stage:engine.stage,phase:chargeStart!==null?'charge':engine.stage,distance:engine.distance,stamina:engine.stamina,direction:engine.direction,tension:engine.tension,method,spot:spot()?.id,inventory:structuredClone(inventory())}),
    ...(verify?{teleportToSpot,waterAt:host.waterAt,onLand:host.onLand,charge:(power:number)=>cast(power),forceApproach:()=>engine.approach(true),forceHit:()=>{engine.approach(true);engine.hit()},setSeed:(seed:number)=>engine.setSeed(seed),openMenu:(name?:string)=>{if(name)tab=name;openDrawer()}}:{})}})
  function interruptCast(){
    if(hotbarSlot()!=='fishing')return
    if(receipt&&!terminal.includes(engine.stage))refundFullCast(receipt.baitId,receipt.key,'down')
    receipt=undefined
    selectSlot('hand')
  }
  return {toggle,tick,teleportToSpot,interruptCast}
}
