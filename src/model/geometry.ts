import type { HouseProject, Level, Opening, Point2, ProjectSite, RoofDormer, Wall } from './types';

export function polygonArea(points: Point2[]): number {
  return (
    Math.abs(
      points.reduce((area, a, i) => {
        const b = points[(i + 1) % points.length];
        return area + a[0] * b[1] - b[0] * a[1];
      }, 0),
    ) / 2
  );
}

export function pointInPolygon(point: Point2, polygon: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

export function wallLength(wall: Wall): number {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
}

export interface WallSection {
  start: number;
  end: number;
  bottom: number;
  top: number;
}
/** Split wall solids around openings; no invisible collision boxes across doorways. */
export function wallSections(wall: Wall, height: number): WallSection[] {
  const result: WallSection[] = [];
  let cursor = 0;
  for (const opening of [...(wall.openings ?? [])].sort((a, b) => a.offset - b.offset)) {
    if (opening.offset > cursor)
      result.push({ start: cursor, end: opening.offset, bottom: 0, top: height });
    const sill = opening.sill ?? 0;
    if (sill > 0)
      result.push({
        start: opening.offset,
        end: opening.offset + opening.width,
        bottom: 0,
        top: sill,
      });
    if (sill + opening.height < height)
      result.push({
        start: opening.offset,
        end: opening.offset + opening.width,
        bottom: sill + opening.height,
        top: height,
      });
    cursor = opening.offset + opening.width;
  }
  if (cursor < wallLength(wall))
    result.push({ start: cursor, end: wallLength(wall), bottom: 0, top: height });
  return result;
}

export function alongWall(wall: Wall, offset: number, normal = 0): Point2 {
  const length = wallLength(wall);
  const dx = (wall.end[0] - wall.start[0]) / length;
  const dz = (wall.end[1] - wall.start[1]) / length;
  return [wall.start[0] + dx * offset - dz * normal, wall.start[1] + dz * offset + dx * normal];
}

export function traversable(opening: Opening): boolean {
  return opening.kind === 'door' || opening.kind === 'sliding' || opening.kind === 'garage';
}

export function floorElevationAt(level: Level, point: Point2): number {
  const room = level.rooms.find(
    (room) => room.floorOffset !== undefined && pointInPolygon(point, room.polygon),
  );
  return level.elevation + (room?.floorOffset ?? 0);
}

/**
 * Ground under a point: the room's floor inside the house, the parcel's flat
 * terrain outside. A project without a site keeps the level datum outside.
 */
export function groundElevationAt(
  level: Level,
  site: ProjectSite | undefined,
  point: Point2,
): number {
  return pointInPolygon(point, level.outline)
    ? floorElevationAt(level, point)
    : level.elevation + (site?.elevation ?? 0);
}

export function bounds(points: Point2[]) {
  const xs = points.map((p) => p[0]),
    zs = points.map((p) => p[1]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minZ = Math.min(...zs),
    maxZ = Math.max(...zs);
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    center: [(minX + maxX) / 2, (minZ + maxZ) / 2] as Point2,
  };
}

const CONTAINMENT_TOLERANCE = 1e-7;
const cross2 = (a: Point2, b: Point2) => a[0] * b[1] - a[1] * b[0];

function pointOnSegment(point: Point2, a: Point2, b: Point2): boolean {
  const edge: Point2 = [b[0] - a[0], b[1] - a[1]];
  const relative: Point2 = [point[0] - a[0], point[1] - a[1]];
  const length = Math.hypot(...edge);
  if (length <= CONTAINMENT_TOLERANCE) return Math.hypot(...relative) <= CONTAINMENT_TOLERANCE;
  if (Math.abs(cross2(edge, relative)) > CONTAINMENT_TOLERANCE * length) return false;
  const projection = (relative[0] * edge[0] + relative[1] * edge[1]) / (length * length);
  const tolerance = CONTAINMENT_TOLERANCE / length;
  return projection >= -tolerance && projection <= 1 + tolerance;
}

/** Boundary contact is permitted for room contours, unlike visitor positions. */
export function pointInOrOnPolygon(point: Point2, polygon: Point2[]): boolean {
  return (
    pointInPolygon(point, polygon) ||
    polygon.some((a, i) => pointOnSegment(point, a, polygon[(i + 1) % polygon.length]))
  );
}

/**
 * Validate every edge, not just the vertices: a chord can leave a concave outline.
 * Boundary intersections partition each edge into intervals entirely inside or
 * outside the outline. Checking their midpoints also handles vertex contacts and
 * segments collinear with the boundary without rejecting valid shared edges.
 */
export function polygonInsidePolygon(inner: Point2[], outer: Point2[]): boolean {
  if (inner.length < 3 || outer.length < 3 || !inner.every((p) => pointInOrOnPolygon(p, outer)))
    return false;
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i],
      b = inner[(i + 1) % inner.length];
    const edge: Point2 = [b[0] - a[0], b[1] - a[1]];
    const lengthSquared = edge[0] * edge[0] + edge[1] * edge[1];
    const length = Math.sqrt(lengthSquared);
    if (length <= CONTAINMENT_TOLERANCE) continue;
    const parameters = [0, 1];
    const tolerance = CONTAINMENT_TOLERANCE / length;
    for (let j = 0; j < outer.length; j++) {
      const c = outer[j],
        d = outer[(j + 1) % outer.length];
      const boundary: Point2 = [d[0] - c[0], d[1] - c[1]];
      const relative: Point2 = [c[0] - a[0], c[1] - a[1]];
      const boundaryLength = Math.hypot(...boundary);
      const denominator = cross2(edge, boundary);
      if (Math.abs(denominator) > Number.EPSILON * Math.max(1, length * boundaryLength) * 16) {
        const t = cross2(relative, boundary) / denominator;
        const u = cross2(relative, edge) / denominator;
        const boundaryTolerance =
          CONTAINMENT_TOLERANCE / Math.max(boundaryLength, CONTAINMENT_TOLERANCE);
        if (
          t >= -tolerance &&
          t <= 1 + tolerance &&
          u >= -boundaryTolerance &&
          u <= 1 + boundaryTolerance
        )
          parameters.push(Math.max(0, Math.min(1, t)));
      } else {
        for (const endpoint of [c, d])
          if (pointOnSegment(endpoint, a, b)) {
            const t =
              ((endpoint[0] - a[0]) * edge[0] + (endpoint[1] - a[1]) * edge[1]) / lengthSquared;
            parameters.push(Math.max(0, Math.min(1, t)));
          }
      }
    }
    parameters.sort((x, y) => x - y);
    for (let j = 1; j < parameters.length; j++) {
      if (parameters[j] - parameters[j - 1] <= tolerance) continue;
      const t = (parameters[j] + parameters[j - 1]) / 2;
      if (!pointInOrOnPolygon([a[0] + t * edge[0], a[1] + t * edge[1]], outer)) return false;
    }
  }
  return true;
}

/** Unit normal of a roof face (Newell); zero vector when degenerate. */
function roofFaceNormal(
  vertices: [number, number, number][],
  face: number[],
): [number, number, number] {
  const normal: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < face.length; i++) {
    const a = vertices[face[i]],
      b = vertices[face[(i + 1) % face.length]];
    normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
    normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
    normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (length < 1e-9) return [0, 0, 0];
  return [normal[0] / length, normal[1] / length, normal[2] / length];
}

/** Height of a roof face plane at (x, z); NaN when the face is vertical. */
export function roofFaceHeightAt(
  vertices: [number, number, number][],
  face: number[],
  x: number,
  z: number,
): number {
  const normal = roofFaceNormal(vertices, face);
  if (Math.abs(normal[1]) < 1e-4) return Number.NaN;
  const [x0, y0, z0] = vertices[face[0]];
  return y0 - (normal[0] * (x - x0) + normal[2] * (z - z0)) / normal[1];
}

/** Projection of a roof face on the plan (x, z). */
export function roofFacePlanOutline(
  vertices: [number, number, number][],
  face: number[],
): Point2[] {
  return face.map((index) => [vertices[index][0], vertices[index][2]] as Point2);
}

/** Piercing frame of a resolved dormer, in the level plan coordinates. */
export interface DormerFrame {
  level: Level;
  wall: Wall;
  /** Index of the pierced face within the roof. */
  faceIndex: number;
  /** Plane positions of the two joues, a few millimetres outside the wall body. */
  sideLow: number;
  sideHigh: number;
  /** Across-coordinates of the piercing: join on the pan, front face of the mur de fond. */
  meet: number;
  front: number;
  /** The across-axis is z (mur de fond running along x); false when the axes swap. */
  acrossZ: boolean;
  /** Height of the top of the mur de fond, above the ground level datum. */
  frontTop: number;
}

export type DormerResolution =
  { frame: DormerFrame; error?: undefined } | { frame?: undefined; error: string };

const DORMER_SIDE_MARGIN = 0.003;
const DORMER_FRONT_TOLERANCE = 0.03;

/**
 * Resolve the piercing frame of a dormer from the project data alone: the
 * emprise rectangle, the mur de fond carrying the front face, and the pan it
 * pierces. Shared by the import validation and the exterior renderer, so a
 * lucarne accepted at import is one the renderer can build.
 */
export function resolveRoofDormer(
  project: HouseProject,
  vertices: [number, number, number][],
  faces: number[][],
  dormer: RoofDormer,
): DormerResolution {
  const x0 = Math.min(dormer.start[0], dormer.end[0]),
    x1 = Math.max(dormer.start[0], dormer.end[0]),
    z0 = Math.min(dormer.start[1], dormer.end[1]),
    z1 = Math.max(dormer.start[1], dormer.end[1]);
  if (x1 - x0 < 0.05 || z1 - z0 < 0.05)
    return { error: `L'emprise de la lucarne ${dormer.id} doit être un rectangle en plan.` };
  if (
    dormer.slope !== undefined &&
    (!Number.isFinite(dormer.slope) || dormer.slope < 0 || dormer.slope > 10)
  )
    return { error: `La pente de la lucarne ${dormer.id} doit rester entre 0 et 10.` };
  const center: Point2 = [(x0 + x1) / 2, (z0 + z1) / 2];
  const level = project.levels.find((candidate) =>
    candidate.walls.some((candidate) => candidate.id === dormer.wallId),
  );
  if (!level)
    return { error: `La lucarne ${dormer.id} ne trouve pas son mur de fond ${dormer.wallId}.` };
  if (!pointInOrOnPolygon(center, level.outline))
    return { error: `La lucarne ${dormer.id} doit reposer sur le niveau de son mur de fond.` };
  const wall = level.walls.find((candidate) => candidate.id === dormer.wallId);
  if (!wall)
    return { error: `La lucarne ${dormer.id} ne trouve pas son mur de fond ${dormer.wallId}.` };
  if (wall.exterior !== true)
    return {
      error: `Le mur de fond ${dormer.wallId} de la lucarne ${dormer.id} doit être un mur extérieur.`,
    };
  const length = wallLength(wall),
    dx = (wall.end[0] - wall.start[0]) / length,
    dz = (wall.end[1] - wall.start[1]) / length;
  const acrossZ = Math.abs(dx) >= Math.abs(dz);
  if (acrossZ ? Math.abs(dz) > 0.1 : Math.abs(dx) > 0.1)
    return {
      error: `Le mur de fond ${dormer.wallId} doit être parallèle aux côtés de l'emprise de la lucarne ${dormer.id}.`,
    };
  const wallAcross = acrossZ ? wall.start[1] : wall.start[0];
  if (Math.abs((acrossZ ? wall.end[1] : wall.end[0]) - wallAcross) > 0.01)
    return {
      error: `Le mur de fond ${dormer.wallId} doit être droit sur la lucarne ${dormer.id}.`,
    };
  const acrossStart = acrossZ ? z0 : x0,
    acrossEnd = acrossZ ? z1 : x1;
  // The near edge of the emprise rests on the interior face of the mur de fond.
  const nearer =
    Math.abs(acrossStart - wallAcross) <= Math.abs(acrossEnd - wallAcross)
      ? acrossStart
      : acrossEnd;
  if (Math.abs(nearer - wallAcross) > wall.thickness / 2 + DORMER_FRONT_TOLERANCE)
    return {
      error: `L'emprise de la lucarne ${dormer.id} doit s'appuyer sur le nu intérieur du mur de fond ${dormer.wallId}.`,
    };
  const back = nearer === acrossStart ? acrossEnd : acrossStart;
  // The exterior side of the mur de fond is the side the emprise comes from.
  const exteriorSign = nearer > back ? 1 : -1;
  const front = wallAcross + exteriorSign * (wall.thickness / 2);
  if (Math.abs(front - back) < 0.05)
    return {
      error: `L'emprise de la lucarne ${dormer.id} doit avoir au moins 5 cm de profondeur.`,
    };
  const sides = acrossZ ? [x0, x1] : [z0, z1];
  const wallSpan = acrossZ ? [wall.start[0], wall.end[0]] : [wall.start[1], wall.end[1]];
  const overlap =
    Math.min(Math.max(...wallSpan), sides[1]) - Math.max(Math.min(...wallSpan), sides[0]);
  if (overlap < sides[1] - sides[0] - 0.03)
    return {
      error: `Le mur de fond ${dormer.wallId} ne couvre pas la largeur de la lucarne ${dormer.id}.`,
    };
  // The pierced pan: the one face whose plan projection carries the whole piercing.
  const ring: Point2[] = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
  const frontCorners: Point2[] = ring.map((corner) =>
    acrossZ ? [corner[0], front] : [front, corner[1]],
  );
  const piercing = [...ring, ...frontCorners];
  const frontTop = level.elevation + (wall.height ?? level.ceilingHeight);
  const retreat = Math.abs(front - back);
  let unplaced: string | undefined;
  for (const [faceIndex, face] of faces.entries()) {
    const outline = roofFacePlanOutline(vertices, face);
    if (!piercing.every((corner) => pointInOrOnPolygon(corner, outline))) continue;
    const heights = piercing.map((corner) =>
      roofFaceHeightAt(vertices, face, corner[0], corner[1]),
    );
    if (heights.some((height) => !Number.isFinite(height))) {
      unplaced = `La lucarne ${dormer.id} perce un pan vertical de la toiture.`;
      continue;
    }
    // The pan may slope across the emprise — that is the versant — but not
    // along the mur de fond: the joues and the dormer roof join horizontally.
    for (const row of [acrossStart, acrossEnd, front]) {
      const low = acrossZ
        ? roofFaceHeightAt(vertices, face, sides[0], row)
        : roofFaceHeightAt(vertices, face, row, sides[0]);
      const high = acrossZ
        ? roofFaceHeightAt(vertices, face, sides[1], row)
        : roofFaceHeightAt(vertices, face, row, sides[1]);
      if (Math.abs(low - high) > 0.01)
        return {
          error: `Le pan percé par la lucarne ${dormer.id} s'incline le long de son emprise.`,
        };
    }
    const frontHeight = acrossZ
      ? roofFaceHeightAt(vertices, face, (x0 + x1) / 2, front)
      : roofFaceHeightAt(vertices, face, front, (z0 + z1) / 2);
    if (frontTop <= frontHeight + 0.005)
      return {
        error: `Le mur de fond ${dormer.wallId} ne dépasse pas la couverture : la lucarne ${dormer.id} resterait invisible.`,
      };
    // Le toit de la lucarne rejoint le pan : à l'arrière de l'emprise sans
    // pente déclarée, en un point de l'emprise quand la pente est donnée.
    const panAtBack = acrossZ
      ? roofFaceHeightAt(vertices, face, (x0 + x1) / 2, back)
      : roofFaceHeightAt(vertices, face, back, (z0 + z1) / 2);
    const panRise = (panAtBack - frontHeight) / retreat;
    let meet = back;
    if (dormer.slope !== undefined) {
      if (dormer.slope >= panRise - 1e-4) {
        return {
          error: `La pente de la lucarne ${dormer.id} éloigne son toit de la couverture.`,
        };
      }
      const untilJoin = (frontTop - frontHeight) / (panRise - dormer.slope);
      if (untilJoin > retreat + 0.005)
        return {
          error: `La pente de la lucarne ${dormer.id} éloigne son toit de la couverture.`,
        };
      const direction = Math.sign(front - back) || 1;
      meet = front - direction * untilJoin;
    }
    return {
      frame: {
        level,
        wall,
        faceIndex,
        sideLow: sides[0] - DORMER_SIDE_MARGIN,
        sideHigh: sides[1] + DORMER_SIDE_MARGIN,
        meet,
        front,
        acrossZ,
        frontTop,
      },
    };
  }
  return { error: unplaced ?? `Aucun pan ne porte l'emprise de la lucarne ${dormer.id}.` };
}
