import { describe, expect, it } from 'vitest'
import { mergeVoiceDraftIntoNotes } from './notes'

describe('mergeVoiceDraftIntoNotes', () => {
  it('uses the draft alone when existing notes are empty', () => {
    expect(mergeVoiceDraftIntoNotes('', 'Pads worn')).toBe('Pads worn')
    expect(mergeVoiceDraftIntoNotes('   ', 'Pads worn')).toBe('Pads worn')
  })

  it('appends the draft after existing notes with a blank line', () => {
    expect(mergeVoiceDraftIntoNotes('Existing typed note', 'Edited draft')).toBe(
      'Existing typed note\n\nEdited draft',
    )
  })
})
