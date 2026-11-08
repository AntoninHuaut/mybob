import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';

/**
 * Images rendered once every caster is ready again: a caster whose shader is still
 * compiling is skipped by the shadow pass, so one single render could miss it.
 */
export const SHADOW_SETTLE_FRAMES = 3;

/**
 * The sun's shadow map only depends on the casters (walls, doors, roof) and on the sun,
 * never on the camera: redrawing its 2048² depth pass on every image costs the GPU
 * without changing a pixel. It is redrawn only after `invalidate()`, until settled.
 */
export class ShadowRefresh {
  private pending = SHADOW_SETTLE_FRAMES;

  constructor(private readonly generator: ShadowGenerator) {}

  /** A caster moved, appeared or disappeared, or the sun changed. */
  invalidate() {
    this.pending = SHADOW_SETTLE_FRAMES;
  }

  /** Once per image, before the shadow pass. */
  step() {
    const map = this.generator.getShadowMap();
    if (!map) return;
    if (this.pending > 0) {
      if (map.refreshRate !== RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME)
        map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME;
      if (map.isReadyForRendering()) this.pending--;
    } else if (map.refreshRate !== RenderTargetTexture.REFRESHRATE_RENDER_ONCE) {
      // The setter resets the counter: the map is drawn one last time, then kept.
      map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    }
  }

  get settled(): boolean {
    return this.pending === 0;
  }
}
