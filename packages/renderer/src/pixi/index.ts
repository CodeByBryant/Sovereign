/**
 * @module @sovereign/renderer/pixi
 * @description The PixiJS map renderer. Import from here (not from the package root) so that code
 * which only needs the pure parts of the renderer never loads PixiJS.
 */
export { MapRenderer } from './MapRenderer'
export type { MapRendererOptions } from './MapRenderer'
