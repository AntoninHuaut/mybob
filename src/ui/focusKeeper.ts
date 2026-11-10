/**
 * A panel that rebuilds its HTML replaces the control the keyboard user just operated, and
 * focus falls back to `<body>` (WCAG 2.4.3). `captureFocus` notes which control of `root`
 * holds focus, in a form that survives the rebuild; `restoreFocus` puts it back.
 */

export const quote = (value: string) => `"${value.replace(/["\\]/g, '\\$&')}"`;

/** A selector that finds the equivalent control in a freshly rendered `root`, if one is focused. */
export function captureFocus(root: HTMLElement): string | undefined {
  const active = root.ownerDocument.activeElement as HTMLElement | null;
  if (!active || active === root || !root.contains(active)) return undefined;
  const tag = active.localName;
  if (active.id) return `[id=${quote(active.id)}]`;
  const name = active.getAttribute('name');
  if (name) return `${tag}[name=${quote(name)}]`;
  const data = active.getAttributeNames().find((attribute) => attribute.startsWith('data-'));
  if (data) return `${tag}[${data}=${quote(active.getAttribute(data) ?? '')}]`;
  return undefined;
}

/**
 * Focuses the first of `selectors` that matches an enabled control in `root`. Returns whether
 * focus moved: a disabled control (Annuler once the history is empty) falls through to the
 * next candidate instead of leaving focus on `<body>`.
 */
export function restoreFocus(root: HTMLElement, ...selectors: (string | undefined)[]): boolean {
  for (const selector of selectors) {
    if (!selector) continue;
    const target = root.querySelector<HTMLElement>(selector);
    if (!target || (target as HTMLButtonElement).disabled) continue;
    target.focus({ preventScroll: true });
    return root.ownerDocument.activeElement === target;
  }
  return false;
}
