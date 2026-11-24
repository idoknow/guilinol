import assert from 'node:assert/strict'
import R from '@dimforge/rapier3d-compat'
import {resolveContact,SolidGrid} from '../web/src/traffic/contact'
import {trafficPushGuard} from '../web/src/walk/traffic-push'

await R.init()
const world=new R.World({x:0,y:0,z:0})
const wall=world.createCollider(R.ColliderDesc.cuboid(.025,3,4).setTranslation(0,2,0))
const rider=world.createCollider(R.ColliderDesc.capsule(.56,.29))
world.step()
const guard=trafficPushGuard(world,rider,collider=>collider.handle===wall.handle,()=>false)
try {
  for(const [kind,width,length,start] of [['foot',.29,0,-.35],['bike',.32,.85,-.4],['car',.86,2.12,-.95]] as const){
    for(const blocked of [true,false]){
      const point={x:start,y:.85,z:blocked?0:8},legacy={...point}
      const grid=new SolidGrid(),truck={x:start-.1,y:0,z:point.z,yaw:0,halfWidth:2,halfLength:4,height:2,holdUntil:0}
      grid.add(truck)
      assert(resolveContact(legacy,0,0,width,length,grid.near));assert(legacy.x>0)
      assert(resolveContact(point,0,0,width,length,grid.near,guard));assert(truck.holdUntil>0)
      assert.equal(point.x,blocked?start:legacy.x)
      console.log(kind,blocked?'wall':'clear',JSON.stringify({before:legacy.x,after:point.x}))
    }
  }
} finally {world.free()}
