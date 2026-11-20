import { contextBridge } from 'electron'

// The one thing the page may know about its host: that it is the desktop shell, and on what.
contextBridge.exposeInMainWorld('sovereign', {
  desktop: true,
  platform: process.platform
})
