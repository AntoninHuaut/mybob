import { escapeHtml } from './format';

/**
 * The performance report a relative can send without a console: the owner shares the
 * site's link with `?diagnostic`, the page measures every view by itself and shows the
 * text with a copy button. The text holds the machine and the timings (`mybob.diag()`
 * and `mybob.profile()` lines), never the house.
 */
export const REPORT_PARAMETER = 'diagnostic';

export function reportRequested(search: string): boolean {
  return new URLSearchParams(search).has(REPORT_PARAMETER);
}

/** The same address without the parameter: a reload must not measure again. */
export function withoutReportParameter(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(REPORT_PARAMETER);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function reportProgressHtml(done: number, total: number): string {
  return `<h2>Mesure des performances…</h2><p>La vue change toute seule pendant environ 30 secondes. Ne touchez à rien.</p><progress id="report-progress" max="${total}" value="${done}"></progress>`;
}

export function reportResultHtml(text: string): string {
  return `<h2>Rapport prêt</h2><p>Copiez-le et envoyez-le à la personne qui vous a donné le lien. Il décrit l’ordinateur et la vitesse d’affichage, rien sur la maison.</p><pre id="report-text" class="report-text">${escapeHtml(text)}</pre><button type="button" class="primary-button" id="copy-report">Copier le rapport</button>`;
}

/**
 * Copies through the clipboard API, and falls back to selecting the text so that
 * Ctrl+C still works where the browser refuses (no secure context, denied permission).
 */
export async function copyReport(text: string, pre: HTMLElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const selection = pre.ownerDocument.getSelection();
    const range = pre.ownerDocument.createRange();
    range.selectNodeContents(pre);
    selection?.removeAllRanges();
    selection?.addRange(range);
    return false;
  }
}
