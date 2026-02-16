/**
 * @module NameGenerator
 * @description Procedural nation name generator.
 *
 * Combines prefixes, roots, and suffixes to create plausible-sounding
 * fantasy nation names. Optionally prepends a government-style prefix
 * like "Republic of" or "United".
 *
 * @example
 * ```ts
 * const gen = new NameGenerator(42)
 * gen.generate() // → "United Aldoria"
 * ```
 */
import alea from 'alea'

const PREFIXES = [
  'Al',
  'Bel',
  'Cor',
  'Dra',
  'El',
  'Fal',
  'Gar',
  'Hal',
  'Ir',
  'Kal',
  'Lor',
  'Mar',
  'Nor',
  'Or',
  'Pel',
  'Rav',
  'Sol',
  'Tal',
  'Val',
  'Zan',
  'Ar',
  'Br',
  'Car',
  'Dur',
  'Eth',
  'Fen',
  'Gol',
  'Hel',
  'Is',
  'Jen',
  'Kir',
  'Lun',
  'Mon',
  'Nev',
  'Os',
  'Pyr',
  'Rin',
  'Ser',
  'Ther',
  'Ul',
  'Vos',
  'Wyr',
  'Xan',
  'Yar',
  'Zeph'
]

const ROOTS = [
  'dor',
  'mar',
  'ven',
  'gal',
  'tan',
  'ber',
  'col',
  'fin',
  'gor',
  'hel',
  'kan',
  'lar',
  'mun',
  'nar',
  'por',
  'ras',
  'sil',
  'tor',
  'var',
  'wyn',
  'dal',
  'eth',
  'gar',
  'ith',
  'kal',
  'mer',
  'oth',
  'ran',
  'sar',
  'vel',
  'az',
  'en',
  'il',
  'on',
  'ur',
  'ash',
  'eld',
  'im',
  'ov',
  'ul'
]

const SUFFIXES = [
  'ia',
  'and',
  'ria',
  'oth',
  'en',
  'is',
  'on',
  'um',
  'ar',
  'heim',
  'gar',
  'land',
  'mark',
  'nia',
  'stan',
  'burg',
  'ford',
  'shire',
  'vale',
  'wick',
  'ora',
  'ica',
  'alia',
  'ania',
  'ovia',
  'eria',
  'inia',
  'olia',
  'uria',
  'avia'
]

const TITLES = [
  'Kingdom of',
  'Republic of',
  'Empire of',
  'United',
  'Grand Duchy of',
  'Confederation of',
  'Commonwealth of',
  'Dominion of',
  'Federation of',
  'Free State of',
  'Principality of',
  'Sultanate of'
]

export class NameGenerator {
  private rng: () => number
  private usedNames = new Set<string>()

  constructor(seed: string | number) {
    this.rng = alea(`${seed}-names`)
  }

  /** Pick a random element from an array using the seeded RNG. */
  private pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.rng() * arr.length)]
  }

  /**
   * Generate a unique nation name.
   *
   * Retries up to 50 times to avoid duplicates within a session.
   */
  generate(): string {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const base = this.pick(PREFIXES) + this.pick(ROOTS) + this.pick(SUFFIXES)
      // ~40% chance of a government prefix
      const withTitle = this.rng() < 0.4 ? `${this.pick(TITLES)} ${base}` : base
      if (!this.usedNames.has(withTitle)) {
        this.usedNames.add(withTitle)
        return withTitle
      }
    }
    // Fallback: numeric suffix
    const fallback = `Nation-${this.usedNames.size + 1}`
    this.usedNames.add(fallback)
    return fallback
  }
}
