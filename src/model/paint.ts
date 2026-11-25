import type { HouseProject, Level, Point2, Room, WallFacePaint, Wall } from './types';
import { alongWall, pointInPolygon } from './geometry';

/** A paint colour, `#rrggbb`, lower case once normalised. */
export const PAINT_COLOR = /^#[0-9a-fA-F]{6}$/;
export const DEFAULT_PLASTER_COLOR = '#eeede8';

export function wallFacePaint(room: Room, wallId: string, side: WallFacePaint['side']) {
  return (
    room.wallFaces?.find((face) => face.wallId === wallId && face.side === side)?.color ??
    room.wallColor
  );
}

/** Suggested paints of the room card; any other colour stays available through the picker. */
export const PAINT_PALETTE: readonly { color: string; name: string }[] = [
  { color: '#e8dfcf', name: 'Lin' },
  { color: '#d9d4c7', name: 'Gris perle' },
  { color: '#b9c4ab', name: 'Sauge' },
  { color: '#b7c7d3', name: 'Bleu brume' },
  { color: '#d8b26a', name: 'Ocre' },
  { color: '#c9876b', name: 'Terracotta' },
  { color: '#4f6b55', name: 'Vert forêt' },
  { color: '#34495e', name: 'Bleu nuit' },
];

/**
 * Local paint choices of one project, by level then room: a colour, or `null` for a room
 * brought back to plain plaster over a colour the project itself carries.
 */
export type RoomPaintChoice = { color?: string | null; faces: WallFacePaint[] };
export type PaintOverrides = Record<string, Record<string, string | null | RoomPaintChoice>>;

export function isFacePaint(value: unknown): value is WallFacePaint {
  if (!value || typeof value !== 'object') return false;
  const face = value as Partial<WallFacePaint>;
  return (
    typeof face.wallId === 'string' &&
    (face.side === 1 || face.side === -1) &&
    typeof face.color === 'string' &&
    PAINT_COLOR.test(face.color)
  );
}

/** Reads stored choices; anything malformed is dropped rather than blocking the house. */
export function parsePaintOverrides(raw: unknown): PaintOverrides {
  const result: PaintOverrides = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [levelId, rooms] of Object.entries(raw)) {
    if (!rooms || typeof rooms !== 'object' || Array.isArray(rooms)) continue;
    const clean: PaintOverrides[string] = {};
    for (const [roomId, color] of Object.entries(rooms))
      if (color === null || (typeof color === 'string' && PAINT_COLOR.test(color)))
        clean[roomId] = color === null ? null : color.toLowerCase();
      else if (
        color &&
        typeof color === 'object' &&
        'faces' in color &&
        Array.isArray(color.faces)
      ) {
        const choice: RoomPaintChoice = { faces: color.faces.filter(isFacePaint) };
        if (
          'color' in color &&
          (color.color === null ||
            (typeof color.color === 'string' && PAINT_COLOR.test(color.color)))
        )
          choice.color = color.color;
        clean[roomId] = choice;
      }
    if (Object.keys(clean).length) result[levelId] = clean;
  }
  return result;
}

/**
 * The project as painted here: each room's `wallColor` after the local choices. Levels and
 * rooms are always fresh objects, so painting the result never reaches the stored project.
 */
export function withPaint(project: HouseProject, overrides: PaintOverrides): HouseProject {
  return {
    ...project,
    levels: project.levels.map((level) => {
      const choices = overrides[level.id] ?? {};
      return {
        ...level,
        rooms: level.rooms.map((room) => {
          if (!Object.hasOwn(choices, room.id)) return { ...room };
          const choice = choices[room.id];
          const copy = { ...room };
          const detailed = typeof choice === 'object' && choice !== null;
          const color = detailed ? choice.color : choice;
          if (color) copy.wallColor = color;
          else if (color === null) delete copy.wallColor;
          if (detailed) {
            if (choice.faces.length) copy.wallFaces = choice.faces;
            else delete copy.wallFaces;
          }
          return copy;
        }),
      };
    }),
  };
}

export interface WallSideSpan {
  start: number;
  end: number;
  room: Room;
}

function segmentParameter(a: Point2, b: Point2, c: Point2, d: Point2): number | undefined {
  const rx = b[0] - a[0],
    rz = b[1] - a[1],
    sx = d[0] - c[0],
    sz = d[1] - c[1];
  const denominator = rx * sz - rz * sx;
  if (Math.abs(denominator) < 1e-12) return undefined;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / denominator;
  const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / denominator;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : undefined;
}

/**
 * Which room faces one side of a wall, between `start` and `end` along it. The line
 * `offset` metres off the wall axis (positive on the left of start → end, as `alongWall`)
 * is cut where it crosses a room outline, so a wall shared by two rooms on the same side
 * paints each part in its own room's colour.
 */
export function wallSideSpans(
  level: Level,
  wall: Wall,
  start: number,
  end: number,
  offset: number,
): WallSideSpan[] {
  if (end - start < 1e-6) return [];
  const a = alongWall(wall, start, offset),
    b = alongWall(wall, end, offset);
  const cuts = [0, 1];
  for (const room of level.rooms)
    room.polygon.forEach((c, i) => {
      const t = segmentParameter(a, b, c, room.polygon[(i + 1) % room.polygon.length]);
      if (t !== undefined) cuts.push(t);
    });
  cuts.sort((x, y) => x - y);
  const spans: WallSideSpan[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    if (cuts[i + 1] - cuts[i] < 1e-9) continue;
    const middle = (cuts[i] + cuts[i + 1]) / 2;
    const sample: Point2 = [a[0] + (b[0] - a[0]) * middle, a[1] + (b[1] - a[1]) * middle];
    const room = level.rooms.find((candidate) => pointInPolygon(sample, candidate.polygon));
    if (!room) continue;
    const from = start + (end - start) * cuts[i],
      to = start + (end - start) * cuts[i + 1];
    const previous = spans.at(-1);
    if (previous && previous.room === room && Math.abs(previous.end - from) < 1e-9)
      previous.end = to;
    else spans.push({ start: from, end: to, room });
  }
  return spans;
}
