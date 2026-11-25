import assert from 'node:assert/strict';
import test from 'node:test';
import { gpuClass, RefreshRateEstimator } from '../src/scene/deviceProfile';

const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/158.0.0.0 Safari/537.36';
const QUEST =
  'Mozilla/5.0 (X11; Linux x86_64; Quest 2) AppleWebKit/537.36 OculusBrowser/40.0 Chrome/158.0 VR Safari/537.36';

test('the GPU class is read from the renderer string', () => {
  const cases: Array<[string, string]> = [
    ['ANGLE (Intel, Mesa Intel(R) Graphics (MTL), OpenGL ES 3.2)', 'integrated'],
    [
      'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'integrated',
    ],
    ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
    ['ANGLE (Intel, Intel(R) Arc(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
    ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
    ['ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
    ['ANGLE (AMD, AMD Radeon 780M Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
    [
      'ANGLE (AMD, AMD Radeon(TM) RX Vega 11 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'integrated',
    ],
    ['ANGLE (AMD, AMD Radeon(TM) R7 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
    ['ANGLE (AMD, AMD Radeon 8060S Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
    ['ANGLE (AMD, Radeon RX Vega 64 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
    ['ANGLE (AMD, AMD Radeon RX 9060 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
    [
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002560) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'discrete',
    ],
    ['Apple M2', 'integrated'],
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 'software'],
    ['Microsoft Basic Render Driver', 'software'],
    ['', 'unknown'],
  ];
  for (const [renderer, expected] of cases)
    assert.equal(gpuClass(renderer, DESKTOP), expected, renderer);
});

test('a standalone headset browser is its own class, whatever its mobile GPU', () => {
  assert.equal(gpuClass('Adreno (TM) 650', QUEST), 'headset');
  assert.equal(gpuClass(undefined, QUEST), 'headset');
  assert.equal(
    gpuClass('Adreno (TM) 740', 'Mozilla/5.0 (Linux; Android 14; Pixel 8)'),
    'integrated',
  );
});

test('the refresh rate is read from loop ticks that drew nothing', () => {
  const meter = new RefreshRateEstimator();
  assert.equal(meter.hz, undefined, 'nothing measured yet');
  let now = 0;
  // The tick after a drawn image waited for the GPU: that interval never counts.
  let rendered = false;
  for (let i = 0; i < 40; i++) {
    now += rendered ? 40 : 1000 / 144;
    rendered = i % 3 === 0;
    meter.tick(now, rendered);
  }
  assert.equal(meter.hz, 144);
});

test('occasional stalls between idle ticks do not lower the rate', () => {
  const meter = new RefreshRateEstimator();
  let now = 0;
  for (let i = 0; i < 40; i++) {
    now += i % 4 === 0 ? 1000 / 30 : 1000 / 60;
    meter.tick(now, false);
  }
  assert.equal(meter.hz, 60);
});
