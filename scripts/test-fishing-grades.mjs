import assert from 'node:assert/strict';
import { test } from 'node:test';
import { basePrice, drawGrade, grades, probabilities } from '../web/src/fishing/grades.ts';
import fish from '../web/src/fishing/species.json' with {type: 'json'};
import {bait} from '../web/src/fishing/bait.ts';
import {FishingEngine} from '../web/src/fishing/engine.ts';
import {resolveCast, chargePower, waters, tabs, ranks, profile} from '../web/src/fishing/config.ts';

test('water occurrence counts, tabs and ranks', () => {
  assert.equal(tabs.length,5);assert.equal(ranks.length,6);
  for (const row of fish) assert.equal(waters.filter(water=>water.fish.includes(row.id)).length,row.waterCount,row.name);
  assert.equal(profile(100000,27,3).rank,ranks[5]);assert.equal(profile(100000,26,3).rank,ranks[4]);
});

test('specimen order, grade counts and universal baits', () => {
  assert.deepEqual(fish.map(row => row.number), Array.from({length: 27}, (_, index) => `桂渔 ${String(index+1).padStart(3, '0')}`));
  assert.deepEqual(grades.map(grade => fish.filter(row => row.grade === grade).length), [7, 11, 3, 6]);
  assert.equal(bait.length, 14);
  const speciesIds = new Set(fish.map(({id}) => id));
  for (const {name, targets} of bait) for (const id of targets) assert.ok(speciesIds.has(id), `${name}: unknown species ${id}`);
  assert.ok(bait.find(row => row.name === '银色亮片').targets.includes('008'));
  assert.deepEqual(bait.filter(row => !row.targets.length).map(row => row.name), ['铜色亮片', '黑色饵料']);
});

for (const [zone, distribution] of Object.entries(probabilities)) {
  test(`${zone}: 100k draws`, context => {
    let seed = 337;
    const random = () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 2 ** 32);
    const counts = [0, 0, 0, 0];
    for (let index = 0; index < 100_000; index++) counts[grades.indexOf(drawGrade(zone, random))]++;
    context.diagnostic(`counts: ${counts}`);
    counts.forEach((count, index) => assert.ok(Math.abs(count / 100_000 - distribution[index]) <= (index === 0 ? 0.0015 : 0.005)));
  });
}

test('prices interpolate between specified grade endpoints', () => {
  const ranges = [[150,400],[40,120],[10,30],[3,12]];
  grades.forEach((grade, index) => {
    const [min, max] = ranges[index];
    assert.deepEqual([0, 0.5, 1].map(fraction => basePrice(grade, fraction)), [min, Math.round((min+max)/2), max]);
  });
});
test('100k complete casts per enabled water and method',context=>{
  context.diagnostic('水域 | 钓法 | 传说% | 高级% | 中级% | 低级% | 空钩% | 杂物% | 未咬口/逃脱%');
  for(const [index,water] of waters.entries())for(const method of ['路亚','台钓']){
    const setup={distance:8,water,method,line:1,rod:1,bait:method==='台钓'?'bait11':'bait1',float:false,drag:false};
    const counts={legendary:0,high:0,medium:0,low:0,'empty-hook':0,junk:0,miss:0,escape:0};
    const engine=new FishingEngine(()=>{},item=>{counts[item.grade]++;return true});engine.equip();engine.setSeed(337+index);
    if(!water.methods.includes(method)){assert.equal(engine.cast(setup),false);continue}
    for(const grade of ['low','medium'])assert.ok(fish.some(row=>row.grade===grade&&row.methods.includes(method)&&water.fish.includes(row.id)),`${water.name} ${method} ${grade}`);
    for(let cast=0;cast<100000;cast++){
      assert.ok(engine.cast(setup));engine.tick(.25);engine.reel=true;engine.tick(5);
      while(['approach','nibble'].includes(engine.stage))engine.tick(.41);
      if(engine.stage==='hit'){engine.reel=false;engine.press();for(let tick=0;engine.stage==='fight'&&tick<600;tick++){
        engine.reel=engine.tension<.68;engine.tick(.1)
      }}
      if(engine.stage!=='land'&&engine.stage!=='junk'){assert.ok(['empty-hook','miss','escape'].includes(engine.stage));counts[engine.stage]++}
    }
    assert.equal(Object.values(counts).reduce((sum,value)=>sum+value,0),100000);
    const rates=[counts.legendary,counts.high,counts.medium,counts.low,counts['empty-hook'],counts.junk,counts.miss+counts.escape].map(count=>(count/1000).toFixed(3));
    context.diagnostic([water.name,method,...rates].join(' | '));
  }
});

test('power ramp, full oscillation and water-only backtracking',()=>{
  assert.deepEqual([0,.6,1.2,1.7,2.2].map(chargePower),[0,.5,1,.95,1]);const from={x:1,y:10,z:5}
  const cast=(power,max)=>resolveCast(from,0,power,(_x,z)=>z<=from.z+max?9:null)
  assert.equal(cast(0,30).distance,6);assert.deepEqual(cast(1,30).to,{x:1,y:9,z:35});assert.equal(cast(.99,4).distance,4);assert.equal(cast(1,3.9),null)
})
