import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
export const view = {
  mode: 'walk',
  x: 0,
  y: 180,
  z: 0,
  lat: 25.28,
  lon: 110.3,
  alt: 180,
  yaw: 0,
  pitch: 0,
  heading: 0,
  fov: 55,
  target: null,
  landmark_id: null,
  build: 'a'.repeat(40),
}
export async function uploadShot(origin, cookie, id, status = 200, headers = {}) {
  const response = await fetch(`${origin}/api/feedback/${id}/view-shot`, {
    method: 'PUT',
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'image/jpeg', ...headers },
    body: await readFile('public/og.jpg'),
  })
  assert.equal(response.status, status, await response.text())
}
