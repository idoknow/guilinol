const interval = 300
const maximum = 0xffffffff

function crc16(bytes) {
  let crc = 0xffff
  for (const byte of bytes) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff
  }
  return crc
}

export function packTrace(uid, seconds) {
  if (!Number.isInteger(uid) || uid < 1 || uid > maximum) throw new RangeError('invalid uid')
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > maximum) throw new RangeError('invalid time')
  const payload = Buffer.alloc(13)
  payload.write('GL')
  payload[2] = 8
  payload.writeUInt32BE(uid, 3)
  payload.writeUInt32BE(seconds - seconds % interval, 7)
  payload.writeUInt16BE(crc16(payload.subarray(0, 11)), 11)
  return payload
}

export function unpackTrace(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 13) return null
  const payload = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (payload.readUInt16BE() !== 0x474c || payload[2] !== 8 || payload.readUInt16BE(11) !== crc16(payload.subarray(0, 11))) return null
  const uid = payload.readUInt32BE(3), from = payload.readUInt32BE(7)
  return uid && from % interval === 0 ? {uid, from, to: from + interval} : null
}
