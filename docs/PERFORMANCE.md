# Performance

Goal: smooth rendering on modest family machines with no visual quality loss. Measure with
`mybob.profile()` and the "Mesurer chaque vue" bench before and after any change.

## Where the time goes

Measured 2026-11-12 on an RX 9060 XT, private house, 2.8 MP:

- Visite GPU ≈ 3.0 ms: ambient occlusion ~2.0 (blur ~0.67, 16-sample pass ~0.56, rest fixed),
  sun shadow sampling ~1.1, fittings 0.26, bloom 0.2. Vue 3D occlusion ~0.8 ms.
- CPU is not the bottleneck: at CPU ×4 throttling, Vue 3D and Visite still reach ~130 frames/s.
- Startup: 36 shader programs, ~10 PBR variants, ready in 2.2 s.

## Still short of the goal

Owner reports since then: an RTX 3060 laptop runs at ~50 frames/s, and the Quest 2 alone
(headset browser) lags, worse while casting to a PC. Neither has been profiled yet: start
with `mybob.profile()` on that laptop and in the headset before choosing a lever (#312).

Measured 2026-11-25 on an Intel Meteor Lake integrated GPU (`?diagnostic`, 2256 × 1249 px,
120 Hz screen): every 3D view is GPU-bound. Visite GPU ≈ 30 ms against 9 ms of CPU (25 fps),
Vue 3D ≈ 14 ms GPU (47 fps), Extérieur 8 ms, Plan 2.6 ms. The adaptive system then stayed at
100 % with every effect. « Qualité » (#320) now lowers the resolution to 67 % before any
effect and starts an integrated GPU at « Moyenne »: the expected Visite cost at 67 % is about
half the pixels, still to be measured. Earlier, on an integrated GPU at 75 Hz, no single walk
effect cost more than the run-to-run noise; only half the resolution held 75 fps.

## Tried and rejected

Each was measured and gave a visual regression or no gain; retry only with new evidence:

- 8-sample SSAO with rotating noise (#246, reverted in #248): visible grain.
- FSR1 upscaling, WebGPU, clustered lights, Frame Graph.
- Front-to-back sorting, disabling canvas MSAA, texture decoding in a Worker: no gain.
- Walk collisions and picking: already under 0.2 ms.
