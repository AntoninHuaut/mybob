import { escapeHtml } from './format';

export type LinkDivergenceChoice = 'replace' | 'copy' | 'ignore';

/**
 * The owner opens a link to their own project that is older than the local state:
 * three outcomes, never a silent loss. Modelled on `confirmImportReplacement`.
 */
export function confirmLinkDivergence(
  projectName: string,
  onDialogState: (open: boolean) => void,
): Promise<LinkDivergenceChoice> {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-labelledby', 'link-divergence-title');
  dialog.innerHTML = `<h2 id="link-divergence-title">Ce lien et « ${escapeHtml(projectName)} » diffèrent</h2>
    <p>Le lien ouvert décrit une version de ce projet qui n’est pas celle enregistrée dans ce navigateur. Choisissez : remplacer le projet enregistré, en garder une copie à part, ou ignorer ce lien.</p>
    <form method="dialog" class="dialog-actions"><button type="submit" value="copy" class="text-button dialog-actions-start">Garder les deux</button><button type="submit" value="ignore" class="text-button" autofocus>Ignorer le lien</button><button type="submit" value="replace" class="danger-button">Remplacer le projet enregistré</button></form>`;
  document.body.append(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        const value = dialog.returnValue;
        dialog.remove();
        onDialogState(false);
        resolve(value === 'replace' || value === 'copy' ? value : 'ignore');
      },
      { once: true },
    );
    dialog.showModal();
    onDialogState(true);
  });
}
