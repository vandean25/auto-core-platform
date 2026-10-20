import path from 'node:path'
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

const base = viteConfig({ mode: 'test', command: 'serve' })

export default mergeConfig(
  base,
  defineConfig({
    resolve: {
      alias: [
        { find: '@', replacement: path.resolve(import.meta.dirname, './src') },
      ],
    },
  }),
)
