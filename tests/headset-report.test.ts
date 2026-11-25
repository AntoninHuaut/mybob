import assert from 'node:assert/strict';
import test from 'node:test';
import { HeadsetFrameStats, headsetReportLines } from '../src/scene/headsetReport';

const quest = {
  requestedHz: 90,
  retainedHz: 72,
  scale: 1,
  tethered: false,
  foveation: 0.5,
  gpuClass: 'headset' as const,
  gpu: 'Qualcomm · Adreno (TM) 650',
};

test('frames are judged against the display rate in effect when they were drawn', () => {
  const stats = new HeadsetFrameStats();
  for (let i = 0; i < 90; i++) stats.record(1000 / 90, 90);
  // Two refreshes missed at 90 Hz; the same interval at 72 Hz later is on time.
  stats.record(25, 90);
  stats.record(25, 90);
  for (let i = 0; i < 8; i++) stats.record(1000 / 72, 72);
  const summary = stats.summary();
  assert.equal(summary.frames, 100);
  assert.equal(summary.overBudget, 2);
  assert.ok(Math.abs(summary.median - 1000 / 90) < 1e-9);
  assert.ok(Math.abs(summary.durationMs - (90 * 1000) / 90 - 50 - (8 * 1000) / 72) < 1e-6);
});

test('without a known rate (Link), the budget comes from the steady interval', () => {
  const stats = new HeadsetFrameStats();
  for (let i = 0; i < 30; i++) stats.record(1000 / 72);
  stats.record(30);
  const summary = stats.summary();
  assert.equal(summary.overBudget, 1);
  assert.equal(summary.measuredHz, 72);
});

test('the report gives frame times, missed frames, rates, scale, foveation and GPU class', () => {
  const stats = new HeadsetFrameStats();
  for (let i = 0; i < 99; i++) stats.record(1000 / 72, 72);
  stats.record(40, 72);
  const lines = headsetReportLines(stats.summary(), quest);
  assert.equal(lines[0], '[casque] MyBob — rapport de la visite au casque');
  assert.match(lines[1], /100 images en 1,4 s · médiane 13,9 ms · p95 13,9 ms/);
  assert.match(lines[2], /1 % des images ont manqué au moins un rafraîchissement/);
  assert.match(lines[3], /demandée 90 Hz · retenue 72 Hz/);
  assert.match(lines[4], /échelle 1 · autonome · fovéation 0,5/);
  assert.match(lines[5], /carte casque autonome · Qualcomm · Adreno \(TM\) 650/);
});

test('a PC-driven headset without rate control says the headset chose the rate', () => {
  const stats = new HeadsetFrameStats();
  for (let i = 0; i < 20; i++) stats.record(1000 / 80);
  const lines = headsetReportLines(stats.summary(), {
    ...quest,
    requestedHz: undefined,
    retainedHz: undefined,
    scale: 1.2,
    tethered: true,
    foveation: null,
    gpuClass: 'discrete',
  });
  assert.match(lines[3], /choisie par le casque · 80 Hz mesurés/);
  assert.match(lines[4], /échelle 1,2 · relié à un PC · fovéation non prise en charge/);
});

test('a session ended before the house showed says nothing was measured', () => {
  const lines = headsetReportLines(new HeadsetFrameStats().summary(), quest);
  assert.match(lines[1], /aucune image mesurée/);
});
