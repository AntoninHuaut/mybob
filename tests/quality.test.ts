import assert from 'node:assert/strict';
import test from 'node:test';
import { forDevice, parseQuality, qualityFieldHtml, qualityNote } from '../src/ui/quality';

const none = { renderScale: null, navigation: null };

test('an unreadable or foreign saved value means automatic, nothing detected', () => {
  for (const raw of [null, '', 'pas du json', '[]', 'null', '{"quality":"ultra"}'])
    assert.deepEqual(parseQuality(raw, none), { quality: 'auto', detected: {} }, String(raw));
});

test('the quality, the device and where each view stood are read back', () => {
  const raw = JSON.stringify({
    quality: 'medium',
    device: 'ANGLE (Intel)',
    detected: {
      walk: { scale: 0.8, tier: 1 },
      plan: { scale: 9, tier: 0 },
      x: { scale: 1, tier: 0 },
    },
  });
  assert.deepEqual(parseQuality(raw, none), {
    quality: 'medium',
    device: 'ANGLE (Intel)',
    detected: { walk: { scale: 0.8, tier: 1 } },
  });
});

test('the old resolution and occlusion settings migrate to the closest quality', () => {
  const legacy = (fixed?: number, occlusion?: boolean) => ({
    renderScale: JSON.stringify({ fixed, detected: { walk: 0.8, overview: 1.25 } }),
    navigation: JSON.stringify({ speed: 2, occlusion }),
  });
  const auto = parseQuality(null, legacy());
  assert.equal(auto.quality, 'auto');
  assert.deepEqual(auto.detected, {
    walk: { scale: 0.8, tier: 0 },
    overview: { scale: 1.25, tier: 0 },
  });
  assert.equal(parseQuality(null, legacy(1.2)).quality, 'high', 'a sharp pin is « Haute »');
  assert.equal(parseQuality(null, legacy(1)).quality, 'high');
  assert.equal(parseQuality(null, legacy(0.8)).quality, 'medium', 'a softer pin is « Moyenne »');
  assert.equal(parseQuality(null, legacy(undefined, false)).quality, 'low', 'no occlusion');
  assert.equal(parseQuality(null, legacy(1.2, false)).quality, 'low');
  const saved = JSON.stringify({ quality: 'high', detected: {} });
  assert.equal(parseQuality(saved, legacy(0.8, false)).quality, 'high', 'the new key wins');
});

test('what a view reached on another GPU is not a start for this one', () => {
  const settings = {
    quality: 'auto' as const,
    device: 'A',
    detected: { walk: { scale: 0.67, tier: 2 } },
  };
  assert.deepEqual(forDevice(settings, 'A'), settings);
  assert.deepEqual(forDevice(settings, 'B'), { quality: 'auto', device: 'B', detected: {} });
  assert.deepEqual(forDevice({ quality: 'low', detected: { walk: { scale: 1, tier: 0 } } }, 'B'), {
    quality: 'low',
    device: 'B',
    detected: { walk: { scale: 1, tier: 0 } },
  });
});

test('one « Qualité » select offers automatic, high, medium and low', () => {
  const html = qualityFieldHtml();
  assert.match(html, /<label class="header-quality"><span>Qualité<\/span><select id="quality">/);
  for (const [value, label] of [
    ['auto', 'Automatique'],
    ['high', 'Haute'],
    ['medium', 'Moyenne'],
    ['low', 'Basse'],
  ])
    assert.match(html, new RegExp(`<option value="${value}">${label}</option>`));
});

test('the note says resolution goes before effects, and what automatic found here', () => {
  const auto = qualityNote({ quality: 'auto', detected: {} }, 1);
  assert.match(auto, /d’abord la résolution, jusqu’à 67 %/);
  assert.match(auto, /puis les ombres des angles/);
  assert.match(qualityNote({ quality: 'auto', detected: {} }, 1.25), /jusqu’à 125 % sur cet écran/);
  const found = qualityNote(
    { quality: 'auto', detected: { walk: { scale: 0.67, tier: 1 }, plan: { scale: 1, tier: 0 } } },
    1,
  );
  assert.match(found, /Visite 67 % sans ombres des angles/);
  assert.match(found, /Plan 100 %/);
  assert.match(
    qualityNote({ quality: 'high', detected: {} }, 1),
    /tous les effets, jamais sous 100 %/,
  );
  assert.match(qualityNote({ quality: 'medium', detected: {} }, 1), /67 %/);
  assert.match(qualityNote({ quality: 'low', detected: {} }, 1), /sans halo/);
});
