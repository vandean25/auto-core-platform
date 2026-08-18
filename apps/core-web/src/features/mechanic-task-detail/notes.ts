export function mergeVoiceDraftIntoNotes(existingNotes: string, draft: string): string {
  return existingNotes.trim().length > 0 ? `${existingNotes}\n\n${draft}` : draft
}
