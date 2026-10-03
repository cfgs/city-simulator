/**
 * Simuleringsparametrar. Spelvärden som carShare ska senare komma från temats
 * gameplay.json – här ligger bara standardvärden för prototypen.
 */
export interface SimConfig {
  seed: number;
  /** Rutor per kartsida. */
  gridSize: number;
  /** Meter per ruta. */
  tileSize: number;
  population: number;
  /** Andel invånare som pendlar med bil. Övriga åker kollektivt (simuleras som restid). */
  carShare: number;
  /** Klockslag när simuleringen startar. */
  startHour: number;
}

export const DEFAULT_CONFIG: SimConfig = {
  seed: 1,
  gridSize: 256,
  tileSize: 16,
  population: 100_000,
  carShare: 0.4,
  startHour: 5.5,
};

/** Kartstorleken är begränsad av vägvalsträdens minne (se PLAN.md, kända begränsningar). */
const MAX_GRID = 512;

/** Läser överstyrningar från URL:en, t.ex. ?pop=200000&cars=0.6&seed=7&grid=128 */
export function configFromSearch(search: string): SimConfig {
  const params = new URLSearchParams(search);
  const num = (key: string, fallback: number, min: number, max: number): number => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  };
  return {
    ...DEFAULT_CONFIG,
    seed: Math.floor(num('seed', DEFAULT_CONFIG.seed, 0, 2 ** 31)),
    gridSize: Math.floor(num('grid', DEFAULT_CONFIG.gridSize, 32, MAX_GRID)),
    population: Math.floor(num('pop', DEFAULT_CONFIG.population, 100, 2_000_000)),
    carShare: num('cars', DEFAULT_CONFIG.carShare, 0, 1),
  };
}
