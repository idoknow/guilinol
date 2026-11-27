import {AVATAR_KEY, sanitizeAvatar, type Avatar} from '../../../lib/avatar'
import { readJson } from '../lib/json'
import {cloneSave, flushThrottledSave, loadLocalSave, persistSaveSync} from '../game/save'
import {starterOutfit} from '../game/catalog'

async function request(a?: Avatar, equipStarter = false) {
  const res = await fetch(
    '/api/me/avatar',
    a ? {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({avatar: a, equipStarter})} : {},
  )
  if (!res.ok) throw Error('角色存档暂时无法同步，请重试')
  return sanitizeAvatar((await readJson<any>(res)).avatar)
}

function mirror(a: Avatar, equip: boolean) {
  flushThrottledSave()
  const save = cloneSave(loadLocalSave().save)
  save[AVATAR_KEY] = a
  if (equip) save.wardrobe.equipped = starterOutfit(a.look)
  save.updatedAt = Date.now()
  if (!persistSaveSync(save)) throw Error('本机存档写入失败，请重试')
  localStorage.setItem(AVATAR_KEY, JSON.stringify(a))
  loadLocalSave()
}

// IDOK-216: the title screen fetches the record early; the first non-edit entry reuses it if it is still fresh.
let early: {owner: string; at: number; value: Promise<Avatar | undefined>} | undefined
export function prefetchAvatar(owner: string) {
  if (!early) { const value = request(); value.catch(() => {}); early = {owner, at: Date.now(), value} }
}
function takeEarly(owner?: string) {
  const hit = early && owner === early.owner && Date.now() - early.at < 120_000 ? early.value : undefined
  early = undefined
  return hit
}

export async function accountCharacter(nickname: string, edit = false, owner?: string) {
  const prefetched = edit ? undefined : takeEarly(owner)
  const previous = prefetched ? await prefetched.catch(() => request()) : await request()
  if (previous && !edit) {
    const cached = sanitizeAvatar(loadLocalSave().save[AVATAR_KEY])
    if(JSON.stringify(cached)!==JSON.stringify(previous))mirror(previous, cached?.createdAt !== previous.createdAt || cached.look !== previous.look)
    else localStorage.setItem(AVATAR_KEY,JSON.stringify(previous))
    if (JSON.stringify(cached) !== JSON.stringify(previous))
      window.dispatchEvent(new CustomEvent('glol:avatar-change', {detail: previous}))
    return false
  }
  const {createCharacter} = await import('./creator')
  return createCharacter(
    nickname,
    previous,
    async (a,equipStarter) => {
      const saved = await request(a,equipStarter)
      if (!saved) throw Error('外形保存失败，请重试')
      mirror(saved, equipStarter || !previous || previous.look !== saved.look)
      window.dispatchEvent(new CustomEvent('glol:avatar-change', {detail: saved}))
    },
  )
}
