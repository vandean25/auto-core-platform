import { buildAgentResponseLanguageInstruction } from './mcp-agent-response-language.js';

describe('buildAgentResponseLanguageInstruction', () => {
  it('returns German guidance when the effective locale is de', () => {
    expect(buildAgentResponseLanguageInstruction('de')).toContain('Deutsch');
    expect(buildAgentResponseLanguageInstruction('de')).toContain('Englisch');
  });

  it('returns English guidance when the effective locale is en', () => {
    expect(buildAgentResponseLanguageInstruction('en')).toMatch(/Respond to the authenticated user in English/i);
    expect(buildAgentResponseLanguageInstruction('en')).toContain('English');
  });
});
