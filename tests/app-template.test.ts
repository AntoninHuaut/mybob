import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { Window } from 'happy-dom';

registerHooks({
  load(url, context, nextLoad) {
    if (/\.(css|png|svg)$/.test(url))
      return { format: 'module', source: 'export default "";', shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { appTemplate } = await import('../src/ui/appTemplate');

function render() {
  const window = new Window({ url: 'http://localhost' });
  window.document.body.innerHTML = appTemplate();
  return window.document;
}

test('les boutons d’outil restent dans la colonne flottante', () => {
  const document = render();
  const tools = document.querySelector('.floating-tools');
  assert.ok(tools, 'la colonne d’outils existe');
  const stray = [...document.querySelectorAll('#viewport .tool-button')].filter(
    (button) => !tools.contains(button),
  );
  assert.deepEqual(
    stray.map((button) => button.id),
    [],
    'un bouton d’outil hors colonne se place au coin du viewport et masque le titre',
  );
  assert.ok(tools.contains(document.querySelector('#tool-plan-photo')!));
});

test('le panneau de photo de plan garde ses actions groupées', () => {
  const document = render();
  const panel = document.querySelector('#plan-photo-panel');
  assert.ok(panel, 'le panneau existe');
  assert.equal(panel.parentElement?.id, 'viewport');
  const actions = panel.querySelector('.plan-photo-actions');
  assert.ok(actions, 'les actions sont groupées');
  assert.deepEqual(
    [...actions.querySelectorAll('button')].map((button) => button.id),
    ['plan-photo-change', 'plan-photo-remove'],
  );
});
