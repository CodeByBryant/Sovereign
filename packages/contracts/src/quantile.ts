/**
 * @module quantile
 * @description The shape of a quantile profile: knots `[quantile, value]` of a monotone map from a
 * field's rank (0 = lowest tile, 1 = highest) to the value that rank should receive. The first
 * knot is at quantile 0, the last at quantile 1, quantiles strictly increase and values never
 * decrease. Used to give terrain fields the distribution the biome table expects.
 */
export type QuantileProfile = ReadonlyArray<readonly [quantile: number, value: number]>
