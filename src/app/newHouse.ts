import { createHouse } from '../model/createHouse';
import { userMessage } from '../errorMessage';
import { el, openDialog, closeDialog, pauseForDialog } from './dom';
import { installProjectDocument } from './projectLibrary';
import { setMode } from './viewChrome';

export function openNewHouse() {
  const dimension = (key: string, label: string, value: number) =>
    `<label>${label} (m)<input required name="${key}" type="number" min="0.001" step="any" value="${value}"></label>`;
  openDialog(
    'NOUVELLE MAISON',
    `<form id="new-house-form"><h2>Créer une pièce rectangulaire</h2>
    <label>Nom de la pièce<input required name="room" value="Séjour"></label>
    ${dimension('width', 'Largeur intérieure', 4)}${dimension('depth', 'Profondeur intérieure', 3)}
    ${dimension('thickness', 'Épaisseur finie des murs', 0.2)}
    <p role="alert" id="house-error"></p><div class="dialog-actions"><button type="button" class="text-button" id="cancel-house">Annuler</button>
    <button class="primary-button" type="submit">Créer et enregistrer</button></div></form>`,
  );
  const form = el<HTMLFormElement>('#new-house-form');
  el('#cancel-house').onclick = closeDialog;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      const fields = new FormData(form);
      const project = createHouse(
        crypto.randomUUID(),
        String(fields.get('room')),
        Number(fields.get('width')),
        Number(fields.get('depth')),
        Number(fields.get('thickness')),
      );
      if (await installProjectDocument({ project, staged: [], variants: undefined })) {
        closeDialog();
        setMode('plan');
      } else pauseForDialog(true);
    } catch (error) {
      el('#house-error').textContent = userMessage(error, 'Création impossible.');
    } finally {
      submit.disabled = false;
    }
  };
}
