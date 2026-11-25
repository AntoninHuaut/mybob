/**
 * DOM writes that skip an unchanged value, for code that runs after every drawn image: an
 * equal write still invalidates style and costs a layout on the next read.
 */
export function setHidden(element: HTMLElement, hidden: boolean): void {
  if (element.hidden !== hidden) element.hidden = hidden;
}

export function setText(element: Element, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

export function setAttribute(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

export function setDisabled(element: HTMLButtonElement, disabled: boolean): void {
  if (element.disabled !== disabled) element.disabled = disabled;
}

export function setTitle(element: HTMLElement, title: string): void {
  if (element.title !== title) element.title = title;
}
