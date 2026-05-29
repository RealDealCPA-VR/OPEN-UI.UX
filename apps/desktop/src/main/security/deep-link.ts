import { logger } from '../logger';

const DEEP_LINK_MAX_LEN = 2048;
const DEEP_LINK_PATH_RE = /^[a-z0-9._~!$&'()*+,;=:@/\-%?#]*$/i;

export function validateDeepLink(raw: string, protocol: string): string | null {
  if (raw.length > DEEP_LINK_MAX_LEN) {
    logger.warn({ length: raw.length }, 'rejected deep link: exceeds max length');
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    logger.warn({ raw }, 'rejected deep link: not a valid URL');
    return null;
  }
  if (parsed.protocol !== `${protocol}:`) {
    logger.warn({ protocol: parsed.protocol }, 'rejected deep link: wrong protocol');
    return null;
  }
  const tail = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (!DEEP_LINK_PATH_RE.test(tail)) {
    logger.warn({ raw }, 'rejected deep link: disallowed characters in path/query');
    return null;
  }
  return parsed.toString();
}
