/* eslint-env node */
// Minimal JSON-RPC echo server used by stdio-transport.test.ts.
// Reads line-delimited JSON from stdin and writes a response with the same id.

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf('\n');
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line.length > 0) {
      try {
        const msg = JSON.parse(line);
        if (msg && typeof msg === 'object' && 'id' in msg) {
          const response = { jsonrpc: '2.0', id: msg.id, result: { ok: true, echoed: msg.method } };
          process.stdout.write(JSON.stringify(response) + '\n');
        }
      } catch {
        // ignore
      }
    }
    newline = buffer.indexOf('\n');
  }
});

process.stdin.on('end', () => process.exit(0));
