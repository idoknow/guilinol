import assert from 'node:assert/strict'
import {view,uploadShot} from './feedback-view-fixture.mjs'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export async function bridgeTest({ api, origin, cookie, state, staticDir,sql,mailLog }) {
  const bin = join(state, 'bin'),
    fixture = join(state, 'fixture.json'),
    cli = join(bin, 'multica')
  await mkdir(bin)
  await writeFile(
    cli,
    `#!/usr/bin/env node
const fs=require('fs'), args=process.argv.slice(2), data=JSON.parse(fs.readFileSync(process.env.FIXTURE)), val=k=>args[args.indexOf(k)+1]; let result
if(data.failCommand && args.join(' ').startsWith(data.failCommand+' '))process.exit(1)
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
      view,
      kind: '其他',
      title: '桥头',
      body: '请核对入口朝向',
      lat: 25.28,
      lon: 110.3,
    }),
    path = 'feedback/' + id
  const picture = await readFile('public/og.jpg')
  await uploadShot(origin,cookie,id)
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
  const journalPath = (feedbackId) => join(env.BRIDGE_STATE, feedbackId + '.json')
  const journal = async (feedbackId) => JSON.parse(await readFile(journalPath(feedbackId)))
  await set({ failCommand: 'issue children' })
  assert.throws(() => run())
  assert.throws(() => run())
  assert.equal((await journal(id)).failures, 1)
  await set({ failCommand: null })
  run()
  assert.equal((await journal(id)).failures, undefined)
  run()
  let data = await load()
  assert.equal(data.creates, 1)
  assert.deepEqual(data.sizes, [picture.length,picture.length, picture.length])
  assert.match(data.args[data.args.indexOf('--attachment')+1],/\/view\.jpg$/);assert.match(data.body,/\?view=/)
  assert.equal(data.body.trim(), dry.trim())
  for (const [key, value] of Object.entries({
    '--parent': 'parent',
    '--project': 'project',
    '--assignee-id': 'agent',
    '--status': 'todo',
  }))
    assert.equal(data.args[data.args.indexOf(key) + 1], value)
  assert.equal((await api(path)).status,'submitted');assert.match(data.body,/待管理员批准/)
  const approve=async id=>api(`admin/feedback/${id}/status`,{status:'approved'});sql("UPDATE users SET role='admin',notify_email=1; UPDATE feedback_mail SET next_at=0")
  await set({comments:[{id:'clarify',author_id:'agent',author_type:'agent',created_at:new Date().toISOString(),content:'```feedback-reply\n是桥头吗？\n```'}]});await api(path+'/messages',{body:'是的'});run();run()
  assert.equal((await api(path)).messages.filter(m=>m.author_kind==='agent').length,1);assert.equal((await load()).replies.filter(m=>m.startsWith('用户回复：')).length,1);assert.match(mailLog(),/DEV_NOTIFICATION/)
  await approve(id);run();run();assert.equal((await load()).replies.filter(m=>m.startsWith('管理员已批准')).length,1)
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
  await set({ failCommand: 'issue comment add' })
  assert.throws(() => run())
  await set({ failCommand: null })
  run()
  assert.equal((await journal(id)).failures, undefined)
  await approve(id);run()
  await set({ status: 'in_progress' })
  run()
  assert.ok((await load()).replies.some(reply=>reply.includes('已核对背面')))
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
      'approved',
      'queued',
      'modelling',
      'reviewing',
      'need_info',
      'submitted',
      'approved',
      'queued',
      'modelling',
      'reviewing',
      'live',
    ],
  )
  assert.equal((await load()).creates, 1)
  const next = (
    await api('feedback', { view,kind: '其他', title: '新反馈', body: '请核对', lat: 25.28, lon: 110.3 })
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
  await uploadShot(origin,cookie,next)
  await api(`feedback/${next}/submit`, {})
  await set({
    pr: false,
    comments: [],
    created: null,
    status: 'in_progress',
    runs: [2000, 1000].map((time) => ({
      agent_id: 'agent',
      status: 'failed',
      completed_at: new Date(time).toISOString(),
    })),
  })
  assert.throws(() => run())
  await approve(next)
  run()
  run()
  run()
  assert.deepEqual(
    (await api('feedback/' + next)).events.map((event) => event.status),
    ['submitted','approved', 'queued'],
  )
  assert.equal((await load()).replies.filter((message) => message.includes('自动处理已暂停')).length, 1)
  const recovered = await journal(next)
  assert.equal(recovered.failures, 2)
  delete recovered.failures
  delete recovered.alerted
  recovered.runsAfter = Date.now()
  await writeFile(journalPath(next), JSON.stringify(recovered))
  run()
  run()
  assert.deepEqual(
    (await api('feedback/' + next)).events.map((event) => event.status),
    ['submitted','approved', 'queued', 'modelling'],
  )
  assert.equal((await load()).replies.filter((message) => message.includes('自动处理已暂停')).length, 1)
  console.log(
    'Bridge: dry run, ambiguous create recovery, attachments, supplement and deployment timeline passed',
  )
}
