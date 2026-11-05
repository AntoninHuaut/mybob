import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import earcut from 'earcut';
import type { Level, Opening, Point2, Wall } from '../model/types';
import { alongWall, pointInPolygon, wallLength, wallSections } from '../model/geometry';
import type { Materials } from './materials';

export interface DoorInstance {
  id: string;
  exterior: boolean;
  pivot: TransformNode;
  leaf: Mesh;
  leaves: Mesh[];
  opening: Opening;
  baseElevation: number;
  center: Vector3;
  open: boolean;
  progress: number;
  target: number;
}
export interface HouseScene {
  root: TransformNode;
  ceiling: Mesh;
  fixtures: Mesh[];
  doors: DoorInstance[];
  pointLights: PointLight[];
  highlights: Map<string, Mesh>;
}

export function polygonMesh(
  name: string,
  points: Point2[],
  y: number,
  scene: Scene,
  holes: Point2[][] = [],
): Mesh {
  const allPoints = [...points];
  const holeIndices: number[] = [];
  for (const hole of holes) {
    holeIndices.push(allPoints.length);
    allPoints.push(...hole);
  }
  const positions = allPoints.flatMap(([x, z]) => [x, y, z]);
  const indices = earcut(allPoints.flat(), holeIndices);
  // Match Babylon's native ground winding; Mesh.sideOrientation handles handedness.
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  if (normals[1] < 0)
    for (let i = 0; i < indices.length; i += 3)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = allPoints.flatMap(() => [0, 1, 0]);
  data.uvs = allPoints.flatMap(([x, z]) => [x / 4.8, z / 3.2]);
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  return mesh;
}

function pointSegmentDistance(point: Point2, a: Point2, b: Point2) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)),
  );
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz);
}

/** Floors adjacent to either face determine a wall's bottom and opening datum. */
function wallFloorSpan(wall: Wall, level: Level) {
  const touching = level.rooms
    .filter((room) =>
      room.polygon.some((a, i) => {
        const b = room.polygon[(i + 1) % room.polygon.length];
        return (
          Math.min(
            pointSegmentDistance(a, wall.start, wall.end),
            pointSegmentDistance(b, wall.start, wall.end),
            pointSegmentDistance(wall.start, a, b),
            pointSegmentDistance(wall.end, a, b),
          ) <=
          wall.thickness / 2 + 0.015
        );
      }),
    )
    .map((room) => room.floorOffset ?? 0);
  return touching.length
    ? { bottom: Math.min(...touching), openingBase: Math.max(...touching) }
    : { bottom: 0, openingBase: 0 };
}

export function buildHouse(
  level: Level,
  scene: Scene,
  materials: Materials,
  shadow?: ShadowGenerator,
): HouseScene {
  const root = new TransformNode(`level:${level.id}`, scene);
  root.position.y = level.elevation;
  const box = (
    name: string,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    material: Material,
    parent: TransformNode = root,
    collision = true,
  ) => {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    mesh.position.set(x, y, z);
    mesh.parent = parent;
    mesh.material = material;
    mesh.checkCollisions = collision;
    mesh.receiveShadows = true;
    if (shadow && height > 0.12) shadow.addShadowCaster(mesh);
    return mesh;
  };

  const separateFloorRooms = level.rooms.filter(
    (room) => room.kind === 'garage' || (room.floorOffset ?? 0) !== 0,
  );
  const floor = polygonMesh(
    'finished-floor',
    level.outline,
    0,
    scene,
    separateFloorRooms.map((room) => room.polygon),
  );
  floor.parent = root;
  floor.material = materials.wood;
  floor.receiveShadows = true;
  floor.checkCollisions = true;
  floor.metadata = { kind: 'floor' };
  const slabBottom = Math.min(0, ...level.rooms.map((room) => room.floorOffset ?? 0)) - 0.17;
  const bottom = polygonMesh('slab-bottom', level.outline, slabBottom, scene);
  bottom.parent = root;
  bottom.material = materials.slab;
  for (let i = 0; i < level.outline.length; i++) {
    const a = level.outline[i],
      b = level.outline[(i + 1) % level.outline.length];
    const side = box(
      `slab-edge-${i}`,
      Math.hypot(b[0] - a[0], b[1] - a[1]),
      -slabBottom,
      0.018,
      (a[0] + b[0]) / 2,
      slabBottom / 2,
      (a[1] + b[1]) / 2,
      materials.slab,
      root,
      false,
    );
    side.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  }

  const highlights = new Map<string, Mesh>();
  for (const room of level.rooms) {
    const floorOffset = room.floorOffset ?? 0;
    if (room.kind === 'garage' || floorOffset !== 0) {
      const surface = polygonMesh(`floor:${room.id}`, room.polygon, floorOffset, scene);
      surface.parent = root;
      surface.material = room.kind === 'garage' ? materials.concrete : materials.wood;
      surface.receiveShadows = true;
      surface.checkCollisions = true;
      surface.metadata = { kind: 'floor' };
    }
    if (floorOffset !== 0) {
      for (let i = 0; i < room.polygon.length; i++) {
        const a = room.polygon[i],
          b = room.polygon[(i + 1) % room.polygon.length];
        const riser = box(
          `floor-riser:${room.id}:${i}`,
          Math.hypot(b[0] - a[0], b[1] - a[1]),
          Math.abs(floorOffset),
          0.012,
          (a[0] + b[0]) / 2,
          floorOffset / 2,
          (a[1] + b[1]) / 2,
          materials.slab,
        );
        riser.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
      }
    }
    const highlight = polygonMesh(`highlight:${room.id}`, room.polygon, floorOffset + 0.017, scene);
    highlight.parent = root;
    highlight.material = materials.selection;
    highlight.isPickable = false;
    highlight.setEnabled(false);
    highlights.set(room.id, highlight);
  }

  const doors: DoorInstance[] = [];
  for (const wall of level.walls) {
    const group = new TransformNode(`wall:${wall.id}`, scene);
    group.parent = root;
    group.position.set(wall.start[0], 0, wall.start[1]);
    group.rotation.y = -Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]);
    const h = wall.height ?? level.ceilingHeight;
    const { bottom: wallBottom, openingBase } = wallFloorSpan(wall, level);
    const effectiveWall = {
      ...wall,
      openings: wall.openings?.map((o) => ({ ...o, sill: (o.sill ?? 0) + openingBase })),
    };
    for (const [i, section] of wallSections(effectiveWall, h).entries()) {
      const bottom = section.bottom === 0 ? wallBottom : section.bottom;
      if (section.top - bottom <= 0.00001) continue;
      box(
        `wall:${wall.id}:${i}`,
        section.end - section.start,
        section.top - bottom,
        wall.thickness,
        (section.start + section.end) / 2,
        (bottom + section.top) / 2,
        0,
        materials.plaster,
        group,
      );
    }
    if (openingBase > wallBottom)
      for (const opening of wall.openings ?? []) {
        if ((opening.sill ?? 0) === 0)
          box(
            `threshold:${opening.id}`,
            opening.width,
            openingBase - wallBottom,
            wall.thickness,
            opening.offset + opening.width / 2,
            (openingBase + wallBottom) / 2,
            0,
            materials.slab,
            group,
          );
      }
    // Skirting follows all walls and stops at full-height openings.
    const baseGaps = (wall.openings ?? [])
      .filter((o) => (o.sill ?? 0) < 0.02)
      .sort((a, b) => a.offset - b.offset);
    let cursor = 0;
    for (const o of [...baseGaps, { offset: wallLength(wall), width: 0 }]) {
      if (o.offset - cursor > 0.01)
        for (const sign of [-1, 1]) {
          const sample = alongWall(
            wall,
            (cursor + o.offset) / 2,
            sign * (wall.thickness / 2 + 0.01),
          );
          const sideFloor =
            level.rooms.find((room) => pointInPolygon(sample, room.polygon))?.floorOffset ?? 0;
          const skirting = box(
            `skirting:${wall.id}:${cursor}:${sign}`,
            o.offset - cursor,
            0.075,
            0.012,
            (cursor + o.offset) / 2,
            sideFloor + 0.0375,
            sign * (wall.thickness / 2 + 0.006),
            materials.frame,
            group,
            false,
          );
          skirting.isPickable = false;
        }
      cursor = o.offset + o.width;
    }
    for (const o of wall.openings ?? []) addOpening(wall, o, group, openingBase);
  }

  function addOpening(wall: Wall, o: Opening, parent: TransformNode, openingBase: number) {
    const sill = (o.sill ?? 0) + openingBase;
    const x = o.offset + o.width / 2;
    const frameThickness = o.kind === 'door' ? 0.025 : 0.045;
    const depth = Math.min(wall.thickness + 0.012, 0.12);
    const openingMeshes: Mesh[] = [];
    for (const side of [-1, 1]) {
      openingMeshes.push(
        box(
          `jamb:${o.id}:${side}`,
          frameThickness,
          o.height,
          depth,
          x + (side * (o.width - frameThickness)) / 2,
          sill + o.height / 2,
          0,
          materials.frame,
          parent,
        ),
      );
    }
    openingMeshes.push(
      box(
        `lintel:${o.id}`,
        o.width,
        frameThickness,
        depth,
        x,
        sill + o.height - frameThickness / 2,
        0,
        materials.frame,
        parent,
      ),
    );
    if (o.kind === 'window' || o.kind === 'sliding')
      openingMeshes.push(
        box(
          `sill:${o.id}`,
          o.width,
          frameThickness,
          depth + 0.025,
          x,
          sill + frameThickness / 2,
          0,
          materials.frame,
          parent,
        ),
      );

    if (o.kind === 'window') {
      const pane = box(
        `glass:${o.id}`,
        o.width - 0.08,
        o.height - 0.08,
        0.012,
        x,
        sill + o.height / 2,
        0,
        materials.glass,
        parent,
        true,
      );
      box(
        `mullion:${o.id}`,
        0.045,
        o.height - 0.06,
        0.07,
        x,
        sill + o.height / 2,
        0,
        materials.frame,
        parent,
      );
      if ((o.sill ?? 0) === 0 && o.height > 1.8)
        for (const side of [-1, 1]) {
          box(
            `french-door-handle:${o.id}:${side}`,
            0.02,
            0.12,
            0.035,
            x + side * 0.065,
            openingBase + 1.05,
            -0.065,
            materials.metal,
            parent,
            false,
          );
        }
      pane.receiveShadows = false;
      return;
    }

    const pivot = new TransformNode(`hinge:${o.id}`, scene);
    pivot.parent = parent;
    const hingeEnd = o.hinge === 'end';
    pivot.position.set(o.offset + (hingeEnd ? o.width - 0.025 : 0.025), openingBase, -0.025);
    const direction = hingeEnd ? -1 : 1;
    const width = o.width - 0.05;
    const leaves: Mesh[] = [];
    let leaf: Mesh;
    if (o.kind === 'sliding') {
      // Two glazed panels. One translates behind the other when opened.
      pivot.position.set(o.offset + 0.025, openingBase, 0);
      leaf = box(
        `sliding-panel:${o.id}`,
        width / 2,
        o.height - 0.07,
        0.018,
        width / 4,
        o.height / 2,
        -0.035,
        o.exterior ? materials.glass : materials.frame,
        pivot,
        true,
      );
      const fixed = box(
        `sliding-fixed:${o.id}`,
        width / 2,
        o.height - 0.07,
        0.018,
        (3 * width) / 4,
        o.height / 2,
        0.035,
        o.exterior ? materials.glass : materials.frame,
        pivot,
        true,
      );
      const movingFrame = box(
        `sliding-mullion:${o.id}`,
        0.045,
        o.height - 0.04,
        0.06,
        width / 2,
        o.height / 2,
        -0.035,
        materials.frame,
        pivot,
        true,
      );
      box(
        `sliding-fixed-mullion:${o.id}`,
        0.045,
        o.height - 0.04,
        0.06,
        width / 2,
        o.height / 2,
        0.035,
        materials.frame,
        pivot,
      );
      leaves.push(leaf, movingFrame);
      fixed.metadata = { kind: 'door', id: o.id };
    } else if (o.kind === 'garage') {
      pivot.position.set(x, openingBase, 0);
      leaf = box(
        `garage-panel:${o.id}`,
        width,
        o.height - 0.04,
        0.06,
        0,
        o.height / 2,
        0,
        materials.frame,
        pivot,
      );
      leaves.push(leaf);
      for (let i = 1; i < 5; i++) {
        const seam = box(
          `garage-seam:${o.id}:${i}`,
          width,
          0.008,
          0.064,
          0,
          (i * o.height) / 5,
          0,
          materials.slab,
          pivot,
          false,
        );
        leaves.push(seam);
      }
    } else {
      leaf = box(
        `door-leaf:${o.id}`,
        width,
        o.height - 0.035,
        0.04,
        (direction * width) / 2,
        o.height / 2,
        0,
        materials.frame,
        pivot,
      );
      leaves.push(leaf);
      for (const sign of [-1, 1]) {
        const handle = box(
          `handle:${o.id}:${sign}`,
          0.11,
          0.018,
          0.025,
          direction * (width - 0.1),
          1.04,
          sign * 0.04,
          materials.metal,
          pivot,
          false,
        );
        leaves.push(handle);
      }
    }
    for (const m of [...openingMeshes, ...leaves]) m.metadata = { kind: 'door', id: o.id };
    const center = alongWall(wall, x);
    const open = !o.exterior;
    const instance: DoorInstance = {
      id: o.id,
      exterior: !!o.exterior,
      pivot,
      leaf,
      leaves,
      opening: o,
      baseElevation: openingBase,
      center: new Vector3(center[0], openingBase + 1, center[1]),
      open,
      progress: open ? 1 : 0,
      target: open ? 1 : 0,
    };
    doors.push(instance);
    poseDoor(instance);
  }

  const ceiling = polygonMesh('ceiling', level.outline, level.ceilingHeight, scene);
  ceiling.parent = root;
  ceiling.material = materials.plaster;
  // Double sided ceiling for an interior view from below.
  materials.plaster.backFaceCulling = false;
  ceiling.setEnabled(false);

  const pointLights: PointLight[] = [];
  const fixtures: Mesh[] = [];
  for (const light of level.lights) {
    const fixture = MeshBuilder.CreateCylinder(
      `fixture:${light.id}`,
      { diameter: 0.26, height: 0.035, tessellation: 24 },
      scene,
    );
    fixture.parent = root;
    fixture.position.set(light.position[0], level.ceilingHeight - 0.025, light.position[1]);
    fixture.material = materials.glow;
    fixture.isPickable = false;
    fixtures.push(fixture);
    fixture.setEnabled(false);
    const point = new PointLight(
      light.id,
      new Vector3(
        light.position[0],
        level.elevation + level.ceilingHeight - 0.18,
        light.position[1],
      ),
      scene,
    );
    point.diffuse = Color3.FromHexString('#fff0da');
    point.intensity = 0.32;
    point.range = 5.5;
    point.setEnabled(false);
    pointLights.push(point);
  }
  return { root, ceiling, fixtures, doors, pointLights, highlights };
}

export function poseDoor(door: DoorInstance) {
  const progress = door.progress;
  const kind = door.opening.kind;
  if (kind === 'sliding') {
    const width = door.opening.width - 0.05;
    door.leaf.position.x = width / 4 + (progress * width) / 2;
    if (door.leaves[1]) door.leaves[1].position.x = width / 2 + (progress * width) / 2;
  } else if (kind === 'garage') {
    door.pivot.position.y = door.baseElevation + progress * (door.opening.height + 0.05);
  } else {
    door.pivot.rotation.y =
      progress *
      Math.PI *
      0.5 *
      (door.opening.swing ?? 1) *
      (door.opening.hinge === 'end' ? -1 : 1);
  }
}
