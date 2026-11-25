import {readFile} from 'node:fs/promises'

const manifest = JSON.parse(await readFile('dist/world/manifest.json', 'utf8'))
if (manifest.bbox?.join(',') === '25.25,110.278,25.302,110.312' && !manifest.region) {
  console.log('SKIP: 开发世界只覆盖旧市中心，不含临桂、机场或花江高校扩区。')
  process.exit(0)
}
