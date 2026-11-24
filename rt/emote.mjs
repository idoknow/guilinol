export function sameCell(a, b) {
  return Math.floor(a.x / 256) === Math.floor(b.x / 256) && Math.floor(a.z / 256) === Math.floor(b.z / 256)
}
export function acceptEmote(player, msg, now) {
  if (
    !Number.isInteger(msg.id) ||
    msg.id < 0 ||
    msg.id > 255 ||
    !Number.isSafeInteger(msg.s) ||
    msg.s <= player.es
  )
    return false
  player.emoteTimes = player.emoteTimes.filter((t) => now - t < 1000)
  if (player.emoteTimes.length >= 2) return false
  player.emoteTimes.push(now)
  player.em = msg.id
  player.es = msg.s
  player.emoteUntil = now + ([0, 4000, 3000, 4250][msg.id] ?? 4000)
  return true
}
