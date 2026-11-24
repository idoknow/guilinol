import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {gunzipSync} from 'node:zlib'

const directory=process.argv[2]??'dist/world'
const manifest=JSON.parse(readFileSync(join(directory,'manifest.json')))
const footprints=JSON.parse(readFileSync(new URL('../pipeline/dam-cells.json',import.meta.url)))
const required=new Set(['way/1008909377','way/1008909373'])
for(const [id,runs] of Object.entries(footprints)){
  let checked=0
  for(const tile of manifest.chunks){
    const relevant=runs.filter(([row,start,end])=>row*4>=tile.z&&row*4<=tile.z+256&&end*4>=tile.x&&start*4<=tile.x+256)
    if(!relevant.length)continue
    const buffer=readFileSync(join(directory,tile.file));assert.equal(buffer.length,tile.bytes)
    const data=gunzipSync(buffer)
    for(const [row,start,end] of relevant)for(let col=start;col<=end;col++){
      if(col*4<tile.x||col*4>tile.x+256)continue
      const index=(row-tile.z/4)*65+col-tile.x/4
      assert.equal(data.readInt16LE(8474+2*index),-32768,`${id} still wet at ${col},${row}`);checked++
    }
  }
  if(checked)required.delete(id)
  console.log(`${id}: ${checked} dry samples`)
}
assert.equal(required.size,0,'Both acceptance sites must be present')
