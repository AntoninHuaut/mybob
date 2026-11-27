import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { BROWSER_ADVICE_STORAGE, adviseChromium, isFirefox } from '../src/ui/browserAdvice';

const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36';
const EDGE = `${CHROME} Edg/158.0.0.0`;

test('only Firefox counts as Firefox', () => {
  assert.equal(isFirefox(FIREFOX), true);
  assert.equal(isFirefox(CHROME), false);
  assert.equal(isFirefox(EDGE), false);
});

function withDocument(run: (window: Window) => Promise<void>): Promise<void> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const window = new Window();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  return run(window).finally(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  });
}

test('Firefox gets the advice once, and closing it remembers the choice', () =>
  withDocument(async (window) => {
    const storage = window.localStorage;
    const shown = adviseChromium(FIREFOX, storage);
    const dialog = window.document.querySelector('dialog')!;
    assert.equal(dialog.open, true);
    assert.match(dialog.textContent!, /Chrome/);
    assert.match(dialog.textContent!, /Edge/);
    dialog.close();
    await shown;
    assert.equal(window.document.querySelector('dialog'), null);
    assert.ok(storage.getItem(BROWSER_ADVICE_STORAGE));
    await adviseChromium(FIREFOX, storage);
    assert.equal(window.document.querySelector('dialog'), null);
  }));

test('Chrome and Edge never see the advice', () =>
  withDocument(async (window) => {
    await adviseChromium(CHROME, window.localStorage);
    await adviseChromium(EDGE, window.localStorage);
    assert.equal(window.document.querySelector('dialog'), null);
  }));
