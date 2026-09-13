import { setText, setVisible } from "./DomUpdates";

export interface RideHudView {
  objective: string;
  trait?: string;
  stars?: number;
  tip?: string;
  statusHtml?: string;
  arrival?: string;
  packagePayout?: string;
  packageRate?: string;
}

/** Stable nodes keep changing cents from rebuilding the whole ride card every frame. */
export class RideHud {
  private readonly objective: HTMLElement;
  private readonly trait: HTMLElement;
  private readonly score: HTMLElement;
  private readonly stars: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly status: HTMLElement;
  private readonly arrival: HTMLElement;
  private readonly packagePayout: HTMLElement;
  private readonly packageRate: HTMLElement;
  private lastStars = -1;
  private lastStatus = "";

  constructor(root: HTMLElement) {
    root.innerHTML = `<div class="objective" data-ride-field="objective"></div>
      <div class="trait-explanation hidden" data-ride-field="trait"></div>
      <div class="hidden" data-ride-field="packagePayout"></div>
      <div class="hidden" data-ride-field="packageRate"></div>
      <div class="ride-score-line hidden" data-ride-field="score">
        <span class="ride-stars" role="img" data-ride-field="stars"></span>
        <span class="ride-tip" data-ride-field="tip"></span>
      </div>
      <div class="hidden" data-ride-field="status"></div>
      <div class="hidden" data-ride-field="arrival"></div>`;
    const field = (name: string) => root.querySelector<HTMLElement>(`[data-ride-field="${name}"]`)!;
    this.objective=field("objective");this.trait=field("trait");this.score=field("score");
    this.stars=field("stars");this.tip=field("tip");this.status=field("status");
    this.arrival=field("arrival");this.packagePayout=field("packagePayout");this.packageRate=field("packageRate");
  }

  update(view: RideHudView): void {
    setText(this.objective,view.objective);
    this.optionalText(this.trait,view.trait);
    this.optionalText(this.packagePayout,view.packagePayout);
    this.optionalText(this.packageRate,view.packageRate);
    this.optionalText(this.arrival,view.arrival);
    setVisible(this.score,view.stars !== undefined);
    if(view.stars !== undefined) {
      if(this.lastStars !== view.stars) {
        this.lastStars=view.stars;
        setText(this.stars,"★".repeat(view.stars)+"☆".repeat(5-view.stars));
        this.stars.setAttribute("aria-label",`${view.stars} out of 5 stars`);
      }
      setText(this.tip,view.tip??"");
    }
    const status = view.statusHtml??"";
    if(this.lastStatus !== status) {
      this.lastStatus=status;
      this.status.innerHTML=status;
    }
    setVisible(this.status,!!status);
  }

  private optionalText(element: HTMLElement,text?: string): void {
    setVisible(element,!!text);
    if(text) setText(element,text);
  }
}
