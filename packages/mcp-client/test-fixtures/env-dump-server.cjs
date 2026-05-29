/* eslint-env node */
// Replies once with the set of keys present in process.env so the test can
// assert that env-scrubbing actually limits what's passed through.

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
          const response = {
            jsonrpc: '2.0',
            id: msg.id,
            result: { keys: Object.keys(process.env) },
          };
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
