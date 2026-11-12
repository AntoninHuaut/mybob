import { Engine } from '@babylonjs/core/Engines/engine';
import { Effect } from '@babylonjs/core/Materials/effect';

/**
 * WebGL only, on purpose. The ambient occlusion's prepass needs multiple render
 * targets: on WebGPU, Babylon adds `createMultipleRenderTarget` only through the
 * side-effect module `Engines/WebGPU/Extensions/engine.multiRender`, which this app
 * does not import, so a WebGPU session would silently render a flatter house. And a
 * second backend is a second implementation of every pass to keep correct, one CI
 * never runs. See « Known traps » in docs/ARCHITECTURE.md.
 */
export function createEngine(canvas: HTMLCanvasElement): Engine {
  try {
    // Orbit cutaways switch materials as facades turn towards the camera. Keep
    // their shader variants alive instead of linking them again on every turn.
    // The viewer releases the cache when it disposes the current scene.
    Effect.PersistentMode = true;
    return new Engine(
      canvas,
      true,
      { alpha: true, stencil: true, powerPreference: 'high-performance' },
      false,
    );
  } catch (error) {
    console.error(error);
    throw new Error(
      'WebGL est indisponible dans ce navigateur. Activez l’accélération graphique (Edge/Chrome : Paramètres → Système) puis rechargez la page.',
    );
  }
}
