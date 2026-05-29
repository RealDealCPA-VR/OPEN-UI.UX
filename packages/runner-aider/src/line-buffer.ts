const DEFAULT_MAX_BYTES = 1 * 1024 * 1024;

export class LineBufferOverflowError extends Error {
  constructor(maxBytes: number) {
    super(`LineBuffer exceeded ${maxBytes} bytes without a newline`);
    this.name = 'LineBufferOverflowError';
  }
}

export class LineBuffer {
  private buffer = '';
  private readonly maxBytes: number;

  constructor(maxBytes: number = DEFAULT_MAX_BYTES) {
    this.maxBytes = maxBytes;
  }

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let newlineIdx = this.buffer.indexOf('\n');
    while (newlineIdx !== -1) {
      const line = this.buffer.slice(0, newlineIdx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newlineIdx + 1);
      lines.push(line);
      newlineIdx = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > this.maxBytes) {
      const truncated = this.buffer.slice(0, this.maxBytes);
      this.buffer = '';
      lines.push(`${truncated.replace(/\r$/, '')} [truncated]`);
    }
    return lines;
  }

  flush(): string[] {
    const remainder = this.buffer.replace(/\r$/, '');
    this.buffer = '';
    return remainder.length > 0 ? [remainder] : [];
  }
}
