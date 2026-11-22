import * as T from 'three'
import {skinTones, type Avatar} from '../../../lib/avatar'
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
  collar('chinese', '#cdc6b3', 0.044)
  for (const y of [0.15, 0.21, 0.27]) {
    part(
      'top',
      'chinese',
      'chest',
      new T.CapsuleGeometry(0.003, 0.047, 2, 5),
      '#78634b',
      0.005,
      y,
      -0.112,
    ).rotation.z = Math.PI / 2
    part('top', 'chinese', 'chest', new T.SphereGeometry(0.0055, 6, 4), '#695641', 0.022, y, -0.115)
  }
  const hood = new T.TorusGeometry(0.09, 0.025, 7, 18)
  const hoodie = part('top', 'sport', 'chest', hood, '#989b99', 0, 0.3, 0.055)
  hoodie.rotation.x = 0.93
  hoodie.scale.set(1, 0.82, 1)
  for (const side of [-1, 1]) {
    part('top', 'sport', 'chest', new T.CapsuleGeometry(0.003, 0.079, 2, 5), '#e3dfd5', side * 0.03, 0.25, -0.098)
    const leg = side === 1 ? 'r' : 'l'
    if (avatar.body === 'f')
      part(
        'bottom',
        'chinese',
        'calf_' + leg,
        new T.CylinderGeometry(0.045, 0.028, 0.43, 12),
        skinTones[avatar.skin],
        0,
        -0.216,
        0.018,
      )
    for (const [bone, y, len, x] of [
      ['thigh', -0.19, 0.35, 0.075],
      ['calf', -0.18, 0.34, 0.055],
    ] as const)
      part('bottom', 'sport', bone + '_' + leg, new T.BoxGeometry(0.008, len, 0.014), '#e1ddd3', side * x, y, 0)
    part(
      'bottom',
      'outdoor',
      'thigh_' + leg,
      new T.BoxGeometry(0.035, 0.105, 0.091),
      '#817a64',
      side * 0.067,
      -0.174,
      0.004,
    )
    part(
      'bottom',
      'outdoor',
      'thigh_' + leg,
      new T.BoxGeometry(0.038, 0.026, 0.099),
      '#716e5d',
      side * 0.071,
      -0.13,
      0.003,
    )
  }
  collar('outdoor', '#69765f', 0.055)
  part('top', 'outdoor', 'chest', new T.BoxGeometry(0.007, 0.32, 0.008), '#475647', 0, 0.135, -0.113)
  collar('campus', '#e1e1d8', 0.025)
  collar('office', '#e8e5d9', 0.035)
  for (const side of [-1, 1]) {
    const trim = part(
      'top',
      'office',
      'chest',
      new T.BoxGeometry(0.012, 0.101, 0.009),
      '#c0bcae',
      side * 0.028,
      0.266,
      -0.1,
    )
    trim.rotation.z = -side * 0.48
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
