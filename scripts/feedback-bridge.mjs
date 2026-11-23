import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, rename, rm, readdir, open } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'

const env = process.env,
  dry = process.argv.includes('--dry-run')
if (env.BRIDGE_ENABLED === '0') process.exit(0)
for (const key of ['BRIDGE_TOKEN', 'MULTICA_CLI_PATH', 'BRIDGE_PARENT', 'BRIDGE_AGENT', 'BRIDGE_PROJECT']) {
  if (!env[key]) throw Error(`Missing ${key}`)
}
process.umask(0o077)
const origin = new URL(env.BRIDGE_ORIGIN || 'https://glol.rcpd.cc').origin
if (!origin.startsWith('https://') && !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
  throw Error('HTTPS required')
const state = resolve(env.BRIDGE_STATE || join(homedir(), '.local/state/glol-feedback-bridge'))
const reviewer = '91e112ba-1989-4256-ad5f-cd92e7de57ed'
const repo = 'idoknow/guilinol'
await mkdir(state, { recursive: true })
const lock = await open(join(state, 'lock'), 'a')
const locked = spawnSync('flock', ['-n', '3'], { stdio: ['ignore', 'ignore', 'inherit', lock.fd] })
if (locked.error) throw locked.error
if (locked.status !== 0) process.exit(locked.status === 1 ? 0 : 1)
const work = await mkdtemp(join(state, 'run-'))
function run(bin, args, cwd = work) {
  try {
    return execFileSync(bin, args, {
      cwd,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    throw Object.assign(Error(`${bin === env.MULTICA_CLI_PATH ? 'Multica' : 'external'} command failed`), {
      path: bin,
    })
  }
}
function cli(...args) {
  return JSON.parse(run(env.MULTICA_CLI_PATH, [...args, '--output', 'json']))
}
async function request(path, options = {}) {
  // 网络抖动（连不上、超时、502/503/520）只重试读请求；写请求失败交给下一轮 5 分钟的定时器
  const retries = (options.method ?? 'GET') === 'GET' ? 3 : 1
  for (let attempt = 1; ; attempt++) {
    let res
    try {
      res = await fetch(origin + path, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${env.BRIDGE_TOKEN}`, ...options.headers },
      })
    } catch (error) {
      if (attempt >= retries) throw error
      await new Promise((done) => setTimeout(done, 5000 * attempt))
      continue
    }
    if (res.status >= 500 && attempt < retries) {
      await new Promise((done) => setTimeout(done, 5000 * attempt))
      continue
    }
    if (!res.ok && !(options.method === 'POST' && res.status === 409)) throw Error(`HTTP ${res.status} ${path}`)
    return res
  }
}
async function post(id, status, fields = {}) {
  if (dry) return console.log(`${id} → ${status}`)
  return request(`/api/bridge/feedback/${id}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, ...fields }),
  })
}
const template = await readFile('docs/feedback-modelling-task.md', 'utf8')
const landmarks = JSON.parse(await readFile('pipeline/landmarks.json', 'utf8'))
const refs = JSON.parse(await readFile('pipeline/landmark-refs.json', 'utf8'))
function evidence(detail) {
  const { id, kind, title, body, lat, lon, heading, landmark_id, photos, events } = detail
  const nearby = landmarks
    .map((item) => ({
      ...item,
      meters: Array.isArray(item.anchor)
        ? Math.hypot((item.anchor[0] - lon) * Math.cos((lat * Math.PI) / 180), item.anchor[1] - lat) * 111320
        : Infinity,
    }))
    .filter((item) => item.id === landmark_id || item.meters < 500)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, 8)
    .map((item) => ({
      name: item.name,
      anchor: item.anchor,
      osm: refs.find((ref) => ref.id === item.id)?.osm,
    }))
  const data = {
    id,
    kind,
    title,
    body,
    lat,
    lon,
    heading,
    landmark_id,
    nearby,
    view:detail.view??null,
    photos,
    supplements: events
      .filter((item) => item.status === 'submitted')
      .slice(1)
      .map((item) => item.message),
  }
  const token=detail.view?Buffer.from(JSON.stringify(detail.view)).toString('base64url'):null
  const replay=token?`\n\n游戏视角：https://glol.rcpd.cc/?view=${token}\n\n本地 Playwright 复现（baseURL 指向本地预览）：\n\n\`\`\`js\nawait page.goto('/?verify&view=${token}');\nawait page.waitForFunction(() => window.viewer?.stats.loaded > 0 && !window.viewer.stream.pending.size);\nawait page.screenshot({path:'before.png'});\n\`\`\`\n`:''
  return '**待管理员批准，批准前只沟通、不派发、不建模**。先阅读 docs/feedback-coordinator.md；以下建模步骤仅在收到管理员开工通知后执行。\n\n'+replay+template.replace('{{EVIDENCE}}', () =>
    JSON.stringify(data, null, 2)
      .replaceAll('mention:', 'mention：')
      .split('\n')
      .map((line) => '    ' + line)
      .join('\n'),
  )
}
async function files(detail) {
  const args = []
  if(detail.has_view_shot){const file=join(work,'view.jpg');await writeFile(file,Buffer.from(await (await request(`/api/feedback/${detail.id}/view-shot`)).arrayBuffer()));args.push('--attachment',file)}
  for (const photo of detail.photos) {
    const ext = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png', 'image/heic': 'heic' }[
      photo.mime
    ]
    if (!ext || !Number.isInteger(photo.n)) throw Error('Invalid photo metadata')
    const file = join(work, `photo-${photo.n}.${ext}`)
    const bytes = await (await request(`/api/feedback/${detail.id}/photos/${photo.n}`)).arrayBuffer()
    if (bytes.byteLength !== photo.bytes) throw Error('Incomplete photo')
    await writeFile(file, Buffer.from(bytes))
    args.push('--attachment', file)
  }
  if (!args.length) throw Error('Missing photos')
  return args
}
const children = () => {
  const tree = cli('issue', 'children', env.BRIDGE_PARENT)
  return [...tree.unstaged, ...tree.stages.flatMap((stage) => stage.issues)]
}
function comments(issue) {
  return cli('issue', 'comment', 'list', issue, '--roots-only', '--summary', '--compact')
    .flatMap((root) =>
      cli('issue', 'comment', 'list', issue, '--thread', root.id, '--tail', '30', '--compact'),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
}
async function queue(row, journal, save) {
  const detail = await (await request(`/api/feedback/${row.id}`)).json(),
    body = evidence(detail)
  if (dry) return console.log(body)
  async function dispatch(...args) {
    try {
      return cli(...args)
    } catch (error) {
      journal.failures = (journal.failures || 0) + 1
      await save()
      throw error
    }
  }
  const title = `[反馈 ${row.id}] 桂林地标建模`,
    file = join(work, 'task.md')
  let issue = row.multica_issue || journal.issue || children().find((child) => child.title === title)?.id
  if (!issue) {
    await writeFile(file, body)
    issue = (
      await dispatch(
        'issue',
        'create',
        '--title',
        title,
        '--project',
        env.BRIDGE_PROJECT,
        '--parent',
        env.BRIDGE_PARENT,
        '--assignee-id',
        env.BRIDGE_AGENT,
        '--status',
        'todo',
        '--description-file',
        file,
        ...(await files(detail)),
      )
    ).id
    if (!issue) throw Error('No created issue ID')
  }
  journal.issue = issue
  delete journal.failures
  await save()
  await command(row.id,'bind',{issue});row.multica_issue=issue
}
async function command(id,action,data){
  const response=await request(`/api/bridge/feedback/${id}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
  if(!response.ok)throw Error(`Conflict ${action}`)
}
const PR_URL = /https:\/\/github\.com\/idoknow\/guilinol\/pull\/(\d+)/g
/**
 * 反馈对应的 PR 都合入 main 且线上 /version.json 已包含 → 返回 {live, merged}。
 * idoknow/guilinol 没接 Multica 的 GitHub 集成，`issue pull-requests` 恒为空（IDOK-186），
 * 所以同时从协调人 / 审核人的评论里收 PR 链接。还有没合并的 PR（open）就不算上线。
 */
async function deployment(urls) {
  const prs = [...new Set(urls)].map((url) => {
    const number = /\/pull\/(\d+)$/.exec(url)[1]
    return {
      url,
      number,
      ...JSON.parse(run('gh', ['pr', 'view', number, '-R', repo, '--json', 'state,mergeCommit,baseRefName'])),
    }
  })
  const merged = prs.filter((pr) => pr.state === 'MERGED' && pr.baseRefName === 'main')
  if (!merged.length || prs.some((pr) => pr.state === 'OPEN')) return { live: false, merged }
  const version = await fetch(origin + '/version.json', {
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  })
  if (!version.ok) return { live: false, merged }
  const sha = (await version.json()).sha
  if (!/^[a-f0-9]{40}$/.test(sha)) return { live: false, merged }
  const contained = (merge) =>
    /^[a-f0-9]{40}$/.test(merge ?? '') &&
    (sha === merge ||
      ['ahead', 'identical'].includes(
        run('gh', ['api', `repos/${repo}/compare/${merge}...${sha}`, '--jq', '.status']).trim(),
      ))
  return { live: merged.every((pr) => contained(pr.mergeCommit?.oid)), merged, sha }
}
async function screenshot(comment) {
  const target = /!\[可公开对比图\]\(([^)]+)\)/.exec(comment.content)?.[1]
  const id = target?.match(/\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/gi)?.at(-1)
  if (!id || dry) return undefined
  const dir = await mkdtemp(join(work, 'comparison-'))
  run(env.MULTICA_CLI_PATH, ['attachment', 'download', id, '--output-dir', dir])
  const [name] = await readdir(dir),
    bytes = await readFile(join(dir, name))
  const digest = createHash('sha256').update(bytes).digest('hex')
  await request(`/api/bridge/comparisons/${digest}`, { method: 'PUT', body: bytes })
  return `/api/feedback/comparisons/${digest}`
}
async function sync(row, journal, save) {
  const issue = row.multica_issue,
    current = cli('issue', 'get', issue)
  const history=comments(issue),detail=await (await request(`/api/feedback/${row.id}`)).json()
  async function relay(marker,body,attachments=[],mention=true){
    if(dry||history.some(comment=>comment.content.includes(marker)))return
    const file=join(work,'relay.md');await writeFile(file,body+'\n\n'+marker+(mention?`\n[@协调人](mention://agent/${env.BRIDGE_AGENT})`:''))
    cli('issue','comment','add',issue,'--content-file',file,...attachments)
  }
  for(const msg of detail.messages.filter(msg=>msg.author_kind!=='agent'&&!msg.relayed_at)){
    const body=msg.body.replaceAll('mention:','mention：').split('\n').map(line=>'    '+line).join('\n')
    await relay(`<!-- fb-message:${row.id}:${msg.id} -->`,(msg.author_kind==='user'?'用户回复：':'管理员回复：')+'\n'+body,await files(detail));if(!dry)await command(row.id,'relayed',{id:msg.id})
  }
  const trusted = history.filter(
    (c) =>
      !c.content.startsWith('材料补充 ') &&
      !/^(用户回复：|管理员回复：|管理员已批准，可以开工)/.test(c.content) &&
      (c.author_type === 'member' || [env.BRIDGE_AGENT, reviewer].includes(c.author_id)) &&
      Date.parse(c.created_at) / 1000 >= (journal.since || 0) &&
      c.id !== journal.previousDecision,
  )
  for(const comment of trusted.slice().reverse()){
    for(const [index,match] of [...comment.content.matchAll(/^```feedback-reply\r?\n([\s\S]+?)\r?\n```\s*$/gm)].entries())if(!dry)await command(row.id,'messages',{source:`${comment.id}:${index}`,body:match[1].trim()})
  }
  if(row.status==='approved'){
    await relay(`<!-- fb-start:${row.id}:${detail.events.at(-1).id} -->`,'管理员已批准，可以开工');await post(row.id,'queued');return
  }
  const decision = trusted
    .filter(c=>c.id!==journal.lastDecision).map((c) =>
      /^```feedback-status (need_info|rejected|duplicate)\r?\n([\s\S]+?)\r?\n```\s*$/m.exec(c.content),
    )
    .find(Boolean)
  if (decision) {
    const source=trusted.find(comment=>comment.content.includes(decision[0])).id
    if(source===journal.lastDecision)return
    if (decision[1] === 'need_info') {
      if(!dry)await command(row.id,'messages',{source:`${source}:status`,body:decision[2].trim()})
    }
    await post(row.id, decision[1], { message: decision[2].trim() });journal.lastDecision=source;await save();return
  }
  const accepted = ['in_review', 'done'].includes(current.status)
  if (row.status === 'submitted') return
  const urls = [
    ...cli('issue', 'pull-requests', issue).pull_requests.map((pr) => pr.html_url),
    ...trusted.flatMap((c) => [...c.content.matchAll(PR_URL)].map((m) => m[0])),
  ].filter((url) => /^https:\/\/github\.com\/idoknow\/guilinol\/pull\/\d+$/.test(url))
  const deploy = accepted && urls.length ? await deployment(urls) : { live: false, merged: [] }
  const pr = deploy.merged.sort((a, b) => b.number - a.number)[0]
  const capture = trusted.find((c) => c.content.includes('![可公开对比图]('))
  const status = deploy.live
    ? 'live'
    : { in_progress: 'modelling', in_review: 'reviewing', done: 'reviewing' }[current.status]
  // need_info 是在等提交人回复，不能被 issue 状态覆盖；唯一例外：没等回复就修好并且已经上线（IDOK-180/181）
  if (row.status === 'need_info' && status !== 'live') return
  const recent = ['live', 'reviewing'].includes(status)
    ? []
    : cli('issue', 'runs', issue)
        .filter(
          (run) =>
            run.agent_id === env.BRIDGE_AGENT &&
            run.completed_at &&
            Date.parse(run.completed_at) > (journal.runsAfter || 0),
        )
        .sort((left, right) => Date.parse(right.completed_at) - Date.parse(left.completed_at))
        .slice(0, 2)
  if (recent.length === 2 && recent.every((run) => run.status === 'failed')) {
    journal.failures = 2
    await save()
  } else if (status === 'live' && row.status !== 'live') {
    // 署名：协调人/审核人评论里的 ```feedback-credit``` 块（几个字），没有就用反馈标题
    const credit = trusted
      .map((c) => /^```feedback-credit\r?\n([\s\S]+?)\r?\n```\s*$/m.exec(c.content)?.[1].trim())
      .find(Boolean)
    const shown = Array.from(credit || detail.title).slice(0, 16).join('')
    const written = await post(row.id, 'live', {
      pr_url: pr?.html_url,
      screenshot_url: capture && (await screenshot(capture)),
      credit: credit ? shown : undefined,
      // 用户标题可能是一长句，只有写了署名块才拼进消息
      message: `${credit ? `已上线：${shown}。` : '已上线。'}谢谢你的反馈！你的昵称已署在「关于网上桂林」的贡献者名单里。`,
    })
    // 409 = 服务端没接受（比如线上还是旧版状态机）：先别留言、别关单，下一轮再试
    if (!dry && written?.status !== 409) {
      const list = deploy.merged.map((item) => `#${item.number}`).join('、')
      await relay(
        `<!-- fb-live:${row.id} -->`,
        `反馈已上线：线上版本 \`${deploy.sha.slice(0, 7)}\` 已包含 PR ${list}。已通知提交人，昵称自动署在「关于」页（署名：${shown}）。`,
        [],
        false,
      )
      if (current.status !== 'done') run(env.MULTICA_CLI_PATH, ['issue', 'status', issue, 'done'])
    }
  } else if (status && status !== row.status)
    await post(row.id, status, {
      pr_url: pr?.html_url,
      screenshot_url: capture && (await screenshot(capture)),
    })
}
async function processRow(row) {
  if (!/^[\w-]+$/.test(row.id)) throw Error('Invalid feedback ID')
  const path = join(state, row.id + '.json')
  const journal = JSON.parse(
    await readFile(path, 'utf8').catch((err) => {
      if (err.code === 'ENOENT') return '{}'
      throw err
    }),
  )
  async function save() {
    if (!dry) {
      await writeFile(path + '.new', JSON.stringify(journal))
      await rename(path + '.new', path)
    }
  }
  if (!(journal.failures >= 2)) {
    if (!row.multica_issue)await queue(row,journal,save)
    if(row.multica_issue)await sync(row,journal,save)
  }
  if (journal.failures >= 2 && !journal.alerted && !dry) {
    const file = join(work, 'alert.md'),
      issue = row.multica_issue || journal.issue || env.BRIDGE_PARENT,
      marker = `反馈 ${row.id} 自动处理已暂停。${journal.runsAfter ? `（恢复批次 ${journal.runsAfter}）` : ''}`
    if (!comments(issue).some((c) => c.content.startsWith(marker))) {
      await writeFile(
        file,
        `${marker}已发生两次 Multica 失败，请 [@sg claude](mention://agent/${reviewer}) 检查后人工恢复。`,
      )
      cli('issue', 'comment', 'add', issue, '--content-file', file)
    }
    journal.alerted = true
    await save()
  }
}
try {
  for (const row of await (await request('/api/bridge/pending')).json()) {
    try {
      await processRow(row)
    } catch (err) {
      console.error(
        `${row.id}: ${err.path ? 'CLI failed' : err.status ? 'command failed' : err.message.split('\n')[0]}`,
      )
      process.exitCode = 1
    }
  }
  if(!dry)await request('/api/bridge/mail',{method:'POST'})
} finally {
  await rm(work, { recursive: true, force: true })
  await lock.close()
}
