export class LineBuffer {
  private buffer = '';

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
    return lines;
  }

  flush(): string[] {
    const remainder = this.buffer.replace(/\r$/, '');
    this.buffer = '';
    return remainder.length > 0 ? [remainder] : [];
  }
}
