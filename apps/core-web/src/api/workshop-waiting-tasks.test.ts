import { describe, expect, it } from 'vitest'
import { resumeWaitingErrorMessage } from './workshop-waiting-tasks'

const GENERIC = 'Wartende Aufgaben konnten nicht fortgesetzt werden.'

describe('resumeWaitingErrorMessage', () => {
  it('gives the German text for each answer the resume action can give', () => {
    expect(resumeWaitingErrorMessage('WORKSHOP_TASK_CHANGED')).toBe(
      'Die Aufgaben wurden gerade geändert. Bitte neu laden und erneut versuchen.',
    )
    expect(resumeWaitingErrorMessage('WORKSHOP_ROLE_FORBIDDEN')).toBe('Für diese Aktion fehlt die Berechtigung.')
  })

  it('falls back to the German generic text for an unknown or missing code, never the server text', () => {
    expect(resumeWaitingErrorMessage('SOME_UNKNOWN_CODE')).toBe(GENERIC)
    expect(resumeWaitingErrorMessage(undefined)).toBe(GENERIC)
  })
})
