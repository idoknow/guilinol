import * as THREE from 'three'
import type { XxgCrowdAgent } from './crowd.ts'

type Street = typeof import('../../traffic/crowd.ts')
type Character = typeof import('../../walk/character.ts')
type Template = import('../../traffic/crowd.ts').PasserbyTemplate
type Gait = import('../../traffic/crowd.ts').PasserbyGait

/**
 * 小香港 B1 的行人画面：和主线街道同一套路人（IDOK-229/253 带骨骼角色、年龄段穿搭、学生书包、走/站动作混合）。
 * - 模板在挂载时（玩家还在地面）按槽位逐个建好并编译着色器；角色代码懒加载，室内块和 node 测试都不带它。
 * - 视锥外的人整个隐藏，不占 draw call；视锥内按距离由近到远计入预算，超出 draw call / 三角面预算的远处行人这一帧不画。
 */
export interface XxgCrowdFiguresMetrics {
  /** 已建好的外观槽位数。 */
  readonly looks: number
  /** 这一帧画出的人数。 */
  readonly shown: number
  readonly drawCalls: number
  readonly triangles: number
}

export interface XxgCrowdFiguresBudget {
  readonly drawCalls: number
  readonly triangles: number
}

export interface XxgCrowdFigures {
  readonly group: THREE.Group
  /** Builds every look slot (one passer-by each), then compiles their shaders against `scene`. Safe to skip; figures just stay hidden. */
  prepare(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<void>
  sync(agents: readonly XxgCrowdAgent[], dt: number, camera: THREE.Camera, budget: XxgCrowdFiguresBudget): void
  getMetrics(): XxgCrowdFiguresMetrics
  dispose(): void
}

interface Look {
  readonly template: Template
  readonly drawCalls: number
  readonly triangles: number
}

interface View extends Gait {
  readonly root: THREE.Group
  readonly look: number
  animAcc: number
}

/** Draw calls and triangles one passer-by costs when fully in view. */
function measure(root: THREE.Object3D): { drawCalls: number; triangles: number } {
  let drawCalls = 0
  let triangles = 0
  root.traverse(node => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    for (let p: THREE.Object3D | null = mesh; p && p !== root.parent; p = p.parent) if (!p.visible) return
    const g = mesh.geometry
    const groups = Array.isArray(mesh.material) ? Math.max(1, g.groups.length) : 1
    drawCalls += groups
    triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3
  })
  return { drawCalls, triangles: Math.round(triangles) }
}

export function createXxgCrowdFigures(opts: { readonly slots: number; readonly seed?: number }): XxgCrowdFigures {
  const group = new THREE.Group()
  group.name = 'xxg_crowd'
  const slots = Math.max(1, Math.floor(opts.slots))
  const looks: (Look | undefined)[] = new Array(slots)
  const views = new Map<XxgCrowdAgent, View>()
  let street: Street | null = null
  let character: Character | null = null
  let disposed = false
  let shown = 0
  let drawCalls = 0
  let triangles = 0
  let seed = (opts.seed ?? 0x2290) >>> 0
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const frustum = new THREE.Frustum()
  const proj = new THREE.Matrix4()
  const bound = new THREE.Sphere()
  const cam = new THREE.Vector3()

  const prepare = async (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => {
    if (street || disposed) return
    try {
      ;[street, character] = await Promise.all([import('../../traffic/crowd.ts'), import('../../walk/character.ts')])
      for (let i = 0; i < slots && !disposed; i++) {
        const template = await street.buildPasserby(street.randomPasserby(random), random)
        if (disposed) {
          character.disposeCharacterParts(template.scene)
          return
        }
        looks[i] = { template, ...measure(template.scene) }
      }
      // Shaders compile while the player is still upstairs; the swap-in frame only draws.
      const staged = looks.filter((l): l is Look => Boolean(l)).map(l => l.template.scene)
      group.add(...staged)
      try {
        if (typeof renderer.compileAsync === 'function') await renderer.compileAsync(scene, camera)
        else renderer.compile(scene, camera)
      } finally {
        group.remove(...staged)
      }
    } catch (error) {
      console.warn('xxg passers-by unavailable', error)
    }
  }

  const release = (agent: XxgCrowdAgent, view: View) => {
    views.delete(agent)
    view.root.removeFromParent()
    view.mixer.stopAllAction()
    view.root.traverse(node => {
      if ((node as THREE.SkinnedMesh).isSkinnedMesh) (node as THREE.SkinnedMesh).skeleton.dispose()
    })
  }

  /** The agent's own slot if no one else wears it, else the least-worn ready slot. */
  const pickLook = (agent: XxgCrowdAgent): number => {
    const worn = new Array<number>(slots).fill(0)
    for (const v of views.values()) worn[v.look]!++
    let best = -1
    for (let k = 0; k < slots; k++) {
      const i = (agent.look + k) % slots
      if (!looks[i]) continue
      if (best < 0 || worn[i]! < worn[best]!) best = i
      if (worn[i] === 0) break
    }
    return best
  }

  const build = (agent: XxgCrowdAgent): View | undefined => {
    if (!street) return
    const look = pickLook(agent)
    if (look < 0) return
    const gait = street.passerbyInstance(looks[look]!.template, agent.speed)
    const root = new THREE.Group()
    root.name = 'xxg passer-by'
    root.add(gait.instance)
    group.add(root)
    const view: View = { ...gait, root, look, animAcc: 0 }
    views.set(agent, view)
    return view
  }

  const sync = (agents: readonly XxgCrowdAgent[], dt: number, camera: THREE.Camera, budget: XxgCrowdFiguresBudget) => {
    shown = 0
    drawCalls = 0
    triangles = 0
    if (disposed || !street) return
    const live = new Set(agents)
    for (const [agent, view] of views) if (!live.has(agent)) release(agent, view)

    camera.updateMatrixWorld()
    proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(proj)
    camera.getWorldPosition(cam)
    const inView: { view: View; distSq: number }[] = []
    for (const agent of agents) {
      const view = views.get(agent) ?? build(agent)
      if (!view) continue
      const { root } = view
      root.position.set(agent.x, 0, agent.z)
      // figure.glb faces −z; the walker heads along (sin yaw, cos yaw).
      root.rotation.y = agent.yaw + Math.PI
      const prevWeight = view.walkWeight
      street.passerbyGait(view, agent.speed, dt)
      bound.center.set(agent.x, 0.9, agent.z)
      bound.radius = 1.8
      root.visible = false
      if (!frustum.intersectsSphere(bound)) {
        view.animAcc = Math.min(0.5, view.animAcc + dt)
        continue
      }
      const distSq = (agent.x - cam.x) ** 2 + (agent.z - cam.z) ** 2
      // Same cadence as the street: far and settled figures animate at 25 Hz.
      if (distSq > 2025 && Math.abs(view.walkWeight - prevWeight) <= 1e-4) {
        view.animAcc += dt
        if (view.animAcc >= 0.04) {
          view.mixer.update(view.animAcc)
          view.animAcc = 0
        }
      } else {
        view.mixer.update(dt + view.animAcc)
        view.animAcc = 0
      }
      inView.push({ view, distSq })
    }
    inView.sort((a, b) => a.distSq - b.distSq)
    for (const { view } of inView) {
      const look = looks[view.look]!
      if (drawCalls + look.drawCalls > budget.drawCalls || triangles + look.triangles > budget.triangles) break
      view.root.visible = true
      shown++
      drawCalls += look.drawCalls
      triangles += look.triangles
    }
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const [agent, view] of views) release(agent, view)
    group.removeFromParent()
    for (let i = 0; i < slots; i++) {
      const look = looks[i]
      looks[i] = undefined
      if (look) character?.disposeCharacterParts(look.template.scene)
    }
  }

  return {
    group,
    prepare,
    sync,
    getMetrics: () => ({ looks: looks.filter(Boolean).length, shown, drawCalls, triangles }),
    dispose,
  }
}
