import assert from 'node:assert/strict'
import test from 'node:test'
import {gradeRenminShoulder} from '../web/src/ground-repair.ts'

test('Renmin Road shoulder meets the lane without moving water or neighbouring tiles',()=>{
  const field=new Int16Array(65*65).fill(1510),visible=field.slice(),water=new Int16Array(field.length).fill(-32768)
  const ctrl=[152950,Array(35*35).fill(0)],shoulder=32*65+32,wet=shoulder-1
  water[wet]=1480
  gradeRenminShoulder(-512,256,field,visible,water,ctrl)
  assert.equal(field[shoulder],1510)
  gradeRenminShoulder(-768,256,field,visible,water,ctrl)
  assert.equal(field[shoulder],1529)
  assert.equal(field[wet],1510)
  assert.equal(field[0],1510)
  assert.deepEqual(field,visible)
})
