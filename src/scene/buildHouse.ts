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
import { alongWall, wallLength, wallSections } from '../model/geometry';
import type { Materials } from './materials';

export interface DoorInstance {
  id: string;
  exterior: boolean;
  pivot: TransformNode;
  leaf: Mesh;
  leaves: Mesh[];
  opening: Opening;
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

export function polygonMesh(name: string, points: Point2[], y: number, scene: Scene): Mesh {
  const positions = points.flatMap(([x, z]) => [x, y, z]);
  const indices = earcut(points.flat());
  // Babylon's left-handed mesh front-face winding is clockwise from above.
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  if (normals[1] < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  const data = new VertexData();
  data.positions = positions; data.indices = indices;
  data.normals = points.flatMap(() => [0, 1, 0]);
  data.uvs = points.flatMap(([x, z]) => [x / 4.8, z / 3.2]);
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  return mesh;
}

export function buildHouse(level: Level, scene: Scene, materials: Materials, shadow?: ShadowGenerator): HouseScene {
  const root = new TransformNode(`level:${level.id}`, scene);
  root.position.y = level.elevation;
  const box = (name: string, width: number, height: number, depth: number, x: number, y: number, z: number, material: Material, parent: TransformNode = root, collision = true) => {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    mesh.position.set(x, y, z); mesh.parent = parent;
    mesh.material = material; mesh.checkCollisions = collision; mesh.receiveShadows = true;
    if (shadow && height > .12) shadow.addShadowCaster(mesh);
    return mesh;
  };

  const floor = polygonMesh('finished-floor', level.outline, 0, scene);
  floor.parent = root; floor.material = materials.wood; floor.receiveShadows = true; floor.checkCollisions = true;
  floor.metadata = { kind: 'floor' };
  const bottom = polygonMesh('slab-bottom', level.outline, -.17, scene);
  bottom.parent = root; bottom.material = materials.slab;
  for (let i = 0; i < level.outline.length; i++) {
    const a = level.outline[i], b = level.outline[(i + 1) % level.outline.length];
    const side = box(`slab-edge-${i}`, Math.hypot(b[0] - a[0], b[1] - a[1]), .17, .018, (a[0] + b[0]) / 2, -.085, (a[1] + b[1]) / 2, materials.slab, root, false);
    side.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  }

  const highlights = new Map<string, Mesh>();
  for (const room of level.rooms) {
    if (room.kind === 'garage') {
      const garage = polygonMesh(`floor:${room.id}`, room.polygon, .006, scene);
      garage.parent = root; garage.material = materials.concrete; garage.receiveShadows = true;
      garage.metadata = { kind: 'floor' };
    }
    const highlight = polygonMesh(`highlight:${room.id}`, room.polygon, .017, scene);
    highlight.parent = root; highlight.material = materials.selection; highlight.isPickable = false; highlight.setEnabled(false);
    highlights.set(room.id, highlight);
  }

  const doors: DoorInstance[] = [];
  for (const wall of level.walls) {
    const group = new TransformNode(`wall:${wall.id}`, scene);
    group.parent = root; group.position.set(wall.start[0], 0, wall.start[1]);
    group.rotation.y = -Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]);
    const h = wall.height ?? level.ceilingHeight;
    for (const [i, section] of wallSections(wall, h).entries()) {
      box(`wall:${wall.id}:${i}`, section.end - section.start, section.top - section.bottom, wall.thickness,
        (section.start + section.end) / 2, (section.bottom + section.top) / 2, 0, materials.plaster, group);
    }
    // Skirting follows all walls and stops at full-height openings.
    const baseGaps = (wall.openings ?? []).filter(o => (o.sill ?? 0) < .02).sort((a, b) => a.offset - b.offset);
    let cursor = 0;
    for (const o of [...baseGaps, { offset: wallLength(wall), width: 0 }]) {
      if (o.offset - cursor > .01) for (const sign of [-1, 1]) {
        const skirting = box(`skirting:${wall.id}:${cursor}:${sign}`, o.offset - cursor, .075, .012, (cursor + o.offset) / 2, .0375, sign * (wall.thickness / 2 + .006), materials.frame, group, false);
        skirting.isPickable = false;
      }
      cursor = o.offset + o.width;
    }
    for (const o of wall.openings ?? []) addOpening(wall, o, group);
  }

  function addOpening(wall: Wall, o: Opening, parent: TransformNode) {
    const sill = o.sill ?? 0;
    const x = o.offset + o.width / 2;
    const frameThickness = o.kind === 'door' ? .025 : .045;
    const depth = Math.min(wall.thickness + .012, .12);
    const openingMeshes: Mesh[] = [];
    for (const side of [-1, 1]) {
      openingMeshes.push(box(`jamb:${o.id}:${side}`, frameThickness, o.height, depth, x + side * (o.width - frameThickness) / 2, sill + o.height / 2, 0, materials.frame, parent));
    }
    openingMeshes.push(box(`lintel:${o.id}`, o.width, frameThickness, depth, x, sill + o.height - frameThickness / 2, 0, materials.frame, parent));
    if (o.kind === 'window' || o.kind === 'sliding') openingMeshes.push(box(`sill:${o.id}`, o.width, frameThickness, depth + .025, x, sill + frameThickness / 2, 0, materials.frame, parent));

    if (o.kind === 'window') {
      const pane = box(`glass:${o.id}`, o.width - .08, o.height - .08, .012, x, sill + o.height / 2, 0, materials.glass, parent, true);
      box(`mullion:${o.id}`, .045, o.height - .06, .07, x, sill + o.height / 2, 0, materials.frame, parent);
      pane.receiveShadows = false;
      return;
    }

    const pivot = new TransformNode(`hinge:${o.id}`, scene);
    pivot.parent = parent;
    const hingeEnd = o.hinge === 'end';
    pivot.position.set(o.offset + (hingeEnd ? o.width - .025 : .025), 0, -.025);
    const direction = hingeEnd ? -1 : 1;
    const width = o.width - .05;
    const leaves: Mesh[] = [];
    let leaf: Mesh;
    if (o.kind === 'sliding') {
      // Two glazed panels. One translates behind the other when opened.
      pivot.position.set(o.offset + .025, 0, 0);
      leaf = box(`sliding-panel:${o.id}`, width / 2, o.height - .07, .018, width / 4, o.height / 2, -.035, o.exterior ? materials.glass : materials.frame, pivot, true);
      const fixed = box(`sliding-fixed:${o.id}`, width / 2, o.height - .07, .018, 3 * width / 4, o.height / 2, .035, o.exterior ? materials.glass : materials.frame, pivot, true);
      const movingFrame = box(`sliding-mullion:${o.id}`, .045, o.height - .04, .06, width / 2, o.height / 2, -.035, materials.frame, pivot, true);
      box(`sliding-fixed-mullion:${o.id}`, .045, o.height - .04, .06, width / 2, o.height / 2, .035, materials.frame, pivot);
      leaves.push(leaf, movingFrame);
      fixed.metadata = { kind: 'door', id: o.id };
    } else if (o.kind === 'garage') {
      pivot.position.set(x, 0, 0);
      leaf = box(`garage-panel:${o.id}`, width, o.height - .04, .06, 0, o.height / 2, 0, materials.frame, pivot);
      leaves.push(leaf);
      for (let i = 1; i < 5; i++) {
        const seam = box(`garage-seam:${o.id}:${i}`, width, .008, .064, 0, i * o.height / 5, 0, materials.slab, pivot, false);
        leaves.push(seam);
      }
    } else {
      leaf = box(`door-leaf:${o.id}`, width, o.height - .035, .04, direction * width / 2, o.height / 2, 0, materials.frame, pivot);
      leaves.push(leaf);
      for (const sign of [-1, 1]) {
        const handle = box(`handle:${o.id}:${sign}`, .11, .018, .025, direction * (width - .10), 1.04, sign * .04, materials.metal, pivot, false);
        leaves.push(handle);
      }
    }
    for (const m of [...openingMeshes, ...leaves]) m.metadata = { kind: 'door', id: o.id };
    const center = alongWall(wall, x);
    const open = !o.exterior;
    const instance: DoorInstance = { id: o.id, exterior: !!o.exterior, pivot, leaf, leaves, opening: o, center: new Vector3(center[0], 1, center[1]), open, progress: open ? 1 : 0, target: open ? 1 : 0 };
    doors.push(instance);
    poseDoor(instance);
  }

  const ceiling = polygonMesh('ceiling', level.outline, level.ceilingHeight, scene);
  ceiling.parent = root; ceiling.material = materials.plaster;
  // Double sided ceiling for an interior view from below.
  materials.plaster.backFaceCulling = false;
  ceiling.setEnabled(false);

  const pointLights: PointLight[] = [];
  const fixtures: Mesh[] = [];
  for (const light of level.lights) {
    const fixture = MeshBuilder.CreateCylinder(`fixture:${light.id}`, { diameter: .26, height: .035, tessellation: 24 }, scene);
    fixture.parent = root; fixture.position.set(light.position[0], level.ceilingHeight - .025, light.position[1]);
    fixture.material = materials.glow; fixture.isPickable = false; fixtures.push(fixture); fixture.setEnabled(false);
    const point = new PointLight(light.id, new Vector3(light.position[0], level.elevation + level.ceilingHeight - .18, light.position[1]), scene);
    point.diffuse = Color3.FromHexString('#fff0da'); point.intensity = .32; point.range = 5.5;
    point.setEnabled(false); pointLights.push(point);
  }
  return { root, ceiling, fixtures, doors, pointLights, highlights };
}

export function poseDoor(door: DoorInstance) {
  const progress = door.progress;
  const kind = door.opening.kind;
  if (kind === 'sliding') {
    const width = door.opening.width - .05;
    door.leaf.position.x = width / 4 + progress * width / 2;
    if (door.leaves[1]) door.leaves[1].position.x = width / 2 + progress * width / 2;
  } else if (kind === 'garage') {
    door.pivot.position.y = progress * (door.opening.height + .05);
  } else {
    door.pivot.rotation.y = progress * Math.PI * .5 * (door.opening.swing ?? 1) * (door.opening.hinge === 'end' ? -1 : 1);
  }
}
