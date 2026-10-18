// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import deAgent from '../../../../../locales/de/agent.json'
import enAgent from '../../../../../locales/en/agent.json'
import { changeUiLanguage, ensureNamespaceLoaded } from '@/lib/i18n'
import {
  formatDefaultSupervisionChangeLabel,
  formatDetailSupervisionChangeLabel,
  getDefaultSupervisionChanges,
  isInternalSupervisionChange,
  parseWouldChangeFromPreview,
} from './agent-proposal-change-preview'

describe('agent-proposal-change-preview', () => {
  const previewWithSite = {
    would_change: [
      {
        entity: 'WorkshopTaskLineItem',
        id: 'line-1',
        op: 'create',
        provisional: true,
      },
      {
        entity: 'Site',
        id: 'site-1',
        op: 'update',
        provisional: false,
      },
    ],
  }

  beforeAll(async () => {
    await ensureNamespaceLoaded('agent')
    await changeUiLanguage('de')
  })

  it('parses would_change from preview_json', () => {
    expect(parseWouldChangeFromPreview(previewWithSite)).toEqual([
      {
        entity: 'WorkshopTaskLineItem',
        id: 'line-1',
        op: 'create',
        provisional: true,
      },
      {
        entity: 'Site',
        id: 'site-1',
        op: 'update',
        provisional: false,
      },
    ])
  })

  it('treats Site update as internal', () => {
    const siteChange = {
      entity: 'Site',
      id: 'site-1',
      op: 'update' as const,
    }
    expect(isInternalSupervisionChange(siteChange)).toBe(true)
    expect(getDefaultSupervisionChanges(parseWouldChangeFromPreview(previewWithSite))).toHaveLength(
      1,
    )
  })

  it('formats business changes for the default preview', async () => {
    const lineChange = {
      entity: 'WorkshopTaskLineItem',
      id: 'line-1',
      op: 'create' as const,
    }
    await changeUiLanguage('en')
    expect(formatDefaultSupervisionChangeLabel(lineChange)).toBe(
      `${enAgent.changePreview.entities.WorkshopTaskLineItem} — ${enAgent.changePreview.ops.create}`,
    )
    await changeUiLanguage('de')
    expect(formatDefaultSupervisionChangeLabel(lineChange)).toBe(
      `${deAgent.changePreview.entities.WorkshopTaskLineItem} — ${deAgent.changePreview.ops.create}`,
    )
  })

  it('uses workshop language for Site update under Show details only', async () => {
    const siteChange = {
      entity: 'Site',
      id: 'site-1',
      op: 'update' as const,
    }
    await changeUiLanguage('en')
    expect(formatDetailSupervisionChangeLabel(siteChange)).toBe(
      enAgent.approvals.workshopLocation,
    )
    await changeUiLanguage('de')
    expect(formatDetailSupervisionChangeLabel(siteChange)).toBe(
      deAgent.approvals.workshopLocation,
    )
  })
})
