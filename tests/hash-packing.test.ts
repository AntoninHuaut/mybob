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
import type { HouseProject } from '../src/model/types';
import {
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
 * Les deux plans de test du dépôt : le gabarit maison-atelier et le plan converti.
 * Le lien de partage est une projection de transport : pack → deflate-raw → base64url.
 */
const PLANS = [
  'public/projects/maison-atelier.json',
  'public/projects/studio-demo.json',
  'tests/fixtures/plan-reference/project.json',
] as const;

const readPlan = (path: string): HouseProject =>
  validateProject(JSON.parse(readFileSync(path, 'utf8')));

/** Famille de meubles variée : canapé en L, dressing à angles, douche paroi, téléviseur, liaison. */
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

/** Applique au document d'origine la renumérotation des identifiants opérée par le pack. */
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
 * Comparaison profonde, quantification millimétrique près : les couleurs passent en
 * minuscules (le pack normalise), les booléens absents valent faux ou `undefined`.
 */
const NUMERIC_TOLERANCE = 0.006; // > l'erreur max de quantification : 0,005 degré d'angle
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

test('aller-retour pack / déballage sur les deux plans : projet identique, quantification près', async () => {
  for (const plan of PLANS) {
    const project = readPlan(plan);
    const doc = shareDocument(project, planFurnishing(project));
    const hash = await encodeShareLinkHash(doc);
    const decoded = await decodeShareLinkHash(hash);
    // Le pipeline de l'import s'applique au document déballé, jamais court-circuité.
    const validated = validateProject(decoded.document);
    const levelIds = validated.levels.map((level) => level.id);
    const outputBook = validateVariantBook(decoded.document.furnishing?.variants, levelIds);
    for (const variant of outputBook.variants)
      for (const id of levelIds) validateFurnitureList(variant.levels[id]);
    // Le lien est une projection : les identifiants générés deviennent positionnels.
    expectDeepEqual(decoded.document, renumberLikePack(doc), plan);
    // Le même état, repacké, redonne exactement les mêmes octets canoniques.
    const repacked = packShareDocument(decoded.document);
    assert.ok(samePackedState(repacked, decoded.packed), `${plan} : le repack n'est pas stable`);
  }
});

test('le pack est déterministe : deux packs du même état donnent les mêmes octets', () => {
  const project = readPlan(PLANS[0]);
  const doc = shareDocument(project, planFurnishing(project));
  assert.ok(samePackedState(packShareDocument(doc), packShareDocument(doc)));
  const other = shareDocument(readPlan(PLANS[0]), planFurnishing(project));
  other.levels[0].walls[0].thickness += 0.01;
  assert.ok(!samePackedState(packShareDocument(doc), packShareDocument(other)));
});

test('préfixe inconnu, hash tronqué ou base64url invalide : erreur lisible, jamais d’écran vide', async () => {
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
  // ... mais un hash valide issu d'un autre état sait encore se relire :
  await decodeShareLinkHash(hash);
});

test('un pack tronqué ou de version inconnue est rejeté par la lecture', () => {
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

test('maison-atelier à deux niveaux et 60 meubles : le lien le plus chargé tient sous 3 Ko', async () => {
  const project = readPlan(PLANS[0]);
  const twoLevels = structuredClone(project);
  const upper = structuredClone(project.levels[0]);
  upper.id = 'atelier-etage';
  upper.name = 'Premier étage';
  upper.elevation = 2.8;
  // Les identifiants sont uniques à travers tous les niveaux : le duplicata renomme tout.
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
