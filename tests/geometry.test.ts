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
  resolveRoofDormer,
  resolveRoofWindow,
  traversable,
  wallLength,
  wallSections,
} from '../src/model/geometry';
import type {
  HouseProject,
  Level,
  Opening,
  Point2,
  RoofDormer,
  Room,
  Wall,
} from '../src/model/types';

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
  // A rotated roof exercises every nonzero horizontal component of the basis.
  const rotated = {
    ...frame,
    across: [0.8, 0, -0.6] as Vertex,
    up: [0.36, 0.8, 0.48] as Vertex,
    normal: [-0.48, 0.6, -0.64] as Vertex,
  };
  const point = roofWindowPoint(rotated, 2, 5, -1);
  near(point[0], 13.88);
  near(point[1], 23.4);
  near(point[2], 31.84);
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

// A dormer case: level datum 1 m, back wall along x at z = 8 (0.3 thick, 3 m tall, so its
// top is at 4), footprint 1 m wide and 1 m deep resting on its interior face (z = 7.85).
// The pierced face rises 1 m per metre inwards from 3.5 at the outer face (z = 8.15); a
// first face, on the other side of the ridge, carries nothing. `swap` exchanges x and z.
function dormerCase(
  edit: {
    wall?: Partial<Wall>;
    dormer?: Partial<RoofDormer>;
    ceilingHeight?: number;
    tilt?: number;
    onlyDecoy?: boolean;
  } = {},
  swap = false,
) {
  const p = (x: number, z: number): Point2 => (swap ? [z, x] : [x, z]);
  const v = (x: number, y: number, z: number): [number, number, number] =>
    swap ? [z, y, x] : [x, y, z];
  const height = (x: number, z: number) => 3.5 + (8.15 - z) + (edit.tilt ?? 0) * x;
  const vertices = [
    v(0, height(0, 4), 4),
    v(10, height(10, 4), 4),
    v(10, 3.65, 0),
    v(0, 3.65, 0),
    v(0, height(0, 9), 9),
    v(10, height(10, 9), 9),
    v(10, height(10, 4), 4),
    v(0, height(0, 4), 4),
  ];
  const faces = edit.onlyDecoy
    ? [[0, 1, 2, 3]]
    : [
        [0, 1, 2, 3],
        [4, 5, 6, 7],
      ];
  const back: Wall = {
    id: 'fond',
    start: p(2, 8),
    end: p(5, 8),
    thickness: 0.3,
    height: 3,
    exterior: true,
    ...edit.wall,
  };
  const level = {
    id: 'combles',
    name: 'Combles',
    elevation: 1,
    ceilingHeight: edit.ceilingHeight ?? 2.6,
    outline: [p(0, 0), p(10, 0), p(10, 8.15), p(0, 8.15)],
    walls: [back],
    rooms: [],
    lights: [],
    spawn: { position: p(5, 4), yaw: 0 },
  } as Level;
  const dormer: RoofDormer = {
    id: 'lucarne',
    start: p(3, 7.85),
    end: p(4, 6.85),
    wallId: 'fond',
    ...edit.dormer,
  };
  return resolveRoofDormer({ levels: [level] } as unknown as HouseProject, vertices, faces, dormer);
}

test('resolveRoofDormer: the frame of a dormer resting on its back wall, in either axis', () => {
  for (const swap of [false, true]) {
    const { frame, error } = dormerCase({}, swap);
    assert.equal(error, undefined);
    assert.ok(frame);
    assert.equal(frame.acrossZ, !swap);
    assert.equal(frame.faceIndex, 1);
    assert.equal(frame.wall.id, 'fond');
    assert.equal(frame.level.id, 'combles');
    near(frame.front, 8.15);
    // Without a slope, the dormer roof meets the face at the back of the footprint.
    near(frame.meet, 6.85);
    near(frame.sideLow, 3 - 0.003);
    near(frame.sideHigh, 4 + 0.003);
    near(frame.frontTop, 4);
  }
  // The corners may be given in any order; the wall height defaults to the ceiling.
  const reversed = dormerCase({ dormer: { start: [4, 6.85], end: [3, 7.85] } });
  near(reversed.frame!.front, 8.15);
  near(reversed.frame!.sideLow, 2.997);
  const ceiling = dormerCase({ wall: { height: undefined }, ceilingHeight: 3 });
  near(ceiling.frame!.frontTop, 4);
});

test('resolveRoofDormer: a declared slope moves the join with the roof face inside the footprint', () => {
  // Wall top 4, face 3.5 at the front and rising 1 per metre: a 0.25 slope joins it
  // 0.5 / 0.75 m behind the outer face; a flat roof joins it 0.5 m behind.
  for (const swap of [false, true]) {
    near(dormerCase({ dormer: { slope: 0.25 } }, swap).frame!.meet, 8.15 - 0.5 / 0.75);
    near(dormerCase({ dormer: { slope: 0 } }, swap).frame!.meet, 7.65);
  }
  // As steep as the face, or joining it past the back of the footprint: never meets it.
  for (const slope of [1, 0.9])
    assert.match(dormerCase({ dormer: { slope } }).error!, /éloigne son toit/);
  for (const slope of [-0.1, 10.5, Number.NaN, Number.POSITIVE_INFINITY])
    assert.match(dormerCase({ dormer: { slope } }).error!, /entre 0 et 10/);
});

test('resolveRoofDormer: each inconsistency of the data is refused with its reason', () => {
  const refused = (edit: Parameters<typeof dormerCase>[0], reason: RegExp) => {
    const { frame, error } = dormerCase(edit);
    assert.equal(frame, undefined);
    assert.match(error ?? '', reason);
  };
  refused({ dormer: { end: [4, 7.82] } }, /rectangle en plan/);
  refused({ dormer: { end: [3.04, 6.85] } }, /rectangle en plan/);
  refused({ dormer: { wallId: 'absent' } }, /ne trouve pas son mur de fond absent/);
  refused({ dormer: { start: [20, 7.85], end: [21, 6.85] } }, /reposer sur le niveau/);
  refused({ wall: { exterior: undefined } }, /doit être un mur extérieur/);
  refused({ wall: { end: [5, 9] } }, /parallèle/);
  refused({ wall: { start: [8, 2], end: [9, 5] } }, /parallèle/);
  refused({ wall: { end: [5, 8.05] } }, /droit/);
  refused({ dormer: { start: [3, 7.6], end: [4, 6.6] } }, /nu intérieur/);
  refused(
    { wall: { thickness: 0.02 }, dormer: { start: [3, 8.025], end: [4, 7.97] } },
    /au moins 5 cm de profondeur/,
  );
  refused({ dormer: { start: [4.5, 7.85], end: [5.5, 6.85] } }, /ne couvre pas la largeur/);
  refused({ onlyDecoy: true }, /Aucun pan ne porte l'emprise de la lucarne lucarne/);
  refused({ tilt: 0.1 }, /s'incline le long de son emprise/);
  refused({ wall: { height: 2.5 } }, /ne dépasse pas la couverture/);
});

test('resolveRoofDormer: the tolerances accept what lies just inside them', () => {
  const accepted = (edit: Parameters<typeof dormerCase>[0]) => {
    const { frame, error } = dormerCase(edit);
    assert.equal(error, undefined);
    assert.ok(frame);
    return frame;
  };
  // 2.9 cm off the interior face (tolerance 3 cm); the wall covering 98 of 100 cm.
  near(accepted({ dormer: { start: [3, 7.821], end: [4, 6.85] } }).front, 8.15);
  accepted({ dormer: { start: [4.02, 7.85], end: [5.02, 6.85] } });
  // A wall barely out of square, and its top 1 cm above the face at the front.
  accepted({ wall: { end: [5, 8.005] } });
  accepted({ wall: { height: 2.51 } });
  // A tiny tilt along the wall, within a centimetre over the footprint width.
  accepted({ tilt: 0.005 });
});

test('resolveRoofWindow on a face sloping along both axes keeps the frame in the plane, to size', () => {
  // y = x / 4 + z / 2, wound either way; the window is read across and along the slope.
  const tilted: Vertex[] = [
    [0, 0, 0],
    [8, 2, 0],
    [8, 4, 4],
    [0, 2, 4],
  ];
  for (const face of [
    [0, 1, 2, 3],
    [3, 2, 1, 0],
  ]) {
    const { frame, error } = resolveRoofWindow(
      tilted,
      [face],
      roofWindow({ center: [4, 2], width: 1.2, height: 0.8 }),
    );
    assert.equal(error, undefined);
    assert.ok(frame);
    const dot = (a: Vertex, b: Vertex) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const length = (a: Vertex) => Math.sqrt(dot(a, a));
    // The normal points above the roofing, perpendicular to y = x / 4 + z / 2.
    const expected = [-0.25, 1, -0.5].map((c) => c / Math.hypot(0.25, 1, 0.5));
    frame.normal.forEach((c, i) => near(c, expected[i]));
    near(length(frame.up), 1);
    near(length(frame.across), 1);
    near(frame.across[1], 0);
    near(dot(frame.up, frame.normal), 0);
    near(dot(frame.across, frame.normal), 0);
    near(dot(frame.up, frame.across), 0);
    assert.ok(frame.up[1] > 0, 'up climbs the slope');
    near(frame.center[1], 4 / 4 + 2 / 2);
    for (const corner of frame.corners)
      near(roofFaceHeightAt(tilted, face, corner[0], corner[2]), corner[1]);
    const gap = (a: Vertex, b: Vertex) => length([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    near(gap(frame.corners[0], frame.corners[1]), 1.2);
    near(gap(frame.corners[1], frame.corners[2]), 0.8);
  }
});

test('resolveRoofWindow measures its edge margin even when the face repeats a vertex', () => {
  const repeated: Vertex[] = [...pitch, pitch[1]];
  // The face pitchFace with its second vertex given twice: a zero-length edge.
  const face = [pitchFace[0], pitchFace[1], 4, ...pitchFace.slice(2)];
  const at = (x: number) => resolveRoofWindow(repeated, [face], roofWindow({ center: [x, 1] }));
  assert.match(at(0.504).error ?? '', /déborde/);
  assert.ok(at(0.506).frame);
});
