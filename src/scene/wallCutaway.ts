import { Plane } from '@babylonjs/core/Maths/math.plane';
import type { Scene } from '@babylonjs/core/scene';
import type { Material } from '@babylonjs/core/Materials/material';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Level, Point2 } from '../model/types';
import { wallFacesCamera } from './navigation';

export type WallDisplay = 'auto' | 'full' | 'low';

/** Clip selected walls locally; floors, furniture and shared source materials stay intact. */
export function buildWallCutaway(scene: Scene, level: Level) {
  const originals = new Map<AbstractMesh, { material: Material | null; pickable: boolean }>();
  const clones = new Map<Material, Material>();
  const plane = new Plane(0, 1, 0, -(level.elevation + 1.1));
  const groups = level.walls.map((wall) => {
    const meshes = [
      ...(scene.getTransformNodeByName(`wall:${wall.id}`)?.getChildMeshes() ?? []),
      ...scene.meshes.filter(
        (mesh) => mesh.metadata?.exteriorKind === 'facade' && mesh.metadata.wallId === wall.id,
      ),
    ];
    for (const mesh of meshes)
      originals.set(mesh, { material: mesh.material, pickable: mesh.isPickable });
    return { wall, meshes };
  });
  return {
    apply(mode: WallDisplay, camera: Point2, height = 1.1): ReadonlySet<string> {
      const selected = new Set<string>();
      plane.d = -(level.elevation + height);
      for (const { wall, meshes } of groups) {
        const clipped =
          mode === 'low' ||
          (mode === 'auto' && !!wall.exterior && wallFacesCamera(level, wall, camera));
        if (clipped) selected.add(wall.id);
        for (const mesh of meshes) {
          const original = originals.get(mesh)!;
          if (!clipped || !original.material) {
            mesh.material = original.material;
            mesh.isPickable = original.pickable;
            continue;
          }
          let material = clones.get(original.material);
          if (!material) {
            material =
              original.material.clone(`wall-cutaway:${original.material.name}`) ?? undefined;
            if (material) clones.set(original.material, material);
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
      for (const material of clones.values()) material.dispose(false, false);
      clones.clear();
    },
  };
}

export type WallCutaway = ReturnType<typeof buildWallCutaway>;
