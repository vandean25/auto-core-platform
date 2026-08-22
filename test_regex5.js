const lines = `
    process.env.API_KEY = 'test-api-key';
    let originalApiKey: string | undefined;
    originalApiKey = process.env.API_KEY;
    if (originalApiKey === undefined) {
      delete process.env.API_KEY;
    }
    if (originalApiKey === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = originalApiKey;
    process.env.API_KEY = originalApiKey;
    } else {
      process.env.API_KEY = originalApiKey;
    }
`.split('\n');

  const newLines = [];
  let skipLines = 0;

  for (let i = 0; i < lines.length; i++) {
    if (skipLines > 0) {
      skipLines--;
      continue;
    }

    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "process.env.API_KEY = 'test-api-key';") continue;
    if (trimmed === "let originalApiKey: string | undefined;") continue;
    if (trimmed === "originalApiKey = process.env.API_KEY;") continue;

    // Single line if-else
    if (trimmed === "if (originalApiKey === undefined) delete process.env.API_KEY;") continue;
    if (trimmed === "else process.env.API_KEY = originalApiKey;") continue;

    // Multi line if-else block
    if (trimmed === "if (originalApiKey === undefined) {") {
      // Look ahead to see if it's the expected block
      if (i + 2 < lines.length &&
          lines[i+1].trim() === "delete process.env.API_KEY;" &&
          lines[i+2].trim() === "}") {

        if (i + 4 < lines.length &&
            lines[i+3].trim() === "} else {" &&
            lines[i+4].trim() === "process.env.API_KEY = originalApiKey;" &&
            lines[i+5].trim() === "}") {
          skipLines = 5;
          continue;
        } else {
          skipLines = 2;
          continue;
        }
      }
    }

    // } else {
    //   process.env.API_KEY = originalApiKey;
    // }
    if (trimmed === "} else {") {
      if (i + 2 < lines.length &&
          lines[i+1].trim() === "process.env.API_KEY = originalApiKey;" &&
          lines[i+2].trim() === "}") {
        skipLines = 2;
        continue;
      }
    }

    newLines.push(line);
  }

console.log(newLines.join('\n'));
