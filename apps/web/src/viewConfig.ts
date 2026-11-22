/**
 * @module viewConfig
 * @description Display settings owned by the web app (not engine config).
 */
export const viewConfig = {
  canvas: {
    /** CSS background colour drawn behind the map. */
    background: '#050607',
    /** Target frames-per-second for the render loop. */
    targetFps: 60
  },
  /** How the tile map is drawn. */
  map: {
    /** Each tile is drawn as `tileSize x tileSize` canvas pixels. */
    tileSize: 4
  },
  /** The political (nation territory) overlay. */
  political: {
    /** Alpha blend for territory fill (0 to 1). */
    alpha: 0.45,
    /** Darkening factor for border tiles (0 to 1). */
    darken: 0.35,
    /** How much the lines between the provinces of one nation dim the map (0 to 1). */
    provinceDarken: 0.18
  },
  camera: {
    /** Minimum zoom level (fully zoomed out). */
    minZoom: 0.2,
    /** Maximum zoom level (fully zoomed in). */
    maxZoom: 10,
    /** Multiplicative step per scroll tick. */
    zoomStep: 0.1
  }
} as const
