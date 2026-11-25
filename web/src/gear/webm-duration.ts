// MediaRecorder 吐的 WebM 是"直播式"的：Segment 长度未知、Info 里没有 Duration、也没有 Cues。
// Chrome 标签页能播，但不少系统播放器显示时长 0 / 拖不动进度 / 直接说文件损坏（IDOK-383）。
// 这里只做最小改动：在 Segment/Info 里补一个 Duration（float64），其余字节原样保留。
// 结构对不上（Segment 长度已知、Info 已有 Duration、头不在前 64 KB 里…）就原样返回，绝不写坏文件。

const SEGMENT = 0x18538067
const INFO = 0x1549a966
const DURATION = 0x4489
const TIMECODE_SCALE = 0x2ad7b1

interface Vint {
  length: number
  value: number
  unknown: boolean
}

function vint(bytes: Uint8Array, at: number, keepMarker: boolean): Vint | null {
  if (at >= bytes.length) return null
  const first = bytes[at]
  let length = 1
  let mask = 0x80
  while (length <= 8 && !(first & mask)) {
    mask >>= 1
    length++
  }
  if (length > 8 || at + length > bytes.length) return null
  let value = keepMarker ? first : first & (mask - 1)
  let allOnes = (first & (mask - 1)) === mask - 1
  for (let k = 1; k < length; k++) {
    value = value * 256 + bytes[at + k]
    if (bytes[at + k] !== 0xff) allOnes = false
  }
  return {length, value, unknown: !keepMarker && allOnes}
}

function writeVint(value: number, length: number): Uint8Array | null {
  if (value >= 2 ** (7 * length) - 1) return null
  const out = new Uint8Array(length)
  let rest = value
  for (let k = length - 1; k >= 0; k--) {
    out[k] = rest % 256
    rest = Math.floor(rest / 256)
  }
  out[0] |= 0x80 >> (length - 1)
  return out
}

/** 给 WebM 头补 Duration。返回新的头部字节和它替换掉的原头部长度；无法安全修补时返回 null。 */
export function patchWebmHead(head: Uint8Array, durationMs: number): {head: Uint8Array; replaced: number} | null {
  if (!(durationMs > 0)) return null
  // EBML 头
  const ebmlId = vint(head, 0, true)
  if (!ebmlId || ebmlId.value !== 0x1a45dfa3) return null
  const ebmlSize = vint(head, ebmlId.length, false)
  if (!ebmlSize || ebmlSize.unknown) return null
  let at = ebmlId.length + ebmlSize.length + ebmlSize.value
  // Segment：MediaRecorder 写的是未知长度，补字节不用改它；已知长度就不碰
  const segId = vint(head, at, true)
  if (!segId || segId.value !== SEGMENT) return null
  const segSize = vint(head, at + segId.length, false)
  if (!segSize || !segSize.unknown) return null
  at += segId.length + segSize.length
  // 在 Segment 顶层找 Info
  while (at < head.length) {
    const id = vint(head, at, true)
    if (!id) return null
    const size = vint(head, at + id.length, false)
    if (!size || size.unknown) return null
    const body = at + id.length + size.length
    const end = body + size.value
    if (id.value !== INFO) {
      at = end
      continue
    }
    if (end > head.length) return null
    let scale = 1000000
    for (let p = body; p < end;) {
      const childId = vint(head, p, true)
      const childSize = childId && vint(head, p + childId.length, false)
      if (!childId || !childSize || childSize.unknown) return null
      const data = p + childId.length + childSize.length
      if (childId.value === DURATION) return null
      if (childId.value === TIMECODE_SCALE) {
        scale = 0
        for (let k = 0; k < childSize.value; k++) scale = scale * 256 + head[data + k]
      }
      p = data + childSize.value
    }
    if (!(scale > 0)) return null
    const element = new Uint8Array(11)
    element.set([0x44, 0x89, 0x88])
    new DataView(element.buffer).setFloat64(3, (durationMs * 1000000) / scale)
    const newSize = writeVint(size.value + element.length, size.length)
    if (!newSize) return null
    const sizeAt = at + id.length
    const out = new Uint8Array(end + element.length)
    out.set(head.subarray(0, sizeAt), 0)
    out.set(newSize, sizeAt)
    out.set(head.subarray(body, end), body)
    out.set(element, end)
    return {head: out, replaced: end}
  }
  return null
}

export async function withWebmDuration(blob: Blob, durationMs: number): Promise<Blob> {
  try {
    const head = new Uint8Array(await blob.slice(0, Math.min(blob.size, 65536)).arrayBuffer())
    const patched = patchWebmHead(head, durationMs)
    if (!patched) return blob
    return new Blob([patched.head as BlobPart, blob.slice(patched.replaced)], {type: blob.type})
  } catch {
    return blob
  }
}
