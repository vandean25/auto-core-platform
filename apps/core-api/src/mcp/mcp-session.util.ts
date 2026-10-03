import type { ServerResponse } from 'node:http';

export function respondMcpSessionNotFound(res: ServerResponse): void {
  if (res.headersSent) {
    return;
  }
  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Session not found',
      },
      id: null,
    }),
  );
}
