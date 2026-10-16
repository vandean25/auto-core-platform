// @vitest-environment node
import { describe, expect, it } from 'vitest'
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

  it('formats business changes for the default preview', () => {
    const lineChange = {
      entity: 'WorkshopTaskLineItem',
      id: 'line-1',
      op: 'create' as const,
    }
    expect(formatDefaultSupervisionChangeLabel(lineChange, 'en')).toBe(
      'Workshop line item — Create',
    )
    expect(formatDefaultSupervisionChangeLabel(lineChange, 'de')).toBe(
      'Werkstattposition — Anlegen',
    )
  })

  it('uses workshop language for Site update under Show details only', () => {
    const siteChange = {
      entity: 'Site',
      id: 'site-1',
      op: 'update' as const,
    }
    expect(formatDetailSupervisionChangeLabel(siteChange, 'en')).toBe(
      'Workshop location',
    )
    expect(formatDetailSupervisionChangeLabel(siteChange, 'de')).toBe(
      'Werkstattstandort',
    )
  })
})
