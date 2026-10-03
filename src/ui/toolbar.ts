import { RoadType, ROAD_SPECS } from '../shared/network';
import { ZoneType } from '../shared/zones';
import { ROAD_TOOLS, type ToolController, type ToolId } from '../tools/controller';

interface Button {
  el: HTMLButtonElement;
  active: () => boolean;
}

const HINTS: Record<ToolId, string> = {
  select: 'Dra för att flytta kartan · Högerdra: rotera · Scroll: zooma',
  straight: 'Klicka start och slut – vägen fortsätter från slutet · Esc/högerklick: avbryt',
  curve: 'Klick 1: start · Klick 2: var kurvan böjer sig · Klick 3: slut',
  freehand: 'Håll nere och rita vägen',
  grid: 'Dra en rektangel – den fylls med kvarter',
  bulldoze: 'Klicka eller dra över vägar för att riva dem',
  zone: 'Måla zoner längs vägarna',
};

/** Verktygsfältet längst ner: verktyg på första raden, verktygets inställningar på andra. */
export class Toolbar {
  private readonly buttons: Button[] = [];
  private readonly options: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly tools: ToolController,
  ) {
    const main = div('row');
    main.append(
      this.toolButton('Välj', 'select', 'Esc'),
      sep(),
      this.toolButton('Rak väg', 'straight'),
      this.toolButton('Kurva', 'curve'),
      this.toolButton('Frihand', 'freehand'),
      this.toolButton('Rutnät', 'grid'),
      sep(),
      this.zoneButton('Bostad', ZoneType.Residential, 'res'),
      this.zoneButton('Handel', ZoneType.Commercial, 'com'),
      this.zoneButton('Industri', ZoneType.Industrial, 'ind'),
      this.zoneButton('Ta bort zon', ZoneType.None, 'none'),
      sep(),
      this.toolButton('Riv', 'bulldoze', 'B'),
    );
    this.options = div('row options');
    root.append(main, this.options);
    this.render();
  }

  render(): void {
    for (const b of this.buttons) b.el.classList.toggle('active', b.active());
    const t = this.tools;
    this.options.replaceChildren();
    if (ROAD_TOOLS.includes(t.tool)) {
      for (const type of [RoadType.Street, RoadType.Avenue]) {
        const el = button(ROAD_SPECS[type].label, () => t.setRoadType(type));
        el.classList.toggle('active', t.roadType === type);
        this.options.append(el);
      }
      const snap = button('Fäst mot rutnät', () => t.toggleGridSnap(), 'G');
      snap.classList.toggle('active', t.gridSnap || t.tool === 'grid');
      snap.disabled = t.tool === 'grid';
      this.options.append(sep(), snap);
    } else if (t.tool === 'zone') {
      for (const [size, label] of [['small', 'Liten pensel'], ['large', 'Stor pensel']] as const) {
        const el = button(label, () => t.setBrush(size));
        el.classList.toggle('active', t.brush === size);
        this.options.append(el);
      }
    }
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = HINTS[t.tool];
    this.options.append(hint);
  }

  private toolButton(label: string, tool: ToolId, key?: string): HTMLButtonElement {
    const el = button(label, () => this.tools.setTool(tool), key);
    this.buttons.push({ el, active: () => this.tools.tool === tool });
    return el;
  }

  private zoneButton(label: string, zone: ZoneType, swatch: string): HTMLButtonElement {
    const el = button(label, () => this.tools.setZoneType(zone));
    const dot = document.createElement('i');
    dot.className = `swatch ${swatch}`;
    el.prepend(dot);
    this.buttons.push({ el, active: () => this.tools.tool === 'zone' && this.tools.zoneType === zone });
    return el;
  }
}

function button(label: string, onClick: () => void, key?: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.textContent = label;
  if (key) el.title = `Tangent ${key}`;
  el.onclick = onClick;
  return el;
}

function div(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

function sep(): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'sep';
  return el;
}
