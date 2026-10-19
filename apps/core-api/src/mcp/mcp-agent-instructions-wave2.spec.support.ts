export function readMarkdownTableNames(
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

export function readAgentsDocumentedToolNames(markdown: string): string[] {
  return [
    ...readMarkdownTableNames(markdown, /^## Tool catalog\s*$/m, 'Tool catalog'),
    ...readMarkdownTableNames(
      markdown,
      /^## Compliance read tools\s*$/m,
      'Compliance read tools',
    ),
    ...readMarkdownTableNames(
      markdown,
      /^## Wave 2 read tools\s*$/m,
      'Wave 2 read tools',
    ),
  ];
}

export function assertToolCatalogMatchesRegistry(
  markdown: string,
  registeredTools: readonly string[],
): void {
  const documentedTools = readAgentsDocumentedToolNames(markdown);
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
