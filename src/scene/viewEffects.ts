import { createExteriorEnvironment } from './exteriorAmbience';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import type { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import type { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import type { TAARenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/taaRenderingPipeline';
import type { OcclusionState } from './diagnostics';
import {
  createInteriorBloom,
  createInteriorEnvironment,
  createInteriorOcclusion,
  createInteriorTaa,
  createOrbitBloom,
  createOrbitOcclusion,
  createOrbitTaa,
  INTERIOR_ENVIRONMENT_INTENSITY,
} from './interiorAmbience';
import { EFFECT_TIERS } from './adaptiveResolution';

/** The occlusion fades out over this long instead of disappearing in one image. */
export const OCCLUSION_FADE_MS = 800;

type Bloom = Pick<DefaultRenderingPipeline, 'dispose' | 'bloomEnabled'>;
type Occlusion = Pick<SSAO2RenderingPipeline, 'dispose' | 'totalStrength'>;
type OrbitTemporal = Pick<
  TAARenderingPipeline,
  'dispose' | 'samples' | 'isEnabled' | 'factor' | 'disableOnCameraMove'
>;
type Temporal = Pick<TAARenderingPipeline, 'dispose' | 'samples'> &
  Partial<Pick<TAARenderingPipeline, 'reprojectHistory'>>;
interface EffectFactories {
  environment(scene: Scene): BaseTexture | undefined;
  taa(scene: Scene, camera: Camera): Temporal | undefined;
  occlusion(scene: Scene, camera: Camera): Occlusion | undefined;
  bloom(scene: Scene, camera: Camera): Bloom | undefined;
  orbitTaa?(scene: Scene, camera: Camera): OrbitTemporal | undefined;
  orbitBloom(scene: Scene, camera: Camera): Bloom | undefined;
  orbitOcclusion?(scene: Scene, camera: Camera): Occlusion | undefined;
}
const factories: EffectFactories = {
  environment: createInteriorEnvironment,
  taa: createInteriorTaa,
  occlusion: createInteriorOcclusion,
  bloom: createInteriorBloom,
  orbitBloom: createOrbitBloom,
  orbitTaa: createOrbitTaa,
  orbitOcclusion: createOrbitOcclusion,
};

/** What the overview asks of `updateOrbit` besides being on screen. */
export interface OrbitOptions {
  /** Vue 3D on a hardware renderer: not Extérieur, never a software rasteriser. */
  occlusion?: boolean;
  effectTier?: number;
}

/** All view effects belong to one scene; walk pipelines also belong to one camera. */
export class ViewEffects {
  private environment?: BaseTexture;
  private exteriorEnvironment?: BaseTexture;
  private exteriorKey = '';
  private exteriorTimer?: ReturnType<typeof setTimeout>;
  private exteriorActive = false;
  private exteriorUnavailable = false;
  private environmentUnavailable = false;
  private occlusionUnavailable = false;
  private taa?: Temporal;
  private occlusion?: Occlusion;
  private occlusionFade?: { from: number; since: number };
  private bloom?: Bloom;
  private orbitBloom?: Bloom;
  private orbitAttached = false;
  private orbitTaa?: OrbitTemporal;
  private orbitTaaAttempted = false;
  private orbitOcclusion?: Occlusion;
  private orbitOcclusionFade?: { from: number; since: number };
  private orbitOcclusionUnavailable = false;
  private camera?: Camera;
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    private readonly create: EffectFactories = factories,
    private readonly createExterior: (
      scene: Scene,
      direction: Vector3,
    ) => BaseTexture | undefined = createExteriorEnvironment,
    private readonly invalidate: () => void = () => {},
  ) {
    scene.onDisposeObservable.addOnce(() => this.dispose());
  }

  updateWalk(state: {
    active: boolean;
    camera: Camera;
    headset: boolean;
    effectsEnabled: boolean;
    effectTier: number;
  }): void {
    if (this.disposed) return;
    if (!state.active) {
      this.restoreEnvironment();
      this.releaseWalkPipelines();
      return;
    }
    this.cancelExteriorRebuild();
    this.exteriorActive = false;
    if (!this.environmentUnavailable) {
      this.environment ??= this.create.environment(this.scene);
      this.environmentUnavailable = !this.environment;
    }
    if (this.environment) {
      this.scene.environmentTexture = this.environment;
      this.scene.environmentIntensity = INTERIOR_ENVIRONMENT_INTENSITY;
    }
    if (this.camera !== state.camera) this.releaseWalkPipelines();
    this.camera = state.camera;
    if (state.headset && !state.effectsEnabled) {
      this.releaseWalkPipelines();
      return;
    }
    // Babylon appends pipelines to the camera: temporal, occlusion, then bloom.
    this.taa ??= this.create.taa(this.scene, state.camera);
    if (!this.occlusionUnavailable && !this.occlusion && state.effectTier < EFFECT_TIERS) {
      this.occlusion = this.create.occlusion(this.scene, state.camera);
      this.occlusionUnavailable = !this.occlusion;
    }
    this.applyEffectTier(state.effectTier);
    // Headset bloom would render into a zero-size target.
    if (!state.headset) this.bloom ??= this.create.bloom(this.scene, state.camera);
  }

  /** Select the current mode's sky explicitly; debounce only changes to solar direction. */
  updateEnvironment(mode: 'overview' | 'plan' | 'walk', direction: Vector3): void {
    if (this.disposed) return;
    this.exteriorActive = mode === 'overview';
    this.cancelExteriorRebuild();
    if (mode === 'walk') return;
    if (mode === 'plan') {
      this.scene.environmentTexture = null;
      return;
    }
    if (this.exteriorUnavailable) return;
    const snapshot = direction.clone();
    const key = snapshot.asArray().join(',');
    const rebuild = () => {
      if (this.disposed || !this.exteriorActive) return;
      this.exteriorTimer = undefined;
      const next = this.createExterior(this.scene, snapshot);
      if (!next) {
        this.exteriorUnavailable = true;
        return;
      }
      const previous = this.exteriorEnvironment;
      this.exteriorEnvironment = next;
      this.exteriorKey = key;
      this.scene.environmentTexture = next;
      this.scene.environmentIntensity = 0.25;
      previous?.dispose();
      this.invalidate();
    };
    if (!this.exteriorEnvironment) rebuild();
    else {
      this.scene.environmentTexture = this.exteriorEnvironment;
      this.scene.environmentIntensity = 0.25;
      if (key !== this.exteriorKey) this.exteriorTimer = setTimeout(rebuild, 150);
    }
  }

  updateOrbit(active: boolean, camera: Camera, options: OrbitOptions = {}): void {
    if (this.disposed) return;
    if (active && !this.orbitTaaAttempted && this.create.orbitTaa && this.scene.getFrameId() > 0) {
      this.orbitTaaAttempted = true;
      // The first scene frame establishes capabilities. Replace the initial bloom
      // once so temporal accumulation becomes the first stage on this camera.
      this.orbitBloom?.dispose();
      this.orbitBloom = undefined;
      this.orbitAttached = false;
      this.orbitTaa = this.create.orbitTaa(this.scene, camera);
      this.invalidate();
    }
    if (this.orbitTaa && this.orbitTaa.isEnabled !== active) {
      // Appending TAA behind an attached bloom would reverse the chain on reentry.
      if (active && this.orbitAttached) {
        this.scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(
          'orbit-bloom',
          camera,
        );
        this.orbitAttached = false;
      }
      this.orbitTaa.isEnabled = active;
      if (!active) camera.getProjectionMatrix(true);
    }
    // Occlusion sits between the temporal refinement and the bloom, so it waits for
    // the refinement's one attempt and is appended with the bloom detached; the bloom
    // is attached again below, last. It leaves with Vue 3D, and the last effect tier
    // fades it out for good (`applyEffectTier`).
    const tier = options.effectTier ?? 0;
    if (!active || !options.occlusion) this.releaseOrbitOcclusion();
    else if (
      !this.orbitOcclusion &&
      !this.orbitOcclusionUnavailable &&
      tier < EFFECT_TIERS &&
      this.create.orbitOcclusion &&
      (this.orbitTaaAttempted || !this.create.orbitTaa)
    ) {
      if (this.orbitBloom && this.orbitAttached) {
        this.scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(
          'orbit-bloom',
          camera,
        );
        this.orbitAttached = false;
      }
      this.orbitOcclusion = this.create.orbitOcclusion(this.scene, camera);
      this.orbitOcclusionUnavailable = !this.orbitOcclusion;
      this.invalidate();
    }
    if (active && !this.orbitBloom) {
      this.orbitBloom = this.create.orbitBloom(this.scene, camera);
      this.orbitAttached = Boolean(this.orbitBloom);
    }
    if (!this.orbitBloom || active === this.orbitAttached) return;
    // Detaching keeps post-processes and their targets alive. Changing bloomEnabled
    // instead rebuilds the whole DefaultRenderingPipeline on every mode switch.
    const manager = this.scene.postProcessRenderPipelineManager;
    if (active) manager.attachCamerasToRenderPipeline('orbit-bloom', camera, true);
    else manager.detachCamerasFromRenderPipeline('orbit-bloom', camera);
    this.orbitAttached = active;
  }

  /** Fresh temporal samples prevent export overlay toggles from inheriting old pixels. */
  renderCapture(render: () => void): void {
    const temporal = this.orbitTaa;
    if (!temporal?.isEnabled) {
      render();
      return;
    }
    const factor = temporal.factor;
    const disableOnCameraMove = temporal.disableOnCameraMove;
    try {
      temporal.disableOnCameraMove = false;
      for (let sample = 0; sample < temporal.samples; sample++) {
        temporal.factor = 1 / (sample + 1);
        render();
      }
    } finally {
      temporal.factor = factor;
      temporal.disableOnCameraMove = disableOnCameraMove;
    }
  }

  /**
   * True while an effect that varies from one image to the next is on screen: the temporal
   * antialiasing (walk, or orbit in 3D view) and the visit's occlusion, which reads the
   * jittered depth. A still view must not be redrawn then (`renderScheduler.ts`).
   */
  get temporalActive(): boolean {
    return Boolean(this.taa || this.occlusion || this.orbitTaa?.isEnabled);
  }

  /**
   * Returns whether a new frame is needed. A tier never leaves a degraded look on screen:
   * the occlusion is either whole or gone, and it fades out rather than blinking off.
   */
  applyEffectTier(tier: number, now: number = performance.now()): boolean {
    if (tier < EFFECT_TIERS) return false;
    let changed = false;
    if (this.occlusion) {
      this.occlusionFade ??= { from: this.occlusion.totalStrength, since: now };
      if (!fade(this.occlusion, this.occlusionFade, now)) {
        this.occlusion.dispose(true);
        this.occlusion = undefined;
        this.occlusionFade = undefined;
      }
      changed = true;
    }
    if (this.orbitOcclusion) {
      this.orbitOcclusionFade ??= { from: this.orbitOcclusion.totalStrength, since: now };
      if (!fade(this.orbitOcclusion, this.orbitOcclusionFade, now)) this.releaseOrbitOcclusion();
      changed = true;
    }
    return changed;
  }

  /** The prepass serves both occlusions and the walk's temporal reprojection. */
  private prePassInUse(): boolean {
    return Boolean(this.taa || this.occlusion || this.orbitOcclusion);
  }

  private releaseOrbitOcclusion(): void {
    if (!this.orbitOcclusion) return;
    this.orbitOcclusion.dispose(false);
    this.orbitOcclusion = undefined;
    this.orbitOcclusionFade = undefined;
    if (!this.prePassInUse()) this.scene.disablePrePassRenderer();
    this.invalidate();
  }

  releaseWalkPipelines(): void {
    this.occlusion?.dispose(true);
    this.occlusion = undefined;
    this.occlusionFade = undefined;
    if (this.taa) {
      // Disposing the pipeline leaves the jitter material plugin it created attached
      // and enabled: every material keeps different defines after the visit, and the
      // other views relink all their programs. Reprojection off turns it back off.
      if ('reprojectHistory' in this.taa) this.taa.reprojectHistory = false;
      this.taa.dispose();
    }
    this.taa = undefined;
    this.bloom?.dispose();
    this.bloom = undefined;
    this.camera = undefined;
    // Vue 3D's occlusion may still read it: leaving the walk keeps the prepass then.
    if (!this.prePassInUse()) this.scene.disablePrePassRenderer();
  }

  status(walking: boolean): { environment: boolean; occlusion: OcclusionState } {
    return {
      environment: Boolean(
        this.scene.environmentTexture &&
        (this.scene.environmentTexture === this.environment ||
          this.scene.environmentTexture === this.exteriorEnvironment),
      ),
      occlusion: walking
        ? this.occlusion
          ? 'active'
          : 'unavailable'
        : this.orbitOcclusion
          ? 'active'
          : 'idle',
    };
  }

  private cancelExteriorRebuild(): void {
    if (this.exteriorTimer !== undefined) clearTimeout(this.exteriorTimer);
    this.exteriorTimer = undefined;
  }

  private restoreEnvironment(): void {
    if (this.environment && this.scene.environmentTexture === this.environment) {
      this.scene.environmentTexture = null;
      this.scene.environmentIntensity = 1;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.restoreEnvironment();
    this.releaseWalkPipelines();
    this.cancelExteriorRebuild();
    if (this.scene.environmentTexture === this.exteriorEnvironment)
      this.scene.environmentTexture = null;
    this.exteriorEnvironment?.dispose();
    this.exteriorEnvironment = undefined;
    this.environment?.dispose();
    this.environment = undefined;
    this.orbitBloom?.dispose();
    this.orbitBloom = undefined;
    this.orbitTaa?.dispose();
    this.orbitTaa = undefined;
    this.orbitOcclusion?.dispose(false);
    this.orbitOcclusion = undefined;
  }
}

/** One step of an occlusion fade; false once it has reached zero. */
function fade(occlusion: Occlusion, state: { from: number; since: number }, now: number): boolean {
  const progress = Math.max(0, (now - state.since) / OCCLUSION_FADE_MS);
  if (progress >= 1) return false;
  occlusion.totalStrength = state.from * (1 - progress);
  return true;
}
