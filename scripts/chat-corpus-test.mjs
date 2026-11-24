import test from 'node:test'
import assert from 'node:assert/strict'
import {readdir,readFile} from 'node:fs/promises'
import {seedRows} from './chat-words-import.mjs'
import {buildMatcher} from '../rt/chat-matcher.mjs'

const root=new URL('../docs/',import.meta.url),rows=(await seedRows()).map((row,id)=>({...row,id})),match=buildMatcher(rows)
const chats=new Set((await readFile(new URL('fixtures/chat-normal.txt',import.meta.url),'utf8')).trim().split(/[|\n]/u))
const docs=new Set()
for(const file of (await readdir(root)).filter(name=>name.endsWith('.md')).sort()){
  const prose=(await readFile(new URL(file,root),'utf8')).replace(/```[^]*?```/g,'\n').replace(/`[^`\n]+`/g,' ').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1')
  for(const piece of prose.split(/[。！？；，\n|]/u)){const text=piece.trim();if(text.length>=6&&text.length<=40&&/\p{Script=Han}{2}/u.test(text))docs.add(text)}
}
for(const [group,sentences,minimum] of [['chat',chats,300],['docs',docs,1000]])test(`false positives: ${group}`,context=>{
  let blocked=0,pending=0;const counts=new Map(),examples=[]
  for(const text of sentences){const decision=match(text);if(!decision)continue
    const key=rows[decision.summary.wordId]?.word??decision.summary.contact;counts.set(key,(counts.get(key)??0)+1)
    if(decision.status==='blocked'){blocked++;examples.push({key,text})}else pending++
  }
  context.diagnostic(JSON.stringify({count:sentences.size,blocked,pending,top10:[...counts].sort((left,right)=>right[1]-left[1]).slice(0,10),blockedExamples:examples.slice(0,25)}))
  assert.ok(sentences.size>=minimum);assert.equal(blocked,0);assert.ok(pending<=sentences.size*.02)
})
