import type {Object3D} from 'three'

// `import.meta.env` is Vite's; node tests import this file without it.
const DEV = !!(import.meta as {env?: {DEV?: boolean}}).env?.DEV
/** Dev only: every this many misses, one deep search to catch a nested (never matching) object. */
const DEV_DEEP_CHECK_EVERY = 600

/**
 * Handle to a named object that is added straight under `root` (a shop, a rig, a marker group).
 *
 * `root.getObjectByName(name)` walks the whole graph below `root`. Asked every frame for an object
 * that is not loaded yet, it never finds anything and never stops walking: in the city that was a
 * third of the main thread (IDOK-399). This handle only looks at `root.children`, and only when it
 * has nothing cached or the cached object has left `root`.
 *
 * Use it for objects whose owner does `root.add(object)` itself. It does not see objects nested deeper.
 * Under `vite dev` it says so in the console when the name does exist deeper in the graph, so a
 * changed mount point is noticed instead of silently reading as "not loaded".
 */
export function namedChild(root: Object3D, name: string): () => Object3D | null {
  let hit: Object3D | null = null
  let misses = 0
  return () => {
    if (hit && hit.parent === root && hit.name === name) return hit
    hit = null
    const children = root.children
    for (let index = 0; index < children.length; index++) {
      if (children[index].name === name) {
        hit = children[index]
        break
      }
    }
    if (!hit && DEV && misses++ % DEV_DEEP_CHECK_EVERY === 0 && root.getObjectByName(name)) {
      console.warn(`[namedChild] "${name}" exists but is not a direct child of its root: namedChild will never return it. Add it with root.add(), or look it up another way.`)
    }
    return hit
  }
}
