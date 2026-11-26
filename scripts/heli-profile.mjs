import assert from 'node:assert/strict'

export async function profile(page,api,pool){
  const count=Number(process.env.HELI_PROFILE_FRAMES??600)
  assert.ok(Number.isSafeInteger(count)&&count>0)
  const stats=['ms','calls','triangles','textures','geometries','uploads','renderMs','simulationMs','streamMs','mainMs']
  if(process.env.HELI_PROFILE_DRAWS)await page.evaluate(()=>{
    const scene=window.viewer.stream.scene,original=scene.onBeforeRender
    scene.onBeforeRender=function(renderer,...args){
      scene.onBeforeRender=original
      const draw=renderer.renderBufferDirect
      renderer.renderBufferDirect=function(camera,scene,geometry,material,object,group){
        const before=this.info.render.triangles,calls=this.info.render.calls
        draw.call(this,camera,scene,geometry,material,object,group)
        const bins=window.heliDrawBins
        if(!bins)return
        let root=object;while(root.parent&&root.parent.type!=='Scene')root=root.parent
        const key=[root.name||root.type,object.name||object.parent?.name||object.type,geometry.type,material.name||material.type].join(':')
        const entry=bins[key]??=[0,0];entry[0]+=this.info.render.calls-calls;entry[1]+=this.info.render.triangles-before
      }
      original.call(this,renderer,...args)
    }
  })
  async function sample(mode,remaining){
    return page.evaluate(async({mode,remaining,stats})=>{
      const viewer=window.viewer,rows=[]
      let last=viewer.stats.frame
      while(rows.length<remaining){
        await new Promise(requestAnimationFrame)
        if(mode!=='walk'&&viewer.heli.phase!=='cruise')break
        if(last===viewer.stats.frame)continue
        last=viewer.stats.frame
        rows.push(stats.map(key=>viewer.stats[key]))
      }
      return rows
    },{mode,remaining,stats})
  }
  const command=(action,fields)=>page.evaluate(async body=>(await fetch('/api/helicopter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json(),{action,...fields})
  const phase=name=>page.waitForFunction(name=>window.viewer.heli.phase===name,name,{timeout:180000})
  await pool.query(`UPDATE player_saves SET payload_json=jsonb_set(payload_json::jsonb,'{money}','1000000')::text`)
  for(const mode of ['walk','low','high','dynamic']){
    const rows=[]
    while(rows.length<count){
      if(mode!=='walk'){
        await page.evaluate(()=>window.viewer.walkTo(-805.8,257.6,-1.57,'benchmark'))
        const joined=await command('join',{mode});assert.ok(joined.mine?.offered)
        assert.ok((await command('confirm',{ticket:joined.mine.ticket})).flight)
        api.advance(30000);await phase('cruise')
      }
      if(process.env.HELI_PROFILE_DRAWS)await page.evaluate(()=>{window.heliDrawBins={}})
      rows.push(...await sample(mode,count-rows.length))
      if(process.env.HELI_PROFILE_DRAWS){
        const bins=await page.evaluate(()=>{const bins=window.heliDrawBins;window.heliDrawBins=null;return bins})
        for(const index of [0,1])console.log('DRAW',mode,['calls','triangles'][index],JSON.stringify(Object.entries(bins).sort((a,b)=>b[1][index]-a[1][index]).slice(0,10)))
      }
      if(mode!=='walk'){api.advance(500000);await phase('idle')}
    }
    assert.ok(rows.flat().every(Number.isFinite),'missing frame profile')
    const means=Object.fromEntries(stats.map((key,index)=>[key,rows.reduce((sum,row)=>sum+row[index],0)/count]))
    console.log('PROFILE',JSON.stringify({mode,count,...means,fps:1000/means.ms}))
  }
}
