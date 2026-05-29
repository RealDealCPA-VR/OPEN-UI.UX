import { describe, expect, it } from 'vitest';
import { categoriesForServer, classifyToolName, getCategoryById } from './permission-map';

describe('classifyToolName', () => {
  it('classifies filesystem reads as fs-read', () => {
    expect(classifyToolName('read_file')).toBe('fs-read');
    expect(classifyToolName('list_directory')).toBe('fs-read');
    expect(classifyToolName('glob')).toBe('fs-read');
  });

  it('classifies filesystem writes as fs-write', () => {
    expect(classifyToolName('write_file')).toBe('fs-write');
    expect(classifyToolName('edit_file')).toBe('fs-write');
    expect(classifyToolName('delete_file')).toBe('fs-write');
    expect(classifyToolName('create_directory')).toBe('fs-write');
  });

  it('classifies shell commands as shell', () => {
    expect(classifyToolName('run_command')).toBe('shell');
    expect(classifyToolName('bash')).toBe('shell');
    expect(classifyToolName('exec')).toBe('shell');
  });

  it('classifies network calls', () => {
    expect(classifyToolName('fetch')).toBe('network');
    expect(classifyToolName('http_request')).toBe('network');
    expect(classifyToolName('web_search')).toBe('network');
  });

  it('classifies git tools', () => {
    expect(classifyToolName('git_commit')).toBe('git');
    expect(classifyToolName('commit')).toBe('git');
  });

  it('classifies github tools by serverId hint', () => {
    expect(classifyToolName('search_issues', 'github')).toBe('github');
    expect(classifyToolName('gh_pr_create')).toBe('github');
  });

  it('classifies database tools', () => {
    expect(classifyToolName('sql')).toBe('database');
    expect(classifyToolName('db_select')).toBe('database');
  });

  it('uses serverId hints when no tools are classified', () => {
    expect(classifyToolName('frobnicate', 'sqlite-local')).toBe('database');
  });

  it('falls back to unknown for unrecognized tools', () => {
    expect(classifyToolName('frobnicate')).toBe('unknown');
    expect(classifyToolName('xyz_abc')).toBe('unknown');
  });
});

describe('categoriesForServer', () => {
  it('deduplicates categories across multiple tools', () => {
    const cats = categoriesForServer('filesystem', ['read_file', 'list_directory', 'write_file']);
    const ids = cats.map((c) => c.id).sort();
    expect(ids).toEqual(['fs-read', 'fs-write']);
  });

  it('returns unknown for an empty tool list', () => {
    const cats = categoriesForServer('some-server', []);
    expect(cats.some((c) => c.id === 'unknown')).toBe(true);
  });

  it('emits human-readable strings', () => {
    const cats = categoriesForServer('filesystem', ['read_file']);
    expect(cats[0]?.humanReadable).toMatch(/read files/i);
  });

  it('marks high-risk categories with severity high', () => {
    const cats = categoriesForServer('shell-server', ['bash']);
    expect(cats[0]?.severity).toBe('high');
  });
});

describe('getCategoryById', () => {
  it('returns category metadata by id', () => {
    const cat = getCategoryById('fs-read');
    expect(cat.label).toBe('Read files');
    expect(cat.severity).toBe('medium');
  });

  it('returns unknown when id is unknown', () => {
    const cat = getCategoryById('unknown');
    expect(cat.id).toBe('unknown');
  });
});
