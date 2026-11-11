import type { Scene } from '@babylonjs/core/scene';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { createInteriorEnvironment } from './interiorAmbience';

/** Incoming sky direction; the directional light points in the opposite direction. */
export function exteriorRadiance(
  x: number,
  y: number,
  z: number,
  sun: { x: number; y: number; z: number },
): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1;
  const ny = y / length;
  const zenith = Math.max(0, ny);
  const ground = Math.max(0, -ny);
  const dot = Math.max(0, (x * sun.x + y * sun.y + z * sun.z) / length);
  const lobe = sun.y > 0 ? 6 * Math.pow(dot, 256) : 0;
  const daylight = sun.y > 0 ? 1 : 0.08;
  return [
    daylight * (0.55 - 0.34 * zenith - 0.35 * ground) + lobe,
    daylight * (0.61 - 0.32 * zenith - 0.34 * ground) + lobe * 0.95,
    daylight * (0.67 - 0.28 * zenith - 0.5 * ground) + lobe * 0.85,
  ];
}
export function createExteriorEnvironment(scene: Scene, lightDirection: Vector3) {
  const sun = lightDirection.normalizeToNew().negate();
  const texture = createInteriorEnvironment(scene, (x, y, z) => exteriorRadiance(x, y, z, sun));
  if (texture) texture.name = 'exterior-sky';
  return texture;
}
