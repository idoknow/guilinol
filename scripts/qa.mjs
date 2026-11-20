import { spawn, execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { once } from 'node:events'

const dir = 'captures/qa'
const mac = process.platform === 'darwin'
const timeouts = { 'verify:walk:full': 32, 'photo-match': mac ? 10 : 180 }
const steps = [
  'world',
  'landmarks',
  'build',
  'verify:flight',
  'verify:walk:full',
  'verify:ride',
  'verify:tour',
  'audit:landmarks',
  'photo-match',
]
const extraArgs = { 'audit:landmarks': ['--', '--strict'], 'photo-match': ['--', '--all'] }
const env = { ...process.env, WALK_MAIN_ONLY: '0', QA_METRICS: '1' }
const { scripts } = JSON.parse(await readFile('package.json'))
const revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
const start = Date.now()
const rows = []
await mkdir(dir, { recursive: true })

async function run(step) {
  const log = createWriteStream(dir + '/' + step.replaceAll(':', '-') + '.log')
  const child = spawn('npm', ['run', step, ...(extraArgs[step] ?? [])], { env, detached: true })
  const stop = () => process.kill(-child.pid, 'SIGTERM')
  let interrupted = false
  const cancel = () => {
    interrupted = true
    stop()
  }
  process.once('SIGTERM', cancel)
  process.once('SIGINT', cancel)
  let timedOut = false
  const timeout = setTimeout(
    () => {
      timedOut = true
      stop()
    },
    (timeouts[step] ?? 10) * 60000,
  )
  let output = ''
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (data) => {
      log.write(data)
      output += data
    })
  let code, signal
  try {
    const result = await once(child, 'close')
    code = result[0]
    signal = result[1]
  } finally {
    clearTimeout(timeout)
    process.off('SIGTERM', cancel)
    process.off('SIGINT', cancel)
    log.end()
    await once(log, 'finish')
  }
  if (interrupted || (signal && !timedOut)) throw Error('Interrupted ' + step + ' (' + signal + ')')
  const metric = (field) => {
    const match = output.match(new RegExp('"' + field + '"\\s*:\\s*([.0-9]+)'))
    return match ? Number(match[1]).toFixed(1) : '—'
  }
  let reason = ''
  if (timedOut || code !== 0) {
    const lines = output.split('\n').map((s) => s.trim())
    const message = lines.find((s) => /^(?:page\.|\w*Error\b|AssertionError)/.test(s))
    reason = timedOut ? '超时' : message || lines.filter(Boolean).at(-1) || 'exit ' + code
  }
  return [
    code === 0 && !timedOut ? '通过' : '失败',
    metric('firstMs'),
    metric('meanCalls'),
    reason.replaceAll('|', '／'),
  ]
}

for (const step of steps) {
  const then = Date.now()
  console.log(step)
  const [status, first, calls, reason] =
    !scripts[step] && step === 'audit'
      ? ['跳过', '—', '—', '当前版本尚未提供 IDOK-28 audit']
      : await run(step)
  rows.push([step, status, ((Date.now() - then) / 1000).toFixed(1), first, calls, reason].join(' | '))
  const seconds = (Date.now() - start) / 1000
  const report = [
    '# 全量 QA',
    '',
    revision +
      ' · ' +
      new Date(start).toISOString() +
      ' · ' +
      seconds.toFixed(1) +
      (mac ? ' 秒 / 2400 秒' : ' 秒'),
    '',
    '步骤 | 结果 | 秒 | 首帧 ms | 平均 draw calls | 原因',
    '---|---|---:|---:|---:|---',
    ...rows,
    '',
    '照片按步行支撑面 +1.5 m、朝向修正 0°。— 表示该步骤未采样。逐项日志保存在本目录。',
    '',
  ]
  await writeFile(dir + '/report.md', report.join('\n'))
  if (status === '失败' || (mac && seconds > 2400)) process.exitCode = 1
}
