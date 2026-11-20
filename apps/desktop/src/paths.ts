/**
 * @module paths
 * @description Where the desktop shell finds the web app, and which addresses its window may show.
 * Pure functions (the path rules are injectable), so they are tested without Electron or a display.
 */
import * as nodePath from 'node:path'
import { fileURLToPath } from 'node:url'

/** The part of `node:path` used here; `posix` or `win32` can be passed to test either platform. */
export type PathApi = Pick<
  typeof nodePath,
  'join' | 'resolve' | 'dirname' | 'relative' | 'isAbsolute'
>

export interface EntryContext {
  /** Whether the app is running from an installer-built package. */
  isPackaged: boolean
  /** The app's resources directory (where the packaged web build is shipped). */
  resourcesPath: string
  /** The directory of the compiled main process (`apps/desktop/dist` in development). */
  mainDir: string
}

/** The web app's `index.html`: the shipped copy when packaged, else the workspace's own build. */
export function resolveWebEntry(context: EntryContext, path: PathApi = nodePath): string {
  return context.isPackaged
    ? path.join(context.resourcesPath, 'web', 'index.html')
    : path.resolve(context.mainDir, '..', '..', 'web', 'dist', 'index.html')
}

/**
 * Whether `url` is the app page or a file inside the web build. The window may show nothing else:
 * no other file on disk, and nothing from the web.
 */
export function isAppUrl(url: string, entryPath: string, path: PathApi = nodePath): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'file:') return false
    const windows = path === nodePath.win32
    const target = path.resolve(fileURLToPath(parsed, { windows }))
    const relative = path.relative(path.dirname(path.resolve(entryPath)), target)
    return relative !== '' ? !relative.startsWith('..') && !path.isAbsolute(relative) : true
  } catch {
    return false
  }
}
