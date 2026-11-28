import * as THREE from 'three'

// IDOK-529/530: 自动返航 draws a green flight path home in the 3D view plus pulses that run along it,
// so the pilot can see where the aircraft is going instead of only reading 「返航中」.
// IDOK-530: the path ends in a light column that goes all the way down to the ground — the pilot can
// tell exactly which rooftop / street corner the aircraft is aiming at from far away.
export interface RouteView {
  root:THREE.Group
  update(from:THREE.Vector3, to:THREE.Vector3, active:boolean, elapsed:number, ground:number):void
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

  // 光柱：半径 1、高 1 的圆柱，每帧按「目标高度 → 地面」拉伸，看起来是一根落到地面的绿光。
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(.55,.95,1,14,1,true),
    new THREE.MeshBasicMaterial({
      color:GREEN,transparent:true,opacity:.28,depthWrite:false,side:THREE.DoubleSide,
    }),
  )
  pillar.frustumCulled = false
  pillar.renderOrder = 5

  // 地面上的落点圈，告诉飞行员「就是这里」。
  const pad = new THREE.Mesh(
    new THREE.RingGeometry(1.6,2.4,26),
    new THREE.MeshBasicMaterial({color:GREEN,transparent:true,opacity:.6,depthWrite:false,side:THREE.DoubleSide}),
  )
  pad.rotation.x = -Math.PI / 2
  pad.frustumCulled = false
  pad.renderOrder = 6

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
  root.add(line,pillar,pad)
  root.visible = false
  scene.add(root)

  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const mid = new THREE.Vector3()
  const point = new THREE.Vector3()
  let floorY = 0

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
    update(from,to,active,elapsed,ground) {
      if (!active) { root.visible = false; return }
      root.visible = true
      a.copy(from)
      b.copy(to)
      b.y = Math.max(from.y,to.y) + .6
      floorY = Number.isFinite(ground) ? Math.min(ground,b.y - .4) : b.y - 30
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
      // 光柱从航线终点竖直落到地面，地面圈就是落点。
      const height = Math.max(.5,b.y - floorY)
      pillar.position.set(b.x,(b.y + floorY) / 2,b.z)
      pillar.scale.set(1,height,1)
      pad.position.set(to.x,floorY + .08,to.z)
      ;(pad.material as THREE.MeshBasicMaterial).opacity = .45 + Math.sin(elapsed * 2.2) * .18
      for (let i = 0;i < dots.length;i++) {
        // 前 3/4 的行程在弧线上，剩下 1/4 顺着光柱冲进地面。
        const t = (elapsed * .22 + i / dots.length) % 1
        if (t < .82) place(t / .82,point)
        else {
          const k = (t - .82) / .18
          point.set(b.x,b.y - k * height,b.z)
        }
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
      pillar.geometry.dispose()
      ;(pillar.material as THREE.Material).dispose()
      pad.geometry.dispose()
      ;(pad.material as THREE.Material).dispose()
      for (const dot of dots) {
        dot.geometry.dispose()
        ;(dot.material as THREE.Material).dispose()
      }
      root.clear()
    },
  }
}
