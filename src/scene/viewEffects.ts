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
  INTERIOR_ENVIRONMENT_INTENSITY,
} from './interiorAmbience';

type Bloom = Pick<DefaultRenderingPipeline, 'dispose' | 'bloomEnabled'>;
type Occlusion = Pick<SSAO2RenderingPipeline, 'dispose' | 'samples' | 'expensiveBlur'>;
type Temporal = Pick<TAARenderingPipeline, 'dispose' | 'samples'>;
interface EffectFactories {
  environment(scene: Scene): BaseTexture | undefined;
  taa(scene: Scene, camera: Camera): Temporal | undefined;
  occlusion(scene: Scene, camera: Camera): Occlusion | undefined;
  bloom(scene: Scene, camera: Camera): Bloom | undefined;
  orbitBloom(scene: Scene, camera: Camera): Bloom | undefined;
}
const factories: EffectFactories = {
  environment: createInteriorEnvironment,
  taa: createInteriorTaa,
  occlusion: createInteriorOcclusion,
  bloom: createInteriorBloom,
  orbitBloom: createOrbitBloom,
};

/** All view effects belong to one scene; walk pipelines also belong to one camera. */
export class ViewEffects {
  private environment?: BaseTexture;
  private previousEnvironment?: BaseTexture | null;
  private previousEnvironmentIntensity = 1;
  private environmentUnavailable = false;
  private occlusionUnavailable = false;
  private taa?: Temporal;
  private occlusion?: Occlusion;
  private bloom?: Bloom;
  private orbitBloom?: Bloom;
  private camera?: Camera;
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    private readonly create: EffectFactories = factories,
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
    if (!this.environmentUnavailable) {
      this.environment ??= this.create.environment(this.scene);
      this.environmentUnavailable = !this.environment;
    }
    if (this.environment) {
      if (this.previousEnvironment === undefined) {
        this.previousEnvironment = this.scene.environmentTexture;
        this.previousEnvironmentIntensity = this.scene.environmentIntensity;
      }
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
    if (!this.occlusionUnavailable && !this.occlusion && state.effectTier < 3) {
      this.occlusion = this.create.occlusion(this.scene, state.camera);
      this.occlusionUnavailable = !this.occlusion;
    }
    this.applyEffectTier(state.effectTier);
    // Headset bloom would render into a zero-size target.
    if (!state.headset) this.bloom ??= this.create.bloom(this.scene, state.camera);
  }

  updateOrbit(active: boolean, camera: Camera): void {
    if (this.disposed) return;
    if (active) this.orbitBloom ??= this.create.orbitBloom(this.scene, camera);
    if (this.orbitBloom) this.orbitBloom.bloomEnabled = active;
  }

  /** Returns whether a pipeline was removed and a new frame is needed. */
  applyEffectTier(tier: number): boolean {
    if (tier >= 1 && this.occlusion) {
      this.occlusion.samples = 8;
      this.occlusion.expensiveBlur = false;
    }
    if (tier >= 2 && this.taa) this.taa.samples = 8;
    if (tier < 3 || !this.occlusion) return false;
    this.occlusion.dispose(true);
    this.occlusion = undefined;
    return true;
  }

  releaseWalkPipelines(): void {
    this.occlusion?.dispose(true);
    this.occlusion = undefined;
    this.taa?.dispose();
    this.taa = undefined;
    this.bloom?.dispose();
    this.bloom = undefined;
    this.camera = undefined;
    this.scene.disablePrePassRenderer();
  }

  status(walking: boolean): { environment: boolean; occlusion: OcclusionState } {
    return {
      environment: Boolean(this.environment && this.scene.environmentTexture === this.environment),
      occlusion: !walking ? 'idle' : this.occlusion ? 'active' : 'unavailable',
    };
  }

  private restoreEnvironment(): void {
    if (this.environment && this.scene.environmentTexture === this.environment) {
      this.scene.environmentTexture = this.previousEnvironment ?? null;
      this.scene.environmentIntensity = this.previousEnvironmentIntensity;
    }
    this.previousEnvironment = undefined;
    this.previousEnvironmentIntensity = 1;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.restoreEnvironment();
    this.releaseWalkPipelines();
    this.environment?.dispose();
    this.environment = undefined;
    this.orbitBloom?.dispose();
    this.orbitBloom = undefined;
  }
}
