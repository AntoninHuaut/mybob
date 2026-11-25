import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { PointLight } from '@babylonjs/core/Lights/pointLight';
import type { Scene } from '@babylonjs/core/scene';
import type { Level } from '../model/types';
import { bounds } from '../model/geometry';
import { FIXTURE_LIGHT_INTENSITY, FIXTURE_LIGHT_RANGE } from './buildHouse';
import { refreshFixtureLights, syncFixturePads } from './fixtureLights';
import {
  INTERIOR_FIXTURE_INTENSITY,
  INTERIOR_FIXTURE_RANGE,
  INTERIOR_GROUND_COLOR,
} from './interiorAmbience';
import type { SolarPosition } from './solar';
import { SHADOW_TIER } from './adaptiveResolution';

export type LightingMode = 'overview' | 'plan' | 'walk';

/**
 * The scene's sky fill and sun for one loaded scene: neutral in the plan, darker bounce in
 * the visit, driven by the solar preview when one is set. The colours the lights had when
 * this was made are the preset every mode and a cleared solar preview restore.
 */
export class SceneLighting {
  private readonly baseGround: Color3;
  private readonly baseSun: { direction: Vector3; position: Vector3; diffuse: Color3 };
  private diffuseBeforePlan?: Color3;
  private shadowsBeforeSuppression?: boolean;

  constructor(
    private readonly scene: Scene,
    readonly hemispheric: HemisphericLight,
    readonly sun: DirectionalLight,
  ) {
    this.baseGround = hemispheric.groundColor.clone();
    this.baseSun = {
      direction: sun.direction.clone(),
      position: sun.position.clone(),
      diffuse: sun.diffuse.clone(),
    };
  }

  apply(mode: LightingMode, level: Level, solar?: SolarPosition) {
    const { hemispheric, sun } = this;
    if (mode === 'plan') {
      this.diffuseBeforePlan ??= hemispheric.diffuse.clone();
      hemispheric.diffuse = Color3.White();
      hemispheric.groundColor = Color3.White();
      hemispheric.intensity = 0.9;
      sun.intensity = 0;
      return;
    }
    if (this.diffuseBeforePlan) {
      hemispheric.diffuse = this.diffuseBeforePlan;
      this.diffuseBeforePlan = undefined;
    }
    // Always the preset bounce, never the live one, which the visit darkens.
    const interior = mode === 'walk';
    hemispheric.groundColor = (interior ? INTERIOR_GROUND_COLOR : this.baseGround).clone();
    hemispheric.intensity = interior ? 0.42 : 0.45;
    sun.intensity = 0.95;
    if (solar) {
      const daylight = solar.daylight && solar.altitudeDeg > 0;
      const { x, y, z } = solar.lightDirection;
      const direction = new Vector3(x, y, z).normalize();
      const centre = bounds(level.outline).center;
      sun.direction = direction;
      sun.position = new Vector3(
        centre[0],
        level.elevation + level.ceilingHeight / 2,
        centre[1],
      ).subtract(direction.scale(30));
      sun.intensity = daylight
        ? 0.8 * Math.sqrt(Math.max(0, Math.sin((solar.altitudeDeg * Math.PI) / 180)))
        : 0;
      sun.diffuse = Color3.Lerp(
        Color3.FromHexString('#ffbd7a'),
        Color3.FromHexString('#fff5e6'),
        Math.max(0, Math.min(1, solar.altitudeDeg / 35)),
      );
      hemispheric.intensity = daylight ? 0.35 : 0.1;
    } else {
      sun.direction = this.baseSun.direction.clone();
      sun.position = this.baseSun.position.clone();
      sun.diffuse = this.baseSun.diffuse.clone();
    }
  }

  /** Turns sun shadows off for readability, then gives back exactly the setting it found. */
  suppressShadows(suppressed: boolean) {
    if (suppressed) {
      this.shadowsBeforeSuppression ??= this.scene.shadowsEnabled;
      this.scene.shadowsEnabled = false;
    } else if (this.shadowsBeforeSuppression !== undefined) {
      this.scene.shadowsEnabled = this.shadowsBeforeSuppression;
      this.shadowsBeforeSuppression = undefined;
    }
  }
}

const SHADOW_FILTERING = ShadowGenerator.QUALITY_MEDIUM;

/**
 * « Basse » or a slow machine at the shadow tier: fewer PCF taps on the sun shadow. Returns
 * whether the filtering changed; the receivers relink once, so it is only set on a change.
 */
export function applyShadowTier(shadow: ShadowGenerator, tier: number): boolean {
  const quality = tier >= SHADOW_TIER ? ShadowGenerator.QUALITY_LOW : SHADOW_FILTERING;
  if (shadow.filteringQuality === quality) return false;
  shadow.filteringQuality = quality;
  return true;
}

/** Builds the sky fill, the sun placed off the level's corner, and the sun's shadow map. */
export function createSceneLighting(scene: Scene, level: Level) {
  const extent = bounds(level.outline);
  const hemispheric = new HemisphericLight('sky', new Vector3(0.3, 1, -0.1), scene);
  hemispheric.intensity = 0.9;
  hemispheric.groundColor = Color3.FromHexString('#b6b4a2');
  const sun = new DirectionalLight('sunlight', new Vector3(0.5, -1, -0.45), scene);
  sun.position = new Vector3(extent.center[0] - 9, level.elevation + 16, extent.center[1] + 12);
  sun.intensity = 1.3;
  sun.diffuse = Color3.FromHexString('#fff5df');
  sun.shadowMinZ = 0.1;
  sun.shadowMaxZ = 100;
  // 2048: the 1024 px trial (2026-11-13) left blotchy, banded shadows on the visit's
  // floors and walls, even on a fast desktop GPU.
  const shadow = new ShadowGenerator(2048, sun);
  shadow.usePercentageCloserFiltering = true;
  shadow.filteringQuality = SHADOW_FILTERING;
  shadow.bias = 0.001;
  shadow.normalBias = 0.025;
  shadow.setDarkness(0.2);
  return { lighting: new SceneLighting(scene, hemispheric, sun), shadow };
}

/** Ceiling fixtures: off in the plan or when switched off, brighter and wider in the visit. */
export function applyFixtureLights(
  scene: Scene,
  lights: PointLight[],
  mode: LightingMode,
  enabled: boolean,
) {
  const interior = mode === 'walk';
  let rangesChanged = false;
  for (const light of lights) {
    light.setEnabled(enabled && mode !== 'plan');
    // Written on every call: a per-fixture intensity from project data would be lost here.
    light.intensity = interior ? INTERIOR_FIXTURE_INTENSITY : FIXTURE_LIGHT_INTENSITY;
    const range = interior ? INTERIOR_FIXTURE_RANGE : FIXTURE_LIGHT_RANGE;
    rangesChanged ||= light.range !== range;
    light.range = range;
  }
  if (rangesChanged) refreshFixtureLights(scene);
  syncFixturePads(scene);
}
