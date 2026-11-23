import * as THREE from 'three'
import {createCharacter as buildCharacter, FACES, PANTS, SHOES, TOPS, type Character, type PieceRef, type PoseState} from './model'

// 角色目录与配置：性别 → 四个脸型 → 上衣 / 裤子 / 鞋子。
// 模型来自 Quaternius 模块化人物（CC0），四块网格可跨套装拼装。

export type Gender = 'male' | 'female'

export interface CharacterConfig {
  gender: Gender
  face: number
  top: number
  pants: number
  shoes: number
}

export const DEFAULT_CHARACTER: CharacterConfig = {gender: 'female', face: 0, top: 0, pants: 0, shoes: 0}

const genderOf = (pack: string): Gender => (pack.startsWith('modular_men') ? 'male' : 'female')

export function facesFor(gender: Gender) {
  return FACES.filter(face => face.gender === gender)
}
export function topsFor(gender: Gender) {
  return TOPS.filter(item => genderOf(item.pack) === gender)
}
export function pantsFor(gender: Gender) {
  return PANTS.filter(item => genderOf(item.pack) === gender)
}
export function shoesFor(gender: Gender) {
  return SHOES.filter(item => genderOf(item.pack) === gender)
}

export function faceFor(gender: Gender, index: number) {
  const list = facesFor(gender)
  return list[((index % list.length) + list.length) % list.length]
}

export function normalize(input: Partial<CharacterConfig>): CharacterConfig {
  const gender: Gender = input.gender === 'male' ? 'male' : 'female'
  const clampIndex = (value: unknown, length: number) => {
    const n = Number(value)
    return Number.isFinite(n) ? ((Math.round(n) % length) + length) % length : 0
  }
  return {
    gender,
    face: clampIndex(input.face, facesFor(gender).length),
    top: clampIndex(input.top, topsFor(gender).length),
    pants: clampIndex(input.pants, pantsFor(gender).length),
    shoes: clampIndex(input.shoes, shoesFor(gender).length),
  }
}

export function describe(config: CharacterConfig) {
  const face = faceFor(config.gender, config.face)
  return {
    name: face.name,
    gender: config.gender === 'male' ? '男' : '女',
    top: topsFor(config.gender)[config.top % topsFor(config.gender).length].name,
    pants: pantsFor(config.gender)[config.pants % pantsFor(config.gender).length].name,
    shoes: shoesFor(config.gender)[config.shoes % shoesFor(config.gender).length].name,
  }
}

export function piecesFor(config: CharacterConfig): PieceRef[] {
  const normalized = normalize(config)
  return [
    {pack: faceFor(normalized.gender, normalized.face).pack, kind: 'Head'},
    {pack: topsFor(normalized.gender)[normalized.top].pack, kind: 'Body'},
    {pack: pantsFor(normalized.gender)[normalized.pants].pack, kind: 'Legs'},
    {pack: shoesFor(normalized.gender)[normalized.shoes].pack, kind: 'Feet'},
  ]
}

export async function createCharacter(config: CharacterConfig, height = 1.7): Promise<Character> {
  return buildCharacter(piecesFor(config), height)
}

const STORAGE_KEY = 'glol.character.v2'

export function readCharacter(): CharacterConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {...DEFAULT_CHARACTER}
    return normalize(JSON.parse(raw) as Partial<CharacterConfig>)
  } catch {
    return {...DEFAULT_CHARACTER}
  }
}

export function writeCharacter(config: CharacterConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalize(config)))
  } catch {}
}

/** 菜单/角色界面里换人时，先在这条事件上广播，游戏里的步行角色会就地重建。 */
export function broadcast(config: CharacterConfig) {
  window.dispatchEvent(new CustomEvent('glol:character', {detail: normalize(config)}))
}

export {FACES, TOPS, PANTS, SHOES}
export type {Character, PoseState, PieceRef}
export type {Gender as CharacterGender}
export {THREE}
