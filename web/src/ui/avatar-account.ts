import {AVATAR_KEY, sanitizeAvatar, type Avatar} from '../../../lib/avatar'
import {cloneSave, flushThrottledSave, loadLocalSave, persistSaveSync} from '../game/save'
import {starterOutfit} from '../game/catalog'

async function request(a?: Avatar, equipStarter = false) {
  const res = await fetch(
    '/api/me/avatar',
    a ? {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({avatar: a, equipStarter})} : {},
  )
  if (!res.ok) throw Error('角色存档暂时无法同步，请重试')
  return sanitizeAvatar((await res.json()).avatar)
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

export async function accountCharacter(nickname: string, edit = false) {
  const previous = await request()
  if (previous && !edit) {
    const cached = sanitizeAvatar(loadLocalSave().save[AVATAR_KEY])
    mirror(previous, cached?.createdAt !== previous.createdAt || cached.look !== previous.look)
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
    !edit,
  )
}
