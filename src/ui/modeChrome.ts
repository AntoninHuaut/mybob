import type { ViewMode } from '../scene/viewer';

/** Header and help texts per mode: pure, no DOM nor camera. */
export function modeTitle(
  mode: ViewMode,
  eyeHeightLabel: string,
): readonly [string, string, string] {
  const titles = {
    overview: ['VOTRE MAISON, EN PERSPECTIVE', 'Vue 3D', 'Explorez les volumes, à votre rythme.'],
    plan: [
      'LES VOLUMES, À L\u2019ÉCHELLE',
      'Plan de la maison',
      'Retrouvez la disposition et les proportions des pièces.',
    ],
    walk: ['À HAUTEUR DE REGARD', 'Visite intérieure', `Une visite à ${eyeHeightLabel} m du sol.`],
  } as const;
  return titles[mode];
}

/** Keyboard/mouse help shown at the bottom of the scene; icons are provided SVGs. */
export function desktopHint(
  mode: ViewMode,
  icons: { mouseLeft: string; mouseRight: string; mouseWheel: string },
): string {
  if (mode === 'walk')
    return `<kbd>ZQSD</kbd><span>ou flèches</span><i></i><kbd>E</kbd><span>Portes, escaliers</span><i></i><kbd>Échap</kbd><span>Libérer la souris</span>`;
  if (mode === 'plan')
    return `<kbd>ZQSD</kbd><span>Déplacer la vue · Maj pour accélérer</span><i></i>${icons.mouseLeft}<span>Glisser pour déplacer</span><i></i>${icons.mouseWheel}<span>Molette pour zoomer</span>`;
  return `<kbd>ZQSD</kbd><span>Déplacer la vue</span><i></i>${icons.mouseLeft}<span>Glisser gauche pour tourner</span><i></i>${icons.mouseRight}<span>Glisser droit pour déplacer</span><i></i>${icons.mouseWheel}<span>Molette pour zoomer</span>`;
}

export function touchHint(mode: ViewMode): string {
  return mode === 'plan'
    ? 'Glisser pour déplacer · Pincer pour zoomer'
    : mode === 'walk'
      ? 'Glisser pour regarder · Clavier pour marcher'
      : 'Glisser pour tourner · Deux doigts pour déplacer ou zoomer';
}
