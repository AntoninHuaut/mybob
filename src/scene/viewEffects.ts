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
  private exteriorEnvironment?: BaseTexture;
  private exteriorKey = '';
  private exteriorTimer?: ReturnType<typeof setTimeout>;
  private exteriorActive = false;
  private exteriorUnavailable = false;
  private environmentUnavailable = false;
  private occlusionUnavailable = false;
  private taa?: Temporal;
  private occlusion?: Occlusion;
  private bloom?: Bloom;
  private orbitBloom?: Bloom;
  private orbitAttached = false;
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
    if (!this.occlusionUnavailable && !this.occlusion && state.effectTier < 3) {
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

  updateOrbit(active: boolean, camera: Camera): void {
    if (this.disposed) return;
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
      environment: Boolean(
        this.scene.environmentTexture &&
        (this.scene.environmentTexture === this.environment ||
          this.scene.environmentTexture === this.exteriorEnvironment),
      ),
      occlusion: !walking ? 'idle' : this.occlusion ? 'active' : 'unavailable',
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
  }
}
