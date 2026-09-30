// The swarm module: one fly answers every exam photo in every look, votes add up, boosting weights behave.
import assert from 'node:assert/strict';
import { mergeConfig } from '../src/config.js';
import { setupConfig, DEFAULT_ABILITIES } from '../src/abilities.js';
import { flyJob, gazeSpots, gazeConfig, balanced, scaledScores, mistakeCorrelation, boostWeights, flySay, WeightedSet } from '../src/swarm.js';
import { loadFacesNode } from '../tools/lib.mjs';

let failed = 0;
const ok = (name, fn) => { try { fn(); console.log('ok  ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n' + e.stack); } };

const { train, test } = loadFacesNode(60); // a few dozen photos per class: fast
const cfg = mergeConfig(gazeConfig([8, 0]), mergeConfig(setupConfig('faces', { ...DEFAULT_ABILITIES, fovea: true })));
const nTe = test.labels.length;

const job = flyJob({ cfg, train, test, seed: 3, episodes: 4, looks: 2, trainMargins: true });
ok('a fly answers every exam photo in every look (or says nothing), with a margin for each', () => {
  assert.equal(job.test.foot.length, nTe * 2);
  assert.equal(job.test.margin.length, nTe * 2);
  assert.ok(job.test.foot.every((f) => f >= -1 && f <= 1));
  assert.equal(job.train.margin.length, train.labels.length);
});

ok('the gaze circle puts flies evenly around the centre', () => {
  const s = gazeSpots(4, 10);
  assert.equal(s.length, 4);
  assert.ok(Math.abs(s[0][0] - 10) < 1e-9 && Math.abs(s[2][0] + 10) < 1e-9);
  assert.deepEqual(gazeSpots(3, 0), [[0, 0], [0, 0], [0, 0]]);
});

ok('votes: adding scaled margins of identical flies changes nothing, of opposite flies cancels', () => {
  const labels = Array.from(test.labels);
  const a = job.test, b = { foot: a.foot, margin: a.margin.map((v) => -v) };
  const sc = scaledScores([a, a], nTe, 2);
  assert.equal(balanced(labels, (i) => sc[0][i] + sc[1][i]), balanced(labels, (i) => sc[0][i]));
  const opp = scaledScores([a, b], nTe, 2);
  assert.ok(Math.abs(opp[0][5] + opp[1][5]) < 1e-9);
  assert.ok(mistakeCorrelation(labels, sc) > 0.99);
});

ok('boosting weights: hard photos count more, capped, mean 1 within each class', () => {
  const labels = [0, 0, 0, 0, 1, 1, 1, 1];
  const good = [-1, -1, -1, 1, 1, 1, 1, -1]; // photo 3 and 7 are wrong
  const w = boostWeights(labels, [good], [1], 1, 4);
  assert.ok(w[3] > w[0] && w[7] > w[4]);
  assert.ok(w.every((v) => v <= 4 + 1e-9));
  assert.ok(Math.abs(w.slice(0, 4).reduce((a, b) => a + b, 0) / 4 - 1) < 1e-9);
  const s = flySay(labels, good, new Array(8).fill(1));
  assert.ok(s.say > 0 && s.err === 0.25);
});

ok('a weighted set draws the heavy photo', () => {
  const w = new Array(train.labels.length).fill(0.0001);
  const heavy = Array.from(train.labels).findIndex((y) => y === 0);
  w[heavy] = 1000;
  const set = new WeightedSet(train, w);
  let s = 12345; const rng = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const a = set.sample(rng, 0), b = set.sample(rng, 0);
  assert.equal(a.length, b.length);
});

if (failed) process.exit(1);
console.log('swarm tests passed');
