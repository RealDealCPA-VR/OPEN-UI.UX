import nextra from 'nextra';

const withNextra = nextra({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
});

export default withNextra({
  output: 'export',
  images: { unoptimized: true },
  // GitHub Pages serves under /<repo-name>/ by default. Set NEXT_PUBLIC_BASE_PATH
  // in the workflow if you deploy to a project page (e.g. /opencodex).
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  trailingSlash: true,
});
