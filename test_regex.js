let content = `
describe('...', () => {
  let app: INestApplication;
  let originalApiKey: string | undefined;

  beforeAll(async () => {
    originalApiKey = process.env.API_KEY;
    process.env.API_KEY = 'test-api-key';
  });

  afterAll(async () => {
    if (originalApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = originalApiKey;
    }
  });

  it('works', () => {
    if (originalApiKey === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = originalApiKey;
  });
});
`;

  content = content.replace(/^[ \t]*process\.env\.API_KEY\s*=\s*['"`]test-api-key['"`];[ \t]*\r?\n/gm, '');
  content = content.replace(/^[ \t]*let\s+originalApiKey\s*:\s*string\s*\|\s*undefined;[ \t]*\r?\n/gm, '');
  content = content.replace(/^[ \t]*originalApiKey\s*=\s*process\.env\.API_KEY;[ \t]*\r?\n/gm, '');

  const ifElseRegex = /^[ \t]*if\s*\(originalApiKey\s*===\s*undefined\)\s*\{?\s*delete\s+process\.env\.API_KEY;\s*\}?\s*else\s*\{?\s*process\.env\.API_KEY\s*=\s*originalApiKey;\s*\}?[ \t]*\r?\n/gm;
  content = content.replace(ifElseRegex, '');

console.log(content);
