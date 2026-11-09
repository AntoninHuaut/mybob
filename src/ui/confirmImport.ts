import { escapeHtml } from './format';

export function confirmImportReplacement(
  projectName: string,
  onDialogState: (open: boolean) => void,
  onExport?: () => void,
): Promise<boolean> {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-labelledby', 'replace-project-title');
  dialog.innerHTML = `<h2 id="replace-project-title">Remplacer « ${escapeHtml(projectName)} » ?</h2>
    <p>Ce fichier porte le même identifiant qu’un projet déjà disponible. Il remplacera son modèle et, si le fichier en contient, les meubles des niveaux concernés. Gardez un export de la version actuelle avant de continuer.</p>
    ${
      onExport
        ? ''
        : '<p>Pour exporter la version actuelle, annulez puis sélectionnez ce projet.</p>'
    }<form method="dialog" class="dialog-actions">${
      onExport
        ? '<button type="button" data-export class="text-button dialog-actions-start">Exporter la version actuelle</button>'
        : ''
    }<button type="submit" value="cancel" class="text-button" autofocus>Annuler</button><button type="submit" value="replace" class="danger-button">Remplacer le projet</button></form>`;
  document.body.append(dialog);
  dialog.querySelector('[data-export]')?.addEventListener('click', () => onExport?.());
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        const accepted = dialog.returnValue === 'replace';
        dialog.remove();
        onDialogState(false);
        resolve(accepted);
      },
      { once: true },
    );
    dialog.showModal();
    onDialogState(true);
  });
}
