export const flatDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
export function inEmoteRange(a, b) {
  return flatDistance(a, b) <= 256
}
export function acceptEmote(player, msg, now) {
  if (
    !Number.isInteger(msg.id) ||
    msg.id < 0 ||
    msg.id > 255 ||
    !Number.isSafeInteger(msg.s) ||
    msg.s <= player.es ||
    (msg.id === 0 && !player.em)
  )
    return false
  if (msg.id !== 0) {
    player.emoteTimes = player.emoteTimes.filter((t) => now - t < 1000)
    if (player.emoteTimes.length >= 2) return false
    player.emoteTimes.push(now)
  }
  player.em = msg.id
  player.es = msg.s
  player.emoteUntil = now + ([0, 4000, 3000, 4250][msg.id] ?? 4000)
  return true
}
