import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { Scene } from '@babylonjs/core/scene';
import type { Level, Point2, ProjectSite } from '../model/types';
import type { StairDirection } from '../model/stairs';
import type { ImmersiveWalk } from './xrWalk';

/** True when this browser can open a headset session (Quest browser, desktop VR). */
export async function isImmersiveSupported(): Promise<boolean> {
  try {
    return (await navigator.xr?.isSessionSupported('immersive-vr')) ?? false;
  } catch {
    return false;
  }
}

/** Fetches the headset code ahead of the click: a slow import would outlive the user gesture. */
export function preloadImmersive() {
  return import('./xrWalk');
}

/**
 * Share of enabled, visible meshes ready to draw, and whether the headset veil may lift.
 * Each mesh is asked, not only up to the first refusal, so that all their links start
 * together.
 */
export function sceneReadiness(scene: Scene, engine: AbstractEngine) {
  let total = 0;
  let done = 0;
  for (const mesh of scene.meshes) {
    if (!mesh.isEnabled() || !mesh.isVisible || !mesh.subMeshes?.length) continue;
    total++;
    if (mesh.isReady(true)) done++;
  }
  return {
    fraction: total ? done / total : 1,
    ready: done === total && engine.areAllEffectsReady() && scene.getWaitingItemsCount() === 0,
  };
}

/** What the viewer lends a headset session: its scene, where the visitor stands, its doors. */
export interface HeadsetHost {
  scene: Scene;
  engine: AbstractEngine;
  /** Read live: a stair changes the displayed level during the session. */
  readonly level: Level;
  site?: ProjectSite;
  eyeHeight: number;
  start: { point: Point2; yaw: number };
  isDestination(point: Point2): boolean;
  toggleDoor(id: string): void;
  takeStair(id: string, direction: StairDirection): boolean;
  /** False once the viewer replaced the scene or left the walk. */
  isCurrent(): boolean;
  onEnd(walk: ImmersiveWalk): void;
}

/** At most one headset visit at a time, from the request until the session ends. */
export class HeadsetSession {
  private current?: ImmersiveWalk;
  private starting = false;

  get walk(): ImmersiveWalk | undefined {
    return this.current;
  }
  get busy() {
    return this.starting || !!this.current;
  }

  /**
   * Starts the session; false when one is already running or starting, or when the
   * viewer moved on while the browser opened it. Rejects with the browser's error.
   */
  async open(host: HeadsetHost): Promise<boolean> {
    if (this.busy) return false;
    this.starting = true;
    try {
      const { startImmersiveWalk } = await preloadImmersive();
      let readiness = 0;
      const walk = await startImmersiveWalk({
        scene: host.scene,
        get level() {
          return host.level;
        },
        site: host.site,
        eyeHeight: host.eyeHeight,
        start: host.start,
        isDestination: (point) => host.isDestination(point),
        toggleDoor: (id) => host.toggleDoor(id),
        takeStair: (id, direction) => host.takeStair(id, direction),
        isReady: () => {
          if (!host.isCurrent() || host.scene.isDisposed) return true;
          const state = sceneReadiness(host.scene, host.engine);
          readiness = state.fraction;
          return state.ready;
        },
        readiness: () => readiness,
        onEnd: (ended) => host.onEnd(ended),
      });
      if (!host.isCurrent() || !walk.active) {
        walk.dispose();
        return false;
      }
      this.current = walk;
      return true;
    } finally {
      this.starting = false;
    }
  }

  /** `walk` ended: true when it was this session's, now disposed. */
  release(walk: ImmersiveWalk): boolean {
    if (this.current !== walk) return false;
    this.current = undefined;
    walk.dispose();
    return true;
  }

  /** Asks the running session to end; `HeadsetHost.onEnd` follows asynchronously. */
  exit() {
    return this.current?.exit();
  }

  /** The scene is going away: the session belongs to it. */
  dispose() {
    this.current?.dispose();
    this.current = undefined;
  }
}
