export function assertDocsChrome({ hasAskAssistant, hasSearchButton }) {
  if (hasAskAssistant) {
    throw new Error('The floating Ask assistant remains enabled');
  }

  if (!hasSearchButton) {
    throw new Error('The header search is unavailable');
  }
}
