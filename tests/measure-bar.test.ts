import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { Window, HTMLElement as DOMElement, type Event as DOMEvent, MouseEvent } from 'happy-dom';

registerHooks({
  load(url, context, next) {
    return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url);
  },
});
const { MeasureBar } = await import('../src/ui/measureBar');

function setup() {
  const window = new Window({ url: 'http://localhost' });
  const document = window.document;
  document.body.innerHTML = `<div id="app"><div id="measure-instructions" hidden><img class="measure-bob"><span>Cliquez sur deux points du sol.</span><button id="end-measure"></button></div><div id="measure-label" class="measurement-label" hidden></div><button id="clear-measures" hidden></button></div>`;
  const bar = new MeasureBar(document);
  for (const id of ['end-measure', 'clear-measures'])
    document.getElementById(id)!.addEventListener('click', (event) => {
      event.preventDefault();
      (event.currentTarget as import('happy-dom').HTMLElement).dataset.clicked = '1';
    });
  const q = <T extends DOMElement = DOMElement>(selector: string) =>
    document.querySelector(selector) as unknown as T;
  return { document, bar, q };
}

test('the bar follows the mode, the preview and the confirmation', () => {
  const { bar, q } = setup();
  bar.setActive(true);
  assert.equal(q('#measure-instructions').hidden, false);
  bar.resetPrompt();
  assert.match(q('#measure-instructions span').textContent!, /Cliquez sur deux points du sol/);
  bar.sync({ a: [0, 0], preview: true });
  assert.equal(q('#measure-label').hidden, true);
  assert.equal(q('#clear-measures').hidden, true);
  assert.match(q('#measure-instructions span').textContent!, /Déplacez le pointeur/);
  bar.sync({ a: [0, 0], b: [2, 0], distance: 2, preview: true });
  assert.equal(q('#measure-label').hidden, false);
  assert.equal(q('#measure-label').textContent, '2,00 m');
  assert.match(q('#measure-instructions span').textContent!, /Cliquez pour confirmer/);
  bar.sync({ a: [0, 0], b: [2, 0], distance: 2, aligned: true });
  assert.equal(q('#measure-label').textContent, '2,00 m · droit');
  assert.equal(q('#clear-measures').hidden, false);
  bar.hide();
  assert.equal(q('#measure-instructions').hidden, true);
  assert.equal(q('#measure-label').hidden, true);
});

test('the label follows the screen and buttons go through the callbacks', () => {
  const { bar, q } = setup();
  bar.moveTo({ x: 12.5, y: 40, visible: true });
  const label = q('#measure-label');
  assert.equal(label.style.left, '12.5px');
  assert.equal(label.style.top, '40px');
  assert.equal(label.hidden, false);
  let cleared = 0;
  let ended = 0;
  bar.wire({
    onEnd: () => {
      ended++;
    },
    onClear: () => {
      cleared++;
      return true;
    },
  });
  q('#end-measure').dispatchEvent(
    new MouseEvent('click', { bubbles: true }) as unknown as DOMEvent,
  );
  q('#clear-measures').dispatchEvent(
    new MouseEvent('click', { bubbles: true }) as unknown as DOMEvent,
  );
  assert.equal(ended, 1);
  assert.equal(cleared, 1);
  assert.equal(q('#clear-measures').hidden, true);
});
