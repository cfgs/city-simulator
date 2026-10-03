/** Liten text vid muspekaren (längd på väg, varför den inte går att bygga) och korta notiser. */
export class Tooltip {
  private readonly tip: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private toastTimer = 0;

  constructor() {
    this.tip = document.createElement('div');
    this.tip.id = 'tip';
    this.toastEl = document.createElement('div');
    this.toastEl.id = 'toast';
    document.body.append(this.tip, this.toastEl);
  }

  show(text: string | null, error: boolean, x: number, y: number): void {
    if (!text) {
      this.tip.style.display = 'none';
      return;
    }
    this.tip.textContent = text;
    this.tip.classList.toggle('error', error);
    this.tip.style.display = 'block';
    this.tip.style.transform = `translate(${x + 16}px, ${y + 16}px)`;
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('visible'), 3500);
  }
}
