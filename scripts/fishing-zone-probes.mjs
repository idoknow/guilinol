import assert from 'node:assert/strict'

function sampleZone(id){
  const {fishing,viewer}=window, zone=fishing.waters.find(water=>water.id===id)
  const tiles=new Map(), key=(west,north)=>`${west},${north}`
  for(const [tile,data] of viewer.stream.loaded){
    if(!data.batch.pond||Math.abs(tile.x+128-zone.spot.x)>300||Math.abs(tile.z+128-zone.spot.z)>300)continue
    const faces=new Map(),pond=data.batch.pond
    for(let offset=0;offset<pond.length;offset+=9){
      const west=Math.floor((pond[offset]+pond[offset+3]+pond[offset+6])/12)*4
      const north=Math.floor((pond[offset+2]+pond[offset+5]+pond[offset+8])/12)*4
      const cell=key(west,north),list=faces.get(cell)??[];list.push(offset);faces.set(cell,list)
    }
    tiles.set(key(tile.x,tile.z),{data,faces})
  }
  function checkPoint(x,z){
    const west=Math.floor(x/256)*256,north=Math.floor(z/256)*256,entry=tiles.get(key(west,north))
    if(!entry)throw Error(`${id}: no rendered tile`)
    const {data,faces}=entry,pond=data.batch.pond,col=(x-west)/4,row=(z-north)/4
    if(data.water[Math.round(row)*65+Math.round(col)]===-32768)throw Error(`${id}: dry mask`)
    const ground=data.groundMesh.geometry.attributes.position,corner=Math.floor(row)*65+Math.floor(col)
    const right=col%1,down=row%1
    const bed=right+down<1?ground.getY(corner)*(1-right-down)+ground.getY(corner+1)*right+ground.getY(corner+65)*down:
      ground.getY(corner+66)*(right+down-1)+ground.getY(corner+1)*(1-down)+ground.getY(corner+65)*(1-right)
    for(const offset of faces.get(key(Math.floor(x/4)*4,Math.floor(z/4)*4))??[]){
      const dx=x-pond[offset],dz=z-pond[offset+2],ax=pond[offset+3]-pond[offset],az=pond[offset+5]-pond[offset+2],bx=pond[offset+6]-pond[offset],bz=pond[offset+8]-pond[offset+2]
      const det=ax*bz-az*bx,first=(dx*bz-dz*bx)/det,second=(ax*dz-az*dx)/det
      if(first>=-1e-7&&second>=-1e-7&&first+second<=1.0000001){
        const surface=pond[offset+1]*(1-first-second)+pond[offset+4]*first+pond[offset+7]*second
        if(surface>bed)return surface
      }
    }
    throw Error(`${id}: no visible water at ${x},${z}`)
  }
  let seed=367,valid=0,attempts=0
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32)
  while(valid<2000&&attempts++<100000){
    const bank=zone.banks[Math.floor(random()*zone.banks.length)],angle=bank.yaw+(random()-.5)*Math.PI,range=4+26*random()
    const x=bank.x+Math.sin(angle)*range,z=bank.z+Math.cos(angle)*range,height=fishing.waterAt(x,z)
    if(height===null)continue
    if(Math.abs(checkPoint(x,z)-height)>.01)throw Error(`${id}: wrong cast height`)
    for(let spoke=0;spoke<16;spoke++)checkPoint(x+Math.sin(spoke*Math.PI/8),z+Math.cos(spoke*Math.PI/8))
    valid++
  }
  return {id,valid,attempts}
}

export async function verifyZones(page){
  const ids=await page.evaluate(()=>window.fishing.waters.map(zone=>zone.id))
  for(const [index,id] of ids.entries()){
    assert(await page.evaluate(async id=>{
      const {fishing}=window,zone=fishing.waters.find(row=>row.id===id)
      for(let index=1;index<zone.banks.length;index++){
        if(await fishing.teleportToSpot(id,index)&&fishing.state().spot===id)return true
      }
      return false
    },id),`${id}: no castable bank`)
    console.log('bank ready',id)
    if(index<3){
      await page.keyboard.press('4');await page.waitForFunction(()=>window.fishing.state().phase==='equip')
      const actual=await page.evaluate(()=>{
        let cast;window.addEventListener('fishing:cast',event=>cast=event.detail,{once:true})
        if(!window.fishing.charge(1))return false
        return window.fishing.onLand(cast.from.x,cast.from.z)&&window.fishing.waterAt(cast.to.x,cast.to.z)===cast.to.y
      });assert(actual,id);await page.keyboard.press('4')
    }
    const result=await page.evaluate(sampleZone,id);assert.equal(result.valid,2000,JSON.stringify(result));console.log('zone probes',result)
  }
}
