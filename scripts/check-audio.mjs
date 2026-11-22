import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {existsSync,readFileSync} from 'node:fs'

const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0')
const audio=files.filter(path=>/\.(mp3|wav|wave|flac|aac|m4a|oga|ogg|opus|aiff?|weba|mid|midi)$/i.test(path)).sort()
const credits=readFileSync('docs/audio-credits.md','utf8').split('\n').filter(line=>line.startsWith('| `'))
const credited=credits.map(line=>{
  const match=line.match(/^\| `([^`]+)` \| [^|]+ \| [^|]+ \| \[CC0 1\.0\]\(https:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/\) \|$/)
  assert.ok(match,`Missing source or license: ${line}`)
  assert.ok(existsSync(match[1]),`Missing asset: ${match[1]}`)
  return match[1]
})
assert.deepEqual(credited.sort(),audio)
const stations=JSON.parse(readFileSync('web/src/radio/stations.json','utf8'))
assert.ok(stations.length>=2 && stations.every(station=>station.tracks.length>=2))
assert.deepEqual(stations.flatMap(station=>station.tracks.map(track=>'public/audio/radio/'+track.file)).sort(),audio.filter(path=>path.startsWith('public/audio/radio/')))
console.log(`${audio.length} audio files credited; ${stations.length} stations checked`)
