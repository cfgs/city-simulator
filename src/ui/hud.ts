import type { SimStats } from '../shared/protocol';

export interface HudCallbacks {
  onSpeed(speed: number): void;
  /** Växlar trafikvyn och returnerar om den nu är på. */
  onToggleTraffic(): boolean;
}

const SPEEDS = [
  { label: '⏸', speed: 0, key: '0' },
  { label: '1×', speed: 1, key: '1' },
  { label: '10×', speed: 10, key: '2' },
  { label: '60×', speed: 60, key: '3' },
  { label: '300×', speed: 300, key: '4' },
  { label: 'Max', speed: Infinity, key: '5' },
];
const DEFAULT_SPEED = 3;

const fmt = (n: number) => Math.round(n).toLocaleString('sv-SE');
const dec = (n: number, digits = 1) => n.toLocaleString('sv-SE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pad2 = (n: number) => String(n).padStart(2, '0');

function clock(time: number): string {
  const day = Math.floor(time / 86_400) + 1;
  const s = time % 86_400;
  return `Dag ${day}  ${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}`;
}

function row(label: string, value: string, extra = ''): string {
  return `${label.padEnd(13)}${value.padStart(9)}${extra ? `  ${extra}` : ''}`;
}

/** Statistik- och prestandapanel med hastighetsknappar. */
export class Hud {
  private readonly text: HTMLPreElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly traffic: HTMLButtonElement;
  private speedIndex = DEFAULT_SPEED;
  private lastRunning = DEFAULT_SPEED;

  constructor(root: HTMLElement, private readonly callbacks: HudCallbacks) {
    const controls = document.createElement('div');
    controls.className = 'controls';
    SPEEDS.forEach((s, i) => {
      const button = document.createElement('button');
      button.textContent = s.label;
      button.title = `Tangent ${s.key}`;
      button.onclick = () => this.setSpeed(i);
      controls.appendChild(button);
      this.buttons.push(button);
    });
    this.traffic = document.createElement('button');
    this.traffic.textContent = 'Trafikvy';
    this.traffic.title = 'Tangent T';
    this.traffic.classList.add('active');
    this.traffic.onclick = () => this.toggleTraffic();
    controls.appendChild(this.traffic);

    this.text = document.createElement('pre');
    root.append(controls, this.text);
    this.setSpeed(DEFAULT_SPEED);
  }

  togglePause(): void {
    this.setSpeed(this.speedIndex === 0 ? this.lastRunning : 0);
  }

  toggleTraffic(): void {
    this.traffic.classList.toggle('active', this.callbacks.onToggleTraffic());
  }

  /** Hanterar hastighetstangenterna 0–5. Returnerar true om tangenten användes. */
  handleKey(key: string): boolean {
    const i = SPEEDS.findIndex((s) => s.key === key);
    if (i < 0) return false;
    this.setSpeed(i);
    return true;
  }

  update(stats: SimStats | null, fps: number, visibleVehicles: number): void {
    if (!stats) {
      this.text.textContent = 'Väntar på simuleringen…';
      return;
    }
    const target = SPEEDS[this.speedIndex].speed;
    const tempo = target === 0 ? 'paus' : `${Number.isFinite(target) ? fmt(target) : 'max'}× (uppnått ${fmt(stats.effectiveSpeed)}×)`;
    const openJobs = stats.jobs - stats.filledJobs;
    this.text.textContent = [
      clock(stats.time),
      `Tempo: ${tempo}`,
      '',
      row('Invånare', fmt(stats.population), `bilägare ${fmt(stats.drivers)}`),
      row('Jobb', fmt(stats.jobs), `${fmt(openJobs)} lediga · ${fmt(stats.unemployed)} arbetslösa`),
      row('Byggnader', fmt(stats.buildings)),
      row('Hemma', fmt(stats.atHome), `på jobbet ${fmt(stats.atWork)}`),
      row('Bilar på väg', fmt(stats.onRoad), stats.waitingToEnter > 0 ? `+${fmt(stats.waitingToEnter)} väntar` : ''),
      row('Kollektivt', fmt(stats.inTransit)),
      row('Restid bil', `${dec(stats.avgCarTripMin)} min`),
      '',
      row('Sim', `${dec(stats.tickMs, 2)} ms`, `per tick · ${fmt(stats.ticksPerSec)} tick/s`),
      row('Vägvalsträd', fmt(stats.routeTrees)),
      row('Rendering', `${fmt(fps)} fps`, `${fmt(visibleVehicles)} bilar i bild`),
    ].join('\n');
  }

  private setSpeed(i: number): void {
    this.speedIndex = i;
    if (i > 0) this.lastRunning = i;
    this.buttons.forEach((b, j) => b.classList.toggle('active', j === i));
    this.callbacks.onSpeed(SPEEDS[i].speed);
  }
}
