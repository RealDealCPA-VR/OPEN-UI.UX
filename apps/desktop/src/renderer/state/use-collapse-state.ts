import { useCallback, useEffect, useState } from 'react';

export function useCollapseState(
  key: string,
  defaultValue = false,
): [boolean, () => void, (next: boolean) => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => readBool(key, defaultValue));

  useEffect(() => {
    try {
      window.localStorage.setItem(key, collapsed ? '1' : '0');
    } catch {
      // localStorage may be disabled — fail silently, in-memory state still works.
    }
  }, [key, collapsed]);

  const toggle = useCallback(() => setCollapsed((v) => !v), []);

  return [collapsed, toggle, setCollapsed];
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return fallback;
  } catch {
    return fallback;
  }
}
