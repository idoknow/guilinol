import assert from 'node:assert/strict'
import test from 'node:test'
import {packTrace, unpackTrace} from '../server/trace-payload.mjs'

test('big endian header, unsigned uid and half-open five-minute window', () => {
  const bytes = packTrace(0xfedcba98, 899)
  assert.equal(bytes.subarray(0, 11).toString('hex'), '474c08fedcba9800000258')
  assert.deepEqual(unpackTrace(bytes), {uid: 0xfedcba98, from: 600, to: 900})
  assert.equal(unpackTrace(packTrace(1, 900)).from, 900)
})

test('rejects truncated, extended and single-bit-corrupted records', () => {
  const bytes = packTrace(16, 1234567890)
  for (let bit = 0; bit < bytes.length * 8; bit++) {
    const damaged = Buffer.from(bytes)
    damaged[bit >>> 3] ^= 1 << (bit % 8)
    assert.equal(unpackTrace(damaged), null)
  }
  assert.equal(unpackTrace(bytes.subarray(1)), null)
  assert.equal(unpackTrace(Buffer.concat([bytes, bytes])), null)
  assert.throws(() => packTrace(2 ** 32, 0), RangeError)
  assert.throws(() => packTrace(0, 0), RangeError)
  assert.throws(() => packTrace(1, -1), RangeError)
})
