type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, msg: string, ctx?: Record<string, unknown>): void {
  const entry = { time: Date.now(), level, proc: 'renderer', msg, ...ctx };
  const serialized = JSON.stringify(entry);
  // eslint-disable-next-line no-console
  const fn = console[level === 'debug' ? 'log' : level];
  fn(serialized);
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
} as const;
