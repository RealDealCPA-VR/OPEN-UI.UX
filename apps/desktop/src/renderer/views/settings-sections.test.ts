import { describe, expect, it } from 'vitest';
import {
  filterSettingsSections,
  findSectionBySlug,
  SETTINGS_SECTIONS,
  slugify,
  type SettingsSection,
} from './settings-sections';

describe('slugify', () => {
  it('lowercases and dashes', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('collapses non-alphanumerics', () => {
    expect(slugify('MCP servers / extras!')).toBe('mcp-servers-extras');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugify('  --foo bar--  ')).toBe('foo-bar');
  });

  it('handles all-special input', () => {
    expect(slugify('!@#')).toBe('');
  });
});

const sections: SettingsSection[] = [
  { slug: 'theme', title: 'Theme', description: 'Light, dark, or follow OS.' },
  { slug: 'workspace', title: 'Workspace', description: 'Pick the folder the agent operates in.' },
  { slug: 'memory', title: 'Memory', description: 'Long-term memory backends.' },
];

describe('filterSettingsSections', () => {
  it('returns all sections for empty query', () => {
    expect(filterSettingsSections(sections, '')).toHaveLength(3);
    expect(filterSettingsSections(sections, '   ')).toHaveLength(3);
  });

  it('matches against title case-insensitively', () => {
    const out = filterSettingsSections(sections, 'theme');
    expect(out).toHaveLength(1);
    expect(out[0]?.slug).toBe('theme');
  });

  it('matches against description', () => {
    const out = filterSettingsSections(sections, 'folder the agent');
    expect(out).toHaveLength(1);
    expect(out[0]?.slug).toBe('workspace');
  });

  it('returns an empty array for no matches', () => {
    expect(filterSettingsSections(sections, 'xyz-does-not-exist')).toHaveLength(0);
  });

  it('does not mutate the input', () => {
    const input = [...sections];
    filterSettingsSections(input, 'memory');
    expect(input).toEqual(sections);
  });
});

describe('findSectionBySlug', () => {
  it('returns the matching section', () => {
    expect(findSectionBySlug(sections, 'memory')?.title).toBe('Memory');
  });

  it('returns null for an unknown slug', () => {
    expect(findSectionBySlug(sections, 'nope')).toBeNull();
  });

  it('returns null for an empty slug', () => {
    expect(findSectionBySlug(sections, '')).toBeNull();
    expect(findSectionBySlug(sections, undefined)).toBeNull();
  });
});

describe('SETTINGS_SECTIONS', () => {
  it('has unique slugs', () => {
    const slugs = SETTINGS_SECTIONS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('includes every Phase 7 section', () => {
    const slugs = SETTINGS_SECTIONS.map((s) => s.slug);
    for (const expected of [
      'theme',
      'workspace',
      'providers',
      'approvals',
      'plugins',
      'mcp',
      'memory',
      'updates',
      'telemetry',
      'crash-reporting',
      'audit-log',
      'indexing',
    ]) {
      expect(slugs).toContain(expected);
    }
  });

  it('every section has a non-empty title and description', () => {
    for (const s of SETTINGS_SECTIONS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  it('search query matches sections by title fragment', () => {
    const out = filterSettingsSections(SETTINGS_SECTIONS, 'audit');
    expect(out.some((s) => s.slug === 'audit-log')).toBe(true);
  });
});
