import { Plane } from '@babylonjs/core/Maths/math.plane';
import type { Scene } from '@babylonjs/core/scene';
import type { Material } from '@babylonjs/core/Materials/material';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Level, Point2 } from '../model/types';
import { wallFacesCamera } from './navigation';
import { CAP_TOP_INSET } from './planOpenings';

export type WallDisplay = 'auto' | 'full' | 'low';

/**
 * Cut under the lowest sill in the projects (0,90 m) so windows disappear whole
 * instead of being sliced. Bays and doors start at the floor and are cut anyway;
 * the continuous cut face fills them.
 */
export const AUTO_CUT_HEIGHT = 0.85;

/** Clip selected walls locally; floors, furniture and shared source materials stay intact. */
export function buildWallCutaway(scene: Scene, level: Level) {
  const originals = new Map<AbstractMesh, { material: Material | null; pickable: boolean }>();
  const shellClones = new Map<Material, Material>();
  const trimClones = new Map<Material, Material>();
  const shellPlane = new Plane(0, 1, 0, -(level.elevation + AUTO_CUT_HEIGHT));
  const trimPlane = new Plane(0, 1, 0, -(level.elevation + AUTO_CUT_HEIGHT - CAP_TOP_INSET));
  const groups = level.walls.map((wall) => {
    // Wall sections and exterior renders carry the cut face; joinery stops under it.
    const meshes = [
      ...(scene.getTransformNodeByName(`wall:${wall.id}`)?.getChildMeshes() ?? []).map((mesh) => ({
        mesh,
        shell: mesh.name.startsWith(`wall:${wall.id}:`),
      })),
      ...scene.meshes
        .filter(
          (mesh) => mesh.metadata?.exteriorKind === 'facade' && mesh.metadata.wallId === wall.id,
        )
        .map((mesh) => ({ mesh, shell: true })),
    ];
    for (const { mesh } of meshes)
      originals.set(mesh, { material: mesh.material, pickable: mesh.isPickable });
    return { wall, meshes };
  });
  return {
    apply(mode: WallDisplay, camera: Point2, height = AUTO_CUT_HEIGHT): ReadonlySet<string> {
      const selected = new Set<string>();
      shellPlane.d = -(level.elevation + height);
      trimPlane.d = -(level.elevation + height - CAP_TOP_INSET);
      for (const { wall, meshes } of groups) {
        const clipped =
          mode === 'low' ||
          (mode === 'auto' && !!wall.exterior && wallFacesCamera(level, wall, camera));
        if (clipped) selected.add(wall.id);
        for (const { mesh, shell } of meshes) {
          const original = originals.get(mesh)!;
          if (!clipped || !original.material) {
            mesh.material = original.material;
            mesh.isPickable = original.pickable;
            continue;
          }
          const plane = shell ? shellPlane : trimPlane;
          const cache = shell ? shellClones : trimClones;
          let material = cache.get(original.material);
          if (!material) {
            material =
              original.material.clone(`wall-cutaway:${original.material.name}`) ?? undefined;
            if (material) cache.set(original.material, material);
          }
          if (material) {
            material.clipPlane = plane;
            mesh.material = material;
            mesh.isPickable = false;
          }
        }
      }
      return selected;
    },
    dispose() {
      for (const [mesh, original] of originals) {
        if (mesh.isDisposed()) continue;
        mesh.material = original.material;
        mesh.isPickable = original.pickable;
      }
      for (const material of [...shellClones.values(), ...trimClones.values()])
        material.dispose(false, false);
      shellClones.clear();
      trimClones.clear();
    },
  };
}

export type WallCutaway = ReturnType<typeof buildWallCutaway>;
