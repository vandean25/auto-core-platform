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

    // Multi line if-else block (if originalApiKey === undefined)
    if (trimmed === "if (originalApiKey === undefined) {") {
      // Check if it's the `delete process.env.API_KEY;` block
      if (i + 2 < lines.length &&
          lines[i+1].trim() === "delete process.env.API_KEY;" &&
          lines[i+2].trim() === "}") {

        // Check for the `else` part attached to this `if` block
        if (i + 4 < lines.length &&
            lines[i+3].trim() === "else {" &&
            lines[i+4].trim() === "process.env.API_KEY = originalApiKey;" &&
            lines[i+5].trim() === "}") {
          skipLines = 5;
          continue;
        } else if (i + 4 < lines.length &&
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

    // Catch floating `} else {` part in case the if and else were separated by other formatting
    if (trimmed === "} else {" || trimmed === "else {") {
      if (i + 2 < lines.length &&
          lines[i+1].trim() === "process.env.API_KEY = originalApiKey;" &&
          lines[i+2].trim() === "}") {
        // Also we might need to remove the trailing '}' if this was an 'else {' that had its '}' on previous line
        if (trimmed === "else {" && newLines.length > 0 && newLines[newLines.length - 1].trim() === "}") {
          newLines.pop();
        }
        skipLines = 2;
        continue;
      }
    }

    newLines.push(line);
  }

console.log(newLines.join('\n'));
