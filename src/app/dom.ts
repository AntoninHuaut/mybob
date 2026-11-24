import { app } from './state';

export const el = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

let toastTimer: ReturnType<typeof setTimeout>;

export function toast(message: string, durationMs = 5000) {
  clearTimeout(toastTimer);
  el('#toast').textContent = message;
  el('#toast').hidden = false;
  toastTimer = setTimeout(() => {
    el('#toast').hidden = true;
  }, durationMs);
}

export function activeButton(selector: string, active: boolean) {
  el(selector).classList.toggle('active', active);
  el(selector).setAttribute('aria-pressed', String(active));
}

/** A modal opens or closes: release the pointer lock and pause the scene while it is open. */
export function pauseForDialog(open: boolean) {
  if (open && document.pointerLockElement) document.exitPointerLock();
  app.viewer.setPaused(open);
}

export function openDialog(title: string, content: string) {
  if (document.pointerLockElement) document.exitPointerLock();
  app.viewer.setPaused(true);
  el('#dialog-eyebrow').textContent = title;
  el('#dialog-content').innerHTML = content;
  el<HTMLDialogElement>('#info-dialog').showModal();
}

export function closeDialog() {
  el<HTMLDialogElement>('#info-dialog').close();
}

/** Saves a text file generated on this computer. */
export function downloadText(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
