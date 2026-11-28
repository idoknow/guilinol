import assert from 'node:assert/strict'
import {createHash,randomBytes} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'

export async function verifyConnectivity({origin,browser,database,appearance}){
  for(const scenario of ['unreachable','slow','401']){
    const page=await browser.newPage({viewport:{width:480,height:320},reducedMotion:'reduce',serviceWorkers:'block'})
    const user=`fixture${scenario}`,token=randomBytes(32).toString('hex'),expected={x:-268.5,z:24.8}
    await database.sql("INSERT INTO users(id,email,nickname,salt,digest,verified) VALUES($1,$2,$1,'','',1)",[user,user+'@example.test'])
    await database.sql('INSERT INTO sessions VALUES($1,$2,unixepoch()+900)',[createHash('sha256').update(token).digest('hex'),user])
    await database.sql('INSERT INTO mp_positions(uid,x,y,z) SELECT uid,$2,146.5,$3 FROM users WHERE id=$1',[user,expected.x,expected.z])
    await page.context().addCookies([{name:'glol_session',value:token,url:origin,httpOnly:true}])
    const avatar=await page.request.put(origin+'/api/me/avatar',{headers:{origin},data:{avatar:appearance,equipStarter:true}});assert.equal(avatar.status(),200)
    let fault=true,attempts=0,position,documents=0
    page.on('framenavigated',frame=>{if(frame===page.mainFrame())documents++})
    page.on('dialog',async dialog=>{await dialog.dismiss();assert.fail(dialog.message())})
    await page.addInitScript(()=>{window.mpToasts=[];window.addEventListener('walk:toast',event=>window.mpToasts.push(event.detail?.text))})
    await page.route('**/api/rt/ticket',route=>{
      if(fault&&scenario==='401'){attempts++;return route.fulfill({status:401,body:'unauthorized'})}return route.continue()
    })
    await page.routeWebSocket('**/ws',client=>{
      if(fault&&scenario==='unreachable'){attempts++;client.close({code:1013,reason:'unavailable'});return}
      const upstream=client.connectToServer(),slow=fault&&scenario==='slow'
      if(slow)attempts++
      let pending=slow?[]:null,closed=false
      client.onMessage(message=>{const packet=JSON.parse(message);if(packet.t==='pos')position=packet;upstream.send(message)})
      client.onClose((code,reason)=>{closed=true;upstream.close({code,reason})})
      upstream.onMessage(message=>{
        if(!pending){client.send(message);return}
        pending.push(message)
        if(JSON.parse(message).t==='welcome')setTimeout(()=>{if(!closed)for(const frame of pending)client.send(frame);pending=null},20000).unref()
      })
    })
    async function select(mode,first=false){
      if(!first)await page.locator('.btn-menu').evaluate(button=>button.click())
      await page.locator(`[data-umami-event=home-${mode}]`).evaluate(button=>button.click())
      await page.waitForFunction(()=>!document.querySelector('.home-mode[aria-busy=true]'),null,{timeout:120000})
      assert.equal(await page.locator('#boot.failed').count(),0,`${scenario}: fatal loader`)
      assert.equal(await page.locator('body[data-home]').count(),0,`${scenario}: stuck at title`)
    }
    async function restored(){
      const deadline=Date.now()+60000
      while(!position&&Date.now()<deadline)await delay(100)
      assert.ok(position&&Math.hypot(position.x-expected.x,position.z-expected.z)<3,JSON.stringify({scenario,position}))
    }
    await page.goto(origin+'/?flow=0');await select('mp',true);assert.ok(attempts>0);assert.equal(position,undefined)
    fault=false;await restored();await select('tour');position=undefined
    const previous=attempts;fault=true;await select('mp');assert.ok(attempts>previous);assert.equal(position,undefined)
    assert.equal(await page.evaluate(()=>localStorage.getItem('glol.playMode')),'tour')
    assert.ok(await page.evaluate(()=>window.mpToasts.some(text=>text?.includes('返回原模式'))))
    fault=false;await select('mp');await restored();assert.equal(documents,1);await page.close()
    console.log(`PASS ${scenario}: home playable, tour rollback + toast, retry restored (${position.x}, ${position.z}), no reload`)
  }
}
