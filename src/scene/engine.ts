import { Engine } from '@babylonjs/core/Engines/engine';
import { Effect } from '@babylonjs/core/Materials/effect';

/**
 * WebGL only, on purpose. The visit's ambient occlusion needs the geometry
 * buffer, which Babylon implements on WebGL alone: `createMultipleRenderTarget`
 * does not exist on the WebGPU engine, so a WebGPU session would silently render
 * a flatter house. One backend means one rendering path to keep correct.
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
