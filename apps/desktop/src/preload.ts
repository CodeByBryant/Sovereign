import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('sovereign', {
  version: '0.1.0'
})
