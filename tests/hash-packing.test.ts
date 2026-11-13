import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createFurniture, validateFurnitureList, type FurnitureItem } from '../src/furniture/model';
import {
  validateVariantBook,
  type LayoutVariant,
  type VariantBook,
} from '../src/furniture/variants';
import { validateProject } from '../src/model/validate';
import type { HouseProject, Point2 } from '../src/model/types';
import {
  crc32,
  LinkPackError,
  packShareDocument,
  unpackShareDocument,
  type ShareDocument,
} from '../src/model/linkPacker';
import {
  decodeShareLinkHash,
  encodeShareLinkHash,
  samePackedState,
  ShareLinkError,
} from '../src/model/shareLink';

/**
 * The repository's two test plans: the maison-atelier template and the converted plan.
 * The share link is a transport projection: pack → deflate-raw → base64url.
 */
const PLANS = [
  'public/projects/maison-atelier.json',
  'public/projects/studio-demo.json',
  'tests/fixtures/plan-reference/project.json',
] as const;

const readPlan = (path: string): HouseProject =>
  validateProject(JSON.parse(readFileSync(path, 'utf8')));

/** Varied furniture family: L sofa, cornered wardrobe, shower panel, television, link. */
function planFurnishing(project: HouseProject): VariantBook {
  const levelIds = project.levels.map((level) => level.id);
  const groups = validateFurnitureList([
    createFurniture({ kind: 'sofa', sofa: { shape: 'corner' } }),
    createFurniture({ kind: 'table' }),
    createFurniture({ kind: 'dressing' }),
    createFurniture({ kind: 'shower' }),
    createFurniture({ kind: 'tv' }),
    createFurniture({ kind: 'chair', elevation: 0.45 }),
  ]);
  const linked = groups.slice(0, 2).map((item) => ({ ...item, groupId: 'groupe-lien' }));
  const items = [...linked, ...groups.slice(2)];
  const shifted = items.map((item, index): FurnitureItem => ({
    ...structuredClone(item),
    position: [item.position[0] + 0.31, item.position[1] + 0.17 + index * 0.01],
    rotation: item.rotation + Math.PI / 12,
  }));
  const variant = (list: FurnitureItem[]): LayoutVariant => ({
    id: 'initial',
    name: 'Aménagement initial',
    levels: Object.fromEntries(
      levelIds.map((id, index): [string, FurnitureItem[]] => [id, index % 2 === 0 ? list : []]),
    ),
  });
  const option: LayoutVariant = {
    id: 'option',
    name: 'Option décalée',
    levels: Object.fromEntries(
      levelIds.map((id, index): [string, FurnitureItem[]] => [
        id,
        index % 2 === 1 ? shifted : shifted.slice(0, 3),
      ]),
    ),
  };
  return validateVariantBook(
    { version: 1, activeId: 'initial', variants: [variant(items), option] },
    levelIds,
  );
}

function shareDocument(project: HouseProject, book: VariantBook): ShareDocument {
  return {
    ...project,
    furnishing: {
      version: 1,
      levels: structuredClone(
        book.variants.find((variant) => variant.id === book.activeId)!.levels,
      ),
      variants: book,
    },
  };
}

/** Applies to the original document the identifier renumbering performed by the pack. */
function renumberLikePack(doc: ShareDocument): ShareDocument {
  const clone = structuredClone(doc) as ShareDocument & { levels: HouseProject['levels'] };
  const levelIdMap = new Map<string, string>();
  clone.levels.forEach((level, l) => {
    levelIdMap.set(level.id, `niveau-${l}`);
    level.id = `niveau-${l}`;
    level.walls.forEach((wall, w) => {
      wall.id = `mur-${l}-${w}`;
      (wall.openings ?? []).forEach((opening, i) => {
        opening.id = `ouverture-${l}-${w}-${i}`;
      });
    });
    level.rooms.forEach((room, r) => {
      room.id = `piece-${l}-${r}`;
    });
    (level.stairs ?? []).forEach((stair, s) => {
      stair.id = `escalier-${l}-${s}`;
    });
    level.lights.forEach((light, li) => {
      light.id = `luminaire-${l}-${li}`;
    });
  });
  clone.site?.surfaces?.forEach((surface, s) => {
    surface.id = `surface-${s}`;
  });
  clone.site?.boundaries?.forEach((line, b) => {
    line.id = `cloture-${b}`;
  });
  clone.site?.roofs?.forEach((roof, r) => {
    roof.id = `toit-${r}`;
  });
  if (clone.furnishing) {
    const rename = (items: FurnitureItem[]) => {
      const groups = new Map<string, number>();
      items.forEach((item, index) => {
        if (item.groupId !== undefined && !groups.has(item.groupId))
          groups.set(item.groupId, index);
      });
      items.forEach((item, index) => {
        item.id = `meuble-${index}`;
        item.groupId =
          item.groupId === undefined ? undefined : `groupe-${groups.get(item.groupId)}`;
      });
    };
    Object.values(clone.furnishing.levels).forEach(rename);
    (clone.furnishing.variants as VariantBook).variants.forEach((variant) => {
      Object.values(variant.levels).forEach(rename);
    });
    clone.furnishing.levels = Object.fromEntries(
      Object.entries(clone.furnishing.levels).map(([id, items]) => [
        levelIdMap.get(id) ?? id,
        items,
      ]),
    );
    const book = clone.furnishing.variants as VariantBook;
    book.variants.forEach((variant) => {
      variant.levels = Object.fromEntries(
        Object.entries(variant.levels).map(([id, items]) => [levelIdMap.get(id) ?? id, items]),
      );
    });
  }
  return clone;
}

/**
 * Deep comparison, up to millimetre quantisation: colours become
 * lowercase (the pack normalises), absent booleans count as false or `undefined`.
 */
const NUMERIC_TOLERANCE = 0.006; // > the maximum quantisation error: 0.005 degree of angle
function canonical(value: unknown): unknown {
  if (typeof value === 'string')
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : value;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      if (entry === false && key === 'provisional') continue;
      out[key] = canonical(entry);
    }
    return out;
  }
  return value;
}
function expectDeepEqual(actual: unknown, expected: unknown, path = 'document'): void {
  const a = canonical(actual);
  const b = canonical(expected);
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > NUMERIC_TOLERANCE)
      assert.fail(`${path} : ${a} contre ${b} attendu (quantification près)`);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    assert.equal(a.length, b.length, `${path} : longueur`);
    a.forEach((entry, index) => expectDeepEqual(entry, b[index], `${path}[${index}]`));
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a as object).sort();
    const keysB = Object.keys(b as object).sort();
    assert.deepEqual(keysA, keysB, `${path} : clés`);
    for (const key of keysA)
      expectDeepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
    return;
  }
  assert.deepEqual(a, b, path);
}

test('pack / unpack round trip on both plans: identical project, up to quantisation', async () => {
  for (const plan of PLANS) {
    const project = readPlan(plan);
    const doc = shareDocument(project, planFurnishing(project));
    const hash = await encodeShareLinkHash(doc);
    const decoded = await decodeShareLinkHash(hash);
    // The import pipeline applies to the unpacked document, never short-circuited.
    const validated = validateProject(decoded.document);
    const levelIds = validated.levels.map((level) => level.id);
    const outputBook = validateVariantBook(decoded.document.furnishing?.variants, levelIds);
    for (const variant of outputBook.variants)
      for (const id of levelIds) validateFurnitureList(variant.levels[id]);
    // The link is a projection: generated identifiers become positional.
    expectDeepEqual(decoded.document, renumberLikePack(doc), plan);
    // The same state, repacked, gives back exactly the same canonical bytes.
    const repacked = packShareDocument(decoded.document);
    assert.ok(samePackedState(repacked, decoded.packed), `${plan} : le repack n'est pas stable`);
  }
});

test('a surface vertex lying on the plot edge survives the link', async () => {
  const project = readPlan(PLANS[0]);
  // Slanted plot edge: the vertex is exactly on it, millimetre quantisation
  // rounds it outwards (0.375 mm) and the unpacked project must stay valid.
  project.site!.boundary = [
    [-9, -3],
    [15, -3],
    [15, 15],
    [-9, 13.5],
  ];
  const onEdge: Point2 = [-3.71, 13.830625];
  project.site!.surfaces = [
    {
      id: 'surface-bord',
      kind: 'gravel',
      polygon: [onEdge, [-2, 13.830625], [-2, 12.5], [-3.71, 12.5]],
    },
  ];
  validateProject(project);
  const hash = await encodeShareLinkHash(shareDocument(project, planFurnishing(project)));
  const decoded = await decodeShareLinkHash(hash);
  const unpacked = decoded.document.site!.surfaces![0].polygon[0];
  assert.ok(unpacked[1] > onEdge[1], 'la quantification doit pousser le sommet vers l’extérieur');
  assert.ok(unpacked[1] - onEdge[1] < 0.001, 'l’écart doit rester sous le millimètre');
  validateProject(decoded.document);
});

test('the pack is deterministic: two packs of the same state give the same bytes', () => {
  const project = readPlan(PLANS[0]);
  const doc = shareDocument(project, planFurnishing(project));
  assert.ok(samePackedState(packShareDocument(doc), packShareDocument(doc)));
  const other = shareDocument(readPlan(PLANS[0]), planFurnishing(project));
  other.levels[0].walls[0].thickness += 0.01;
  assert.ok(!samePackedState(packShareDocument(doc), packShareDocument(other)));
});

test('unknown prefix, truncated hash or invalid base64url: readable error, never a blank screen', async () => {
  const project = readPlan(PLANS[0]);
  const hash = await encodeShareLinkHash(shareDocument(project, planFurnishing(project)));
  for (const bad of [
    `#p2:${hash.slice(4)}`,
    '#p1:abc',
    hash.slice(0, Math.max(8, Math.floor(hash.length / 2))),
    '#p1::AAA',
    '#p1:AAAA==',
  ]) {
    await assert.rejects(() => decodeShareLinkHash(bad), ShareLinkError, bad);
  }
  assert.throws(() => unpackShareDocument(new Uint8Array([9, 0])), LinkPackError);
  // ... but a valid hash from another state can still be read:
  await decodeShareLinkHash(hash);
});

test('a truncated or unknown-version pack is rejected on reading', () => {
  const project = readPlan(PLANS[1]);
  const packed = packShareDocument(shareDocument(project, planFurnishing(project)));
  assert.throws(() => unpackShareDocument(new Uint8Array([9, 0])), LinkPackError);
  assert.throws(
    () => unpackShareDocument(packed.subarray(0, packed.length - 7)),
    LinkPackError,
    'la lecture doit consommer exactement tout le fichier',
  );
  const versionFlipped = Uint8Array.from(packed);
  versionFlipped[0] = (versionFlipped[0] % 7) + 2;
  assert.throws(() => unpackShareDocument(versionFlipped), LinkPackError);
});

test('maison-atelier with two levels and 60 pieces: the heaviest link fits under 3 KB', async () => {
  const project = readPlan(PLANS[0]);
  const twoLevels = structuredClone(project);
  const upper = structuredClone(project.levels[0]);
  upper.id = 'atelier-etage';
  upper.name = 'Premier étage';
  upper.elevation = 2.8;
  // Identifiers are unique across all levels: the duplicate renames everything.
  upper.walls.forEach((wall) => {
    wall.id = `${wall.id}-etage`;
    (wall.openings ?? []).forEach((opening) => {
      opening.id = `${opening.id}-etage`;
    });
  });
  upper.rooms.forEach((room) => {
    room.id = `${room.id}-etage`;
  });
  upper.lights.forEach((light) => {
    light.id = `${light.id}-etage`;
  });
  twoLevels.levels.push(upper);
  const kinds: FurnitureItem['kind'][] = [
    'sofa',
    'table',
    'chair',
    'bed',
    'wardrobe',
    'desk',
    'tv',
    'shower',
    'bookcase',
    'cabinet',
  ];
  const make = (n: number) =>
    validateFurnitureList(
      Array.from({ length: n }, (_, i) =>
        createFurniture({
          kind: kinds[i % kinds.length],
          position: [4.2 + (i % 10) * 0.75, 5.1 + Math.floor(i / 10) * 1.1],
          rotation: ((i % 4) * Math.PI) / 6,
        }),
      ),
    );
  const levelIds = twoLevels.levels.map((level) => level.id);
  const initial = make(60);
  const reformatted = initial.map((item, i) => ({
    ...structuredClone(item),
    position: [item.position[0], item.position[1] - 0.3 - (i % 3) * 0.05],
  }));
  const book = validateVariantBook(
    {
      version: 1,
      activeId: 'initial',
      variants: [
        {
          id: 'initial',
          name: 'Aménagement initial',
          levels: { [levelIds[0]]: initial, [levelIds[1]]: [] },
        },
        {
          id: 'option',
          name: 'Option remaniée',
          levels: { [levelIds[0]]: reformatted, [levelIds[1]]: reformatted.slice(0, 30) },
        },
      ],
    },
    levelIds,
  );
  const doc = shareDocument(twoLevels, book);
  const hash = await encodeShareLinkHash(doc);
  assert.ok(hash.length < 3000, `le lien fait ${hash.length} caractères, la cible est 3 Ko`);
  const decoded = await decodeShareLinkHash(hash);
  const validated = validateProject(decoded.document);
  assert.equal(validated.levels.length, twoLevels.levels.length);
  assert.equal(
    Object.values(decoded.document.furnishing!.levels)
      .flat()
      .filter((item) => item.kind === 'sofa').length,
    initial.filter((item) => item.kind === 'sofa').length,
  );
});

test('#116: glazing, leaves, dormers and roof windows survive the round trip', async () => {
  const project = readPlan(PLANS[0]);
  const wall = project.levels[0].walls.find((candidate) => (candidate.openings ?? []).length)!;
  const door = wall.openings!.find((opening) => opening.kind === 'door') ?? wall.openings![0];
  door.kind = 'door';
  door.glazed = true;
  door.leaves = 2;
  const wallIndex = project.levels[0].walls.indexOf(wall);
  project.site = {
    boundary: [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
    elevation: 0,
    notes: [],
    roofs: [
      {
        id: 'toit-x',
        vertices: [
          [0, 0, 0],
          [4, 0, 0],
          [4, 2, 3],
        ],
        faces: [[0, 1, 2]],
        dormers: [
          { id: 'l-a', start: [1, 1], end: [2.5, 1.8], wallId: wall.id, slope: 0.35 },
          { id: 'l-b', start: [3, 1], end: [3.5, 1.8], wallId: wall.id },
        ],
        windows: [{ id: 'f-a', center: [1.5, 2.25], width: 0.78, height: 1.18 }],
      },
    ],
  } as HouseProject['site'];
  const decoded = unpackShareDocument(packShareDocument(project as ShareDocument));
  const openings = decoded.levels[0].walls[wallIndex].openings!;
  const back = openings[wall.openings!.indexOf(door)];
  assert.equal(back.glazed, true);
  assert.equal(back.leaves, 2);
  const roof = decoded.site!.roofs![0];
  const newWallId = `mur-0-${wallIndex}`;
  assert.deepEqual(
    roof.dormers!.map(({ start, end, wallId, slope }) => ({ start, end, wallId, slope })),
    [
      { start: [1, 1], end: [2.5, 1.8], wallId: newWallId, slope: 0.35 },
      { start: [3, 1], end: [3.5, 1.8], wallId: newWallId, slope: undefined },
    ],
  );
  assert.deepEqual(
    roof.windows!.map(({ center, width, height }) => ({ center, width, height })),
    [{ center: [1.5, 2.25], width: 0.78, height: 1.18 }],
  );
  // A link differing only by a dormer is not judged identical.
  const other = structuredClone(project);
  other.site!.roofs![0].dormers!.pop();
  assert.ok(
    !samePackedState(
      packShareDocument(project as ShareDocument),
      packShareDocument(other as ShareDocument),
    ),
  );
});

test('#116 non-regression: an already shared revision-1 link is still readable', async () => {
  // Generated by the packer from before revision 2 (maison-atelier): these bytes are frozen.
  const oldHash = readFileSync('tests/fixtures/share-link-v1-maison-atelier.txt', 'utf8').trim();
  const decoded = await decodeShareLinkHash(oldHash);
  const original = readPlan(PLANS[0]);
  validateProject(decoded.document);
  assert.equal(decoded.document.levels.length, original.levels.length);
  assert.equal(decoded.document.name, original.name);
  for (const level of decoded.document.levels)
    for (const wall of level.walls)
      for (const opening of wall.openings ?? []) {
        assert.equal(opening.glazed, undefined);
        assert.equal(opening.leaves, undefined);
      }
  // Compared with the identical local state: no false divergence between revisions.
  assert.ok(samePackedState(decoded.packed, packShareDocument(original as ShareDocument)));
});

test('shower panel lengths survive the link, and revision-2 links are still read', async () => {
  const project = readPlan(PLANS[0]);
  const levelId = project.levels[0].id;
  const items = validateFurnitureList([
    createFurniture({
      kind: 'shower',
      width: 1.2,
      showerPanels: ['left', 'front'],
      showerPanelSpans: { left: { length: 0.55 }, front: { length: 0.8, from: 'right' } },
    }),
    createFurniture({ kind: 'shower', showerPanels: ['back'] }),
  ]);
  const book = validateVariantBook(
    {
      version: 1,
      activeId: 'initial',
      variants: [{ id: 'initial', name: 'Initial', levels: { [levelId]: items } }],
    },
    project.levels.map((level) => level.id),
  );
  const decoded = await decodeShareLinkHash(
    await encodeShareLinkHash(shareDocument(project, book)),
  );
  const [partial, whole] = validateFurnitureList(
    Object.values(decoded.document.furnishing!.levels)[0],
  );
  assert.deepEqual(partial.showerPanelSpans, {
    left: { length: 0.55 },
    front: { length: 0.8, from: 'right' },
  });
  assert.equal(whole.showerPanelSpans, undefined);

  // Bytes frozen from the packer before revision 3 (no span field at all).
  const old = await decodeShareLinkHash(
    readFileSync('tests/fixtures/share-link-v2-shower.txt', 'utf8').trim(),
  );
  validateProject(old.document);
  const [shower] = validateFurnitureList(Object.values(old.document.furnishing!.levels)[0]);
  assert.deepEqual(shower.showerPanels, ['left', 'front']);
  assert.equal(shower.showerPanelSpans, undefined);
});

test('#125: a link altered by one character never decodes into another project', async () => {
  const project = readPlan(PLANS[0]);
  const doc = shareDocument(project, planFurnishing(project));
  const hash = await encodeShareLinkHash(doc);
  const original = (await decodeShareLinkHash(hash)).packed;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const start = '#p1:'.length;
  // Deterministic generator: the run is reproducible.
  let seed = 12345;
  const next = (bound: number) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed % bound;
  };
  let refused = 0;
  for (let i = 0; i < 1500; i++) {
    const at = start + next(hash.length - start);
    const replacement = alphabet[next(alphabet.length)];
    if (replacement === hash[at]) continue;
    const altered = hash.slice(0, at) + replacement + hash.slice(at + 1);
    try {
      const decoded = await decodeShareLinkHash(altered);
      // Same bytes (an unused trailing bit) is the same project: harmless.
      assert.ok(samePackedState(decoded.packed, original), `altered link ${at} decoded elsewhere`);
    } catch (error) {
      if (!(error instanceof ShareLinkError)) throw error;
      refused++;
    }
  }
  assert.ok(refused > 1400, `only ${refused} refused`);
});

test('the pack closes with a CRC-32 that detects any flipped byte', () => {
  const project = readPlan(PLANS[1]);
  const packed = packShareDocument(shareDocument(project, planFurnishing(project)));
  assert.equal(crc32(new Uint8Array([49, 50, 51, 52, 53, 54, 55, 56, 57])), 0xcbf43926);
  assert.doesNotThrow(() => unpackShareDocument(packed));
  for (const index of [1, Math.floor(packed.length / 2), packed.length - 5, packed.length - 1]) {
    const damaged = Uint8Array.from(packed);
    damaged[index] ^= 0x01;
    assert.throws(() => unpackShareDocument(damaged), LinkPackError, `byte ${index}`);
  }
});

test('kitchen runs, finishes, wall units and equipment survive a share link', async () => {
  const project = readPlan('public/projects/studio-demo.json');
  const kitchen = createFurniture({
    kind: 'kitchen',
    kitchen: {
      runDepth: 0.65,
      runs: [{ length: 3.2, turn: 'right' }, { length: 2.1 }],
      worktopColor: '#987654',
      worktopHeight: 0.92,
      wallUnits: { bottom: 1.4, height: 0.7, depth: 0.35 },
      slots: [{ run: 1, offset: 0.8, width: 0.6, kind: 'sink' }],
    },
  });
  const variants: VariantBook = {
    version: 1,
    activeId: 'k',
    variants: [
      {
        id: 'k',
        name: 'Cuisine',
        levels: Object.fromEntries(project.levels.map((l) => [l.id, [kitchen]])),
      },
    ],
  };
  const exported = JSON.parse(JSON.stringify(shareDocument(project, variants)));
  validateProject(exported);
  const imported = validateVariantBook(
    exported.furnishing.variants,
    project.levels.map((l) => l.id),
  );
  assert.deepEqual(imported.variants[0].levels[project.levels[0].id][0].kitchen, kitchen.kitchen);
  const hash = await encodeShareLinkHash(shareDocument(project, variants));
  const restored = await decodeShareLinkHash(hash);
  assert.deepEqual(
    validateVariantBook(
      restored.document.furnishing!.variants,
      restored.document.levels.map((l) => l.id),
    ).variants[0].levels[restored.document.levels[0].id][0].kitchen,
    kitchen.kitchen,
  );
});

test('microwave choices survive kitchen export and share links', async () => {
  const project = readPlan('public/projects/studio-demo.json');
  for (const microwave of [undefined, false, true]) {
    const kitchen = createFurniture({
      kind: 'kitchen',
      kitchen: {
        slots: [
          {
            kind: 'oven',
            run: 0,
            offset: 0,
            width: 0.6,
            ...(microwave === undefined ? {} : { microwave }),
          },
        ],
      },
    });
    const book: VariantBook = {
      version: 1,
      activeId: 'initial',
      variants: [
        {
          id: 'initial',
          name: 'Cuisine',
          levels: Object.fromEntries(project.levels.map((l) => [l.id, [kitchen]])),
        },
      ],
    };
    const imported = JSON.parse(JSON.stringify(shareDocument(project, book)));
    assert.deepEqual(
      validateFurnitureList(imported.furnishing.levels[project.levels[0].id])[0].kitchen,
      kitchen.kitchen,
    );
    const restored = await decodeShareLinkHash(await encodeShareLinkHash(imported));
    const outputBook = validateVariantBook(
      restored.document.furnishing!.variants,
      restored.document.levels.map((l) => l.id),
    );
    assert.deepEqual(
      outputBook.variants[0].levels[restored.document.levels[0].id][0].kitchen,
      kitchen.kitchen,
    );
  }
});

test('an already shared revision-6 kitchen has no microwave added implicitly', async () => {
  const decoded = await decodeShareLinkHash(
    '#p1:VZFBaBNBFIbfbLeJ1TYUrfbYh7bYFhqkB9FLQdp6UFGxeJBSYbrzoiPZne3OrIRAYI_BqyCtJ4-J5JBDQI_BvXjMocoeKpaeqiLqzaNMEhHf8DPz5uPN_4aXG3dOaRMLqZYE-cotrKVNXwXaRNxIFeQubfQhCkLxH8F3b9BXIm2UCWUg0mZIgeCBOTGzXiE_LJMtCSP1hAyGPOJ-2jSR3IkJRpyTD1cJB65Ykp6RJfRVYCLCnZiwTOgrQ3GE3PMoNIRxQMhjyx-lTTV4iVDzQNsWZEl6g5ZEjJ4SVBzfuUV6aK5Rq8Cg9EMVGb5dJo1kkCr_Uh5jSUU-N3hj487tIt4P8O7adRRKGhRHyR7fVpHA9LX1NxEPtBdZYt09GpYW2ZdPaZ79-Jbmgf36_jnPCpP3qLokaMl7zGOt0ybB7qILkNQgqR1uweFWDlpOUms5mQsOY9nl-sXGFKsXwMZ-teXsVzublgF0NpPa4Myc7kp3rn0ewN63HLuGBI6v1gvHOCAHs5l7MNtZeM8AIHM7C38TBvVCd_znTN8FnMmJdR1yrz-sp5Ig153L3EbFqv4gc612F7tzu4vJzVdXrADg9MQGL9v5HiV7xGPHzdzM_X3Bqjefub35xtTbaauBha1iNmXdld613tcRYFN5GUgjeflcfjWWWgbEzp5Jlttj_Y-x9hiDZLleOHr5cRQYQHvMgWE8S1-M2n26-OH5Hw',
  );
  const book = validateVariantBook(
    decoded.document.furnishing!.variants,
    decoded.document.levels.map((l) => l.id),
  );
  const slots = book.variants[0].levels[decoded.document.levels[0].id][0].kitchen!.slots;
  assert.deepEqual(slots, [{ kind: 'oven', run: 0, offset: 0, width: 0.6 }]);
});

test('#259: terraces, lawn, garden walls, fences and hedges survive a share link', async () => {
  const project = readPlan(PLANS[0]);
  project.site!.surfaces = [
    ...project.site!.surfaces!,
    {
      id: 'terrasse',
      kind: 'terrace',
      height: 0.15,
      polygon: [
        [0.5, 12],
        [5.5, 12],
        [5.5, 14],
        [0.5, 14],
      ],
    },
    {
      id: 'pelouse',
      kind: 'lawn',
      polygon: [
        [-8, -2],
        [-2, -2],
        [-2, 3],
        [-8, 3],
      ],
    },
  ];
  project.site!.boundaries = [
    {
      id: 'mur',
      kind: 'wall',
      height: 1.8,
      points: [
        [-9, 14.9],
        [15, 14.9],
      ],
    },
    {
      id: 'cloture',
      kind: 'fence',
      height: 1.2,
      points: [
        [14.98, -3],
        [14.98, 14.8],
      ],
    },
    {
      id: 'portillon',
      kind: 'gate',
      height: 1.4,
      infill: 'slats',
      points: [
        [-9, 4],
        [-9, 5],
      ],
    },
    {
      id: 'haie',
      kind: 'hedge',
      height: 1.5,
      thickness: 0.8,
      points: [
        [-9, -2.6],
        [5, -2.6],
        [5, -1],
      ],
    },
  ];
  validateProject(project);
  const doc = shareDocument(project, planFurnishing(project));
  const decoded = await decodeShareLinkHash(await encodeShareLinkHash(doc));
  validateProject(decoded.document);
  expectDeepEqual(decoded.document, renumberLikePack(doc), 'garden');
  assert.equal(decoded.document.site!.surfaces![2].height, 0.15);
  assert.equal(decoded.document.site!.boundaries![3].thickness, 0.8);
  assert.equal(decoded.document.site!.boundaries![2].kind, 'gate');
  assert.equal(decoded.document.site!.boundaries![2].infill, 'slats');
  assert.equal(decoded.document.site!.boundaries![1].thickness, undefined);
});
