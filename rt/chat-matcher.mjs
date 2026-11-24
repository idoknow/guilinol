import {sify} from 'chinese-conv'

const canonical=text=>sify(text.normalize('NFKC').toLowerCase())
const strip=text=>text.replace(/[^\p{L}\p{N}]/gu,'')
export const fold=text=>strip(canonical(text))
const node=()=>({edges:new Map(),fail:0,hits:[]})
const contacts=[['url',/(?:https?:\/\/|www\.)[^\s]+|(?:[a-z0-9-]+\.)+(?:com|cn|net|org|io|cc|top|xyz|me|info)\b/i],['qq',/(?<!\d)[1-9]\d{4,11}(?!\d)/],['wechat',/(?:微信(?:号)?|微讯号|wechat|weixin|vx|wx)\s*[:：=号]?\s*[a-z][\w-]{5,19}/i]]

export function buildMatcher(rows){
  const nodes=[node()]
  for(const row of rows){
    if(row.enabled===false)continue
    const word=fold(row.word);if(!word)continue
    let state=0
    for(const char of word){const edges=nodes[state].edges;if(!edges.has(char)){edges.set(char,nodes.length);nodes.push(node())}state=edges.get(char)}
    nodes[state].hits.push({id:row.id,action:row.action,length:[...word].length,qqLabel:word==='qq'&&row.category==='广告类型'&&row.source==='konsheng@68a595f'})
  }
  const queue=[...nodes[0].edges.values()]
  for(let head=0;head<queue.length;head++){
    const parent=nodes[queue[head]]
    for(const [char,index] of parent.edges){let fallback=parent.fail;while(fallback&&!nodes[fallback].edges.has(char))fallback=nodes[fallback].fail
      const child=nodes[index];child.fail=nodes[fallback].edges.get(char)??0;child.hits.push(...nodes[child.fail].hits);queue.push(index)}
  }
  return text=>{
    const plain=canonical(text),allows=[],hits=[];let state=0,end=0,lastGap=0
    for(const char of plain){if(!strip(char)){lastGap=end;continue}end++;while(state&&!nodes[state].edges.has(char))state=nodes[state].fail;state=nodes[state].edges.get(char)??0
      for(const hit of nodes[state].hits){const start=end-hit.length,crossed=start<lastGap&&hit.length<=2&&hit.action==='block';(hit.action==='allow'?allows:hits).push({hit:crossed?{...hit,action:'review'}:hit,start,end})}}
    const qqOffsets=new Set([...plain.matchAll(/qq(?=\s*[:：]?\s*[1-9]\d{4,11}(?!\d))/g)].map(marker=>[...strip(plain.slice(0,marker.index))].length))
    let best
    for(const item of hits){if(allows.some(span=>span.start<=item.start&&span.end>=item.end))continue
      if(item.hit.qqLabel&&qqOffsets.has(item.start))continue
      best=item.hit;if(best.action==='block')break}
    if(best?.action!=='block')for(const [kind,pattern] of contacts)if(pattern.test(plain))return {status:'pending',provider:'local',label:'review',summary:{contact:kind}}
    if(best)return {status:best.action==='block'?'blocked':'pending',provider:'local',label:best.action,summary:{wordId:best.id}}
  }
}
