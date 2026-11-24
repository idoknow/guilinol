import type {Object3D} from 'three'

export const MAIN_DETAIL_LAYER = 3

export function mainDetail(root:Object3D) {
  root.traverse(node=>node.layers.set(MAIN_DETAIL_LAYER))
  return root
}
