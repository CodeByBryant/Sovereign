/**
 * The Electron main process: opens one window on the web app. The window may show only the app
 * itself (see `paths.ts`), has no Node integration, and is isolated from the page.
 */
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { isAppUrl, resolveWebEntry } from './paths'

const entry = resolveWebEntry({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  mainDir: __dirname
})

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#050607',
    title: 'Sovereign',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())

  // The window shows the app and nothing else: no navigation away, no new windows.
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, entry)) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  void window.loadFile(entry)
}

void app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
