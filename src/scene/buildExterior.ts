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
import type { HouseProject, Level, Point2 } from '../model/types';
import { alongWall, bounds, pointInPolygon, wallLength, wallSections } from '../model/geometry';
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

/** Triangulate planar faces in their dominant plane, including vertical gables. */
function faceMesh(
  name: string,
  vertices: [number, number, number][],
  face: number[],
  scene: Scene,
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
  const data = new VertexData();
  data.positions = points.flat();
  data.indices = earcut(points.flatMap((p) => p.filter((_, i) => i !== dominant)));
  data.normals = [];
  VertexData.ComputeNormals(data.positions, data.indices, data.normals);
  data.uvs = points.flatMap(([x, y, z]) => [Math.hypot(x, z), y]);
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  return mesh;
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
    if (Number.isFinite(eaveHeight) && eaveHeight > height) {
      const [x, z] = alongWall(wall, length / 2);
      const band = add(
        MeshBuilder.CreateBox(
          `roof-wall-band:${wall.id}`,
          {
            width: length,
            height: eaveHeight - height,
            depth: wall.thickness,
          },
          scene,
        ),
        plaster,
        'roof',
      );
      band.position.set(x, (height + eaveHeight) / 2, z);
      band.rotation.y = -Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]);
      roofMeshes.push(band);
    }
  }
  for (const r of site.roofs ?? []) {
    for (const [i, face] of r.faces.entries())
      roofMeshes.push(add(faceMesh(`roof:${r.id}:${i}`, r.vertices, face, scene), roof, 'roof'));
    for (const [i, face] of (r.gables ?? []).entries())
      roofMeshes.push(
        add(faceMesh(`gable:${r.id}:${i}`, r.vertices, face, scene), plaster, 'roof'),
      );
  }
  roofMeshes.forEach((mesh) => mesh.setEnabled(false));
  return result;
}
