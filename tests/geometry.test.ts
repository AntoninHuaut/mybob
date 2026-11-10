import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import {
  alongWall,
  bounds,
  floorElevationAt,
  groundElevationAt,
  pointInOrOnPolygon,
  pointInPolygon,
  polygonArea,
  polygonInsidePolygon,
  roofFaceHeightAt,
  roofFacePlanOutline,
  roofWindowPoint,
  resolveRoofWindow,
  traversable,
  wallLength,
  wallSections,
} from '../src/model/geometry';
import type { Level, Opening, Point2, Room, Wall } from '../src/model/types';

const near = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);

const square = (x0: number, z0: number, x1: number, z1: number): Point2[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];
// An L: the notch is the square (2..4, 2..4).
const L: Point2[] = [
  [0, 0],
  [4, 0],
  [4, 2],
  [2, 2],
  [2, 4],
  [0, 4],
];

// Coordinates in decimetres: exact enough in binary, wide enough to find real bugs.
const coordinate = fc.integer({ min: -400, max: 400 }).map((value) => value / 10);
const rectangle = fc
  .tuple(coordinate, coordinate, fc.integer({ min: 1, max: 300 }), fc.integer({ min: 1, max: 300 }))
  .map(([x, z, w, d]) => square(x, z, x + w / 10, z + d / 10));
const rotate = (points: Point2[], angle: number): Point2[] =>
  points.map(([x, z]) => [
    x * Math.cos(angle) - z * Math.sin(angle),
    x * Math.sin(angle) + z * Math.cos(angle),
  ]);

const wall = (extra: Partial<Wall> = {}): Wall => ({
  id: 'w',
  start: [0, 0],
  end: [10, 0],
  thickness: 0.3,
  ...extra,
});
const opening = (offset: number, width: number, extra: Partial<Opening> = {}): Opening => ({
  id: `o-${offset}`,
  kind: 'window',
  offset,
  width,
  height: 1,
  ...extra,
});

test('polygonArea: known shapes, whatever the winding', () => {
  near(polygonArea(square(0, 0, 2, 3)), 6);
  near(
    polygonArea([
      [0, 0],
      [4, 0],
      [0, 3],
    ]),
    6,
  );
  near(polygonArea(L), 12);
  near(polygonArea([...L].reverse()), 12);
  assert.equal(polygonArea([]), 0);
  assert.equal(
    polygonArea([
      [1, 1],
      [2, 2],
    ]),
    0,
  );
});

test('polygonArea: invariant by translation, rotation and reversal; scales with the square', () => {
  fc.assert(
    fc.property(
      rectangle,
      coordinate,
      coordinate,
      fc.double({ min: 0, max: 6.28, noNaN: true }),
      fc.integer({ min: 1, max: 5 }),
      (rect, dx, dz, angle, k) => {
        const area = polygonArea(rect);
        near(polygonArea(rect.map(([x, z]) => [x + dx, z + dz])), area, 1e-6);
        near(polygonArea(rotate(rect, angle)), area, 1e-6);
        near(polygonArea([...rect].reverse()), area, 1e-9);
        near(polygonArea(rect.map(([x, z]) => [x * k, z * k])), area * k * k, 1e-6);
        const [a, b, c, d] = rect;
        near(polygonArea([c, d, a, b]), area, 1e-9);
      },
    ),
  );
});

test('pointInPolygon: strict interior of a rectangle, and the notch of a concave outline', () => {
  const box = square(0, 0, 2, 2);
  assert.equal(pointInPolygon([1, 1], box), true);
  for (const outside of [
    [3, 1],
    [-1, 1],
    [1, 3],
    [1, -1],
  ] as Point2[])
    assert.equal(pointInPolygon(outside, box), false);
  assert.equal(pointInPolygon([1, 1], L), true);
  assert.equal(pointInPolygon([3, 1], L), true);
  assert.equal(pointInPolygon([1, 3], L), true);
  assert.equal(pointInPolygon([3, 3], L), false);
  assert.equal(pointInPolygon([5, 1], L), false);
  assert.equal(pointInPolygon([1, 1], []), false);
});

test('pointInPolygon agrees with the bounds of a rectangle and ignores the vertex order', () => {
  fc.assert(
    fc.property(
      rectangle,
      fc.integer({ min: -500, max: 500 }),
      fc.integer({ min: -500, max: 500 }),
      (rect, px, pz) => {
        // Half-decimetre offsets never touch the decimetre grid of the rectangle.
        const point: Point2 = [px / 10 + 0.05, pz / 10 + 0.05];
        const { minX, maxX, minZ, maxZ } = bounds(rect);
        const expected = point[0] > minX && point[0] < maxX && point[1] > minZ && point[1] < maxZ;
        assert.equal(pointInPolygon(point, rect), expected);
        assert.equal(pointInPolygon(point, [...rect].reverse()), expected);
        assert.equal(pointInPolygon(point, [...rect.slice(2), ...rect.slice(0, 2)]), expected);
      },
    ),
  );
});

test('wallLength is the Euclidean length, in any direction', () => {
  near(wallLength(wall({ start: [0, 0], end: [3, 4] })), 5);
  near(wallLength(wall({ start: [3, 4], end: [0, 0] })), 5);
  near(wallLength(wall({ start: [1, 1], end: [1, 1] })), 0);
});

test('wallSections: a bare wall is one full-height section', () => {
  assert.deepEqual(wallSections(wall(), 2.5), [{ start: 0, end: 10, bottom: 0, top: 2.5 }]);
});

test('wallSections: a floor-to-lintel door leaves two jambs and a lintel', () => {
  const sections = wallSections(
    wall({ openings: [opening(4, 1, { kind: 'door', height: 2 })] }),
    2.5,
  );
  assert.deepEqual(sections, [
    { start: 0, end: 4, bottom: 0, top: 2.5 },
    { start: 4, end: 5, bottom: 2, top: 2.5 },
    { start: 5, end: 10, bottom: 0, top: 2.5 },
  ]);
});

test('wallSections: a window adds a sill below and a head above, in offset order', () => {
  const sections = wallSections(
    wall({
      openings: [
        opening(6, 1, { sill: 0.5, height: 1 }),
        opening(2, 1, { sill: 0.9, height: 1.2 }),
      ],
    }),
    2.5,
  );
  assert.deepEqual(sections, [
    { start: 0, end: 2, bottom: 0, top: 2.5 },
    { start: 2, end: 3, bottom: 0, top: 0.9 },
    { start: 2, end: 3, bottom: 2.1, top: 2.5 },
    { start: 3, end: 6, bottom: 0, top: 2.5 },
    { start: 6, end: 7, bottom: 0, top: 0.5 },
    { start: 6, end: 7, bottom: 1.5, top: 2.5 },
    { start: 7, end: 10, bottom: 0, top: 2.5 },
  ]);
});

test('wallSections: openings at either end, or reaching the ceiling, leave no empty section', () => {
  assert.deepEqual(wallSections(wall({ openings: [opening(0, 2, { height: 2.5 })] }), 2.5), [
    { start: 2, end: 10, bottom: 0, top: 2.5 },
  ]);
  assert.deepEqual(wallSections(wall({ openings: [opening(8, 2, { height: 3 })] }), 2.5), [
    { start: 0, end: 8, bottom: 0, top: 2.5 },
  ]);
  // A window whose head stops exactly at the ceiling has no head section.
  assert.deepEqual(
    wallSections(wall({ openings: [opening(4, 1, { sill: 1.5, height: 1 })] }), 2.5),
    [
      { start: 0, end: 4, bottom: 0, top: 2.5 },
      { start: 4, end: 5, bottom: 0, top: 1.5 },
      { start: 5, end: 10, bottom: 0, top: 2.5 },
    ],
  );
});

test('wallSections: the solid parts and the openings tile the wall exactly', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 20 }), (count, gap) => {
      // Doors of 80 cm spaced by `gap` decimetres: no overlap by construction.
      const openings = Array.from({ length: count }, (_, i) =>
        opening(0.5 + i * (0.8 + gap / 10), 0.8, { kind: 'door', height: 2 }),
      );
      const length = 0.5 + count * (0.8 + gap / 10) + 1;
      const full = wallSections(
        wall({ end: [length, 0], openings: [...openings].reverse() }),
        2.5,
      ).filter((section) => section.bottom === 0 && section.top === 2.5);
      const solid = full.reduce((sum, section) => sum + section.end - section.start, 0);
      near(solid, length - count * 0.8, 1e-9);
      for (const section of full) assert.ok(section.end > section.start);
    }),
  );
});

test('alongWall places a point along the wall and to its left; traversable openings', () => {
  assert.deepEqual(alongWall(wall(), 3), [3, 0]);
  assert.deepEqual(alongWall(wall(), 3, 2), [3, 2]);
  const [x, z] = alongWall(wall({ start: [1, 1], end: [1, 5] }), 2, 0.5);
  near(x, 0.5);
  near(z, 3);
  const [dx, dz] = alongWall(wall({ start: [0, 0], end: [3, 4] }), 5);
  near(dx, 3);
  near(dz, 4);
  for (const kind of ['door', 'sliding', 'garage'] as const)
    assert.equal(traversable(opening(0, 1, { kind })), true, kind);
  assert.equal(traversable(opening(0, 1, { kind: 'window' })), false);
});

const level = (rooms: Room[]): Level => ({
  id: 'l',
  name: 'L',
  elevation: 3,
  ceilingHeight: 2.5,
  outline: square(0, 0, 10, 10),
  walls: [],
  rooms,
  lights: [],
  spawn: { position: [1, 1], yaw: 0 },
});
const room = (id: string, polygon: Point2[], floorOffset?: number): Room => ({
  id,
  name: id,
  kind: 'living',
  polygon,
  label: [0, 0],
  viewpoint: [0, 0],
  ...(floorOffset === undefined ? {} : { floorOffset }),
});

test('floorElevationAt follows the sunken room and ignores rooms with no offset', () => {
  const house = level([
    room('salon', square(0, 0, 10, 10)),
    room('garage', square(6, 0, 10, 4), -0.12),
  ]);
  near(floorElevationAt(house, [8, 2]), 2.88);
  near(floorElevationAt(house, [2, 2]), 3);
  near(floorElevationAt(house, [20, 20]), 3);
  near(floorElevationAt(level([room('step', square(0, 0, 10, 10), 0.4)]), [2, 2]), 3.4);
});

test('groundElevationAt: floor inside the outline, parcel terrain outside', () => {
  const house = level([room('garage', square(6, 0, 10, 4), -0.12)]);
  const site = { elevation: -0.4 } as Parameters<typeof groundElevationAt>[1];
  near(groundElevationAt(house, site, [8, 2]), 2.88);
  near(groundElevationAt(house, site, [20, 20]), 2.6);
  near(groundElevationAt(house, undefined, [20, 20]), 3);
});

test('bounds: extent, size and centre of any point set', () => {
  const box = bounds(L);
  assert.deepEqual(
    [box.minX, box.maxX, box.minZ, box.maxZ, box.width, box.depth],
    [0, 4, 0, 4, 4, 4],
  );
  assert.deepEqual(box.center, [2, 2]);
  assert.deepEqual(
    bounds([
      [-3, 5],
      [1, -2],
    ]),
    { minX: -3, maxX: 1, minZ: -2, maxZ: 5, width: 4, depth: 7, center: [-1, 1.5] },
  );
  fc.assert(
    fc.property(
      fc.array(fc.tuple(coordinate, coordinate), { minLength: 1, maxLength: 12 }),
      (points) => {
        const b = bounds(points);
        for (const [x, z] of points)
          assert.ok(x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);
        assert.ok(points.some(([x]) => x === b.minX) && points.some(([x]) => x === b.maxX));
        assert.ok(points.some(([, z]) => z === b.minZ) && points.some(([, z]) => z === b.maxZ));
        near(b.width, b.maxX - b.minX);
        near(b.center[0], (b.minX + b.maxX) / 2);
      },
    ),
  );
});

test('pointInOrOnPolygon: boundary and vertices count, with a one-millimetre tolerance', () => {
  const box = square(0, 0, 4, 2);
  assert.equal(pointInOrOnPolygon([2, 1], box), true);
  assert.equal(pointInOrOnPolygon([2, 0], box), true);
  assert.equal(pointInOrOnPolygon([4, 2], box), true);
  assert.equal(pointInOrOnPolygon([0, 0], box), true);
  assert.equal(pointInOrOnPolygon([2, -0.0009], box), true);
  assert.equal(pointInOrOnPolygon([2, -0.0011], box), false);
  assert.equal(pointInOrOnPolygon([4.0009, 1], box), true);
  assert.equal(pointInOrOnPolygon([4.0011, 1], box), false);
  // Beyond the end of an edge, along its own line: only the tolerance past the vertex counts.
  assert.equal(pointInOrOnPolygon([4.0009, 0], box), true);
  assert.equal(pointInOrOnPolygon([4.002, 0], box), false);
  assert.equal(pointInOrOnPolygon([-0.002, 0], box), false);
  assert.equal(pointInOrOnPolygon([3, 3], box), false);
});

test('pointInOrOnPolygon: a zero-length edge is a point, not a line', () => {
  const dup: Point2[] = [
    [0, 0],
    [0, 0],
    [4, 0],
    [4, 2],
    [0, 2],
  ];
  assert.equal(pointInOrOnPolygon([0, 0.0005], dup), true);
  assert.equal(pointInOrOnPolygon([-0.002, 0], dup), false);
  assert.equal(pointInOrOnPolygon([-1, -1], dup), false);
});

test('pointInOrOnPolygon never rejects what pointInPolygon accepts, and keeps the boundary', () => {
  fc.assert(
    fc.property(
      rectangle,
      fc.integer({ min: -500, max: 500 }),
      fc.integer({ min: -500, max: 500 }),
      (rect, px, pz) => {
        const point: Point2 = [px / 10, pz / 10];
        if (pointInPolygon(point, rect)) assert.equal(pointInOrOnPolygon(point, rect), true);
        rect.forEach((a, i) => {
          const b = rect[(i + 1) % rect.length];
          assert.equal(pointInOrOnPolygon(a, rect), true);
          assert.equal(pointInOrOnPolygon([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], rect), true);
        });
      },
    ),
  );
});

test('polygonInsidePolygon: nested, touching and protruding shapes', () => {
  const outer = square(0, 0, 10, 10);
  assert.equal(polygonInsidePolygon(square(2, 2, 8, 8), outer), true);
  assert.equal(polygonInsidePolygon(outer, outer), true);
  assert.equal(polygonInsidePolygon(square(0, 0, 5, 5), outer), true);
  assert.equal(polygonInsidePolygon(square(5, 5, 11, 8), outer), false);
  assert.equal(polygonInsidePolygon(square(-0.01, 2, 5, 5), outer), false);
  assert.equal(polygonInsidePolygon(square(20, 20, 30, 30), outer), false);
  assert.equal(polygonInsidePolygon(square(2, 2, 8, 8), square(3, 3, 7, 7)), false);
  // Fewer than three vertices is not a shape, on either side.
  assert.equal(
    polygonInsidePolygon(
      [
        [1, 1],
        [2, 2],
      ],
      outer,
    ),
    false,
  );
  assert.equal(
    polygonInsidePolygon(square(2, 2, 8, 8), [
      [0, 0],
      [10, 10],
    ]),
    false,
  );
});

test('polygonInsidePolygon checks the edges: a chord can leave a concave outline', () => {
  // Every vertex is inside the L, but the edge between two of them crosses the notch.
  const chord: Point2[] = [
    [3.5, 1],
    [1, 3.5],
    [0.5, 0.5],
  ];
  assert.ok(chord.every((p) => pointInOrOnPolygon(p, L)));
  assert.equal(polygonInsidePolygon(chord, L), false);
  assert.equal(polygonInsidePolygon(square(0.2, 0.2, 2, 2), L), true);
  assert.equal(polygonInsidePolygon(square(0, 0, 2, 4), L), true);
  assert.equal(polygonInsidePolygon(square(2, 0, 4, 2), L), true);
  assert.equal(polygonInsidePolygon(square(1, 1, 3.5, 3.5), L), false);
});

test('polygonInsidePolygon: shrinking a rectangle towards its centre keeps it inside', () => {
  fc.assert(
    fc.property(rectangle, fc.integer({ min: 1, max: 9 }), (rect, tenths) => {
      const { center } = bounds(rect);
      const factor = tenths / 10;
      const inner = rect.map(([x, z]): Point2 => [
        center[0] + (x - center[0]) * factor,
        center[1] + (z - center[1]) * factor,
      ]);
      assert.equal(polygonInsidePolygon(inner, rect), true);
      assert.equal(polygonInsidePolygon(rect, inner), false);
      assert.equal(
        polygonInsidePolygon(
          rect.map(([x, z]): Point2 => [x + 1000, z]),
          rect,
        ),
        false,
      );
    }),
  );
});

type Vertex = [number, number, number];
// A pitched face rising 0.5 m per metre of z: y = 2 + z / 2 over x ∈ [0, 4], z ∈ [0, 2].
const pitch: Vertex[] = [
  [0, 2, 0],
  [4, 2, 0],
  [4, 3, 2],
  [0, 3, 2],
];
const pitchFace = [0, 1, 2, 3];
const upright: Vertex[] = [
  [0, 0, 0],
  [4, 0, 0],
  [4, 3, 0],
  [0, 3, 0],
];

test('roofFaceHeightAt reads the plane, whichever way the face is wound', () => {
  near(roofFaceHeightAt(pitch, pitchFace, 1, 1), 2.5);
  near(roofFaceHeightAt(pitch, pitchFace, 3, 2), 3);
  near(roofFaceHeightAt(pitch, pitchFace, 0, 0), 2);
  near(roofFaceHeightAt(pitch, [3, 2, 1, 0], 1, 1), 2.5);
  // A plane tilted both ways: y = x / 4 + z / 2.
  const tilted: Vertex[] = [
    [0, 0, 0],
    [4, 1, 0],
    [4, 2, 2],
    [0, 1, 2],
  ];
  near(roofFaceHeightAt(tilted, [0, 1, 2, 3], 2, 1), 1);
  assert.ok(Number.isNaN(roofFaceHeightAt(upright, [0, 1, 2, 3], 1, 0)));
  assert.ok(Number.isNaN(roofFaceHeightAt(pitch, [0, 1], 1, 1)));
  fc.assert(
    fc.property(
      fc.double({ min: 0, max: 4, noNaN: true }),
      fc.double({ min: 0, max: 2, noNaN: true }),
      (x, z) => near(roofFaceHeightAt(pitch, pitchFace, x, z), 2 + z / 2, 1e-9),
    ),
  );
});

test('roofFacePlanOutline drops the height of each vertex of the face', () => {
  assert.deepEqual(roofFacePlanOutline(pitch, [3, 1, 0]), [
    [0, 2],
    [4, 0],
    [0, 0],
  ]);
});

test('roofWindowPoint is the centre plus across, up and depth along their own axes', () => {
  const frame = {
    faceIndex: 0,
    center: [10, 20, 30] as Vertex,
    across: [1, 0, 0] as Vertex,
    up: [0, 0.6, 0.8] as Vertex,
    normal: [0, 0.8, -0.6] as Vertex,
  };
  assert.deepEqual(roofWindowPoint(frame, 0, 0), [10, 20, 30]);
  const [x, y, z] = roofWindowPoint(frame, 2, 5, -1);
  near(x, 12);
  near(y, 20 + 3 - 0.8);
  near(z, 30 + 4 + 0.6);
});

// Windows on the pitched face: across = +x, up climbs towards +z.
const roofWindow = (extra: Record<string, unknown> = {}) =>
  ({ id: 'rw', center: [2, 1], width: 1, height: 1, ...extra }) as Parameters<
    typeof resolveRoofWindow
  >[2];

test('resolveRoofWindow lays a frame in the roof plane, measured across and along the slope', () => {
  const result = resolveRoofWindow(pitch, [pitchFace], roofWindow({ width: 1.2, height: 0.8 }));
  assert.ok(result.frame, result.error ?? 'no frame');
  const { frame } = result;
  assert.equal(frame.faceIndex, 0);
  frame.center.forEach((v, i) => near(v, [2, 2.5, 1][i], 1e-9));
  near(Math.hypot(...frame.normal), 1);
  assert.ok(frame.normal[1] > 0);
  near(frame.across[1], 0);
  near(frame.across[0] * frame.up[0] + frame.across[2] * frame.up[2], 0);
  const [a, b, c, d] = frame.corners;
  const dist = (p: Vertex, q: Vertex) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  near(dist(a, b), 1.2);
  near(dist(b, c), 0.8);
  near(dist(c, d), 1.2);
  near(dist(d, a), 0.8);
  for (const corner of frame.corners)
    near(corner[1], roofFaceHeightAt(pitch, pitchFace, corner[0], corner[2]), 1e-9);
});

test('resolveRoofWindow picks the face under the centre, and says why nothing carries it', () => {
  const second: Vertex[] = [
    [4, 0, 0],
    [8, 0, 0],
    [8, 1, 2],
    [4, 1, 2],
  ];
  const vertices = [...pitch, ...second];
  const faces = [pitchFace, [4, 5, 6, 7]];
  assert.equal(
    resolveRoofWindow(vertices, faces, roofWindow({ center: [6, 1] })).frame?.faceIndex,
    1,
  );
  assert.match(
    resolveRoofWindow(vertices, faces, roofWindow({ center: [20, 1] })).error ?? '',
    /Aucun pan ne porte la fenêtre de toit rw/,
  );
});

test('resolveRoofWindow refuses non-finite or too small windows', () => {
  const error = (extra: Record<string, unknown>) =>
    resolveRoofWindow(pitch, [pitchFace], roofWindow(extra)).error;
  for (const bad of [
    { width: Number.NaN },
    { height: Number.POSITIVE_INFINITY },
    { center: [Number.NaN, 1] },
    { center: [1, Number.POSITIVE_INFINITY] },
    { center: [1, 2, 3] },
    { center: [1] },
    { center: 'ici' },
  ])
    assert.match(error(bad) ?? '', /position et des dimensions valides/, JSON.stringify(bad));
  assert.match(error({ width: 0.09 }) ?? '', /au moins 10 cm.*rw/);
  assert.match(error({ height: 0.09 }) ?? '', /au moins 10 cm/);
  assert.equal(error({ width: 0.1, height: 0.1 }), undefined);
});

test('resolveRoofWindow keeps a 5 mm margin from the edges of the face', () => {
  const at = (x: number) =>
    resolveRoofWindow(pitch, [pitchFace], roofWindow({ center: [x, 1], width: 1 }));
  // The left jamb lands 4 mm, then 6 mm, from the left edge of the face.
  assert.match(at(0.504).error ?? '', /déborde du pan qui la porte.*5 mm/);
  assert.ok(at(0.506).frame);
  assert.match(at(3.496).error ?? '', /déborde/);
  assert.ok(at(3.494).frame);
});

test('resolveRoofWindow refuses vertical and horizontal faces, and ignores the winding', () => {
  assert.match(
    resolveRoofWindow(upright, [[0, 1, 2, 3]], roofWindow({ center: [2, 0] })).error ?? '',
    /Aucun pan ne porte|pan vertical/,
  );
  const flat: Vertex[] = [
    [0, 3, 0],
    [4, 3, 0],
    [4, 3, 2],
    [0, 3, 2],
  ];
  assert.match(resolveRoofWindow(flat, [[0, 1, 2, 3]], roofWindow()).error ?? '', /pan horizontal/);
  const reversed = resolveRoofWindow(pitch, [[3, 2, 1, 0]], roofWindow());
  const forward = resolveRoofWindow(pitch, [pitchFace], roofWindow());
  assert.ok(reversed.frame && forward.frame);
  for (let i = 0; i < 3; i++) near(reversed.frame.normal[i], forward.frame.normal[i]);
  assert.ok(reversed.frame.normal[1] > 0);
  // A degenerate face (collinear vertices) has no normal and carries nothing.
  const line: Vertex[] = [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
  ];
  assert.match(
    resolveRoofWindow(line, [[0, 1, 2]], roofWindow({ center: [1, 0] })).error ?? '',
    /Aucun pan/,
  );
});
