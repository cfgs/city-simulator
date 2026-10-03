/**
 * Simuleringsparametrar. Spelvärden som carShare ska senare komma från temats
 * gameplay.json – här ligger bara standardvärden.
 */
export interface SimConfig {
  seed: number;
  /** Kartans sida i meter. */
  mapSize: number;
  /** Andel invånare som pendlar med bil. Övriga åker kollektivt (simuleras som restid). */
  carShare: number;
  /** Klockslag när simuleringen startar. */
  startHour: number;
  /** Starta med en färdigbyggd stad (för prestandatest) i stället för tom karta. */
  demo: boolean;
}

export const DEFAULT_CONFIG: SimConfig = {
  seed: 1,
  mapSize: 4096,
  carShare: 0.4,
  startHour: 6,
  demo: false,
};

/** Läser överstyrningar från URL:en, t.ex. ?demo&cars=0.6&seed=7 */
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
    carShare: num('cars', DEFAULT_CONFIG.carShare, 0, 1),
    demo: params.has('demo'),
  };
}
