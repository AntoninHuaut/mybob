import { escapeHtml } from './format';

/** The « Modifier le plan » tool that receives Plan clicks. */
export type PlanTool = 'select' | 'wall' | 'door' | 'window';

export interface PlanHintState {
  tool: PlanTool;
  /** Walls already on the displayed level. */
  walls: number;
  /** Corners of the wall chain being drawn. */
  corners: number;
  /** What a click of the wall tool would do here: close the outline or end on a wall. */
  target?: 'close' | 'join';
  selection?: 'wall' | 'room' | 'opening';
}

export interface PlanHint {
  text: string;
  /** Key chips shown after the text: [key, what it does]. */
  keys: [string, string][];
}

export interface PlanNotice {
  text: string;
  tone: 'success' | 'error';
}

const TOOL_KEYS: Record<string, PlanTool> = { v: 'select', m: 'wall', p: 'door', f: 'window' };

/** The tool a plain letter key picks: V, M, P, F. */
export function planToolForKey(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
): PlanTool | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  return TOOL_KEYS[event.key.toLowerCase()];
}

const ESCAPE_SELECTION: [string, string] = ['Échap', 'Désélectionner'];

/** The one-line help of the current tool and state: what a click, a drag or a key does now. */
export function planHint(state: PlanHintState): PlanHint {
  if (state.tool === 'wall') {
    if (!state.corners)
      return {
        text: state.walls
          ? 'Cliquez sur un mur pour commencer une cloison, ou dans le vide pour un nouveau contour.'
          : 'Cliquez pour poser le premier angle de la maison.',
        keys: [['Échap', 'Arrêter']],
      };
    const ending =
      state.target === 'close'
        ? 'Cliquez ici pour fermer la pièce.'
        : state.target === 'join'
          ? 'Cliquez ici pour terminer sur ce mur.'
          : state.walls
            ? 'Terminez sur un mur.'
            : 'Revenez au premier angle pour fermer la pièce.';
    return {
      text: `Cliquez l’angle suivant ou tapez une longueur en mètres. ${ending}`,
      keys: [
        ['Entrée', 'Valider'],
        ['Maj', 'Angle libre'],
        ['⌫', 'Retirer l’angle'],
        ['Échap', 'Abandonner'],
      ],
    };
  }
  if (state.tool === 'door' || state.tool === 'window')
    return {
      text:
        state.tool === 'door'
          ? 'Cliquez sur un mur pour y placer une porte.'
          : 'Cliquez sur un mur pour y placer une fenêtre.',
      keys: [['Échap', 'Arrêter']],
    };
  if (!state.walls)
    return {
      text: 'Pas encore de mur. Choisissez Murs pour dessiner le contour de la maison.',
      keys: [['M', 'Murs']],
    };
  if (state.selection === 'wall')
    return {
      text: 'Glissez le mur pour le déplacer, ou un angle pour le tirer. Ses mesures se modifient dans le panneau.',
      keys: [['Suppr', 'Supprimer'], ESCAPE_SELECTION],
    };
  if (state.selection === 'opening')
    return {
      text: 'Glissez-la le long du mur pour la déplacer. Ses mesures se modifient dans le panneau.',
      keys: [['Suppr', 'Supprimer'], ESCAPE_SELECTION],
    };
  if (state.selection === 'room')
    return {
      text: 'Renommez la pièce ou changez son type dans le panneau.',
      keys: [ESCAPE_SELECTION],
    };
  return {
    text: 'Cliquez un mur, une pièce, une porte ou une fenêtre pour le modifier. Glissez un angle pour le déplacer.',
    keys: [
      ['M', 'Murs'],
      ['P', 'Porte'],
      ['F', 'Fenêtre'],
    ],
  };
}

export function planHintHtml(hint: PlanHint, notice?: PlanNotice): string {
  if (notice) return `<span>${escapeHtml(notice.text)}</span>`;
  const keys = hint.keys
    .map(([key, label]) => `<kbd>${escapeHtml(key)}</kbd><small>${escapeHtml(label)}</small>`)
    .join('');
  return `<span>${escapeHtml(hint.text)}</span>${keys ? `<span class="plan-hint-keys">${keys}</span>` : ''}`;
}
