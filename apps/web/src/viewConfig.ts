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
  camera: {
    /** Minimum zoom level (fully zoomed out). */
    minZoom: 0.2,
    /** Maximum zoom level (fully zoomed in). */
    maxZoom: 10,
    /** Multiplicative step per scroll tick. */
    zoomStep: 0.1
  }
} as const
