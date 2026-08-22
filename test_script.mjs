const content = `
    process.env.API_KEY = 'test-api-key';
    let originalApiKey: string | undefined;
    originalApiKey = process.env.API_KEY;
    if (originalApiKey === undefined) {
      delete process.env.API_KEY;
    }
    if (originalApiKey === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = originalApiKey;
    process.env.API_KEY = originalApiKey;
`;
const lines = content.split('\n');
const newLines = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes("process.env.API_KEY = 'test-api-key';")) continue;
  if (line.includes("let originalApiKey: string | undefined;")) continue;
  if (line.includes("originalApiKey = process.env.API_KEY;")) continue;
  if (line.includes("if (originalApiKey === undefined) delete process.env.API_KEY;")) continue;
  if (line.includes("else process.env.API_KEY = originalApiKey;")) continue;
  newLines.push(line);
}
console.log(newLines.join('\n'));
