import type { SimConfig } from './config';
import type { Quad } from './geometry';
import type { NetworkData, RoadType } from './network';
import type { ZoneType } from './zones';

/**
 * Meddelanden mellan huvudtråden (rendering/UI) och simuleringens Web Worker.
 * Principen: kommandon in, ändringar och snapshots ut. Simuleringen äger all spelstate.
 */

/** Antal Float32-fält per fordon i en snapshot. */
export const VEH_STRIDE = 6;
/** Tätt index för vägkanten fordonet står på (vägsträcka = kant >> 1, riktning = kant & 1). */
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

/** Alla zonceller. Index = cellens id. */
export interface CellData {
  slots: number;
  x: Float32Array;
  z: Float32Array;
  dirX: Float32Array;
  dirZ: Float32Array;
  /** Zon per cell, DEAD_CELL för tomma platser. */
  zone: Uint8Array;
}

/** Nya byggnader. Index i arrayerna motsvarar ids. */
export interface BuildingData {
  ids: Int32Array;
  x: Float32Array;
  z: Float32Array;
  dirX: Float32Array;
  dirZ: Float32Array;
  width: Float32Array;
  depth: Float32Array;
  height: Float32Array;
  zone: Uint8Array;
}

export interface SimStats {
  /** Spelsekunder sedan dag 1 kl 00:00. */
  time: number;
  population: number;
  drivers: number;
  buildings: number;
  homes: number;
  jobs: number;
  filledJobs: number;
  unemployed: number;
  atHome: number;
  atWork: number;
  /** På väg in till staden för att flytta in. */
  movingIn: number;
  /** Zonade tomter som inte kan få byggnader eftersom vägarna inte når motorvägen. */
  unconnectedLots: number;
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
  | { type: 'recycle'; vehicles: ArrayBuffer; edgeLoad: ArrayBuffer }
  /** Varje väg är en eller flera sammanhängande kurvor. */
  | { type: 'buildRoads'; roads: Quad[][]; roadType: RoadType; requestId: number }
  | { type: 'bulldoze'; segments: number[] }
  | { type: 'zone'; x: number; z: number; radius: number; zone: ZoneType };

export interface SnapshotMessage {
  type: 'snapshot';
  time: number;
  /** Vägnätets version som kantindexen gäller för. */
  networkVersion: number;
  /** Spelsekunder per verklig sekund just nu – används för att extrapolera rörelse mellan snapshots. */
  speed: number;
  vehicleCount: number;
  vehicles: Float32Array;
  /** Beläggning per vägkant, 0–1 (antal fordon / kapacitet). */
  edgeLoad: Float32Array;
  stats: SimStats;
}

export type FromWorker =
  | { type: 'network'; data: NetworkData }
  | { type: 'cells'; data: CellData }
  | { type: 'cellZones'; ids: Int32Array; zones: Uint8Array }
  | { type: 'buildings'; removed: Int32Array; added: BuildingData }
  | { type: 'result'; requestId: number; built: number; failed: number; reason: string }
  | SnapshotMessage;
