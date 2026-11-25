import assert from 'node:assert/strict';
import { test } from 'node:test';
import { basePrice, drawGrade, grades, probabilities } from '../web/src/fishing/grades.ts';
import fish from '../web/src/fishing/species.json' with {type: 'json'};
import {bait} from '../web/src/fishing/bait.ts';
import {waters, tabs, ranks, profile} from '../web/src/fishing/config.ts';

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
  const ranges = [[1200, 2000], [400, 999], [52, 200], [20, 120]];
  grades.forEach((grade, index) => {
    const [min, max] = ranges[index];
    assert.deepEqual([0, 0.5, 1].map(fraction => basePrice(grade, fraction)), [min, Math.round((min+max)/2), max]);
  });
});
