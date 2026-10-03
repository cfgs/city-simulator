import * as THREE from 'three';
import { resample, sampleQuad, type Quad } from '../shared/geometry';
import { ROAD_SPECS, type RoadSegment, type RoadType } from '../shared/network';
import type { RoadPlan, StopRef } from '../shared/roadplan';
import { MeshBuilder, rgb, type Rgb } from './meshBuilder';
import { ROAD_Y } from './roads';

const VALID = rgb(0x4aa3ff);
const INVALID = rgb(0xff4a4a);
const JUNCTION = rgb(0xffffff);
const HIGHLIGHT = rgb(0xff5a3c);
const Y = ROAD_Y + 0.2;

/** Förhandsvisning för verktygen: planerad väg, nya korsningar, markörer och pensel. */
export class Preview {
  readonly group = new THREE.Group();
  private readonly material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false });
  private readonly lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });

  constructor() {
    this.group.renderOrder = 2;
  }

  clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) child.geometry.dispose();
    }
  }

  /** Visar en planerad väg: blå om den går att bygga, röd annars. Vita prickar = korsningar. */
  showPlan(plan: RoadPlan, extra?: (b: MeshBuilder) => void): void {
    this.clear();
    const b = new MeshBuilder();
    const color = plan.valid ? VALID : INVALID;
    for (const { curve, stops } of plan.curves) {
      this.road(b, curve, plan.type, color);
      for (const s of stops) if (isJunction(s.ref)) disc(b, s.x, s.z, ROAD_SPECS[plan.type].halfWidth * 0.6, JUNCTION);
    }
    extra?.(b);
    this.add(b);
  }

  /** Flera vägar samtidigt (rutnätsverktyget). */
  showRoads(curves: Quad[], valid: boolean[], type: RoadType): void {
    this.clear();
    const b = new MeshBuilder();
    curves.forEach((c, i) => this.road(b, c, type, valid[i] ? VALID : INVALID));
    this.add(b);
  }

  showCursor(x: number, z: number, snapped: StopRef | null): void {
    this.clear();
    const b = new MeshBuilder();
    disc(b, x, z, snapped && snapped.kind !== 'new' ? 4 : 2.5, snapped && snapped.kind !== 'new' ? JUNCTION : VALID);
    this.add(b);
  }

  showBrush(x: number, z: number, radius: number): void {
    this.clear();
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      points.push(new THREE.Vector3(x + Math.cos(a) * radius, Y, z + Math.sin(a) * radius));
    }
    this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), this.lineMaterial));
  }

  showSegment(seg: RoadSegment | null): void {
    this.clear();
    if (!seg) return;
    const b = new MeshBuilder();
    const hw = ROAD_SPECS[seg.type].halfWidth;
    b.ribbon(resample(seg.poly, 0, seg.poly.length, 3), -hw - 1, hw + 1, Y, HIGHLIGHT);
    this.add(b);
  }

  /** Hjälplinjer från kurvans start via kontrollpunkten (kurvverktyget). */
  addGuide(points: { x: number; z: number }[]): void {
    const v = points.map((p) => new THREE.Vector3(p.x, Y, p.z));
    this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), this.lineMaterial));
  }

  private road(b: MeshBuilder, curve: Quad, type: RoadType, color: Rgb): void {
    const poly = sampleQuad(curve);
    const hw = ROAD_SPECS[type].halfWidth;
    b.ribbon(resample(poly, 0, poly.length, 3), -hw, hw, Y, color);
  }

  private add(b: MeshBuilder): void {
    if (b.vertexCount === 0) return;
    const mesh = new THREE.Mesh(b.build(), this.material);
    mesh.renderOrder = 2;
    this.group.add(mesh);
  }
}

function isJunction(ref: StopRef): boolean {
  return ref.kind !== 'new';
}

export function disc(b: MeshBuilder, x: number, z: number, r: number, color: Rgb): void {
  const points: [number, number][] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    points.push([x + Math.cos(a) * r, z + Math.sin(a) * r]);
  }
  b.convex(points, Y + 0.05, color);
}
