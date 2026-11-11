import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';

/** Development experiment; scene disposal owns destruction, mode exits own early release. */
export class FxLabEffect {
  private scene?: Scene;
  private observer?: Observer<Scene>;
  private effect?: { dispose(): void };
  constructor(private readonly reset: () => void) {}

  sync(scene: Scene, allowed: boolean): void {
    if (scene !== this.scene) {
      this.release();
      this.scene?.onDisposeObservable.remove(this.observer ?? null);
      this.scene = scene;
      this.reset();
      this.observer = scene.onDisposeObservable.addOnce(() => {
        // Babylon disposes registered pipelines as part of scene disposal.
        // Drop references, never dispose that pipeline again on the next toggle.
        this.effect = undefined;
        this.scene = undefined;
        this.reset();
      });
    }
    if (!allowed) {
      this.release();
      this.reset();
    }
  }

  toggle(enabled: boolean, create: () => { dispose(): void } | undefined): void {
    this.release();
    if (enabled) this.effect = create();
  }

  private release(): void {
    const effect = this.effect;
    this.effect = undefined;
    effect?.dispose();
  }
}
