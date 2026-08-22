let content = `
    if (originalApiKey === undefined) {
      delete process.env.API_KEY;
    }
    if (originalApiKey === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = originalApiKey;
    process.env.API_KEY = originalApiKey;
    let originalApiKey: string | undefined;
    originalApiKey = process.env.API_KEY;
    process.env.API_KEY = 'test-api-key';
`;

content = content.replace(/^[ \t]*process\.env\.API_KEY\s*=\s*['"`]test-api-key['"`];[ \t]*\r?\n/gm, '');
content = content.replace(/^[ \t]*let\s+originalApiKey\s*:\s*string\s*\|\s*undefined;[ \t]*\r?\n/gm, '');
content = content.replace(/^[ \t]*originalApiKey\s*=\s*process\.env\.API_KEY;[ \t]*\r?\n/gm, '');
content = content.replace(/^[ \t]*if\s*\(\s*originalApiKey\s*===\s*undefined\s*\)\s*\{?\s*\n?[ \t]*delete\s+process\.env\.API_KEY;\s*\n?[ \t]*\}?\s*(?:else\s*\{?\s*\n?[ \t]*process\.env\.API_KEY\s*=\s*originalApiKey;\s*\n?[ \t]*\}?)?[ \t]*\r?\n/gm, '');

console.log(content);
