import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export async function bridgeTest({ api, origin, cookie, state, staticDir }) {
  const bin = join(state, 'bin'),
    fixture = join(state, 'fixture.json'),
    cli = join(bin, 'multica')
  await mkdir(bin)
  await writeFile(
    cli,
    `#!/usr/bin/env node
const fs=require('fs'), args=process.argv.slice(2), data=JSON.parse(fs.readFileSync(process.env.FIXTURE)), val=k=>args[args.indexOf(k)+1]; let result
switch (args.slice(0,2).join(' ')) {
case 'issue children':result={stages:[],unstaged:data.created?[data.created]:[]};break
case 'issue create':data.creates++;data.created={id:'model-1',title:val('--title')};data.args=args;data.body=fs.readFileSync(val('--description-file'),'utf8');data.sizes=args.flatMap((value,index)=>value==='--attachment'?[fs.statSync(args[index+1]).size]:[]);result=data.created;break
case 'issue get': result={status:data.status};break
case 'issue runs':result=data.runs||[];break
case 'attachment download':fs.writeFileSync(val('--output-dir')+'/public-comparison.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD2kAAAAASUVORK5CYII=','base64'));result={};break
case 'issue pull-requests':result={pull_requests:data.pr?[{number:1,html_url:'https://github.com/idoknow/guilinol/pull/1'}]:[]};break
case 'issue comment':if(args[2]==='add'){data.replies.push(fs.readFileSync(val('--content-file'),'utf8'));result={}}else result=data.comments;break
default:throw Error('unexpected '+args)
}
fs.writeFileSync(process.env.FIXTURE,JSON.stringify(data));if(args[1]==='create')process.exit(1);console.log(JSON.stringify(result))`,
    { mode: 0o700 },
  )
  await writeFile(
    join(bin, 'gh'),
    `#!/bin/sh\nif [ "$1" = api ]; then echo behind; else echo '{"state":"MERGED","baseRefName":"main","mergeCommit":{"oid":"${'a'.repeat(40)}"}}'; fi`,
    { mode: 0o700 },
  )
  const env = {
    ...process.env,
    PATH: bin + ':' + process.env.PATH,
    FIXTURE: fixture,
    BRIDGE_ENABLED: '1',
    BRIDGE_ORIGIN: origin,
    BRIDGE_TOKEN: 'local-test',
    BRIDGE_PARENT: 'parent',
    BRIDGE_PROJECT: 'project',
    BRIDGE_AGENT: 'agent',
    MULTICA_CLI_PATH: cli,
    BRIDGE_STATE: join(state, 'journal'),
  }
  const run = (...flags) =>
    execFileSync(process.execPath, ['scripts/feedback-bridge.mjs', ...flags], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  const load = async () => JSON.parse(await readFile(fixture))
  const set = async (values) => writeFile(fixture, JSON.stringify({ ...(await load()), ...values }))
  await writeFile(fixture, JSON.stringify({ creates: 0, status: 'todo', comments: [], replies: [] }))
  const { id } = await api('feedback', {
      kind: '其他',
      title: '桥头',
      body: '请核对入口朝向',
      lat: 25.28,
      lon: 110.3,
    }),
    path = 'feedback/' + id
  const picture = await readFile('public/og.jpg')
  for (const slot of [1, 3])
    assert.equal(
      (
        await fetch(`${origin}/api/${path}/photos/${slot}`, {
          method: 'PUT',
          headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'image/jpeg' },
          body: picture,
        })
      ).status,
      200,
    )
  await api(path + '/submit', {})
  const dry = run('--dry-run')
  assert.match(dry, /桥头/)
  console.log('DRY RUN BEGIN\n' + dry + 'DRY RUN END')
  assert.equal((await load()).creates, 0)
  assert.throws(() => run())
  run()
  run()
  let data = await load()
  assert.equal(data.creates, 1)
  assert.deepEqual(data.sizes, [picture.length, picture.length])
  assert.equal(data.body.trim(), dry.trim())
  for (const [key, value] of Object.entries({
    '--parent': 'parent',
    '--project': 'project',
    '--assignee-id': 'agent',
    '--status': 'todo',
  }))
    assert.equal(data.args[data.args.indexOf(key) + 1], value)
  await set({ status: 'in_progress' })
  run()
  await set({
    status: 'in_review',
    comments: [
      {
        id: 'pic',
        author_id: 'agent',
        author_type: 'agent',
        created_at: new Date().toISOString(),
        content: '![可公开对比图](/attachments/00000000-0000-0000-0000-000000000001)',
      },
    ],
  })
  run()
  run()
  const shot = (await api(path)).events.at(-1).screenshot_url
  assert.match(shot, /^\/api\/feedback\/comparisons\/[a-f0-9]{64}$/)
  assert.equal((await fetch(origin + shot)).headers.get('content-type'), 'image/png')
  await set({
    comments: [
      {
        id: '1',
        author_id: 'agent',
        author_type: 'agent',
        created_at: new Date().toISOString(),
        content: '```feedback-status need_info\n请补充背面照片。\n```',
      },
    ],
  })
  run()
  run()
  let detail = await api(path)
  assert.equal(detail.events.at(-1).message, '请补充背面照片。')
  assert.equal(detail.multica_issue, 'model-1')
  await api(path + '/supplement', { body: '已核对背面' })
  run()
  await set({ status: 'in_progress' })
  run()
  assert.match((await load()).replies[0], /已核对背面/)
  await writeFile(join(staticDir, 'version.json'), JSON.stringify({ sha: 'b'.repeat(40) }))
  await set({ pr: true, status: 'done' })
  run()
  assert.equal((await api(path)).status, 'reviewing')
  await writeFile(join(staticDir, 'version.json'), JSON.stringify({ sha: 'a'.repeat(40) }))
  run()
  run()
  detail = await api(path)
  assert.deepEqual(
    detail.events.map((event) => event.status),
    [
      'submitted',
      'queued',
      'modelling',
      'reviewing',
      'need_info',
      'submitted',
      'queued',
      'modelling',
      'reviewing',
      'live',
    ],
  )
  assert.equal((await load()).creates, 1)
  const next = (
    await api('feedback', { kind: '其他', title: '新反馈', body: '请核对', lat: 25.28, lon: 110.3 })
  ).id
  assert.equal(
    (
      await fetch(`${origin}/api/feedback/${next}/photos/1`, {
        method: 'PUT',
        headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'image/jpeg' },
        body: picture,
      })
    ).status,
    200,
  )
  await api(`feedback/${next}/submit`, {})
  await set({
    pr: false,
    comments: [],
    created: null,
    status: 'in_progress',
    runs: Array(2).fill({ agent_id: 'agent', status: 'failed' }),
  })
  assert.throws(() => run())
  run()
  run()
  run()
  assert.equal((await api('feedback/' + next)).status, 'modelling')
  assert.equal((await load()).replies.filter((message) => message.includes('自动处理已暂停')).length, 1)
  console.log(
    'Bridge: dry run, ambiguous create recovery, attachments, supplement and deployment timeline passed',
  )
}
