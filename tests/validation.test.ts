import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ProjectValidationError, validateProject } from '../src/model/validate';
import type { HouseProject } from '../src/model/types';
import { pointInOrOnPolygon, polygonInsidePolygon } from '../src/model/geometry';
import type { Point2 } from '../src/model/types';

const original = JSON.parse(
  await readFile(new URL('../public/projects/studio-demo.json', import.meta.url), 'utf8'),
) as HouseProject;
const expectInvalid = (mutate: (project: HouseProject) => void, message: RegExp) => {
  const input = structuredClone(original);
  mutate(input);
  assert.throws(
    () => validateProject(input),
    (error) => error instanceof ProjectValidationError && message.test(error.message),
  );
};

test('import rejects crossing and repeated edges in level and room outlines', () => {
  const crossed: Point2[] = [
    [0, 0],
    [6, 6],
    [0, 6],
    [4, 0],
  ];
  expectInvalid((p) => {
    p.levels[0].outline = crossed;
    p.levels[0].rooms = [];
    p.levels[0].walls = [];
    p.levels[0].spawn.position = [2, 5];
  }, /Contour de niveau/);
  expectInvalid((p) => {
    p.levels[0].rooms[0].polygon = crossed;
    p.levels[0].rooms[0].label = [2, 5];
    p.levels[0].rooms[0].viewpoint = [2, 5];
  }, /Pièce invalide/);
  expectInvalid((p) => {
    p.levels[0].outline.splice(1, 0, p.levels[0].outline[0]);
  }, /Contour de niveau/);
  // Valid collinear subdivisions of an edge remain accepted.
  const valid = structuredClone(original);
  const [a, b] = valid.levels[0].outline;
  valid.levels[0].outline.splice(1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  assert.doesNotThrow(() => validateProject(valid));
});

test('import rejects openings smaller than their joinery profiles', () => {
  for (const kind of ['door', 'window', 'sliding', 'garage'] as const) {
    for (const dimension of ['width', 'height'] as const) {
      expectInvalid((p) => {
        const opening = p.levels[0].walls[0].openings![0];
        opening.kind = kind;
        opening.sill = 0;
        opening[dimension] = 0.02;
      }, /au moins 10 cm/);
    }
  }
});

test('import permits window sills and rejects raised traversable openings', () => {
  assert.doesNotThrow(() => validateProject(original));
  for (const kind of ['door', 'sliding', 'garage'] as const) {
    expectInvalid((p) => {
      const opening = p.levels[0].walls[0].openings![0];
      opening.kind = kind;
      opening.sill = 0.5;
      opening.height = 1.5;
    }, /partir du sol/);
  }
});

test('import rejects a ceiling too low for the fixed-height walk camera', () => {
  expectInvalid((p) => {
    p.levels[0].ceilingHeight = 1.5;
    p.levels[0].walls.forEach((wall) => {
      wall.openings = [];
    });
  }, /au moins 1,80 m/);
});

test('null and malformed entries produce project validation errors, not TypeErrors', () => {
  const invalidEntries: [string, (project: HouseProject) => void][] = [
    [
      'level',
      (p) => {
        p.levels[0] = null as never;
      },
    ],
    [
      'wall',
      (p) => {
        p.levels[0].walls[0] = null as never;
      },
    ],
    [
      'opening before sorting',
      (p) => {
        p.levels[0].walls[0].openings!.push(null as never);
      },
    ],
    [
      'room',
      (p) => {
        p.levels[0].rooms[0] = null as never;
      },
    ],
    [
      'light',
      (p) => {
        p.levels[0].lights[0] = null as never;
      },
    ],
    [
      'spawn',
      (p) => {
        p.levels[0].spawn = [] as never;
      },
    ],
    [
      'finishes',
      (p) => {
        p.finishes = [] as never;
      },
    ],
    [
      'walls',
      (p) => {
        p.levels[0].walls = {} as never;
      },
    ],
    [
      'openings',
      (p) => {
        p.levels[0].walls[0].openings = {} as never;
      },
    ],
    [
      'notes',
      (p) => {
        p.source.notes = null as never;
      },
    ],
  ];
  for (const [name, mutate] of invalidEntries) {
    const p = structuredClone(original);
    mutate(p);
    assert.throws(
      () => validateProject(p),
      (error) => error instanceof ProjectValidationError,
      name,
    );
  }
});

test('invalid optional metadata and flags are rejected instead of changing renderer behavior', () => {
  expectInvalid((p) => {
    p.levels[0].walls[0].exterior = 'false' as never;
  }, /booléen/);
  expectInvalid((p) => {
    p.levels[0].walls[0].openings![0].sill = null as never;
  }, /Dimensions/);
  expectInvalid((p) => {
    p.levels[0].walls[0].openings![0].exterior = 'false' as never;
  }, /booléen/);
  expectInvalid((p) => {
    p.levels[0].lights[0].provisional = 'false' as never;
  }, /statut/);
  expectInvalid((p) => {
    p.levels[0].rooms[0].note = {} as never;
  }, /texte/);
});

test('room floor offsets permit a lowered garage and reject invalid values', () => {
  const lowered = structuredClone(original);
  (lowered.levels[0].rooms[0] as unknown as Record<string, unknown>).floorOffset = -0.12;
  assert.doesNotThrow(() => validateProject(lowered));
  for (const value of [null, '−0.12', 0.12, -1.01]) {
    expectInvalid((p) => {
      (p.levels[0].rooms[0] as unknown as Record<string, unknown>).floorOffset = value;
    }, /décalage de sol/);
  }
});

test('import rejects a room translated outside the level even if its own label and viewpoint are valid', () => {
  expectInvalid((p) => {
    const room = p.levels[0].rooms[0];
    room.polygon = room.polygon.map(([x, z]) => [x + 100, z + 100]);
    room.label = [room.label[0] + 100, room.label[1] + 100];
    room.viewpoint = [room.viewpoint[0] + 100, room.viewpoint[1] + 100];
  }, /contour du niveau/);
});

test('import rejects room edges that cross outside a concave level despite interior vertices', () => {
  const outline: Point2[] = [
    [0, 0],
    [6, 0],
    [6, 2],
    [2, 2],
    [2, 6],
    [0, 6],
  ];
  const room: Point2[] = [
    [1, 1],
    [5, 1],
    [1, 5],
  ];
  assert.ok(room.every((point) => pointInOrOnPolygon(point, outline)));
  assert.equal(polygonInsidePolygon(room, outline), false);
  expectInvalid((p) => {
    const level = p.levels[0];
    level.outline = outline;
    level.walls = [];
    level.spawn.position = [1.2, 1.2];
    level.rooms = [{ ...level.rooms[0], polygon: room, label: [1.3, 1.3], viewpoint: [1.3, 1.3] }];
  }, /contour du niveau/);
});

test('containment handles concave boundary vertices and permits valid shared edges', () => {
  const outline: Point2[] = [
    [0, 0],
    [6, 0],
    [6, 6],
    [4, 6],
    [3, 3],
    [2, 6],
    [0, 6],
  ];
  // The horizontal edge exits through boundary vertices, rather than crossing
  // a boundary edge at a proper interior intersection.
  const bridgingNotch: Point2[] = [
    [1, 6],
    [5, 6],
    [3, 1],
  ];
  assert.ok(bridgingNotch.every((point) => pointInOrOnPolygon(point, outline)));
  assert.equal(polygonInsidePolygon(bridgingNotch, outline), false);
  const square: Point2[] = [
    [0, 0],
    [6, 0],
    [6, 6],
    [0, 6],
  ];
  assert.equal(polygonInsidePolygon(square, square), true);
  assert.equal(
    polygonInsidePolygon(
      [
        [0, 0],
        [3, 0],
        [3, 2],
        [0, 2],
      ],
      square,
    ),
    true,
  );
  assert.equal(
    polygonInsidePolygon(
      [
        [0, 0],
        [3, 0],
        [3, 2],
        [0, 2],
      ].reverse() as Point2[],
      square,
    ),
    true,
  );
});
