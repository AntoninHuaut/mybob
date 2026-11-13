import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTetheredHeadset,
  parseXrScale,
  startScale,
  XR_SCALE_HOLD_WINDOWS,
  XR_SCALE_SLOW_WINDOWS,
  XrScaleTuner,
} from '../src/scene/xrScale';

const QUEST =
  'Mozilla/5.0 (X11; Linux x86_64; Quest 2) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/35.0 Chrome/126 VR Safari/537.36';
const DESKTOP_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36';

test('a headset streamed from a PC is tethered; the Quest Browser is not', () => {
  assert.equal(isTetheredHeadset(DESKTOP_CHROME), true);
  assert.equal(isTetheredHeadset(QUEST), false);
});

test('a PC starts at 120 % or where its last session left it; a standalone headset at 100 %', () => {
  assert.equal(startScale(undefined, true), 1.2);
  assert.equal(startScale(1.4, true), 1.4);
  assert.equal(startScale(3, true), 1.5);
  assert.equal(startScale(1.4, false), 1);
  assert.equal(parseXrScale('{"scale":1.3}'), 1.3);
  for (const raw of [null, '', 'pas du json', '{"scale":"x"}'])
    assert.equal(parseXrScale(raw), undefined);
});

test('a session that kept up with the headset makes the next one 10 % sharper', () => {
  const tuner = new XrScaleTuner(1.2);
  for (let i = 0; i < XR_SCALE_HOLD_WINDOWS; i++) tuner.observe(89.5, 90);
  assert.equal(tuner.next, 1.3);
});

test('a session that fell behind makes the next one 10 % softer, never under 100 %', () => {
  const tuner = new XrScaleTuner(1.2);
  for (let i = 0; i < 20; i++) tuner.observe(90, 90);
  for (let i = 0; i < XR_SCALE_SLOW_WINDOWS; i++) tuner.observe(70, 90);
  assert.equal(tuner.next, 1.1);
  const floor = new XrScaleTuner(1);
  floor.markTooMuch();
  assert.equal(floor.next, 1);
});

test('without a known display rate, the fastest window seen stands for it', () => {
  const tuner = new XrScaleTuner(1.2);
  for (let i = 0; i < XR_SCALE_HOLD_WINDOWS; i++) tuner.observe(i % 2 ? 72 : 71.5);
  assert.equal(tuner.next, 1.3);
});

test('a short session decides nothing', () => {
  const tuner = new XrScaleTuner(1.3);
  for (let i = 0; i < 3; i++) tuner.observe(90, 90);
  assert.equal(tuner.next, 1.3);
});
