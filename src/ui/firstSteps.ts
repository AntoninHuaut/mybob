import bobPlan from '../assets/brand/bob-plan.png';
import { icon } from './icons';

/**
 * Start card: three real actions, no overlay nor "Skip" button.
 * It is hidden by default and covers neither the scene nor the controls.
 */
export function startCardHtml(): string {
  return `
  <aside class="start-card" id="start-card" aria-labelledby="start-card-title" hidden>
    <div class="start-card-heading"><span class="eyebrow">PREMIERS PAS</span><button type="button" id="close-start-card" class="icon-button" aria-label="Masquer les premiers pas">${icon('close', 16)}</button></div>
    <h2 id="start-card-title">Trois gestes pour commencer.</h2>
    <div class="start-card-actions">
      <button type="button" data-start-action="orbit">${icon('cube', 19)}<span><strong>Tourner autour de la maison</strong><small>Glissez avec le bouton gauche, ou cliquez ici.</small></span></button>
      <button type="button" data-start-action="plan">${icon('plan', 19)}<span><strong>Voir le plan</strong><small>Les pièces, à l’échelle.</small></span></button>
      <button type="button" data-start-action="walk">${icon('walk', 19)}<span><strong>Entrer dans la visite</strong><small>ZQSD pour marcher, souris pour regarder.</small></span></button>
    </div>
  </aside>`;
}

/** Short help: three gestures, the rest behind « Tout voir ». */
export function shortHelpHtml(): string {
  return `<div class="bob-help"><img src="${bobPlan}" alt=""><div><h2>Faites comme chez vous.</h2><p>Moi, c’est Bob. Trois gestes suffisent pour commencer.</p></div></div><ul class="first-steps-list"><li>${icon('cube', 20)}<div><strong>Tourner</strong><p>Glissez avec le bouton gauche. Molette pour zoomer.</p></div></li><li>${icon('walk', 20)}<div><strong>Visiter</strong><p>Ouvrez Visite, puis ZQSD pour marcher. Échap libère la souris.</p></div></li><li>${icon('layers', 20)}<div><strong>Aménager</strong><p>Onglet Meubles, Ajouter un meuble, puis glissez-le dans la scène.</p></div></li></ul><button type="button" class="text-button" id="show-full-help">Tout voir : mesures, portes, import, raccourcis${icon('chevron', 15)}</button>`;
}

/** Full help: the detailed text, reached from the short help. Nothing is removed. */
export function fullHelpHtml(): string {
  return `<div class="bob-help"><img src="${bobPlan}" alt=""><div><h2>Faites comme chez vous.</h2><p>Moi, c’est Bob. Voici quelques repères pour explorer et aménager votre maison.</p></div></div><div class="help-grid"><div>${icon('cube', 24)}<h3>Vue 3D</h3><p>ZQSD ou WASD pour déplacer la vue, Maj pour accélérer. Glissez avec le bouton gauche pour tourner, le bouton droit pour déplacer ; utilisez la molette pour zoomer. Les flèches déplacent aussi la vue quand aucun meuble n’est sélectionné.</p></div><div>${icon('walk', 24)}<h3>Visite</h3><p>ZQSD, WASD ou flèches pour marcher. Souris pour regarder, Maj pour accélérer, E pour ouvrir une porte, F pour modifier le meuble visé. Échap libère la souris.</p></div><div>${icon('ruler', 24)}<h3>Mesures</h3><p>Activez Mesurer, puis cliquez sur deux points du sol. La distance est exprimée en mètres. Un troisième clic commence une nouvelle mesure ; les mesures confirmées restent affichées jusqu’à « Effacer les mesures ».</p></div><div>${icon('circulation', 24)}<h3>Circulation</h3><p>Activez « Circulation » pour voir l’espace restant autour du lit, du canapé et de la table : rouge sous 60 cm, ambre jusqu’à 80 cm. Indicatif, jamais bloquant.</p></div><div>${icon('plan', 24)}<h3>Vos repères</h3><p>Sélectionnez une pièce dans la liste ou le plan miniature, puis choisissez « Visiter cette pièce » pour vous y rendre.</p></div></div><div class="dialog-callout">Si le navigateur refuse la capture de la souris, cliquez dans la vue puis maintenez le bouton gauche pour regarder autour de vous. Les touches de déplacement restent disponibles.</div><p>Les portes intérieures sont ouvertes au départ. Cliquez sur une porte en vue 3D, ou utilisez E à proximité pendant la visite. Ajoutez un meuble depuis le panneau Meubles, puis glissez-le dans la scène. Dans la fenêtre de modification, les changements restent en aperçu jusqu’à validation ; Annuler conserve l’aménagement précédent. Les flèches déplacent le meuble sélectionné de 1 cm, Maj de 10 cm ; R le tourne de 15°. Pendant le glisser, le meuble s’aimante aux murs et aligne centres et bords avec les autres meubles ; maintenez Alt pour suspendre l’aimantation. Ctrl Z annule et Ctrl Maj Z rétablit. Renseignez les dimensions réelles du meuble et sa configuration.</p><h3>Affichage des murs</h3><p>Dans Navigation, choisissez Automatique, Murs complets ou Murs bas pour dégager la vue. La visite conserve les murs complets.</p><h3>Importer votre maison</h3><p>Le bouton « Importer ma maison » ouvre un fichier JSON de projet fourni séparément. Le PDF du constructeur doit d’abord être converti. La maison et les meubles sont conservés dans ce navigateur ; Exporter permet de garder une copie ou de changer d’ordinateur.</p>`;
}
