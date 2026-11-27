import * as THREE from 'three'

// IDOK-529: 自动返航 draws a green flight path home in the 3D view plus pulses that run along it,
// so the pilot can see where the aircraft is going instead of only reading 「返航中」.
export interface RouteView {
  root:THREE.Group
  update(from:THREE.Vector3, to:THREE.Vector3, active:boolean, elapsed:number):void
  dispose():void
}

const GREEN = 0x3ddc84
const PULSES = 4

export function createRoute(scene:THREE.Scene):RouteView {
  const root = new THREE.Group()
  root.name = 'drone-route'
  root.renderOrder = 6

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(24 * 3),3))
  const line = new THREE.Line(geometry,new THREE.LineBasicMaterial({
    color:GREEN,transparent:true,opacity:.85,depthWrite:false,
  }))
  line.frustumCulled = false

  const dots:THREE.Mesh[] = []
  const dotGeometry = new THREE.SphereGeometry(.55,8,6)
  for (let i = 0;i < PULSES;i++) {
    const dot = new THREE.Mesh(dotGeometry,new THREE.MeshBasicMaterial({
      color:GREEN,transparent:true,opacity:.9,depthWrite:false,
    }))
    dot.frustumCulled = false
    dot.renderOrder = 7
    dots.push(dot)
    root.add(dot)
  }
  root.add(line)
  root.visible = false
  scene.add(root)

  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const mid = new THREE.Vector3()
  const point = new THREE.Vector3()

  function place(t:number,out:THREE.Vector3) {
    // Quadratic arc: a straight line reads as a laser, a lifted middle reads as a flight path.
    const it = 1 - t
    out.set(0,0,0)
      .addScaledVector(a,it * it)
      .addScaledVector(mid,2 * it * t)
      .addScaledVector(b,t * t)
  }

  return {
    root,
    update(from,to,active,elapsed) {
      if (!active) { root.visible = false; return }
      root.visible = true
      a.copy(from)
      b.copy(to)
      b.y = Math.max(from.y,to.y) + .6
      const span = Math.hypot(b.x - a.x,b.z - a.z)
      mid.set((a.x + b.x) * .5,(a.y + b.y) * .5 + Math.min(18,6 + span * .12),(a.z + b.z) * .5)
      // The line is split so the arc follows the lifted middle without a tube mesh.
      const segments = 22
      const attr = geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0;i <= segments;i++) {
        place(i / segments,point)
        attr.setXYZ(i,point.x,point.y,point.z)
      }
      geometry.setDrawRange(0,segments + 1)
      attr.needsUpdate = true
      geometry.computeBoundingSphere()
      for (let i = 0;i < dots.length;i++) {
        const t = (elapsed * .25 + i / dots.length) % 1
        place(t,point)
        dots[i].position.copy(point)
        // The head of the run is the bright one; the tail fades out behind it.
        const fade = i === 0 ? 1 : .55
        ;(dots[i].material as THREE.MeshBasicMaterial).opacity = fade
        dots[i].scale.setScalar(i === 0 ? 1.1 : .7)
      }
    },
    dispose() {
      scene.remove(root)
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
      for (const dot of dots) {
        dot.geometry.dispose()
        ;(dot.material as THREE.Material).dispose()
      }
      root.clear()
    },
  }
}
