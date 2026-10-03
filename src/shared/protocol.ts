import type { SimConfig } from './config';

/**
 * Meddelanden mellan huvudtråden (rendering/UI) och simuleringens Web Worker.
 * Principen: kommandon in, ändringar/snapshots ut. Simuleringen äger all spelstate.
 */

/** Antal Float32-fält per fordon i en snapshot. */
export const VEH_STRIDE = 6;
/** Index för vägkanten fordonet står på. */
export const V_EDGE = 0;
/** Körfält (0 = närmast mittlinjen). */
export const V_LANE = 1;
/** Position längs kanten, 0–1. */
export const V_PROGRESS = 2;
/** Fart i andel av kanten per spelsekund (0 om fordonet står i kö). */
export const V_RATE = 3;
/** Längsta positionen fordonet kan nå utan att köra in i kön framför. */
export const V_MAX = 4;
/** Fordonets id (för stabil färg). */
export const V_ID = 5;

/** Statisk världsdata som renderingen behöver. Skickas en gång efter generering. */
export interface WorldData {
  /** Kartans sida i meter. */
  size: number;
  tileSize: number;
  nodeX: Float32Array;
  nodeZ: Float32Array;
  edgeFrom: Int32Array;
  edgeTo: Int32Array;
  edgeLanes: Uint8Array;
  buildingX: Float32Array;
  buildingZ: Float32Array;
  buildingZone: Uint8Array;
  buildingHeight: Float32Array;
  /** Största antalet fordon som kan finnas i en snapshot (antal bilägare). */
  maxVehicles: number;
}

export interface SimStats {
  /** Spelsekunder sedan dag 1 kl 00:00. */
  time: number;
  population: number;
  drivers: number;
  atHome: number;
  atWork: number;
  onRoad: number;
  waitingToEnter: number;
  inTransit: number;
  routeTrees: number;
  avgCarTripMin: number;
  tickMs: number;
  ticksPerSec: number;
  effectiveSpeed: number;
}

export type ToWorker =
  | { type: 'init'; config: SimConfig }
  /** Spelsekunder per verklig sekund. 0 = paus, Infinity = så fort som möjligt. */
  | { type: 'speed'; speed: number }
  /** Lämnar tillbaka snapshot-buffertar så att workern slipper allokera nya. */
  | { type: 'recycle'; vehicles: ArrayBuffer; edgeLoad: ArrayBuffer };

export interface SnapshotMessage {
  type: 'snapshot';
  time: number;
  /** Spelsekunder per verklig sekund just nu – används för att extrapolera rörelse mellan snapshots. */
  speed: number;
  vehicleCount: number;
  vehicles: Float32Array;
  /** Beläggning per vägkant, 0–1 (antal fordon / kapacitet). */
  edgeLoad: Float32Array;
  stats: SimStats;
}

export type FromWorker = { type: 'world'; world: WorldData } | SnapshotMessage;
