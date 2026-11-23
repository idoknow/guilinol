import type {Env} from './auth'
import {AVATAR_KEY, sanitizeAvatar, type Avatar} from './avatar'

/**
 * 「关于」页的反馈贡献者（IDOK-186）：反馈一旦被反馈桥标记为「已上线」，提交人就自动出现在这里，
 * 不用再手改 web/src/ui/contributors.ts。只公开昵称、几个字的贡献和游戏角色外形，不含邮箱和账号 ID。
 */
export interface FeedbackContributor {name:string; avatar:Avatar|null; items:string[]}

const MAX_ITEMS = 6

export async function feedbackContributors(env:Env) {
  const {results} = await env.DB.prepare(
    `SELECT f.user_id,u.nickname,f.credit,f.title,p.payload_json FROM feedback f JOIN users u ON u.id=f.user_id
     LEFT JOIN player_saves p ON p.user_id=f.user_id WHERE f.status='live' ORDER BY f.updated_at,f.id`,
  ).bind().all<{user_id:string; nickname:string; credit:string|null; title:string; payload_json:string|null}>()
  const people = new Map<string, FeedbackContributor>()
  for (const row of results) {
    let person = people.get(row.user_id)
    if (!person) {
      let avatar:Avatar|null = null
      try { avatar = sanitizeAvatar(row.payload_json ? JSON.parse(row.payload_json)[AVATAR_KEY] : undefined) ?? null } catch {}
      person = {name: row.nickname, avatar, items: []}
      people.set(row.user_id, person)
    }
    const text = shorten(row.credit || row.title)
    if (text && !person.items.includes(text) && person.items.length < MAX_ITEMS) person.items.push(text)
  }
  return Response.json([...people.values()], {headers: {'Cache-Control': 'public, max-age=300'}})
}

/** 署名只要几个字：去掉标点首尾，最多 10 个字。 */
function shorten(text:string) {
  const chars = Array.from(text.trim().replace(/^[\s。，、！？.,!?]+|[\s。，、！？.,!?]+$/g, ''))
  return chars.length > 10 ? chars.slice(0, 10).join('') + '…' : chars.join('')
}
