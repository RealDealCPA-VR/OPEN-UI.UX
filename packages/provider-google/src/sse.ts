export async function* sseEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let consumerDone = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data: string[] = [];
        for (const line of raw.split('\n')) {
          if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        if (data.length > 0) yield data.join('\n');
        idx = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const trailing = buffer.trim();
    if (trailing.length > 0) {
      const data: string[] = [];
      for (const line of buffer.split('\n')) {
        if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (data.length > 0) yield data.join('\n');
    }
    consumerDone = true;
  } finally {
    if (!consumerDone) {
      try {
        await reader.cancel();
      } catch {
        // swallow cancel errors — connection cleanup is best-effort
      }
    }
    reader.releaseLock();
  }
}
