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

## Plan editing responsiveness

Wall and corner drags on the Plan (#359, measured alongside #322): `#plan-selection` carries
the last pointer event's timestamp-to-preview-DOM-update time, in ms, in
`data-preview-latency-ms`; `e2e/plan-design.spec.ts` logs it for the partition drag. It covers
dispatch, room derivation and the SVG write, not paint. Record browser, machine and project with
each sample; no target is set yet.

## Furniture dialogs

Measured 2026-11-25 at CPU ×4 (Event Timing, input to paint, studio demo): « Modifier … »
opens in 64 ms and « Enregistrer » paints in 48 ms, down from 112 and 128 ms (#370). The
selection overlays are rebuilt only when their lines or labels change, and label textures are
reused across redraws. What remains when a dialog opens is building and laying out its form.

## Plan ↔ Vue 3D switch

Measured 2026-11-25 at CPU ×4, larger private house: a repeat Vue 3D switch paints in
64–88 ms (was 96–120 ms) and Plan in 56–80 ms (was 80–88 ms); the first Plan warm-up dropped
from 586 to 341 ms (#371). Two causes of every material rebuilding its defines were removed: cut
walls keep their cutaway clone under a section plane, and ceiling fixtures stay enabled at zero
intensity in Plan. Plan captures are bit-identical; Vue 3D differs only by temporal noise.

## Tried and rejected

Each was measured and gave a visual regression or no gain; retry only with new evidence:

- 8-sample SSAO with rotating noise (#246, reverted in #248): visible grain.
- FSR1 upscaling, WebGPU, clustered lights, Frame Graph.
- Front-to-back sorting, disabling canvas MSAA, texture decoding in a Worker: no gain. (Texture
  _generation_ does run in a worker since #321: it costs far more than decoding.)
- Walk collisions and picking: already under 0.2 ms.
