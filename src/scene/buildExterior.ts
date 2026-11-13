import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder';
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
  resolveRoofWindow,
  roofFaceHeightAt,
  roofFacePlanOutline,
  roofWindowPoint,
  wallLength,
  wallSections,
} from '../model/geometry';
import { polygonMesh, wallFloorSpan, worldScaleUvs } from './buildHouse';
import { createExteriorTextures, LAWN_DETAIL_TILE, LAWN_TILE, SLATE_TILE } from './surfaceTextures';

/** How far a dormer roof stays above its back wall's top: enough for the depth buffer from the plot. */
const DORMER_ROOF_CLEARANCE = 0.02;

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
/** Box UVs in metres, so the render's grain keeps one size on every façade. */
function metricBox(mesh: Mesh): Mesh {
  worldScaleUvs(mesh);
  return mesh;
}

/**
 * Metric UVs in the plane of a face: `u` runs horizontally along it and `v` up
 * its slope (straight up on a wall), so slate courses follow the eave and a
 * render keeps one grain size on every face. A level face falls back to plan
 * axes. The sign of the normal does not matter.
 */
export function planeUv(point: [number, number, number], normal: number[]): [number, number] {
  const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const [nx, ny, nz] = normal.map((value) => value / length);
  if (Math.abs(ny) > 0.999) return [point[0], point[2]];
  // Up projected onto the plane, then the horizontal direction across it.
  const up = [-nx * ny, 1 - ny * ny, -nz * ny];
  const upLength = Math.hypot(up[0], up[1], up[2]);
  const along = [nz, 0, -nx];
  const alongLength = Math.hypot(along[0], along[2]);
  return [
    (point[0] * along[0] + point[2] * along[2]) / alongLength,
    (point[0] * up[0] + point[1] * up[1] + point[2] * up[2]) / upLength,
  ];
}

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
  data.uvs = rings.flat().flatMap((point) => planeUv(point, normal));
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  return mesh;
}

/**
 * Height of the roof over a wall strip: the lowest point of the roof faces that cover
 * it. A band cut at the drip edge leaves a slit into the attic wherever the roof
 * overhangs, because the eave sits lower than the roof at the wall plane.
 * The strip is measured between two offsets along the centre line: the band
 * reaches into the corners, where the roof face hangs lower than above the wall.
 */
function roofOverStrip(roofs: SiteRoof[], wall: Wall, from: number, to: number): number {
  let lowest = Number.POSITIVE_INFINITY;
  const span = to - from;
  if (span <= 0) return lowest;
  const steps = Math.max(2, Math.ceil(span / 0.1));
  for (let i = 0; i <= steps; i++) {
    for (const side of [-1, 0, 1]) {
      const [x, z] = alongWall(wall, from + (i / steps) * span, (side * wall.thickness) / 2);
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

/**
 * A facade skin spans the wall's centerline length, but a skin panel ends
 * where the wall does: at a corner joined centerline against centerline, the
 * neighbour's end cap then shows as a pale strip. Each wall end that terminates
 * inside a perpendicular exterior wall's core must instead reach that
 * neighbour's outer skin plane. Ends already cut at the neighbour's outer face,
 * collinear joins and oblique corners keep their span: they close by
 * themselves or need a miter that no offset reproduces.
 */
function cornerStretch(
  exterior: Wall[],
  wall: Wall,
  outline: Point2[],
): { start: number; end: number } {
  const length = wallLength(wall);
  const dx = (wall.end[0] - wall.start[0]) / length;
  const dz = (wall.end[1] - wall.start[1]) / length;
  let start = 0;
  let end = 0;
  for (const w of exterior) {
    if (w.id === wall.id) continue;
    const wLen = wallLength(w);
    if (wLen < 1e-6) continue;
    const wdx = (w.end[0] - w.start[0]) / wLen;
    const wdz = (w.end[1] - w.start[1]) / wLen;
    if (Math.abs(wdx * dx + wdz * dz) > 0.1) continue;
    const half = w.thickness / 2;
    const probe = alongWall(w, wLen / 2, half + 0.037);
    const signW = pointInPolygon(probe, outline) ? -1 : 1;
    const nx = signW * -wdz;
    const nz = signW * wdx;
    const axis = dx * nx + dz * nz;
    if (Math.abs(axis) < 0.9) continue;
    const rel0 = [wall.start[0] - w.start[0], wall.start[1] - w.start[1]];
    const cap = 1.5;
    // Where w's outer skin plane crosses this wall, as an offset along the
    // centre line: the corner the skin has to reach.
    const corner = (half + 0.012 - (rel0[0] * nx + rel0[1] * nz)) / axis;
    if (corner <= -cap || corner >= length + cap) continue;
    for (const point of [wall.start, wall.end] as const) {
      const rel = [point[0] - w.start[0], point[1] - w.start[1]];
      const alongW = rel[0] * wdx + rel[1] * wdz;
      if (alongW < -0.02 || alongW > wLen + 0.02) continue;
      const outW = rel[0] * nx + rel[1] * nz;
      if (Math.abs(outW) + 0.001 >= half) continue;
      if (corner <= -0.001) start = Math.max(start, Math.min(-corner, cap));
      else if (corner >= length + 0.001) end = Math.max(end, Math.min(corner - length, cap));
    }
  }
  return { start, end };
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
  const textures = createExteriorTextures(scene);
  const tiled = (texture: Texture, metres: number) => {
    texture.uScale = texture.vScale = 1 / metres;
    return texture;
  };
  const grass = material('lawn', '#91a374');
  // Patches over 16 m in the colour, grain and relief over 0.73 m in the detail
  // map: two scales that never line up, so neither repeat shows. The lawn's UVs
  // are in metres. Generated locally; no third-party requests.
  grass.albedoTexture = tiled(textures.lawnAlbedo, LAWN_TILE);
  grass.detailMap.texture = tiled(textures.lawnDetail, LAWN_DETAIL_TILE);
  grass.detailMap.isEnabled = true;
  grass.detailMap.diffuseBlendLevel = 0.5;
  grass.detailMap.roughnessBlendLevel = 0.4;
  grass.detailMap.bumpLevel = 1;
  const gravel = material('permeable-gravel', '#a9a69c');
  const path = material('garden-path', '#c6bcaa');
  const plaster = material('exterior-render', site.facadeColor ?? '#d6c5a3');
  // The interior plaster grain at twice its tile: a render is coarser than paint.
  plaster.bumpTexture = tiled(textures.renderNormal, 1);
  const roof = material('slate-roof', site.roofColor ?? '#41484b');
  roof.bumpTexture = tiled(textures.slateNormal, SLATE_TILE);
  roof.microSurfaceTexture = tiled(textures.slateRoughness, SLATE_TILE);
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
    polygonMesh('parcel-lawn', site.boundary, site.elevation, scene, [level.outline], 1, [1, 1]),
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
  const edge = CreateLines(
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

  // The frame materials reuse those of the level's joinery
  // (`src/scene/materials.ts`) and are only created at the first frame.
  let chasisMaterials: { glass: PBRMaterial; joinery: PBRMaterial } | undefined;
  const joineryMaterials = () => {
    if (chasisMaterials) return chasisMaterials;
    const pane = material('roof-window-glass', '#bfd7d0');
    pane.alpha = 0.18;
    pane.roughness = 0.14;
    pane.metallic = 0.12;
    pane.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    pane.backFaceCulling = false;
    pane.twoSidedLighting = true;
    const joinery = material('roof-window-joinery', project.finishes?.joineryColor ?? '#f3f2ec');
    joinery.roughness = 0.42;
    joinery.backFaceCulling = false;
    joinery.twoSidedLighting = true;
    return (chasisMaterials = { glass: pane, joinery });
  };
  // A frame in its own plane: an outer ring, a glazing set back 6 mm, a mullion.
  // The profile keeps 4.5 cm like the level's joinery, except on a narrow opening
  // where it shrinks to leave some glazing: never a zero quadrilateral.
  const chasis = (
    name: string,
    width: number,
    height: number,
    point: (across: number, up: number, depth: number) => [number, number, number],
  ) => {
    const { glass, joinery } = joineryMaterials();
    const profile = Math.min(0.045, width / 4, height / 4);
    const ring = (halfAcross: number, halfUp: number, depth = 0) => [
      point(-halfAcross, -halfUp, depth),
      point(halfAcross, -halfUp, depth),
      point(halfAcross, halfUp, depth),
      point(-halfAcross, halfUp, depth),
    ];
    const part = (
      kind: string,
      mat: PBRMaterial,
      outline: [number, number, number][],
      inner?: [number, number, number][],
    ) => {
      const mesh = add(
        faceMesh(
          name.replace('*', kind),
          outline,
          outline.map((_, i) => i),
          scene,
          inner ? [inner] : [],
        ),
        mat,
        'roof',
      );
      roofMeshes.push(mesh);
      return mesh;
    };
    part(
      'cadre',
      joinery,
      ring(width / 2, height / 2),
      ring(width / 2 - profile, height / 2 - profile),
    );
    // The glazing sits back behind the frame: it never crosses the face it opens.
    const pane = part(
      'vitrage',
      glass,
      ring(width / 2 - profile - 0.005, height / 2 - profile - 0.005, -0.006),
    );
    pane.receiveShadows = false;
    part('meneau', joinery, ring(profile / 2, height / 2 - profile - 0.01));
  };

  // The levels above the ground stay part of the building: their exterior
  // openings exist from outside wherever the band, a gable or a dormer front
  // would otherwise cover them. Each one only gets a frame once something
  // opens for it; an opening under the slopes (a knee wall) stays inside.
  const upperOpenings = project.levels
    .filter((upper) => upper.elevation > level.elevation)
    .flatMap((upper) =>
      upper.walls
        .filter((wall) => wall.exterior && wallLength(wall) > 1e-6)
        .flatMap((wall) => {
          const length = wallLength(wall);
          const probe = alongWall(wall, length / 2, wall.thickness / 2 + 0.037);
          const outward = pointInPolygon(probe, upper.outline) ? -1 : 1;
          const base = upper.elevation - level.elevation + wallFloorSpan(wall, upper).openingBase;
          return (wall.openings ?? []).map((opening) => ({
            level: upper,
            wall,
            opening,
            start: opening.offset,
            end: opening.offset + opening.width,
            bottom: base + (opening.sill ?? 0),
            top: base + (opening.sill ?? 0) + opening.height,
            /** A point of the wall's vertical plane, `depth` outward from its outer face. */
            point: (along: number, y: number, depth = 0): [number, number, number] => {
              const [x, z] = alongWall(wall, along, outward * (wall.thickness / 2 + depth));
              return [x, y, z];
            },
            exposed: false,
          }));
        }),
    );

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
    const stretch = cornerStretch(
      level.walls.filter((w) => w.exterior),
      wall,
      level.outline,
    );
    // The base course continues below the internal finished floor to the simplified yard.
    for (const [i, section] of sections.entries()) {
      const bottom = section.bottom === 0 ? Math.min(site.elevation, floorOffset) : section.bottom;
      if (section.top <= bottom) continue;
      const start = section.start === 0 ? section.start - stretch.start : section.start;
      const end = section.end === length ? section.end + stretch.end : section.end;
      const [x, z] = alongWall(wall, (start + end) / 2, sign * normal);
      const mesh = add(
        metricBox(
          CreateBox(
            `facade:${wall.id}:${i}`,
            {
              width: end - start,
              height: section.top - bottom,
              depth: 0.018,
            },
            scene,
          ),
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
    const roofHeight = roofOverStrip(site.roofs ?? [], wall, -stretch.start, length + stretch.end);
    const bandTop = Number.isFinite(roofHeight) ? roofHeight : eaveHeight;
    if (Number.isFinite(bandTop) && bandTop > height) {
      const rotation = -Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]);
      const from = -stretch.start,
        to = length + stretch.end;
      // An opening of an upper level whose outer face stands within this wall's
      // thickness is a window of the facade the band covers: the band opens for it.
      const dx = (wall.end[0] - wall.start[0]) / length,
        dz = (wall.end[1] - wall.start[1]) / length;
      const cuts: { start: number; end: number; bottom: number; top: number }[] = [];
      for (const upper of upperOpenings) {
        const u = upper.wall,
          uLength = wallLength(u);
        const udx = (u.end[0] - u.start[0]) / uLength,
          udz = (u.end[1] - u.start[1]) / uLength;
        if (Math.abs(udx * dx + udz * dz) < 0.99) continue;
        const along = ([x, , z]: [number, number, number]) =>
          (x - wall.start[0]) * dx + (z - wall.start[1]) * dz;
        const a = upper.point(upper.start, 0),
          b = upper.point(upper.end, 0);
        const across = (a[0] - wall.start[0]) * -dz + (a[2] - wall.start[1]) * dx;
        if (Math.abs(across) > wall.thickness / 2 + 0.02) continue;
        const start = Math.max(from, Math.min(along(a), along(b)));
        const end = Math.min(to, Math.max(along(a), along(b)));
        const bottom = Math.max(height, upper.bottom),
          top = Math.min(bandTop, upper.top);
        if (end - start < 0.01 || top - bottom < 0.01) continue;
        upper.exposed = true;
        cuts.push({ start, end, bottom, top });
      }
      // Overlapping cuts merge: the sections below need disjoint openings.
      cuts.sort((p, q) => p.start - q.start);
      const merged: typeof cuts = [];
      for (const cut of cuts) {
        const last = merged.at(-1);
        if (last && cut.start <= last.end) {
          last.end = Math.max(last.end, cut.end);
          last.bottom = Math.min(last.bottom, cut.bottom);
          last.top = Math.max(last.top, cut.top);
        } else merged.push({ ...cut });
      }
      const sections = merged.length
        ? wallSections(
            {
              ...wall,
              start: alongWall(wall, from),
              end: alongWall(wall, to),
              openings: merged.map((cut, i) => ({
                id: `band-cut-${i}`,
                kind: 'window' as const,
                offset: cut.start - from,
                width: cut.end - cut.start,
                sill: cut.bottom - height,
                height: cut.top - cut.bottom,
              })),
            },
            bandTop - height,
          )
        : [{ start: 0, end: to - from, bottom: 0, top: bandTop - height }];
      for (const [i, section] of sections.entries()) {
        if (section.end - section.start < 1e-4 || section.top - section.bottom < 1e-4) continue;
        const [x, z] = alongWall(wall, from + (section.start + section.end) / 2);
        const band = add(
          metricBox(
            CreateBox(
              merged.length ? `roof-wall-band:${wall.id}:${i}` : `roof-wall-band:${wall.id}`,
              {
                width: section.end - section.start,
                height: section.top - section.bottom,
                depth: wall.thickness,
              },
              scene,
            ),
          ),
          plaster,
          'roof',
        );
        band.position.set(x, height + (section.bottom + section.top) / 2, z);
        band.rotation.y = rotation;
        roofMeshes.push(band);
      }
    }
  }
  // A gable is opened for the upper-level openings lying in its plane. The
  // part of an opening below the gable (in the band) is cut there instead; an
  // opening crossing a sloped edge would also cross the roof and stays covered.
  const gableHoles = (points: [number, number, number][]) => {
    const normal = [0, 0, 0];
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
      normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
      normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const size = Math.hypot(...normal);
    if (size < 1e-9) return [];
    const [nx, ny, nz] = normal.map((value) => value / size);
    if (Math.abs(ny) > 0.05) return [];
    const offset = (p: [number, number, number]) =>
      (p[0] - points[0][0]) * nx + (p[1] - points[0][1]) * ny + (p[2] - points[0][2]) * nz;
    // In-plane coordinates: horizontal along the gable, then height.
    const flat = (p: [number, number, number]): Point2 => [p[0] * -nz + p[2] * nx, p[1]];
    const outline = points.map(flat);
    const minY = Math.min(...points.map((p) => p[1]));
    const result: [number, number, number][][] = [];
    for (const upper of upperOpenings) {
      const a = upper.point(upper.start, 0),
        b = upper.point(upper.end, 0);
      const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (length < 1e-6 || Math.abs(((b[0] - a[0]) * nx + (b[2] - a[2]) * nz) / length) > 0.05)
        continue;
      if (Math.abs(offset(a)) > 0.05 || Math.abs(offset(b)) > 0.05) continue;
      const y0 = Math.max(upper.bottom, minY + 0.002),
        y1 = upper.top;
      if (y1 - y0 < 0.01) continue;
      // Corners projected onto the gable plane.
      const onPlane = (p: [number, number, number], y: number): [number, number, number] => {
        const d = offset([p[0], y, p[2]]);
        return [p[0] - d * nx, y, p[2] - d * nz];
      };
      const ring = [onPlane(a, y0), onPlane(b, y0), onPlane(b, y1), onPlane(a, y1)];
      if (!ring.every((corner) => pointInPolygon(flat(corner), outline))) continue;
      upper.exposed = true;
      result.push(ring);
    }
    return result;
  };
  for (const r of site.roofs ?? []) {
    // A dormer only exists if its footprint, its back wall and its roof face
    // meet: everything comes from the imported project, no shape is specific to
    // one house.
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
      // The back wall's own top sits at `frontTop`, through its whole thickness: a dormer roof
      // starting there would share that plane (a flat dormer roof flickered over the wall).
      // The roof front is lifted just enough to stay above the wall's inner face.
      const join = panAt(frame.sideLow, frame.meet)[1];
      const retreat = Math.abs(frame.front - frame.meet);
      const inside = (retreat - frame.wall.thickness) / retreat;
      const roofTop =
        inside > 0.05
          ? Math.max(
              frame.frontTop,
              join + (frame.frontTop + DORMER_ROOF_CLEARANCE - join) / inside,
            )
          : frame.frontTop + DORMER_ROOF_CLEARANCE;
      // The roof face is opened from the join on the slope to the outer face of the back wall.
      const hole: [number, number, number][] = [
        panAt(frame.sideLow, frame.meet),
        panAt(frame.sideHigh, frame.meet),
        panAt(frame.sideHigh, frame.front),
        panAt(frame.sideLow, frame.front),
      ];
      const list = holes.get(frame.faceIndex) ?? [];
      list.push(hole);
      holes.set(frame.faceIndex, list);
      // The cheeks rise from the roof face to the top of the back wall, then rejoin
      // the roof face where the dormer roof meets it.
      for (const [index, side] of [frame.sideLow, frame.sideHigh].entries()) {
        const ring: [number, number, number][] = [
          panAt(side, frame.front),
          topAt(side, frame.front, roofTop),
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
      // The dormer roof: two triangles, so that a roof face drifting a little
      // along the footprint stays within the face tolerance.
      const joinLow = panAt(frame.sideLow, frame.meet);
      const joinHigh = panAt(frame.sideHigh, frame.meet);
      const capFrontLow = topAt(frame.sideLow, frame.front, roofTop);
      const capFrontHigh = topAt(frame.sideHigh, frame.front, roofTop);
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
      // The dormer front: the back wall above the roof face, 12 mm proud of the
      // wall like the facade skins, opened for the back wall's own openings.
      const outward = Math.sign(frame.front - frame.meet);
      const skin = frame.front + outward * 0.012;
      const bottom = Math.max(panAt(frame.sideLow, skin)[1], panAt(frame.sideHigh, skin)[1]);
      if (roofTop - bottom > 0.005) {
        const frontHoles: [number, number, number][][] = [];
        for (const upper of upperOpenings) {
          if (upper.wall.id !== frame.wall.id || upper.level.id !== frame.level.id) continue;
          const sideOf = (along: number) => {
            const [x, , z] = upper.point(along, 0);
            return frame.acrossZ ? x : z;
          };
          const low = Math.max(
            frame.sideLow + 0.002,
            Math.min(sideOf(upper.start), sideOf(upper.end)),
          );
          const high = Math.min(
            frame.sideHigh - 0.002,
            Math.max(sideOf(upper.start), sideOf(upper.end)),
          );
          const y0 = Math.max(bottom + 0.002, upper.bottom),
            y1 = Math.min(frame.frontTop - 0.002, upper.top);
          if (high - low < 0.01 || y1 - y0 < 0.01) continue;
          upper.exposed = true;
          frontHoles.push([
            topAt(low, skin, y0),
            topAt(high, skin, y0),
            topAt(high, skin, y1),
            topAt(low, skin, y1),
          ]);
        }
        const ring: [number, number, number][] = [
          panAt(frame.sideLow, skin),
          panAt(frame.sideHigh, skin),
          topAt(frame.sideHigh, skin, roofTop),
          topAt(frame.sideLow, skin, roofTop),
        ];
        roofMeshes.push(
          add(
            faceMesh(
              `dormer-facade:${r.id}:${dormer.id}`,
              ring,
              ring.map((_, i) => i),
              scene,
              frontHoles,
            ),
            plaster,
            'roof',
          ),
        );
      }
      result.height = Math.max(result.height, roofTop);
    }
    // A roof window lives on the roof face, not on a wall: the renderer opens the
    // slope and sets the frame in the plane of the rafter, at its height from the
    // section — never plumb with the gutter.
    for (const window of r.windows ?? []) {
      const resolved = resolveRoofWindow(r.vertices, r.faces, window);
      if (!resolved.frame) continue;
      const { frame } = resolved;
      const hole = holes.get(frame.faceIndex) ?? [];
      hole.push(frame.corners);
      holes.set(frame.faceIndex, hole);
      // Frame, glazing and mullion are rectangles of the roof face plane:
      // the width stays horizontal, the height is measured along the rafter.
      // The glazing sits back under the covering, so the rafter hides it.
      chasis(`roof-window-*:${r.id}:${window.id}`, window.width, window.height, (a, u, d) =>
        roofWindowPoint(frame, a, u, d),
      );
    }
    for (const [i, face] of r.faces.entries())
      roofMeshes.push(
        add(faceMesh(`roof:${r.id}:${i}`, r.vertices, face, scene, holes.get(i)), roof, 'roof'),
      );
    for (const [i, face] of (r.gables ?? []).entries())
      roofMeshes.push(
        add(
          faceMesh(
            `gable:${r.id}:${i}`,
            r.vertices,
            face,
            scene,
            gableHoles(face.map((index) => r.vertices[index])),
          ),
          plaster,
          'roof',
        ),
      );
  }
  // The frames of the upper levels sit 3 cm inside the outer face, behind
  // whatever opened for them: the band, the gable or the dormer front.
  for (const upper of upperOpenings.filter((candidate) => candidate.exposed)) {
    const middle = (upper.start + upper.end) / 2,
      centre = (upper.bottom + upper.top) / 2;
    chasis(
      `level-window-*:${upper.level.id}:${upper.opening.id}`,
      upper.end - upper.start,
      upper.top - upper.bottom,
      (across, up, depth) => upper.point(middle + across, centre + up, depth - 0.03),
    );
  }
  roofMeshes.forEach((mesh) => mesh.setEnabled(false));
  for (const mesh of meshes) mesh.freezeWorldMatrix();
  return result;
}
