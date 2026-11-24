// @vitest-environment node
import { describe, expect, it } from 'vitest'

import deFinance from '../../../../../../locales/de/finance.json'
import enFinance from '../../../../../../locales/en/finance.json'
import deWorkshop from '../../../../../../locales/de/workshop.json'
import enWorkshop from '../../../../../../locales/en/workshop.json'
import allowlist from './compact-copy-allowlist.json'
import { diffBaseline } from './baseline-ratchet'
import { evaluateCompactCopyGuard } from './compact-copy'
import { productionSources } from './production-sources'

const entriesFor = (sources: Record<string, string>) => evaluateCompactCopyGuard(sources).entries

describe('compact copy guard (AUT-1036)', () => {
  it('fails when a page adds an unlisted subtitle under h1', () => {
    const current = entriesFor({
      'pages/example/ExampleList.tsx': `
        export function ExampleList() {
          return (
            <div>
              <h1>{t('example.title')}</h1>
              <p className="text-muted-foreground">{t('example.subtitle')}</p>
            </div>
          )
        }
      `,
    })

    const { added } = diffBaseline(current, [])

    expect(added).toEqual([
      'pages/example/ExampleList.tsx::key:example.subtitle',
      'pages/example/ExampleList.tsx::page-header-subtitle',
    ])
  })

  it('fails when a component adds an unlisted DialogDescription or helper description key', () => {
    const current = entriesFor({
      'features/example/ExampleDialog.tsx': `
        export function ExampleDialog() {
          return (
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('example.title')}</DialogTitle>
                <DialogDescription>{t('example.helper')}</DialogDescription>
              </DialogHeader>
            </DialogContent>
          )
        }
      `,
    })

    const { added } = diffBaseline(current, [])

    expect(added).toEqual(['features/example/ExampleDialog.tsx::dialog-description'])
  })

  it('ignores sr-only descriptions and table column description headers', () => {
    const current = entriesFor({
      'features/example/ExampleTable.tsx': `
        export function ExampleTable() {
          return (
            <>
              <DialogDescription className="sr-only">{t('example.a11y')}</DialogDescription>
              <TableHead>{t('example.columns.description')}</TableHead>
            </>
          )
        }
      `,
    })

    expect(current).toEqual([])
  })

  it('matches the checked-in allowlist with no unlisted subtitles or stale entries', () => {
    const { entries } = evaluateCompactCopyGuard(productionSources)
    const { added, stale } = diffBaseline(entries, allowlist.allowed)

    expect(added).toEqual([])
    expect(stale).toEqual([])
  })

  it('keeps invoice settlement and workshop pick drawer free of removed helper sentences', () => {
    expect(deFinance.settlement.fullSettlement).not.toContain('für die Werkstattrechnung')
    expect(enFinance.settlement.fullSettlement).not.toContain('for the workshop invoice')
    for (const [path, source] of Object.entries(productionSources)) {
      expect(source, path).not.toContain('pick.drawer.chooseTote')
    }
    expect(deWorkshop.pick.drawer.chooseTote).toBeTruthy()
    expect(enWorkshop.pick.drawer.chooseTote).toBeTruthy()
  })
})
