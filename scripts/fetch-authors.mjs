/** One-shot: fetch Wikimedia Commons Artist metadata into pipeline/landmark-authors.json. */
import {readFileSync, writeFileSync, existsSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const landmarks = JSON.parse(readFileSync(join(root, 'pipeline/landmark-refs.json'), 'utf8'))
const cachePath = join(root, 'pipeline/landmark-authors.json')
const authors = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {}

function fileTitle(page='') {
  try {
    const match = decodeURIComponent(page).match(/\/wiki\/(File:.+)$/i)
    return match ? match[1].replace(/_/g, ' ') : ''
  } catch { return '' }
}

function strip(html='') {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

const titles = []
for (const landmark of landmarks) {
  if (landmark.viewOnly) continue
  for (const ref of landmark.refs ?? []) {
    if (ref.viewOnly) continue
    const title = fileTitle(ref.page)
    if (title && !authors[title]) titles.push(title)
  }
}
const unique = [...new Set(titles)]
console.log('need', unique.length, 'cached', Object.keys(authors).length)

const UA = 'guilinol-credits/0.1 (https://glol.rcpd.cc; research)'
for (let i = 0; i < unique.length; i += 40) {
  const batch = unique.slice(i, i + 40)
  const url = new URL('https://commons.wikimedia.org/w/api.php')
  url.search = new URLSearchParams({
    action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'extmetadata',
    titles: batch.join('|'),
  })
  const data = await fetch(url, {headers: {'User-Agent': UA}}).then(r => r.json())
  for (const page of Object.values(data.query?.pages ?? {})) {
    const title = page.title
    const meta = page.imageinfo?.[0]?.extmetadata ?? {}
    const artist = strip(meta.Artist?.value ?? '')
    const credit = strip(meta.Credit?.value ?? '')
    if (title) authors[title] = artist || credit || ''
  }
  writeFileSync(cachePath, JSON.stringify(authors, null, 1) + '\n')
  console.log('batch', i / 40 + 1, Object.keys(authors).length)
  await new Promise(r => setTimeout(r, 800))
}
console.log('wrote', cachePath)
