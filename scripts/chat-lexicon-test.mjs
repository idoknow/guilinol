import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {seedRows,groups} from './chat-words-import.mjs'
import {buildMatcher} from '../rt/chat-matcher.mjs'

const rows=(await seedRows()).map((row,id)=>({...row,id})),match=buildMatcher(rows)
test('one pinned real sample per imported category',()=>{
  const samples='219af6c42926a728 623ec191106f4672 e8854547eb97f08f 5368a329d2a69b8c 7d5a8cd15a96f50c 92a054e84d6e2e13 f0e94c142d8732e7 e671efe43010439a 7cceaca14bdf4f6e 167ff30079a6f664 a8c5d389dc891624 6e1546faab01a656'.split(' ')
  const byHash=new Map(rows.map(row=>[createHash('sha256').update(row.word).digest('hex').slice(0,16),row]))
  for(const [action,categories] of Object.entries(groups))for(const category of categories){const row=byHash.get(samples.shift());assert.equal(row.category,category);assert.equal(match(row.word).label,action)}
})
test('normalization, bounded place-name exemption and contact review',()=>{
  const local=buildMatcher([...rows,{word:'象鼻',action:'block'},{word:'測試Ab',action:'block'}]);assert.equal(local('象鼻山'),undefined);assert.equal(local('象鼻山还有象鼻').status,'blocked')
  for(const variant of ['测 试aB','測.試ＡＢ','测😀试a\u200bb'])assert.equal(local(variant).status,'blocked')
  for(const [text,kind] of [['https://example.com','url'],['QQ：12345678','qq'],['微信号：glcityABC','wechat']]){assert.equal(local(text).status,'pending');assert.equal(local(text).summary.contact,kind)}
  assert.equal(local('测 试aB QQ：12345678').status,'blocked')
  assert.equal(match('色.情').status,'pending');assert.equal(match('色 情').status,'pending');assert.equal(match('色情').status,'blocked');assert.equal(match('。色情').status,'blocked')
  for(const text of ['明天早上8点集合','求组队一起逛街','这个bug怎么回事','有没有人在七星公园'])assert.equal(match(text),undefined)
})
test('100 code points with the complete index: p99 < 1ms',context=>{
  const extra=Array.from({length:Math.max(0,10000-rows.length)},(_,index)=>({word:`压测附加词${index}`,action:'review'})),measure=buildMatcher([...rows,...extra]);const timings=[],messages=['桂林象鼻山','杉梧桐柳树','測試emoji','https://example.com','１a😀.P'].map(text=>[...text.repeat(100)].slice(0,100).join(''))
  for(let index=0;index<6500;index++){const start=performance.now();measure(messages[index%messages.length]);if(index>=500)timings.push(performance.now()-start)}
  timings.sort((left,right)=>left-right);const p99=timings[Math.ceil(timings.length*.99)-1];context.diagnostic(`${rows.length} seed + ${extra.length} synthetic rules, ${timings.length} samples, p99=${p99.toFixed(4)} ms`);assert.ok(p99<1)
})
