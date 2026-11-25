import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { setAttribute, setDisabled, setHidden, setText, setTitle } from '../src/ui/domWrites';

test('an unchanged value is not written again; a changed one is', async () => {
  const window = new Window();
  window.document.body.innerHTML = '<button id="b">a</button>';
  const button = window.document.querySelector('#b') as unknown as HTMLButtonElement;
  const records: unknown[] = [];
  const observer = new window.MutationObserver((list) => records.push(...list));
  observer.observe(window.document.body, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  setText(button, 'a');
  setHidden(button, false);
  setDisabled(button, false);
  setTitle(button, '');
  setAttribute(button, 'id', 'b');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(records.length, 0);
  setText(button, 'b');
  setHidden(button, true);
  setDisabled(button, true);
  setTitle(button, 't');
  await new Promise((resolve) => setTimeout(resolve, 0));
  observer.disconnect();
  assert.ok(records.length >= 4);
  assert.equal(button.textContent, 'b');
  assert.equal(button.hidden, true);
  assert.equal(button.disabled, true);
  assert.equal(button.title, 't');
});
