// Self-check for the ablation switches in web/src/debug.ts.
//
// The render path must be identical to main when the page has no query string, so this bundles
// the real module and asserts its defaults and overrides outside the browser.
//
//   node scripts/check-flags.mjs
import {build} from 'esbuild'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'

const dir = await mkdtemp(join(tmpdir(), 'glol-flags-'))
const outfile = join(dir, 'debug.mjs')

await build({
  entryPoints: ['web/src/debug.ts'],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent',
})

const failures = []
let caseId = 0

async function loadFlags(search) {
  globalThis.location = {search}
  const url = `${pathToFileURL(outfile).href}?case=${caseId++}`
  const module = await import(url)
  return module.flags
}

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
  if (!ok) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

check('no query', await loadFlags(''), {bucketTiles: 3, noMirror: false, noBatch: false})
check('?nomirror=1', await loadFlags('?nomirror=1'), {bucketTiles: 3, noMirror: true, noBatch: false})
check('?nobatch=1', await loadFlags('?nobatch=1'), {bucketTiles: 3, noMirror: false, noBatch: true})
check('?buckets=5', await loadFlags('?buckets=5'), {bucketTiles: 5, noMirror: false, noBatch: false})
check('?buckets=99 clamps', await loadFlags('?buckets=99'), {bucketTiles: 8, noMirror: false, noBatch: false})
check('?buckets=0 clamps', await loadFlags('?buckets=0'), {bucketTiles: 1, noMirror: false, noBatch: false})
check('?buckets=abc falls back', await loadFlags('?buckets=abc'), {bucketTiles: 3, noMirror: false, noBatch: false})

await rm(dir, {recursive: true, force: true})

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}
console.log('\nall flag cases passed')
