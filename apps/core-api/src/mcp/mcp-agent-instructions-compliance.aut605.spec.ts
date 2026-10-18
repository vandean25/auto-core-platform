import { readFileSync } from 'node:fs';
import { MCP_WRITE_TOOL_NAMES } from './mcp.constants.js';
import {
  MCP_READ_TOOL_NAMES_WITH_COMPLIANCE,
  MCP_TOOL_NAMES_WITH_COMPLIANCE,
} from './mcp-read-tool-catalog.aut605.js';

function readMarkdownTableNames(
  markdown: string,
  headingPattern: RegExp,
  headingName: string,
): string[] {
  const headingMatch = headingPattern.exec(markdown);
  if (!headingMatch) {
    throw new Error(`Instructions are missing the ${headingName} section.`);
  }

  const sectionStart = markdown.indexOf('\n', headingMatch.index) + 1;
  const remainingMarkdown = markdown.slice(sectionStart);
  const nextHeadingStart = remainingMarkdown.search(/^## /m);
  const section =
    nextHeadingStart < 0
      ? remainingMarkdown
      : remainingMarkdown.slice(0, nextHeadingStart);

  return Array.from(section.matchAll(/^\|\s*`([^`]+)`\s*\|/gm), (match) =>
    match[1].trim(),
  );
}

function readToolCatalogNames(markdown: string): string[] {
  return readMarkdownTableNames(
    markdown,
    /^## Tool catalog\s*$/m,
    'Tool catalog',
  );
}

function assertToolCatalogMatchesRegistry(
  markdown: string,
  registeredTools: readonly string[],
): void {
  const documentedTools = readToolCatalogNames(markdown);
  const registeredToolSet = new Set(registeredTools);
  const documentedToolSet = new Set(documentedTools);
  const documentedButNotRegistered = documentedTools.filter(
    (toolName) => !registeredToolSet.has(toolName),
  );
  const registeredButNotDocumented = registeredTools.filter(
    (toolName) => !documentedToolSet.has(toolName),
  );
  if (
    documentedButNotRegistered.length === 0 &&
    registeredButNotDocumented.length === 0
  ) {
    return;
  }
  throw new Error(
    [
      documentedButNotRegistered.length > 0
        ? `Documented but not registered: ${documentedButNotRegistered.join(', ')}`
        : undefined,
      registeredButNotDocumented.length > 0
        ? `Registered but not documented: ${registeredButNotDocumented.join(', ')}`
        : undefined,
    ]
      .filter(Boolean)
      .join('; '),
  );
}

describe('MCP agent instructions (AUT-605 compliance reads)', () => {
  it('documents every registered MCP tool including compliance reads', () => {
    const instructions = readFileSync(
      new URL('./AGENTS.md', import.meta.url),
      'utf8',
    );
    expect(() =>
      assertToolCatalogMatchesRegistry(
        instructions,
        MCP_TOOL_NAMES_WITH_COMPLIANCE,
      ),
    ).not.toThrow();
  });

  it('keeps the feature-spec read table aligned with the compliance read catalog', () => {
    const featureSpec = readFileSync(
      new URL(
        '../../../../docs/internal/02-Feature-Specs/Platform/mcp-server.md',
        import.meta.url,
      ),
      'utf8',
    );
    const documentedReadTools = readMarkdownTableNames(
      featureSpec,
      /^## Read-only tools/m,
      'Read-only tools',
    );
    const documentedWriteTools = readMarkdownTableNames(
      featureSpec,
      /^## Write tools/m,
      'Write tools',
    );

    expect([...documentedReadTools].sort()).toEqual(
      [...MCP_READ_TOOL_NAMES_WITH_COMPLIANCE].sort(),
    );
    expect([...documentedWriteTools].sort()).toEqual(
      [...MCP_WRITE_TOOL_NAMES].sort(),
    );
  });
});
