/**
 * 抽烟姿势用到的固定位置（米，角色空间：-Z 朝前、+Y 朝上、+X 是角色右手边）。
 *
 * 单独放一个文件是为了避免 figure.ts ↔ kit.ts 互相 import。
 * 数字来自大概 1.75 m 高的角色模型：肩大约在 y=1.42、头骨 y=1.6，
 * 手臂两段合计约 0.52 m，所以下面这些点都在手够得到的地方。
 */

import * as THREE from 'three'

export const SMOKE_ANCHORS = {
  /** 左手托着烟盒的位置 */
  packL: new THREE.Vector3(-0.155, 1.19, -0.27),
  /** 右手拿打火机凑到烟上的位置（要在嘴唇高度，火焰才够得着烟头） */
  lighterR: new THREE.Vector3(0.035, 1.455, -0.185),
  /** 夹着烟、手放低一点的位置 */
  smokeR: new THREE.Vector3(0.13, 1.5, -0.44),
  /** 嘴相对头骨原点的偏移 */
  mouthFromHead: new THREE.Vector3(0.012, -0.062, -0.082),
} as const

/** 第一人称视角里道具的固定位置（相机空间） */
export const VIEW_ANCHORS = {
  /** 左手托烟盒 */
  handL: new THREE.Vector3(-0.085, -0.058, -0.36),
  /** 烟盒收回去时左手落到画面外 */
  restL: new THREE.Vector3(-0.2, -0.44, -0.3),
  /** 右手夹烟 */
  handR: new THREE.Vector3(0.13, -0.14, -0.35),
} as const
