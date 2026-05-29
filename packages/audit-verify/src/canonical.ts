/*
 * JSON Canonicalization Scheme (RFC 8785) implementation.
 *
 * Why: signatures need byte-identical input on the signer and verifier, but
 * `JSON.stringify` does not sort keys or stably encode floats. The previous
 * implementation only sorted the top-level keys of the bundle and ignored
 * entries — a malicious or even a benign re-serialization would have invalidated
 * the signature even when the payload was semantically identical.
 *
 * Spec: https://www.rfc-editor.org/rfc/rfc8785
 */

export function canonicalJson(value: unknown): string {
  if (value === undefined) {
    throw new TypeError('canonicalJson: undefined is not representable in JSON');
  }
  return serialize(value);
}

export function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value), 'utf8');
}

function serialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return serializeNumber(value);
  if (typeof value === 'bigint') {
    throw new TypeError('canonicalJson: bigint is not representable in JSON');
  }
  if (typeof value === 'string') return serializeString(value);
  if (Array.isArray(value)) return serializeArray(value);
  if (typeof value === 'object') return serializeObject(value as Record<string, unknown>);
  throw new TypeError(`canonicalJson: cannot serialize ${typeof value}`);
}

function serializeArray(arr: readonly unknown[]): string {
  const parts: string[] = [];
  for (const item of arr) {
    parts.push(item === undefined ? 'null' : serialize(item));
  }
  return `[${parts.join(',')}]`;
}

function serializeObject(obj: Record<string, unknown>): string {
  const keys: string[] = [];
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined) continue;
    keys.push(k);
  }
  keys.sort(compareUtf16CodeUnits);
  const parts: string[] = [];
  for (const k of keys) {
    parts.push(`${serializeString(k)}:${serialize(obj[k])}`);
  }
  return `{${parts.join(',')}}`;
}

function compareUtf16CodeUnits(a: string, b: string): number {
  if (a === b) return 0;
  const min = Math.min(a.length, b.length);
  for (let i = 0; i < min; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (ca !== cb) return ca - cb;
  }
  return a.length - b.length;
}

function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new TypeError(`canonicalJson: non-finite number ${n} is not representable in JSON`);
  }
  if (n === 0) return '0';
  return ecmaScriptNumberToString(n);
}

function ecmaScriptNumberToString(n: number): string {
  return String(n);
}

const ESCAPES: Readonly<Record<number, string>> = {
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0c: '\\f',
  0x0d: '\\r',
  0x22: '\\"',
  0x5c: '\\\\',
};

function serializeString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const esc = ESCAPES[code];
    if (esc !== undefined) {
      out += esc;
    } else if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else {
      out += s[i];
    }
  }
  out += '"';
  return out;
}
