import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import earcut from 'earcut';
import type { HouseProject, Level, Point2, SiteRoof, Wall } from '../model/types';
import {
  alongWall,
  bounds,
  pointInOrOnPolygon,
  pointInPolygon,
  resolveRoofDormer,
  roofFaceHeightAt,
  roofFacePlanOutline,
  wallLength,
  wallSections,
} from '../model/geometry';
import { polygonMesh, wallFloorSpan } from './buildHouse';

export interface ExteriorScene {
  root: TransformNode;
  meshes: Mesh[];
  roofMeshes: Mesh[];
  /** Match metadata.wallId to the interior wall's cutaway visibility. */
  facadeMeshes: Mesh[];
  bounds: ReturnType<typeof bounds>;
  /** Maximum height above the level datum, including the roof. */
  height: number;
  dispose(): void;
}

/**
 * Triangulate planar faces in their dominant plane, including vertical gables.
 * Dormer piercings arrive as hole rings lying on the face plane.
 */
function faceMesh(
  name: string,
  vertices: [number, number, number][],
  face: number[],
  scene: Scene,
  holes: [number, number, number][][] = [],
) {
  const points = face.map((index) => vertices[index]);
  const normal = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
    normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
    normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const dominant = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
  const rings = [points, ...holes];
  const flat: number[] = [];
  const holeIndices: number[] = [];
  for (const [index, ring] of rings.entries()) {
    if (index > 0) holeIndices.push(flat.length / 2);
    for (const point of ring) {
      const projected = point.filter((_, i) => i !== dominant);
      flat.push(projected[0], projected[1]);
    }
  }
  const data = new VertexData();
  data.positions = rings.flat().flat();
  data.indices = earcut(flat, holeIndices);
  data.normals = [];
  VertexData.ComputeNormals(data.positions, data.indices, data.normals);
  data.uvs = rings.flat().flatMap(([x, y, z]) => [Math.hypot(x, z), y]);
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  return mesh;
}

/**
 * Height of the roof over a wall strip: the lowest point of the pans that cover
 * it. A band cut at the drip edge leaves a slit into the attic wherever the roof
 * overhangs, because the eave sits lower than the roof at the wall plane.
 */
function roofOverStrip(roofs: SiteRoof[], wall: Wall, length: number): number {
  let lowest = Number.POSITIVE_INFINITY;
  const steps = Math.max(2, Math.ceil(length / 0.1));
  for (let i = 0; i <= steps; i++) {
    for (const side of [-1, 0, 1]) {
      const [x, z] = alongWall(wall, (i / steps) * length, (side * wall.thickness) / 2);
      for (const roof of roofs)
        for (const face of roof.faces) {
          if (!pointInOrOnPolygon([x, z], roofFacePlanOutline(roof.vertices, face))) continue;
          const y = roofFaceHeightAt(roof.vertices, face, x, z);
          if (Number.isFinite(y) && y < lowest) lowest = y;
        }
    }
  }
  return lowest;
}

/** All geometry comes from the imported project: no personal land data in the bundle. */
export function buildExterior(project: HouseProject, level: Level, scene: Scene): ExteriorScene {
  const root = new TransformNode('exterior', scene);
  root.position.y = level.elevation;
  const meshes: Mesh[] = [],
    roofMeshes: Mesh[] = [],
    facadeMeshes: Mesh[] = [];
  const materials: PBRMaterial[] = [];
  const site = project.site;
  const result: ExteriorScene = {
    root,
    meshes,
    roofMeshes,
    facadeMeshes,
    bounds: bounds(site?.boundary ?? level.outline),
    height: Math.max(
      level.ceilingHeight,
      ...(site?.roofs ?? []).flatMap((r) => r.vertices.map((v) => v[1])),
    ),
    dispose() {
      root.dispose(false);
      materials.forEach((material) => material.dispose(false, true));
    },
  };
  if (!site) return result;
  const material = (name: string, color: string) => {
    const m = new PBRMaterial(name, scene);
    m.albedoColor = Color3.FromHexString(color);
    m.roughness = 0.95;
    m.metallic = 0;
    m.maxSimultaneousLights = 4;
    materials.push(m);
    return m;
  };
  const grass = material('lawn', '#91a374');
  // Small deterministic noise texture, generated locally; no third-party requests.
  const pixels = new Uint8Array(128 * 128 * 4);
  let seed = 71;
  for (let i = 0; i < pixels.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const variation = ((seed >>> 24) / 255 - 0.5) * 28;
    pixels[i] = 143 + variation;
    pixels[i + 1] = 160 + variation;
    pixels[i + 2] = 112 + variation;
    pixels[i + 3] = 255;
  }
  const noise = RawTexture.CreateRGBATexture(
    pixels,
    128,
    128,
    scene,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  noise.wrapU = noise.wrapV = Texture.WRAP_ADDRESSMODE;
  noise.uScale = noise.vScale = 6;
  grass.albedoTexture = noise;
  const gravel = material('permeable-gravel', '#a9a69c');
  const path = material('garden-path', '#c6bcaa');
  const plaster = material('exterior-render', site.facadeColor ?? '#d6c5a3');
  const roof = material('slate-roof', site.roofColor ?? '#41484b');
  roof.backFaceCulling = false;
  roof.twoSidedLighting = true;
  plaster.backFaceCulling = false;
  plaster.twoSidedLighting = true;
  const add = (mesh: Mesh, mat: PBRMaterial, kind: string) => {
    mesh.parent = root;
    mesh.material = mat;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    mesh.metadata = { kind: 'exterior', exteriorKind: kind };
    meshes.push(mesh);
    return mesh;
  };
  const lawn = add(
    polygonMesh('parcel-lawn', site.boundary, site.elevation, scene, [level.outline]),
    grass,
    'ground',
  );
  lawn.checkCollisions = true;
  for (const surface of site.surfaces ?? []) {
    const mesh = add(
      polygonMesh(`site-surface:${surface.id}`, surface.polygon, site.elevation + 0.008, scene),
      surface.kind === 'gravel' ? gravel : path,
      'ground',
    );
    mesh.checkCollisions = true;
  }
  // Draw a discreet parcel edge, without inventing fences or hedge heights.
  const edge = MeshBuilder.CreateLines(
    'parcel-boundary',
    {
      points: [...site.boundary, site.boundary[0]].map(
        ([x, z]) => new Vector3(x, site.elevation + 0.015, z),
      ),
    },
    scene,
  );
  edge.parent = root;
  edge.color = Color3.FromHexString('#6c795c');
  edge.isPickable = false;
  meshes.push(edge);

  for (const wall of level.walls.filter((w) => w.exterior)) {
    const length = wallLength(wall),
      height = wall.height ?? level.ceilingHeight;
    const normal = wall.thickness / 2 + 0.012;
    const positiveSide = alongWall(wall, length / 2, normal + 0.025);
    const sign = pointInPolygon(positiveSide, level.outline) ? -1 : 1;
    const { bottom: floorOffset, openingBase } = wallFloorSpan(wall, level);
    const effectiveWall = {
      ...wall,
      openings: (wall.openings ?? []).map((opening) => ({
        ...opening,
        sill: (opening.sill ?? 0) + openingBase,
      })),
    };
    const sections = wallSections(effectiveWall, height);
    // The base course continues below the internal finished floor to the simplified yard.
    for (const [i, section] of sections.entries()) {
      const bottom = section.bottom === 0 ? Math.min(site.elevation, floorOffset) : section.bottom;
      if (section.top <= bottom) continue;
      const [x, z] = alongWall(wall, (section.start + section.end) / 2, sign * normal);
      const mesh = add(
        MeshBuilder.CreateBox(
          `facade:${wall.id}:${i}`,
          {
            width: section.end - section.start,
            height: section.top - bottom,
            depth: 0.018,
          },
          scene,
        ),
        plaster,
        'facade',
      );
      mesh.position.set(x, (section.top + bottom) / 2, z);
      mesh.rotation.y = -Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]);
      mesh.metadata.wallId = wall.id;
      facadeMeshes.push(mesh);
    }
    const eaveHeight = Math.min(...(site.roofs ?? []).flatMap((r) => r.vertices.map((v) => v[1])));
    const roofHeight = roofOverStrip(site.roofs ?? [], wall, length);
    const bandTop = Number.isFinite(roofHeight) ? roofHeight : eaveHeight;
    if (Number.isFinite(bandTop) && bandTop > height) {
      const [x, z] = alongWall(wall, length / 2);
      const band = add(
        MeshBuilder.CreateBox(
          `roof-wall-band:${wall.id}`,
          {
            width: length,
            height: bandTop - height,
            depth: wall.thickness,
          },
          scene,
        ),
        plaster,
        'roof',
      );
      band.position.set(x, (height + bandTop) / 2, z);
      band.rotation.y = -Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]);
      roofMeshes.push(band);
    }
  }
  for (const r of site.roofs ?? []) {
    // Un chien-assis n'existe que si son emprise, son mur de fond et son pan se
    // rejoignent : tout vient du projet importé, aucune forme n'est propre à
    // une maison.
    const holes = new Map<number, [number, number, number][][]>();
    for (const dormer of r.dormers ?? []) {
      const resolved = resolveRoofDormer(project, r.vertices, r.faces, dormer);
      if (!resolved.frame) continue;
      const { frame } = resolved;
      const face = r.faces[frame.faceIndex];
      const panAt = (side: number, across: number): [number, number, number] =>
        frame.acrossZ
          ? [side, roofFaceHeightAt(r.vertices, face, side, across), across]
          : [across, roofFaceHeightAt(r.vertices, face, across, side), side];
      const topAt = (side: number, across: number, height: number): [number, number, number] =>
        frame.acrossZ ? [side, height, across] : [across, height, side];
      // The pan is opened from the join on the versant to the outer face of the mur de fond.
      const hole: [number, number, number][] = [
        panAt(frame.sideLow, frame.meet),
        panAt(frame.sideHigh, frame.meet),
        panAt(frame.sideHigh, frame.front),
        panAt(frame.sideLow, frame.front),
      ];
      const list = holes.get(frame.faceIndex) ?? [];
      list.push(hole);
      holes.set(frame.faceIndex, list);
      // The joues rise from the pan to the top of the mur de fond, then rejoin
      // the pan where the dormer roof meets it.
      for (const [index, side] of [frame.sideLow, frame.sideHigh].entries()) {
        const ring: [number, number, number][] = [
          panAt(side, frame.front),
          topAt(side, frame.front, frame.frontTop),
          panAt(side, frame.meet),
        ];
        roofMeshes.push(
          add(
            faceMesh(
              `dormer-joue:${r.id}:${dormer.id}:${index}`,
              ring,
              ring.map((_, i) => i),
              scene,
            ),
            plaster,
            'roof',
          ),
        );
      }
      // Le toit de la lucarne : deux triangles, pour qu'un pan qui dérive un
      // peu le long de l'emprise reste dans la tolérance de face.
      const joinLow = panAt(frame.sideLow, frame.meet);
      const joinHigh = panAt(frame.sideHigh, frame.meet);
      const capFrontLow = topAt(frame.sideLow, frame.front, frame.frontTop);
      const capFrontHigh = topAt(frame.sideHigh, frame.front, frame.frontTop);
      for (const [index, triangle] of [
        [capFrontLow, capFrontHigh, joinHigh],
        [capFrontLow, joinHigh, joinLow],
      ].entries())
        roofMeshes.push(
          add(
            faceMesh(`dormer-toit:${r.id}:${dormer.id}:${index}`, triangle, [0, 1, 2], scene),
            roof,
            'roof',
          ),
        );
      result.height = Math.max(result.height, frame.frontTop);
    }
    for (const [i, face] of r.faces.entries())
      roofMeshes.push(
        add(faceMesh(`roof:${r.id}:${i}`, r.vertices, face, scene, holes.get(i)), roof, 'roof'),
      );
    for (const [i, face] of (r.gables ?? []).entries())
      roofMeshes.push(
        add(faceMesh(`gable:${r.id}:${i}`, r.vertices, face, scene), plaster, 'roof'),
      );
  }
  roofMeshes.forEach((mesh) => mesh.setEnabled(false));
  return result;
}
