import path from 'node:path'
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

const base = viteConfig({ mode: 'test', command: 'serve' })

export default mergeConfig(
  base,
  defineConfig({
    resolve: {
      alias: [
        {
          find: '@/components/navigation/TenantSwitcher',
          replacement: path.resolve(import.meta.dirname, './src/components/navigation/TenantSwitcherView.tsx'),
        },
        {
          find: '@/components/navigation/SiteSwitcher',
          replacement: path.resolve(import.meta.dirname, './src/components/navigation/SiteSwitcherShell.tsx'),
        },
        {
          find: '@/components/navigation/AppSidebarFooter',
          replacement: path.resolve(import.meta.dirname, './src/components/navigation/AppSidebarFooterShell.tsx'),
        },
        { find: '@', replacement: path.resolve(import.meta.dirname, './src') },
      ],
    },
  }),
)
