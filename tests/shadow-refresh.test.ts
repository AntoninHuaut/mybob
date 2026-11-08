import assert from 'node:assert/strict';
import test from 'node:test';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { SHADOW_SETTLE_FRAMES, ShadowRefresh } from '../src/scene/shadowRefresh';

// NullEngine never compiles the shadow depth shader, so the map is a stand-in: the
// policy only reads its readiness and writes its refresh rate.
function setup() {
  const map = {
    ready: false,
    writes: 0,
    rate: RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME,
    get refreshRate() {
      return this.rate;
    },
    set refreshRate(value: number) {
      this.rate = value;
      this.writes++;
    },
    isReadyForRendering() {
      return this.ready;
    },
  };
  const refresh = new ShadowRefresh({ getShadowMap: () => map } as unknown as ShadowGenerator);
  return { map, refresh };
}

test('la carte d’ombres reste redessinée tant qu’un mur compile encore', () => {
  const { map, refresh } = setup();
  for (let frame = 0; frame < 20; frame++) refresh.step();
  assert.equal(refresh.settled, false);
  assert.equal(map.refreshRate, RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME);
});

test('une fois les murs prêts, la carte est dessinée une dernière fois puis gardée', () => {
  const { map, refresh } = setup();
  map.ready = true;
  for (let frame = 0; frame < SHADOW_SETTLE_FRAMES; frame++) refresh.step();
  assert.equal(refresh.settled, true);
  refresh.step();
  assert.equal(map.refreshRate, RenderTargetTexture.REFRESHRATE_RENDER_ONCE);
  const writes = map.writes;
  for (let frame = 0; frame < 10; frame++) refresh.step();
  // Writing the rate again would reset Babylon's counter and redraw the map.
  assert.equal(map.writes, writes);
});

test('un changement de soleil, de coupe ou de porte relance le dessin jusqu’à stabilisation', () => {
  const { map, refresh } = setup();
  map.ready = true;
  for (let frame = 0; frame <= SHADOW_SETTLE_FRAMES; frame++) refresh.step();
  assert.equal(map.refreshRate, RenderTargetTexture.REFRESHRATE_RENDER_ONCE);
  refresh.invalidate();
  refresh.step();
  assert.equal(map.refreshRate, RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME);
  for (let frame = 0; frame < SHADOW_SETTLE_FRAMES; frame++) refresh.step();
  assert.equal(map.refreshRate, RenderTargetTexture.REFRESHRATE_RENDER_ONCE);
});
