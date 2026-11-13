import type { Scene } from '@babylonjs/core/scene';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { DoorInstance } from './buildHouse';

const assignments = new WeakMap<Scene, FixtureLights>();
export function refreshFixtureLights(scene: Scene): void {
  assignments.get(scene)?.refresh();
}

/** The padding lights follow the fixtures, switched on or off together (`updateLighting`). */
export function syncFixturePads(scene: Scene): void {
  assignments.get(scene)?.syncPads();
}

/** Name prefix of the padding lights. */
export const FIXTURE_PAD_PREFIX = 'fixture-pad-';

/** Lights that are not fixtures (the sky and the sun): each takes a slot of a material. */
const SCENE_LIGHTS = 2;

/**
 * How many padding lights each mesh receives so that every mesh sees the same number of point
 * lights, `target`, within what its material can take. Pure, for the tests.
 */
export function padCounts(
  fixtureCounts: number[],
  materialLimits: number[],
  sceneLights = SCENE_LIGHTS,
): number[] {
  const target = Math.max(0, ...fixtureCounts);
  return fixtureCounts.map((count, index) =>
    Math.max(0, Math.min(target, materialLimits[index] - sceneLights) - count),
  );
}

/**
 * Scene-owned range assignments, refreshed on geometry/range changes, never by rendering.
 *
 * Babylon links one shader program per number of lights a mesh receives: a wall lit by one
 * fixture and a wall lit by two do not share a program, which tripled the house's PBR programs
 * (44 instead of 14 on a converted house), each one a blocking link on ANGLE/D3D11 and on a
 * headset. Every mesh is therefore topped up to the same count with padding point lights of
 * zero intensity: their contribution is exactly zero, so the image does not change, and the
 * light count is the same in every room.
 */
export class FixtureLights {
  private pads: PointLight[] = [];

  constructor(
    private scene: Scene,
    private lights: PointLight[],
    private doors: DoorInstance[],
  ) {
    // A rebuilt level replaces the previous assignment: its padding goes with it.
    assignments.get(scene)?.disposePads();
    assignments.set(scene, this);
    scene.onDisposeObservable.addOnce(() => assignments.delete(scene));
  }

  syncPads(): void {
    const on = this.lights.some((light) => light.isEnabled(false));
    for (const pad of this.pads) pad.setEnabled(on);
  }

  disposePads(): void {
    for (const pad of this.pads) pad.dispose();
    this.pads = [];
  }

  refresh(): void {
    const boxes = new Map<AbstractMesh, { min: Vector3; max: Vector3 }>();
    for (const mesh of this.scene.meshes) {
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      boxes.set(mesh, { min: box.minimumWorld.clone(), max: box.maximumWorld.clone() });
    }
    // Bound all leaf/handle descendants around their jamb in world space. The
    // horizontal disk includes intermediate swing extrema and both jambs; the
    // vertical allowance also covers a sectional garage curtain's track.
    for (const door of this.doors) {
      const pivots = [door.pivot, ...(door.pivotB ? [door.pivotB] : [])];
      for (const pivot of pivots) {
        pivot.computeWorldMatrix(true);
        const centre = pivot.getAbsolutePosition();
        const scale = new Vector3();
        pivot.getWorldMatrix().decompose(scale);
        const factor = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
        const radius = (Math.max(door.opening.width, door.opening.height) + 0.2) * factor;
        const extent = new Vector3(radius, (door.opening.height + 0.2) * factor, radius);
        for (const leaf of pivot.getChildMeshes()) {
          const box = boxes.get(leaf);
          if (!box) continue;
          box.min = Vector3.Minimize(box.min, centre.subtract(extent));
          box.max = Vector3.Maximize(box.max, centre.add(extent));
        }
      }
    }
    for (const light of this.lights) {
      const position = light.getAbsolutePosition();
      const included: AbstractMesh[] = [],
        excluded: AbstractMesh[] = [];
      for (const [mesh, box] of boxes) {
        const closest = Vector3.Clamp(position, box.min, box.max);
        (Vector3.DistanceSquared(position, closest) <= light.range * light.range
          ? included
          : excluded
        ).push(mesh);
      }
      // An empty includedOnlyMeshes means *all* meshes in Babylon; exclusions
      // retain the empty-set meaning even if a scene temporarily has no receivers.
      light.includedOnlyMeshes = included;
      light.excludedMeshes = excluded;
    }
    this.pad([...boxes.keys()]);
  }

  private pad(meshes: AbstractMesh[]): void {
    const fixtures = new Map<AbstractMesh, number>();
    for (const light of this.lights)
      for (const mesh of light.includedOnlyMeshes)
        fixtures.set(mesh, (fixtures.get(mesh) ?? 0) + 1);
    const receivers = meshes.filter((mesh) => mesh.material);
    const counts = padCounts(
      receivers.map((mesh) => fixtures.get(mesh) ?? 0),
      receivers.map(
        (mesh) => (mesh.material as { maxSimultaneousLights?: number }).maxSimultaneousLights ?? 4,
      ),
    );
    const needed = Math.max(0, ...counts);
    while (this.pads.length > needed) this.pads.pop()!.dispose();
    while (this.pads.length < needed) {
      const pad = new PointLight(
        `${FIXTURE_PAD_PREFIX}${this.pads.length}`,
        Vector3.Zero(),
        this.scene,
      );
      pad.intensity = 0;
      pad.diffuse.set(0, 0, 0);
      pad.specular.set(0, 0, 0);
      this.pads.push(pad);
    }
    this.pads.forEach((pad, index) => {
      const included: AbstractMesh[] = [];
      receivers.forEach((mesh, i) => {
        if (counts[i] > index) included.push(mesh);
      });
      const kept = new Set(included);
      pad.includedOnlyMeshes = included;
      pad.excludedMeshes = meshes.filter((mesh) => !kept.has(mesh));
    });
    this.syncPads();
  }
}
