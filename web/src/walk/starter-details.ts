import * as T from 'three'
import {type Avatar} from '../../../lib/avatar'
import type {AvatarRig} from './avatar-rig'
import type {EquippedOutfit} from '../game/catalog'

/** Small pieces are rigid in the rest frame of the bone they follow. */
export function starterDetails(rig: AvatarRig, avatar: Avatar) {
  const chest = rig.attachments.torso!
  const pieces: {mesh: T.Mesh; slot: 'top' | 'bottom'; id: string}[] = []
  function part(
    slot: 'top' | 'bottom',
    look: string,
    bone: string,
    geo: T.BufferGeometry,
    color: string,
    x: number,
    y: number,
    z: number,
  ) {
    const mat = new T.MeshStandardMaterial({color, roughness: 1, side: T.DoubleSide})
    const mesh = new T.Mesh(geo, mat)
    mesh.position.set(x, y, z)
    mesh.visible = false
    const anchor = bone === 'chest' ? chest : rig.attachmentAt!(bone)!
    anchor.add(mesh)
    pieces.push({mesh, slot, id: slot + '_starter_' + look})
    return mesh
  }
  function collar(look: string, color: string, height: number) {
    const geo = new T.CylinderGeometry(0.064, 0.068, height, 20, 1, true)
    geo.scale(1, 1, 0.9)
    part('top', look, 'chest', geo, color, 0, 0.34, 0.024)
  }
  const hood = part(
    'top',
    'chinese',
    'chest',
    new T.SphereGeometry(0.096, 12, 8),
    avatar.body === 'f' ? '#ceb6ba' : '#9fb8c8',
    0,
    0.247,
    0.091,
  )
  hood.scale.set(1, 0.92, 0.44)
  hood.rotation.x = -0.24
  part('top', 'chinese', 'chest', new T.BoxGeometry(0.005, 0.32, 0.008), '#82989e', 0, 0.138, -0.113)
  collar('office', '#d4d6cb', 0.035)
  collar('campus', '#536e90', 0.031)
  for (const side of [-1, 1]) {
    const lapel = part(
      'top',
      'office',
      'chest',
      new T.BoxGeometry(0.027, 0.072, 0.012),
      '#d9d9ce',
      side * 0.036,
      0.293,
      -0.083,
    )
    lapel.rotation.z = -side * 0.54
  }
  // IDOK-229 present-day looks.
  const hoodie = part('top', 'hoodie', 'chest', new T.SphereGeometry(0.1, 12, 8), '#8f918d', 0, 0.25, 0.088)
  hoodie.scale.set(1.05, 0.95, 0.5)
  hoodie.rotation.x = -0.24
  for (const side of [-1, 1])
    part('top', 'hoodie', 'chest', new T.BoxGeometry(0.008, 0.09, 0.008), '#e9e6de', side * 0.028, 0.255, -0.098)
  collar('shell', '#262b2e', 0.06)
  collar('track', '#28344a', 0.04)
  for (const [look, color] of [
    ['denim', '#62809d'],
    ['plaid', '#8a382f'],
  ] as const)
    for (const side of [-1, 1]) {
      const flap = part('top', look, 'chest', new T.BoxGeometry(0.05, 0.075, 0.012), color, side * 0.05, 0.3, -0.08)
      flap.rotation.z = -side * 0.62
      flap.rotation.x = 0.18
    }
  return {
    apply(outfit: Readonly<EquippedOutfit>) {
      for (const p of pieces) p.mesh.visible = outfit[p.slot] === p.id
    },
    dispose() {
      for (const {mesh} of pieces) {
        mesh.removeFromParent()
        mesh.geometry.dispose()
        ;(mesh.material as T.Material).dispose()
      }
    },
  }
}
