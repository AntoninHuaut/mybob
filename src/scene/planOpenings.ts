import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateLineSystem } from '@babylonjs/core/Meshes/Builders/linesBuilder';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { Level } from '../model/types';
import { alongWall, wallLength, wallSections } from '../model/geometry';

/** The cut face sits just under the clip plane so the two never z-fight. */
export const CAP_TOP_INSET = 0.018;
const CAP_THICKNESS = 0.008;

export interface PlanOpenings {
  readonly meshes: LinesMesh[];
  readonly wallCaps: Mesh[];
  setVisible(
    enabled: boolean,
    cutHeight?: number,
    options?: { markers?: boolean; wallIds?: ReadonlySet<string>; continuous?: boolean },
  ): void;
  dispose(): void;
}

/** Architectural symbols supplement the real joinery, which remains untouched in 3D. */
export function buildPlanOpenings(scene: Scene, level: Level): PlanOpenings {
  const meshes: LinesMesh[] = [];
  const wallCaps: Mesh[] = [];
  const fullCaps: Mesh[] = [];
  const capSections: { mesh: Mesh; bottom: number; top: number }[] = [];
  const capMaterial = new StandardMaterial('plan-wall-cut', scene);
  capMaterial.disableLighting = true;
  capMaterial.emissiveColor = Color3.FromHexString('#adb4aa');
  capMaterial.diffuseColor = capMaterial.emissiveColor;
  capMaterial.specularColor = Color3.Black();
  for (const wall of level.walls) {
    for (const [index, section] of wallSections(
      wall,
      wall.height ?? level.ceilingHeight,
    ).entries()) {
      if (section.end - section.start <= 0.00001 || section.top - section.bottom <= 0.00001)
        continue;
      const mesh = CreateBox(
        `plan-wall-cap:${wall.id}:${index}`,
        {
          width: section.end - section.start,
          height: 0.008,
          depth: wall.thickness,
        },
        scene,
      );
      const [x, z] = alongWall(wall, (section.start + section.end) / 2);
      mesh.position.set(x, level.elevation, z);
      mesh.rotation.y = -Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]);
      mesh.material = capMaterial;
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.metadata = { kind: 'plan-wall-cap', wallId: wall.id };
      mesh.setEnabled(false);
      // Existing wall geometry supplies adjusted sill/lintel datums for lowered floors.
      const source = scene.getMeshByName(`wall:${wall.id}:${index}`);
      source?.computeWorldMatrix(true);
      const box = source?.getBoundingInfo().boundingBox;
      capSections.push({
        mesh,
        bottom: box ? box.minimumWorld.y - level.elevation : section.bottom,
        top: box ? box.maximumWorld.y - level.elevation : section.top,
      });
      wallCaps.push(mesh);
    }
    // One continuous face per wall: the automatic cutaway fills openings instead of
    // leaving a notch where a bay or a door crosses the plane.
    const full = CreateBox(
      `plan-wall-cap-full:${wall.id}`,
      { width: wallLength(wall), height: CAP_THICKNESS, depth: wall.thickness },
      scene,
    );
    const [fullX, fullZ] = alongWall(wall, wallLength(wall) / 2);
    full.position.set(fullX, level.elevation, fullZ);
    full.rotation.y = -Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]);
    full.material = capMaterial;
    full.isPickable = false;
    full.checkCollisions = false;
    full.metadata = { kind: 'plan-wall-cap', wallId: wall.id };
    full.setEnabled(false);
    fullCaps.push(full);
    wallCaps.push(full);
    for (const opening of wall.openings ?? []) {
      if (opening.kind !== 'window' && opening.kind !== 'sliding') continue;
      const start = opening.offset,
        end = start + opening.width,
        middle = (start + end) / 2;
      const halfGap = Math.max(0.025, Math.min(0.05, wall.thickness * 0.22));
      const point = (offset: number, normal: number) => {
        const [x, z] = alongWall(wall, offset, normal);
        return new Vector3(x, 0, z);
      };
      const lines: Vector3[][] = [
        [point(start, -halfGap), point(end, -halfGap)],
        [point(start, halfGap), point(end, halfGap)],
        [point(start, -halfGap), point(start, halfGap)],
        [point(end, -halfGap), point(end, halfGap)],
      ];
      if (opening.kind === 'sliding') {
        // The staggered leaf rails distinguish a sliding bay from an ordinary window.
        lines.push(
          [point(start, -halfGap / 3), point(middle, -halfGap / 3)],
          [point(middle, halfGap / 3), point(end, halfGap / 3)],
          [point(middle, -halfGap), point(middle, halfGap)],
        );
      } else lines.push([point(middle, -halfGap), point(middle, halfGap)]);
      const mesh = CreateLineSystem(`plan-opening:${opening.id}`, { lines }, scene);
      mesh.color = Color3.FromHexString('#0e7490');
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.metadata = {
        kind: 'plan-opening',
        id: opening.id,
        openingKind: opening.kind,
        wallId: wall.id,
      };
      mesh.setEnabled(false);
      meshes.push(mesh);
    }
  }
  return {
    meshes,
    wallCaps,
    setVisible(enabled, cutHeight = 1.2, options = {}) {
      const height = Number.isFinite(cutHeight)
        ? Math.max(0.1, Math.min(level.ceilingHeight, cutHeight))
        : 1.2;
      for (const mesh of meshes) {
        mesh.position.y = level.elevation + height - 0.012;
        mesh.setEnabled(enabled && options.markers !== false);
      }
      const continuous = options.continuous === true;
      for (const { mesh, bottom, top } of capSections) {
        mesh.position.y = level.elevation + height - CAP_TOP_INSET - CAP_THICKNESS / 2;
        mesh.setEnabled(
          enabled &&
            !continuous &&
            bottom <= height &&
            height < top &&
            (!options.wallIds || options.wallIds.has(mesh.metadata.wallId)),
        );
      }
      for (const mesh of fullCaps) {
        mesh.position.y = level.elevation + height - CAP_TOP_INSET - CAP_THICKNESS / 2;
        mesh.setEnabled(
          enabled && continuous && (!options.wallIds || options.wallIds.has(mesh.metadata.wallId)),
        );
      }
    },
    dispose() {
      for (const mesh of meshes) mesh.dispose(false, true);
      for (const mesh of wallCaps) mesh.dispose();
      capMaterial.dispose();
    },
  };
}
