import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const sharedAlias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    // electron-store 11 是 ESM-only，不能被 require，需打包进主进程
    plugins: [externalizeDepsPlugin({ exclude: ['electron-store'] })],
    resolve: { alias: sharedAlias }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: { ...sharedAlias, '@renderer': resolve('src/renderer/src') }
    }
  }
})
