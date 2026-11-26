import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {traceRoutes} from '../server/trace-routes.mjs'

const post=body=>new Request('http://test/api/admin/trace',{method:'POST',body})
const pool={query:async()=>({rows:[]})}
const routes=traceRoutes(pool,{TRACE_SECRET:'test-only'})
test('generated PNG and JPEG quality 70 round-trip through upload',async()=>{
  const png=Buffer.from(await (await routes.traceTile(123)).arrayBuffer())
  assert.equal((await sharp(png).metadata()).width,512)
  for(const image of [png,await sharp(png).jpeg({quality:70}).toBuffer()]){
    const result=await (await routes.traceAdmin('admin/trace',post(image),'actor')).json()
    assert.equal(result.uid,123);assert.equal(result.to-result.from,300);assert.deepEqual(result.devices,[])
  }
  const other=traceRoutes({query:()=>assert.fail('no lookup before verification')},{TRACE_SECRET:'unrelated'})
  assert.equal((await (await other.traceAdmin('admin/trace',post(png),'actor')).json()).ok,false)
})
test('invalid upload, timed account ban and missing secret fail closed',async()=>{
  assert.equal((await routes.traceAdmin('admin/trace',post('bad'),'actor')).status,415)
  assert.equal((await routes.traceAdmin('admin/trace/action',post(JSON.stringify({uid:12,scope:'both',minutes:5,reason:'test'})),'actor')).status,422)
  assert.equal((await traceRoutes(pool,{}).traceTile(1)).status,503)
})
