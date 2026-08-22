let content = `
    if (originalApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = originalApiKey;
    }
`;

  content = content.replace(/^[ \t]*if\s*\(\s*originalApiKey\s*===\s*undefined\s*\)\s*\{?\s*\n?[ \t]*delete\s+process\.env\.API_KEY;\s*\n?[ \t]*\}?\s*(?:else\s*\{?\s*\n?[ \t]*process\.env\.API_KEY\s*=\s*originalApiKey;\s*\n?[ \t]*\}?)?[ \t]*\r?\n/gm, '');

console.log(content);
