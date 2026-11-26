import assert from 'node:assert/strict'
import test from 'node:test'
import {stationRoofDepth,tunnelCeiling} from '../web/src/station-tunnels.ts'

test('camera follows the sloping covered bore, not its open approaches or upper street',()=>{
  const section={way:1,portals:[[0,100,0],[100,105,0]],length:100,halfWidth:4,clearance:4.5,approach:0,
    openEnds:[10,20],stations:[[0,100],[100,105]]}
  assert.equal(tunnelCeiling([section],50,1,102.5),102.5+4.5-stationRoofDepth)
  for(const [x,z,foot] of [[5,0,100],[90,0,104.5],[50,5,102.5],[50,1,107],[50,1,90]])
    assert.equal(tunnelCeiling([section],x,z,foot),Infinity)
  assert.equal(tunnelCeiling([{...section,openCut:true}],50,1,102.5),Infinity)
})
