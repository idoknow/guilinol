import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {createReadStream, createWriteStream} from 'node:fs'
import {mkdtemp, readFile, rename, rm, stat} from 'node:fs/promises'
import {join} from 'node:path'
import {Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'

const pin = new URL('../world-dev.sha256', import.meta.url)
const digest = (await readFile(pin, 'utf8')).trim()
if (!/^[a-f0-9]{64}$/.test(digest)) throw Error('Invalid development world checksum')
const tag = `world-dev-${digest.slice(0, 12)}`
async function source() {
  if (process.env.WORLD_DEV_ARCHIVE) return createReadStream(process.env.WORLD_DEV_ARCHIVE)
  const response = await fetch(`https://github.com/idoknow/guilinol/releases/download/${tag}/world.tar.gz`)
  if (!response.ok || !response.body) throw Error(`${tag}: HTTP ${response.status}`)
  return response.body
}
const staging = await mkdtemp('public/.world-install-')
const archive = join(staging, 'world.tar.gz')
let keepBackup = false
try {
  const hash = createHash('sha256')
  await pipeline(await source(), new Transform({transform(chunk, _, done) {
    hash.update(chunk); done(null, chunk)
  }}), createWriteStream(archive, {flags: 'wx'}))
  if (hash.digest('hex') !== digest) throw Error(`${tag}: SHA-256 mismatch`)
  execFileSync('tar', ['-xzf', archive, '-C', staging])
  const manifest = JSON.parse(await readFile(join(staging, 'world/manifest.json'), 'utf8'))
  if (JSON.stringify(manifest.dev_bbox) !== '[25.25,110.278,25.302,110.312]') throw Error('Unexpected dev_bbox')
  const existing = await stat('public/world').catch(error => { if (error.code !== 'ENOENT') throw error })
  if (existing) { await rename('public/world', join(staging, 'previous')); keepBackup = true }
  try {
    await rename(join(staging, 'world'), 'public/world')
  } catch (error) {
    if (keepBackup) { await rename(join(staging, 'previous'), 'public/world'); keepBackup = false }
    throw error
  }
  keepBackup = false
  console.log(`Installed ${tag} (${manifest.chunks.length} tiles, SHA-256 ${digest})`)
} finally {
  if (!keepBackup) await rm(staging, {recursive: true, force: true})
}
