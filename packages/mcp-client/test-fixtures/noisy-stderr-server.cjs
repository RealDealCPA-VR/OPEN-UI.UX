/* eslint-env node */
// Emits a large chunk of stderr (>64KB) on startup, then replies to JSON-RPC.
// Used to verify the parent drains stderr instead of blocking on the pipe.

const noise = 'x'.repeat(80 * 1024);
process.stderr.write(noise);
process.stderr.write('\nLAST_LINE_MARKER\n');

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
          const response = { jsonrpc: '2.0', id: msg.id, result: { ok: true } };
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
