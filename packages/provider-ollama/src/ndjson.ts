export async function* ndjsonLines(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.length > 0) yield line;
        nl = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    const trailing = buffer.trim();
    if (trailing.length > 0) yield trailing;
  } finally {
    reader.releaseLock();
  }
}
