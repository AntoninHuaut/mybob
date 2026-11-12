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

test('tool buttons stay in the floating column', () => {
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

test('the start card lives in the scene and help stays reachable from the sidebar', () => {
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

test('the frame-rate counter lives in the scene footer and waits for its first measurement', () => {
  const document = render();
  const counter = document.querySelector('#frame-rate');
  assert.ok(counter, 'le compteur existe');
  assert.ok(
    document.querySelector('.bottom-controls')!.contains(counter),
    'il reste dans le pied de la scène, hors du chemin de la caméra',
  );
  assert.ok(counter.hasAttribute('hidden'), 'il n’affiche rien avant la première mesure');
});

test('the software-rendering notice sits next to the frame rate and stays hidden by default', () => {
  const document = render();
  const notice = document.querySelector('#software-render');
  assert.ok(notice, 'la mention existe');
  assert.ok(
    document.querySelector('.bottom-meta')!.contains(notice),
    'elle est lue là où se lit la cadence',
  );
  assert.ok(notice.hasAttribute('hidden'), 'une machine avec carte graphique ne la voit jamais');
});

test('the headset button waits for a supporting browser before showing', () => {
  const document = render();
  const button = document.querySelector('#enter-immersive');
  assert.ok(button, 'le bouton casque existe');
  assert.equal(button.hasAttribute('hidden'), true);
  assert.equal(button.closest('.view-switch') !== null, true);
});
