import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRenderScale, renderScaleFieldHtml, renderScaleNote } from '../src/ui/renderScale';

test('an unreadable or foreign saved value means automatic, nothing detected', () => {
  for (const raw of [null, '', 'pas du json', '[]', 'null', '{"fixed":3,"detected":{"walk":9}}'])
    assert.deepEqual(parseRenderScale(raw), { detected: {} }, String(raw));
});

test('a pinned scale and the scales detected per view are read back', () => {
  assert.deepEqual(parseRenderScale('{"fixed":1.2,"detected":{"walk":1.3,"plan":1.5,"x":1}}'), {
    fixed: 1.2,
    detected: { walk: 1.3, plan: 1.5 },
  });
});

test('the field offers automatic and every scale from 67 % to 150 %', () => {
  const html = renderScaleFieldHtml();
  assert.match(html, /<option value="auto">Automatique<\/option>/);
  assert.match(html, /value="0.67">67 %/);
  assert.match(html, /value="1.5">150 %/);
});

test('the note says what automatic found, or that a pinned scale no longer adapts', () => {
  assert.match(renderScaleNote({ detected: { walk: 1.3 } }), /Visite 130 %/);
  assert.match(renderScaleNote({ fixed: 0.8, detected: {} }), /Fixée à 80 %/);
});
