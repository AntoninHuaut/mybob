import type { Scene } from '@babylonjs/core/scene';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { DoorInstance } from './buildHouse';

const assignments = new WeakMap<Scene, FixtureLights>();
export function refreshFixtureLights(scene: Scene): void {
  assignments.get(scene)?.refresh();
}

/** Scene-owned range assignments, refreshed on geometry/range changes, never by rendering. */
export class FixtureLights {
  constructor(
    private scene: Scene,
    private lights: PointLight[],
    private doors: DoorInstance[],
  ) {
    assignments.set(scene, this);
    scene.onDisposeObservable.addOnce(() => assignments.delete(scene));
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
  }
}
