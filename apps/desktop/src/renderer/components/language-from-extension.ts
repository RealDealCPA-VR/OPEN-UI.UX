/**
 * Map a file path or extension to a Monaco-compatible language id.
 * Returns 'plaintext' for unknown / extensionless files.
 */
const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'plaintext',
  ini: 'ini',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  dart: 'dart',
  m: 'objective-c',
  mm: 'objective-c',
  r: 'r',
  lua: 'lua',
  vue: 'html',
  svelte: 'html',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ps1: 'powershell',
  sql: 'sql',
  xml: 'xml',
  svg: 'xml',
  dockerfile: 'dockerfile',
  proto: 'proto',
  graphql: 'graphql',
  gql: 'graphql',
};

export function languageFromPath(path: string): string {
  if (!path) return 'plaintext';
  const slashIdx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const basename = slashIdx >= 0 ? path.slice(slashIdx + 1) : path;
  const lower = basename.toLowerCase();
  if (lower === 'dockerfile') return 'dockerfile';
  const dotIdx = basename.lastIndexOf('.');
  if (dotIdx < 0 || dotIdx === basename.length - 1) return 'plaintext';
  const ext = basename.slice(dotIdx + 1).toLowerCase();
  return EXT_TO_LANG[ext] ?? 'plaintext';
}
