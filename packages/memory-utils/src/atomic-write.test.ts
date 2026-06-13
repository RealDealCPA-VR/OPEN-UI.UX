import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { atomicWrite } from './atomic-write';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'opencodex-mu-aw-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('atomicWrite', () => {
  it('writes content to a path', async () => {
    const target = path.join(root, 'a.txt');
    await atomicWrite(target, 'hello');
    expect(await fs.readFile(target, 'utf8')).toBe('hello');
  });

  it('creates intermediate directories', async () => {
    const target = path.join(root, 'nested', 'deep', 'b.txt');
    await atomicWrite(target, 'x');
    expect(await fs.readFile(target, 'utf8')).toBe('x');
  });

  it('leaves no .tmp siblings after success', async () => {
    const target = path.join(root, 'c.txt');
    await atomicWrite(target, 'x');
    const entries = await fs.readdir(root);
    expect(entries.some((n) => n.endsWith('.tmp'))).toBe(false);
  });

  it('overwrites an existing file', async () => {
    const target = path.join(root, 'd.txt');
    await fs.writeFile(target, 'before', 'utf8');
    await atomicWrite(target, 'after');
    expect(await fs.readFile(target, 'utf8')).toBe('after');
  });

  it('accepts a Buffer payload', async () => {
    const target = path.join(root, 'e.bin');
    await atomicWrite(target, Buffer.from([1, 2, 3]));
    const got = await fs.readFile(target);
    expect(Array.from(got)).toEqual([1, 2, 3]);
  });
});
