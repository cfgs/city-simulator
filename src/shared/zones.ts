/** Zonceller är kvadrater längs vägarna, CELL meter stora och upp till DEPTH rader djupa. */
export const CELL = 8;
export const DEPTH = 4;

export const ZoneType = { None: 0, Residential: 1, Commercial: 2, Industrial: 3 } as const;
export type ZoneType = (typeof ZoneType)[keyof typeof ZoneType];

/** Markerar en tom cellplats i data som skickas till renderingen. */
export const DEAD_CELL = 255;
