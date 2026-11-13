import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

registerHooks({
  load(url, context, nextLoad) {
    if (/\.(css|png|svg)$/.test(url))
      return { format: 'module', source: 'export default "";', shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { fullHelpHtml, shortHelpHtml, startCardHtml } = await import('../src/ui/firstSteps');
const { ONBOARDING_VERSION, parseOnboarding, serializeOnboarding, shouldShowStartCard } =
  await import('../src/ui/onboarding');

test('an absent, unreadable or other-version state starts from scratch', () => {
  for (const raw of [null, '', 'pas du json', '[]', 'null', '{"version":0,"cardSeen":true}']) {
    const state = parseOnboarding(raw);
    assert.equal(state.version, ONBOARDING_VERSION, `${raw} garde la version courante`);
    assert.equal(state.cardSeen, false, `${raw} ne masque pas la carte`);
  }
});

test('a card seen once stays seen after reload', () => {
  const saved = serializeOnboarding({
    version: ONBOARDING_VERSION,
    cardSeen: true,
    walkGuideSeen: false,
  });
  const state = parseOnboarding(saved);
  assert.equal(state.cardSeen, true);
  assert.equal(shouldShowStartCard(state), false);
  assert.equal(shouldShowStartCard(parseOnboarding(null)), true);
});

test('the Visite welcome, once shown, stays dismissed after reload', () => {
  assert.equal(parseOnboarding(null).walkGuideSeen, false);
  // A state saved before the flag existed still shows the welcome once.
  assert.equal(
    parseOnboarding(`{"version":${ONBOARDING_VERSION},"cardSeen":true}`).walkGuideSeen,
    false,
  );
  const saved = serializeOnboarding({
    version: ONBOARDING_VERSION,
    cardSeen: false,
    walkGuideSeen: true,
  });
  assert.equal(parseOnboarding(saved).walkGuideSeen, true);
});

test('the start card offers three real actions and stays hidden by default', () => {
  const html = startCardHtml();
  const actions = [...html.matchAll(/data-start-action="([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(actions, ['orbit', 'plan', 'walk']);
  assert.match(html, /id="start-card"[^>]*hidden/, 'la carte ne s’affiche pas avant le chargement');
  assert.doesNotMatch(html, /<dialog/, 'aucun voile ni fenêtre modale au chargement');
  assert.doesNotMatch(html, /Passer/, 'il n’y a rien à passer : la scène reste utilisable');
});

test('the short help fits in three gestures and keeps the detailed text reachable', () => {
  const short = shortHelpHtml();
  assert.equal([...short.matchAll(/<li>/g)].length, 3);
  assert.match(short, /id="show-full-help"/);
  const full = fullHelpHtml();
  for (const kept of ['Mesures', 'Importer votre maison', 'Ctrl Z', 'Alt', 'Affichage des murs']) {
    assert.ok(full.includes(kept), `l’aide complète conserve « ${kept} »`);
  }
  assert.ok(
    full.length > short.length * 2,
    'le texte détaillé reste disponible derrière « Tout voir »',
  );
  assert.equal(
    [...full.matchAll(/<h3>/g)].length,
    7,
    'les cinq cartes et les deux sections détaillées sont conservées',
  );
});
