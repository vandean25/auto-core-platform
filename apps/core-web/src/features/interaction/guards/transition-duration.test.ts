// @vitest-environment node
import { describe, expect, it } from 'vitest'

import baseline from './transition-duration.baseline.json'
import { UPDATE_BASELINES, writeGuardBaseline } from './baseline-files'
import { diffBaseline } from './baseline-ratchet'
import { productionSources } from './production-sources'
import { evaluateDurationGuard, FINITE_TRANSITION_CAP_MS } from './transition-duration'

const violationsFor = (sources: Record<string, string>) => evaluateDurationGuard(sources).violations

describe('transition duration guard (ADR-0036 R6)', () => {
  it('fails a finite transition above 200 ms', () => {
    const violations = violationsFor({
      'components/ui/Drawer.tsx': `
        export function Drawer() {
          return <aside className="fixed inset-y-0 right-0 transition-transform duration-300 ease-out" />
        }
      `,
    })

    expect(violations).toEqual(['components/ui/Drawer.tsx::tailwind::duration-300'])
    expect(FINITE_TRANSITION_CAP_MS).toBe(200)
  })

  it('passes durations at or below the cap, including shared token classes and reduced motion', () => {
    const violations = violationsFor({
      'components/ui/Popover.tsx': `
        import { motionDurationClass } from '@/lib/motion-tokens'
        const content = \`rounded-md \${motionDurationClass.ui} motion-reduce:duration-0\`
        export const sheet = 'transition-transform duration-200 md:duration-150'
      `,
    })

    expect(violations).toEqual([])
  })

  it.each([
    {
      name: 'an arbitrary Tailwind value',
      path: 'components/Toast.tsx',
      source: "export const cls = 'transition-opacity duration-[400ms]'",
      expected: ['components/Toast.tsx::tailwind::duration-[400ms]'],
    },
    {
      name: 'a variant-prefixed Tailwind class',
      path: 'components/Panel.tsx',
      source: "export const cls = 'duration-150 md:hover:duration-500'",
      expected: ['components/Panel.tsx::tailwind::duration-500'],
    },
    {
      name: 'a framer-motion transition in seconds',
      path: 'pages/Ledger.tsx',
      source: `
        import { motion } from 'framer-motion'
        export const Card = () => <motion.div animate={{ opacity: 1, transition: { duration: 0.35 } }} />
      `,
      expected: ['pages/Ledger.tsx::js::duration=350ms'],
    },
    {
      name: 'a dnd-kit drop animation in milliseconds',
      path: 'pages/Board.tsx',
      source: `
        import { DragOverlay } from '@dnd-kit/core'
        export const dropAnimation = { duration: 250, easing: 'ease' }
      `,
      expected: ['pages/Board.tsx::js::duration=250ms'],
    },
    {
      name: 'an inline transition style',
      path: 'components/Bar.tsx',
      source: "export const style = { transition: 'width 0.4s ease, opacity 150ms' }",
      expected: ['components/Bar.tsx::js::transition=400ms'],
    },
    {
      name: 'CSS transition and animation declarations',
      path: 'index.css',
      source: `
        .toast { transition: transform 300ms ease, opacity 150ms ease; }
        .banner { animation: slide-in 0.5s ease-out; }
        .fast { transition-duration: 120ms; }
      `,
      expected: ['index.css::css::animation=500ms', 'index.css::css::transition=300ms'],
    },
    {
      name: 'a CSS duration resolved through a custom property',
      path: 'index.css',
      source: `
        :root { --slow: 0.6s; }
        .panel { transition: opacity var(--slow) ease; }
      `,
      expected: ['index.css::css::transition=600ms'],
    },
    {
      name: 'a Tailwind class applied from CSS',
      path: 'index.css',
      source: '.chip { @apply transition-colors duration-700; }',
      expected: ['index.css::tailwind::duration-700'],
    },
  ])('fails $name', ({ path, source, expected }) => {
    expect(violationsFor({ [path]: source })).toEqual(expected)
  })

  it.each([
    {
      name: 'an interpolated Tailwind class',
      path: 'components/Dyn.tsx',
      source: 'export const cls = (ms: number) => `transition-all duration-${ms}`',
      expected: ['components/Dyn.tsx::tailwind-dynamic::duration-${ms}'],
    },
    {
      name: 'a variable framer-motion duration',
      path: 'components/Dyn.tsx',
      source: `
        import { motion } from 'framer-motion'
        export const Card = ({ seconds }: { seconds: number }) => (
          <motion.div transition={{ duration: seconds }} />
        )
      `,
      expected: ['components/Dyn.tsx::js-dynamic::duration=seconds'],
    },
    {
      name: 'a CSS duration from an unknown custom property',
      path: 'components/dyn.css',
      source: '.panel { transition: opacity var(--theme-speed) ease; }',
      expected: ['components/dyn.css::css-dynamic::transition=var(--theme-speed)'],
    },
  ])('requires review for $name instead of passing it silently', ({ path, source, expected }) => {
    expect(violationsFor({ [path]: source })).toEqual(expected)
  })

  it('resolves shared duration tokens in motion code and keeps them within the cap', () => {
    const violations = violationsFor({
      'components/Fade.tsx': `
        import { motion } from 'framer-motion'
        import { motionDurationMs } from '@/lib/motion-tokens'
        export const Fade = () => (
          <motion.div transition={{ duration: motionDurationMs.ui / 1000 }} exit={{ transition: { duration: motionDurationMs.overlay / 1000 } }} />
        )
      `,
    })

    expect(violations).toEqual([])
  })

  it('classifies repeating functional indicators separately from finite transitions', () => {
    const result = evaluateDurationGuard({
      'components/Loader.tsx': `
        import { motion } from 'framer-motion'
        export const spin = 'animate-spin duration-1000'
        export const Pulse = () => <motion.div transition={{ duration: 2, repeat: Infinity }} />
      `,
      'index.css': '.shimmer { animation: shimmer 1.4s linear infinite; }',
    })

    expect(result.violations).toEqual([])
    expect(result.repeating).toEqual([
      'components/Loader.tsx::js::duration=2000ms',
      'components/Loader.tsx::tailwind::duration-1000',
      'index.css::css::animation=1400ms',
    ])
  })

  it('does not scan non-motion timings such as debounce, skeleton delay or toast lifetime', () => {
    const violations = violationsFor({
      'lib/timings.ts': `
        export const SAVE_DEBOUNCE_MS = 750
        export const SKELETON_DELAY_MS = 200
        export const toastOptions = { duration: 6000 }
        setTimeout(flush, 350)
      `,
    })

    expect(violations).toEqual([])
  })

  it('ignores a duration written only in a comment', () => {
    expect(violationsFor({ 'components/Note.tsx': "// transition duration-700 was removed\nexport const cls = 'duration-150'" })).toEqual([])
  })

  describe('current main', () => {
    const { violations } = evaluateDurationGuard(productionSources)

    it('matches the baseline: no new slow or unreviewed duration, no stale entry', () => {
      if (UPDATE_BASELINES) {
        writeGuardBaseline('guards', 'transition-duration.baseline.json', 'transition-duration', violations)
        return
      }

      const { added, stale } = diffBaseline(violations, baseline.violations)

      expect(
        added,
        'Use motionDurationClass / motionDurationMs (src/lib/motion-tokens.ts): finite transitions are 150 ms, sheets and dialogs 200 ms.',
      ).toEqual([])
      expect(stale, 'Migrated: remove these lines from transition-duration.baseline.json.').toEqual([])
    })
  })
})
