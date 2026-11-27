export const BROWSER_ADVICE_STORAGE = 'maison-atelier:browser-advice:v1';

export const isFirefox = (userAgent: string): boolean => /\bFirefox\//.test(userAgent);

/** Firefox renders the 3D noticeably slower: suggest a Chromium browser once, never block. */
export function adviseChromium(userAgent: string, storage: Storage | undefined): Promise<void> {
  if (!isFirefox(userAgent)) return Promise.resolve();
  try {
    if (storage?.getItem(BROWSER_ADVICE_STORAGE)) return Promise.resolve();
  } catch {
    // Unreadable storage: show the advice, it simply won't be remembered.
  }
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-labelledby', 'browser-advice-title');
  dialog.innerHTML = `<h2 id="browser-advice-title">Pour une 3D plus fluide, ouvrez Maison dans Chrome ou Edge</h2>
    <p>Firefox fonctionne, mais la vue 3D et la Visite y sont nettement moins fluides. Google Chrome ou Microsoft Edge tirent mieux parti de la carte graphique.</p>
    <p>Vos projets sont enregistrés dans ce navigateur : exportez-les avec le bouton Exporter pour les retrouver dans l’autre.</p>
    <form method="dialog" class="dialog-actions"><button type="submit" class="primary-button" autofocus>Continuer avec Firefox</button></form>`;
  document.body.append(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        dialog.remove();
        try {
          storage?.setItem(BROWSER_ADVICE_STORAGE, '1');
        } catch {
          // Not remembered: the advice comes back next time.
        }
        resolve();
      },
      { once: true },
    );
    dialog.showModal();
  });
}
