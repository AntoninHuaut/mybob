import { escapeHtml } from './format';

export interface ReplaceCandidate {
  id: string;
  name: string;
}

/**
 * Project limit reached: offers to replace one of them rather than failing.
 * Deletes nothing: returns the chosen identifier, or `null` if the user cancels.
 */
export function chooseProjectToReplace(
  candidates: ReplaceCandidate[],
  limit: number,
  onDialogState: (open: boolean) => void,
): Promise<string | null> {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-labelledby', 'choose-replace-title');
  const options = candidates
    .map(
      (candidate) =>
        `<option value="${escapeHtml(candidate.id)}">${escapeHtml(candidate.name)}</option>`,
    )
    .join('');
  dialog.innerHTML = `<h2 id="choose-replace-title">Limite de ${limit} projets atteinte</h2>
    <p>Pour ajouter ce projet, choisissez celui qu’il remplacera. Le projet choisi et ses aménagements seront supprimés de cet ordinateur, seulement si l’ajout réussit. Pour en garder une copie, annulez, sélectionnez-le puis exportez-le.</p>
    <form method="dialog"><label>Projet à remplacer <select name="replaced">${options}</select></label>
    <div class="dialog-actions"><button type="submit" value="cancel" class="text-button" autofocus>Annuler</button><button type="submit" value="replace" class="danger-button">Remplacer ce projet</button></div></form>`;
  document.body.append(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        const chosen =
          dialog.returnValue === 'replace'
            ? (dialog.querySelector<HTMLSelectElement>('select[name="replaced"]')?.value ?? null)
            : null;
        dialog.remove();
        onDialogState(false);
        resolve(chosen || null);
      },
      { once: true },
    );
    dialog.showModal();
    onDialogState(true);
  });
}
