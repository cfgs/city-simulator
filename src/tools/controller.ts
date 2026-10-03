import * as THREE from 'three';
import { sampleQuad, straight, type Point, type Quad } from '../shared/geometry';
import { RoadNetwork, RoadType } from '../shared/network';
import type { ToWorker } from '../shared/protocol';
import { planRoad, snapPoint, type RoadPlan, type Snapped } from '../shared/roadplan';
import { ZoneType } from '../shared/zones';
import type { Preview } from '../render/preview';
import { fitFreehand, gridLines, snapToGrid } from './shapes';

export type ToolId = 'select' | 'straight' | 'curve' | 'freehand' | 'grid' | 'bulldoze' | 'zone';

export const ROAD_TOOLS: ToolId[] = ['straight', 'curve', 'freehand', 'grid'];

export interface ToolUi {
  /** Visar en text vid muspekaren (eller döljer den med null). */
  tip(text: string | null, error: boolean, x: number, y: number): void;
  changed(): void;
}

const BRUSH = { small: 12, large: 36 };
/** Inom så många grader från en axel låses en rak väg till axeln när rutnätsfästning är på. */
const AXIS_LOCK = Math.tan((8 * Math.PI) / 180);
const PAINT_SPACING = 4;
const FREEHAND_SPACING = 4;

/**
 * Tar emot musen på kartan och översätter till verktygens handlingar. All planering sker
 * mot en spegel av vägnätet med samma kod som simuleringen använder, så förhandsvisningen
 * visar exakt vad som kommer att byggas. Själva bygget skickas som kommandon till workern.
 */
export class ToolController {
  tool: ToolId = 'select';
  roadType: RoadType = RoadType.Street;
  zoneType: ZoneType = ZoneType.Residential;
  gridSnap = false;
  brush: keyof typeof BRUSH = 'small';

  private net: RoadNetwork;
  private start: Snapped | null = null;
  private control: Point | null = null;
  private freehand: Point[] | null = null;
  private gridCorner: Point | null = null;
  private dragging = false;
  private readonly bulldozed = new Set<number>();
  private lastPaint: Point | null = null;
  private hover: Point | null = null;
  private screen = { x: 0, y: 0 };
  private rightDown: { x: number; y: number } | null = null;
  private plan: RoadPlan | null = null;
  private roads: Quad[] = [];
  private requestId = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hit = new THREE.Vector3();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.Camera,
    private readonly preview: Preview,
    private readonly send: (msg: ToWorker) => void,
    private readonly ui: ToolUi,
    mapSize: number,
  ) {
    this.net = new RoadNetwork(mapSize);
    canvas.addEventListener('pointerdown', (ev) => this.onDown(ev));
    canvas.addEventListener('pointermove', (ev) => this.onMove(ev));
    window.addEventListener('pointerup', (ev) => this.onUp(ev));
    canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.refresh();
    });
  }

  get brushRadius(): number {
    return BRUSH[this.brush];
  }

  /** Pågår ett bygge (som Esc/högerklick kan avbryta)? */
  get busy(): boolean {
    return this.start !== null || this.freehand !== null || this.gridCorner !== null;
  }

  setNetwork(net: RoadNetwork): void {
    this.net = net;
    this.refresh();
  }

  setTool(tool: ToolId): void {
    this.tool = tool;
    this.reset();
    this.ui.changed();
  }

  setRoadType(type: RoadType): void {
    this.roadType = type;
    this.refresh();
    this.ui.changed();
  }

  setZoneType(zone: ZoneType): void {
    this.zoneType = zone;
    this.setTool('zone');
  }

  toggleGridSnap(): void {
    this.gridSnap = !this.gridSnap;
    this.refresh();
    this.ui.changed();
  }

  setBrush(size: keyof typeof BRUSH): void {
    this.brush = size;
    this.refresh();
    this.ui.changed();
  }

  /** Avbryter pågående bygge, eller lämnar verktyget om inget pågår. */
  cancel(): void {
    if (this.busy) {
      this.reset();
      return;
    }
    this.setTool('select');
  }

  private reset(): void {
    this.start = null;
    this.control = null;
    this.freehand = null;
    this.gridCorner = null;
    this.dragging = false;
    this.bulldozed.clear();
    this.refresh();
  }

  // ------------------------------------------------------------------ Mus

  private onDown(ev: PointerEvent): void {
    if (ev.button === 2) {
      this.rightDown = { x: ev.clientX, y: ev.clientY };
      return;
    }
    if (ev.button !== 0 || ev.shiftKey || this.tool === 'select') return;
    const p = this.pick(ev);
    if (!p) return;
    this.hover = p;
    switch (this.tool) {
      case 'straight':
        if (!this.start) this.start = this.snap(p);
        else this.buildAndContinue();
        break;
      case 'curve':
        if (!this.start) this.start = this.snap(p);
        else if (!this.control) this.control = this.gridSnap ? snapToGrid(p) : p;
        else this.buildAndContinue();
        break;
      case 'freehand':
        this.freehand = [p];
        break;
      case 'grid':
        this.gridCorner = snapToGrid(p);
        break;
      case 'bulldoze':
      case 'zone':
        this.dragging = true;
        this.lastPaint = null;
        this.drag(p);
        break;
    }
    this.refresh();
  }

  private onMove(ev: PointerEvent): void {
    this.screen = { x: ev.clientX, y: ev.clientY };
    const p = this.pick(ev);
    if (!p) return;
    this.hover = p;
    if (this.freehand) {
      const last = this.freehand[this.freehand.length - 1];
      if (Math.hypot(p.x - last.x, p.z - last.z) >= FREEHAND_SPACING) this.freehand.push(p);
    }
    if (this.dragging) this.drag(p);
    this.refresh();
  }

  /** Riv- och zonverktygen verkar medan musknappen hålls nere. */
  private drag(p: Point): void {
    if (this.tool === 'bulldoze') {
      const hit = this.net.nearestSegment(p.x, p.z, 10);
      if (hit && !this.net.segments.get(hit.seg)!.locked && !this.bulldozed.has(hit.seg)) {
        this.bulldozed.add(hit.seg);
        this.send({ type: 'bulldoze', segments: [hit.seg] });
      }
    } else if (this.tool === 'zone') {
      if (this.lastPaint && Math.hypot(p.x - this.lastPaint.x, p.z - this.lastPaint.z) < PAINT_SPACING) return;
      this.lastPaint = p;
      this.send({ type: 'zone', x: p.x, z: p.z, radius: this.brushRadius, zone: this.zoneType });
    }
  }

  private onUp(ev: PointerEvent): void {
    if (ev.button === 2) {
      const r = this.rightDown;
      this.rightDown = null;
      if (r && Math.hypot(ev.clientX - r.x, ev.clientY - r.y) < 5) this.cancel();
      return;
    }
    if (ev.button !== 0) return;
    if (this.tool === 'freehand' && this.freehand) {
      if (this.plan?.valid) this.sendRoads([this.plan.curves.map((c) => c.curve)]);
      this.freehand = null;
    } else if (this.tool === 'grid' && this.gridCorner) {
      if (this.roads.length > 0) this.sendRoads(this.roads.map((r) => [r]));
      this.gridCorner = null;
    }
    this.dragging = false;
    this.bulldozed.clear();
    this.refresh();
  }

  // ------------------------------------------------------------------ Verktygen

  /** Räknar om förhandsvisningen (och utför dragande verktyg) för aktuell muspekare. */
  private refresh(): void {
    this.plan = null;
    this.roads = [];
    const p = this.hover;
    if (!p || this.tool === 'select') {
      this.preview.clear();
      this.ui.tip(null, false, 0, 0);
      return;
    }
    switch (this.tool) {
      case 'straight':
        return this.previewStraight(p);
      case 'curve':
        return this.previewCurve(p);
      case 'freehand':
        return this.previewFreehand(p);
      case 'grid':
        return this.previewGrid(p);
      case 'bulldoze':
        return this.previewBulldoze(p);
      case 'zone':
        return this.previewZone(p);
    }
  }

  private previewStraight(p: Point): void {
    if (!this.start) return this.showCursor(p);
    const end = this.snapEnd(p);
    this.showPlan(planRoad(this.net, [straight(this.start.x, this.start.z, end.x, end.z)], this.roadType));
  }

  private previewCurve(p: Point): void {
    const start = this.start;
    if (!start) return this.showCursor(p);
    if (!this.control) {
      const c = this.gridSnap ? snapToGrid(p) : p;
      this.preview.showCursor(c.x, c.z, null);
      this.preview.addGuide([start, c]);
      this.ui.tip('Klicka där kurvan ska böja sig', false, this.screen.x, this.screen.y);
      return;
    }
    const end = this.snap(p);
    const control = this.control;
    this.showPlan(planRoad(this.net, [{ ax: start.x, az: start.z, cx: control.x, cz: control.z, bx: end.x, bz: end.z }], this.roadType));
    this.preview.addGuide([start, control, end]);
  }

  private previewFreehand(p: Point): void {
    if (!this.freehand) return this.showCursor(p);
    const curves = fitFreehand(this.freehand);
    if (curves.length === 0) return this.showCursor(p);
    this.showPlan(planRoad(this.net, curves, this.roadType));
  }

  private previewGrid(p: Point): void {
    const corner = this.gridCorner;
    const q = snapToGrid(p);
    if (!corner) {
      this.preview.showCursor(q.x, q.z, null);
      this.ui.tip('Dra en rektangel för att bygga ett rutnät', false, this.screen.x, this.screen.y);
      return;
    }
    this.roads = gridLines(corner, q);
    // Varje gata provas för sig mot befintliga vägar; korsningarna mellan dem skapas vid bygget.
    const valid = this.roads.map((r) => planRoad(this.net, [r], this.roadType).valid);
    this.preview.showRoads(this.roads, valid, this.roadType);
    this.ui.tip(this.roads.length === 0 ? 'För litet område' : `${this.roads.length} gator`, this.roads.length === 0, this.screen.x, this.screen.y);
  }

  private previewBulldoze(p: Point): void {
    const hit = this.net.nearestSegment(p.x, p.z, 10);
    const seg = hit ? this.net.segments.get(hit.seg)! : null;
    if (seg?.locked) {
      this.preview.showSegment(null);
      this.ui.tip('Motorvägen och avfarterna kan inte rivas', true, this.screen.x, this.screen.y);
      return;
    }
    this.preview.showSegment(seg);
    this.ui.tip(seg ? 'Riv vägen' : null, false, this.screen.x, this.screen.y);
  }

  private previewZone(p: Point): void {
    this.preview.showBrush(p.x, p.z, this.brushRadius);
    this.ui.tip(null, false, 0, 0);
  }

  private showCursor(p: Point): void {
    const s = this.snap(p);
    this.preview.showCursor(s.x, s.z, s.ref);
    this.ui.tip(null, false, 0, 0);
  }

  private showPlan(plan: RoadPlan): void {
    this.plan = plan;
    this.preview.showPlan(plan);
    const length = plan.curves.reduce((sum, c) => sum + sampleQuad(c.curve).length, 0);
    this.ui.tip(plan.valid ? `${Math.round(length)} m` : plan.reason, !plan.valid, this.screen.x, this.screen.y);
  }

  /** Bygger den förhandsvisade vägen och fortsätter rita från dess slut. */
  private buildAndContinue(): void {
    const plan = this.plan;
    if (!plan?.valid) return;
    const curves = plan.curves.map((c) => c.curve);
    this.sendRoads([curves]);
    const last = curves[curves.length - 1];
    this.start = { x: last.bx, z: last.bz, ref: { kind: 'new' } };
    this.control = null;
  }

  private sendRoads(roads: Quad[][]): void {
    this.send({ type: 'buildRoads', roads, roadType: this.roadType, requestId: ++this.requestId });
  }

  private snap(p: Point): Snapped {
    return snapPoint(this.net, p.x, p.z, this.gridSnap);
  }

  /** Som snap, men med rutnätsfästning låses nästan raka vägar till x- eller z-axeln. */
  private snapEnd(p: Point): Snapped {
    const s = this.snap(p);
    const start = this.start;
    if (!this.gridSnap || !start || s.ref.kind !== 'new') return s;
    const dx = s.x - start.x;
    const dz = s.z - start.z;
    if (Math.abs(dz) < Math.abs(dx) * AXIS_LOCK) return { ...s, z: start.z };
    if (Math.abs(dx) < Math.abs(dz) * AXIS_LOCK) return { ...s, x: start.x };
    return s;
  }

  private pick(ev: PointerEvent): Point | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    // Kameran kan ha flyttats sedan senaste bildrutan
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.ground, this.hit)) return null;
    return { x: this.hit.x, z: this.hit.z };
  }
}
