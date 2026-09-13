/** These reads inspect DOM state, not geometry; they do not force browser layout. */
export function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

export function setVisible(element: HTMLElement, visible: boolean): void {
  setClass(element,"hidden",!visible);
}

export function setClass(element: HTMLElement, name: string, enabled: boolean): void {
  if (element.classList.contains(name) !== enabled) element.classList.toggle(name,enabled);
}

export function setStyle(element: HTMLElement, property: string, value: string): void {
  if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property,value);
}
