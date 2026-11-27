import * as THREE from 'three'

// IDOK-470: from hundreds of metres up, the middle of a free-flight view lands beyond the streaming
// radius around the camera, where unloaded tiles show the coarse overview terrain as a bare slab.
// Stream.tick() also streams around this point, moved from the camera toward where the view meets
// the ground. The shift never exceeds the height above ground (low flight adds nothing) or 60% of
// the radius (the extra ring stays next to the one around the camera).
const viewDirection = new THREE.Vector3()
export function flightFocus(camera:THREE.Camera, ground:number|undefined, radius:number, out=new THREE.Vector3()){
  out.copy(camera.position)
  if(ground===undefined)return out
  const height=camera.position.y-ground
  camera.getWorldDirection(viewDirection)
  const flat=Math.hypot(viewDirection.x,viewDirection.z)
  if(!(height>0)||flat<1e-3)return out
  const reach=viewDirection.y<0?height*flat/-viewDirection.y:Infinity
  const shift=Math.min(reach,height,radius*.6)
  out.x+=viewDirection.x/flat*shift
  out.z+=viewDirection.z/flat*shift
  return out
}
