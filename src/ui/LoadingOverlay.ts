/** DOM-only so construction can yield before there is a renderable scene. */
export class LoadingOverlay {
  private readonly element = document.createElement("div");
  private readonly label = document.createElement("span");
  private readonly progress = document.createElement("progress");
  private readonly retry = document.createElement("button");

  constructor(root: HTMLElement) {
    this.element.className = "loading-overlay";
    this.element.setAttribute("role", "status");
    this.progress.max = 1;
    this.progress.setAttribute("aria-label", "Loading city");
    this.retry.textContent = "Retry";
    this.retry.hidden = true;
    this.element.append(this.label, this.progress, this.retry);
    root.append(this.element);
    this.show();
  }

  show(): void {
    this.element.hidden = false;
    this.label.textContent = "Loading city";
    this.progress.hidden = false;
    this.progress.value = 0;
    this.retry.hidden = true;
    this.retry.onclick = null;
  }
  update(progress: number): void { this.progress.value = progress; }
  hide(): void { this.element.hidden = true; }
  fail(retry: () => void): void {
    this.label.textContent = "Couldn’t load the city";
    this.progress.hidden = true;
    this.retry.hidden = false;
    this.retry.onclick = () => { this.retry.disabled = true; retry(); this.retry.disabled = false; };
  }
}
