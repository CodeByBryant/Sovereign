/**
 * @module Nation
 * @description Core nation entity for the Sovereign world simulation.
 *
 * Each nation owns a set of tile indices (provinces), has stats for
 * military/economy/population/diplomacy, personality traits that drive
 * AI behaviour, and visual identity (color, flag pattern).
 */

/* ------------------------------------------------------------------ */
/*  Enums & types                                                      */
/* ------------------------------------------------------------------ */

export type GovernmentType =
  | 'monarchy'
  | 'republic'
  | 'democracy'
  | 'theocracy'
  | 'empire'
  | 'tribal'
  | 'oligarchy'
  | 'dictatorship'

export interface NationPersonality {
  /** Willingness to start wars (0–1). */
  aggression: number
  /** Drive to claim unclaimed land (0–1). */
  expansionism: number
  /** Preference for diplomatic solutions (0–1). */
  diplomacy: number
  /** Investment in trade / economy (0–1). */
  mercantilism: number
  /** Tendency to build military (0–1). */
  militarism: number
}

export interface FlagPattern {
  /** Base background colour [H, S, L]. */
  background: [number, number, number]
  /** Pattern type for rendering. */
  type: 'solid' | 'horizontal_stripes' | 'vertical_stripes' | 'cross' | 'diagonal' | 'quartered'
  /** Secondary colour [H, S, L]. */
  accent: [number, number, number]
  /** Tertiary colour for some patterns [H, S, L]. */
  detail?: [number, number, number]
}

export interface NationStats {
  population: number
  military: number
  economy: number
  diplomacy: number
}

/* ------------------------------------------------------------------ */
/*  Nation class                                                        */
/* ------------------------------------------------------------------ */

/**
 * Represents a single nation on the world map.
 *
 * Provinces are stored as tile flat-indices into the world map grid.
 * The `capital` is the spawn tile from which the nation originated.
 */
export class Nation {
  readonly id: string
  readonly name: string
  /** Display colour as [R, G, B] in 0–255. */
  readonly color: [number, number, number]
  readonly flag: FlagPattern
  readonly founded: number
  readonly government: GovernmentType
  readonly personality: NationPersonality

  /** Set of flat tile indices owned by this nation. */
  provinces: Set<number>
  /** Flat tile index of the capital. */
  capital: number
  stats: NationStats

  constructor(opts: {
    id: string
    name: string
    color: [number, number, number]
    flag: FlagPattern
    government: GovernmentType
    personality: NationPersonality
    capital: number
    provinces?: Set<number>
    stats?: Partial<NationStats>
    founded?: number
  }) {
    this.id = opts.id
    this.name = opts.name
    this.color = opts.color
    this.flag = opts.flag
    this.government = opts.government
    this.personality = opts.personality
    this.capital = opts.capital
    this.provinces = opts.provinces ?? new Set<number>()
    this.founded = opts.founded ?? 0
    this.stats = {
      population: opts.stats?.population ?? 100,
      military: opts.stats?.military ?? 100,
      economy: opts.stats?.economy ?? 50,
      diplomacy: opts.stats?.diplomacy ?? 50
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Province management                                              */
  /* ---------------------------------------------------------------- */

  /** Claim a tile index as territory. */
  addProvince(index: number): void {
    this.provinces.add(index)
  }

  /** Release a tile index from territory. */
  removeProvince(index: number): void {
    this.provinces.delete(index)
  }

  /** Total number of owned tiles. */
  get totalArea(): number {
    return this.provinces.size
  }

  /**
   * Return the subset of province indices that border a tile owned by
   * a different nation or unclaimed land.
   *
   * @param mapWidth Width of the world grid (tiles).
   * @param mapHeight Height of the world grid (tiles).
   * @param ownerMap Per-tile nation id lookup (empty string = unclaimed).
   */
  getBorderProvinces(mapWidth: number, mapHeight: number, ownerMap: string[]): Set<number> {
    const borders = new Set<number>()
    for (const idx of this.provinces) {
      const x = idx % mapWidth
      const y = (idx - x) / mapWidth
      const neighbors = [
        x > 0 ? idx - 1 : -1,
        x < mapWidth - 1 ? idx + 1 : -1,
        y > 0 ? idx - mapWidth : -1,
        y < mapHeight - 1 ? idx + mapWidth : -1
      ]
      for (const ni of neighbors) {
        if (ni >= 0 && ownerMap[ni] !== this.id) {
          borders.add(idx)
          break
        }
      }
    }
    return borders
  }
}
