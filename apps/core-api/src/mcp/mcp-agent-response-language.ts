import type { DisplayLanguage } from '@prisma/client';

export function buildAgentResponseLanguageInstruction(
  locale: DisplayLanguage,
): string {
  if (locale === 'en') {
    return 'Respond to the authenticated user in English. Keep MCP tool names, parameter names, enums, and structured codes in English.';
  }
  return 'Antworte dem authentifizierten Benutzer auf Deutsch. MCP-Toolnamen, Parameternamen, Enums und strukturierte Codes bleiben Englisch.';
}
