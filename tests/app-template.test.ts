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
});

test('la carte de démarrage vit dans la scène et l’aide reste joignable depuis la barre latérale', () => {
  const document = render();
  const card = document.querySelector('#start-card');
  assert.ok(card, 'la carte de démarrage existe');
  assert.ok(
    document.querySelector('#viewport')!.contains(card),
    'la carte est posée dans la scène',
  );
  assert.ok(card.hasAttribute('hidden'), 'elle attend le chargement avant de s’afficher');
  assert.ok(document.querySelector('#first-steps'), 'l’entrée Premiers pas reste dans la barre');
  assert.ok(document.querySelector('#help'), 'l’aide de l’en-tête reste disponible');
});
