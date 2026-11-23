import assert from 'node:assert/strict'

export async function citizenTest({origin,me,cookie,sql,api}) {
  const photo=Buffer.from('UklGRhoAAABXRUJQVlA4TA4AAAAvAUAAAAcQEf0PRET/Aw==','base64')
  const read=async path=>fetch(`${origin}/api/citizen/${path}`)
  const card=async uid=>(await read(uid)).json()
  const post=(body=photo,path='photo',headers={})=>fetch(`${origin}/api/citizen/${path}`,{method:'POST',body,duplex:'half',
    headers:{Origin:origin,Cookie:cookie,'Content-Type':'image/webp',...headers}})
  const first=await card(me.uid)
  assert.deepEqual(first,{uid:me.uid,nickname:me.nickname,registeredAt:first.registeredAt,gender:null,photoUrl:null})
  assert.ok(Number.isInteger(first.registeredAt)&&first.registeredAt>0)
  assert.equal((await read(`${me.uid}/photo`)).status,404)
  assert.equal((await read('1000000000')).status,404)
  const other=(await sql(`INSERT INTO users(id,email,nickname,salt,digest,verified) VALUES('bag-test','bag@example.test','other','','',1) RETURNING uid`))[0].results[0].uid
  assert.equal((await post(photo,'photo',{Cookie:''})).status,401)
  assert.equal((await post(photo,'photo',{Origin:'https://example.test'})).status,403)
  assert.equal((await post(photo,`photo?uid=${other}`)).status,400)
  assert.equal((await post(photo,`${other}/photo`)).status,405)
  assert.equal((await post(photo,'photo',{'Content-Type':'image/png'})).status,415)
  assert.equal((await post(Buffer.from('not a webp'))).status,400)
  assert.equal((await post(Buffer.alloc(65537))).status,413)
  const stream=new ReadableStream({start(controller){controller.enqueue(Buffer.alloc(65536));controller.enqueue(Buffer.alloc(1));controller.close()}})
  assert.equal((await post(stream)).status,413)
  const avatar={v:1,body:'f',createdAt:1}
  await api('me/avatar',{avatar},200,null,{method:'PUT'})
  assert.equal((await card(me.uid)).gender,'f')
  const full=Buffer.alloc(65536);photo.copy(full);full.writeUInt32LE(full.length-8,4)
  full.write('JUNK',photo.length);full.writeUInt32LE(full.length-photo.length-8,photo.length+4)
  assert.equal((await post(full)).status,200)
  const pic=await fetch(origin+(await card(me.uid)).photoUrl)
  assert.equal(pic.headers.get('content-type'),'image/webp');assert.deepEqual(Buffer.from(await pic.arrayBuffer()),full)
  const statuses=await Promise.all(Array.from({length:6},async()=>(await post()).status))
  assert.deepEqual(statuses.sort(),[200,200,200,200,200,429])
  assert.equal((await card(other)).photoUrl,null)
  await sql(`DELETE FROM player_saves WHERE user_id='${me.id}'; DELETE FROM users WHERE id='bag-test'`)
  console.log('Citizen: anonymous five-field card, avatar gender, owner-only WebP, 64 KiB boundary, MinIO round trip and concurrent rate limit passed')
}
