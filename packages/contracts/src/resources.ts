/**
 * @module types/resources
 * @description The resource catalogue: the 22 things a tile can hold, and the static facts about each.
 *
 * A tile has two resource slots (see `ResourceSlot` in terrain.ts): a **surface** slot (a forest, a
 * crop, a herd, or on water a fishery) and a **ground** slot (a mineral, or oil and salt under the
 * shallow sea). Each slot stores the resource's id in one byte, so the catalogue ids are 1 to 22 and
 * 0 means none.
 *
 * Only what never changes lives here (identity, appearance, layer, whether it can regrow). How much
 * of each exists, where it is found and how fast it regrows are balance, and are configured in
 * `@sovereign/config`.
 */

/** Numeric resource ids; each fits in a byte. The first seven keep the ids they always had. */
export enum ResourceType {
  None = 0,
  Timber = 1,
  Stone = 2,
  Iron = 3,
  Gold = 4,
  Grain = 5,
  Fish = 6,
  Fur = 7,
  Pasture = 8,
  Horses = 9,
  Cotton = 10,
  Spices = 11,
  Wine = 12,
  Tea = 13,
  Ivory = 14,
  Copper = 15,
  Coal = 16,
  Oil = 17,
  Silver = 18,
  Salt = 19,
  Gems = 20,
  Pearls = 21,
  Whales = 22
}

/** Which of a tile's two slots a resource occupies. */
export type ResourceLayer = 'surface' | 'ground'

/** Where a resource can exist: on land, on water, or (oil and salt) under both. */
export type ResourceDomain = 'land' | 'water' | 'both'

/** How the economy will treat it: everyday needs, industrial inputs, or luxuries. */
export type ResourceTier = 'basic' | 'industrial' | 'luxury'

export interface ResourceDef {
  /** The byte stored in a slot's `type` layer: 1 to 22. */
  readonly id: ResourceType
  /** Lower-case name; the key the config's placement rules use. */
  readonly key: string
  readonly label: string
  readonly icon: string
  readonly color: readonly [number, number, number]
  readonly layer: ResourceLayer
  readonly domain: ResourceDomain
  /** Surface resources regrow when drawn down; ground resources are finite. */
  readonly renewable: boolean
  readonly tier: ResourceTier
  /** What one unit of stock means, for display. Provisional until the economy gives it weight. */
  readonly unit: string
}

const def = (
  id: ResourceType,
  key: string,
  label: string,
  icon: string,
  color: readonly [number, number, number],
  layer: ResourceLayer,
  domain: ResourceDomain,
  tier: ResourceTier,
  unit: string
): ResourceDef => ({
  id,
  key,
  label,
  icon,
  color,
  layer,
  domain,
  renewable: layer === 'surface',
  tier,
  unit
})

/** Every resource, in id order: `RESOURCE_CATALOG[id - 1]`. */
export const RESOURCE_CATALOG: readonly ResourceDef[] = [
  def(
    ResourceType.Timber,
    'timber',
    'Timber',
    '🌲',
    [34, 120, 50],
    'surface',
    'land',
    'basic',
    'stands'
  ),
  def(
    ResourceType.Stone,
    'stone',
    'Stone',
    '🪨',
    [140, 130, 120],
    'ground',
    'land',
    'basic',
    'kilotonnes'
  ),
  def(
    ResourceType.Iron,
    'iron',
    'Iron',
    '⛏',
    [150, 60, 60],
    'ground',
    'land',
    'industrial',
    'kilotonnes'
  ),
  def(ResourceType.Gold, 'gold', 'Gold', '✦', [240, 190, 30], 'ground', 'land', 'luxury', 'tonnes'),
  def(
    ResourceType.Grain,
    'grain',
    'Grain',
    '🌾',
    [226, 196, 74],
    'surface',
    'land',
    'basic',
    'harvests'
  ),
  def(
    ResourceType.Fish,
    'fish',
    'Fish',
    '🐟',
    [60, 140, 200],
    'surface',
    'water',
    'basic',
    'catches'
  ),
  def(
    ResourceType.Fur,
    'fur',
    'Fur & Game',
    '🦌',
    [112, 84, 66],
    'surface',
    'land',
    'basic',
    'catches'
  ),
  def(
    ResourceType.Pasture,
    'pasture',
    'Pasture',
    '🐄',
    [146, 204, 108],
    'surface',
    'land',
    'basic',
    'herds'
  ),
  def(
    ResourceType.Horses,
    'horses',
    'Horses',
    '🐎',
    [176, 112, 60],
    'surface',
    'land',
    'industrial',
    'herds'
  ),
  def(
    ResourceType.Cotton,
    'cotton',
    'Cotton',
    '☁',
    [240, 240, 230],
    'surface',
    'land',
    'industrial',
    'harvests'
  ),
  def(
    ResourceType.Spices,
    'spices',
    'Spices',
    '🌶',
    [214, 74, 40],
    'surface',
    'land',
    'luxury',
    'harvests'
  ),
  def(
    ResourceType.Wine,
    'wine',
    'Wine',
    '🍇',
    [128, 40, 96],
    'surface',
    'land',
    'luxury',
    'harvests'
  ),
  def(
    ResourceType.Tea,
    'tea',
    'Tea',
    '🍵',
    [96, 150, 120],
    'surface',
    'land',
    'luxury',
    'harvests'
  ),
  def(
    ResourceType.Ivory,
    'ivory',
    'Ivory',
    '🐘',
    [222, 204, 160],
    'surface',
    'land',
    'luxury',
    'tusks'
  ),
  def(
    ResourceType.Copper,
    'copper',
    'Copper',
    '🔶',
    [64, 176, 150],
    'ground',
    'land',
    'industrial',
    'kilotonnes'
  ),
  def(
    ResourceType.Coal,
    'coal',
    'Coal',
    '⚫',
    [40, 40, 48],
    'ground',
    'land',
    'industrial',
    'kilotonnes'
  ),
  def(
    ResourceType.Oil,
    'oil',
    'Oil',
    '🛢',
    [60, 24, 96],
    'ground',
    'both',
    'industrial',
    'kilobarrels'
  ),
  def(
    ResourceType.Silver,
    'silver',
    'Silver',
    '🥈',
    [190, 195, 205],
    'ground',
    'land',
    'luxury',
    'tonnes'
  ),
  def(
    ResourceType.Salt,
    'salt',
    'Salt',
    '🧂',
    [170, 235, 245],
    'ground',
    'both',
    'basic',
    'kilotonnes'
  ),
  def(
    ResourceType.Gems,
    'gems',
    'Gems',
    '💎',
    [200, 60, 200],
    'ground',
    'land',
    'luxury',
    'carats'
  ),
  def(
    ResourceType.Pearls,
    'pearls',
    'Pearls',
    '⚪',
    [230, 170, 210],
    'surface',
    'water',
    'luxury',
    'dives'
  ),
  def(
    ResourceType.Whales,
    'whales',
    'Whales',
    '🐋',
    [30, 70, 140],
    'surface',
    'water',
    'industrial',
    'catches'
  )
]

/** The definition of resource `id`, or `undefined` for none (0) and anything that is not a resource. */
export function resourceDef(id: number): ResourceDef | undefined {
  return Number.isInteger(id) && id >= 1 && id <= RESOURCE_CATALOG.length
    ? RESOURCE_CATALOG[id - 1]
    : undefined
}
