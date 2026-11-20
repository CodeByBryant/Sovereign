/**
 * @module @sovereign/renderer
 * @description The pure part of the renderer: camera, view math and the palettes that turn terrain
 * fields into pixels. No DOM drawing and no PixiJS, so it runs anywhere (including in a worker).
 * The PixiJS map renderer is in `@sovereign/renderer/pixi`. Depends only on `@sovereign/contracts`.
 */
export * from './Camera'
export * from './palettes'
export * from './view'
