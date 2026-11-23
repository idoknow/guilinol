import type * as THREE from 'three'

const noop = () => {}

/** Freeze static scene subtrees after placement so renderer.render skips per-frame matrix traversal. */
export function freezeStatic<T extends THREE.Object3D>(root: T): T {
  root.updateMatrixWorld(true)
  root.traverse(node => {
    node.matrixAutoUpdate = false
    node.matrixWorldAutoUpdate = false
  })
  root.updateMatrixWorld = noop
  return root
}
