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

## Tried and rejected

Each was measured and gave a visual regression or no gain; retry only with new evidence:

- 8-sample SSAO with rotating noise (#246, reverted in #248): visible grain.
- FSR1 upscaling, WebGPU, clustered lights, Frame Graph.
- Front-to-back sorting, disabling canvas MSAA, texture decoding in a Worker: no gain.
- Walk collisions and picking: already under 0.2 ms.
