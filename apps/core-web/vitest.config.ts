import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

const base = viteConfig({ mode: 'test', command: 'serve' })

const legacyEnglishUiSpecs = [
  'src/pages/LandingDemoEmailLinkCompletionPage.test.tsx',
  'src/components/navigation/AppSidebar.vehicle-gewaehrleistung.test.tsx',
]

export default mergeConfig(
  base,
  defineConfig({
    test: {
      exclude: [...(base.test?.exclude ?? configDefaults.exclude), ...legacyEnglishUiSpecs],
    },
  }),
)
